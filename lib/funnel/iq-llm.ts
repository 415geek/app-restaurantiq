import OpenAI from 'openai';
import { z } from 'zod';

const partialSchema = z.object({
  verdict: z.string(),
  headline: z.string(),
  reason: z.string(),
});

const fullSchema = z.object({
  revenue_estimate: z.string().optional(),
  risks: z.array(z.string()).optional(),
  opportunities: z.array(z.string()).optional(),
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
  const secret = process.env.N8N_IQ_WEBHOOK_SECRET?.trim();
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
  reason: string;
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

  const outputLanguageInstruction =
    language === 'zh'
      ? 'Output language MUST be Simplified Chinese. Keep verdict in Chinese too.'
      : 'Output language MUST be English.';

  const prompt = `You are a brutally honest restaurant consultant.

Your job is to make a decision, not describe data.

Given a restaurant location and business type, decide:

1. Will this restaurant likely succeed, fail, or be risky?
2. Give one short emotional headline.
3. Give one concise reason.
4. Be direct and conversion-oriented.
5. ${outputLanguageInstruction}

Location: ${input.location}
Business type: ${input.businessType || 'Not specified'}

Return valid JSON only with keys: verdict, headline, reason.
Example shape: {"verdict":"risky","headline":"...","reason":"..."}`;

  const completion = await client.chat.completions.create({
    model: model(),
    messages: [{ role: 'user', content: prompt }],
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
}): Promise<Record<string, unknown>> {
  const n8nUrl = process.env.N8N_IQ_FULL_REPORT_WEBHOOK_URL?.trim();
  if (n8nUrl) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      location: input.location,
      businessType: input.businessType,
      partialHeadline: input.headline,
      partialReason: input.reason,
    });
    return fullSchema.parse(raw) as Record<string, unknown>;
  }

  const client = getOpenAI();
  if (!client) {
    throw new Error('Neither N8N_IQ_FULL_REPORT_WEBHOOK_URL nor OPENAI_API_KEY is configured');
  }

  const prompt = `You are a restaurant business expert.

Generate a premium restaurant decision report.

Focus only on actionable business insights.

Location: ${input.location}
Business type: ${input.businessType || 'Not specified'}
Partial verdict: ${input.headline}
Reason: ${input.reason}

Return valid JSON only with keys:
revenue_estimate (string),
risks (string array),
opportunities (string array),
action_plan (string array),
confidence ("Low" | "Medium" | "High").`;

  const completion = await client.chat.completions.create({
    model: model(),
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty OpenAI response');
  return fullSchema.parse(JSON.parse(text)) as Record<string, unknown>;
}
