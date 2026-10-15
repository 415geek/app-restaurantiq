/**
 * GF-006 free / paid consistency (v4 §5). The real case: 900 Grant Ave, 葡挞,
 * rent $400 — free said 暂缓签租 54 / ~$3,700, paid said GO 79.2 / $51,544.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportModelSchema, type ReportModel } from '@/lib/iq/model/schema';
import { baseRevenueOf, conclusionFromModel } from '@/lib/iq/conclusion/conclusion';
import { decisionTierForVerdict } from './iq-full-report-schema';
import { applyProjectionToFreeResult, projectFreeResult } from './iq-free-projection';

const FIXTURE = join(process.cwd(), 'qa', 'fixtures', 'report_model_millbrae.json');
function model(): ReportModel {
  const m = reportModelSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  m.conclusion = conclusionFromModel(m);
  m.score.verdict = m.conclusion.verdict;
  return m;
}

test('GF-006: the free projection is the paid conclusion, field for field', () => {
  const m = model();
  const p = projectFreeResult(m);
  const c = m.conclusion!;
  assert.equal(p.verdict, c.verdict);
  assert.equal(p.decision_tier, decisionTierForVerdict(c.verdict));
  assert.equal(p.overall, c.overall, 'free.score == paid.score');
  assert.equal(p.completeness, c.data_confidence_pct);
  assert.equal(p.monthly_revenue_base, baseRevenueOf(c), 'free.revenue == paid.revenue (was 14× apart)');
  assert.equal(p.breakeven_monthly, c.breakeven_monthly);
  assert.equal(p.competitor_direct, m.competitors.counts.direct);
  assert.equal(p.competitor_total, m.competitors.counts.total);
  assert.deepEqual(
    p.dimensions.map((d) => d.id),
    c.dimensions.map((d) => d.id),
    'the free scorecard uses the six paid dimensions, not a second set',
  );
});

test('GF-006: the language model may write prose, never the numbers', () => {
  const m = model();
  const p = projectFreeResult(m);
  const llm = {
    headline: 'LLM headline',
    decision_tier: 'strong_go',
    risk_audit_preview: { overall_score: 79.2, data_confidence_pct: 95, layers: [{ id: 'location_base', score: 88 }], radar: { foo: 1 } },
  };
  const out = applyProjectionToFreeResult(llm, p, 'zh');
  assert.equal(out.headline, 'LLM headline', 'prose untouched');
  assert.equal(out.decision_tier, p.decision_tier);
  assert.equal(out.risk_audit_preview?.overall_score, p.overall);
  assert.equal(out.risk_audit_preview?.data_confidence_pct, p.completeness);
  assert.deepEqual(out.risk_audit_preview?.layers?.map((l) => l.id), p.dimensions.map((d) => d.id));
  assert.ok(!('foo' in (out.risk_audit_preview?.radar ?? {})), 'the LLM radar is replaced, not merged');
});

test('GF-006: a flagged, unconfirmed $400 rent cannot produce GO on either surface', () => {
  const m = model();
  const flagged: ReportModel = {
    ...m,
    input_sanity: [{ field: 'rent_usd', value: 400, reason: 'below_floor', benchmark: { value: 1200, label: 'tier_floor_hcol', source: 'defaults.yaml' }, blocks_scoring: true, confirmation: null, confirmed: false }],
    conclusion: null,
  };
  flagged.conclusion = conclusionFromModel(flagged);
  flagged.score.verdict = flagged.conclusion.verdict;
  const p = projectFreeResult(flagged);
  assert.notEqual(p.verdict, 'GO');
  assert.equal(p.input_sanity[0].blocks_scoring, true, 'input_sanity.rent.blocks_scoring == true');
  assert.equal(p.verdict, flagged.score.verdict, 'cover and free page agree');
});
