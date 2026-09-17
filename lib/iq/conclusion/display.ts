/**
 * 评审 Spec §4.1 单一结论源 — the client-safe half of the conclusion module.
 *
 * Everything here is pure presentation: labels, wording and small derivations a
 * React component needs. It deliberately does NOT import `lib/iq/params` (that
 * loader reads YAML off disk with `node:fs` and cannot be bundled for the
 * browser), so `RiskAuditScorecard` / `RiskAuditReportSections` / `ReportContent`
 * import from here while the server side imports `./conclusion`, which re-exports
 * all of it plus the threshold-driven logic.
 */
import { pick, type Locale } from '@/lib/i18n/locale';
import type { Conclusion, Verdict } from './schema';

export { conclusionSchema, parseConclusion } from './schema';
export type { Conclusion, ConclusionDimension, ConclusionFixedCost, ConclusionScenario, RevenueBasis, Verdict } from './schema';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The snapshot both surfaces print: report id + the moment the numbers were frozen. */
export function snapshotIdFor(reportId: string, generatedAt: string): string {
  return `${reportId}@${generatedAt}`;
}

/** Trilingual verdict wording — the same words on the web page and in the PDF. */
export const VERDICT_COPY: Record<Verdict, Record<Locale, { label: string; badge: string }>> = {
  GO: {
    zh: { label: '可做', badge: '可做 GO' },
    en: { label: 'GO', badge: 'GO' },
    es: { label: 'Viable', badge: 'VIABLE' },
  },
  CONDITIONAL_GO: {
    zh: { label: '有条件可做', badge: '有条件可做 CONDITIONAL GO' },
    en: { label: 'CONDITIONAL GO', badge: 'CONDITIONAL GO' },
    es: { label: 'Viable con condiciones', badge: 'VIABLE CON CONDICIONES' },
  },
  NO_GO: {
    zh: { label: '不建议', badge: '不建议 NO GO' },
    en: { label: 'NO GO', badge: 'NO GO' },
    es: { label: 'No viable', badge: 'NO VIABLE' },
  },
};

export function verdictLabelOf(verdict: Verdict, lang: Locale): string {
  return VERDICT_COPY[verdict][lang].label;
}

/**
 * The printed rule, generated from whatever thresholds are passed in — never
 * hand-typed, so a web score of 71 can never print 有条件可做 while the PDF prints
 * 可做. `verdictRuleText` in ./conclusion feeds it the constants from defaults.yaml.
 */
export function verdictRuleTextFor(t: { go: number; conditional: number }, lang: Locale): string {
  return pick(lang, {
    zh: `综合 ≥ ${t.go} → 可做 GO；${t.conditional}–${t.go - 1} → 有条件可做 CONDITIONAL GO；< ${t.conditional} → 不建议 NO GO；未提供租金时最高只到「有条件可做」。`,
    en: `Overall ≥ ${t.go} → GO; ${t.conditional}–${t.go - 1} → CONDITIONAL GO; < ${t.conditional} → NO GO; without a real rent the verdict is capped at CONDITIONAL GO.`,
    es: `Puntuación ≥ ${t.go} → VIABLE; ${t.conditional}–${t.go - 1} → VIABLE CON CONDICIONES; < ${t.conditional} → NO VIABLE; sin una renta real el veredicto se limita a VIABLE CON CONDICIONES.`,
  });
}

/** Trilingual labels of the six deterministic dimensions (the conclusion carries ids only). */
export const DIMENSION_LABELS: Record<string, Record<Locale, string>> = {
  demand_coverage: { zh: '需求覆盖', en: 'Demand coverage', es: 'Cobertura de demanda' },
  audience_fit: { zh: '客群匹配', en: 'Audience fit', es: 'Encaje del público' },
  competitive_position: { zh: '竞争态势', en: 'Competitive position', es: 'Posición competitiva' },
  access_traffic: { zh: '可达与流量', en: 'Access & traffic', es: 'Acceso y tráfico' },
  financial_viability: { zh: '财务可行', en: 'Financial viability', es: 'Viabilidad financiera' },
  occasion_delivery: { zh: '场景与外卖', en: 'Occasion & delivery', es: 'Ocasión y entrega' },
};

export function dimensionLabel(id: string, lang: Locale): string {
  return DIMENSION_LABELS[id]?.[lang] ?? id.replace(/_/g, ' ');
}

/** The one-line note shown while the deterministic core has not landed yet (§4.4). */
export function conclusionPendingNote(lang: Locale): string {
  return pick(lang, {
    zh: '综合分与保本线将在深度版完成后统一更新，当前数字为初步结果。',
    en: 'The score and break-even will be finalised when the in-depth edition lands; the numbers below are preliminary.',
    es: 'La puntuación y el punto de equilibrio se unificarán cuando esté lista la edición a fondo; las cifras son preliminares.',
  });
}

/** Base-case monthly revenue of a conclusion (the number both surfaces headline). */
export function baseRevenueOf(c: Conclusion): number | null {
  return c.scenarios.find((s) => s.id === 'base')?.monthly_revenue ?? null;
}

/** Occupancy cost as a percentage with one decimal (what `dashboard.occupancy_cost_pct` shows). */
export function occupancyCostPct(c: Conclusion): number | null {
  return c.occupancy_cost_ratio == null ? null : round1(c.occupancy_cost_ratio * 100);
}

/**
 * Guard for every `conclusionFromModel` consumer: the fields a customer compares
 * across the two surfaces must be identical. Returns the differing field names
 * (empty = the surfaces agree).
 */
export function conclusionDiff(a: Conclusion, b: Conclusion): string[] {
  const out: string[] = [];
  const cmp = (k: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) out.push(k);
  };
  cmp('snapshot_id', a.snapshot_id, b.snapshot_id);
  cmp('data_as_of', a.data_as_of, b.data_as_of);
  cmp('overall', a.overall, b.overall);
  cmp('verdict', a.verdict, b.verdict);
  cmp('breakeven_monthly', a.breakeven_monthly, b.breakeven_monthly);
  cmp('safety_monthly', a.safety_monthly, b.safety_monthly);
  cmp('rent_excluded', a.rent_excluded, b.rent_excluded);
  cmp('occupancy_cost_ratio', a.occupancy_cost_ratio, b.occupancy_cost_ratio);
  cmp('fixed_cost', a.fixed_cost, b.fixed_cost);
  cmp('scenarios', a.scenarios, b.scenarios);
  cmp('data_confidence_pct', a.data_confidence_pct, b.data_confidence_pct);
  cmp('basis', a.basis, b.basis);
  cmp('dimensions', a.dimensions, b.dimensions);
  return out;
}
