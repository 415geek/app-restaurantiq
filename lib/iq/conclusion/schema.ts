/**
 * 评审 Spec §4.1 单一结论源 (P0-A) — the shape of the ONE conclusion object.
 *
 * Kept in its own module (no import of lib/iq/model/schema.ts) so the report
 * model can embed `conclusion` without a circular import: model → this file,
 * conclusion.ts → model (types only).
 */
import { z } from 'zod';

export type Verdict = 'GO' | 'CONDITIONAL_GO' | 'NO_GO';
export type RevenueBasis = 'demand_capture' | 'seats_turns';

export interface ConclusionDimension {
  id: string;
  score: number;
  weight: number;
  weighted: number;
}

export interface ConclusionFixedCost {
  rent: number | null;
  labor: number;
  utilities: number;
  insurance: number;
  pos: number;
  marketing: number;
  misc: number;
  total: number;
}

export interface ConclusionScenario {
  id: 'pessimistic' | 'base' | 'optimistic';
  monthly_revenue: number;
  vs_breakeven: number | null;
}

/**
 * The single conclusion both surfaces print. Produced only by
 * `conclusionFromModel` (lib/iq/conclusion/conclusion.ts) and stored on the
 * report row inside `report_model_json.conclusion`.
 */
export interface Conclusion {
  /** reportId + generated_at — printed on the web page and in the PDF. */
  snapshot_id: string;
  data_as_of: string;
  /** 0–100, one decimal. */
  overall: number;
  verdict: Verdict;
  dimensions: ConclusionDimension[];
  breakeven_monthly: number | null;
  safety_monthly: number | null;
  rent_excluded: boolean;
  occupancy_cost_ratio: number | null;
  fixed_cost: ConclusionFixedCost;
  scenarios: ConclusionScenario[];
  /** ONE number, identical on both surfaces. */
  data_confidence_pct: number;
  /** Which revenue basis produced `scenarios`. */
  basis: RevenueBasis;
}

export const conclusionSchema: z.ZodType<Conclusion> = z.object({
  snapshot_id: z.string(),
  data_as_of: z.string(),
  overall: z.number(),
  verdict: z.enum(['GO', 'CONDITIONAL_GO', 'NO_GO']),
  dimensions: z.array(z.object({ id: z.string(), score: z.number(), weight: z.number(), weighted: z.number() })),
  breakeven_monthly: z.number().nullable(),
  safety_monthly: z.number().nullable(),
  rent_excluded: z.boolean(),
  occupancy_cost_ratio: z.number().nullable(),
  fixed_cost: z.object({
    rent: z.number().nullable(),
    labor: z.number(),
    utilities: z.number(),
    insurance: z.number(),
    pos: z.number(),
    marketing: z.number(),
    misc: z.number(),
    total: z.number(),
  }),
  scenarios: z.array(
    z.object({
      id: z.enum(['pessimistic', 'base', 'optimistic']),
      monthly_revenue: z.number(),
      vs_breakeven: z.number().nullable(),
    }),
  ),
  data_confidence_pct: z.number(),
  basis: z.enum(['demand_capture', 'seats_turns']),
});

/** Runtime parse for a conclusion that arrived from storage / an API payload. */
export function parseConclusion(raw: unknown): Conclusion | null {
  const r = conclusionSchema.safeParse(raw);
  return r.success ? r.data : null;
}
