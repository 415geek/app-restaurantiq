import { z } from 'zod';
import { decisionTierSchema, riskAuditFullSchema } from '@/lib/funnel/iq-risk-audit-model';
import {
  type CompetitorWhitelist,
  isCompetitorWhitelisted,
  MIN_WHITELIST_FOR_GROUNDED_REPORT,
} from '@/lib/funnel/iq-market-signals';

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

/** Alternative trade corridors + sample listings (reference-report style). */
export const listingRowSchema = z.object({
  address_or_listing: z.string(),
  sqft: z.union([z.number(), z.string()]).optional(),
  monthly_rent_usd: z.union([z.number(), z.string()]).optional(),
  highlights: optionalString,
  source_tag: optionalString,
});

export const alternativeCorridorSchema = z.object({
  corridor_name: z.string(),
  rationale: optionalString,
  listings: z.array(listingRowSchema).optional(),
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
    site_and_access_assessment: optionalString,
    key_evidence_points: z.array(z.string()).optional(),
    alternative_corridors: z.array(alternativeCorridorSchema).optional(),
    one_line_conclusion: optionalString,
    decision_tier: decisionTierSchema.optional(),
    risk_audit: riskAuditFullSchema.optional(),
    data_confidence_pct: z.union([z.number(), z.string()]).optional(),
    lease_checklist: z.array(z.string()).optional(),
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

/** Heuristic 0–100 score for ops / logging (not shown to end users). */
export function scoreFullReportCompleteness(full: Record<string, unknown>): number {
  let s = 0;
  const ex = typeof full.executive_summary === 'string' ? full.executive_summary.length : 0;
  if (ex > 120) s += 12;
  if (ex > 350) s += 10;
  const comp = Array.isArray(full.competitors) ? full.competitors.length : 0;
  if (comp >= 3) s += 12;
  if (comp >= 5) s += 10;
  const rm = full.revenue_model as Record<string, unknown> | undefined;
  const scenarios = rm && Array.isArray(rm.scenarios) ? rm.scenarios.length : 0;
  if (scenarios >= 3) s += 15;
  else if (scenarios >= 1) s += 6;
  const risks = Array.isArray(full.risk_matrix) ? full.risk_matrix.length : 0;
  if (risks >= 5) s += 15;
  else if (risks >= 3) s += 8;
  const ev = Array.isArray(full.key_evidence_points) ? full.key_evidence_points.length : 0;
  if (ev >= 6) s += 12;
  else if (ev >= 3) s += 5;
  const dm = Array.isArray(full.decision_matrix) ? full.decision_matrix.length : 0;
  if (dm >= 5) s += 10;
  else if (dm >= 3) s += 4;
  if (typeof full.final_verdict === 'string' && full.final_verdict.length > 20) s += 4;
  return Math.min(100, s);
}

export function logFullReportQuality(full: Record<string, unknown>, context = ''): void {
  const score = scoreFullReportCompleteness(full);
  const suffix = context ? ` ${context}` : '';
  if (score < 42) {
    console.warn(`[iq-full-report] low completeness score=${score}${suffix}`);
  } else {
    console.log(`[iq-full-report] completeness score=${score}${suffix}`);
  }
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

/**
 * Internal flags injected by the post-LLM grounding pass. We deliberately use
 * leading underscores so they survive `passthrough()` but are obviously
 * non-canonical to anyone reading the JSON.
 */
export type IqReportGroundingFlags = {
  /** True when one or more competitor rows were dropped or the LLM produced too few real ones. */
  _insufficient_competitor_data?: boolean;
  /** Total whitelisted competitors retrieved from market_data (Google ∪ Yelp ∪ BrightData). */
  _whitelist_total?: number;
  /** Names that were in the LLM output but NOT in the whitelist (silently dropped). */
  _dropped_competitor_names?: string[];
  /** Human-readable warning strings — rendered in the UI sources/methodology footer. */
  _warnings?: string[];
  /** True when the deterministic finance model was applied (D-4 — overrides LLM guesses). */
  _finance_model_applied?: boolean;
  /** Snapshot of the finance model used (for UI callout). */
  _finance_model_snapshot?: import('./iq-finance-model').DeterministicFinanceModel;
};

export type IqReportWithGrounding = Record<string, unknown> & IqReportGroundingFlags;

/**
 * Filter `competitors[]` to those that pass the whitelist check, and attach
 * grounding flags. Pure function — does not mutate the input.
 *
 * Decision: we filter (drop unverified rows) rather than fail validation. The
 * report stays useful even if the LLM tries to add 1–2 hallucinations, and the
 * UI can render a "Data Sources" badge explaining what was dropped.
 */
export function applyCompetitorWhitelist(
  report: Record<string, unknown>,
  whitelist: CompetitorWhitelist,
): IqReportWithGrounding {
  const competitors = Array.isArray(report.competitors) ? (report.competitors as unknown[]) : [];
  const kept: unknown[] = [];
  const dropped: string[] = [];

  for (const row of competitors) {
    if (!row || typeof row !== 'object') continue;
    const name = (row as Record<string, unknown>).name;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (isCompetitorWhitelisted(name, whitelist)) {
      kept.push(row);
    } else {
      dropped.push(name.trim());
    }
  }

  const warnings: string[] = [];
  if (dropped.length > 0) {
    warnings.push(
      `Dropped ${dropped.length} unverified competitor name(s) not present in Google/Yelp/BrightData retrieval: ${dropped.join(', ')}.`,
    );
  }
  if (whitelist.total < MIN_WHITELIST_FOR_GROUNDED_REPORT) {
    warnings.push(
      `Only ${whitelist.total} named competitor(s) were retrieved (minimum for grounded competitor analysis is ${MIN_WHITELIST_FOR_GROUNDED_REPORT}). Treat competitor commentary as low-confidence.`,
    );
  }

  const insufficient =
    whitelist.total < MIN_WHITELIST_FOR_GROUNDED_REPORT || kept.length < MIN_WHITELIST_FOR_GROUNDED_REPORT;

  const out: IqReportWithGrounding = {
    ...report,
    competitors: kept,
    _whitelist_total: whitelist.total,
    _dropped_competitor_names: dropped,
    _insufficient_competitor_data: insufficient,
  };
  if (warnings.length > 0) {
    const existing = Array.isArray(report._warnings) ? (report._warnings as string[]).slice() : [];
    out._warnings = [...existing, ...warnings];
  }
  return out;
}

/**
 * Whether the report needs a retry against a stricter prompt. We retry once
 * when the LLM tried to fabricate ≥2 competitors OR dropped the count below
 * the grounding threshold even though the whitelist had enough entries.
 */
export function shouldRetryForCompetitorGrounding(
  report: IqReportWithGrounding,
  whitelist: CompetitorWhitelist,
): boolean {
  const dropped = report._dropped_competitor_names ?? [];
  if (dropped.length >= 2) return true;
  if (whitelist.total >= MIN_WHITELIST_FOR_GROUNDED_REPORT) {
    const kept = Array.isArray(report.competitors) ? report.competitors.length : 0;
    if (kept < MIN_WHITELIST_FOR_GROUNDED_REPORT) return true;
  }
  return false;
}

/**
 * D-4: Force-override the LLM's break-even / safe-revenue / cost_breakdown with
 * the deterministic finance model. The LLM is instructed via the anchor block
 * to mirror these numbers, but we still override post-hoc as a hard guarantee.
 *
 * Pure function — does not mutate input. Returns the report unchanged when
 * `financeModel` is undefined (e.g. legacy reports without market_data).
 */
export function applyFinanceModelOverride(
  report: IqReportWithGrounding,
  financeModel:
    | import('./iq-finance-model').DeterministicFinanceModel
    | null
    | undefined,
): IqReportWithGrounding {
  if (!financeModel || typeof financeModel !== 'object') return report;
  if (typeof financeModel.break_even_revenue_monthly_usd !== 'number') return report;
  if (typeof financeModel.safe_revenue_monthly_usd !== 'number') return report;

  const existingRiskAudit =
    report.risk_audit && typeof report.risk_audit === 'object'
      ? (report.risk_audit as Record<string, unknown>)
      : {};

  const overriddenRiskAudit: Record<string, unknown> = {
    ...existingRiskAudit,
    break_even_revenue_monthly_usd: financeModel.break_even_revenue_monthly_usd,
    safe_revenue_monthly_usd: financeModel.safe_revenue_monthly_usd,
    cost_breakdown: financeModel.cost_breakdown,
  };

  const existingWarnings = Array.isArray(report._warnings) ? report._warnings.slice() : [];
  const note =
    financeModel.confidence === 'low'
      ? `Break-even and safe revenue are computed from the deterministic D-4 finance model with LOW confidence (only ${financeModel.confidence_reasons.join(', ')}). Numbers are bounded by archetype + city tier estimates; add real rent / sqft / lease terms to upgrade confidence.`
      : `Break-even and safe revenue are computed from the deterministic D-4 finance model (${financeModel.confidence} confidence): ${financeModel.confidence_reasons.join('; ')}.`;

  return {
    ...report,
    risk_audit: overriddenRiskAudit,
    _finance_model_applied: true,
    _finance_model_snapshot: financeModel,
    _warnings: [...existingWarnings, note],
  };
}
