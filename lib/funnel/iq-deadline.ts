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

/** Budget floors for the optional stages, in milliseconds. */
export const DEEP_RESEARCH_MIN_BUDGET_MS = 150_000;
export const DUAL_VERIFY_MIN_BUDGET_MS = 90_000;
/** Below this the LLM cannot plausibly finish a full report — fail fast instead. */
export const GENERATION_MIN_BUDGET_MS = 25_000;
