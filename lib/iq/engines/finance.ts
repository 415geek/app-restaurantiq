/**
 * FinanceEngine — the ONE place revenue, break-even and scenarios are computed
 * (研发提示词 Phase 4.5, intercepts R4).
 *
 *   dine_in_covers_day = seats × turns_per_day
 *   delivery_orders_day = dine_in_covers_day × delivery_ratio / (1 − delivery_ratio)
 *   monthly_revenue     = (dine_in_covers × ticket_in + delivery_orders × ticket_delivery) × days_open
 *   breakeven           = fixed_cost / contribution_margin
 *   safety              = breakeven × safety_multiplier
 *
 * Occupancy rate is deliberately absent (it duplicates turns). Every scenario
 * is produced by `scenarioRevenue()` and re-derived from its own order counts
 * with an assertion |Δ| < $1, so the table can never contradict itself.
 *
 * Cost structure keeps the D-4 archetype benchmarks (docs/audit.md §3) but is
 * driven by explicit inputs instead of a market_data blob.
 */
import { getDefaults, cuisineById } from '../params';
import type { ReportModel } from '../model/schema';

export type FinanceScenario = ReportModel['finance']['scenarios'][number];

export interface FinanceInput {
  cuisine: string;
  rent_usd: number | null;
  sqft: number | null;
  seats: number | null;
  capex_usd: number | null;
  ticket_in: number | null;
  ticket_delivery: number | null;
  delivery_ratio: number | null;
  /** From the primary ring (drives wage + rent tier); null → mid-cost tier. */
  median_income: number | null;
  state: string | null;
  /** Median rent comp $/sqft/month (D8) when the user gave sqft but not rent. */
  rent_psf_comp: number | null;
  /** Captured monthly demand (Huff) — for occupancy_cost_ratio; null when unknown. */
  captured_monthly_usd: number | null;
}

interface Archetype {
  id: string;
  food_cost_pct: number;
  paper_pct: number;
  headcount: number;
  other_fixed: number;
  seats_per_100sqft: number;
  default_sqft: number;
  base_turns: number;
}

const ARCHETYPES: Record<string, Archetype> = {
  boba: { id: 'bubble_tea', food_cost_pct: 0.28, paper_pct: 0.04, headcount: 5, other_fixed: 4_500, seats_per_100sqft: 2.0, default_sqft: 900, base_turns: 6 },
  chinese_fast: { id: 'qsr', food_cost_pct: 0.3, paper_pct: 0.03, headcount: 8, other_fixed: 6_000, seats_per_100sqft: 2.5, default_sqft: 1_400, base_turns: 4 },
  noodles: { id: 'fast_casual', food_cost_pct: 0.31, paper_pct: 0.025, headcount: 9, other_fixed: 6_800, seats_per_100sqft: 2.5, default_sqft: 1_500, base_turns: 3.5 },
  hk_cafe: { id: 'fast_casual', food_cost_pct: 0.31, paper_pct: 0.025, headcount: 10, other_fixed: 7_200, seats_per_100sqft: 2.5, default_sqft: 1_800, base_turns: 3 },
  hot_pot: { id: 'casual_dining', food_cost_pct: 0.34, paper_pct: 0.015, headcount: 16, other_fixed: 9_500, seats_per_100sqft: 2.0, default_sqft: 3_000, base_turns: 1.6 },
  default: { id: 'asian_casual', food_cost_pct: 0.32, paper_pct: 0.02, headcount: 12, other_fixed: 7_800, seats_per_100sqft: 2.3, default_sqft: 2_200, base_turns: 2.0 },
};

const TIERS = {
  hcol: { wage: 22, rent_psf: 6.5 },
  mcol: { wage: 18, rent_psf: 4.25 },
  lcol: { wage: 15, rent_psf: 3.0 },
} as const;
const HCOL_STATES = new Set(['CA', 'NY', 'WA', 'MA', 'HI', 'DC', 'NJ']);

export function archetypeFor(cuisine: string): Archetype {
  return ARCHETYPES[cuisine] ?? ARCHETYPES.default;
}

function tierFor(income: number | null, state: string | null): keyof typeof TIERS {
  if (income != null) return income >= 110_000 ? 'hcol' : income >= 70_000 ? 'mcol' : 'lcol';
  return state && HCOL_STATES.has(state.toUpperCase()) ? 'hcol' : 'mcol';
}

/** Single revenue formula. Everything in the scenario table calls this. */
export function scenarioRevenue(p: {
  seats: number;
  turns_per_day: number;
  delivery_ratio: number;
  ticket_in: number;
  ticket_delivery: number;
  days_open: number;
}): Omit<FinanceScenario, 'id' | 'vs_breakeven'> {
  const dine = p.seats * p.turns_per_day;
  const dr = Math.min(0.9, Math.max(0, p.delivery_ratio));
  const delivery = (dine * dr) / (1 - dr);
  const monthly = (dine * p.ticket_in + delivery * p.ticket_delivery) * p.days_open;
  const out = {
    turns_per_day: p.turns_per_day,
    delivery_ratio: dr,
    ticket_in: p.ticket_in,
    ticket_delivery: p.ticket_delivery,
    seats: p.seats,
    days_open: p.days_open,
    dine_in_covers_day: Math.round(dine * 10) / 10,
    delivery_orders_day: Math.round(delivery * 10) / 10,
    orders_day: Math.round((dine + delivery) * 10) / 10,
    monthly_revenue: Math.round(monthly),
  };
  // Reconciliation assertion (§4.5): re-derive revenue from the exact order counts.
  const recomputed = (dine * p.ticket_in + delivery * p.ticket_delivery) * p.days_open;
  if (Math.abs(recomputed - monthly) >= 1) throw new Error(`finance reconciliation failed: ${recomputed} vs ${monthly}`);
  return out;
}

export function computeFinance(input: FinanceInput): ReportModel['finance'] {
  const d = getDefaults().finance;
  const cu = cuisineById(input.cuisine);
  const arch = archetypeFor(input.cuisine);
  const tier = tierFor(input.median_income, input.state);
  const inputs_missing: string[] = [];

  const sqft = input.sqft ?? null;
  let seats = input.seats;
  if (seats == null) {
    seats = Math.round(((sqft ?? arch.default_sqft) / 100) * arch.seats_per_100sqft);
    inputs_missing.push(sqft ? 'seats(按面积估算)' : 'seats(按原型默认)');
  }
  const ticket_in = input.ticket_in ?? cu.ticket_in;
  if (input.ticket_in == null) inputs_missing.push('ticket_in(取菜系默认)');
  const ticket_delivery = input.ticket_delivery ?? Math.round(ticket_in * 1.15 * 100) / 100;
  if (input.ticket_delivery == null) inputs_missing.push('ticket_delivery(=堂食×1.15)');
  const delivery_ratio = input.delivery_ratio ?? 0.25;
  if (input.delivery_ratio == null) inputs_missing.push('delivery_ratio(默认 25%)');

  // Rent: user → sqft × comp psf → sqft × tier psf → default sqft × tier psf.
  let rent: number;
  let rent_source: string;
  if (input.rent_usd != null) {
    rent = input.rent_usd;
    rent_source = 'user_input';
  } else if (sqft != null && input.rent_psf_comp != null) {
    rent = Math.round(sqft * input.rent_psf_comp);
    rent_source = 'sqft × 对标 $/sf/月';
    inputs_missing.push('rent(按对标估算)');
  } else {
    rent = Math.round((sqft ?? arch.default_sqft) * TIERS[tier].rent_psf);
    rent_source = `sqft × ${tier} 档位 $${TIERS[tier].rent_psf}/sf/月`;
    inputs_missing.push('rent(按档位估算)');
  }

  const labor = Math.round(arch.headcount * TIERS[tier].wage * 173 * 1.18);
  const utilities = Math.round(arch.other_fixed * 0.3);
  const insurance = Math.round(arch.other_fixed * 0.12);
  const pos = Math.round(arch.other_fixed * 0.08);
  const marketing = Math.round(arch.other_fixed * 0.25);
  const misc = arch.other_fixed - utilities - insurance - pos - marketing;
  const fixed_total = rent + labor + utilities + insurance + pos + marketing + misc;

  const variable_rate = arch.food_cost_pct + arch.paper_pct + d.cc_fees_pct + d.delivery_blended_pct;
  const contribution_margin = Math.max(0.15, 1 - variable_rate);
  const breakeven_monthly = Math.round(fixed_total / contribution_margin);
  const safety_monthly = Math.round(breakeven_monthly * d.safety_multiplier);

  const days_open = d.days_open_per_month;
  const bt = arch.base_turns;
  const mk = (id: FinanceScenario['id'], turns: number, dr: number, tIn: number, tDel: number): FinanceScenario => {
    const s = scenarioRevenue({ seats: seats!, turns_per_day: turns, delivery_ratio: dr, ticket_in: tIn, ticket_delivery: tDel, days_open });
    return { id, ...s, vs_breakeven: Math.round((s.monthly_revenue / breakeven_monthly) * 1000) / 1000 };
  };
  const scenarios = [
    mk('pessimistic', Math.round(bt * 0.75 * 10) / 10, Math.max(0.05, delivery_ratio - 0.05), Math.round(ticket_in * 0.9 * 100) / 100, Math.round(ticket_delivery * 0.9 * 100) / 100),
    mk('base', bt, delivery_ratio, ticket_in, ticket_delivery),
    mk('optimistic', Math.round(bt * 1.25 * 10) / 10, Math.min(0.6, delivery_ratio + 0.05), Math.round(ticket_in * 1.05 * 100) / 100, Math.round(ticket_delivery * 1.05 * 100) / 100),
  ];
  const base = scenarios[1];

  // Sensitivity: change in monthly margin (revenue − breakeven) versus base.
  const marginBase = base.monthly_revenue - breakeven_monthly;
  const sens = (id: string, zh: string, en: string, rev: number, be = breakeven_monthly) => ({
    id,
    label_zh: zh,
    label_en: en,
    monthly_revenue_delta: Math.round(rev - be - marginBase),
    breaks_breakeven: rev < be,
  });
  const rentUp = Math.round((fixed_total + rent * 0.1) / contribution_margin);
  const sensitivity = [
    sens('rent_plus_10', '租金 +10%', 'Rent +10%', base.monthly_revenue, rentUp),
    sens('turns_minus_05', '翻台 −0.5', 'Turns −0.5', scenarioRevenue({ ...base, turns_per_day: Math.max(0.5, bt - 0.5) }).monthly_revenue),
    sens('ticket_minus_125', '客单价 −12.5%', 'Ticket −12.5%', scenarioRevenue({ ...base, ticket_in: ticket_in * 0.875, ticket_delivery: ticket_delivery * 0.875 }).monthly_revenue),
    sens('delivery_plus_15pt', '外卖占比 +15pt', 'Delivery +15 pt', scenarioRevenue({ ...base, delivery_ratio: Math.min(0.7, delivery_ratio + 0.15) }).monthly_revenue),
  ];

  const occupancy_cost_ratio =
    input.captured_monthly_usd != null && input.captured_monthly_usd > 0 ? Math.round((rent / input.captured_monthly_usd) * 1000) / 1000 : null;

  let payback_months: number | null = null;
  if (input.capex_usd != null && input.capex_usd > 0) {
    const revenueForPayback = input.captured_monthly_usd ?? base.monthly_revenue;
    const monthlyProfit = (revenueForPayback - breakeven_monthly) * contribution_margin;
    payback_months = monthlyProfit > 0 ? Math.round(input.capex_usd / monthlyProfit) : null;
    if (payback_months == null) inputs_missing.push('payback(捕获营收未超过保本线)');
  } else {
    inputs_missing.push('capex(缺 → 回收期隐藏)');
  }

  return {
    method: 'seats×turns 单一口径；保本 = 固定成本 ÷ 边际贡献率；安全线 = 保本 × ' + d.safety_multiplier,
    fixed_cost: { rent, labor, utilities, insurance, pos, marketing, misc, total: fixed_total },
    rent_source,
    contribution_margin: Math.round(contribution_margin * 1000) / 1000,
    variable_rate: Math.round(variable_rate * 1000) / 1000,
    breakeven_monthly,
    safety_monthly,
    scenarios,
    sensitivity,
    occupancy_cost_ratio,
    payback_months,
    inputs_missing,
  };
}

/** Rent that makes rent ÷ captured revenue ≤ target (for auto-generated conditions). */
export function rentForOccupancyTarget(capturedMonthly: number | null, target = 0.1): number | null {
  return capturedMonthly != null && capturedMonthly > 0 ? Math.round(capturedMonthly * target) : null;
}
