import { z } from 'zod';
import { DEFAULT_LOCALE, type Locale, pick } from '@/lib/i18n/locale';
import { decisionTierDisplay, decisionTierSchema, riskAuditFullSchema, type DecisionTier } from '@/lib/funnel/iq-risk-audit-model';
// ./display, not ./conclusion: this module is imported by client components, and the
// threshold half of the conclusion module reads defaults.yaml off disk (node:fs).
import { conclusionSchema, dimensionLabel, occupancyCostPct, type Conclusion } from '@/lib/iq/conclusion/display';
import type { CompetitorCounts } from '@/lib/iq/model/schema';
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
        occupancy_cost_pct: z.union([z.number(), z.string()]).optional(),
        recommendation: optionalString,
      })
      .optional(),
    dayparts: z
      .array(
        z.object({
          daypart: z.string(),
          traffic_level: optionalString,
          audience_type: optionalString,
          fit_for_concept: optionalString,
        }),
      )
      .optional(),
    site_history: z
      .object({
        prior_failures_detected: z.union([z.boolean(), z.string()]).optional(),
        note: optionalString,
        // Grounded in market_data.site_history (businesses at the exact address + reviews).
        prior_business_name: optionalString,
        prior_business_status: optionalString,
        review_themes_positive: z.array(z.string()).optional(),
        review_themes_negative: z.array(z.string()).optional(),
        lessons_for_new_operator: z.array(z.string()).optional(),
      })
      .optional(),
    cannibalization: z
      .object({
        overlap_pct_estimate: optionalString,
        affected_locations: z.array(z.string()).optional(),
        net_new_demand_note: optionalString,
      })
      .optional(),
    verdict_sensitivity: z.array(z.string()).optional(),
    deal_terms_guidance: optionalString,
    dual_model_verification: z
      .object({
        status: optionalString,
        primary_provider: optionalString,
        verify_provider: optionalString,
        disagreements: z.array(z.string()).optional(),
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
    /** §4.1 单一结论源: the stored conclusion both surfaces print, its pending flag and the printed rule. */
    conclusion: conclusionSchema.optional(),
    conclusion_pending: z.boolean().optional(),
    verdict_rule: optionalString,
    /** §4.4 P1-a 计数单一化: the ONE competitor count block, copied from the model. */
    competitor_counts: z
      .object({
        total: z.number(),
        direct: z.number(),
        same_category: z.number(),
        l3: z.number(),
        anchors: z.number(),
        by_source: z.object({ google: z.number(), yelp: z.number(), foursquare: z.number() }),
      })
      .optional(),
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

/** Map 高/中/低, English (High/Medium/Low) and Spanish (Alta/Media/Baja) variants to badge keys. */
export function normalizeConfidenceLevel(raw?: string): 'High' | 'Medium' | 'Low' | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (t.startsWith('高') || /\b(high|alta|alto)\b/i.test(lower)) return 'High';
  if (t.startsWith('中') || /\b(medium|med|media|medio|moderada|moderado)\b/i.test(lower)) return 'Medium';
  if (t.startsWith('低') || /\b(low|baja|bajo)\b/i.test(lower)) return 'Low';
  return undefined;
}

/** True when a free-text confidence value reads as "high" in any supported language. */
export function isHighConfidenceText(raw: unknown): boolean {
  return typeof raw === 'string' && normalizeConfidenceLevel(raw) === 'High';
}

/** True when a free-text confidence value reads as "medium" in any supported language. */
export function isMediumConfidenceText(raw: unknown): boolean {
  return typeof raw === 'string' && normalizeConfidenceLevel(raw) === 'Medium';
}

/** Localized confidence label for a badge key (what the LLM is asked to emit per language). */
export function confidenceLabel(level: 'High' | 'Medium' | 'Low', lang: Locale): string {
  const table: Record<'High' | 'Medium' | 'Low', Record<Locale, string>> = {
    High: { en: 'High', zh: '高', es: 'Alta' },
    Medium: { en: 'Medium', zh: '中', es: 'Media' },
    Low: { en: 'Low', zh: '低', es: 'Baja' },
  };
  return pick(lang, table[level]);
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
  /** True when §4.1 单一结论源 replaced every headline figure with the stored conclusion. */
  _conclusion_applied?: boolean;
  /** The stored conclusion the page and the PDF both print (not underscore-prefixed: the UI reads it). */
  conclusion?: Conclusion;
  /** True when the deterministic core had not landed at finalize time — the UI says so in one line. */
  conclusion_pending?: boolean;
  /** §4.4 P1-a: the ONE competitor count block every surface prints. */
  competitor_counts?: CompetitorCounts;
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
  lang: Locale = DEFAULT_LOCALE,
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
    const names = dropped.join(', ');
    warnings.push(
      pick(lang, {
        en: `Dropped ${dropped.length} unverified competitor name(s) that were not found in Google/Yelp/BrightData retrieval: ${names}.`,
        zh: `已剔除 ${dropped.length} 个未经 Google/Yelp/BrightData 检索核实的竞品店名：${names}。`,
        es: `Se eliminaron ${dropped.length} nombre(s) de competidores sin verificar que no aparecieron en la búsqueda de Google/Yelp/BrightData: ${names}.`,
      }),
    );
  }
  if (whitelist.total < MIN_WHITELIST_FOR_GROUNDED_REPORT) {
    warnings.push(
      pick(lang, {
        en: `Only ${whitelist.total} named competitor(s) were retrieved (the minimum for a grounded competitor analysis is ${MIN_WHITELIST_FOR_GROUNDED_REPORT}). Treat competitor commentary as low-confidence.`,
        zh: `仅检索到 ${whitelist.total} 家具名竞品（有据可依的竞品分析至少需要 ${MIN_WHITELIST_FOR_GROUNDED_REPORT} 家）。竞品相关结论请按低置信度看待。`,
        es: `Solo se recuperaron ${whitelist.total} competidor(es) con nombre (el mínimo para un análisis competitivo fundamentado es ${MIN_WHITELIST_FOR_GROUNDED_REPORT}). Considere los comentarios sobre competidores como de baja confianza.`,
      }),
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
 * The deterministic finance model is computed once per address (language-agnostic)
 * and cached, so its user-facing labels are canonical English strings. Translate
 * the ones the report renders at override time; unknown strings pass through.
 */
const FINANCE_TEXT: Record<string, Record<Locale, string>> = {
  'Rent (NNN)': { en: 'Rent (NNN)', zh: '租金（NNN）', es: 'Renta (NNN)' },
  'Labor (loaded)': { en: 'Labor (loaded)', zh: '人工（含税费负担）', es: 'Mano de obra (con cargas)' },
  Utilities: { en: 'Utilities', zh: '水电', es: 'Servicios' },
  Insurance: { en: 'Insurance', zh: '保险', es: 'Seguros' },
  'POS / software': { en: 'POS / software', zh: 'POS / 软件', es: 'POS / software' },
  'Marketing / loyalty': { en: 'Marketing / loyalty', zh: '营销 / 会员', es: 'Marketing / lealtad' },
  'Misc / admin': { en: 'Misc / admin', zh: '杂项 / 行政', es: 'Varios / administración' },
  'Fixed total / mo': { en: 'Fixed total / mo', zh: '固定成本合计 / 月', es: 'Total fijo / mes' },
  'Fixed total / mo (excl. rent)': { en: 'Fixed total / mo (excl. rent)', zh: '固定成本合计 / 月（不含租金）', es: 'Total fijo / mes (sin renta)' },
  'user-provided monthly rent': { en: 'user-provided monthly rent', zh: '用户提供的月租金', es: 'renta mensual proporcionada por el usuario' },
  'user-provided sqft': { en: 'user-provided sqft', zh: '用户提供的面积', es: 'pies cuadrados proporcionados por el usuario' },
  'ACS county/tract anchors': { en: 'ACS county/tract anchors', zh: 'ACS 县级/片区锚点', es: 'anclajes ACS de condado/tramo' },
  'commercial-listings rent sample': { en: 'commercial-listings rent sample', zh: '商业租盘租金样本', es: 'muestra de rentas de locales comerciales' },
  'address + cuisine + tier defaults only': { en: 'address + cuisine + tier defaults only', zh: '仅地址 + 业态 + 城市档位默认值', es: 'solo valores predeterminados de dirección + cocina + nivel de ciudad' },
};

export function localizeFinanceText(text: string, lang: Locale): string {
  const entry = FINANCE_TEXT[text];
  return entry ? pick(lang, entry) : text;
}

/* ------------------------------------------------------------------------ */
/*        §4.1 单一结论源 (P0-A): the conclusion overrides the LLM              */
/* ------------------------------------------------------------------------ */

/** Verdict → the five-tier product wording the web report renders. */
export function decisionTierForVerdict(verdict: Conclusion['verdict']): DecisionTier {
  return verdict === 'GO' ? 'strong_go' : verdict === 'CONDITIONAL_GO' ? 'go_with_conditions' : 'no_go';
}

const SCENARIO_NAME: Record<Conclusion['scenarios'][number]['id'], Record<Locale, string>> = {
  pessimistic: { en: 'Pessimistic', zh: '保守情景', es: 'Pesimista' },
  base: { en: 'Base case', zh: '基准情景', es: 'Caso base' },
  optimistic: { en: 'Optimistic', zh: '乐观情景', es: 'Optimista' },
};

const BASIS_NOTE: Record<Conclusion['basis'], Record<Locale, string>> = {
  seats_turns: {
    en: 'Revenue basis: seats × turns × ticket (the single finance model).',
    zh: '营收口径：座位数 × 翻台 × 客单价（唯一财务模型）。',
    es: 'Base de ingresos: asientos × rotaciones × ticket (el modelo financiero único).',
  },
  demand_capture: {
    en: 'Revenue basis: modelled captured demand (no seat count or floor area was provided).',
    zh: '营收口径：模型捕获需求（未提供座位数或面积）。',
    es: 'Base de ingresos: demanda captada modelada (no se indicaron asientos ni superficie).',
  },
};

/** The 8 cost rows the report prints, built from the conclusion's fixed cost. */
export function costBreakdownFromConclusion(
  conclusion: Conclusion,
  lang: Locale,
): Array<{ item: string; amount_usd: number; note: string }> {
  const fc = conclusion.fixed_cost;
  const rentNote = pick(lang, {
    en: 'Not provided — rent is never estimated; the break-even below EXCLUDES rent',
    zh: '未提供——本报告不估算租金，下方保本线不含租金',
    es: 'No proporcionada — la renta nunca se estima; el punto de equilibrio EXCLUYE la renta',
  });
  const totalNote = conclusion.rent_excluded
    ? pick(lang, {
        en: 'Labor + other fixed, EXCLUDING rent',
        zh: '人工 + 其他固定成本，不含租金',
        es: 'Mano de obra + otros fijos, SIN renta',
      })
    : pick(lang, { en: 'Rent + labor + other fixed', zh: '租金 + 人工 + 其他固定成本', es: 'Renta + mano de obra + otros fijos' });
  const row = (item: string, amount_usd: number, note = '') => ({ item: localizeFinanceText(item, lang), amount_usd, note });
  return [
    row('Rent (NNN)', fc.rent ?? 0, conclusion.rent_excluded ? rentNote : ''),
    row('Labor (loaded)', fc.labor),
    row('Utilities', fc.utilities),
    row('Insurance', fc.insurance),
    row('POS / software', fc.pos),
    row('Marketing / loyalty', fc.marketing),
    row('Misc / admin', fc.misc),
    row(conclusion.rent_excluded ? 'Fixed total / mo (excl. rent)' : 'Fixed total / mo', fc.total, totalNote),
  ];
}

/**
 * 评审 Spec §4.1 单一结论源 (P0-A) — THE override.
 *
 * Symptom: the same paid report showed 71 / 有条件可做 / break-even $51,937 on the
 * web page and 76.8 / 可做 / $48,807 in the 360° PDF, because the web score was an
 * LLM number (`risk_audit.overall_score`) and the web break-even came from a second
 * finance engine. From now on the LLM writes PROSE ONLY: every figure a customer
 * could compare across the two surfaces is replaced here by the stored conclusion
 * (`report_model_json.conclusion`, derived by lib/iq/conclusion/conclusion.ts).
 *
 * `conclusion == null` (the deterministic core did not land inside its budget) falls
 * back to the legacy finance-model override and marks the body `conclusion_pending`,
 * so the UI says the numbers are preliminary instead of showing a second set.
 *
 * Pure function — does not mutate its input.
 */
export function applyConclusionOverride(
  report: IqReportWithGrounding,
  conclusion: Conclusion | null | undefined,
  lang: Locale = DEFAULT_LOCALE,
  opts: {
    financeModel?: import('./iq-finance-model').DeterministicFinanceModel | null;
    /** `verdictRuleText(lang)` — generated from the ONE threshold set by the caller (server side). */
    verdictRule?: string | null;
    /** §4.4 P1-a: `report_model_json.competitors.counts` — the ONE competitor count block. */
    counts?: CompetitorCounts | null;
  } = {},
): IqReportWithGrounding {
  if (!conclusion) {
    const fallback = applyFinanceModelOverride(report, opts.financeModel, lang);
    return { ...fallback, conclusion_pending: true };
  }

  const existingRiskAudit = report.risk_audit && typeof report.risk_audit === 'object' ? (report.risk_audit as Record<string, unknown>) : {};
  const existingDashboard = report.dashboard && typeof report.dashboard === 'object' ? (report.dashboard as Record<string, unknown>) : {};
  const existingRevenueModel = report.revenue_model && typeof report.revenue_model === 'object' ? (report.revenue_model as Record<string, unknown>) : {};
  const llmScenarios = Array.isArray(existingRevenueModel.scenarios) ? (existingRevenueModel.scenarios as Array<Record<string, unknown>>) : [];

  const tier = decisionTierForVerdict(conclusion.verdict);
  const tierCopy = decisionTierDisplay(tier, lang);
  const occupancy = occupancyCostPct(conclusion);
  // §4.4 P1-e 竞争强度三个数: ONE competitive-strength number. The deterministic
  // `competitive_position` dimension replaces the LLM's `dashboard.competition_intensity`
  // and its flat risk_audit sibling, so 多维评分 / 关键指标 / 决策矩阵 can no longer
  // print 66 / 75 / 66 for the same site.
  const competition = conclusion.dimensions.find((d) => d.id === 'competitive_position');

  // The six deterministic dimensions replace whatever bars the LLM invented.
  const layers = conclusion.dimensions.map((d) => ({
    id: d.id,
    score: Math.round(d.score),
    label: dimensionLabel(d.id, lang),
    note: `${d.weight}% × ${d.score} = ${d.weighted}`,
  }));

  const scenarios = conclusion.scenarios.map((s, i) => {
    const llm = llmScenarios[i] && typeof llmScenarios[i] === 'object' ? llmScenarios[i] : {};
    return {
      ...llm,
      name: typeof llm.name === 'string' && llm.name.trim() ? llm.name : pick(lang, SCENARIO_NAME[s.id]),
      monthly_revenue_usd: s.monthly_revenue,
    };
  });

  const note = pick(lang, {
    en: `Score, verdict, break-even, safe revenue, cost table and revenue scenarios come from the single stored conclusion (snapshot ${conclusion.snapshot_id}); the web report and the 360° PDF print the same numbers. ${pick(lang, BASIS_NOTE[conclusion.basis])}`,
    zh: `综合分、结论、保本线、安全营收、成本表与营收情景均来自唯一结论快照（${conclusion.snapshot_id}）；网页版与 360° PDF 打印同一组数字。${pick(lang, BASIS_NOTE[conclusion.basis])}`,
    es: `La puntuación, el veredicto, el punto de equilibrio, los ingresos seguros, la tabla de costos y los escenarios provienen de la conclusión única almacenada (snapshot ${conclusion.snapshot_id}); el informe web y el PDF 360° imprimen las mismas cifras. ${pick(lang, BASIS_NOTE[conclusion.basis])}`,
  });
  const existingWarnings = Array.isArray(report._warnings) ? report._warnings.slice() : [];

  return {
    ...report,
    decision_tier: tier,
    data_confidence_pct: conclusion.data_confidence_pct,
    dashboard: {
      ...existingDashboard,
      overall_score: conclusion.overall,
      occupancy_cost_pct: occupancy,
      recommendation: tierCopy?.label ?? existingDashboard.recommendation,
      ...(competition ? { competition_intensity: Math.round(competition.score) } : {}),
    },
    risk_audit: {
      ...existingRiskAudit,
      overall_score: conclusion.overall,
      decision_tier: tier,
      layers,
      break_even_revenue_monthly_usd: conclusion.breakeven_monthly,
      safe_revenue_monthly_usd: conclusion.safety_monthly,
      cost_breakdown: costBreakdownFromConclusion(conclusion, lang),
      data_confidence_pct: conclusion.data_confidence_pct,
      ...(competition ? { competition_pressure_score: Math.round(competition.score) } : {}),
    },
    // 决策矩阵 is the same six weighted dimensions, never a second table.
    decision_matrix: conclusion.dimensions.map((d) => ({
      dimension: dimensionLabel(d.id, lang),
      score_100: d.score,
      weight_pct: d.weight,
      weighted_score: d.weighted,
    })),
    revenue_model: { ...existingRevenueModel, scenarios },
    conclusion,
    conclusion_pending: false,
    ...(opts.verdictRule ? { verdict_rule: opts.verdictRule } : {}),
    ...(opts.counts ? { competitor_counts: opts.counts } : {}),
    _conclusion_applied: true,
    _warnings: [...existingWarnings, note],
  };
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
  lang: Locale = DEFAULT_LOCALE,
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
    cost_breakdown: financeModel.cost_breakdown.map((row) => ({
      ...row,
      item: localizeFinanceText(row.item, lang),
    })),
  };

  const existingWarnings = Array.isArray(report._warnings) ? report._warnings.slice() : [];
  const reasons = financeModel.confidence_reasons
    .map((r) => localizeFinanceText(r, lang))
    .join('; ');
  const confidenceWord = pick(lang, {
    en: financeModel.confidence,
    zh: financeModel.confidence === 'high' ? '高' : financeModel.confidence === 'medium' ? '中' : '低',
    es: financeModel.confidence === 'high' ? 'alta' : financeModel.confidence === 'medium' ? 'media' : 'baja',
  });
  const note =
    financeModel.confidence === 'low'
      ? pick(lang, {
          en: `Break-even and safe revenue come from the deterministic D-4 finance model at LOW confidence (based only on: ${reasons}). The numbers are bounded by archetype and city-tier estimates; add real rent, square footage, or lease terms to raise confidence.`,
          zh: `保本营收与安全营收来自确定性 D-4 财务模型，置信度为低（仅依据：${reasons}）。数字受业态原型与城市档位估算约束；补充真实租金、面积或租约条款可提升置信度。`,
          es: `El punto de equilibrio y los ingresos seguros provienen del modelo financiero determinista D-4 con confianza BAJA (basado solo en: ${reasons}). Las cifras están acotadas por estimaciones de arquetipo y nivel de ciudad; agregue renta real, pies cuadrados o términos del contrato para elevar la confianza.`,
        })
      : pick(lang, {
          en: `Break-even and safe revenue come from the deterministic D-4 finance model (${confidenceWord} confidence): ${reasons}.`,
          zh: `保本营收与安全营收来自确定性 D-4 财务模型（置信度：${confidenceWord}）：${reasons}。`,
          es: `El punto de equilibrio y los ingresos seguros provienen del modelo financiero determinista D-4 (confianza ${confidenceWord}): ${reasons}.`,
        });

  const existingDashboard =
    report.dashboard && typeof report.dashboard === 'object'
      ? (report.dashboard as Record<string, unknown>)
      : {};

  return {
    ...report,
    dashboard: {
      ...existingDashboard,
      occupancy_cost_pct: financeModel.occupancy_cost_pct_at_safe,
    },
    risk_audit: overriddenRiskAudit,
    _finance_model_applied: true,
    _finance_model_snapshot: financeModel,
    _warnings: [...existingWarnings, note],
  };
}
