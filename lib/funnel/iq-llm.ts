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
  shouldRetryForCompetitorGrounding,
  type IqReportWithGrounding,
} from '@/lib/funnel/iq-full-report-schema';
import { buildPremiumMarketDataSection } from '@/lib/funnel/iq-premium-anchors';
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

  const completion = await client.chat.completions.create({
    model: model(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty OpenAI response');
  const parsed = partialSchema.parse(JSON.parse(text));
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

  const marketDataSection =
    buildPremiumMarketDataSection(input.marketData ?? null, language) +
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

async function callOpenAiForFullReport(
  client: OpenAI,
  systemPrompt: string,
  userPrompt: string,
  attemptLabel: string,
): Promise<Record<string, unknown>> {
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
  return parseIqFullReport(parsed);
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
export async function runFullPremiumReportOpenAI(input: {
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData?: Record<string, unknown>;
  language?: 'en' | 'zh';
}): Promise<IqReportWithGrounding> {
  const language = input.language === 'zh' ? 'zh' : 'en';
  const client = getOpenAI();
  if (!client) {
    throw new Error('OPENAI_API_KEY is not configured (required for full report when n8n is unavailable)');
  }

  const whitelist = extractCompetitorWhitelist(input.marketData ?? null);
  console.log(
    `[iq-full-report] whitelist size=${whitelist.total} (google=${whitelist.countsBySource.google}, yelp=${whitelist.countsBySource.yelp}, brightdata=${whitelist.countsBySource.brightdata})`,
  );

  // First attempt.
  const first = buildPremiumPrompts(input, language, whitelist);
  const firstReport = await callOpenAiForFullReport(client, first.systemPrompt, first.userPrompt, 'attempt-1');
  let grounded = applyCompetitorWhitelist(firstReport, whitelist);

  if (shouldRetryForCompetitorGrounding(grounded, whitelist)) {
    const droppedCount = grounded._dropped_competitor_names?.length ?? 0;
    console.warn(
      `[iq-full-report] retrying due to ${droppedCount} hallucinated competitor(s); whitelist had ${whitelist.total}`,
    );
    try {
      const retry = buildPremiumPrompts(input, language, whitelist, { stricter: true });
      const retryReport = await callOpenAiForFullReport(
        client,
        retry.systemPrompt,
        retry.userPrompt,
        'attempt-2',
      );
      const retryGrounded = applyCompetitorWhitelist(retryReport, whitelist);
      const retryKept = Array.isArray(retryGrounded.competitors) ? retryGrounded.competitors.length : 0;
      const firstKept = Array.isArray(grounded.competitors) ? grounded.competitors.length : 0;
      // Keep whichever has more grounded competitors (and fewer drops as tie-break).
      if (
        retryKept > firstKept ||
        (retryKept === firstKept &&
          (retryGrounded._dropped_competitor_names?.length ?? 0) <
            (grounded._dropped_competitor_names?.length ?? 0))
      ) {
        grounded = retryGrounded;
      }
    } catch (e) {
      console.warn('[iq-full-report] retry attempt failed, keeping first attempt result:', e);
    }
  }

  // Degrade gracefully when whitelist is too thin: stamp warning + low-confidence
  // but still return the report so the UI can show the rest of the analysis.
  if (whitelist.total < MIN_WHITELIST_FOR_GROUNDED_REPORT) {
    const existing = Array.isArray(grounded._warnings) ? grounded._warnings : [];
    grounded._warnings = [
      ...existing,
      `Competitor analysis runs in degraded mode: only ${whitelist.total} named competitor(s) were retrieved (threshold ${MIN_WHITELIST_FOR_GROUNDED_REPORT}).`,
    ];
    if (typeof grounded.confidence === 'string') {
      // Don't upgrade confidence; only downgrade if the LLM claimed High.
      if (/high/i.test(grounded.confidence)) grounded.confidence = 'Low';
    } else {
      grounded.confidence = 'Low';
    }
  }

  return grounded;
}
