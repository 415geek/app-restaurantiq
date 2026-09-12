import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circlePolygon, destination } from '../geo';
import { applyLlmClassifications, classifyCandidate, clusterScoreFor, computeCompetitors, dedupeCandidates, type CandidatePoi } from './competitor';
import type { Ring } from '../model/schema';

const site = { lat: 37.5985, lng: -122.3872 };
const walk10 = circlePolygon(site, 800, 48);
const drive10 = circlePolygon(site, 4_828, 48);
const rings: Ring[] = [
  { id: 'drive10', method: 'radius', minutes: 10, radius_mi: 3, geometry: drive10, area_sq_mi: 28, pop: 60_000, hh: 22_000, median_income: 130_000, chinese_hh_share: 0.3, chinese_pop: 18_000, age_25_44_share: 0.3, family_share: 0.3, avg_hh_size: 2.7, renter_share: 0.4, jobs: 20_000, jobs_method: 'lodes_wac', restaurant_spend_usd: 1e8, chinese_spend_usd: 2e7, cuisine_demand_usd: 2e6, block_groups: 40 },
];

function poi(id: string, name: string, bearing: number, distM: number, over: Partial<CandidatePoi> = {}): CandidatePoi {
  const p = destination(site, bearing, distM);
  return { id, source: 'overture', name, lat: p.lat, lng: p.lng, categories: ['chinese_restaurant'], primary_category: 'chinese_restaurant', operating_status: 'open', rating: 4.2, rating_count: 300, price_level: 2, ...over };
}

test('classifier rule → keyword → leftover', () => {
  assert.equal(classifyCandidate(poi('a', 'Hunan Impression', 0, 100)).sub_cuisine, 'hunan');
  assert.equal(classifyCandidate(poi('b', 'Golden Wok', 0, 100)).sub_cuisine, 'chinese_fast');
  assert.equal(classifyCandidate(poi('b2', 'Golden Dragon', 0, 100)).sub_cuisine, 'other_chinese');
  const j = classifyCandidate(poi('c', 'Sushi Ran', 0, 100, { categories: ['japanese_restaurant'], primary_category: 'japanese_restaurant' }));
  assert.equal(j.is_chinese, false);
  const cjk = classifyCandidate(poi('d', '老友记', 0, 100, { categories: ['restaurant'], primary_category: 'restaurant' }));
  assert.equal(cjk.sub_cuisine, null);
  assert.equal(cjk.is_chinese, true);
});

test('dedupe merges Overture + Google within 100 m, keeps both ids, Google freshness wins', () => {
  const o = poi('ov1', 'Hunan Home Restaurant', 0, 200, { rating: null, rating_count: null });
  const g = poi('g1', 'Hunan Home', 0, 230, { source: 'google', rating: 4.4, rating_count: 900, operating_status: 'OPERATIONAL' });
  const m = dedupeCandidates(site, [o, g]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].ids, { overture: 'ov1', google: 'g1' });
  assert.equal(m[0].rating_count, 900);
});

test('layers, metrics, void conditions and guard', () => {
  const cands: CandidatePoi[] = [
    poi('h1', 'Hunan Impression', 10, 500),
    poi('h2', '湘味轩', 200, 3_000, { rating_count: 1_200, rating: 4.5 }),
    poi('s1', 'Little Sichuan', 20, 600),
    poi('c1', 'Koi Palace Dim Sum', 30, 1_500, { rating_count: 5_000, price_level: 3 }),
    poi('c2', 'Golden Dragon', 40, 700),
    poi('c3', 'Panda Express', 50, 400, { rating_count: 200 }),
    poi('c4', 'Hong Kong Flower Lounge', 60, 900),
    poi('dead', 'Old Hunan Place', 70, 800, { operating_status: 'closed_permanently' }),
    poi('j1', 'Sushi Ran', 80, 300, { categories: ['japanese_restaurant'], primary_category: 'japanese_restaurant', price_level: 2 }),
    poi('r1', '99 Ranch Market', 90, 600, { categories: ['asian_grocery_store'], primary_category: 'asian_grocery_store' }),
    poi('bank', 'East West Bank', 100, 500, { categories: ['bank'], primary_category: 'bank' }),
    ...Array.from({ length: 12 }, (_, i) => poi(`f${i}`, `Generic Eatery ${i}`, i * 25, 1_200 + i * 100, { categories: ['restaurant'], primary_category: 'restaurant' })),
  ];
  const r = computeCompetitors({ site, cuisine: 'hunan', candidates: cands, rings, walk10, drive10, metro_sub_cuisine_total: 25, hub_median_density_per_10k_chinese: 2.0, traffic: {}, ticket_in: 24, target_price_level: 2 });
  assert.equal(r.l1.length, 2, JSON.stringify(r.l1.map((x) => x.name)));
  assert.ok(r.l2_count >= 5, String(r.l2_count));
  assert.equal(r.l3_count, 1);
  assert.equal(r.l4.length, 2);
  assert.ok(r.closure_rate! > 0);
  assert.ok(r.hhi! > 0 && r.hhi! <= 1);
  assert.ok(r.walk10_l1_l2_count >= 4);
  assert.equal(r.guard_passed, true, r.guard_notes.join('; '));
  assert.ok(r.chain_names.includes('Panda Express'));
  assert.equal(r.void.is_void, false); // density above threshold: 2 L1 / 18k chinese = 1.11 per 10k vs hub 2.0 → 0.56 ≥ 0.5
  assert.equal(r.benchmark_revenue_band.method, 'insufficient_history');
});

test('R1 guard: metro has the cuisine but drive10 has zero → DataIntegrityError signal', () => {
  const r = computeCompetitors({ site, cuisine: 'hunan', candidates: [], rings, walk10, drive10, metro_sub_cuisine_total: 25, hub_median_density_per_10k_chinese: 2, traffic: {}, ticket_in: 24, target_price_level: 2 });
  assert.equal(r.guard_passed, false);
  assert.ok(r.guard_notes.some((n) => n.includes('竞品抓取异常')));
  assert.ok(r.guard_notes.some((n) => n.includes('POI 覆盖异常')));
});

test('cluster score U-shape and LLM leftovers', () => {
  assert.equal(clusterScoreFor(0, null), 30);
  assert.equal(clusterScoreFor(5, null), 85);
  assert.equal(clusterScoreFor(20, null), 35);
  assert.equal(clusterScoreFor(5, 1.3), 95);
  const m = dedupeCandidates(site, [poi('x', '老友记', 0, 100, { categories: ['restaurant'], primary_category: 'restaurant' })]);
  applyLlmClassifications(m, [{ id: 'x', sub_cuisine: 'dongbei', confidence: 0.9 }]);
  assert.equal(m[0].sub_cuisine, 'dongbei');
  const m2 = dedupeCandidates(site, [poi('y', '好味道', 0, 100, { categories: ['restaurant'], primary_category: 'restaurant' })]);
  applyLlmClassifications(m2, [{ id: 'y', sub_cuisine: 'hunan', confidence: 0.4 }]);
  assert.equal(m2[0].sub_cuisine, 'other_chinese');
});
