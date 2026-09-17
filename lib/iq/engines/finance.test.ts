import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archetypeFor, computeFinance, rentForOccupancyTarget, scenarioRevenue, type FinanceInput } from './finance';
import { computeFinanceModel } from '@/lib/funnel/iq-finance-model';

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

test('§4.1: headcount, ticket, delivery share and dayparts come from the taxonomy entry, not the floor area', () => {
  const egg = computeFinance({ cuisine: 'egg_tart', rent_usd: 4_000, sqft: 600, seats: null, capex_usd: null, ticket_in: null, ticket_delivery: null, delivery_ratio: null, median_income: 150_000, state: 'CA', captured_monthly_usd: null });
  const eggArch = archetypeFor('egg_tart');
  assert.equal(eggArch.headcount, 4);
  assert.equal(eggArch.ticket_in, 10);
  assert.equal(eggArch.delivery_ratio, 0.75);
  assert.equal(eggArch.daypart_profile, 'morning_afternoon');
  assert.equal(egg.fixed_cost.labor, Math.round(4 * 22 * 173 * 1.18), 'labor = 4 FTE at the HCOL wage');
  assert.equal(egg.scenarios[1].ticket_in, 10);
  assert.equal(egg.scenarios[1].delivery_ratio, 0.75);
  assert.ok(egg.inputs_missing.includes('delivery_ratio(取业态默认 75%)'));
  const hp = archetypeFor('hot_pot');
  assert.equal(hp.headcount, 10);
  assert.equal(hp.ticket_in, 35);
  assert.equal(hp.daypart_profile, 'dinner');
  assert.equal(computeFinance({ ...millbrae, cuisine: 'hot_pot', ticket_in: null }).fixed_cost.labor, Math.round(10 * 22 * 173 * 1.18));
  // The hunan numbers are the legacy ones (12 FTE, 25 % delivery, $24 ticket).
  const hunan = archetypeFor('hunan');
  assert.equal(hunan.headcount, 12);
  assert.equal(hunan.delivery_ratio, 0.25);
  const h = computeFinance({ ...millbrae, ticket_in: null, delivery_ratio: null });
  assert.equal(h.fixed_cost.labor, Math.round(12 * 22 * 173 * 1.18));
  assert.equal(h.scenarios[1].ticket_in, 24);
  assert.equal(h.scenarios[1].delivery_ratio, 0.25);
  assert.ok(h.inputs_missing.includes('delivery_ratio(默认 25%)'));
});

/**
 * 评审 Spec §4.1 单一结论源 (P0-A): the two finance engines share ONE cost scale.
 *
 * Before P0-A the 360° engine split the non-rent fixed budget 30/12/8/25 % at a
 * 22/18/15 wage while the web engine split a different baseline 32/16/12/22 % at
 * 22/20/17/14 with a fourth tier — the same egg-tart report printed
 * utilities $1,920 / insurance $960 / POS $720 on one surface and
 * $1,260 / $504 / $336 on the other.
 */
test('§4.1: both finance engines produce the same utilities / insurance / POS for the same tier + concept', () => {
  const concepts: Array<{ cuisine: string; businessType: string }> = [
    { cuisine: 'hunan', businessType: '湘菜馆 Hunan restaurant' },
    { cuisine: 'egg_tart', businessType: '蛋挞店 egg tart bakery' },
    { cuisine: 'hot_pot', businessType: '火锅店 hot pot' },
    { cuisine: 'boba', businessType: '奶茶店 bubble tea' },
    { cuisine: 'noodles', businessType: '面馆 noodle shop' },
  ];
  const tiers: Array<{ label: string; income: number; state: string }> = [
    { label: 'hcol', income: 150_000, state: 'CA' },
    { label: 'mcol', income: 85_000, state: 'TX' },
    { label: 'lcol', income: 45_000, state: 'OH' },
  ];

  for (const { cuisine, businessType } of concepts) {
    for (const tier of tiers) {
      const iq = computeFinance({
        cuisine,
        rent_usd: 9_000,
        sqft: 1_800,
        seats: 40,
        capex_usd: null,
        ticket_in: null,
        ticket_delivery: null,
        delivery_ratio: null,
        median_income: tier.income,
        state: tier.state,
        captured_monthly_usd: null,
      });
      const web = computeFinanceModel({
        businessType,
        location: 'x',
        marketData: {
          geocode: { state: tier.state },
          acs_context: { tract_data_available: true, tract: { median_household_income_usd: tier.income } },
          user_inputs: { monthly_rent_usd: 9_000, sqft: 1_800 },
        },
      });
      const where = `${cuisine} @ ${tier.label}`;
      assert.equal(web.monthly_utilities_usd, iq.fixed_cost.utilities, `utilities ${where}`);
      assert.equal(web.monthly_insurance_usd, iq.fixed_cost.insurance, `insurance ${where}`);
      assert.equal(web.monthly_pos_software_usd, iq.fixed_cost.pos, `POS ${where}`);
      assert.equal(web.monthly_marketing_usd, iq.fixed_cost.marketing, `marketing ${where}`);
      assert.equal(web.monthly_misc_usd, iq.fixed_cost.misc, `misc ${where}`);
      assert.equal(web.monthly_labor_usd, iq.fixed_cost.labor, `labor ${where}`);
      assert.equal(web.monthly_rent_usd, iq.fixed_cost.rent, `rent ${where}`);
      assert.equal(web.fixed_total_monthly_usd, iq.fixed_cost.total, `fixed total ${where}`);
      // Break-even = fixed total ÷ contribution margin. The fixed total is now shared, so the
      // two engines agree wherever they also share the food-cost benchmark. Where they do not
      // (hot pot runs a 34 % food cost in the 360° engine, 32 % in the web archetype) the
      // CONCLUSION decides: the stored 360° number is what both surfaces print.
      if (Math.abs(web.total_variable_rate - iq.variable_rate!) < 1e-9) {
        assert.equal(web.break_even_revenue_monthly_usd, iq.breakeven_monthly, `break-even ${where}`);
        assert.equal(web.safe_revenue_monthly_usd, iq.safety_monthly, `safe revenue ${where}`);
      }
      assert.equal(
        web.break_even_revenue_monthly_usd,
        Math.round(web.fixed_total_monthly_usd / web.contribution_margin_rate),
        `the web break-even is the shared fixed total ÷ its margin ${where}`,
      );
    }
  }
});

test('§4.1: the web engine never estimates a rent either — no rent in, rent-excluded out', () => {
  const web = computeFinanceModel({
    businessType: '蛋挞店 egg tart bakery',
    location: 'x',
    // sqft and a listings sample used to be turned into a rent; they must not be.
    marketData: {
      geocode: { state: 'CA' },
      acs_context: { tract_data_available: true, tract: { median_household_income_usd: 150_000 } },
      user_inputs: { sqft: 1_200 },
      commercial_listings: { listings: [{ monthlyRent: 9_000 }, { monthlyRent: 11_000 }, { monthlyRent: 13_000 }] },
    },
  });
  assert.equal(web.rent_excluded, true);
  assert.equal(web.rent_source, 'not_provided');
  assert.equal(web.monthly_rent_usd, 0);
  assert.equal(web.occupancy_cost_pct_at_safe, 0, 'no rent → no occupancy cost may be shown');
  assert.equal(web.occupancy_cost_pct_at_breakeven, 0);
  assert.ok(!JSON.stringify(web).includes('11,000'), 'the listings median must not leak in as a rent');
  const iq = computeFinance({
    cuisine: 'egg_tart',
    rent_usd: null,
    sqft: 1_200,
    seats: null,
    capex_usd: null,
    ticket_in: null,
    ticket_delivery: null,
    delivery_ratio: null,
    median_income: 150_000,
    state: 'CA',
    captured_monthly_usd: null,
  });
  assert.equal(iq.rent_excluded, true);
  assert.equal(web.break_even_revenue_monthly_usd, iq.breakeven_monthly, 'the ex-rent break-even matches too');
});

test('§4.1: with no seats and no floor area the scenarios are anchored on captured demand, and say so', () => {
  const noCapacity = {
    cuisine: 'egg_tart',
    rent_usd: 6_000,
    sqft: null,
    seats: null,
    capex_usd: null,
    ticket_in: null,
    ticket_delivery: null,
    delivery_ratio: null,
    median_income: 150_000,
    state: 'CA',
  };
  const f = computeFinance({ ...noCapacity, captured_monthly_usd: 90_000 });
  assert.equal(f.revenue_basis, 'demand_capture');
  const base = f.scenarios.find((s) => s.id === 'base')!;
  assert.ok(Math.abs(base.monthly_revenue - 90_000) / 90_000 < 0.12, `base ${base.monthly_revenue} should track captured demand`);
  // The table still reconciles: covers = seats × turns, revenue = orders × ticket.
  for (const s of f.scenarios) {
    assert.ok(Math.abs(s.dine_in_covers_day - s.seats * s.turns_per_day) < 0.11, `${s.id} covers`);
    const fromOrders = (s.dine_in_covers_day * s.ticket_in + s.delivery_orders_day * s.ticket_delivery) * s.days_open;
    assert.ok(Math.abs(fromOrders - s.monthly_revenue) < Math.max(1, s.monthly_revenue * 0.002), `${s.id} revenue`);
  }
  assert.ok(f.inputs_missing.some((x) => x.startsWith('seats/sqft')));
  // A floor area is capacity: the basis stays seats × turns.
  assert.equal(computeFinance({ ...noCapacity, sqft: 900, captured_monthly_usd: 90_000 }).revenue_basis, 'seats_turns');
  assert.equal(computeFinance({ ...noCapacity, captured_monthly_usd: null }).revenue_basis, 'seats_turns');
});
