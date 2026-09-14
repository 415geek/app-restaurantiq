import { NextResponse } from 'next/server';
import { iqFindRecentReportByAnalyzeKey, iqInsertReport } from '@/lib/funnel/iq-repository';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';
import { buildFreeTierMarketBrief } from '@/lib/funnel/iq-premium-anchors';
import { computeSiteMetrics, formatMetricsDigest } from '@/lib/funnel/agents/metrics';
import { runPartialAnalysis } from '@/lib/funnel/iq-llm';
import {
  analyzeCacheKey,
  analyzeCacheSinceIso,
  readStoredFreeResult,
  type StoredFreeResult,
} from '@/lib/funnel/iq-analyze-cache';
import { resolveConcept, type ConceptResolution } from '@/lib/iq/concept/classify';
import { analyzeWithN8n, getAnalyzeWebhookUrl } from '@/lib/n8n';
import { unknownErrorMessage } from '@/lib/unknown-error-message';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';
import { toLocale, type Locale } from '@/lib/i18n/locale';

export const runtime = 'nodejs';

const MOCK_COPY: Record<Locale, { headline: string; subheadline: string; snapshot: string[]; risk: string; teaser: string }> = {
  en: {
    headline: 'Proceed with caution',
    subheadline: 'This is mock data. Configure an analysis provider for real results.',
    snapshot: ['Competition density: unknown', 'Demand pattern: unknown', 'Price band: unknown'],
    risk: 'Analysis is not configured, so real risks cannot be identified.',
    teaser: 'Configure n8n or OpenAI to unlock the full analysis.',
  },
  zh: {
    headline: '谨慎推进',
    subheadline: '此为模拟数据，请配置分析服务以获取真实结果。',
    snapshot: ['竞争密度：未知', '需求模式：未知', '价格带：未知'],
    risk: '未配置分析服务，无法识别真实风险。',
    teaser: '配置 N8N 或 OpenAI 以解锁完整分析能力。',
  },
  es: {
    headline: 'Proceder con cautela',
    subheadline: 'Estos son datos de prueba. Configura un proveedor de análisis para obtener resultados reales.',
    snapshot: ['Densidad de competencia: desconocida', 'Patrón de demanda: desconocido', 'Rango de precios: desconocido'],
    risk: 'El análisis no está configurado, así que no se pueden identificar riesgos reales.',
    teaser: 'Configura n8n u OpenAI para desbloquear el análisis completo.',
  },
};

/**
 * Free-tier provider prompts (especially the n8n analyze workflow) don't read
 * `market_data.user_inputs.*`, so the LLM happily lists `monthly_rent` /
 * `sqft` in `missing_data` even when the user supplied them on the lead form.
 * After every LLM reply we scrub `missing_data` for any field the user
 * actually provided and add it to `acquired_data` so the scorecard shows the
 * right picture regardless of which provider answered.
 */
const RENT_MISSING_KEYS = new Set(['monthly_rent', 'monthly_rent_usd', 'rent', 'rent_usd', 'rent_monthly']);
const SQFT_MISSING_KEYS = new Set(['sqft', 'size_sqft', 'square_feet', 'square_footage']);
const RENT_ACQUIRED_LABEL = 'User-provided rent';
const SQFT_ACQUIRED_LABEL = 'User-provided sqft';

function reconcileRiskAuditPreviewWithUserInputs(
  preview: unknown,
  userInputs: { monthly_rent_usd?: number; sqft?: number } | undefined,
): Record<string, unknown> | undefined {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return preview && typeof preview === 'object' ? (preview as Record<string, unknown>) : undefined;
  }
  if (!userInputs) return preview as Record<string, unknown>;

  const obj = { ...(preview as Record<string, unknown>) };
  const hasRent = typeof userInputs.monthly_rent_usd === 'number' && userInputs.monthly_rent_usd > 0;
  const hasSqft = typeof userInputs.sqft === 'number' && userInputs.sqft > 0;

  // missing_data: drop fields the user actually supplied.
  const rawMissing = obj.missing_data;
  if (Array.isArray(rawMissing)) {
    const filtered = rawMissing.filter((entry) => {
      if (typeof entry !== 'string') return true;
      const key = entry.trim().toLowerCase();
      if (hasRent && RENT_MISSING_KEYS.has(key)) return false;
      if (hasSqft && SQFT_MISSING_KEYS.has(key)) return false;
      return true;
    });
    obj.missing_data = filtered;
  }

  // acquired_data: credit the user inputs (idempotent against repeated calls).
  const rawAcquired = obj.acquired_data;
  const acquired = Array.isArray(rawAcquired)
    ? rawAcquired.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : [];
  const acquiredSet = new Set(acquired.map((x) => x.toLowerCase()));
  if (hasRent && !acquiredSet.has(RENT_ACQUIRED_LABEL.toLowerCase())) acquired.push(RENT_ACQUIRED_LABEL);
  if (hasSqft && !acquiredSet.has(SQFT_ACQUIRED_LABEL.toLowerCase())) acquired.push(SQFT_ACQUIRED_LABEL);
  obj.acquired_data = acquired;

  return obj;
}

/** The concept fields every tier reads back from `market_data_json.concept`. */
function conceptRecord(c: ConceptResolution): Record<string, unknown> {
  return {
    id: c.id,
    category: c.category,
    label_zh: c.label_zh,
    label_en: c.label_en,
    label_es: c.label_es,
    method: c.method,
    confidence: c.confidence,
    matched: c.matched,
  };
}

function conceptLabelFor(c: ConceptResolution | null, lang: Locale): string | undefined {
  if (!c) return undefined;
  return lang === 'zh' ? c.label_zh : lang === 'es' ? c.label_es : c.label_en;
}

export async function POST(req: Request) {
  await ensureRuntimeConfig();
  try {
    const body = (await req.json()) as {
      location?: string;
      businessType?: string;
      language?: string;
      monthlyRentUsd?: number | string;
      sqft?: number | string;
      /** Taxonomy id confirmed by the ConceptPicker (§4.1 step 3). */
      conceptId?: string;
    };
    const location = String(body.location ?? '').trim();
    const businessType = String(body.businessType ?? '').trim();
    const conceptIdInput = String(body.conceptId ?? '').trim() || null;
    const monthlyRentUsd = body.monthlyRentUsd != null ? Number(body.monthlyRentUsd) : undefined;
    const sqft = body.sqft != null ? Number(body.sqft) : undefined;
    const rentOk = Number.isFinite(monthlyRentUsd) && monthlyRentUsd! > 0;
    const sqftOk = Number.isFinite(sqft) && sqft! > 0;
    const userInputs =
      rentOk || sqftOk
        ? {
            ...(rentOk ? { monthly_rent_usd: monthlyRentUsd } : {}),
            ...(sqftOk ? { sqft } : {}),
          }
        : undefined;
    // Visitor locale ('en' | 'zh' | 'es'); every provider call and the stored report row use it.
    const language: Locale = toLocale(body.language);

    if (!location) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    if (location.length > 500) {
      return NextResponse.json({ error: 'Location is too long' }, { status: 400 });
    }

    const hasN8nWebhook = Boolean(getAnalyzeWebhookUrl());
    const hasOpenAiKey = Boolean(
      process.env.OPENAI_API_KEY?.trim() ||
        process.env.ANTHROPIC_API_KEY?.trim() ||
        process.env.MIMO_API_KEY?.trim(),
    );
    if (!hasN8nWebhook && !hasOpenAiKey) {
      const isDevLike = process.env.NODE_ENV !== 'production';
      const allowMock = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
      if (isDevLike || allowMock) {
        const mock = MOCK_COPY[language];
        return NextResponse.json({
          reportId: '',
          cached: false,
          verdict: 'mock',
          headline: mock.headline,
          subheadline: mock.subheadline,
          market_snapshot: mock.snapshot,
          hidden_risk: mock.risk,
          paywall_teaser: mock.teaser,
        });
      }
      return NextResponse.json(
        {
          error:
            'Analysis is not configured. Set N8N_IQ_ANALYZE_WEBHOOK_URL (preferred) or OPENAI_API_KEY on the server, then retry.',
        },
        { status: 503 }
      );
    }

    // ── §4.1 concept: every typed business type lands on one taxonomy entry ──
    // A blank business type is analysed as a generic restaurant (nothing to
    // classify); otherwise an unconfident classification asks the user first
    // and runs nothing.
    let concept: ConceptResolution | null = null;
    if (businessType) {
      try {
        concept = await resolveConcept({ text: businessType, conceptId: conceptIdInput });
      } catch (conceptErr) {
        console.warn('[funnel/analyze] concept resolution failed, continuing with raw text:', conceptErr);
      }
      if (concept?.needs_confirmation) {
        return NextResponse.json({
          needs_concept_confirmation: true,
          concept: {
            ...conceptRecord(concept),
            needs_confirmation: true,
            options: concept.options,
          },
        });
      }
    }
    const conceptLabel = conceptLabelFor(concept, language);

    // ── §4.5 idempotency: same normalised inputs within 24 h → stored row ──
    const analyzeKey = analyzeCacheKey({
      location,
      businessType,
      monthlyRentUsd: rentOk ? monthlyRentUsd : null,
      sqft: sqftOk ? sqft : null,
      language,
      conceptId: concept?.id ?? null,
    });
    try {
      const cachedRow = await iqFindRecentReportByAnalyzeKey({
        key: analyzeKey,
        language,
        sinceIso: analyzeCacheSinceIso(),
      });
      const stored = cachedRow ? readStoredFreeResult(cachedRow.market_data_json) : null;
      if (cachedRow && stored) {
        const storedConcept = (cachedRow.market_data_json as Record<string, unknown> | null)?.concept;
        return NextResponse.json({
          reportId: cachedRow.id,
          cached: true,
          ...stored,
          ...(storedConcept && typeof storedConcept === 'object' ? { concept: storedConcept } : {}),
        });
      }
    } catch (cacheErr) {
      const message = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
      if (!message.includes('Supabase admin env is not configured')) {
        console.warn('[funnel/analyze] cache lookup failed, running analysis:', message);
      }
    }

    // One market prefetch per request (it used to run twice: before the LLM
    // and again as a "merge" afterwards).
    let prefetchedMarket: Record<string, unknown> | null = null;
    try {
      prefetchedMarket =
        (await resolveMarketDataForIqReport({
          existing: null,
          location,
          businessType: conceptLabel || businessType || 'restaurant',
          isPremium: false,
          lang: language,
        })) ?? null;
    } catch (prefetchErr) {
      console.warn('[funnel/analyze] market prefetch failed, continuing:', prefetchErr);
    }
    // Deterministic metrics (fair-share revenue, saturation, demand pool, rent
    // economics) are appended so the free verdict is grounded in computed numbers.
    const siteMetrics = computeSiteMetrics({
      marketData: prefetchedMarket,
      businessType: conceptLabel || businessType || 'restaurant',
    });
    const metricsDigest = formatMetricsDigest(siteMetrics, language);
    const freeBrief = [buildFreeTierMarketBrief(prefetchedMarket, language), metricsDigest]
      .filter(Boolean)
      .join('\n\n');

    const llmInput = {
      location,
      businessType,
      conceptLabel,
      language,
      marketDataBrief: freeBrief,
      monthlyRentUsd: rentOk ? monthlyRentUsd : undefined,
      sqft: sqftOk ? sqft : undefined,
    };

    let parsed: Awaited<ReturnType<typeof analyzeWithN8n>>;
    try {
      if (hasN8nWebhook) {
        parsed = await analyzeWithN8n({
          address: location,
          industry: 'restaurant',
          cuisine_type: conceptLabel || businessType || undefined,
          language,
          ...(prefetchedMarket && Object.keys(prefetchedMarket).length > 0
            ? {
                market_data: {
                  ...prefetchedMarket,
                  computed_metrics: siteMetrics,
                  ...(userInputs ? { user_inputs: userInputs } : {}),
                },
              }
            : userInputs
              ? { market_data: { user_inputs: userInputs } }
              : {}),
        });
      } else {
        parsed = await runPartialAnalysis(llmInput);
      }
    } catch (n8nErr) {
      if (hasN8nWebhook && hasOpenAiKey) {
        console.warn('[funnel/analyze] n8n analyze failed, falling back to OpenAI:', n8nErr);
        parsed = await runPartialAnalysis({ ...llmInput, openAiOnly: true });
      } else {
        throw n8nErr;
      }
    }

    const verdict = String(parsed.verdict ?? '').trim();
    const headline = String(parsed.headline ?? '').trim();
    const subheadline = String(parsed.subheadline ?? '').trim();
    const marketSnapshot = Array.isArray(parsed.market_snapshot)
      ? parsed.market_snapshot.map(s => String(s ?? '').trim()).filter(Boolean)
      : [];
    const hiddenRisk = String(parsed.hidden_risk ?? '').trim();
    const paywallTeaser = String(parsed.paywall_teaser ?? '').trim();

    if (!verdict || !headline) {
      return NextResponse.json({ error: 'Invalid analysis response from provider' }, { status: 502 });
    }

    const decisionTier = String((parsed as { decision_tier?: string }).decision_tier ?? '').trim();
    const rawRiskAuditPreview = (parsed as { risk_audit_preview?: unknown }).risk_audit_preview;
    const riskAuditPreview = reconcileRiskAuditPreviewWithUserInputs(rawRiskAuditPreview, userInputs);

    const freeResult: StoredFreeResult = {
      verdict,
      headline,
      subheadline,
      market_snapshot: marketSnapshot,
      hidden_risk: hiddenRisk,
      paywall_teaser: paywallTeaser,
      ...(decisionTier ? { decision_tier: decisionTier } : {}),
      ...(riskAuditPreview && typeof riskAuditPreview === 'object' ? { risk_audit_preview: riskAuditPreview } : {}),
    };

    // Market seed: the prefetch (already enriched + finance model) merged with
    // whatever n8n returned; no second resolve pass.
    let marketSeed: Record<string, unknown> | null = null;
    const fromN8n = parsed.market_data;
    if (fromN8n && typeof fromN8n === 'object' && !Array.isArray(fromN8n)) {
      marketSeed = { ...(prefetchedMarket ?? {}), ...(fromN8n as Record<string, unknown>) };
    } else if (prefetchedMarket && Object.keys(prefetchedMarket).length > 0) {
      marketSeed = { ...prefetchedMarket };
    }
    const marketDataJson: Record<string, unknown> = {
      ...(marketSeed ?? {}),
      ...(userInputs || concept
        ? {
            user_inputs: {
              ...((marketSeed?.user_inputs as Record<string, unknown> | undefined) ?? {}),
              ...(userInputs ?? {}),
              ...(concept ? { concept_id: concept.id } : {}),
            },
          }
        : {}),
      ...(concept ? { concept: conceptRecord(concept) } : {}),
      analyze_key: analyzeKey,
      free_result: freeResult,
    };

    let reportId = '';
    try {
      reportId = await iqInsertReport({
        location,
        businessType: businessType || null,
        verdict,
        headline,
        reason: subheadline || hiddenRisk,
        language,
        marketDataJson,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const missingAdmin = message.includes('Supabase admin env is not configured');
      if (process.env.NODE_ENV === 'production' && !missingAdmin) {
        console.error('[funnel/analyze] iqInsertReport failed (non-fatal):', message);
        // Analysis already succeeded — do not fail the user-facing response when persistence fails.
        reportId = '';
      } else if (process.env.NODE_ENV !== 'production' && missingAdmin) {
        reportId = '';
      } else {
        throw err;
      }
    }

    return NextResponse.json({
      reportId,
      cached: false,
      ...freeResult,
      ...(concept ? { concept: conceptRecord(concept) } : {}),
    });
  } catch (e) {
    const cause =
      e instanceof Error && e.cause !== undefined ? unknownErrorMessage(e.cause, 300) : undefined;
    console.error('[funnel/analyze]', e, cause ? { cause } : '');
    return NextResponse.json(
      {
        error: 'Failed to analyze location',
        detail: unknownErrorMessage(e, 500),
        ...(cause ? { cause } : {}),
      },
      { status: 500 },
    );
  }
}
