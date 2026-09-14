import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinance, rentForOccupancyTarget, scenarioRevenue, type FinanceInput } from './finance';

const millbrae: FinanceInput = {
  cuisine: 'hunan',
  rent_usd: 12_000,
  sqft: 2_200,
  seats: 60,
  capex_usd: null,
  ticket_in: 24,
  ticket_delivery: 28,
  delivery_ratio: 0.25,
  median_income: 150_000,
  state: 'CA',
  captured_monthly_usd: null,
};

test('R4: scenario table is self-consistent (orders ↔ revenue, seats × turns)', () => {
  const f = computeFinance(millbrae);
  for (const s of f.scenarios) {
    assert.equal(s.seats, 60);
    assert.ok(Math.abs(s.dine_in_covers_day - 60 * s.turns_per_day) < 0.11, `${s.id} covers`);
    const recomputed = (s.dine_in_covers_day * s.ticket_in + s.delivery_orders_day * s.ticket_delivery) * s.days_open;
    assert.ok(Math.abs(recomputed - s.monthly_revenue) < 60, `${s.id} revenue ${recomputed} vs ${s.monthly_revenue}`); // rounding of 0.1 orders
    assert.ok(Math.abs(s.orders_day - (s.dine_in_covers_day + s.delivery_orders_day)) < 0.2);
  }
  // 60 seats × 2.3 turns would be 138 covers/day — never 246.
  const base = f.scenarios[1];
  assert.ok(base.orders_day < 200);
  assert.equal(f.payback_months, null, 'no capex → no payback');
  assert.ok(f.inputs_missing.some((x) => x.startsWith('capex')));
  assert.equal(f.fixed_cost.rent, 12_000);
  assert.equal(f.rent_source, 'user_input');
  assert.equal(f.rent_excluded, false);
  const be = f.breakeven_monthly!;
  assert.ok(be > 50_000 && be < 150_000, String(be));
  assert.equal(f.safety_monthly, Math.round(be * 1.28));
  assert.equal(f.sensitivity.length, 4);
  assert.equal(f.sensitivity[0].id, 'rent_plus_10');
  assert.ok(!f.sensitivity.some((s) => s.id === 'rent_per_1000'));
  assert.ok(!f.inputs_missing.some((x) => x.startsWith('rent')));
});

test('rent given: the numbers are exactly what the fixed-cost identity says (no behaviour change)', () => {
  const f = computeFinance(millbrae);
  const fc = f.fixed_cost;
  assert.equal(fc.total, fc.rent! + fc.labor! + fc.utilities! + fc.insurance! + fc.pos! + fc.marketing! + fc.misc!);
  assert.equal(f.breakeven_monthly, Math.round(fc.total! / f.contribution_margin!));
  assert.equal(f.max_rent_for_10pct_usd, null, 'no captured demand → no ceiling');
  const g = computeFinance({ ...millbrae, captured_monthly_usd: 160_000 });
  assert.equal(g.max_rent_for_10pct_usd, 16_000, 'ceiling is exposed even when rent is given');
});

test('rent not provided: nothing is invented — rent null, ex-rent economics flagged, no occupancy, plug-in sensitivity row', () => {
  const withRent = computeFinance(millbrae);
  const f = computeFinance({ ...millbrae, rent_usd: null });
  assert.equal(f.fixed_cost.rent, null);
  assert.equal(f.rent_source, 'not_provided');
  assert.equal(f.rent_excluded, true);
  assert.ok(f.inputs_missing.includes('rent(未提供)'));
  assert.ok(!f.inputs_missing.some((x) => /估算/.test(x)), 'no "estimated" rent note');
  // fixed cost = the other items only, i.e. the with-rent total minus the rent
  const fc = f.fixed_cost;
  assert.equal(fc.total, fc.labor! + fc.utilities! + fc.insurance! + fc.pos! + fc.marketing! + fc.misc!);
  assert.equal(fc.total, withRent.fixed_cost.total! - 12_000);
  assert.equal(f.breakeven_monthly, Math.round(fc.total! / f.contribution_margin!));
  assert.equal(f.safety_monthly, Math.round(f.breakeven_monthly! * 1.28));
  for (const s of f.scenarios) assert.equal(s.vs_breakeven, Math.round((s.monthly_revenue / f.breakeven_monthly!) * 1000) / 1000);
  assert.equal(f.occupancy_cost_ratio, null);
  assert.equal(f.max_rent_for_10pct_usd, null);
  // sensitivity: the +10 % rent row is replaced by "each +$1,000 of rent"
  assert.equal(f.sensitivity.length, 4);
  assert.ok(!f.sensitivity.some((s) => s.id === 'rent_plus_10'));
  const per1k = f.sensitivity.find((s) => s.id === 'rent_per_1000')!;
  assert.ok(per1k, 'rent_per_1000 row present');
  assert.equal(per1k.monthly_revenue_delta, -Math.round(1000 / f.contribution_margin!));
  assert.equal(per1k.breaks_breakeven, false);
  assert.equal(per1k.label_zh, '月租每 +$1,000');
  assert.equal(per1k.label_en, 'Each +$1,000 rent');
  // no rent figure anywhere in the output (as a whole number — 120,000 base revenue is a different figure)
  assert.ok(!/(^|\D)12,?000(\D|$)/.test(JSON.stringify(f)), 'the with-rent figure leaked into the no-rent output');
});

test('rent not provided + captured demand: occupancy stays null, the 10 % ceiling is exposed, payback is hidden', () => {
  const f = computeFinance({ ...millbrae, rent_usd: null, captured_monthly_usd: 160_000, capex_usd: 300_000 });
  assert.equal(f.occupancy_cost_ratio, null);
  assert.equal(f.max_rent_for_10pct_usd, 16_000);
  assert.equal(rentForOccupancyTarget(160_000), 16_000);
  assert.equal(f.payback_months, null, 'profit without rent is not a payback');
  assert.ok(f.inputs_missing.includes('payback(租金未提供 → 回收期隐藏)'));
  // sqft never turns into a rent
  const g = computeFinance({ ...millbrae, rent_usd: null, sqft: 5_000 });
  assert.equal(g.fixed_cost.rent, null);
  assert.equal(g.rent_source, 'not_provided');
});

test('capex → payback; captured revenue drives occupancy ratio', () => {
  const f = computeFinance({ ...millbrae, capex_usd: 300_000, captured_monthly_usd: 160_000 });
  assert.ok(f.payback_months != null && f.payback_months > 0);
  assert.equal(f.occupancy_cost_ratio, 0.075);
});

test('scenarioRevenue formula', () => {
  const s = scenarioRevenue({ seats: 60, turns_per_day: 2.3, delivery_ratio: 0.25, ticket_in: 24, ticket_delivery: 28, days_open: 30 });
  assert.equal(s.dine_in_covers_day, 138);
  assert.equal(s.delivery_orders_day, 46);
  assert.equal(s.monthly_revenue, Math.round((138 * 24 + 46 * 28) * 30));
});
