/**
 * IQ funnel LLM provider routing (primary + fallback).
 * Ops tasks use lib/server/llm/provider-json.ts — do not merge blindly.
 */
import OpenAI from 'openai';
import { runMimoJson, getMimoClient } from '@/lib/funnel/llm/mimo-client';
import { anthropicAvailable, runAnthropicJson } from '@/lib/funnel/llm/anthropic-client';
import type { AnthropicDiagnostic } from '@/lib/funnel/llm/anthropic-client';
import type { MimoDiagnostic } from '@/lib/funnel/llm/mimo-client';

export type IqLlmProvider = 'openai' | 'mimo' | 'anthropic' | 'none';

export type IqLlmTask = 'iq_partial' | 'iq_full' | 'iq_competitor_insights' | 'iq_verify';

export type IqRouteResolution = {
  provider: IqLlmProvider;
  model: string;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Claude only: output_config.effort (thinking/output depth). */
  effort?: 'low' | 'medium' | 'high';
  /** Claude only: turn extended thinking off (fast path). */
  disableThinking?: boolean;
};

export type IqJsonRunResult<T extends Record<string, unknown>> = {
  data: T;
  provider: IqLlmProvider;
  model: string;
  warning?: string;
};

/** Why each routed leg produced nothing — the router itself never throws. */
export type IqRouteAttempt = {
  provider: IqLlmProvider;
  model: string;
  ok: boolean;
  reason?: string;
};

function envPrimary(): 'openai' | 'mimo' | 'anthropic' {
  const p = process.env.IQ_PRIMARY_PROVIDER?.trim().toLowerCase();
  if (p === 'anthropic' && anthropicAvailable()) return 'anthropic';
  if (p === 'mimo' && process.env.MIMO_API_KEY?.trim()) return 'mimo';
  if (p === 'openai' && openAiAvailable()) return 'openai';
  // Default: Claude first when configured, then the legacy OpenAI default.
  if (anthropicAvailable()) return 'anthropic';
  return 'openai';
}

function openAiAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

type ConfiguredProvider = 'openai' | 'mimo' | 'anthropic';

type RouteLeg = {
  provider: ConfiguredProvider;
  model: string;
  thinking?: boolean;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  disableThinking?: boolean;
};

/**
 * Retired MiMo model ids. The API answers `400 Unsupported model` for these,
 * which failed the whole leg instantly — so a stale env var pointing at one is
 * treated as unset rather than propagated. Callable ids are listed by
 * /api/health?probe=iq-mimo-models.
 */
const RETIRED_MIMO_MODELS = new Set(['mimo-v2-flash', 'mimo-v2', 'mimo-v2-pro']);

function mimoModel(configured: string | undefined, fallback: string): string {
  const id = configured?.trim();
  if (!id || RETIRED_MIMO_MODELS.has(id)) return fallback;
  return id;
}

function modelFor(provider: ConfiguredProvider, kind: 'partial' | 'full' | 'verify'): string {
  if (provider === 'anthropic') {
    if (kind === 'partial') {
      return process.env.ANTHROPIC_IQ_PARTIAL_MODEL?.trim() || 'claude-opus-5';
    }
    return (
      (kind === 'verify' ? process.env.ANTHROPIC_IQ_VERIFY_MODEL?.trim() : undefined) ||
      process.env.ANTHROPIC_IQ_FULL_MODEL?.trim() ||
      'claude-opus-5'
    );
  }
  if (provider === 'mimo') {
    if (kind === 'partial') return mimoModel(process.env.MIMO_IQ_PARTIAL_MODEL, 'mimo-v2.5');
    return mimoModel(
      (kind === 'verify' ? process.env.MIMO_IQ_VERIFY_MODEL : undefined) ||
        process.env.MIMO_IQ_FULL_MODEL,
      'mimo-v2.5-pro',
    );
  }
  if (kind === 'partial') return process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o-mini';
  return (
    process.env.OPENAI_IQ_FULL_MODEL?.trim() || process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o'
  );
}

/**
 * Claude's thinking counts toward max_tokens — give its routes extra headroom,
 * but cap at 16K: generation time scales with output budget and the paid
 * report must finish inside the 300s serverless window.
 */
function budgetFor(provider: ConfiguredProvider, base: number): number {
  return provider === 'anthropic'
    ? Math.min(Math.max(base, Math.round(base * 1.5)), 16_000)
    : base;
}

function fallbackProviderFor(primary: ConfiguredProvider): ConfiguredProvider {
  // MiMo before OpenAI: OpenAI is the account most likely to be out of credit,
  // and a fallback that 429s immediately is no fallback at all.
  if (primary === 'anthropic') return getMimoClient() ? 'mimo' : 'openai';
  return anthropicAvailable() ? 'anthropic' : primary === 'openai' ? 'mimo' : 'openai';
}

function routeConfig(task: IqLlmTask): { primary: RouteLeg; fallback: RouteLeg } {
  const primaryProvider = envPrimary();
  const fallbackProvider = fallbackProviderFor(primaryProvider);

  const leg = (
    provider: ConfiguredProvider,
    kind: 'partial' | 'full' | 'verify',
    base: number,
    opts: { thinking?: boolean; effort?: 'low' | 'medium' | 'high' } = {},
  ): RouteLeg => ({
    provider,
    model: modelFor(provider, kind),
    thinking: provider === 'mimo' ? (opts.thinking ?? false) : false,
    maxTokens: budgetFor(provider, base),
    effort: opts.effort,
  });

  switch (task) {
    case 'iq_partial':
      return {
        primary: leg(primaryProvider, 'partial', 4_096, { effort: 'low' }),
        fallback: leg(fallbackProvider, 'partial', 4_096, { effort: 'low' }),
      };
    case 'iq_full': {
      const fullThinking =
        primaryProvider === 'mimo' &&
        /^(1|true|yes|on)$/i.test(process.env.MIMO_IQ_FULL_THINKING?.trim() ?? '');
      // Claude Opus 5 at medium ≈ prior-generation high, at much lower latency —
      // the quality path must still fit the 300s serverless budget.
      return {
        primary: leg(primaryProvider, 'full', 16_000, { thinking: fullThinking, effort: 'medium' }),
        fallback: leg(fallbackProvider, 'full', 16_000, { effort: 'medium' }),
      };
    }
    case 'iq_verify':
      return {
        primary: leg(primaryProvider, 'verify', 8_000, { thinking: true, effort: 'medium' }),
        fallback: leg(fallbackProvider, 'verify', 8_000, { effort: 'medium' }),
      };
    case 'iq_competitor_insights':
      return {
        primary: leg(primaryProvider, 'partial', 2_000, { effort: 'low' }),
        fallback: leg(fallbackProvider, 'partial', 2_000, { effort: 'low' }),
      };
    default:
      return {
        primary: leg(primaryProvider, 'full', 8_000),
        fallback: leg(fallbackProvider, 'partial', 8_000),
      };
  }
}

function providerAvailable(provider: IqLlmProvider): boolean {
  if (provider === 'anthropic') return anthropicAvailable();
  if (provider === 'mimo') return Boolean(getMimoClient());
  if (provider === 'openai') return openAiAvailable();
  return false;
}

/** Cross-provider verify route: opposite of primary when both keys exist (C-5). */
export function resolveIqCrossVerifyRoute(
  primaryProvider: IqLlmProvider,
): IqRouteResolution | null {
  const forced = process.env.IQ_VERIFY_PROVIDER?.trim().toLowerCase();
  if (forced === 'openai' || forced === 'mimo' || forced === 'anthropic') {
    if (!providerAvailable(forced)) return null;
    return {
      provider: forced,
      model: modelFor(forced, 'verify'),
      thinking: forced === 'mimo',
      maxTokens: budgetFor(forced, 8_000),
      effort: 'medium',
      temperature: 0.15,
    };
  }

  // Cross-verify with a different provider than the one that generated the report.
  const candidates: ConfiguredProvider[] = ['anthropic', 'openai', 'mimo'];
  const opposite =
    candidates.find((p) => p !== primaryProvider && providerAvailable(p)) ?? null;

  if (!opposite) {
    return resolveIqRoute('iq_verify', false);
  }

  const model = modelFor(opposite, 'verify');

  return {
    provider: opposite,
    model,
    thinking: opposite === 'mimo',
    maxTokens: budgetFor(opposite, 8_000),
    effort: 'medium',
    temperature: 0.15,
  };
}

/** Resolve which provider/model to try first for a task. */
export function resolveIqRoute(task: IqLlmTask, useFallback = false): IqRouteResolution | null {
  const cfg = routeConfig(task);
  const pick = useFallback ? cfg.fallback : cfg.primary;

  if (!providerAvailable(pick.provider)) {
    if (!useFallback) {
      return resolveIqRoute(task, true);
    }
    return null;
  }

  return {
    provider: pick.provider,
    model: pick.model,
    thinking: pick.thinking,
    maxTokens: pick.maxTokens,
    effort: pick.effort,
    disableThinking: pick.disableThinking,
    temperature: task === 'iq_full' ? 0.2 : 0.25,
  };
}

/**
 * Resolve a route exactly as runIqProviderJson would, including the fast-model
 * override. Probes and diagnostics must go through this rather than repeating
 * model literals — a duplicated default is what kept the dead `mimo-v2-flash`
 * alive in the health probe after the router had already been fixed.
 */
export function resolveIqRouteResolved(
  task: IqLlmTask,
  opts: { useFallback?: boolean; fastModel?: boolean } = {},
): IqRouteResolution | null {
  const route = resolveIqRoute(task, opts.useFallback ?? false);
  if (!route) return null;
  return opts.fastModel ? applyFastModelOverride(route) : route;
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
    const client = new OpenAI({ apiKey: key, timeout: 120_000, maxRetries: 1 });
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

/** Speed-optimized route for browser-triggered lean generation: fast model, no thinking, tighter output cap. */
function applyFastModelOverride(route: IqRouteResolution): IqRouteResolution {
  if (route.provider === 'mimo') {
    return {
      ...route,
      // Default to the same model as the non-lean route. The previous default,
      // 'mimo-v2-flash', is rejected by the API ('400 Unsupported model'), so
      // the fallback leg failed instantly on every paid report — leaving only
      // an out-of-credit OpenAI behind it. Override with MIMO_IQ_FULL_LEAN_MODEL.
<<<<<<< HEAD
      model: mimoModel(
        process.env.MIMO_IQ_FULL_LEAN_MODEL || process.env.MIMO_IQ_FULL_MODEL,
        'mimo-v2.5-pro',
      ),
=======
      model:
        process.env.MIMO_IQ_FULL_LEAN_MODEL?.trim() ||
        process.env.MIMO_IQ_FULL_MODEL?.trim() ||
        'mimo-v2.5-pro',
>>>>>>> origin/main
      thinking: false,
      maxTokens: Math.min(route.maxTokens ?? 16_000, 10_000),
    };
  }
  if (route.provider === 'anthropic') {
    return {
      ...route,
      // Sonnet is materially faster than Opus at near-Opus quality — the fast
      // pass must land in ~1 minute; the background quality regen uses Opus.
      model: process.env.ANTHROPIC_IQ_FULL_LEAN_MODEL?.trim() || 'claude-sonnet-5',
      effort: 'low',
      // Thinking tokens count toward max_tokens and dominate latency here.
      disableThinking: true,
    };
  }
  return { ...route, maxTokens: Math.min(route.maxTokens ?? 16_000, 10_000) };
}

/**
 * Run structured JSON generation for an IQ task with primary → fallback routing.
 */
export async function runIqProviderJson<T extends Record<string, unknown>>(opts: {
  task: IqLlmTask;
  system: string;
  user: string;
  /** Lean/browser path: prefer the fast model so generation fits the serverless budget. */
  fastModel?: boolean;
  /** Hard per-call budget derived from the pipeline deadline. */
  timeoutMs?: number;
  /**
   * Output cap the remaining time can actually pay for (see outputTokenBudget).
   * Without it a route asks for a fixed 16K tokens regardless of how long is
   * left, and the call gets aborted mid-generation.
   */
  maxTokens?: number;
  /** Optional sink recording why each leg failed (surfaced in error messages). */
  attempts?: IqRouteAttempt[];
}): Promise<IqJsonRunResult<T> | null> {
  const withBudget = (route: IqRouteResolution): IqRouteResolution =>
    opts.maxTokens && opts.maxTokens > 0
      ? { ...route, maxTokens: Math.min(route.maxTokens ?? 16_000, opts.maxTokens) }
      : route;

  let primary = resolveIqRoute(opts.task, false);
  if (!primary) return null;
  if (opts.fastModel) primary = applyFastModelOverride(primary);
  primary = withBudget(primary);

  let warning: string | undefined;

  const tryRun = async (route: IqRouteResolution): Promise<Record<string, unknown> | null> => {
    const record = (ok: boolean, reason?: string) => {
      opts.attempts?.push({ provider: route.provider, model: route.model, ok, reason });
    };
    try {
      if (route.provider === 'mimo') {
        const mdiag: MimoDiagnostic = {};
        const out = await runMimoJson({
          model: route.model,
          system: opts.system,
          user: opts.user,
          thinking: route.thinking,
          maxTokens: route.maxTokens,
          temperature: route.temperature,
          diag: mdiag,
        });
        record(
          Boolean(out?.raw),
          out?.raw
            ? undefined
            : mdiag.error ??
                `finish=${mdiag.finishReason ?? '?'} out=${mdiag.outputTokens ?? '?'} parsed=${
                  mdiag.parsed ?? '?'
                }`,
        );
        return out?.raw ?? null;
      }
      if (route.provider === 'anthropic') {
        const diag: AnthropicDiagnostic = {};
        const out = await runAnthropicJson({
          model: route.model,
          system: opts.system,
          user: opts.user,
          maxTokens: route.maxTokens,
          effort: route.effort,
          disableThinking: route.disableThinking,
          timeoutMs: opts.timeoutMs,
          diag,
        });
        record(
          Boolean(out?.raw),
          out?.raw
            ? undefined
            : diag.error ??
                `stop=${diag.stopReason ?? '?'} out=${diag.outputTokens ?? '?'} parsed=${
                  diag.parsed ?? '?'
                }`,
        );
        return out?.raw ?? null;
      }
      const openAiOut = await runOpenAiJson(route, opts.system, opts.user);
      record(Boolean(openAiOut), openAiOut ? undefined : 'no parseable JSON returned');
      return openAiOut;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[iq-provider] ${route.provider}/${route.model} threw:`, msg.slice(0, 400));
      record(false, msg.slice(0, 200));
      return null;
    }
  };

  let raw = await tryRun(primary);
  let used = primary;

  if (!raw) {
    let fb = resolveIqRoute(opts.task, true);
    if (fb && opts.fastModel) fb = applyFastModelOverride(fb);
    if (fb) fb = withBudget(fb);
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
  timeoutMs?: number;
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
      if (route.provider === 'anthropic') {
        const out = await runAnthropicJson({
          model: route.model,
          system: opts.system,
          user: opts.user,
          maxTokens: route.maxTokens,
          effort: route.effort,
          disableThinking: route.disableThinking,
          timeoutMs: opts.timeoutMs,
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
