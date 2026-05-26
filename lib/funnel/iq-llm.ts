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
import { parseIqFullReport } from '@/lib/funnel/iq-full-report-schema';
import { buildPremiumMarketDataSection } from '@/lib/funnel/iq-premium-anchors';
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

/**
 * OpenAI-only paid full report (used when n8n is off or after n8n failure).
 * For production entry, use `generateIqFullReportWithN8nFallback` from iq-generate-full-report.ts.
 */
export async function runFullPremiumReportOpenAI(input: {
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData?: Record<string, unknown>;
  language?: 'en' | 'zh';
}): Promise<Record<string, unknown>> {
  const language = input.language === 'zh' ? 'zh' : 'en';
  const client = getOpenAI();
  if (!client) {
    throw new Error('OPENAI_API_KEY is not configured (required for full report when n8n is unavailable)');
  }

  const marketDataSection = buildPremiumMarketDataSection(input.marketData ?? null, language);

  const systemPrompt = language === 'zh' ? locationIqV2PremiumSystemZh() : locationIqV2PremiumSystemEn();

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
  if (!text) throw new Error('Empty OpenAI response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('OpenAI full report was not valid JSON');
  }
  return parseIqFullReport(parsed);
}
