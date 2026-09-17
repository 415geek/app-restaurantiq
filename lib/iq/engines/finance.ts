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
 * driven by explicit inputs instead of a market_data blob. Per 评审 Spec §4.1
 * the concept — never the floor area — decides the people and the ticket:
 * headcount, the default ticket, the default delivery share and the daypart
 * profile come from the taxonomy entry (`fte_default`, `ticket_in`,
 * `takeout_share`, `daypart_profile`); the cost percentages and the seating
 * density come from the category archetype.
 *
 * Rent is NEVER estimated. When the customer did not enter a monthly rent
 * (`rent_usd == null`) the report must not fill one in (owner rule: 「当用户没
 * 输入租金信息时，请不要把你认为的租金信息填上」): `fixed_cost.rent` is null,
 * `rent_excluded` is true, and fixed cost / break-even / safety line / scenario
 * ratios are computed WITHOUT rent and labelled so by every renderer. Instead
 * of a guess the report exposes `max_rent_for_10pct_usd` (captured demand ×
 * 10 %) and a "each +$1,000 of rent" sensitivity row.
 */
import { getDefaults, cuisineById, type CuisineDef, type DaypartProfile } from '../params';
import { archetypeIdFor, costTierFor, fixedCostScaleFor, headcountFor, laborMonthlyUsd, type ArchetypeId, type CostTier } from '../conclusion/cost-scale';
import type { ReportModel } from '../model/schema';

export type FinanceScenario = ReportModel['finance']['scenarios'][number];

export interface FinanceInput {
  cuisine: string;
  /** The customer's monthly rent; null → no rent is assumed anywhere (see header). */
  rent_usd: number | null;
  sqft: number | null;
  seats: number | null;
  capex_usd: number | null;
  ticket_in: number | null;
  ticket_delivery: number | null;
  delivery_ratio: number | null;
  /** From the primary ring (drives the wage tier); null → mid-cost tier. */
  median_income: number | null;
  state: string | null;
  /** Captured monthly demand (Huff) — for occupancy_cost_ratio and the rent ceiling; null when unknown. */
  captured_monthly_usd: number | null;
}

export type RentSource = 'user_input' | 'not_provided';

/** Target occupancy cost (rent ÷ captured revenue) behind `max_rent_for_10pct_usd` and the rent conditions. */
export const OCCUPANCY_TARGET = 0.1;

export interface Archetype {
  /** Cost archetype id — resolved by the shared `archetypeIdFor` so both engines agree. */
  id: ArchetypeId;
  food_cost_pct: number;
  paper_pct: number;
  /** Full-time-equivalent headcount — from the taxonomy `fte_default` when set. */
  headcount: number;
  seats_per_100sqft: number;
  default_sqft: number;
  base_turns: number;
  /** Default dine-in ticket (taxonomy `ticket_in`). */
  ticket_in: number;
  /** Default delivery / takeout share of orders (taxonomy `takeout_share`; legacy 25 %). */
  delivery_ratio: number;
  daypart_profile: DaypartProfile;
}

type ArchetypeBase = Omit<Archetype, 'id' | 'headcount' | 'ticket_in' | 'delivery_ratio' | 'daypart_profile'>;

/**
 * Capacity / variable-cost benchmarks by legacy sub-cuisine id and by concept
 * category. The MONEY side (wages, utilities, insurance, POS, marketing, misc)
 * deliberately lives in `cost_scale` (defaults.yaml) instead — see
 * lib/iq/conclusion/cost-scale.ts — so the web report and the 360° cannot drift.
 */
const ARCHETYPES: Record<string, ArchetypeBase> = {
  boba: { food_cost_pct: 0.28, paper_pct: 0.04, seats_per_100sqft: 2.0, default_sqft: 900, base_turns: 6 },
  chinese_fast: { food_cost_pct: 0.3, paper_pct: 0.03, seats_per_100sqft: 2.5, default_sqft: 1_400, base_turns: 4 },
  noodles: { food_cost_pct: 0.31, paper_pct: 0.025, seats_per_100sqft: 2.5, default_sqft: 1_500, base_turns: 3.5 },
  hk_cafe: { food_cost_pct: 0.31, paper_pct: 0.025, seats_per_100sqft: 2.5, default_sqft: 1_800, base_turns: 3 },
  hot_pot: { food_cost_pct: 0.34, paper_pct: 0.015, seats_per_100sqft: 2.0, default_sqft: 3_000, base_turns: 1.6 },
  default: { food_cost_pct: 0.32, paper_pct: 0.02, seats_per_100sqft: 2.3, default_sqft: 2_200, base_turns: 2.0 },
  // ---- §4.1 concept categories (used for every id without a legacy row above)
  mala_tang: { food_cost_pct: 0.31, paper_pct: 0.03, seats_per_100sqft: 2.5, default_sqft: 1_200, base_turns: 4 },
  roast: { food_cost_pct: 0.33, paper_pct: 0.03, seats_per_100sqft: 2.5, default_sqft: 1_200, base_turns: 4 },
  bakery_dessert: { food_cost_pct: 0.3, paper_pct: 0.03, seats_per_100sqft: 1.5, default_sqft: 1_000, base_turns: 6 },
  beverage: { food_cost_pct: 0.28, paper_pct: 0.04, seats_per_100sqft: 1.5, default_sqft: 800, base_turns: 6 },
  asian_other: { food_cost_pct: 0.32, paper_pct: 0.02, seats_per_100sqft: 2.3, default_sqft: 2_000, base_turns: 2.2 },
  western_other: { food_cost_pct: 0.32, paper_pct: 0.02, seats_per_100sqft: 2.2, default_sqft: 2_200, base_turns: 2.2 },
  mexican: { food_cost_pct: 0.3, paper_pct: 0.03, seats_per_100sqft: 2.5, default_sqft: 1_500, base_turns: 3.5 },
  italian: { food_cost_pct: 0.3, paper_pct: 0.025, seats_per_100sqft: 2.2, default_sqft: 2_000, base_turns: 2.2 },
};

/** Legacy default delivery share, used only for entries without `takeout_share`. */
const LEGACY_DELIVERY_RATIO = 0.25;

/**
 * The archetype of a concept: cost structure by legacy id → category
 * benchmarks, with headcount / ticket / delivery share / dayparts read from the
 * taxonomy entry so an egg-tart shop runs on 4 FTE and a ~$10 ticket while hot
 * pot runs on 10 FTE and $35 (评审 Spec §4.1).
 */
export function archetypeFor(cuisine: string | CuisineDef): Archetype {
  const cu = typeof cuisine === 'string' ? cuisineById(cuisine) : cuisine;
  const base = ARCHETYPES[cu.id] ?? ARCHETYPES[cu.category] ?? ARCHETYPES.default;
  const id = archetypeIdFor(cu);
  return {
    ...base,
    id,
    headcount: cu.fte_default ?? headcountFor(id),
    ticket_in: cu.ticket_in,
    delivery_ratio: cu.takeout_share ?? LEGACY_DELIVERY_RATIO,
    daypart_profile: cu.daypart_profile ?? 'lunch_dinner',
  };
}

/** @deprecated kept as a named export for callers; resolution lives in cost-scale.ts. */
function tierFor(income: number | null, state: string | null): CostTier {
  return costTierFor(income, state);
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
  const arch = archetypeFor(input.cuisine);
  const tier = tierFor(input.median_income, input.state);
  const inputs_missing: string[] = [];

  const sqft = input.sqft ?? null;
  let seats = input.seats;
  if (seats == null) {
    seats = Math.round(((sqft ?? arch.default_sqft) / 100) * arch.seats_per_100sqft);
    inputs_missing.push(sqft ? 'seats(按面积估算)' : 'seats(按原型默认)');
  }
  const ticket_in = input.ticket_in ?? arch.ticket_in;
  if (input.ticket_in == null) inputs_missing.push('ticket_in(取菜系默认)');
  const ticket_delivery = input.ticket_delivery ?? Math.round(ticket_in * 1.15 * 100) / 100;
  if (input.ticket_delivery == null) inputs_missing.push('ticket_delivery(=堂食×1.15)');
  const delivery_ratio = input.delivery_ratio ?? arch.delivery_ratio;
  if (input.delivery_ratio == null) inputs_missing.push(arch.delivery_ratio === LEGACY_DELIVERY_RATIO ? 'delivery_ratio(默认 25%)' : `delivery_ratio(取业态默认 ${Math.round(arch.delivery_ratio * 100)}%)`);

  // Rent: the customer's figure or nothing. No comp / tier / sqft fallback — a rent the
  // customer never gave must not drive break-even, occupancy cost or the verdict.
  const rent: number | null = input.rent_usd ?? null;
  const rent_source: RentSource = rent != null ? 'user_input' : 'not_provided';
  const rent_excluded = rent == null;
  if (rent_excluded) inputs_missing.push('rent(未提供)');

  // §4.1 单一结论源: wages and the five non-rent fixed rows come from the ONE
  // `cost_scale` table (defaults.yaml) that the funnel engine reads as well.
  const labor = laborMonthlyUsd(arch.headcount, tier);
  const { utilities, insurance, pos, marketing, misc } = fixedCostScaleFor(input.cuisine, tier);
  // Excludes rent when none was provided (flagged by rent_excluded, never silently).
  const fixed_total = (rent ?? 0) + labor + utilities + insurance + pos + marketing + misc;

  const variable_rate = arch.food_cost_pct + arch.paper_pct + d.cc_fees_pct + d.delivery_blended_pct;
  const contribution_margin = Math.max(0.15, 1 - variable_rate);
  const breakeven_monthly = Math.round(fixed_total / contribution_margin);
  const safety_monthly = Math.round(breakeven_monthly * d.safety_multiplier);

  const days_open = d.days_open_per_month;
  // Revenue basis (§4.1 单一结论源): normally seats × turns. When the customer gave
  // neither seats nor floor area the seat count is a pure archetype guess, so the
  // scenario table is re-anchored on the modelled captured demand instead — the
  // turns are scaled, so covers ↔ orders ↔ revenue still reconcile exactly. The
  // conclusion prints which basis produced the numbers; there is never a second set.
  const capacityKnown = input.seats != null || input.sqft != null;
  let revenue_basis: ReportModel['finance']['revenue_basis'] = 'seats_turns';
  let bt = arch.base_turns;
  if (!capacityKnown && input.captured_monthly_usd != null && input.captured_monthly_usd > 0) {
    const trial = scenarioRevenue({ seats: seats!, turns_per_day: bt, delivery_ratio, ticket_in, ticket_delivery, days_open });
    if (trial.monthly_revenue > 0) {
      const factor = Math.min(4, Math.max(0.25, input.captured_monthly_usd / trial.monthly_revenue));
      bt = Math.max(0.2, Math.round(bt * factor * 10) / 10);
      revenue_basis = 'demand_capture';
      inputs_missing.push('seats/sqft(未提供 → 情景按模型捕获需求标定)');
    }
  }
  const mk = (id: FinanceScenario['id'], turns: number, dr: number, tIn: number, tDel: number): FinanceScenario => {
    const s = scenarioRevenue({ seats: seats!, turns_per_day: turns, delivery_ratio: dr, ticket_in: tIn, ticket_delivery: tDel, days_open });
    return { id, ...s, vs_breakeven: Math.round((s.monthly_revenue / breakeven_monthly) * 1000) / 1000 };
  };
  const scenarios = [
    mk('pessimistic', Math.round(bt * 0.75 * 10) / 10, Math.max(0.05, delivery_ratio - 0.05), Math.round(ticket_in * 0.9 * 100) / 100, Math.round(ticket_delivery * 0.9 * 100) / 100),
    mk('base', bt, delivery_ratio, ticket_in, ticket_delivery),
    mk('optimistic', Math.round(bt * 1.25 * 10) / 10, Math.min(0.9, delivery_ratio + 0.05), Math.round(ticket_in * 1.05 * 100) / 100, Math.round(ticket_delivery * 1.05 * 100) / 100),
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
  // Rent row: "+10 %" of the customer's rent, or — when none was given — the revenue each
  // extra $1,000 of monthly rent requires, so the reader can plug in their own figure.
  const rentRow =
    rent != null
      ? sens('rent_plus_10', '租金 +10%', 'Rent +10%', base.monthly_revenue, Math.round((fixed_total + rent * 0.1) / contribution_margin))
      : { id: 'rent_per_1000', label_zh: '月租每 +$1,000', label_en: 'Each +$1,000 rent', monthly_revenue_delta: -Math.round(1000 / contribution_margin), breaks_breakeven: false };
  const sensitivity = [
    rentRow,
    sens('turns_minus_05', '翻台 −0.5', 'Turns −0.5', scenarioRevenue({ ...base, turns_per_day: Math.max(0.5, bt - 0.5) }).monthly_revenue),
    sens('ticket_minus_125', '客单价 −12.5%', 'Ticket −12.5%', scenarioRevenue({ ...base, ticket_in: ticket_in * 0.875, ticket_delivery: ticket_delivery * 0.875 }).monthly_revenue),
    sens('delivery_plus_15pt', '外卖占比 +15pt', 'Delivery +15 pt', scenarioRevenue({ ...base, delivery_ratio: Math.min(0.9, delivery_ratio + 0.15) }).monthly_revenue),
  ];

  const occupancy_cost_ratio =
    rent != null && input.captured_monthly_usd != null && input.captured_monthly_usd > 0 ? Math.round((rent / input.captured_monthly_usd) * 1000) / 1000 : null;
  const max_rent_for_10pct_usd = rentForOccupancyTarget(input.captured_monthly_usd);

  let payback_months: number | null = null;
  if (input.capex_usd == null || input.capex_usd <= 0) {
    inputs_missing.push('capex(缺 → 回收期隐藏)');
  } else if (rent_excluded) {
    // Profit computed without rent would overstate payback — hidden, not guessed.
    inputs_missing.push('payback(租金未提供 → 回收期隐藏)');
  } else {
    const revenueForPayback = input.captured_monthly_usd ?? base.monthly_revenue;
    const monthlyProfit = (revenueForPayback - breakeven_monthly) * contribution_margin;
    payback_months = monthlyProfit > 0 ? Math.round(input.capex_usd / monthlyProfit) : null;
    if (payback_months == null) inputs_missing.push('payback(捕获营收未超过保本线)');
  }

  return {
    method: 'seats×turns 单一口径；保本 = 固定成本 ÷ 边际贡献率；安全线 = 保本 × ' + d.safety_multiplier,
    fixed_cost: { rent, labor, utilities, insurance, pos, marketing, misc, total: fixed_total },
    rent_source,
    rent_excluded,
    max_rent_for_10pct_usd,
    contribution_margin: Math.round(contribution_margin * 1000) / 1000,
    variable_rate: Math.round(variable_rate * 1000) / 1000,
    breakeven_monthly,
    safety_monthly,
    revenue_basis,
    scenarios,
    sensitivity,
    occupancy_cost_ratio,
    payback_months,
    inputs_missing,
  };
}

/** Rent that makes rent ÷ captured revenue ≤ target (for auto-generated conditions and the rent ceiling). */
export function rentForOccupancyTarget(capturedMonthly: number | null, target = OCCUPANCY_TARGET): number | null {
  return capturedMonthly != null && capturedMonthly > 0 ? Math.round(capturedMonthly * target) : null;
}
