/**
 * v4 §2.1 租金上限引擎 (Rent Ceiling Engine).
 *
 * The one number in the report a customer can take to a landlord. The
 * break-even line ("you need $41,287 a month") is a result; what the customer
 * actually negotiates with is "the most rent I can afford here". All inputs
 * already exist on the finance model, so this is pure arithmetic — no new data
 * source, no model, no estimate the engine did not already make.
 *
 *   safe     = demand_lo × target_ratio                 the ceiling to negotiate to
 *   critical = demand_lo × contribution − non-rent fixed  past this the site loses money
 *   stress   = the same ceiling with traffic down 25%     what survives a bad year
 *
 * demand_lo is the CONSERVATIVE figure: the pessimistic revenue scenario the
 * finance engine already prints, capped by the modelled captured demand — a
 * ceiling that only holds when everything goes right is not a ceiling. Every
 * constant lives in defaults.yaml `rent_ceiling`.
 */
import { getDefaults } from '../params';
import type { ReportModel } from '../model/schema';
import { archetypeFor } from './finance';
import { inputBlocked } from './input-sanity';

export type RentEquivalent =
  | { type: 'free_rent_month'; value: number; amortize_months: number }
  | { type: 'ti_allowance'; unit_usd: number; value: number; amortize_months: number }
  | { type: 'percentage_rent_cap'; threshold_monthly_sales: number };

export interface RentCeiling {
  /** Which finance scenario supplied demand_lo. */
  basis: 'pessimistic' | 'base';
  demand_lo: number;
  target_ratio: number;
  contribution_margin: number;
  non_rent_fixed: number;
  /** Monthly ceilings, rounded to $100. `safe` never exceeds `critical`. */
  safe: number;
  critical: number;
  stress: number;
  stress_drop: number;
  /**
   * False when the conservative scenario's contribution does not even cover
   * the non-rent fixed cost: no rent is affordable there, and the page says so
   * instead of printing three zeros. `base_*` then give the reference ceilings
   * on the base scenario, so the customer still sees what it would take.
   */
  affordable: boolean;
  base_safe: number | null;
  base_critical: number | null;
  /** The customer's rent when one was given and passed the sanity check; else null. */
  asking: number | null;
  /** asking − safe when the asking is above the ceiling; 0 when within; null without an asking. */
  gap_monthly: number | null;
  gap_lease: number | null;
  lease_months: number;
  equivalents: RentEquivalent[];
}

/** Whole dollars, floored at zero — the same rounding the finance page uses, so the two never disagree by a rounding step. */
const usd = (n: number) => Math.max(0, Math.round(n));

export interface RentCeilingInput {
  cuisine: string;
  finance: ReportModel['finance'];
  /**
   * Modelled captured demand (demand.captured_monthly_usd). The finance
   * scenarios are CAPACITY (seats × turns × ticket) when the customer gave
   * seats or a size, and capacity can exceed what the trade area will actually
   * buy by a wide margin; the ceiling is anchored on the lower of the two.
   */
  captured_monthly_usd: number | null;
  /** Rent the customer entered, already filtered by the sanity layer (null when flagged / absent). */
  asking_rent_usd: number | null;
}

/** Pure. `null` only when the finance model has no revenue scenario to anchor on. */
export function computeRentCeiling(input: RentCeilingInput): RentCeiling | null {
  const p = getDefaults().rent_ceiling;
  const f = input.finance;
  const pess = f.scenarios.find((s) => s.id === 'pessimistic');
  const base = f.scenarios.find((s) => s.id === 'base');
  const anchor = pess ?? base;
  if (!anchor || !(anchor.monthly_revenue > 0) || f.contribution_margin == null || f.fixed_cost.total == null) return null;

  const captured = input.captured_monthly_usd != null && input.captured_monthly_usd > 0 ? input.captured_monthly_usd : null;
  const demand_lo = Math.round(captured == null ? anchor.monthly_revenue : Math.min(anchor.monthly_revenue, captured));
  const cm = f.contribution_margin;
  const non_rent_fixed = Math.max(0, Math.round(f.fixed_cost.total - (f.fixed_cost.rent ?? 0)));
  const target = p.target_ratio[archetypeFor(input.cuisine).id] ?? p.target_ratio.default;

  // `safe` is the target-occupancy rent on conservative demand — the same
  // arithmetic as finance.max_rent_for_10pct_usd, so the checklist condition
  // and this page quote one number. `critical` is where the site stops making
  // money; when it sits below `safe` the site cannot afford its own target.
  const safe = usd(demand_lo * target);
  const critical = usd(demand_lo * cm - non_rent_fixed);
  const affordable = critical >= safe && critical > 0;
  const baseRev = base && base.monthly_revenue > 0 ? Math.round(captured == null ? base.monthly_revenue : Math.min(base.monthly_revenue, captured)) : null;
  const base_critical = baseRev == null ? null : usd(baseRev * cm - non_rent_fixed);
  const base_safe = baseRev == null ? null : usd(baseRev * target);
  const stressed = demand_lo * (1 - p.stress_drop);
  const stress = usd(stressed * target);

  const asking = input.asking_rent_usd != null && input.asking_rent_usd > 0 ? Math.round(input.asking_rent_usd) : null;
  const gap_monthly = asking == null ? null : Math.max(0, asking - safe);
  const gap_lease = gap_monthly == null ? null : gap_monthly * p.lease_months;

  const equivalents: RentEquivalent[] = [];
  if (asking != null && gap_monthly != null && gap_monthly > 0) {
    equivalents.push({ type: 'free_rent_month', value: Math.round(asking / p.free_rent_amortize_months), amortize_months: p.free_rent_amortize_months });
    equivalents.push({ type: 'ti_allowance', unit_usd: p.ti_unit_usd, value: Math.round(p.ti_unit_usd / p.ti_amortize_months), amortize_months: p.ti_amortize_months });
    equivalents.push({ type: 'percentage_rent_cap', threshold_monthly_sales: demand_lo });
  }

  return {
    basis: pess ? 'pessimistic' : 'base',
    demand_lo,
    target_ratio: target,
    contribution_margin: cm,
    non_rent_fixed,
    safe,
    critical,
    stress,
    stress_drop: p.stress_drop,
    affordable,
    base_safe,
    base_critical,
    asking,
    gap_monthly,
    gap_lease,
    lease_months: p.lease_months,
    equivalents,
  };
}

/**
 * Models stored before v4 S1 carry no `value_modules`. The ceiling is pure
 * arithmetic on fields every stored model already has, so the renderer and the
 * narrative generator derive it on read instead of asking the customer to
 * regenerate. Returns the same object when nothing was missing.
 */
export function backfillRentCeiling<M extends ReportModel>(model: M): M {
  if (model.value_modules?.rent_ceiling) return model;
  if (!model.finance || !model.input || !model.demand) return model;
  const rentBlocked = inputBlocked(model.input_sanity ?? [], 'rent_usd');
  const rent_ceiling = computeRentCeiling({
    cuisine: model.input.cuisine,
    finance: model.finance,
    captured_monthly_usd: model.demand.captured_monthly_usd,
    asking_rent_usd: rentBlocked ? null : (model.input.rent_usd ?? null),
  });
  return { ...model, value_modules: { ...(model.value_modules ?? {}), rent_ceiling } };
}
