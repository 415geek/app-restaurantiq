/**
 * Anthropic Claude — JSON generation for the IQ funnel.
 * Claude Opus 5 (`claude-opus-5`): adaptive thinking is on by default and
 * counts toward max_tokens; depth is controlled via output_config.effort.
 */
import Anthropic from '@anthropic-ai/sdk';

import { parseJsonFromLlmText } from '@/lib/funnel/llm/mimo-client';

/** Serverless budget is 300s total; a hung call must fail fast enough for fallbacks. */
const ANTHROPIC_TIMEOUT_MS =
  Number(process.env.ANTHROPIC_TIMEOUT_MS?.trim() || '') || 120_000;

export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey, timeout: ANTHROPIC_TIMEOUT_MS, maxRetries: 1 });
}

export function anthropicAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export type AnthropicEffort = 'low' | 'medium' | 'high';

export async function runAnthropicJson(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Thinking/output depth. Lean paths use 'low'; quality regen uses 'high'. */
  effort?: AnthropicEffort;
}): Promise<{ raw: Record<string, unknown>; model: string } | null> {
  const client = getAnthropicClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16_000,
      system:
        opts.system +
        '\n\nOutput ONLY a single valid JSON object. No prose, no markdown fences, no comments before or after the JSON.',
      messages: [{ role: 'user', content: opts.user }],
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
    });

    if (response.stop_reason === 'refusal') {
      console.warn('[anthropic] request refused by safety classifiers');
      return null;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text) return null;

    const raw = parseJsonFromLlmText(text);
    if (!raw) return null;
    return { raw, model: opts.model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[anthropic] messages.create failed:', msg.slice(0, 400));
    return null;
  }
}
