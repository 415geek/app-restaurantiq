/**
 * 评审 Spec §4.1 单一结论源 (P0-A) — THE conclusion.
 *
 * Symptom this module removes (report a7217ad7, 1115 Clement St, egg tart): the
 * same paid report showed 71 / 有条件可做 / break-even $51,937 on the web page and
 * 76.8 / 可做 / $48,807 in the 360° PDF, because the web score came from the LLM
 * (`risk_audit.overall_score`) and the web break-even from a second finance
 * engine. A paying customer saw both and asked for a refund.
 *
 * Rules enforced here:
 *   1. `conclusionFromModel` is the ONLY place a verdict or a break-even is derived.
 *   2. The object it returns is stored on the row (`report_model_json.conclusion`)
 *      and is what BOTH surfaces print — the PDF never recomputes
 *      (`reconcileModelToConclusion` is the interim safety net, 临时方案).
 *   3. The verdict thresholds live once, in `defaults.yaml` → `verdict`, and the
 *      printed rule text is generated from them (`verdictRuleText`).
 */
import { pick, type Locale } from '@/lib/i18n/locale';
import { getDefaults } from '../params';
import type { ReportModel } from '../model/schema';
import type { Conclusion, ConclusionScenario, Verdict } from './schema';
import { baseRevenueOf, dimensionLabel, occupancyCostPct, snapshotIdFor, VERDICT_COPY, verdictRuleTextFor } from './display';

/**
 * Presentation helpers live in ./display (client-safe: no YAML loader), and are
 * re-exported here so server code has ONE import point for the conclusion.
 */
export * from './display';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The one verdict rule (§4.5): ≥ go → GO, ≥ conditional → CONDITIONAL_GO, else NO_GO. */
export function verdictThresholds(): { go: number; conditional: number } {
  const v = getDefaults().verdict;
  return { go: v.go, conditional: v.conditional };
}

/**
 * Score → verdict. The missing-rent cap stays: without a real rent the model has
 * no occupancy cost, so a GO is only ever a CONDITIONAL GO.
 */
export function verdictFromScore(total: number, opts: { rentMissing: boolean }): Verdict {
  const t = verdictThresholds();
  const v: Verdict = total >= t.go ? 'GO' : total >= t.conditional ? 'CONDITIONAL_GO' : 'NO_GO';
  return opts.rentMissing && v === 'GO' ? 'CONDITIONAL_GO' : v;
}

/** The printed rule, generated from the ONE threshold set in defaults.yaml. */
export function verdictRuleText(lang: Locale): string {
  return verdictRuleTextFor(verdictThresholds(), lang);
}

/**
 * Derive THE conclusion from a report model. Pure: no I/O, no randomness, no
 * LLM. Everything a customer reads as a "conclusion" on either surface comes
 * from this object.
 */
export function conclusionFromModel(model: ReportModel): Conclusion {
  const f = model.finance;
  const rent_excluded = f.rent_excluded === true || f.fixed_cost.rent == null;
  const overall = round1(model.score.total);
  const fc = f.fixed_cost;
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const scenarios: ConclusionScenario[] = f.scenarios.map((s) => ({
    id: s.id,
    monthly_revenue: Math.round(s.monthly_revenue),
    vs_breakeven: s.vs_breakeven ?? null,
  }));
  return {
    snapshot_id: snapshotIdFor(model.meta.report_id, model.meta.generated_at),
    data_as_of: model.meta.data_as_of,
    overall,
    verdict: verdictFromScore(overall, { rentMissing: rent_excluded }),
    dimensions: model.score.dimensions.map((d) => ({ id: d.id, score: d.score, weight: d.weight, weighted: d.weighted })),
    breakeven_monthly: f.breakeven_monthly ?? null,
    safety_monthly: f.safety_monthly ?? null,
    rent_excluded,
    occupancy_cost_ratio: f.occupancy_cost_ratio ?? null,
    fixed_cost: {
      rent: fc.rent ?? null,
      labor: n(fc.labor),
      utilities: n(fc.utilities),
      insurance: n(fc.insurance),
      pos: n(fc.pos),
      marketing: n(fc.marketing),
      misc: n(fc.misc),
      total: n(fc.total),
    },
    scenarios,
    data_confidence_pct: Math.round(model.confidence.total),
    basis: f.revenue_basis ?? 'seats_turns',
  };
}

/**
 * The 临时方案 guard lives in ./reconcile (structural, so the model schema can run
 * it on every parse without an import cycle) and is re-exported here — the
 * conclusion module stays the single entry point for consumers.
 */
export { reconcileModelToConclusion } from './reconcile';

/**
 * The conclusion as HARD RULES for the drafting prompt (§4.1 requirement 3).
 *
 * The LLM keeps writing prose only: these anchors tell it the score, the verdict,
 * the break-even and the scenarios are already decided, so the paragraph next to
 * the number cannot say "可做" while the badge says "有条件可做".
 */
export function formatConclusionForAnchors(c: Conclusion, lang: Locale): string {
  const usd = (v: number | null) => (v == null ? '—' : `$${v.toLocaleString('en-US')}`);
  const base = baseRevenueOf(c);
  const occ = occupancyCostPct(c);
  const dims = c.dimensions.map((d) => `${dimensionLabel(d.id, lang)} ${d.score}×${d.weight}%`).join(' · ');
  // §4.4 P1-e: ONE competitive-strength number for the radar, the dashboard tile and the decision matrix.
  const comp = c.dimensions.find((d) => d.id === 'competitive_position');
  const verdict = VERDICT_COPY[c.verdict][lang].badge;
  const rentLine = c.rent_excluded
    ? pick(lang, {
        en: 'NO rent was provided: the break-even EXCLUDES rent and no rent figure may be invented anywhere in the prose.',
        zh: '用户未提供租金：保本线不含租金，正文任何位置都不得编造租金数字。',
        es: 'NO se proporcionó renta: el punto de equilibrio EXCLUYE la renta y el texto no puede inventar ninguna cifra de renta.',
      })
    : `${pick(lang, { en: 'Monthly rent', zh: '月租金', es: 'Renta mensual' })}: ${usd(c.fixed_cost.rent)}`;

  const head = pick(lang, {
    en: '[SINGLE SOURCE OF TRUTH — THE CONCLUSION (§4.1 P0-A). These figures are already final and are printed on BOTH the web report and the 360° PDF. Write prose around them; NEVER restate, re-round or contradict them.]',
    zh: '【唯一结论源——已定稿数字（§4.1 P0-A）。以下数字已冻结，网页版与 360° PDF 打印的都是它们。你只写文字说明，禁止重算、改写、四舍五入或与之矛盾。】',
    es: '[FUENTE ÚNICA DE VERDAD — LA CONCLUSIÓN (§4.1 P0-A). Estas cifras ya son definitivas y se imprimen en el informe web Y en el PDF 360°. Escribe el texto alrededor de ellas; NUNCA las recalcules ni las contradigas.]',
  });
  const rules = pick(lang, {
    en: [
      `- [HARD RULE A] Overall score = ${c.overall}/100 and the verdict = ${verdict}. ${verdictRuleText('en')}`,
      `- [HARD RULE B] Break-even = ${usd(c.breakeven_monthly)}/mo; safe revenue = ${usd(c.safety_monthly)}/mo.`,
      `- [HARD RULE C] Monthly revenue scenarios: ${c.scenarios.map((s) => `${s.id} ${usd(s.monthly_revenue)}`).join('; ')} (base ${usd(base)}). ${BASIS_TEXT[c.basis].en}`,
      `- [HARD RULE D] Fixed cost/mo: labor ${usd(c.fixed_cost.labor)}, utilities ${usd(c.fixed_cost.utilities)}, insurance ${usd(c.fixed_cost.insurance)}, POS ${usd(c.fixed_cost.pos)}, marketing ${usd(c.fixed_cost.marketing)}, misc ${usd(c.fixed_cost.misc)}, total ${usd(c.fixed_cost.total)}. ${rentLine}`,
      `- [HARD RULE E] Occupancy cost = ${occ == null ? 'not computable (no rent)' : `${occ}%`}; data confidence = ${c.data_confidence_pct}% — use these exact values, no second set.`,
      `- [HARD RULE F] The six scored dimensions are ${dims}. Do not invent other dimension scores.`,
      `- [HARD RULE G] Competitive strength / competition intensity = ${comp ? comp.score : '—'} — the ONE number for the radar, dashboard.competition_intensity and the decision matrix. Never write a second one.`,
      `- Snapshot ${c.snapshot_id}, data as of ${c.data_as_of}.`,
    ].join('\n'),
    zh: [
      `- 【硬约束 A】综合分 = ${c.overall}/100，结论 = ${verdict}。${verdictRuleText('zh')}`,
      `- 【硬约束 B】保本营收 = ${usd(c.breakeven_monthly)}/月；安全营收 = ${usd(c.safety_monthly)}/月。`,
      `- 【硬约束 C】月营收情景：${c.scenarios.map((s) => `${s.id} ${usd(s.monthly_revenue)}`).join('；')}（基准 ${usd(base)}）。${BASIS_TEXT[c.basis].zh}`,
      `- 【硬约束 D】月固定成本：人工 ${usd(c.fixed_cost.labor)}、水电 ${usd(c.fixed_cost.utilities)}、保险 ${usd(c.fixed_cost.insurance)}、POS ${usd(c.fixed_cost.pos)}、营销 ${usd(c.fixed_cost.marketing)}、杂项 ${usd(c.fixed_cost.misc)}、合计 ${usd(c.fixed_cost.total)}。${rentLine}`,
      `- 【硬约束 E】占用成本 = ${occ == null ? '无法计算（未提供租金）' : `${occ}%`}；数据置信度 = ${c.data_confidence_pct}%——只能用这两个数字，不得另给一套。`,
      `- 【硬约束 F】六个维度得分为 ${dims}，不得自行发明其他维度或分数。`,
      `- 【硬约束 G】竞争强度 = ${comp ? comp.score : '—'}——多维评分、关键指标与决策矩阵用的都是这一个数字，禁止再写第二个。`,
      `- 结论快照 ${c.snapshot_id}，数据截至 ${c.data_as_of}。`,
    ].join('\n'),
    es: [
      `- [REGLA ESTRICTA A] Puntuación global = ${c.overall}/100 y veredicto = ${verdict}. ${verdictRuleText('es')}`,
      `- [REGLA ESTRICTA B] Punto de equilibrio = ${usd(c.breakeven_monthly)}/mes; ingresos seguros = ${usd(c.safety_monthly)}/mes.`,
      `- [REGLA ESTRICTA C] Escenarios de ingresos mensuales: ${c.scenarios.map((s) => `${s.id} ${usd(s.monthly_revenue)}`).join('; ')} (base ${usd(base)}). ${BASIS_TEXT[c.basis].es}`,
      `- [REGLA ESTRICTA D] Costos fijos/mes: mano de obra ${usd(c.fixed_cost.labor)}, servicios ${usd(c.fixed_cost.utilities)}, seguros ${usd(c.fixed_cost.insurance)}, POS ${usd(c.fixed_cost.pos)}, marketing ${usd(c.fixed_cost.marketing)}, varios ${usd(c.fixed_cost.misc)}, total ${usd(c.fixed_cost.total)}. ${rentLine}`,
      `- [REGLA ESTRICTA E] Costo de ocupación = ${occ == null ? 'no calculable (sin renta)' : `${occ}%`}; confianza de los datos = ${c.data_confidence_pct}% — use exactamente estos valores.`,
      `- [REGLA ESTRICTA F] Las seis dimensiones puntuadas son ${dims}. No invente otras.`,
      `- [REGLA ESTRICTA G] Intensidad competitiva = ${comp ? comp.score : '—'}: el ÚNICO número para el radar, dashboard.competition_intensity y la matriz de decisión.`,
      `- Snapshot ${c.snapshot_id}, datos al ${c.data_as_of}.`,
    ].join('\n'),
  });
  return `\n\n${head}\n${rules}\n`;
}

const BASIS_TEXT: Record<Conclusion['basis'], Record<Locale, string>> = {
  seats_turns: {
    en: 'Basis: seats × turns × ticket.',
    zh: '口径：座位数 × 翻台 × 客单价。',
    es: 'Base: asientos × rotaciones × ticket.',
  },
  demand_capture: {
    en: 'Basis: modelled captured demand (no seats or floor area were provided).',
    zh: '口径：模型捕获需求（未提供座位数或面积）。',
    es: 'Base: demanda captada modelada (sin asientos ni superficie).',
  },
};
