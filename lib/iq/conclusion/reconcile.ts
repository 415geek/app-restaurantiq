/**
 * 评审 Spec §4.1 临时方案 — the interim safety net, kept even after the ordering fix.
 *
 * If a stored report model and its stored conclusion would ever disagree (an old
 * model re-rendered with new engine constants, a partial re-derivation, a hand
 * patch), the CONCLUSION wins. `reportModelSchema` runs this on every parse, so
 * the print/PDF renderer — which reads `model.score` and `model.finance`
 * directly — can never print a number the web report does not show.
 *
 * Deliberately structural (no import of ../model/schema) so the model schema can
 * depend on it without an import cycle.
 */
import type { Conclusion } from './schema';

type FixedCost = {
  rent: number | null;
  labor: number | null;
  utilities: number | null;
  insurance: number | null;
  pos: number | null;
  marketing: number | null;
  misc: number | null;
  total: number | null;
};

export interface ConclusionCarrier {
  conclusion?: Conclusion | null;
  finance: {
    fixed_cost: FixedCost;
    rent_excluded: boolean;
    breakeven_monthly: number | null;
    safety_monthly: number | null;
    occupancy_cost_ratio: number | null;
    revenue_basis: 'seats_turns' | 'demand_capture';
    scenarios: Array<{ id: 'pessimistic' | 'base' | 'optimistic'; monthly_revenue: number; vs_breakeven: number | null }>;
  };
  score: { total: number; verdict: 'GO' | 'CONDITIONAL_GO' | 'NO_GO' };
  confidence: { total: number };
}

export function reconcileModelToConclusion<T extends ConclusionCarrier>(model: T): T {
  const c = model.conclusion;
  if (!c) return model;
  const byId = new Map(c.scenarios.map((s) => [s.id, s]));
  const scenarios = model.finance.scenarios.map((s) => {
    const hit = byId.get(s.id);
    return hit ? { ...s, monthly_revenue: hit.monthly_revenue, vs_breakeven: hit.vs_breakeven } : s;
  });
  return {
    ...model,
    finance: {
      ...model.finance,
      fixed_cost: { ...model.finance.fixed_cost, ...c.fixed_cost },
      rent_excluded: c.rent_excluded,
      breakeven_monthly: c.breakeven_monthly,
      safety_monthly: c.safety_monthly,
      occupancy_cost_ratio: c.occupancy_cost_ratio,
      revenue_basis: c.basis,
      scenarios,
    },
    score: { ...model.score, total: c.overall, verdict: c.verdict },
    confidence: { ...model.confidence, total: c.data_confidence_pct },
  };
}
