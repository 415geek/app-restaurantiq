/**
 * IQ funnel LLM provider routing (primary + fallback).
 * Ops tasks use lib/server/llm/provider-json.ts — do not merge blindly.
 */
import OpenAI from 'openai';
import { runMimoJson, getMimoClient } from '@/lib/funnel/llm/mimo-client';

export type IqLlmProvider = 'openai' | 'mimo' | 'none';

export type IqLlmTask = 'iq_partial' | 'iq_full' | 'iq_competitor_insights' | 'iq_verify';

export type IqRouteResolution = {
  provider: IqLlmProvider;
  model: string;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
};

export type IqJsonRunResult<T extends Record<string, unknown>> = {
  data: T;
  provider: IqLlmProvider;
  model: string;
  warning?: string;
};

function envPrimary(): 'openai' | 'mimo' {
  const p = process.env.IQ_PRIMARY_PROVIDER?.trim().toLowerCase();
  if (p === 'mimo' && process.env.MIMO_API_KEY?.trim()) return 'mimo';
  return 'openai';
}

function openAiAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function routeConfig(task: IqLlmTask): {
  primary: { provider: 'openai' | 'mimo'; model: string; thinking?: boolean; maxTokens?: number };
  fallback: { provider: 'openai' | 'mimo'; model: string; thinking?: boolean; maxTokens?: number };
} {
  const primaryProvider = envPrimary();

  const partialModel =
    primaryProvider === 'mimo'
      ? process.env.MIMO_IQ_PARTIAL_MODEL?.trim() || 'mimo-v2-flash'
      : process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o-mini';

  const fullModel =
    primaryProvider === 'mimo'
      ? process.env.MIMO_IQ_FULL_MODEL?.trim() || 'mimo-v2.5-pro'
      : process.env.OPENAI_IQ_FULL_MODEL?.trim() ||
        process.env.OPENAI_IQ_MODEL?.trim() ||
        'gpt-4o';

  const verifyModel =
    process.env.MIMO_IQ_VERIFY_MODEL?.trim() ||
    process.env.MIMO_IQ_FULL_MODEL?.trim() ||
    'mimo-v2.5-pro';

  const openAiPartial = process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o-mini';
  const openAiFull =
    process.env.OPENAI_IQ_FULL_MODEL?.trim() ||
    process.env.OPENAI_IQ_MODEL?.trim() ||
    'gpt-4o';

  switch (task) {
    case 'iq_partial':
      return {
        primary: {
          provider: primaryProvider,
          model: partialModel,
          thinking: false,
          maxTokens: 4_096,
        },
        fallback: {
          provider: 'openai',
          model: openAiPartial,
          thinking: false,
          maxTokens: 4_096,
        },
      };
    case 'iq_full':
      return {
        primary: {
          provider: primaryProvider,
          model: fullModel,
          thinking: primaryProvider === 'mimo',
          maxTokens: 16_000,
        },
        fallback: {
          provider: 'openai',
          model: openAiFull,
          thinking: false,
          maxTokens: 16_000,
        },
      };
    case 'iq_verify':
      return {
        primary: {
          provider: process.env.MIMO_API_KEY?.trim() ? 'mimo' : 'openai',
          model: verifyModel,
          thinking: true,
          maxTokens: 8_000,
        },
        fallback: {
          provider: 'openai',
          model: openAiFull,
          thinking: false,
          maxTokens: 8_000,
        },
      };
    case 'iq_competitor_insights':
      return {
        primary: {
          provider: primaryProvider,
          model: process.env.MIMO_IQ_PARTIAL_MODEL?.trim() || 'mimo-v2-flash',
          thinking: false,
          maxTokens: 2_000,
        },
        fallback: {
          provider: 'openai',
          model: openAiPartial,
          thinking: false,
          maxTokens: 2_000,
        },
      };
    default:
      return {
        primary: { provider: 'openai', model: openAiFull },
        fallback: { provider: 'openai', model: openAiPartial },
      };
  }
}

/** Cross-provider verify route: opposite of primary when both keys exist (C-5). */
export function resolveIqCrossVerifyRoute(
  primaryProvider: IqLlmProvider,
): IqRouteResolution | null {
  const forced = process.env.IQ_VERIFY_PROVIDER?.trim().toLowerCase();
  if (forced === 'openai' || forced === 'mimo') {
    const model =
      forced === 'mimo'
        ? process.env.MIMO_IQ_VERIFY_MODEL?.trim() ||
          process.env.MIMO_IQ_FULL_MODEL?.trim() ||
          'mimo-v2.5-pro'
        : process.env.OPENAI_IQ_FULL_MODEL?.trim() ||
          process.env.OPENAI_IQ_MODEL?.trim() ||
          'gpt-4o';
    if (forced === 'mimo' && !getMimoClient()) return null;
    if (forced === 'openai' && !openAiAvailable()) return null;
    return {
      provider: forced,
      model,
      thinking: forced === 'mimo',
      maxTokens: 8_000,
      temperature: 0.15,
    };
  }

  const opposite: IqLlmProvider | null =
    primaryProvider === 'mimo' && openAiAvailable()
      ? 'openai'
      : primaryProvider === 'openai' && getMimoClient()
        ? 'mimo'
        : null;

  if (!opposite) {
    return resolveIqRoute('iq_verify', false);
  }

  const model =
    opposite === 'mimo'
      ? process.env.MIMO_IQ_VERIFY_MODEL?.trim() ||
        process.env.MIMO_IQ_FULL_MODEL?.trim() ||
        'mimo-v2.5-pro'
      : process.env.OPENAI_IQ_FULL_MODEL?.trim() ||
        process.env.OPENAI_IQ_MODEL?.trim() ||
        'gpt-4o';

  return {
    provider: opposite,
    model,
    thinking: opposite === 'mimo',
    maxTokens: 8_000,
    temperature: 0.15,
  };
}

/** Resolve which provider/model to try first for a task. */
export function resolveIqRoute(task: IqLlmTask, useFallback = false): IqRouteResolution | null {
  const cfg = routeConfig(task);
  const pick = useFallback ? cfg.fallback : cfg.primary;

  if (pick.provider === 'mimo' && !getMimoClient()) {
    if (!useFallback && openAiAvailable()) {
      return resolveIqRoute(task, true);
    }
    return null;
  }
  if (pick.provider === 'openai' && !openAiAvailable()) {
    if (!useFallback && getMimoClient()) {
      return resolveIqRoute(task, true);
    }
    return null;
  }

  return {
    provider: pick.provider,
    model: pick.model,
    thinking: pick.thinking,
    maxTokens: pick.maxTokens,
    temperature: task === 'iq_full' ? 0.2 : 0.25,
  };
}

/** Whether paid report prompts should inject full marketData (MiMo 1M path). */
export function shouldUseFullMarketContextForIqFull(): boolean {
  const route = resolveIqRoute('iq_full');
  return route?.provider === 'mimo';
}

async function runOpenAiJson(
  route: IqRouteResolution,
  system: string,
  user: string,
): Promise<Record<string, unknown> | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const client = new OpenAI({ apiKey: key });
    const completion = await client.chat.completions.create({
      model: route.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: route.maxTokens ?? 16_000,
      temperature: route.temperature ?? 0.2,
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) return null;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      }
      return null;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[iq-openai] chat completion failed:', msg.slice(0, 400));
    return null;
  }
}

/**
 * Run structured JSON generation for an IQ task with primary → fallback routing.
 */
export async function runIqProviderJson<T extends Record<string, unknown>>(opts: {
  task: IqLlmTask;
  system: string;
  user: string;
}): Promise<IqJsonRunResult<T> | null> {
  const primary = resolveIqRoute(opts.task, false);
  if (!primary) return null;

  let warning: string | undefined;

  const tryRun = async (route: IqRouteResolution): Promise<Record<string, unknown> | null> => {
    try {
      if (route.provider === 'mimo') {
        const out = await runMimoJson({
          model: route.model,
          system: opts.system,
          user: opts.user,
          thinking: route.thinking,
          maxTokens: route.maxTokens,
          temperature: route.temperature,
        });
        return out?.raw ?? null;
      }
      return runOpenAiJson(route, opts.system, opts.user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[iq-provider] ${route.provider}/${route.model} threw:`, msg.slice(0, 400));
      return null;
    }
  };

  let raw = await tryRun(primary);
  let used = primary;

  if (!raw) {
    const fb = resolveIqRoute(opts.task, true);
    if (fb && (fb.provider !== primary.provider || fb.model !== primary.model)) {
      raw = await tryRun(fb);
      if (raw) {
        warning = `Primary ${primary.provider}/${primary.model} failed; used fallback ${fb.provider}/${fb.model}.`;
        used = fb;
      }
    }
  }

  if (!raw) return null;

  return {
    data: raw as T,
    provider: used.provider,
    model: used.model,
    warning,
  };
}

/** Run JSON generation on an explicit route (e.g. cross-provider verify). */
export async function runIqProviderJsonOnRoute<T extends Record<string, unknown>>(opts: {
  route: IqRouteResolution;
  system: string;
  user: string;
}): Promise<IqJsonRunResult<T> | null> {
  const tryRun = async (route: IqRouteResolution): Promise<Record<string, unknown> | null> => {
    try {
      if (route.provider === 'mimo') {
        const out = await runMimoJson({
          model: route.model,
          system: opts.system,
          user: opts.user,
          thinking: route.thinking,
          maxTokens: route.maxTokens,
          temperature: route.temperature,
        });
        return out?.raw ?? null;
      }
      return runOpenAiJson(route, opts.system, opts.user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[iq-provider] ${route.provider}/${route.model} threw:`, msg.slice(0, 400));
      return null;
    }
  };

  const raw = await tryRun(opts.route);
  if (!raw) return null;

  return {
    data: raw as T,
    provider: opts.route.provider,
    model: opts.route.model,
  };
}

/** Internal telemetry only — does not append provider/model names to user-facing disclaimer. */
export function appendLlmProviderToDisclaimer(
  report: Record<string, unknown>,
  meta: { provider: string; model: string; task: IqLlmTask },
  _lang: 'en' | 'zh',
): void {
  report._generation_provider = meta.provider;
  report._generation_model = meta.model;
  report._generation_task = meta.task;
}
