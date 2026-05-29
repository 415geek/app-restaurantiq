import OpenAI from 'openai';
import { z } from 'zod';
import {
  locationIqV2FreeSystemEn,
  locationIqV2FreeSystemZh,
  locationIqV2FreeUserEn,
  locationIqV2FreeUserZh,
  locationIqV2PremiumSystemEn,
  locationIqV2PremiumSystemZh,
  locationIqV2PremiumUserEn,
  locationIqV2PremiumUserZh,
} from '@/lib/funnel/iq-prompts-locationiq-v2';
import { getAnalyzeWebhookUrl } from '@/lib/n8n';
import {
  applyCompetitorWhitelist,
  parseIqFullReport,
  scoreFullReportCompleteness,
  shouldRetryForCompetitorGrounding,
  type IqReportWithGrounding,
} from '@/lib/funnel/iq-full-report-schema';
import { buildPremiumMarketDataSection } from '@/lib/funnel/iq-premium-anchors';
import {
  appendLlmProviderToDisclaimer,
  runIqProviderJson,
  shouldUseFullMarketContextForIqFull,
} from '@/lib/funnel/iq-provider-router';
import {
  buildCompetitorWhitelistPromptBlock,
  extractCompetitorWhitelist,
  MIN_WHITELIST_FOR_GROUNDED_REPORT,
  type CompetitorWhitelist,
} from '@/lib/funnel/iq-market-signals';
import {
  decisionTierSchema,
  decisionTierToVerdict,
  riskAuditPreviewSchema,
} from '@/lib/funnel/iq-risk-audit-model';

const partialSchema = z.object({
  verdict: z.string(),
  headline: z.string(),
  subheadline: z.string().optional(),
  market_snapshot: z.array(z.string()).optional(),
  hidden_risk: z.string().optional(),
  paywall_teaser: z.string().optional(),
  reason: z.string().optional(),
  decision_tier: decisionTierSchema.optional(),
  risk_audit_preview: riskAuditPreviewSchema.optional(),
});

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function model() {
  return process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o-mini';
}

/** Paid full report: default to stronger model for structured, decision-grade output. */
function modelFull() {
  return process.env.OPENAI_IQ_FULL_MODEL?.trim() || process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o';
}

async function postN8nJson<T>(url: string, body: unknown): Promise<T> {
  const secret =
    process.env.N8N_IQ_WEBHOOK_SECRET?.trim() || process.env.N8N_INTERNAL_AUTH_TOKEN?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`n8n webhook failed: ${res.status} ${t.slice(0, 500)}`);
  }

  return (await res.json()) as T;
}

export async function runPartialAnalysis(input: {
  location: string;
  businessType: string;
  language?: 'en' | 'zh';
  /** Places/ACS digest from resolveMarketDataForIqReport (free tier). */
  marketDataBrief?: string;
  monthlyRentUsd?: number;
  sqft?: number;
  /** When true, skip n8n and use OpenAI only (e.g. after analyzeWithN8n already failed). */
  openAiOnly?: boolean;
}): Promise<{
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
  reason?: string;
  decision_tier?: string;
  risk_audit_preview?: z.infer<typeof riskAuditPreviewSchema>;
}> {
  const language = input.language === 'zh' ? 'zh' : 'en';
  const n8nUrl = input.openAiOnly ? null : getAnalyzeWebhookUrl();
  if (n8nUrl) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      address: input.location,
      industry: 'restaurant',
      cuisine_type: input.businessType || undefined,
      language,
    });
    return partialSchema.parse(raw);
  }

  const client = getOpenAI();
  if (!client) {
    throw new Error('Neither N8N_IQ_ANALYZE_WEBHOOK_URL nor OPENAI_API_KEY is configured');
  }

  const systemPrompt = language === 'zh' ? locationIqV2FreeSystemZh() : locationIqV2FreeSystemEn();

  const userPrompt =
    language === 'zh'
      ? locationIqV2FreeUserZh({
          location: input.location,
          businessType: input.businessType || '餐饮',
          marketDataBrief: input.marketDataBrief,
          monthlyRentUsd: input.monthlyRentUsd,
          sqft: input.sqft,
        })
      : locationIqV2FreeUserEn({
          location: input.location,
          businessType: input.businessType || 'Restaurant',
          marketDataBrief: input.marketDataBrief,
          monthlyRentUsd: input.monthlyRentUsd,
          sqft: input.sqft,
        });

  const routed = await runIqProviderJson<Record<string, unknown>>({
    task: 'iq_partial',
    system: systemPrompt,
    user: userPrompt,
  });

  let parsed: z.infer<typeof partialSchema>;
  if (routed?.data) {
    parsed = partialSchema.parse(routed.data);
  } else {
    const completion = await client.chat.completions.create({
      model: model(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error('Empty OpenAI response');
    parsed = partialSchema.parse(JSON.parse(text));
  }
  if (parsed.decision_tier) {
    parsed.verdict = decisionTierToVerdict(parsed.decision_tier);
  }
  return parsed;
}

function buildPremiumPrompts(
  input: {
    location: string;
    businessType: string | null;
    headline: string;
    reason: string;
    marketData?: Record<string, unknown>;
  },
  language: 'en' | 'zh',
  whitelist: CompetitorWhitelist,
  opts: { stricter?: boolean } = {},
): { systemPrompt: string; userPrompt: string } {
  const systemBase =
    language === 'zh' ? locationIqV2PremiumSystemZh() : locationIqV2PremiumSystemEn();

  const stricterReminder = opts.stricter
    ? language === 'zh'
      ? '\n\n【重试纠错通知】上一次输出包含**白名单外的店名**，已被后端剔除。本次请严格逐字使用上方白名单，宁可少于 5 行，绝不补造。'
      : '\n\n[RETRY NOTICE] The previous output included names NOT in the whitelist; they were dropped. This retry MUST use ONLY verbatim whitelist entries. Output fewer rows rather than fabricate.'
    : '';

  const fullContext = shouldUseFullMarketContextForIqFull();
  const marketDataSection =
    buildPremiumMarketDataSection(input.marketData ?? null, language, { fullContext }) +
    buildCompetitorWhitelistPromptBlock(whitelist, language) +
    stricterReminder;

  const userPrompt =
    language === 'zh'
      ? locationIqV2PremiumUserZh({
          location: input.location,
          businessType: input.businessType || '餐厅',
          headline: input.headline,
          reason: input.reason,
          marketDataSection,
        })
      : locationIqV2PremiumUserEn({
          location: input.location,
          businessType: input.businessType || 'Restaurant',
          headline: input.headline,
          reason: input.reason,
          marketDataSection,
        });

  return { systemPrompt: systemBase, userPrompt };
}

async function callProviderForFullReport(
  systemPrompt: string,
  userPrompt: string,
  attemptLabel: string,
  language: 'en' | 'zh',
): Promise<{ report: Record<string, unknown>; provider: string; model: string }> {
  const routed = await runIqProviderJson<Record<string, unknown>>({
    task: 'iq_full',
    system: systemPrompt,
    user: userPrompt,
  });

  if (routed?.data) {
    try {
      const report = parseIqFullReport(routed.data) as Record<string, unknown>;
      appendLlmProviderToDisclaimer(report, {
        provider: routed.provider,
        model: routed.model,
        task: 'iq_full',
      }, language);
      if (routed.warning) {
        const w = Array.isArray(report._warnings) ? (report._warnings as string[]) : [];
        report._warnings = [
          ...w,
          language === 'zh'
            ? '主生成路径暂不可用，已自动切换备用分析通道。'
            : 'Primary analysis path was unavailable; an alternate channel was used.',
        ];
      }
      report._generation_provider = routed.provider;
      report._generation_model = routed.model;
      return { report, provider: routed.provider, model: routed.model };
    } catch (parseErr) {
      console.warn('[iq-full-report] routed LLM JSON parse failed, trying fallback:', parseErr);
    }
  }

  const client = getOpenAI();
  if (!client) {
    throw new Error(
      `Neither MiMo nor OPENAI_API_KEY is configured for full report (${attemptLabel})`,
    );
  }

  const completion = await client.chat.completions.create({
    model: modelFull(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 16_000,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error(`Empty OpenAI response (${attemptLabel})`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI full report was not valid JSON (${attemptLabel})`);
  }
  const report = parseIqFullReport(parsed) as Record<string, unknown>;
  appendLlmProviderToDisclaimer(
    report,
    { provider: 'openai', model: modelFull(), task: 'iq_full' },
    language,
  );
  return { report, provider: 'openai', model: modelFull() };
}

function minCompletenessForPaidReport(): number {
  const raw = process.env.IQ_FULL_REPORT_MIN_COMPLETENESS?.trim();
  const n = raw ? Number(raw) : 60;
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 60;
}

/**
 * OpenAI-only paid full report (used when n8n is off or after n8n failure).
 * For production entry, use `generateIqFullReportWithN8nFallback` from iq-generate-full-report.ts.
 *
 * B-1 grounding flow:
 *   1. Extract competitor whitelist from market_data (Google ∪ Yelp ∪ BrightData).
 *   2. Inject whitelist into the user prompt as a hard constraint.
 *   3. Call OpenAI, parse, apply whitelist filter post-LLM.
 *   4. If too many competitors were dropped or the kept count falls below the
 *      grounding threshold AND the whitelist itself had enough entries, retry
 *      once with a stricter prompt.
 *   5. Always return the report — never throw — but stamp grounding flags so
 *      the UI and downstream telemetry can show a "low confidence" state.
 */
/** Paid full report via IQ provider router (MiMo primary when configured). */
export async function runFullPremiumReport(input: {
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData?: Record<string, unknown>;
  language?: 'en' | 'zh';
}): Promise<IqReportWithGrounding> {
  const language = input.language === 'zh' ? 'zh' : 'en';

  const whitelist = extractCompetitorWhitelist(input.marketData ?? null);
  console.log(
    `[iq-full-report] whitelist size=${whitelist.total} (google=${whitelist.countsBySource.google}, yelp=${whitelist.countsBySource.yelp}, brightdata=${whitelist.countsBySource.brightdata})`,
  );

  const runOnce = async (stricter: boolean) => {
    const prompts = buildPremiumPrompts(input, language, whitelist, { stricter });
    const { report } = await callProviderForFullReport(
      prompts.systemPrompt,
      prompts.userPrompt,
      stricter ? 'attempt-2' : 'attempt-1',
      language,
    );
    return applyCompetitorWhitelist(report, whitelist);
  };

  let grounded: IqReportWithGrounding;
  try {
    grounded = await runOnce(false);
  } catch (e) {
    console.error('[iq-full-report] primary generation failed:', e);
    throw new Error('FULL_REPORT_GENERATION_FAILED');
  }
  let completeness = scoreFullReportCompleteness(grounded);
  const minScore = minCompletenessForPaidReport();

  if (completeness < minScore && shouldUseFullMarketContextForIqFull()) {
    console.warn(
      `[iq-full-report] completeness ${completeness} < ${minScore}; regenerating once (MiMo)`,
    );
    try {
      const regen = await runOnce(true);
      const regenScore = scoreFullReportCompleteness(regen);
      if (regenScore > completeness) {
        grounded = regen;
        completeness = regenScore;
      }
    } catch (e) {
      console.warn('[iq-full-report] completeness regen failed:', e);
    }
  }

  if (shouldRetryForCompetitorGrounding(grounded, whitelist)) {
    const droppedCount = grounded._dropped_competitor_names?.length ?? 0;
    console.warn(
      `[iq-full-report] retrying due to ${droppedCount} hallucinated competitor(s); whitelist had ${whitelist.total}`,
    );
    try {
      const retryGrounded = await runOnce(true);
      const retryKept = Array.isArray(retryGrounded.competitors) ? retryGrounded.competitors.length : 0;
      const firstKept = Array.isArray(grounded.competitors) ? grounded.competitors.length : 0;
      if (
        retryKept > firstKept ||
        (retryKept === firstKept &&
          (retryGrounded._dropped_competitor_names?.length ?? 0) <
            (grounded._dropped_competitor_names?.length ?? 0))
      ) {
        grounded = retryGrounded;
      }
    } catch (e) {
      console.warn('[iq-full-report] grounding retry failed:', e);
    }
  }

  if (whitelist.total < MIN_WHITELIST_FOR_GROUNDED_REPORT) {
    const existing = Array.isArray(grounded._warnings) ? grounded._warnings : [];
    grounded._warnings = [
      ...existing,
      `Competitor analysis runs in degraded mode: only ${whitelist.total} named competitor(s) were retrieved (threshold ${MIN_WHITELIST_FOR_GROUNDED_REPORT}).`,
    ];
    if (typeof grounded.confidence === 'string') {
      if (/high/i.test(grounded.confidence)) grounded.confidence = 'Low';
    } else {
      grounded.confidence = 'Low';
    }
  }

  grounded._llm_completeness_score = completeness;
  return grounded;
}

/** @deprecated Use runFullPremiumReport — kept for backward-compatible imports. */
export async function runFullPremiumReportOpenAI(
  input: Parameters<typeof runFullPremiumReport>[0],
): Promise<IqReportWithGrounding> {
  return runFullPremiumReport(input);
}
