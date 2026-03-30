import { z } from 'zod';

const optionalString = z.string().optional();

/** Single competitor row — prefer real names from market_data when present. */
export const competitorRowSchema = z.object({
  name: z.string(),
  distance_mi: z.union([z.number(), z.string()]).optional(),
  category: z.string().optional(),
  rating: z.union([z.number(), z.string()]).optional(),
  review_count: z.union([z.number(), z.string()]).optional(),
  price_tier: z.string().optional(),
  threat_level: z.string(),
  analysis: optionalString,
});

export const riskMatrixRowSchema = z.object({
  risk: z.string(),
  probability: optionalString,
  financial_impact: optionalString,
  trigger: optionalString,
  mitigation: optionalString,
});

export const revenueScenarioSchema = z.object({
  name: optionalString,
  monthly_revenue_usd: z.union([z.number(), z.string()]).optional(),
  key_assumptions: optionalString,
});

export const actionStepSchema = z.object({
  task: z.string(),
  owner: optionalString,
  budget_band: optionalString,
  deliverable: optionalString,
  success_metric: optionalString,
  timeframe: optionalString,
});

export const acquisitionRowSchema = z.object({
  channel: z.string(),
  priority: optionalString,
  rationale: optionalString,
  expected_cac_band: optionalString,
});

export const decisionMatrixRowSchema = z.object({
  dimension: z.string(),
  score_100: z.union([z.number(), z.string()]).optional(),
  weight_pct: z.union([z.number(), z.string()]).optional(),
  weighted_score: z.union([z.number(), z.string()]).optional(),
});

/**
 * Paid LocationIQ report: structured + legacy prose fields.
 * Unknown keys are preserved for forward compatibility.
 */
export const iqFullReportSchema = z
  .object({
    report_title: optionalString,
    dashboard: z
      .object({
        overall_score: z.union([z.number(), z.string()]).optional(),
        foot_traffic_index: z.union([z.number(), z.string()]).optional(),
        competition_intensity: z.union([z.number(), z.string()]).optional(),
        payback_months: z.union([z.number(), z.string()]).optional(),
        recommendation: optionalString,
      })
      .optional(),
    executive_summary: optionalString,
    final_verdict: optionalString,
    trade_area_analysis: optionalString,
    demographic_profile: optionalString,
    competition_landscape: optionalString,
    revenue_estimate: optionalString,
    risks: z.array(z.string()).optional(),
    risk_matrix: z.array(riskMatrixRowSchema).optional(),
    competitors: z.array(competitorRowSchema).optional(),
    revenue_model: z
      .object({
        methodology: optionalString,
        scenarios: z.array(revenueScenarioSchema).optional(),
        sensitivity: z.array(z.string()).optional(),
        breakeven: optionalString,
        monthly_costs_note: optionalString,
      })
      .optional(),
    opportunities: z.array(z.string()).optional(),
    failure_scenarios: z.array(z.string()).optional(),
    differentiation_strategy: optionalString,
    acquisition_channels: z.array(acquisitionRowSchema).optional(),
    action_plan: z.array(z.string()).optional(),
    action_plan_structured: z.array(actionStepSchema).optional(),
    comparables: z
      .object({
        success_cases: z.array(z.string()).optional(),
        failure_cases: z.array(z.string()).optional(),
      })
      .optional(),
    decision_matrix: z.array(decisionMatrixRowSchema).optional(),
    confidence: optionalString,
    confidence_rationale: optionalString,
    data_sources_and_disclaimer: optionalString,
  })
  .passthrough();

export type IqFullReportPayload = z.infer<typeof iqFullReportSchema>;

export function parseIqFullReport(raw: unknown): Record<string, unknown> {
  const r = iqFullReportSchema.safeParse(raw);
  if (r.success) return r.data as Record<string, unknown>;
  console.warn('[iq] full report schema validation failed, returning raw object:', r.error?.message);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  throw new Error('Full report response was not a JSON object');
}

/** Map 高/中/低 and English variants to badge keys. */
export function normalizeConfidenceLevel(raw?: string): 'High' | 'Medium' | 'Low' | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (t.startsWith('高') || /\bhigh\b/i.test(lower)) return 'High';
  if (t.startsWith('中') || /\bmedium\b/i.test(lower) || /\bmed\b/i.test(lower)) return 'Medium';
  if (t.startsWith('低') || /\blow\b/i.test(lower)) return 'Low';
  return undefined;
}
