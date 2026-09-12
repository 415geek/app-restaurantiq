import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { fetchTrafficProxy, percentileOf, summarizeSnapshots, tierOf, type SnapshotRow } from './traffic-proxy';
import type { FetchContext } from './types';

const FIX = join(process.cwd(), 'qa', 'fixtures');
const snaps = JSON.parse(readFileSync(join(FIX, 'poi_snapshots_sample.json'), 'utf8')) as Array<SnapshotRow & { metro: string }>;
const chinese = JSON.parse(readFileSync(join(FIX, 'google_places_nearby_chinese_1mi.json'), 'utf8')) as {
  places: Array<{ id: string; displayName: { text: string }; userRatingCount: number }>;
};
const placeIds = chinese.places.map((p) => p.id);
const currentCounts = Object.fromEntries(chinese.places.map((p) => [p.id, p.userRatingCount]));
const idOf = (name: string) => chinese.places.find((p) => p.displayName.text === name)!.id;

function ctx(): FetchContext {
  return {
    fetch: async () => {
      throw new Error('network must not be used');
    },
    cost: createCostLedger(),
    cache: createMemoryCache(),
    env: () => null,
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
  };
}

test('D7 helpers: summarize / percentile / tier', () => {
  const s = summarizeSnapshots(snaps);
  assert.equal(s.latest_month, '2026-08-01');
  assert.equal(Object.keys(s.growth).length, 16); // 10 requested + 6 metro peers
  assert.equal(s.growth[idOf('Little Sichuan Millbrae')].monthly_review_growth, 24);
  assert.equal(s.growth[idOf('Little Sichuan Millbrae')].months_of_history, 7);
  assert.equal(s.growth[idOf('Golden Cantonese Seafood')].months_of_history, 5);
  assert.equal(s.months[idOf('Panda Express')], 1);
  assert.equal(s.growth[idOf('Panda Express')], undefined);
  assert.equal(percentileOf(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 50);
  assert.equal(tierOf(0), 1);
  assert.equal(tierOf(50), 3);
  assert.equal(tierOf(81), 5);
});

test('D7 snapshot_growth: places with history ranked by monthly growth among metro peers', async () => {
  const c = ctx();
  const queried: string[] = [];
  const r = await fetchTrafficProxy(
    { placeIds, metro: 'sf-bay', currentCounts },
    c,
    {
      snapshotQuery: async (metro, since) => {
        queried.push(since);
        return snaps.filter((s) => s.metro === metro && s.snapshot_month >= since);
      },
    },
  );
  assert.deepEqual(queried, ['2025-08-01'], '13 months back from now()');
  assert.equal(r.status, 'partial', r.coverage_note); // 4 of 14 have no history
  const d = r.data!;
  assert.equal(d.method, 'snapshot_growth');
  assert.equal(d.metro_sample_size, 16);
  assert.equal(d.latest_snapshot_month, '2026-08-01');
  const ls = d.per_place[idOf('Little Sichuan Millbrae')];
  assert.equal(ls.monthly_review_growth, 24);
  assert.equal(ls.months_of_history, 7);
  assert.equal(ls.traffic_tier, 5);
  assert.ok(ls.percentile! > 80);
  const gc = d.per_place[idOf('Golden Cantonese Seafood')];
  assert.equal(gc.monthly_review_growth, 4);
  assert.ok(gc.traffic_tier! <= 2, String(gc.traffic_tier));
  // Single-snapshot place falls back to current-count percentile among the latest month.
  const panda = d.per_place[idOf('Panda Express')];
  assert.equal(panda.monthly_review_growth, null);
  assert.equal(panda.months_of_history, 1);
  assert.ok(panda.traffic_tier != null);
  // Place absent from snapshots but with a current count still gets a relative tier.
  const mama = d.per_place[idOf('Mama Ji Sichuan Bistro')];
  assert.equal(mama.months_of_history, 1);
  assert.ok(mama.percentile != null);
  assert.equal(Object.keys(d.per_place).length, placeIds.length);
  assert.ok(r.coverage_note.includes('10/14'));
  assert.ok(r.coverage_note.includes('相对值'));
  assert.ok(!/客流.*人次|foot traffic/i.test(r.coverage_note));
  assert.equal(r.cost_usd, 0);

  // Metro summary cached for the month.
  const again = await fetchTrafficProxy({ placeIds: placeIds.slice(0, 2), metro: 'sf-bay', currentCounts }, c, {
    snapshotQuery: async () => {
      throw new Error('should hit cache');
    },
  });
  assert.equal(again.cache, 'hit');
  assert.equal(again.status, 'ok');
});

test('D7 review_percentile: no snapshots → tiers from current counts only, partial', async () => {
  const r = await fetchTrafficProxy({ placeIds, metro: 'sf-bay', currentCounts }, ctx(), { snapshotQuery: async () => [] });
  assert.equal(r.status, 'partial');
  assert.equal(r.degraded_from, 'snapshot_growth');
  assert.ok(r.coverage_note.includes('无历史快照 → 相对等级（评论数百分位）'), r.coverage_note);
  const d = r.data!;
  assert.equal(d.method, 'review_percentile');
  assert.equal(d.metro_sample_size, placeIds.length);
  assert.equal(d.latest_snapshot_month, null);
  const top = d.per_place[idOf('Hong Kong Flower Lounge Dim Sum')]; // 3105 reviews → top
  assert.equal(top.traffic_tier, 5);
  assert.equal(top.percentile, 100);
  assert.equal(top.monthly_review_growth, null);
  assert.equal(top.months_of_history, 0);
  const low = d.per_place[idOf('Mama Ji Sichuan Bistro')]; // 98 reviews → bottom
  assert.equal(low.traffic_tier, 1);
  for (const p of Object.values(d.per_place)) assert.ok(p.traffic_tier != null && p.percentile != null);
});

test('D7 no deps + no Supabase env → still relative tiers from current counts, notes the missing table', async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetchTrafficProxy({ placeIds, metro: 'sf-bay', currentCounts }, ctx());
    assert.equal(r.status, 'partial');
    assert.equal(r.data!.method, 'review_percentile');
    assert.ok(r.coverage_note.includes('Supabase 未配置'));
    assert.equal(r.cache, 'none');
  } finally {
    if (saved.url) process.env.SUPABASE_URL = saved.url;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

test('D7 insufficient sample → failed, never an absolute number', async () => {
  const two = placeIds.slice(0, 2);
  const r = await fetchTrafficProxy(
    { placeIds: two, metro: 'sf-bay', currentCounts: { [two[0]]: 10, [two[1]]: 20 } },
    ctx(),
    { snapshotQuery: async () => [] },
  );
  assert.equal(r.status, 'failed');
  assert.ok(r.coverage_note.includes('未获取'));
  assert.equal(r.data!.per_place[two[0]].traffic_tier, null);
  const empty = await fetchTrafficProxy({ placeIds: [], metro: 'sf-bay', currentCounts: {} }, ctx(), { snapshotQuery: async () => [] });
  assert.equal(empty.status, 'ok');
  assert.deepEqual(empty.data!.per_place, {});
});
