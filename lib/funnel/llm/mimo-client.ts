/**
 * Xiaomi MiMo — OpenAI-compatible chat completions for IQ funnel.
 * @see https://api.xiaomimimo.com/v1
 */
import OpenAI from 'openai';

const MIMO_BASE_URL = process.env.MIMO_API_BASE?.trim() || 'https://api.xiaomimimo.com/v1';

export function getMimoClient(): OpenAI | null {
  const apiKey = process.env.MIMO_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: MIMO_BASE_URL });
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

export async function runMimoJson(opts: {
  model: string;
  system: string;
  user: string;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ raw: Record<string, unknown>; model: string } | null> {
  const client = getMimoClient();
  if (!client) return null;

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

    const text = completion.choices[0]?.message?.content;
    if (!text) return null;
    const raw = parseJsonFromLlmText(text);
    if (!raw) return null;
    return { raw, model: opts.model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[mimo] chat completion failed:', msg.slice(0, 400));
    return null;
  }
}
