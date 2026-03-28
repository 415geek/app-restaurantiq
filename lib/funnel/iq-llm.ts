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

const partialSchema = z.object({
  verdict: z.string(),
  headline: z.string(),
  subheadline: z.string().optional(),
  market_snapshot: z.array(z.string()).optional(),
  hidden_risk: z.string().optional(),
  paywall_teaser: z.string().optional(),
  reason: z.string().optional(),
});

const fullSchema = z.object({
  executive_summary: z.string().optional(),
  final_verdict: z.string().optional(),
  trade_area_analysis: z.string().optional(),
  demographic_profile: z.string().optional(),
  competition_landscape: z.string().optional(),
  revenue_estimate: z.string().optional(),
  risks: z.array(z.string()).optional(),
  opportunities: z.array(z.string()).optional(),
  failure_scenarios: z.array(z.string()).optional(),
  differentiation_strategy: z.string().optional(),
  action_plan: z.array(z.string()).optional(),
  confidence: z.string().optional(),
});

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function model() {
  return process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o-mini';
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
  const n8nUrl = process.env.N8N_IQ_ANALYZE_WEBHOOK_URL?.trim();
  if (n8nUrl) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      location: input.location,
      businessType: input.businessType || null,
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
        })
      : locationIqV2FreeUserEn({
          location: input.location,
          businessType: input.businessType || 'Restaurant',
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
  return partialSchema.parse(JSON.parse(text));
}

export async function runFullReport(input: {
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData?: Record<string, unknown>;
  language?: 'en' | 'zh';
}): Promise<Record<string, unknown>> {
  const language = input.language === 'zh' ? 'zh' : 'en';
  const n8nUrl = process.env.N8N_IQ_FULL_REPORT_WEBHOOK_URL?.trim();
  if (n8nUrl) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      address: input.location,
      industry: 'restaurant',
      cuisine_type: input.businessType ?? '',
      headline: input.headline,
      reason: input.reason,
      market_data: input.marketData,
      language,
    });
    return fullSchema.parse(raw) as Record<string, unknown>;
  }

  const client = getOpenAI();
  if (!client) {
    throw new Error('Neither N8N_IQ_FULL_REPORT_WEBHOOK_URL nor OPENAI_API_KEY is configured');
  }

  const marketDataSection = input.marketData
    ? language === 'zh'
      ? `\n\n市场数据 (来自 Google Places + Yelp):\n${JSON.stringify(input.marketData, null, 2)}`
      : `\n\nMARKET DATA (from Google Places + Yelp):\n${JSON.stringify(input.marketData, null, 2)}`
    : '';

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
    model: model(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty OpenAI response');
  return fullSchema.parse(JSON.parse(text)) as Record<string, unknown>;
}
