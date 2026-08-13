import { z } from 'zod';
import { completeJson, hasAnyLlmKey } from '@/lib/funnel/agents/llm';
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
import { parseIqFullReport } from '@/lib/funnel/iq-full-report-schema';
import { buildPremiumMarketDataSection } from '@/lib/funnel/iq-premium-anchors';

const partialSchema = z.object({
  verdict: z.string(),
  headline: z.string(),
  subheadline: z.string().optional(),
  market_snapshot: z.array(z.string()).optional(),
  hidden_risk: z.string().optional(),
  paywall_teaser: z.string().optional(),
  reason: z.string().optional(),
});

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
}): Promise<{
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
  reason?: string;
}> {
  const language = input.language === 'zh' ? 'zh' : 'en';
  // n8n only when no direct LLM key exists — otherwise callers falling back here
  // after an n8n failure would loop straight back into the failing webhook.
  const n8nUrl = process.env.N8N_IQ_ANALYZE_WEBHOOK_URL?.trim();
  if (n8nUrl && !hasAnyLlmKey()) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      location: input.location,
      businessType: input.businessType || null,
      language,
    });
    return partialSchema.parse(raw);
  }

  if (!hasAnyLlmKey()) {
    throw new Error(
      'No LLM provider configured: set ANTHROPIC_API_KEY (preferred), OPENAI_API_KEY, or N8N_IQ_ANALYZE_WEBHOOK_URL',
    );
  }

  const systemPrompt = language === 'zh' ? locationIqV2FreeSystemZh() : locationIqV2FreeSystemEn();

  const userPrompt =
    language === 'zh'
      ? locationIqV2FreeUserZh({
          location: input.location,
          businessType: input.businessType || '餐饮',
          marketDataBrief: input.marketDataBrief,
        })
      : locationIqV2FreeUserEn({
          location: input.location,
          businessType: input.businessType || 'Restaurant',
          marketDataBrief: input.marketDataBrief,
        });

  const raw = await completeJson({
    system: systemPrompt,
    user: userPrompt,
    tier: 'agent',
    maxTokens: 6_000,
  });
  return partialSchema.parse(raw);
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
  if (!hasAnyLlmKey()) {
    throw new Error(
      'No LLM provider configured (ANTHROPIC_API_KEY or OPENAI_API_KEY required for full report when n8n is unavailable)',
    );
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

  const parsed = await completeJson({
    system: systemPrompt,
    user: userPrompt,
    tier: 'full',
    maxTokens: 16_000,
  });
  return parseIqFullReport(parsed);
}
