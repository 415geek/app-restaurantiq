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

test('§4.1 general-audience concept: audience fit scores household density + income, never the Chinese share; wording says same-category', () => {
  const egg: ScoreInput = { ...good, cuisine: 'egg_tart', range_class: 'everyday', primary_ring: { ...good.primary_ring, chinese_hh_share: 0.02 } };
  const dims = scoreDimensions(egg);
  const fit = dims.find((d) => d.id === 'audience_fit')!;
  assert.ok(!fit.drivers.some((x) => /^中文家庭占比/.test(x)), fit.drivers.join(' | '));
  assert.match(fit.drivers[0], /大众客群业态：主商圈户密度 1025 户\/平方英里/);
  // the same site scored as a Hunan concept with a 2 % Chinese share is penalised; the egg-tart shop is not
  const hunanLow = scoreDimensions({ ...good, primary_ring: { ...good.primary_ring, chinese_hh_share: 0.02 } }).find((d) => d.id === 'audience_fit')!;
  assert.ok(fit.score > hunanLow.score, `${fit.score} vs ${hunanLow.score}`);
  const comp = dims.find((d) => d.id === 'competitive_position')!;
  assert.match(comp.drivers[0], /同类目门店/);
  const weakAudience: ScoreInput = { ...egg, primary_ring: { ...egg.primary_ring, hh: 2_000, area_sq_mi: 40, median_income: 40_000 } };
  const conds = buildConditions(scoreDimensions(weakAudience), weakAudience);
  const aud = conds.find((c) => c.dimension === 'audience_fit');
  assert.ok(aud && /户密度 50 户/.test(aud.text_zh) && /Household density 50/.test(aud.text_en), JSON.stringify(conds));
  assert.ok(!conds.some((c) => /中餐|Chinese restaurants/.test(c.text_zh + c.text_en)));
});

/* §4.3 daypart-driven advice (P0-C) --------------------------------------- */

const dayparts = (b: number, l: number, a: number, d: number) => [
  { id: 'breakfast' as const, share: b, monthly_usd: Math.round(b * 100_000) },
  { id: 'lunch' as const, share: l, monthly_usd: Math.round(l * 100_000) },
  { id: 'afternoon' as const, share: a, monthly_usd: Math.round(a * 100_000) },
  { id: 'dinner' as const, share: d, monthly_usd: Math.round(d * 100_000) },
];

/** The 场景与外卖 dimension forced to be the weakest, so its condition is always emitted. */
function occasionCondition(cuisine: string, dp: ReturnType<typeof dayparts>) {
  const input: ScoreInput = {
    ...good,
    cuisine,
    competitors: { ...good.competitors, l1_delivery_share: 0 },
    drive5: { hh: 300, area_sq_mi: 40 },
    jobs_walk10: 100,
    demand: { ...good.demand, dayparts: dp },
  };
  const conds = buildConditions(scoreDimensions(input), input);
  return conds.find((c) => c.dimension === 'occasion_delivery');
}

test('§4.3 P0-C: the 午市套餐 + 外卖平台 advice never fires for a bakery; it gets morning / afternoon advice instead', () => {
  // egg_tart is 35 / 25 / 30 / 10 and the modelled mix matches it, so the lunch trigger cannot fire.
  const c = occasionCondition('egg_tart', dayparts(0.35, 0.25, 0.3, 0.1));
  assert.ok(c, 'the occasion condition is emitted');
  assert.doesNotMatch(c!.text_zh, /≤ \$18 套餐/, c!.text_zh);
  assert.doesNotMatch(c!.text_en, /add a ≤ \$18 set menu/, c!.text_en);
  assert.match(c!.text_zh, /早市与午后/);
  assert.match(c!.text_en, /front-loaded/);
  // Even when the site under-delivers the bakery's lunch, the format is not lunch-dependent enough to fire it.
  const under = occasionCondition('egg_tart', dayparts(0.45, 0.15, 0.3, 0.1));
  assert.doesNotMatch(under!.text_zh, /≤ \$18 套餐/, under!.text_zh);
});

test('§4.3 P0-C: a 茶餐厅 whose modelled lunch falls below its own 40 % DOES get the lunch-set advice', () => {
  const c = occasionCondition('hk_cafe', dayparts(0.2, 0.28, 0.17, 0.35));
  assert.ok(c);
  assert.match(c!.text_zh, /午市偏弱[\s\S]*40%[\s\S]*28%[\s\S]*≤ \$18 套餐/, c!.text_zh);
  assert.match(c!.text_en, /Weak lunch[\s\S]*40%[\s\S]*28%[\s\S]*set menu/, c!.text_en);
  // ...and not when the site actually delivers that lunch.
  const ok = occasionCondition('hk_cafe', dayparts(0.15, 0.45, 0.15, 0.25));
  assert.doesNotMatch(ok!.text_zh, /午市偏弱/, ok!.text_zh);
  assert.match(ok!.text_zh, /午市已是主力时段/);
});

test('§4.3: a dinner-led concept is told to staff the evening, not to build a lunch service', () => {
  const c = occasionCondition('hot_pot', dayparts(0, 0.2, 0.05, 0.75));
  assert.ok(c);
  assert.doesNotMatch(c!.text_zh, /≤ \$18 套餐/);
  assert.match(c!.text_zh, /主力时段在晚市/);
  assert.match(c!.text_en, /dinner-led/);
});

test('§4.3: 场景与外卖 weights the site by the concept’s own dayparts — a bakery is not marked down for a 10 % evening', () => {
  const site = { ...good, drive5: { hh: 9_000, area_sq_mi: 3.1 }, jobs_walk10: 500 };
  const bakery = scoreDimensions({ ...site, cuisine: 'egg_tart', demand: { ...good.demand, dayparts: dayparts(0.35, 0.25, 0.3, 0.1) } }).find((d) => d.id === 'occasion_delivery')!;
  const cafe = scoreDimensions({ ...site, cuisine: 'hk_cafe', demand: { ...good.demand, dayparts: dayparts(0.15, 0.4, 0.15, 0.3) } }).find((d) => d.id === 'occasion_delivery')!;
  // Almost no walk-10 jobs: the lunch-heavy 茶餐厅 is the one that suffers, not the bakery.
  assert.ok(bakery.score > cafe.score, `${bakery.score} vs ${cafe.score}`);
  assert.match(bakery.drivers[0], /业态时段分布 早市 35% \/ 午市 25% \/ 午后 30% \/ 晚市 10%/);
});
