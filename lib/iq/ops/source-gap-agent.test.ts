import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebSearchHit, WebSearchOutcome } from '@/lib/iq/data/rent-comps';
import type { DataSourceId } from '@/lib/iq/data/types';
import { parseOpsParams, runOps, SOURCE_GAPS_MIN_BUDGET_MS, type OpsParams, type OpsRunners } from './run';
import {
  buildDiscoveryQuery,
  DISCOVERY_TOPICS,
  loaderFixable,
  MIN_CANDIDATE_SCORE,
  normalizeSources,
  normalizeUrl,
  REGEN_MIN_REMAINING_MS,
  runSourceGapAgent,
  scoreCandidate,
  selectDiscoveryTopics,
  type GapReport,
  type GapSourceRow,
  type SourceCandidateRow,
  type SourceGapAgentResult,
  type SourceGapDeps,
  type SourceGapRunRow,
  type TableCounts,
} from './source-gap-agent';

// ───────────────────────────── fixtures ─────────────────────────────

const SF = { label: 'San Francisco Bay Area', counties: ['San Mateo County', 'San Francisco'] };

function src(id: DataSourceId, status: GapSourceRow['status'], extra: Partial<GapSourceRow> = {}): GapSourceRow {
  return { id, status, coverage_note: '', source: '', ...extra };
}

/** All 12 sources ok, then override some. */
function sources(overrides: GapSourceRow[] = []): GapSourceRow[] {
  const ids: DataSourceId[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'];
  return ids.map((id) => overrides.find((o) => o.id === id) ?? src(id, 'ok'));
}

const LODES_MISSING = src('D3', 'partial', { degraded_from: 'lodes_wac', coverage_note: 'iq_lodes_wac 无 2022/2021 年数据 → LODES 未加载 → 用 ACS B08301 反推' });
const LODES_SPARSE = src('D3', 'partial', { coverage_note: 'LODES 2022 WAC：120 个 block · 覆盖 5/6 个 tract。1 个 tract 无岗位记录（可能为纯住宅/未加载）' });
const POI_MISSING = src('D5', 'failed', { coverage_note: 'iq_poi 未加载（scripts/load_overture.py）' });
const SNAP_MISSING = src('D7', 'partial', { degraded_from: 'snapshot_growth', source: '本次 Google Places 评论数（无快照表）' });

function report(id: string, created_at: string, rows: GapSourceRow[], tier: string | null = 'paid'): GapReport {
  return { id, created_at, sources: rows, tier };
}

function hit(url: string, title: string, snippet = ''): WebSearchHit {
  return { url, title, snippet };
}

interface Recorder {
  deps: SourceGapDeps;
  calls: string[];
  inserted: SourceCandidateRow[];
  runs: SourceGapRunRow[];
  committed: string[];
}

function makeDeps(
  cfg: {
    reports?: GapReport[];
    counts?: TableCounts;
    recent?: string[];
    /** regenerate stub: id → sources after (null = row missing); commit recorded. */
    regen?: (id: string) => { sources: GapSourceRow[]; tier?: string; cost_usd?: number } | null;
    onRegenerate?: (id: string) => void;
    search?: (q: string) => WebSearchOutcome;
    existing?: string[];
    failListReports?: boolean;
  } = {},
): Recorder {
  const calls: string[] = [];
  const inserted: SourceCandidateRow[] = [];
  const runs: SourceGapRunRow[] = [];
  const committed: string[] = [];
  const deps: SourceGapDeps = {
    async listReports(since) {
      calls.push(`listReports:${since.slice(0, 10)}`);
      if (cfg.failListReports) throw new Error('relation iq_location_reports missing');
      return cfg.reports ?? [];
    },
    async tableCounts(metro) {
      calls.push(`tableCounts:${metro}`);
      return cfg.counts ?? { iq_lodes_wac: 0, iq_poi: 0, iq_poi_snapshot: 0 };
    },
    async recentRegenerations() {
      calls.push('recentRegenerations');
      return cfg.recent ?? [];
    },
    async regenerate(id) {
      calls.push(`regenerate:${id}`);
      cfg.onRegenerate?.(id);
      const r = cfg.regen ? cfg.regen(id) : null;
      if (!r) return null;
      return {
        sources: r.sources,
        cost_usd: r.cost_usd ?? 0.25,
        tier: r.tier ?? 'paid',
        commit: async () => {
          committed.push(id);
        },
      };
    },
    async search(q) {
      calls.push(`search:${q}`);
      return cfg.search ? cfg.search(q) : { provider: 'tavily', hits: [], cost_usd: 0.03 };
    },
    async existingCandidateUrls(urls) {
      calls.push(`existing:${urls.length}`);
      const ex = new Set(cfg.existing ?? []);
      return urls.filter((u) => ex.has(u));
    },
    async insertCandidates(rows) {
      calls.push(`insert:${rows.length}`);
      inserted.push(...rows);
      return rows.length;
    },
    async insertRun(row) {
      calls.push('insertRun');
      runs.push(row);
    },
  };
  return { deps, calls, inserted, runs, committed };
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 7, 12, 0, 0); // Mon 2026-09-07 12:00Z

// ───────────────────────────── pure helpers ─────────────────────────────

test('normalizeSources tolerates malformed JSON and loaderFixable only flags table-caused gaps', () => {
  const rows = normalizeSources([
    { id: 'D3', status: 'partial', degraded_from: 'lodes_wac' },
    { id: 'D99', status: 'ok' },
    { id: 'D4', status: 'weird' },
    null,
    'x',
    { id: 'D5', status: 'failed', coverage_note: 42 },
  ]);
  assert.deepEqual(
    rows.map((r) => `${r.id}:${r.status}`),
    ['D3:partial', 'D5:failed'],
  );
  assert.equal(normalizeSources(null).length, 0);
  assert.equal(normalizeSources({ D1: 'ok' }).length, 0);

  assert.equal(loaderFixable(LODES_MISSING), true);
  assert.equal(loaderFixable(LODES_SPARSE), false, 'a few empty tracts is not a missing table');
  assert.equal(loaderFixable(src('D3', 'failed')), true);
  assert.equal(loaderFixable(POI_MISSING), true);
  assert.equal(loaderFixable(src('D5', 'partial', { coverage_note: '半径内 12 个 POI' })), false);
  assert.equal(loaderFixable(SNAP_MISSING), true);
  assert.equal(loaderFixable(src('D7', 'partial', { coverage_note: '3/8 个地点有 ≥2 个月快照' })), false);
  assert.equal(loaderFixable(src('D8', 'failed')), false, 'no loader for rent comps');
  assert.equal(loaderFixable(src('D3', 'ok')), false);
});

test('scoreCandidate: gov / open-data / license words score high, social noise scores zero', () => {
  const kw = DISCOVERY_TOPICS.find((t) => t.source === 'D9')!.keywords;
  const gov = scoreCandidate(hit('https://data.sfgov.org/Transportation/BART-Ridership/abcd', 'BART Ridership — Open Data', 'Public domain dataset of station exits, San Francisco. API and CSV.'), { profile: SF, keywords: kw });
  assert.equal(gov.score, 1);
  assert.equal(gov.publisher, 'data.sfgov.org');
  assert.match(gov.license_hint ?? '', /public domain/);
  assert.match(gov.coverage_hint ?? '', /San Francisco/);

  const edu = scoreCandidate(hit('https://www.its.berkeley.edu/reports/transit', 'Transit ridership trends'), { profile: SF, keywords: kw });
  assert.ok(edu.score > 0.5 && edu.score < gov.score, `edu=${edu.score}`);

  const blog = scoreCandidate(hit('https://example.com/blog/transit', 'Some blog post', 'musings'), { profile: SF, keywords: kw });
  assert.ok(blog.score < MIN_CANDIDATE_SCORE, `blog=${blog.score}`);

  const reddit = scoreCandidate(hit('https://www.reddit.com/r/bayarea/comments/1/ridership', 'Top 10 ridership facts', 'dataset public domain'), { profile: SF, keywords: kw });
  assert.equal(reddit.score, 0);
  assert.equal(scoreCandidate(hit('not a url', 'x'), { profile: SF, keywords: kw }).score, 0);
  assert.equal(scoreCandidate(hit('ftp://data.gov/x', 'x'), { profile: SF, keywords: kw }).score, 0);
});

test('normalizeUrl, buildDiscoveryQuery rotation and selectDiscoveryTopics ordering', () => {
  assert.equal(normalizeUrl('HTTP://WWW.Data.SFgov.org/foo/bar/#frag'), 'https://data.sfgov.org/foo/bar');
  assert.equal(normalizeUrl('https://data.sfgov.org/foo/bar'), normalizeUrl('http://www.data.sfgov.org/foo/bar/'));
  assert.equal(normalizeUrl('https://a.gov/x?y=1'), 'https://a.gov/x?y=1');
  assert.equal(normalizeUrl('mailto:a@b.c'), null);

  const d8 = DISCOVERY_TOPICS.find((t) => t.source === 'D8')!;
  assert.equal(buildDiscoveryQuery(d8, SF, 0), 'open data commercial retail lease rates San Francisco Bay Area API dataset');
  assert.equal(buildDiscoveryQuery(d8, SF, 1), 'San Mateo County open data portal commercial retail lease rates');
  assert.equal(buildDiscoveryQuery(d8, SF, 2), 'open data commercial retail lease rates San Francisco Bay Area API dataset');
  assert.equal(buildDiscoveryQuery(d8, SF, 3), 'San Francisco open data portal commercial retail lease rates');
  assert.equal(buildDiscoveryQuery(d8, SF, 5), 'San Mateo County open data portal commercial retail lease rates', 'every county gets a turn');
  // No counties known → always the generic template.
  assert.equal(buildDiscoveryQuery(d8, { label: 'la', counties: [] }, 1), 'open data commercial retail lease rates la API dataset');

  const gaps = { D1: 0, D2: 0, D3: 5, D4: 1, D5: 0, D6: 0, D7: 2, D8: 2, D9: 0, D10: 0, D11: 0, D12: 0 } as Record<DataSourceId, number>;
  // D3 has gaps but no discovery topic; ties (D7, D8) keep declared order; D2 always-on rides last.
  assert.deepEqual(selectDiscoveryTopics(gaps, 10).map((t) => t.source), ['D7', 'D8', 'D4', 'D2']);
  assert.deepEqual(selectDiscoveryTopics(gaps, 2).map((t) => t.source), ['D7', 'D8']);
  assert.deepEqual(selectDiscoveryTopics(gaps, 0), []);
  const none = Object.fromEntries(Object.keys(gaps).map((k) => [k, 0])) as Record<DataSourceId, number>;
  assert.deepEqual(selectDiscoveryTopics(none, 3).map((t) => t.source), ['D2']);
});

// ───────────────────────────── the agent ─────────────────────────────

test('scan: gaps counted per source (once per report), nothing regenerated when tables are empty, run row persisted', async () => {
  const rec = makeDeps({
    reports: [
      report('r1', '2026-08-01T00:00:00Z', sources([LODES_MISSING, src('D8', 'partial')])),
      report('r2', '2026-08-10T00:00:00Z', sources([LODES_MISSING, src('D11', 'failed'), src('D8', 'failed')])),
      report('r3', '2026-08-20T00:00:00Z', sources()),
      { id: 'r4', created_at: '2026-08-21T00:00:00Z', sources: 'garbage', tier: 'paid' },
    ],
  });
  const logs: string[] = [];
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 200_000, maxSearches: 0, deps: rec.deps, now: () => T0, log: (m) => logs.push(m) });
  assert.equal(r.ok, true);
  assert.equal(r.reports_scanned, 4);
  assert.equal(r.gaps.D3, 2);
  assert.equal(r.gaps.D8, 2);
  assert.equal(r.gaps.D11, 1);
  assert.equal(r.gaps.D1, 0);
  assert.deepEqual(r.regenerated, []);
  assert.deepEqual(r.table_counts, { iq_lodes_wac: 0, iq_poi: 0, iq_poi_snapshot: 0 });
  assert.equal(r.searches, 0);
  assert.equal(r.candidates_added, 0);
  assert.equal(r.cost_usd, 0);
  assert.equal(r.truncated, false);
  // Scan window = 60 days back from `now`.
  assert.equal(rec.calls[0], `listReports:${new Date(T0 - 60 * DAY).toISOString().slice(0, 10)}`);
  assert.ok(!rec.calls.some((c) => c.startsWith('regenerate') || c.startsWith('search') || c.startsWith('insert:')));
  assert.equal(rec.runs.length, 1);
  assert.equal(rec.runs[0].reports_scanned, 4);
  assert.equal(rec.runs[0].reports_regenerated, 0);
  assert.equal(rec.runs[0].run_at, new Date(T0).toISOString());
  assert.equal(rec.runs[0].notes.metro, 'sf-bay');
  assert.deepEqual(rec.runs[0].notes.gaps, r.gaps);
  assert.ok(logs.some((l) => /gaps: D3=2 D8=2 D11=1/.test(l)), logs.join('\n'));
});

test('fill: regenerates oldest fixable reports once the table is loaded, commits only improvements, honours cooldown, cap and tier guard', async () => {
  const regenerated: string[] = [];
  const rec = makeDeps({
    reports: [
      report('sparse', '2026-07-20T00:00:00Z', sources([LODES_SPARSE])), // partial for another reason → left alone
      report('cool', '2026-07-25T00:00:00Z', sources([LODES_MISSING])), // regenerated recently → skipped
      report('old', '2026-08-01T00:00:00Z', sources([LODES_MISSING, src('D8', 'partial')])),
      report('same', '2026-08-05T00:00:00Z', sources([POI_MISSING])), // iq_poi still empty → not fixable now
      report('flat', '2026-08-10T00:00:00Z', sources([LODES_MISSING])), // regen gives no improvement
      report('down', '2026-08-12T00:00:00Z', sources([SNAP_MISSING])), // improves but would drop to precheck
      report('gone', '2026-08-15T00:00:00Z', sources([LODES_MISSING])), // row deleted meanwhile
      report('late', '2026-08-20T00:00:00Z', sources([LODES_MISSING])), // beyond maxReports
    ],
    counts: { iq_lodes_wac: 4_000_000, iq_poi: 0, iq_poi_snapshot: 12_000 },
    recent: ['cool'],
    onRegenerate: (id) => regenerated.push(id),
    regen: (id) => {
      if (id === 'old') return { sources: sources([src('D8', 'partial')]), cost_usd: 0.31 };
      if (id === 'flat') return { sources: sources([LODES_MISSING]), cost_usd: 0.2 };
      if (id === 'down') return { sources: sources(), tier: 'precheck', cost_usd: 0.1 };
      if (id === 'gone') return null;
      return { sources: sources() };
    },
  });
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 600_000, maxReports: 4, maxSearches: 0, deps: rec.deps, now: () => T0, log: () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual(regenerated, ['old', 'flat', 'down', 'gone']);
  assert.deepEqual(r.regenerated, ['old', 'flat', 'down', 'gone']);
  assert.deepEqual(r.improved, ['old']);
  assert.deepEqual(rec.committed, ['old']);
  assert.equal(r.cost_usd, 0.61);
  assert.ok(r.notes.some((n) => /gone: report row not found/.test(n)));
  assert.equal(rec.runs[0].reports_regenerated, 4);
  assert.deepEqual(rec.runs[0].notes.improved, ['old']);
  assert.deepEqual(rec.runs[0].notes.not_improved, ['flat', 'down']);
  assert.deepEqual(rec.runs[0].notes.skipped_cooldown, ['cool']);
  assert.equal(rec.runs[0].cost_usd, 0.61);
});

test('fill: a regeneration that throws is noted and the run continues; table-count failure skips fill only', async () => {
  const rec = makeDeps({
    reports: [report('boom', '2026-08-01T00:00:00Z', sources([LODES_MISSING])), report('next', '2026-08-02T00:00:00Z', sources([LODES_MISSING]))],
    counts: { iq_lodes_wac: 10, iq_poi: 0, iq_poi_snapshot: 0 },
    regen: (id) => {
      if (id === 'boom') throw new Error('pipeline exploded');
      return { sources: sources() };
    },
  });
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 600_000, maxSearches: 0, deps: rec.deps, now: () => T0, log: () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.regenerated, ['next']);
  assert.deepEqual(r.improved, ['next']);
  assert.ok(r.notes.some((n) => /boom: regeneration failed \(pipeline exploded\)/.test(n)));

  const rec2 = makeDeps({ reports: [report('a', '2026-08-01T00:00:00Z', sources([LODES_MISSING]))] });
  rec2.deps.tableCounts = async () => {
    throw new Error('permission denied');
  };
  const r2 = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 600_000, maxSearches: 1, deps: rec2.deps, now: () => T0, log: () => {} });
  assert.equal(r2.ok, true);
  assert.equal(r2.table_counts, null);
  assert.deepEqual(r2.regenerated, []);
  assert.ok(r2.notes.some((n) => /fill skipped: table counts unavailable/.test(n)));
  assert.equal(r2.searches, 1, 'discovery still runs');
  assert.equal(rec2.runs.length, 1);
});

test('discover: gap-driven queries, scoring, in-run + DB dedupe, per-search cap, never auto-adopts', async () => {
  const searches: string[] = [];
  const rec = makeDeps({
    reports: [
      report('a', '2026-08-01T00:00:00Z', sources([src('D9', 'partial'), src('D8', 'failed')])),
      report('b', '2026-08-02T00:00:00Z', sources([src('D9', 'failed')])),
    ],
    existing: ['https://data.sfgov.org/already-known'],
    search: (q) => {
      searches.push(q);
      if (/transit ridership/.test(q)) {
        return {
          provider: 'tavily',
          cost_usd: 0.03,
          hits: [
            hit('https://data.sfgov.org/already-known', 'BART exits (known)', 'open data dataset'),
            hit('https://www.bart.gov/about/reports/ridership', 'BART Ridership Reports', 'Monthly station exits, downloadable CSV'),
            hit('http://bart.gov/about/reports/ridership/', 'BART Ridership Reports (dup)', 'same page, different spelling'),
            hit('https://www.reddit.com/r/bayarea/x', 'Top 10 BART facts', 'lol'),
            hit('https://example.com/blog/ridership', 'A blog', 'no license words'),
            hit('https://data.sfgov.org/muni-ridership', 'Muni ridership', 'public domain API'),
          ],
        };
      }
      if (/lease/.test(q)) {
        return {
          provider: 'tavily',
          cost_usd: 0.03,
          hits: [
            hit('https://www.bart.gov/about/reports/ridership', 'BART again', 'cross-topic duplicate'),
            hit('https://sfplanning.org/resource/commercial-vacancy-dataset', 'Commercial vacancy dataset', 'Creative Commons; retail space, lease asking rates in San Francisco'),
          ],
        };
      }
      return { provider: 'tavily', cost_usd: 0.03, hits: [] };
    },
  });
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 200_000, maxSearches: 3, deps: rec.deps, now: () => T0, log: () => {} });
  assert.equal(r.ok, true);
  // D9 has 2 gaps, D8 has 1, then the always-on Chinese-community topic fills the third slot.
  assert.equal(searches.length, 3);
  assert.match(searches[0], /transit ridership station exits/);
  assert.match(searches[1], /commercial retail lease rates/);
  assert.match(searches[2], /Chinese community/);
  assert.deepEqual(r.queries, searches);
  assert.equal(r.searches, 3);
  assert.equal(r.cost_usd, 0.09);

  const urls = rec.inserted.map((c) => c.url);
  assert.deepEqual(urls, ['https://data.sfgov.org/muni-ridership', 'https://bart.gov/about/reports/ridership', 'https://sfplanning.org/resource/commercial-vacancy-dataset']);
  assert.equal(r.candidates_found, 3);
  assert.equal(r.candidates_added, 3);
  assert.ok(rec.inserted.every((c) => c.status === 'new' && c.discovered_by === 'web_search' && c.metro === 'sf-bay'));
  assert.deepEqual(
    rec.inserted.map((c) => c.gap_source),
    ['D9', 'D9', 'D8'],
  );
  const muni = rec.inserted[0];
  assert.equal(muni.publisher, 'data.sfgov.org');
  assert.match(muni.license_hint ?? '', /public domain/);
  assert.ok(muni.score >= 0.9, `score=${muni.score}`);
  const bart = rec.inserted[1];
  assert.equal(bart.title, 'BART Ridership Reports', 'first spelling wins the dedupe');
  assert.ok(bart.score > rec.inserted[2].score - 1, 'scores present');
  assert.match(bart.notes ?? '', /Monthly station exits.* · q: .*transit ridership station exits$/, 'snippet + the query that found it');
  const sfp = rec.inserted[2];
  assert.match(sfp.license_hint ?? '', /creative commons/);
  assert.match(sfp.coverage_hint ?? '', /San Francisco/);
  // The DB lookup got the deduped url set (5 unique candidates above threshold, 1 already known).
  assert.ok(rec.calls.includes('existing:4'), rec.calls.join(','));
  assert.equal(rec.runs[0].candidates_added, 3);
  assert.deepEqual(rec.runs[0].notes.queries, searches);
});

test('discover: search errors are notes, a missing key stops searching early', async () => {
  let n = 0;
  const rec = makeDeps({
    reports: [report('a', '2026-08-01T00:00:00Z', sources([src('D4', 'partial'), src('D11', 'failed')]))],
    search: () => (++n === 1 ? { provider: 'brave', hits: [], cost_usd: 0.005, error: 'HTTP 429' } : { provider: null, hits: [], cost_usd: 0, error: 'no_key' }),
  });
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 200_000, maxSearches: 3, deps: rec.deps, now: () => T0, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.searches, 2, 'stopped after no_key even though a third topic was queued');
  assert.equal(r.cost_usd, 0.005);
  assert.ok(r.notes.some((m) => /search error \(D4, brave\): HTTP 429/.test(m)));
  assert.ok(r.notes.some((m) => /no TAVILY_API_KEY/.test(m)));
  assert.equal(r.candidates_added, 0);
});

test('budget: regeneration stops when too little time is left; discovery is skipped once exhausted', async () => {
  let clock = T0;
  const rec = makeDeps({
    reports: [
      report('a', '2026-08-01T00:00:00Z', sources([LODES_MISSING])),
      report('b', '2026-08-02T00:00:00Z', sources([LODES_MISSING])),
      report('c', '2026-08-03T00:00:00Z', sources([LODES_MISSING, src('D8', 'failed')])),
    ],
    counts: { iq_lodes_wac: 1, iq_poi: 0, iq_poi_snapshot: 0 },
    onRegenerate: () => {
      clock += 100_000; // each regeneration "takes" 100 s
    },
    regen: () => ({ sources: sources() }),
  });
  // 200 s budget → soft deadline 180 s. After one regen 80 s remain (≥ 60 s) → second runs; then 0 → third refused.
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 200_000, maxReports: 5, maxSearches: 2, deps: rec.deps, now: () => clock, log: () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.regenerated, ['a', 'b']);
  assert.equal(r.truncated, true);
  assert.ok(r.notes.some((n) => /budget: stopped before regenerating c/.test(n)), r.notes.join('\n'));
  assert.ok(r.notes.some((n) => /budget: stopped before searching D8/.test(n)), r.notes.join('\n'));
  assert.equal(r.searches, 0);
  assert.equal(rec.runs.length, 1, 'the run row is still written');
  assert.equal(rec.runs[0].notes.truncated, true);

  // A budget below the regeneration floor never starts one but still searches.
  const rec2 = makeDeps({ reports: [report('a', '2026-08-01T00:00:00Z', sources([LODES_MISSING, src('D8', 'failed')]))], counts: { iq_lodes_wac: 1, iq_poi: 0, iq_poi_snapshot: 0 }, regen: () => ({ sources: sources() }) });
  const r2 = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: REGEN_MIN_REMAINING_MS, maxSearches: 1, deps: rec2.deps, now: () => T0, log: () => {} });
  assert.deepEqual(r2.regenerated, []);
  assert.equal(r2.truncated, true);
  assert.equal(r2.searches, 1);
});

test('dry run: scans and searches but regenerates, inserts and records nothing', async () => {
  const rec = makeDeps({
    reports: [report('a', '2026-08-01T00:00:00Z', sources([LODES_MISSING, src('D8', 'failed')])), report('b', '2026-08-02T00:00:00Z', sources([LODES_MISSING]))],
    counts: { iq_lodes_wac: 5, iq_poi: 0, iq_poi_snapshot: 0 },
    regen: () => ({ sources: sources() }),
    search: () => ({ provider: 'tavily', cost_usd: 0.03, hits: [hit('https://data.sfgov.org/lease-rates', 'Lease rates', 'open data API')] }),
  });
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 200_000, maxReports: 1, maxSearches: 1, dryRun: true, deps: rec.deps, now: () => T0, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.dry_run, true);
  assert.equal(r.gaps.D3, 2);
  assert.deepEqual(r.would_regenerate, ['a']);
  assert.deepEqual(r.regenerated, []);
  assert.equal(r.searches, 1);
  assert.equal(r.candidates_found, 1);
  assert.equal(r.candidates_added, 0);
  assert.equal(r.cost_usd, 0.03);
  assert.ok(!rec.calls.some((c) => c.startsWith('regenerate') || c.startsWith('insert:') || c === 'insertRun'), rec.calls.join(','));
  assert.equal(rec.inserted.length, 0);
  assert.equal(rec.runs.length, 0);
  assert.equal(rec.committed.length, 0);
});

test('never throws: scan failure → ok=false with reason, no fill / discovery, run row still attempted; write failures flagged', async () => {
  const rec = makeDeps({ failListReports: true });
  const r = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 200_000, deps: rec.deps, now: () => T0, log: () => {} });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /scan failed: relation iq_location_reports missing/);
  assert.equal(r.reports_scanned, 0);
  assert.equal(r.searches, 0);
  assert.ok(!rec.calls.some((c) => c.startsWith('tableCounts')));
  assert.equal(rec.runs.length, 1);
  assert.equal(rec.runs[0].notes.ok, false);

  const rec2 = makeDeps({
    reports: [report('a', '2026-08-01T00:00:00Z', sources([src('D8', 'failed')]))],
    search: () => ({ provider: 'tavily', cost_usd: 0.03, hits: [hit('https://data.sfgov.org/x', 'X', 'open data')] }),
  });
  rec2.deps.insertCandidates = async () => {
    throw new Error('relation iq_source_candidates does not exist');
  };
  rec2.deps.insertRun = async () => {
    throw new Error('relation iq_source_gap_runs does not exist');
  };
  const r2 = await runSourceGapAgent({ metro: 'sf-bay', budgetMs: 200_000, maxSearches: 1, deps: rec2.deps, now: () => T0, log: () => {} });
  assert.equal(r2.ok, false);
  assert.match(r2.reason ?? '', /candidate insert failed/);
  assert.ok(r2.notes.some((n) => /run row insert failed/.test(n)));
  assert.equal(r2.candidates_added, 0);

  // Deps factory itself blowing up is caught too.
  const r3 = await runSourceGapAgent({
    metro: 'sf-bay',
    budgetMs: 1_000,
    deps: new Proxy({} as SourceGapDeps, {
      get() {
        throw new Error('proxy');
      },
    }),
    now: () => T0,
    log: () => {},
  });
  assert.equal(r3.ok, false);
  assert.match(r3.reason ?? '', /proxy/);
});

// ───────────────────────────── runOps wiring ─────────────────────────────

const fakeResult = (p: OpsParams, budgetMs: number): SourceGapAgentResult => ({
  ok: true,
  reason: null,
  metro: p.metro,
  reports_scanned: 3,
  gaps: { D1: 0, D2: 0, D3: 1, D4: 0, D5: 0, D6: 0, D7: 0, D8: 2, D9: 0, D10: 0, D11: 0, D12: 0 },
  table_counts: null,
  regenerated: [],
  improved: [],
  would_regenerate: [],
  searches: 1,
  queries: [`b=${budgetMs}`],
  candidates_found: 1,
  candidates_added: 1,
  cost_usd: 0.03,
  notes: [],
  truncated: false,
  elapsed_ms: 1,
  dry_run: p.dryRun,
});

function runners(calls: string[]): OpsRunners {
  return {
    migrate: async () => ({ ok: true, applied: [], reason: null }),
    hubs: async (p) => ({ metro: p.metro, hubs_total: 0, hubs_done: 0, hubs_skipped: [], cuisines_written: 0, medians: {}, cost_usd: 0, warnings: [], truncated: false, elapsed_ms: 1, dry_run: false }),
    snapshots: async (p) => ({ metro: p.metro, month: '2026-09-01', hubs: 0, hubs_done: 0, places: 0, places_with_counts: 0, rows_upserted: 0, calls: 0, details_calls: 0, linked_total: 0, linked_missing: 0, cost_usd: 0, cost_by_source: {}, warnings: [], truncated: false, elapsed_ms: 1, dry_run: false }),
    lodes: async () => ({ rows_upserted: 0, rows_scanned: 0, counties_done: [], counties_remaining: [], counties_skipped: [], truncated: false, truncated_reason: null, elapsed_ms: 1, dry_run: false, url: 'x' }),
    source_gaps: async (p, budgetMs) => {
      calls.push(`source_gaps:${budgetMs}:${p.maxReports ?? '-'}:${p.maxSearches ?? '-'}`);
      return fakeResult(p, budgetMs);
    },
  };
}

test('runOps: task=source_gaps parses, gets the whole budget, passes maxReports/maxSearches and reports cost', async () => {
  const p = parseOpsParams(new URLSearchParams('task=source_gaps&metro=sf-bay&maxReports=2&maxSearches=5'));
  assert.equal(p.task, 'source_gaps');
  assert.equal(p.maxReports, 2);
  assert.equal(p.maxSearches, 5);
  assert.equal(parseOpsParams(new URLSearchParams('task=source_gaps')).maxReports, undefined);
  assert.throws(() => parseOpsParams(new URLSearchParams('task=source_gaps&maxReports=-1')), /maxReports/);
  assert.throws(() => parseOpsParams(new URLSearchParams('maxSearches=two')), /maxSearches/);

  const calls: string[] = [];
  const r = await runOps(p, { budgetMs: 280_000, runners: runners(calls), log: () => {}, now: () => 0 });
  assert.equal(r.ok, true);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].task, 'source_gaps');
  assert.equal(r.tasks[0].cost_usd, 0.03);
  assert.deepEqual(calls, ['source_gaps:260000:2:5']);
});

test('runOps all: source_gaps runs after lodes with the remaining budget, or is skipped (ok) under 60 s', async () => {
  const base: OpsParams = { task: 'all', metro: 'sf-bay', state: 'ca', year: 2022, counties: ['06081'], dryRun: false, maxDetails: 0, force: false };
  const calls: string[] = [];
  const r = await runOps(base, { budgetMs: 280_000, runners: runners(calls), log: () => {}, now: () => 0 });
  assert.deepEqual(
    r.tasks.map((t) => t.task),
    ['migrate', 'hubs', 'snapshots', 'lodes', 'source_gaps'],
  );
  assert.equal(calls[0], 'source_gaps:260000:-:-');
  assert.equal(r.cost_usd, 0.03);

  // lodes ate the invocation → skipped with ok=true and an explanatory result.
  let clock = 0;
  const calls2: string[] = [];
  const rs = runners(calls2);
  rs.lodes = async () => {
    clock = 280_000 - 20_000 - SOURCE_GAPS_MIN_BUDGET_MS + 1;
    return { rows_upserted: 0, rows_scanned: 0, counties_done: [], counties_remaining: [], counties_skipped: [], truncated: true, truncated_reason: 'budget', elapsed_ms: 1, dry_run: false, url: 'x' };
  };
  const r2 = await runOps(base, { budgetMs: 280_000, runners: rs, log: () => {}, now: () => clock });
  assert.equal(r2.ok, true);
  const sg = r2.tasks.find((t) => t.task === 'source_gaps');
  assert.ok(sg);
  assert.equal(sg.ok, true);
  assert.match(String((sg.result as { skipped?: string }).skipped), /less than 60 s remaining/);
  assert.deepEqual(calls2, []);

  // A single explicit task without a runner is an error, not a silent skip.
  const noRunner = runners([]);
  delete noRunner.source_gaps;
  const r3 = await runOps({ ...base, task: 'source_gaps' }, { budgetMs: 280_000, runners: noRunner, log: () => {}, now: () => 0 });
  assert.equal(r3.ok, false);
  assert.match(r3.tasks[0].error ?? '', /not configured/);
  // …while `all` without a runner just leaves it out (older runner sets keep working).
  const r4 = await runOps(base, { budgetMs: 280_000, runners: noRunner, log: () => {}, now: () => 0 });
  assert.deepEqual(
    r4.tasks.map((t) => t.task),
    ['migrate', 'hubs', 'snapshots', 'lodes'],
  );
});
