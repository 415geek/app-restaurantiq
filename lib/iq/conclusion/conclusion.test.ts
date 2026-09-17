/**
 * 评审 Spec §4.1 单一结论源 (P0-A).
 *
 * The bug these tests lock down (report a7217ad7, 1115 Clement St, egg tart): the
 * same paid report printed 71 / 有条件可做 / break-even $51,937 / 9.1 % occupancy /
 * 57 % completeness on the web page and 76.8 / 可做 / $48,807 / 3.5 % / 75 in the
 * 360° PDF. Every assertion below is one of those columns.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyConclusionOverride, costBreakdownFromConclusion, decisionTierForVerdict } from '@/lib/funnel/iq-full-report-schema';
import { numScore, parseDecisionTier } from '@/lib/funnel/iq-risk-audit-model';
import { computeFinanceModel } from '@/lib/funnel/iq-finance-model';
import { reportModelSchema, type ReportModel } from '../model/schema';
import { getDefaults } from '../params';
import { strings } from '../render/i18n';
import {
  baseRevenueOf,
  dimensionLabel,
  conclusionDiff,
  conclusionFromModel,
  formatConclusionForAnchors,
  occupancyCostPct,
  parseConclusion,
  reconcileModelToConclusion,
  snapshotIdFor,
  verdictFromScore,
  verdictRuleText,
  verdictThresholds,
  type Conclusion,
} from './conclusion';
import { archetypeIdFor, costTierFor, fixedCostScaleFor } from './cost-scale';

const FIXTURE = join(process.cwd(), 'qa', 'fixtures', 'report_model_millbrae.json');

function loadModel(): ReportModel {
  return reportModelSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
}

/* -------------------------------------------------------------------------- */
/* 1. Verdict thresholds — one set, shared by both surfaces                    */
/* -------------------------------------------------------------------------- */

test('§4.5 verdict thresholds: ≥70 GO, 55–69 CONDITIONAL GO, <55 NO GO, rent cap keeps GO out', () => {
  const t = verdictThresholds();
  assert.equal(t.go, 70, 'defaults.yaml verdict.go must be the same 70 the printed rule text claims');
  assert.equal(t.conditional, 55);

  assert.equal(verdictFromScore(100, { rentMissing: false }), 'GO');
  assert.equal(verdictFromScore(70, { rentMissing: false }), 'GO');
  assert.equal(verdictFromScore(71, { rentMissing: false }), 'GO', 'the 71 that printed 有条件可做 on the web and 可做 in the PDF');
  assert.equal(verdictFromScore(69.9, { rentMissing: false }), 'CONDITIONAL_GO');
  assert.equal(verdictFromScore(55, { rentMissing: false }), 'CONDITIONAL_GO');
  assert.equal(verdictFromScore(54.9, { rentMissing: false }), 'NO_GO');
  assert.equal(verdictFromScore(0, { rentMissing: false }), 'NO_GO');

  // The missing-rent cap: a GO that never saw the largest fixed cost is indefensible.
  assert.equal(verdictFromScore(88, { rentMissing: true }), 'CONDITIONAL_GO');
  assert.equal(verdictFromScore(60, { rentMissing: true }), 'CONDITIONAL_GO');
  assert.equal(verdictFromScore(40, { rentMissing: true }), 'NO_GO', 'the cap never rescues a NO_GO');
});

test('the printed rule text is generated from the thresholds — and the PDF page-11 rule agrees', () => {
  const t = verdictThresholds();
  for (const lang of ['zh', 'en', 'es'] as const) {
    const text = verdictRuleText(lang);
    assert.ok(text.includes(String(t.go)), `${lang} rule text must quote the go threshold`);
    assert.ok(text.includes(String(t.conditional)), `${lang} rule text must quote the conditional threshold`);
    // The PDF prints its own page-11 rule block; it must not claim another number.
    const printed = Object.values(strings(lang).verdictRule).join(' ');
    assert.ok(printed.includes(String(t.go)), `${lang} PDF verdict rule must quote ${t.go}, got: ${printed}`);
    assert.ok(printed.includes(String(t.conditional)), `${lang} PDF verdict rule must quote ${t.conditional}`);
    assert.ok(!/\b75\b/.test(printed), `${lang} PDF verdict rule still quotes the retired 75 threshold`);
  }
});

/* -------------------------------------------------------------------------- */
/* 2. conclusionFromModel on the millbrae fixture                              */
/* -------------------------------------------------------------------------- */

test('conclusionFromModel: every figure comes from the model, once', () => {
  const m = loadModel();
  const c = conclusionFromModel(m);

  assert.equal(c.snapshot_id, snapshotIdFor(m.meta.report_id, m.meta.generated_at));
  assert.ok(c.snapshot_id.startsWith(m.meta.report_id), 'the PDF footer prints meta.report_id — it must prefix the snapshot');
  assert.equal(c.data_as_of, m.meta.data_as_of);
  assert.equal(c.overall, m.score.total);
  assert.equal(c.overall, Math.round(c.overall * 10) / 10, 'one decimal');
  assert.equal(c.verdict, verdictFromScore(m.score.total, { rentMissing: false }));
  assert.equal(c.verdict, 'NO_GO');
  assert.equal(c.breakeven_monthly, m.finance.breakeven_monthly);
  assert.equal(c.safety_monthly, m.finance.safety_monthly);
  assert.equal(c.rent_excluded, false);
  assert.equal(c.occupancy_cost_ratio, m.finance.occupancy_cost_ratio);
  assert.equal(c.fixed_cost.rent, m.finance.fixed_cost.rent);
  assert.equal(c.fixed_cost.total, m.finance.fixed_cost.total);
  assert.equal(c.data_confidence_pct, m.confidence.total);
  assert.equal(c.basis, 'seats_turns', 'the fixture gives 60 seats');
  assert.equal(c.dimensions.length, 6);
  assert.equal(
    Math.round(c.dimensions.reduce((s, d) => s + d.weighted, 0) * 10) / 10,
    c.overall,
    'Σ weighted = overall — there is no second score',
  );
  assert.deepEqual(
    c.scenarios.map((s) => s.id),
    ['pessimistic', 'base', 'optimistic'],
  );
  assert.equal(baseRevenueOf(c), m.finance.scenarios.find((s) => s.id === 'base')!.monthly_revenue);
  // Pure: same model in, same conclusion out.
  assert.deepEqual(conclusionFromModel(loadModel()), c);
  assert.deepEqual(conclusionDiff(c, conclusionFromModel(loadModel())), []);
  // It survives a round trip through the report row (report_model_json.conclusion).
  assert.deepEqual(parseConclusion(JSON.parse(JSON.stringify(c))), c);
});

test('the fixture (stored before P0-A) still parses, and the model carries no stale conclusion', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  assert.equal(raw.conclusion, undefined, 'the fixture predates the conclusion field');
  const m = reportModelSchema.parse(raw);
  assert.equal(m.conclusion, null, 'the zod default keeps old rows readable');
  assert.equal(m.finance.revenue_basis, 'seats_turns', 'and old finance blocks default their basis');
});

/* -------------------------------------------------------------------------- */
/* 3. Web surface vs PDF surface — the eight columns of the bug table          */
/* -------------------------------------------------------------------------- */

/** What the web standard report ends up showing for a model. */
function webSurface(model: ReportModel, lang: 'zh' = 'zh') {
  // An LLM draft that disagrees with the model on every single figure.
  const llmDraft = {
    dashboard: { overall_score: 71, occupancy_cost_pct: 9.1, recommendation: '有条件可做' },
    data_confidence_pct: 57,
    decision_tier: 'need_more_data',
    risk_audit: {
      overall_score: 71,
      decision_tier: 'need_more_data',
      data_confidence_pct: 57,
      break_even_revenue_monthly_usd: 51_937,
      safe_revenue_monthly_usd: 64_921,
      cost_breakdown: [{ item: 'Utilities', amount_usd: 1_920 }, { item: 'Insurance', amount_usd: 960 }, { item: 'POS / software', amount_usd: 720 }],
      layers: [{ id: 'location_base', score: 80 }],
    },
    revenue_model: { scenarios: [{ name: 'A', monthly_revenue_usd: 60_000 }, { name: 'B', monthly_revenue_usd: 87_863 }, { name: 'C', monthly_revenue_usd: 120_000 }] },
    executive_summary: 'prose the LLM keeps writing',
  };
  const out = applyConclusionOverride(llmDraft, model.conclusion, lang);
  const ra = out.risk_audit as Record<string, unknown>;
  const dash = out.dashboard as Record<string, unknown>;
  const rows = ra.cost_breakdown as Array<{ item: string; amount_usd: number }>;
  const cost = (i: number) => rows[i].amount_usd;
  return {
    report: out,
    // Read raw: the score carries one decimal and the UI prints it unrounded.
    overall: Number(ra.overall_score),
    verdict: parseDecisionTier(ra.decision_tier),
    breakeven: numScore(ra.break_even_revenue_monthly_usd),
    safety: numScore(ra.safe_revenue_monthly_usd),
    base_revenue: (out.revenue_model as { scenarios: Array<{ monthly_revenue_usd: number }> }).scenarios[1].monthly_revenue_usd,
    fixed_total: cost(7),
    utilities: cost(2),
    insurance: cost(3),
    pos: cost(4),
    occupancy_pct: dash.occupancy_cost_pct as number | null,
    confidence: numScore(ra.data_confidence_pct),
    prose: out.executive_summary,
  };
}

/** What the 360° PDF ends up printing for the same model (it renders the model itself). */
function pdfSurface(model: ReportModel) {
  // The print pages read model.score / model.finance; the parse-time guard keeps
  // those in step with the stored conclusion.
  const printed = reportModelSchema.parse(JSON.parse(JSON.stringify(model)));
  const c = printed.conclusion!;
  return {
    overall: printed.score.total,
    verdict: decisionTierForVerdict(printed.score.verdict),
    breakeven: printed.finance.breakeven_monthly,
    safety: printed.finance.safety_monthly,
    base_revenue: printed.finance.scenarios.find((s) => s.id === 'base')!.monthly_revenue,
    fixed_total: printed.finance.fixed_cost.total,
    utilities: printed.finance.fixed_cost.utilities,
    insurance: printed.finance.fixed_cost.insurance,
    pos: printed.finance.fixed_cost.pos,
    occupancy_pct: occupancyCostPct(c),
    confidence: printed.confidence.total,
    snapshot_id: snapshotIdFor(printed.meta.report_id, printed.meta.generated_at),
  };
}

test('web report and 360° PDF print the same eight numbers for the same model', () => {
  const model = loadModel();
  model.conclusion = conclusionFromModel(model);
  const web = webSurface(model);
  const pdf = pdfSurface(model);

  assert.equal(web.overall, pdf.overall, 'overall score');
  assert.equal(web.verdict, pdf.verdict, 'verdict');
  assert.equal(web.breakeven, pdf.breakeven, 'break-even');
  assert.equal(web.safety, pdf.safety, 'safe revenue');
  assert.equal(web.base_revenue, pdf.base_revenue, 'base monthly revenue');
  assert.equal(web.fixed_total, pdf.fixed_total, 'fixed cost');
  assert.equal(web.utilities, pdf.utilities, 'utilities');
  assert.equal(web.insurance, pdf.insurance, 'insurance');
  assert.equal(web.pos, pdf.pos, 'POS');
  assert.equal(web.occupancy_pct, pdf.occupancy_pct, 'occupancy cost ratio');
  assert.equal(web.confidence, pdf.confidence, 'data completeness');
  assert.equal(model.conclusion.snapshot_id, pdf.snapshot_id, 'both surfaces print one snapshot id');

  // None of the LLM's contradicting figures survived…
  assert.notEqual(web.overall, 71);
  assert.notEqual(web.breakeven, 51_937);
  assert.notEqual(web.utilities, 1_920);
  assert.notEqual(web.confidence, 57);
  assert.notEqual(web.base_revenue, 87_863);
  // …while its prose did.
  assert.equal(web.prose, 'prose the LLM keeps writing');
  assert.equal(web.report.conclusion_pending, false);
});

test('a rent-excluded model reads the same on both surfaces, and never shows an occupancy cost', () => {
  const model = loadModel();
  model.input.rent_usd = null;
  model.finance.fixed_cost.rent = null;
  model.finance.rent_excluded = true;
  model.finance.occupancy_cost_ratio = null;
  model.finance.fixed_cost.total = model.finance.fixed_cost.total! - 17_000;
  model.score.total = 78; // would be a GO if rent were known
  model.conclusion = conclusionFromModel(model);

  assert.equal(model.conclusion.verdict, 'CONDITIONAL_GO', 'the missing-rent cap holds in the conclusion');
  const web = webSurface(model);
  const pdf = pdfSurface(model);
  assert.equal(web.verdict, pdf.verdict);
  assert.equal(web.occupancy_pct, null);
  assert.equal(pdf.occupancy_pct, null);
  assert.equal(web.fixed_total, pdf.fixed_total);
  const rows = (web.report.risk_audit as { cost_breakdown: Array<{ item: string; note: string }> }).cost_breakdown;
  assert.ok(/不含租金/.test(rows[7].item + rows[7].note), `the total must be labelled ex-rent: ${JSON.stringify(rows[7])}`);
  assert.ok(rows[0].note.length > 0, 'the rent row says it was not provided');
});

test('临时方案: a model that drifted from its stored conclusion is rendered with the CONCLUSION', () => {
  const model = loadModel();
  model.conclusion = conclusionFromModel(model);
  const drifted = JSON.parse(JSON.stringify(model)) as ReportModel;
  // Someone re-ran an engine and wrote new numbers next to the frozen conclusion.
  drifted.score.total = 76.8;
  drifted.score.verdict = 'GO';
  drifted.finance.breakeven_monthly = 48_807;
  drifted.finance.fixed_cost.utilities = 1_260;
  drifted.confidence.total = 75;
  drifted.finance.scenarios[1].monthly_revenue = 192_240;

  const rendered = reportModelSchema.parse(drifted); // what the PDF loader does
  assert.equal(rendered.score.total, model.conclusion.overall);
  assert.equal(rendered.score.verdict, model.conclusion.verdict);
  assert.equal(rendered.finance.breakeven_monthly, model.conclusion.breakeven_monthly);
  assert.equal(rendered.finance.fixed_cost.utilities, model.conclusion.fixed_cost.utilities);
  assert.equal(rendered.confidence.total, model.conclusion.data_confidence_pct);
  assert.equal(rendered.finance.scenarios[1].monthly_revenue, baseRevenueOf(model.conclusion));
  assert.deepEqual(conclusionDiff(conclusionFromModel(rendered), model.conclusion), []);
  // …and the web surface built from the same conclusion still matches it.
  assert.equal(webSurface(rendered).overall, pdfSurface(rendered).overall);
  // A model without a conclusion is returned untouched.
  const noConclusion = { ...drifted, conclusion: null } as ReportModel;
  assert.equal(reconcileModelToConclusion(noConclusion).score.total, 76.8);
});

test('no conclusion yet: the body is flagged preliminary instead of carrying a second set of numbers', () => {
  const fm = computeFinanceModel({ marketData: {}, businessType: '蛋挞店', location: 'x' });
  const out = applyConclusionOverride({ risk_audit: { overall_score: 71 } }, null, 'zh', { financeModel: fm });
  assert.equal(out.conclusion_pending, true);
  assert.equal(out.conclusion, undefined);
  assert.equal(out._finance_model_applied, true, 'the legacy override still grounds the fallback body');
});

/* -------------------------------------------------------------------------- */
/* 4. The anchors the drafting prompt receives                                 */
/* -------------------------------------------------------------------------- */

test('§4.4 P1-e / P1-a: one competitive-strength number and one competitor count reach the web body', () => {
  const model = loadModel();
  model.conclusion = conclusionFromModel(model);
  const counts = { total: 12, direct: 4, same_category: 8, l3: 3, anchors: 5, by_source: { google: 9, yelp: 2, foursquare: 1 } };
  const out = applyConclusionOverride(
    {
      dashboard: { competition_intensity: 75 },
      risk_audit: { competition_pressure_score: 66, layers: [{ id: 'competition_pressure', score: 66 }] },
      decision_matrix: [{ dimension: '竞争', score_100: 66, weight_pct: 20, weighted_score: 13.2 }],
    },
    model.conclusion,
    'zh',
    { counts, verdictRule: 'rule' },
  );
  const dim = model.conclusion.dimensions.find((d) => d.id === 'competitive_position')!;
  const dash = out.dashboard as Record<string, unknown>;
  const ra = out.risk_audit as Record<string, unknown>;
  // 多维评分 / 关键指标 / 决策矩阵 — the three places that used to print 66 / 75 / 66.
  assert.equal(dash.competition_intensity, Math.round(dim.score));
  assert.equal(ra.competition_pressure_score, Math.round(dim.score));
  const matrix = out.decision_matrix as Array<{ dimension: string; score_100: number }>;
  assert.equal(matrix.length, 6);
  assert.equal(matrix.find((r) => r.dimension === dimensionLabel('competitive_position', 'zh'))!.score_100, dim.score);
  const layers = ra.layers as Array<{ id: string; score: number }>;
  assert.deepEqual(layers.map((l) => l.id), model.conclusion.dimensions.map((d) => d.id));
  // §4.4 P1-a: the canonical count block, not an LLM count.
  assert.deepEqual(out.competitor_counts, counts);
  assert.equal(out.verdict_rule, 'rule');
});

test('the anchor block states the frozen score, verdict, break-even and scenarios', () => {
  const model = loadModel();
  const c = conclusionFromModel(model);
  for (const lang of ['zh', 'en', 'es'] as const) {
    const block = formatConclusionForAnchors(c, lang);
    assert.ok(block.includes(String(c.overall)), `${lang}: score`);
    assert.ok(block.includes(c.breakeven_monthly!.toLocaleString('en-US')), `${lang}: break-even`);
    assert.ok(block.includes(baseRevenueOf(c)!.toLocaleString('en-US')), `${lang}: base revenue`);
    assert.ok(block.includes(c.snapshot_id), `${lang}: snapshot`);
    assert.ok(block.includes(String(c.data_confidence_pct)), `${lang}: data confidence`);
    assert.ok(block.includes(String(verdictThresholds().go)), `${lang}: the verdict rule`);
    const comp = c.dimensions.find((d) => d.id === 'competitive_position')!;
    assert.ok(block.includes(String(comp.score)), `${lang}: the one competition number`);
  }
});

/* -------------------------------------------------------------------------- */
/* 5. One cost scale                                                           */
/* -------------------------------------------------------------------------- */

test('cost_scale is the only place the fixed-cost constants live', () => {
  const cs = getDefaults().cost_scale;
  assert.deepEqual(Object.keys(cs.tiers).sort(), ['hcol', 'lcol', 'mcol']);
  const split = cs.split;
  assert.ok(split.utilities + split.insurance + split.pos + split.marketing < 1, 'misc is the remainder');

  // Tier resolution: income first, state fallback, mcol when neither is known.
  assert.equal(costTierFor(150_000, 'CA'), 'hcol');
  assert.equal(costTierFor(80_000, 'CA'), 'mcol');
  assert.equal(costTierFor(40_000, 'CA'), 'lcol');
  assert.equal(costTierFor(null, 'CA'), 'hcol');
  assert.equal(costTierFor(null, 'TX'), 'mcol');
  assert.equal(costTierFor(null, null), 'mcol');

  // The five rows always add up to the tier-scaled budget exactly.
  for (const cuisine of ['hunan', 'egg_tart', 'hot_pot', 'boba']) {
    for (const tier of ['hcol', 'mcol', 'lcol'] as const) {
      const s = fixedCostScaleFor(cuisine, tier);
      assert.equal(s.utilities + s.insurance + s.pos + s.marketing + s.misc, s.other_fixed_total, `${cuisine}/${tier}`);
      assert.ok(s.misc > 0, `${cuisine}/${tier} misc`);
    }
  }
  // Concepts land in the same archetype whichever engine asks.
  assert.equal(archetypeIdFor('egg_tart'), 'coffee_bakery');
  assert.equal(archetypeIdFor('hot_pot'), 'casual_dining');
  assert.equal(archetypeIdFor('skewers'), 'casual_dining');
  assert.equal(archetypeIdFor('middle_eastern'), 'fast_casual');
  assert.equal(archetypeIdFor('hunan'), 'asian_casual');
});

test('costBreakdownFromConclusion prints exactly the conclusion, localized', () => {
  const model = loadModel();
  const c: Conclusion = conclusionFromModel(model);
  const rows = costBreakdownFromConclusion(c, 'zh');
  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((r) => r.amount_usd),
    [c.fixed_cost.rent ?? 0, c.fixed_cost.labor, c.fixed_cost.utilities, c.fixed_cost.insurance, c.fixed_cost.pos, c.fixed_cost.marketing, c.fixed_cost.misc, c.fixed_cost.total],
  );
  assert.equal(rows[0].item, '租金（NNN）');
  assert.equal(costBreakdownFromConclusion(c, 'en')[0].item, 'Rent (NNN)');
});
