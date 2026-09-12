/**
 * Orchestrates the ops jobs for /api/iq/ops: parses the query string, splits
 * the invocation budget between tasks, runs them in order and NEVER throws —
 * every task reports `{ ok, ms, result | error }` so a cron log shows exactly
 * which step failed. Runners are injectable so the sequencing is unit-tested
 * without network or DB.
 */
import { OpsConfigError, createBudget, prefixedLog, round4, type OpsLog } from './common';
import { migrationsAvailable, runPendingMigrations, type MigrateResult } from './migrate';
import { loadLodes, parseCountyList, type LoadLodesResult } from './lodes-loader';
import { refreshHubs, type RefreshHubsResult } from './refresh-hubs';
import { snapshotReviews, type SnapshotReviewsResult } from './snapshot-reviews';
import { runSourceGapAgent, type SourceGapAgentResult } from './source-gap-agent';

export const OPS_TASKS = ['migrate', 'hubs', 'snapshots', 'lodes', 'source_gaps'] as const;
export type OpsTask = (typeof OPS_TASKS)[number];

/** `source_gaps` joins an `all` run only when at least this much budget is left after lodes. */
export const SOURCE_GAPS_MIN_BUDGET_MS = 60_000;

/** Default SF Bay counties: San Mateo, San Francisco, Santa Clara, Alameda, Contra Costa. */
export const DEFAULT_LODES_COUNTIES = ['06081', '06075', '06085', '06001', '06013'];

export interface OpsParams {
  task: OpsTask | 'all';
  metro: string;
  state: string;
  year: number;
  counties: string[];
  dryRun: boolean;
  maxDetails: number;
  /** Force lodes to ignore the recorded progress (reload counties). */
  force: boolean;
  /** source_gaps: max reports regenerated per run (agent default when absent). */
  maxReports?: number;
  /** source_gaps: max web searches per run (agent default when absent). */
  maxSearches?: number;
}

export function parseOpsParams(sp: URLSearchParams): OpsParams {
  const task = (sp.get('task') ?? 'all').trim().toLowerCase();
  if (task !== 'all' && !(OPS_TASKS as readonly string[]).includes(task)) {
    throw new OpsConfigError(`task must be one of ${[...OPS_TASKS, 'all'].join('|')}, got "${task}"`);
  }
  const metro = (sp.get('metro') ?? 'sf-bay').trim();
  const state = (sp.get('state') ?? 'ca').trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(state)) throw new OpsConfigError(`state must be a two-letter code, got "${state}"`);
  const year = Number(sp.get('year') ?? '2022');
  if (!Number.isInteger(year) || year < 2002) throw new OpsConfigError(`year must be a LODES vintage ≥ 2002, got "${sp.get('year')}"`);
  const counties = sp.get('counties') ? parseCountyList(sp.get('counties') as string) : DEFAULT_LODES_COUNTIES;
  const truthy = (v: string | null) => v === '1' || v === 'true' || v === 'yes';
  const maxDetails = Number(sp.get('maxDetails') ?? '0');
  const optionalCount = (name: string): number | undefined => {
    const raw = sp.get(name);
    if (raw == null || raw.trim() === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new OpsConfigError(`${name} must be a non-negative integer, got "${raw}"`);
    return n;
  };
  return {
    task: task as OpsTask | 'all',
    metro,
    state,
    year,
    counties,
    dryRun: truthy(sp.get('dryRun')) || truthy(sp.get('dry_run')),
    maxDetails: Number.isFinite(maxDetails) && maxDetails > 0 ? Math.floor(maxDetails) : 0,
    force: truthy(sp.get('force')),
    maxReports: optionalCount('maxReports'),
    maxSearches: optionalCount('maxSearches'),
  };
}

export interface OpsTaskOutcome {
  task: OpsTask;
  ok: boolean;
  ms: number;
  cost_usd: number;
  result?: unknown;
  error?: string;
}

export interface OpsRunResult {
  ok: boolean;
  task: OpsTask | 'all';
  dry_run: boolean;
  tasks: OpsTaskOutcome[];
  cost_usd: number;
  total_ms: number;
}

export interface OpsRunners {
  migrate: (p: OpsParams) => Promise<MigrateResult | { ok: boolean; skipped: string }>;
  hubs: (p: OpsParams, budgetMs: number) => Promise<RefreshHubsResult>;
  snapshots: (p: OpsParams, budgetMs: number) => Promise<SnapshotReviewsResult>;
  lodes: (p: OpsParams, budgetMs: number, oneCounty: boolean) => Promise<LoadLodesResult>;
  /** Optional so older runner sets still type-check; `all` skips the task silently when absent. */
  source_gaps?: (p: OpsParams, budgetMs: number) => Promise<SourceGapAgentResult>;
}

export function defaultRunners(log: OpsLog): OpsRunners {
  return {
    async migrate(p) {
      if (p.dryRun) return { ok: true, skipped: 'dry run' };
      if (!migrationsAvailable()) return { ok: false, applied: [], reason: 'DATABASE_URL not set' };
      return runPendingMigrations();
    },
    hubs: (p, budgetMs) => refreshHubs({ metro: p.metro, dryRun: p.dryRun, budgetMs, log }),
    snapshots: (p, budgetMs) => snapshotReviews({ metro: p.metro, dryRun: p.dryRun, maxDetails: p.maxDetails, budgetMs, log }),
    lodes: (p, budgetMs, oneCounty) =>
      loadLodes({
        state: p.state,
        year: p.year,
        counties: p.counties,
        dryRun: p.dryRun,
        budgetMs,
        log,
        skipDone: p.force ? false : undefined,
        countiesPerRun: oneCounty ? 1 : undefined,
      }),
    source_gaps: (p, budgetMs) =>
      runSourceGapAgent({ metro: p.metro, dryRun: p.dryRun, budgetMs, maxReports: p.maxReports, maxSearches: p.maxSearches, log }),
  };
}

export interface RunOpsOptions {
  /** Whole-invocation budget (Vercel maxDuration minus a margin). */
  budgetMs: number;
  runners?: OpsRunners;
  log?: OpsLog;
  now?: () => number;
}

/** Budget split when running `all`; single tasks get the whole budget. */
export const ALL_TASK_BUDGET = { hubs: 90_000, snapshots: 60_000 } as const;

function costOf(result: unknown): number {
  if (result && typeof result === 'object' && 'cost_usd' in result) {
    const c = (result as { cost_usd?: unknown }).cost_usd;
    return typeof c === 'number' && Number.isFinite(c) ? c : 0;
  }
  return 0;
}

function taskOk(result: unknown): boolean {
  if (result && typeof result === 'object' && 'ok' in result) return Boolean((result as { ok: unknown }).ok);
  return true;
}

export async function runOps(params: OpsParams, opts: RunOpsOptions): Promise<OpsRunResult> {
  const log = prefixedLog('iq-ops', opts.log);
  const now = opts.now ?? Date.now;
  const runners = opts.runners ?? defaultRunners(opts.log ?? log);
  const budget = createBudget(opts.budgetMs, now);
  const all = params.task === 'all';
  // `source_gaps` rides along in `all` only when a runner is configured (defaultRunners always has one).
  const order: OpsTask[] = all ? ['migrate', 'hubs', 'snapshots', 'lodes', ...(runners.source_gaps ? (['source_gaps'] as const) : [])] : [params.task as OpsTask];
  const outcomes: OpsTaskOutcome[] = [];

  log(`start task=${params.task} metro=${params.metro} state=${params.state} year=${params.year} counties=${params.counties.join(',')} dryRun=${params.dryRun} budget=${Math.round(opts.budgetMs / 1000)}s`);

  for (const task of order) {
    const t0 = now();
    const remaining = budget.remaining();
    if (task !== 'migrate' && remaining < 5_000) {
      outcomes.push({ task, ok: false, ms: 0, cost_usd: 0, error: 'skipped: invocation budget exhausted' });
      continue;
    }
    if (task === 'source_gaps' && all && remaining < SOURCE_GAPS_MIN_BUDGET_MS) {
      // Not a failure: the weekly cron runs it on its own with a full budget.
      outcomes.push({ task, ok: true, ms: 0, cost_usd: 0, result: { ok: true, skipped: `less than ${SOURCE_GAPS_MIN_BUDGET_MS / 1000} s remaining after lodes` } });
      continue;
    }
    // Each task gets a slice of the remaining budget when running `all`; the whole thing otherwise.
    const slice = !all ? remaining : task === 'lodes' || task === 'source_gaps' ? remaining : Math.min(ALL_TASK_BUDGET[task as 'hubs' | 'snapshots'] ?? remaining, remaining);
    try {
      let result: unknown;
      switch (task) {
        case 'migrate':
          result = await runners.migrate(params);
          break;
        case 'hubs':
          result = await runners.hubs(params, slice);
          break;
        case 'snapshots':
          result = await runners.snapshots(params, slice);
          break;
        case 'lodes':
          result = await runners.lodes(params, slice, all);
          break;
        case 'source_gaps':
          if (!runners.source_gaps) throw new Error('source_gaps runner not configured');
          result = await runners.source_gaps(params, slice);
          break;
      }
      const ok = taskOk(result);
      outcomes.push({ task, ok, ms: now() - t0, cost_usd: round4(costOf(result)), result, ...(ok ? {} : { error: String((result as { reason?: unknown })?.reason ?? 'task reported ok=false') }) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`${task} failed: ${msg}`);
      outcomes.push({ task, ok: false, ms: now() - t0, cost_usd: 0, error: msg });
    }
  }

  const cost_usd = round4(outcomes.reduce((s, o) => s + o.cost_usd, 0));
  const total_ms = budget.elapsed();
  log(`cost summary · ${outcomes.map((o) => `${o.task}=$${o.cost_usd.toFixed(3)}${o.ok ? '' : ' (failed)'}`).join(' · ')} · total $${cost_usd.toFixed(3)} · ${Math.round(total_ms / 1000)}s`);

  return {
    ok: outcomes.every((o) => o.ok),
    task: params.task,
    dry_run: params.dryRun,
    tasks: outcomes,
    cost_usd,
    total_ms,
  };
}
