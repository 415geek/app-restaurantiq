/**
 * Anthropic Claude — JSON generation for the IQ funnel.
 * Claude Opus 5 (`claude-opus-5`): adaptive thinking is on by default and
 * counts toward max_tokens; depth is controlled via output_config.effort.
 */
import Anthropic from '@anthropic-ai/sdk';

import { parseJsonFromLlmText } from '@/lib/funnel/llm/mimo-client';
import { repairTruncatedJson } from '@/lib/funnel/llm/json-repair';

/**
 * Full-report JSON runs 6-10K output tokens, which takes minutes on Opus-tier
 * models — a single non-streaming call would be killed by a short client
 * timeout before finishing. We stream (so generation is never cut off by a
 * fixed request timeout) and cap the whole call at this budget, sized to fit
 * inside the route's 300s serverless limit. No auto-retry: a second attempt
 * could never finish within the remaining budget anyway.
 */
const ANTHROPIC_TIMEOUT_MS =
  Number(process.env.ANTHROPIC_TIMEOUT_MS?.trim() || '') || 240_000;

export function getAnthropicClient(timeoutMs?: number): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({
    apiKey,
    timeout: timeoutMs && timeoutMs > 0 ? timeoutMs : ANTHROPIC_TIMEOUT_MS,
    maxRetries: 0,
  });
}

export function anthropicAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export type AnthropicEffort = 'low' | 'medium' | 'high';

/** Filled in by runAnthropicJson so callers/probes can see what actually happened. */
export type AnthropicDiagnostic = {
  model?: string;
  maxTokens?: number;
  effort?: string;
  thinking?: 'on' | 'off';
  durationMs?: number;
  stopReason?: string | null;
  outputTokens?: number | null;
  textLength?: number;
  parsed?: 'ok' | 'repaired' | 'failed';
  error?: string;
};

export async function runAnthropicJson(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Thinking/output depth. Lean paths use 'low'; quality regen uses 'high'. */
  effort?: AnthropicEffort;
  /**
   * Disable extended thinking. Claude Opus 5 thinks by default and those tokens
   * count toward max_tokens, which is the dominant latency cost on the fast
   * path. Only valid at effort 'high' or lower (xhigh/max reject it).
   */
  disableThinking?: boolean;
  /** Hard per-call budget from the pipeline deadline. */
  timeoutMs?: number;
  /** Optional sink for call diagnostics (health probe / debugging). */
  diag?: AnthropicDiagnostic;
}): Promise<{ raw: Record<string, unknown>; model: string } | null> {
  const d = opts.diag;
  if (d) {
    d.model = opts.model;
    d.maxTokens = opts.maxTokens ?? 16_000;
    d.effort = opts.effort ?? 'default';
    d.thinking = opts.disableThinking ? 'off' : 'on';
  }
  const client = getAnthropicClient(opts.timeoutMs);
  if (!client) {
    if (d) d.error = 'ANTHROPIC_API_KEY not configured';
    return null;
  }

  const startedAt = Date.now();
  try {
    const stream = client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16_000,
      system:
        opts.system +
        '\n\nOutput ONLY a single valid JSON object. No prose, no markdown fences, no comments before or after the JSON. Do not include internal or system XML tags in your response.',
      messages: [{ role: 'user', content: opts.user }],
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      ...(opts.disableThinking ? { thinking: { type: 'disabled' as const } } : {}),
    });
    const response = await stream.finalMessage();
    if (d) {
      d.durationMs = Date.now() - startedAt;
      d.stopReason = response.stop_reason ?? null;
      d.outputTokens = response.usage?.output_tokens ?? null;
    }
    console.log(
      `[anthropic] ${opts.model} effort=${opts.effort ?? 'default'} thinking=${
        opts.disableThinking ? 'off' : 'on'
      } took ${Math.round((Date.now() - startedAt) / 1000)}s out=${
        response.usage?.output_tokens ?? '?'
      }`,
    );

    if (response.stop_reason === 'refusal') {
      console.warn('[anthropic] request refused by safety classifiers');
      return null;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text) return null;

    if (d) d.textLength = text.length;

    const raw = parseJsonFromLlmText(text);
    if (raw) {
      if (d) d.parsed = 'ok';
      return { raw, model: opts.model };
    }

    // Hitting max_tokens truncates the JSON mid-object. Salvage the sections
    // the model did finish rather than failing the whole report.
    if (response.stop_reason === 'max_tokens') {
      const repaired = repairTruncatedJson(text);
      console.warn(
        `[anthropic] output truncated at max_tokens (${opts.maxTokens ?? 16_000}); ` +
          (repaired ? 'recovered partial JSON' : 'could not recover JSON'),
      );
      if (repaired) {
        if (d) d.parsed = 'repaired';
        return { raw: repaired, model: opts.model };
      }
    } else {
      console.warn('[anthropic] response was not parseable JSON');
    }
    if (d) d.parsed = 'failed';
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[anthropic] messages.create failed:', msg.slice(0, 400));
    if (d) {
      d.durationMs = Date.now() - startedAt;
      d.error = msg.slice(0, 500);
    }
    return null;
  }
}
