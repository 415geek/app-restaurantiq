/**
 * Wall-clock budget for the paid-report pipeline.
 *
 * The route runs under a hard serverless limit (maxDuration 300s). Market
 * enrichment, LLM generation, and dual-model verification run sequentially, so
 * any one of them overrunning kills the whole request and the user sees a
 * timeout instead of a report. A deadline lets each stage ask "how much time is
 * actually left?" and skip or shrink itself rather than blow the budget.
 */

/** Leave room for parse + DB write + response after the last LLM token. */
const RESERVE_MS = 20_000;

export type IqDeadline = {
  /** Milliseconds left before work must stop. Never negative. */
  remainingMs: () => number;
  /** Whether at least `ms` remain — use to gate optional stages. */
  hasBudget: (ms: number) => boolean;
  /** Milliseconds spent so far (for timing logs). */
  elapsedMs: () => number;
};

export function createIqDeadline(totalMs: number): IqDeadline {
  const start = Date.now();
  const end = start + Math.max(totalMs - RESERVE_MS, 0);
  return {
    remainingMs: () => Math.max(end - Date.now(), 0),
    hasBudget: (ms: number) => end - Date.now() >= ms,
    elapsedMs: () => Date.now() - start,
  };
}

/**
 * Generation cost, measured on production against a real report prompt
 * (~30K input tokens) via /api/health?probe=iq-full-prompt:
 *
 *   claude-sonnet-5, thinking off, effort low
 *     cap  700 -> 12,163ms
 *     cap 1200 -> 21,994ms
 *     cap 2400 -> 32,995ms and 35,422ms (same config, two runs)
 *
 * Run-to-run spread is ~2.4s at the same cap, so these are fitted
 * conservatively rather than exactly: the widest span (700 -> 2400) gives
 * ~12.3ms/token, which is the figure used here plus a little headroom. The
 * fixed cost (prefill of the 30K-token prompt, network, TLS) is a few seconds;
 * the reserve below is deliberately larger to absorb the variance. Thinking-on
 * routes also spend max_tokens on reasoning, so they are charged double.
 *
 * Under-estimating this rate is what breaks reports: the budget then buys more
 * tokens than the time can decode, and the call is aborted mid-generation.
 */
const PREFILL_RESERVE_MS = 15_000;
const MS_PER_OUTPUT_TOKEN = 13;
const MS_PER_OUTPUT_TOKEN_THINKING = 26;

/** Never ask for less than this — a report below it is not worth returning. */
const MIN_OUTPUT_TOKENS = 2_000;

/**
 * Largest output budget that can actually finish in `remainingMs`.
 *
 * A fixed 16K cap was the real defect: at the measured rate that is ~160s of
 * decode, and with thinking on it does not fit in the route's window at all,
 * so the call was aborted mid-generation and the whole report failed. Sizing
 * the cap to the time left means generation always completes; if the model
 * wanted more room the JSON is truncated at a known point and repaired.
 */
export function outputTokenBudget(
  remainingMs: number,
  opts: { thinking?: boolean; ceiling?: number } = {},
): number {
  const rate = opts.thinking ? MS_PER_OUTPUT_TOKEN_THINKING : MS_PER_OUTPUT_TOKEN;
  const usable = remainingMs - PREFILL_RESERVE_MS;
  const affordable = Math.floor(usable / rate);
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(affordable, opts.ceiling ?? 16_000));
}

/**
 * Budget floors for the optional stages, in milliseconds.
 *
 * Deep research polls for up to 75s and generation needs PREFILL_RESERVE_MS
 * plus decode time, so running research with less than ~200s left guarantees a
 * starved generation afterwards. Dual verify is a second full LLM round trip.
 */
export const DEEP_RESEARCH_MIN_BUDGET_MS = 200_000;
export const DUAL_VERIFY_MIN_BUDGET_MS = 120_000;
/** Below this the LLM cannot plausibly finish a full report — fail fast instead. */
export const GENERATION_MIN_BUDGET_MS = 35_000;
