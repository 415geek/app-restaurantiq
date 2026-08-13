/**
 * Provider-agnostic JSON completion for the analysis engine.
 *
 * Claude (Anthropic) is the primary provider when ANTHROPIC_API_KEY is set;
 * OpenAI remains as fallback so existing deployments keep working. Force with
 * IQ_LLM_PROVIDER=anthropic|openai.
 *
 * All engine prompts already demand strict JSON output; this layer adds
 * fence-stripping and one repair retry, and callers validate with zod.
 * (Structured outputs via output_config.format are not used here because
 * specialist payloads are free-form records, which the JSON-schema subset
 * cannot express — additionalProperties must be false.)
 *
 * Claude notes:
 * - Thinking is on by default on claude-opus-5; max_tokens caps thinking +
 *   response together, so budgets below include headroom.
 * - stop_reason "refusal" is a normal HTTP 200 — checked before reading text.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type LlmTier = 'agent' | 'full' | 'critic';

type Provider = 'anthropic' | 'openai';

function provider(): Provider {
  const forced = process.env.IQ_LLM_PROVIDER?.trim().toLowerCase();
  if (forced === 'anthropic' || forced === 'openai') return forced;
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'anthropic';
  return 'openai';
}

export function hasAnyLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

function anthropicModel(tier: LlmTier): string {
  const base = process.env.ANTHROPIC_IQ_MODEL?.trim() || 'claude-opus-5';
  if (tier === 'agent') return process.env.ANTHROPIC_IQ_AGENT_MODEL?.trim() || base;
  if (tier === 'full') return process.env.ANTHROPIC_IQ_FULL_MODEL?.trim() || base;
  return process.env.ANTHROPIC_IQ_AGENT_MODEL?.trim() || base;
}

function openaiModel(tier: LlmTier): string {
  if (tier === 'full') {
    return process.env.OPENAI_IQ_FULL_MODEL?.trim() || process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o';
  }
  return (
    process.env.OPENAI_IQ_AGENT_MODEL?.trim() ||
    process.env.OPENAI_IQ_MODEL?.trim() ||
    'gpt-4o-mini'
  );
}

/** Strip markdown fences and any prose around the outermost JSON object. */
function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  if (!t.startsWith('{')) {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  return t;
}

async function completeAnthropic(input: {
  system: string;
  user: string;
  tier: LlmTier;
  maxTokens: number;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: anthropicModel(input.tier),
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Claude declined the request (refusal${response.stop_details?.category ? `: ${response.stop_details.category}` : ''})`,
    );
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('Empty Claude response');
  return text;
}

async function completeOpenAi(input: {
  system: string;
  user: string;
  tier: LlmTier;
  maxTokens: number;
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  const client = new OpenAI({ apiKey: key });
  const completion = await client.chat.completions.create({
    model: openaiModel(input.tier),
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: input.maxTokens,
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty OpenAI response');
  return text;
}

/**
 * Run a system+user prompt and return the parsed JSON object.
 * One repair retry on parse failure (asks the model to re-emit valid JSON).
 */
export async function completeJson(input: {
  system: string;
  user: string;
  tier: LlmTier;
  maxTokens?: number;
}): Promise<unknown> {
  const maxTokens = input.maxTokens ?? (input.tier === 'full' ? 16_000 : input.tier === 'critic' ? 4_000 : 12_000);
  const run = provider() === 'anthropic' ? completeAnthropic : completeOpenAi;

  const text = await run({ ...input, maxTokens });
  try {
    return JSON.parse(extractJson(text));
  } catch {
    console.warn('[iq-llm] JSON parse failed, running one repair retry');
    const repaired = await run({
      system: input.system,
      user: `${input.user}\n\nYour previous reply was not valid JSON. Re-emit the COMPLETE answer as a single valid JSON object, with no markdown fences and no text outside the JSON.`,
      tier: input.tier,
      maxTokens,
    });
    return JSON.parse(extractJson(repaired));
  }
}
