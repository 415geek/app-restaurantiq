import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConditions, scoreDimensions, totalScore, verdictFor, type ScoreInput } from './cuisine-fit';
import { computeConfidence } from './confidence';

const good: ScoreInput = {
  cuisine: 'hunan',
  range_class: 'destination',
  coverage_ratio: 1.12,
  primary_ring: { chinese_hh_share: 0.31, median_income: 150_000, family_share: 0.32, hh: 41_000, area_sq_mi: 40 },
  drive5: { hh: 9_000, area_sq_mi: 3.1 },
  jobs_walk10: 6_800,
  competitors: { cluster_score: 85, walk10_l1_l2_count: 5, avg_rating_l1: 4.1, closure_rate: 0.1, l1_delivery_share: 0.7 },
  access: { walkable_rail: true, nearest_rail_m: 400, max_aadt: 28_000, parking: { spaces: 40, source: 'user_input' }, transit_commute_share: 0.22 },
  finance: { occupancy_cost_ratio: 0.09, rent: 12_000, breakeven_monthly: 104_000, safety_monthly: 133_000, base_revenue: 140_000 },
  demand: { captured_monthly_usd: 116_000, lunch_usd: 35_000, dinner_usd: 81_000 },
};

test('R5: one score function; weights sum 100; total = Σ weighted', () => {
  const dims = scoreDimensions(good);
  assert.equal(dims.length, 6);
  assert.equal(dims.reduce((s, d) => s + d.weight, 0), 100);
  const total = totalScore(dims);
  const manual = Math.round(dims.reduce((s, d) => s + (d.score * d.weight) / 100, 0) * 10) / 10;
  assert.equal(total, manual);
  assert.ok(total >= 60, String(total));
  assert.equal(verdictFor(80), 'GO');
  assert.equal(verdictFor(62), 'CONDITIONAL_GO');
  assert.equal(verdictFor(40), 'NO_GO');
});

test('conditions derive from the two weakest dimensions with back-solved numbers', () => {
  const weakFinance = { ...good, finance: { ...good.finance, occupancy_cost_ratio: 0.14 }, demand: { ...good.demand, captured_monthly_usd: 90_000 }, coverage_ratio: 0.85 };
  const dims = scoreDimensions(weakFinance);
  const conds = buildConditions(dims, weakFinance);
  assert.equal(conds.length, 2);
  const fin = conds.find((c) => c.dimension === 'financial_viability');
  assert.ok(fin && fin.value === 9_000, JSON.stringify(conds));
});

test('missing inputs → neutral 50 with a driver note, never a fabricated number', () => {
  const dims = scoreDimensions({ ...good, coverage_ratio: null, jobs_walk10: null, access: { walkable_rail: null, nearest_rail_m: null, max_aadt: null, parking: { spaces: null, source: 'none' }, transit_commute_share: null } });
  assert.equal(dims.find((d) => d.id === 'demand_coverage')!.score, 50);
  assert.ok(dims.find((d) => d.id === 'demand_coverage')!.drivers[0].includes('未知'));
});

test('confidence is computed from source status', () => {
  const c = computeConfidence({
    sources: { D2: { status: 'ok', coverage_note: '' }, D5: { status: 'ok', coverage_note: '' }, D6: { status: 'ok', coverage_note: '' }, D7: { status: 'partial', coverage_note: '' }, D8: { status: 'failed', coverage_note: '' }, D3: { status: 'ok', coverage_note: '' }, D9: { status: 'ok', coverage_note: '' }, D11: { status: 'failed', coverage_note: '' } },
    guard_passed: true,
    user: { rent_usd: 12_000, sqft: 2_200, seats: 60, capex_usd: null },
  });
  // 20 + 25 + 7.5 + 0 + 10 + 5 + 0 + 5 = 72.5 → 73 medium
  assert.equal(c.total, 73);
  assert.equal(c.level, 'medium');
  const failed = computeConfidence({ sources: {}, guard_passed: false, user: { rent_usd: null, sqft: null, seats: null, capex_usd: null } });
  assert.equal(failed.total, 0);
  assert.equal(failed.level, 'low');
});
