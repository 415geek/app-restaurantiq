/**
 * Shared plumbing for the ops jobs (lib/iq/ops/*): a logger shape both the
 * CLI wrappers and the /api/iq/ops route can satisfy, a typed error for
 * "missing env / bad args" (CLI exit code 2), and the budget helper every job
 * uses to stop cleanly before Vercel's maxDuration kills the invocation.
 */

export type OpsLog = (msg: string, extra?: unknown) => void;

/** Thrown for missing env or invalid arguments; CLI wrappers map it to exit code 2. */
export class OpsConfigError extends Error {
  readonly code = 'ops_config';
  constructor(message: string) {
    super(message);
    this.name = 'OpsConfigError';
  }
}

export interface OpsBaseOptions {
  log?: OpsLog;
  dryRun?: boolean;
  /** Wall-clock budget for the whole call. Jobs stop early (never throw) when it is nearly used. */
  budgetMs?: number;
  /** Test hook: monotonic clock in ms. */
  now?: () => number;
}

export function prefixedLog(prefix: string, log?: OpsLog): OpsLog {
  const base: OpsLog = log ?? ((msg, extra) => (extra === undefined ? console.log(msg) : console.log(msg, extra)));
  return (msg, extra) => base(`[${prefix}] ${msg}`, extra);
}

export interface Budget {
  /** ms left before the soft deadline (budget minus safety margin). */
  remaining(): number;
  /** true once the soft deadline is reached. */
  exhausted(): boolean;
  elapsed(): number;
}

/**
 * Soft deadline = budgetMs − margin, where the margin covers "finish the
 * current batch + serialize the response". Margin is 10% of the budget,
 * clamped to [2 s, 20 s].
 */
export function createBudget(budgetMs: number | undefined, now: () => number = Date.now): Budget {
  const t0 = now();
  const total = budgetMs && Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : Number.POSITIVE_INFINITY;
  const margin = Number.isFinite(total) ? Math.min(20_000, Math.max(2_000, total * 0.1)) : 0;
  const soft = total - margin;
  return {
    remaining: () => (Number.isFinite(soft) ? Math.max(0, soft - (now() - t0)) : Number.POSITIVE_INFINITY),
    exhausted: () => now() - t0 >= soft,
    elapsed: () => now() - t0,
  };
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
