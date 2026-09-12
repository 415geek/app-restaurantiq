import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LoadLodesResult } from './lodes-loader';
import type { RefreshHubsResult } from './refresh-hubs';
import type { SnapshotReviewsResult } from './snapshot-reviews';
import { ALL_TASK_BUDGET, DEFAULT_LODES_COUNTIES, parseOpsParams, runOps, type OpsParams, type OpsRunners } from './run';

const sp = (q: string) => new URLSearchParams(q);

test('parseOpsParams: defaults, overrides and validation', () => {
  const d = parseOpsParams(sp(''));
  assert.equal(d.task, 'all');
  assert.equal(d.metro, 'sf-bay');
  assert.equal(d.state, 'ca');
  assert.equal(d.year, 2022);
  assert.deepEqual(d.counties, DEFAULT_LODES_COUNTIES);
  assert.equal(d.dryRun, false);
  assert.equal(d.maxDetails, 0);
  assert.equal(d.force, false);

  const p = parseOpsParams(sp('task=LODES&metro=la&state=CA&year=2021&counties=06037,06059&dryRun=1&maxDetails=25&force=true'));
  assert.equal(p.task, 'lodes');
  assert.equal(p.metro, 'la');
  assert.equal(p.state, 'ca');
  assert.equal(p.year, 2021);
  assert.deepEqual(p.counties, ['06037', '06059']);
  assert.equal(p.dryRun, true);
  assert.equal(p.maxDetails, 25);
  assert.equal(p.force, true);

  assert.throws(() => parseOpsParams(sp('task=nuke')), /task must be one of/);
  assert.throws(() => parseOpsParams(sp('state=cal')), /two-letter/);
  assert.throws(() => parseOpsParams(sp('year=1999')), /vintage/);
  assert.throws(() => parseOpsParams(sp('counties=6081')), /5 digits/);
});

function fakeRunners(calls: string[], opts: { failHubs?: boolean } = {}): OpsRunners {
  const lodes = (counties: string[]): LoadLodesResult => ({
    rows_upserted: 12,
    rows_scanned: 100,
    counties_done: [counties[0]],
    counties_remaining: counties.slice(1),
    counties_skipped: [],
    truncated: false,
    truncated_reason: null,
    elapsed_ms: 1,
    dry_run: false,
    url: 'x',
  });
  return {
    async migrate(p) {
      calls.push(`migrate:${p.dryRun}`);
      return { ok: true, applied: ['0009_iq_360_data_layer.sql'], reason: null };
    },
    async hubs(p, budgetMs) {
      calls.push(`hubs:${budgetMs}`);
      if (opts.failHubs) throw new Error('hubs.yaml is for sf-bay, not la');
      return { metro: p.metro, hubs_total: 16, hubs_done: 16, hubs_skipped: [], cuisines_written: 8, medians: {}, cost_usd: 0.012, warnings: [], truncated: false, elapsed_ms: 1, dry_run: p.dryRun } satisfies RefreshHubsResult;
    },
    async snapshots(p, budgetMs) {
      calls.push(`snapshots:${budgetMs}`);
      return {
        metro: p.metro,
        month: '2026-09-01',
        hubs: 16,
        hubs_done: 16,
        places: 300,
        places_with_counts: 290,
        rows_upserted: 300,
        calls: 96,
        details_calls: 0,
        linked_total: 0,
        linked_missing: 0,
        cost_usd: 1.5,
        cost_by_source: { D6: 1.5 },
        warnings: [],
        truncated: false,
        elapsed_ms: 1,
        dry_run: p.dryRun,
      } satisfies SnapshotReviewsResult;
    },
    async lodes(p, budgetMs, oneCounty) {
      calls.push(`lodes:${budgetMs}:${oneCounty}`);
      return lodes(p.counties);
    },
  };
}

const base: OpsParams = { task: 'all', metro: 'sf-bay', state: 'ca', year: 2022, counties: ['06081', '06075'], dryRun: false, maxDetails: 0, force: false };

test('runOps all: migrate → hubs → snapshots → lodes(one county), budgets sliced, cost summed', async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const r = await runOps(base, { budgetMs: 280_000, runners: fakeRunners(calls), log: (m) => logs.push(m), now: () => 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.tasks.map((t) => t.task),
    ['migrate', 'hubs', 'snapshots', 'lodes'],
  );
  assert.equal(calls[0], 'migrate:false');
  assert.equal(calls[1], `hubs:${ALL_TASK_BUDGET.hubs}`);
  assert.equal(calls[2], `snapshots:${ALL_TASK_BUDGET.snapshots}`);
  assert.ok(calls[3].startsWith('lodes:') && calls[3].endsWith(':true'), calls[3]);
  assert.equal(r.cost_usd, 1.512);
  assert.ok(logs.some((l) => /cost summary/.test(l) && /total \$1\.512/.test(l)));
});

test('runOps all: a failing task is collected, later tasks still run, ok=false, never throws', async () => {
  const calls: string[] = [];
  const r = await runOps({ ...base, metro: 'la' }, { budgetMs: 280_000, runners: fakeRunners(calls, { failHubs: true }), log: () => {}, now: () => 0 });
  assert.equal(r.ok, false);
  const hubs = r.tasks.find((t) => t.task === 'hubs');
  assert.ok(hubs);
  assert.equal(hubs.ok, false);
  assert.match(hubs.error ?? '', /hubs\.yaml/);
  assert.equal(r.tasks.filter((t) => t.ok).length, 3);
  assert.ok(calls.some((c) => c.startsWith('lodes:')));
});

test('runOps single task gets the whole budget and passes dryRun through', async () => {
  const calls: string[] = [];
  const r = await runOps({ ...base, task: 'lodes', dryRun: true }, { budgetMs: 240_000, runners: fakeRunners(calls), log: () => {}, now: () => 0 });
  assert.equal(r.ok, true);
  assert.equal(r.dry_run, true);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].task, 'lodes');
  // 240 s budget − 20 s margin = 220 s handed to the loader; not the one-county mode.
  assert.equal(calls[0], 'lodes:220000:false');
  const res = r.tasks[0].result as LoadLodesResult;
  assert.deepEqual(res.counties_remaining, ['06075']);
});

test('runOps: migrate failure reports reason; tasks after an exhausted budget are skipped', async () => {
  const calls: string[] = [];
  const runners = fakeRunners(calls);
  runners.migrate = async () => ({ ok: false, applied: [], reason: 'DATABASE_URL not set' });
  let clock = 0;
  runners.hubs = async (p, budgetMs) => {
    calls.push(`hubs:${budgetMs}`);
    clock = 275_000; // hubs ate the whole invocation
    return { metro: p.metro, hubs_total: 0, hubs_done: 0, hubs_skipped: [], cuisines_written: 0, medians: {}, cost_usd: 0, warnings: [], truncated: true, elapsed_ms: 1, dry_run: false };
  };
  const r = await runOps(base, { budgetMs: 280_000, runners, log: () => {}, now: () => clock });
  assert.equal(r.ok, false);
  assert.equal(r.tasks[0].task, 'migrate');
  assert.equal(r.tasks[0].ok, false);
  assert.match(r.tasks[0].error ?? '', /DATABASE_URL/);
  assert.equal(r.tasks[1].ok, true);
  assert.match(r.tasks[2].error ?? '', /budget exhausted/);
  assert.match(r.tasks[3].error ?? '', /budget exhausted/);
  assert.equal(calls.filter((c) => c.startsWith('snapshots') || c.startsWith('lodes')).length, 0);
});
