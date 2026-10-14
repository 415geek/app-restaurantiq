/**
 * v4 §1.1 免费层 = 付费层同引擎 — the free-tier projection of THE conclusion.
 *
 * What prompted this: the same address, the same request, gave the customer
 * 暂缓签租 54 分 / ~$3,700 a month on the free page and GO 79.2 / $51,544 a
 * month after paying. The free numbers were written by a language model from
 * a "fair share" sketch; the paid numbers came from the deterministic core.
 * The paid conclusion overturned the conclusion that had sold it.
 *
 * Rule: the free tier is a field-level projection of `compute(snapshot)` —
 * the same `runReport360` core, the same `conclusionFromModel` — with nothing
 * recomputed. The language model still writes the free prose (headline,
 * snapshot, hidden risk, teaser), but every number in it is anchored to this
 * object, and every number the page prints IS this object.
 */
import { decisionTierForVerdict } from './iq-full-report-schema';
import type { DecisionTier, RiskAuditPreview } from './iq-risk-audit-model';
import { baseRevenueOf, dimensionLabel, type Conclusion } from '@/lib/iq/conclusion/display';
import type { InputSanityFlag, ReportModel } from '@/lib/iq/model/schema';
import type { Locale } from '@/lib/i18n/locale';

export interface FreeProjection {
  engine_version: string;
  snapshot_id: string;
  verdict: Conclusion['verdict'];
  decision_tier: DecisionTier;
  /** 0–100, one decimal — identical to the paid cover. */
  overall: number;
  /** 0–100 — the one data-completeness number. */
  completeness: number;
  dimensions: Array<{ id: string; score: number; weight: number }>;
  /** Base-case monthly revenue (the number the paid report headlines). */
  monthly_revenue_base: number | null;
  breakeven_monthly: number | null;
  rent_excluded: boolean;
  /** §4.4 ONE count set: direct + same-category after dedupe, and direct alone. */
  competitor_total: number;
  competitor_direct: number;
  tier: ReportModel['meta']['tier'];
  /** §1.3 flags, so the free page can ask the customer to confirm an implausible input. */
  input_sanity: InputSanityFlag[];
}

/** Pure. Reads the conclusion the model already carries; never derives a verdict of its own. */
export function projectFreeResult(model: ReportModel): FreeProjection {
  const c = model.conclusion;
  if (!c) throw new Error('projectFreeResult: the model carries no conclusion');
  return {
    engine_version: model.meta.engine_version,
    snapshot_id: c.snapshot_id,
    verdict: c.verdict,
    decision_tier: decisionTierForVerdict(c.verdict),
    overall: c.overall,
    completeness: c.data_confidence_pct,
    dimensions: c.dimensions.map((d) => ({ id: d.id, score: d.score, weight: d.weight })),
    monthly_revenue_base: baseRevenueOf(c),
    breakeven_monthly: c.breakeven_monthly,
    rent_excluded: c.rent_excluded,
    competitor_total: model.competitors.counts.total,
    competitor_direct: model.competitors.counts.direct,
    tier: model.meta.tier,
    input_sanity: model.input_sanity ?? [],
  };
}

/**
 * Overwrite every number the language model wrote in the free payload with the
 * projection. The prose fields are left alone — that is the model's job. The
 * layer ids become the paid dimension ids, so the two scorecards read the same.
 */
export function applyProjectionToFreeResult<T extends { decision_tier?: string; risk_audit_preview?: RiskAuditPreview }>(
  parsed: T,
  p: FreeProjection,
  lang: Locale,
): T {
  const prev = parsed.risk_audit_preview ?? {};
  return {
    ...parsed,
    decision_tier: p.decision_tier,
    risk_audit_preview: {
      ...prev,
      decision_tier: p.decision_tier,
      overall_score: p.overall,
      data_confidence_pct: p.completeness,
      layers: p.dimensions.map((d) => ({ id: d.id, label: dimensionLabel(d.id, lang), score: d.score, note: `${d.weight}% × ${d.score}` })),
      // The six paid dimensions ARE the radar; a second set of six would be a second model.
      radar: Object.fromEntries(p.dimensions.map((d) => [d.id, d.score])),
    },
  };
}
