import OpenAI from 'openai';
import { z } from 'zod';
import { type Locale, pick, toLocale } from '@/lib/i18n/locale';
import {
  defaultBusinessTypeLabel,
  locationIqV2FreeSystem,
  locationIqV2FreeUser,
  locationIqV2PremiumSystem,
  locationIqV2PremiumUser,
} from '@/lib/funnel/iq-prompts-locationiq-v2';
import { getAnalyzeWebhookUrl } from '@/lib/n8n';
import {
  applyCompetitorWhitelist,
  isHighConfidenceText,
  confidenceLabel,
  parseIqFullReport,
  scoreFullReportCompleteness,
  shouldRetryForCompetitorGrounding,
  type IqReportWithGrounding,
} from '@/lib/funnel/iq-full-report-schema';
import { buildPremiumMarketDataSection } from '@/lib/funnel/iq-premium-anchors';
import {
  getIqFullReportJsonSchema,
  structuredOutputEnabled,
} from '@/lib/funnel/iq-report-output-schema';
import {
  appendLlmProviderToDisclaimer,
  runIqProviderJson,
  shouldUseFullMarketContextForIqFull,
} from '@/lib/funnel/iq-provider-router';
import type { IqRouteAttempt } from '@/lib/funnel/iq-provider-router';
import {
  GENERATION_MIN_BUDGET_MS,
  MS_PER_TOKEN_DEEP,
  MS_PER_TOKEN_FAST,
  outputTokenBudget,
} from '@/lib/funnel/iq-deadline';
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
  // Explicit timeout: the SDK default (10 min + auto-retries) can eat the whole
  // 300s serverless budget on a single hung request.
  return new OpenAI({ apiKey: key, timeout: 120_000, maxRetries: 1 });
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
  language?: Locale | string | null;
  /** Places/ACS digest from resolveMarketDataForIqReport (free tier). */
  marketDataBrief?: string;
  monthlyRentUsd?: number;
  sqft?: number;
  /** When true, skip n8n and use OpenAI only (e.g. after analyzeWithN8n already failed). */
  openAiOnly?: boolean;
  /** Resolved taxonomy label (§4.1); replaces the raw typed text in the prompt when present. */
  conceptLabel?: string;
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
  const language = toLocale(input.language);
  const n8nUrl = input.openAiOnly ? null : getAnalyzeWebhookUrl();
  if (n8nUrl) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      address: input.location,
      industry: 'restaurant',
      cuisine_type: input.conceptLabel || input.businessType || undefined,
      language,
    });
    return partialSchema.parse(raw);
  }

  const systemPrompt = locationIqV2FreeSystem(language);

  const userPrompt = locationIqV2FreeUser(language, {
    location: input.location,
    businessType: input.conceptLabel || input.businessType || defaultBusinessTypeLabel(language),
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
    const client = getOpenAI();
    if (!client) {
      throw new Error(
        'No LLM provider produced a result (configure ANTHROPIC_API_KEY, MIMO_API_KEY, or OPENAI_API_KEY, or N8N_IQ_ANALYZE_WEBHOOK_URL)',
      );
    }
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

export function buildPremiumPrompts(
  input: {
    location: string;
    businessType: string | null;
    headline: string;
    reason: string;
    marketData?: Record<string, unknown>;
  },
  language: Locale,
  whitelist: CompetitorWhitelist,
  opts: { stricter?: boolean; lean?: boolean } = {},
): { systemPrompt: string; userPrompt: string } {
  const systemBase = locationIqV2PremiumSystem(language);

  const stricterReminder = opts.stricter
    ? pick(language, {
        en: '\n\n[RETRY NOTICE] The previous output included names NOT in the whitelist; they were dropped. This retry MUST use ONLY verbatim whitelist entries. Output fewer rows rather than fabricate.',
        zh: '\n\n【重试纠错通知】上一次输出包含**白名单外的店名**，已被后端剔除。本次请严格逐字使用上方白名单，宁可少于 5 行，绝不补造。',
        es: '\n\n[AVISO DE REINTENTO] La salida anterior incluyó nombres que NO están en la lista blanca y fueron eliminados. Este reintento DEBE usar ÚNICAMENTE entradas textuales de la lista blanca. Devuelve menos filas antes que inventar.',
      })
    : '';

  // Lean/browser path keeps the prompt compact so prefill + generation fit the serverless budget.
  const fullContext = !opts.lean && shouldUseFullMarketContextForIqFull();
  const marketDataSection =
    buildPremiumMarketDataSection(input.marketData ?? null, language, { fullContext }) +
    buildCompetitorWhitelistPromptBlock(whitelist, language) +
    stricterReminder;

  const userPrompt = locationIqV2PremiumUser(language, {
    location: input.location,
    businessType: input.businessType || defaultBusinessTypeLabel(language),
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
  language: Locale,
  lean = false,
  timeoutMs?: number,
  maxTokens?: number,
): Promise<{ report: Record<string, unknown>; provider: string; model: string }> {
  const attempts: IqRouteAttempt[] = [];
  const routed = await runIqProviderJson<Record<string, unknown>>({
    task: 'iq_full',
    system: systemPrompt,
    user: userPrompt,
    fastModel: lean,
    timeoutMs,
    maxTokens,
    attempts,
    // Guarantees parseable JSON on Claude — the 188s "unparseable JSON" loss
    // seen in production cannot recur on the structured-output path.
    jsonSchema: structuredOutputEnabled() ? getIqFullReportJsonSchema() : undefined,
  });
  const attemptSummary = () =>
    attempts.map((a) => `${a.provider}/${a.model}: ${a.ok ? 'ok' : a.reason ?? 'failed'}`).join(' | ');

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
          pick(language, {
            en: 'The primary analysis path was unavailable, so an alternate channel was used.',
            zh: '主生成路径暂不可用，已自动切换备用分析通道。',
            es: 'La ruta principal de análisis no estaba disponible, por lo que se utilizó un canal alternativo.',
          }),
        ];
      }
      report._generation_provider = routed.provider;
      report._generation_model = routed.model;
      // Surface the routed leg's own telemetry so callers can report the
      // measured cost of a run, not just its outcome.
      report._generation_attempts = attempts;
      return { report, provider: routed.provider, model: routed.model };
    } catch (parseErr) {
      console.warn('[iq-full-report] routed LLM JSON parse failed, trying fallback:', parseErr);
    }
  }

  const client = getOpenAI();
  if (!client) {
    throw new Error(
      `No LLM provider produced a full report (${attemptLabel}) [${attemptSummary()}]`,
    );
  }

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: modelFull(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: lean ? 10_000 : 16_000,
    });
  } catch (e) {
    // Last-resort leg. Report why every routed provider failed too, otherwise
    // the surfaced error is only ever OpenAI's (typically a quota 429).
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`openai/${modelFull()}: ${msg.slice(0, 200)} [${attemptSummary()}]`);
  }

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error(`Empty OpenAI response (${attemptLabel}) [${attemptSummary()}]`);
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
  language?: Locale | string | null;
  /** Single-pass generation (no completeness/competitor regen) for serverless time limits. */
  leanGeneration?: boolean;
  /** Hard budget for the LLM call, from the pipeline deadline. */
  timeoutMs?: number;
}): Promise<IqReportWithGrounding> {
  const language = toLocale(input.language);
  // Ask only for as many output tokens as the remaining time can decode. The
  // rate is a property of the model: the lean path runs claude-sonnet-5
  // (~13ms/token), the quality path claude-opus-5 (~17ms/token).
  const msPerToken =
    input.leanGeneration === true ? MS_PER_TOKEN_FAST : MS_PER_TOKEN_DEEP;
  const startedAt = Date.now();
  const remainingMs = () =>
    input.timeoutMs ? Math.max(input.timeoutMs - (Date.now() - startedAt), 0) : undefined;
  const capForNow = () => {
    const left = remainingMs();
    return left === undefined ? undefined : outputTokenBudget(left, { msPerToken });
  };

  const whitelist = extractCompetitorWhitelist(input.marketData ?? null);
  console.log(
    `[iq-full-report] whitelist size=${whitelist.total} (google=${whitelist.countsBySource.google}, yelp=${whitelist.countsBySource.yelp}, brightdata=${whitelist.countsBySource.brightdata})`,
  );

  const runOnce = async (stricter: boolean) => {
    const prompts = buildPremiumPrompts(input, language, whitelist, {
      stricter,
      lean: input.leanGeneration === true,
    });
    // Re-derive on every attempt: a retry starts with whatever the first
    // generation left, not with the original budget.
    const { report } = await callProviderForFullReport(
      prompts.systemPrompt,
      prompts.userPrompt,
      stricter ? 'attempt-2' : 'attempt-1',
      language,
      input.leanGeneration === true,
      remainingMs(),
      capForNow(),
    );
    return applyCompetitorWhitelist(report, whitelist, language);
  };

  let grounded: IqReportWithGrounding;
  try {
    grounded = await runOnce(false);
  } catch (e) {
    console.error('[iq-full-report] primary generation failed:', e);
    // Keep the underlying provider message on the error: a bare sentinel makes
    // the failure indistinguishable from a timeout and unfixable from outside.
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`FULL_REPORT_GENERATION_FAILED: ${cause.slice(0, 300)}`);
  }
  let completeness = scoreFullReportCompleteness(grounded);
  const minScore = minCompletenessForPaidReport();

  // Each retry below is a full second generation. Nothing used to budget them,
  // which is how a professional run overran its window: one call fit, two did
  // not. Skip a retry outright when the time left cannot pay for it.
  const canRetry = () => {
    const left = remainingMs();
    return left === undefined || left >= GENERATION_MIN_BUDGET_MS;
  };

  if (
    !input.leanGeneration &&
    completeness < minScore &&
    shouldUseFullMarketContextForIqFull() &&
    canRetry()
  ) {
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

  if (!input.leanGeneration && shouldRetryForCompetitorGrounding(grounded, whitelist) && canRetry()) {
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
      pick(language, {
        en: `Competitor analysis is running in degraded mode: only ${whitelist.total} named competitor(s) were retrieved (threshold ${MIN_WHITELIST_FOR_GROUNDED_REPORT}).`,
        zh: `竞品分析处于降级模式：仅检索到 ${whitelist.total} 家具名竞品（阈值 ${MIN_WHITELIST_FOR_GROUNDED_REPORT} 家）。`,
        es: `El análisis de competidores se ejecuta en modo degradado: solo se recuperaron ${whitelist.total} competidor(es) con nombre (umbral ${MIN_WHITELIST_FOR_GROUNDED_REPORT}).`,
      }),
    ];
    if (typeof grounded.confidence !== 'string' || isHighConfidenceText(grounded.confidence)) {
      grounded.confidence = confidenceLabel('Low', language);
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
