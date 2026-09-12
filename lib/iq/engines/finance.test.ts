import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinance, scenarioRevenue } from './finance';

const millbrae = {
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
  rent_psf_comp: null,
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
  const be = f.breakeven_monthly!;
  assert.ok(be > 50_000 && be < 150_000, String(be));
  assert.equal(f.safety_monthly, Math.round(be * 1.28));
  assert.equal(f.sensitivity.length, 4);
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
