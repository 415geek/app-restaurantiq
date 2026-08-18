/**
 * Xiaomi MiMo — OpenAI-compatible chat completions for IQ funnel.
 * @see https://api.xiaomimimo.com/v1
 */
import OpenAI from 'openai';

const MIMO_BASE_URL = process.env.MIMO_API_BASE?.trim() || 'https://api.xiaomimimo.com/v1';
/** Serverless budget is 300s total; a hung MiMo call must fail fast enough to leave room for the OpenAI fallback. */
const MIMO_TIMEOUT_MS = Number(process.env.MIMO_TIMEOUT_MS?.trim() || '') || 120_000;

export function getMimoClient(): OpenAI | null {
  const apiKey = process.env.MIMO_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: MIMO_BASE_URL, timeout: MIMO_TIMEOUT_MS, maxRetries: 0 });
}

export function parseJsonFromLlmText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const sliced = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (sliced && typeof sliced === 'object' && !Array.isArray(sliced)) {
        return sliced as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Filled in by runMimoJson so callers/probes can see what actually happened. */
export type MimoDiagnostic = {
  model?: string;
  maxTokens?: number;
  durationMs?: number;
  finishReason?: string | null;
  outputTokens?: number | null;
  textLength?: number;
  parsed?: 'ok' | 'failed';
  error?: string;
};

export async function runMimoJson(opts: {
  model: string;
  system: string;
  user: string;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Optional sink for call diagnostics — this client never throws. */
  diag?: MimoDiagnostic;
}): Promise<{ raw: Record<string, unknown>; model: string } | null> {
  const d = opts.diag;
  if (d) {
    d.model = opts.model;
    d.maxTokens = opts.maxTokens ?? 16_000;
  }
  const client = getMimoClient();
  if (!client) {
    if (d) d.error = 'MIMO_API_KEY not configured';
    return null;
  }
  const startedAt = Date.now();

  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    response_format: { type: 'json_object' },
    max_tokens: opts.maxTokens ?? 16_000,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.thinking !== undefined) {
    (body as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      extra_body?: { enable_thinking?: boolean };
    }).extra_body = { enable_thinking: opts.thinking };
  }

  try {
    const completion = await client.chat.completions.create(body);
    if (d) {
      d.durationMs = Date.now() - startedAt;
      d.finishReason = completion.choices[0]?.finish_reason ?? null;
      d.outputTokens = completion.usage?.completion_tokens ?? null;
    }

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      if (d) d.error = 'empty response content';
      return null;
    }
    if (d) d.textLength = text.length;
    const raw = parseJsonFromLlmText(text);
    if (!raw) {
      if (d) d.parsed = 'failed';
      return null;
    }
    if (d) d.parsed = 'ok';
    return { raw, model: opts.model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[mimo] chat completion failed:', msg.slice(0, 400));
    if (d) {
      d.durationMs = Date.now() - startedAt;
      d.error = msg.slice(0, 500);
    }
    return null;
  }
}
