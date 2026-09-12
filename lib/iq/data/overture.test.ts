import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { fetchOverturePois, type OverturePoiRow } from './overture';
import type { FetchContext } from './types';
import type { BBox } from '@/lib/iq/geo';

const rows = JSON.parse(readFileSync(join(process.cwd(), 'qa', 'fixtures', 'overture_pois_millbrae.json'), 'utf8')) as OverturePoiRow[];
const millbrae = { lat: 37.5985, lng: -122.3872, radiusM: 1609, metro: 'sf-bay' };

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

const inBbox = (b: BBox, r: OverturePoiRow) => r.lat >= b.minLat && r.lat <= b.maxLat && r.lng >= b.minLng && r.lng <= b.maxLng;

test('D5 fixture rows → pois within radius, zh names, metro counts by sub-cuisine', async () => {
  const c = ctx();
  const seen: BBox[] = [];
  const r = await fetchOverturePois(millbrae, c, {
    poiQuery: async (bbox, metro) => {
      seen.push(bbox);
      return rows.filter((x) => x.metro === metro && inBbox(bbox, x));
    },
  });
  assert.equal(r.status, 'ok', r.coverage_note);
  assert.equal(r.cache, 'miss');
  const d = r.data!;
  assert.equal(d.loaded, true);
  assert.equal(d.release, '2026-08-20.0');
  // 40 fixture rows: 2 sit in the bbox corners beyond 1 mi and must be dropped by the haversine filter.
  assert.equal(d.pois.length, 38);
  assert.ok(d.pois.every((p) => p.distance_m <= 1609));
  for (let i = 1; i < d.pois.length; i++) assert.ok(d.pois[i - 1].distance_m <= d.pois[i].distance_m, 'sorted by distance');
  const chinese = d.pois.filter((p) => p.sub_cuisine && p.sub_cuisine !== 'boba');
  assert.ok(chinese.length >= 10, String(chinese.length));
  const ranch = d.pois.find((p) => p.name === '99 Ranch Market')!;
  assert.equal(ranch.name_zh, '大华超级市场');
  assert.equal(ranch.brand, '99 Ranch Market');
  assert.deepEqual(ranch.taxonomy_path, ['retail', 'food', 'grocery_store', 'asian_grocery_store']);
  assert.ok(d.pois.some((p) => p.primary_category === 'bubble_tea_shop' && p.sub_cuisine === 'boba'));
  assert.ok(d.pois.some((p) => p.operating_status === 'closed_permanently'));
  const hunan = d.pois.find((p) => p.sub_cuisine === 'hunan')!;
  assert.ok(hunan.google_place_id?.startsWith('ChIJ'));
  // Metro counts derived from the metro bbox query (second poiQuery call) since no summary dep was given.
  assert.equal(seen.length, 2);
  assert.equal(d.metro_counts_by_sub_cuisine.hunan, 2);
  assert.equal(d.metro_counts_by_sub_cuisine.sichuan, 3);
  assert.equal(d.metro_counts_by_sub_cuisine.boba, 2);
  assert.ok(r.coverage_note.includes('38'));

  // 24 h cache keyed by bbox + metro.
  const again = await fetchOverturePois(millbrae, c, {
    poiQuery: async () => {
      throw new Error('should hit cache');
    },
  });
  assert.equal(again.cache, 'hit');
  assert.equal(again.data!.pois.length, 38);
});

test('D5 metroSummaryQuery dep is used verbatim; unclassified metro → partial', async () => {
  const r = await fetchOverturePois(millbrae, ctx(), {
    poiQuery: async (bbox) => rows.filter((x) => inBbox(bbox, x)).map((x) => ({ ...x, sub_cuisine: null, sub_cuisine_confidence: null })),
    metroSummaryQuery: async () => ({ total: 12_000, by_sub_cuisine: {}, release: '2026-07-23.0' }),
  });
  assert.equal(r.status, 'partial');
  assert.equal(r.data!.release, '2026-07-23.0');
  assert.deepEqual(r.data!.metro_counts_by_sub_cuisine, {});
  assert.ok(r.coverage_note.includes('12000'));
  assert.ok(r.coverage_note.includes('未分类'));
});

test('D5 empty table → failed with load instruction', async () => {
  const r = await fetchOverturePois(millbrae, ctx(), { poiQuery: async () => [] });
  assert.equal(r.status, 'failed');
  assert.equal(r.coverage_note, 'iq_poi 未加载：运行 scripts/load_overture.py --metro sf-bay');
  assert.equal(r.data?.loaded, false);
  assert.deepEqual(r.data?.pois, []);
  assert.equal(r.cost_usd, 0);
});

test('D5 no deps and no Supabase env → failed, never throws', async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetchOverturePois(millbrae, ctx());
    assert.equal(r.status, 'failed');
    assert.ok(r.coverage_note.startsWith('iq_poi 未加载 / Supabase 未配置'), r.coverage_note);
    assert.equal(r.data, null);
  } finally {
    if (saved.url) process.env.SUPABASE_URL = saved.url;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});
