/**
 * 评审 Spec §4.6 PDF 交付质量 (P1-c): the paid risk register must carry money.
 *
 * Contract asserted here:
 *   - every emitted risk carries EITHER a monthly `impact_usd` with the formula
 *     that produced it, OR a documented reason why no amount exists — never
 *     neither, never both;
 *   - the amounts are the model's own arithmetic (rent delta, break-even gap,
 *     ticket / turns sensitivity, closure months × fixed cost), so the numbers
 *     in the formula can be found in the model (the NumberGuard rule);
 *   - the register table, which shows only the quantified rows, never totals $0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReportModel, type ReportModel } from '../model/schema';
import { computeRisks } from './risk';

const FIXTURE = join(process.cwd(), 'qa', 'fixtures', 'report_model_millbrae.json');
const load = (): ReportModel => parseReportModel(JSON.parse(readFileSync(FIXTURE, 'utf8')));
const clone = (m: ReportModel): ReportModel => JSON.parse(JSON.stringify(m)) as ReportModel;

/** Amounts as the formula prints them: "$13,928" → 13928. */
const amountsIn = (s: string) => (s.match(/\$[\d,]+/g) ?? []).map((x) => Number(x.replace(/[$,]/g, '')));

test('every emitted risk carries either an amount with its formula, or a documented reason', () => {
  const m = load();
  for (const variant of [m, noRent(m), thinCluster(m), saturated(m)]) {
    const risks = computeRisks({ ...variant, dev_projects: 2 });
    assert.ok(risks.length > 0, 'the fixture produces risks');
    for (const r of risks) {
      const priced = r.impact_usd != null;
      if (priced) {
        assert.ok(r.impact_formula_zh && r.impact_formula_en, `risk ${r.id} has an amount but no formula: ${r.risk_en}`);
        assert.equal(r.unquantified_zh, null, `risk ${r.id} is both priced and unquantified`);
        assert.equal(r.unquantified_en, null, `risk ${r.id} is both priced and unquantified`);
        assert.ok(Number.isFinite(r.impact_usd) && r.impact_usd !== 0, `risk ${r.id} has a zero / non-finite amount`);
        // the amount itself is printed in its own formula, so the reader can follow the arithmetic
        assert.ok(
          amountsIn(r.impact_formula_zh!).some((v) => Math.abs(v - r.impact_usd!) <= 1),
          `risk ${r.id} formula does not restate its amount: ${r.impact_formula_zh}`,
        );
        assert.ok(
          amountsIn(r.impact_formula_en!).some((v) => Math.abs(v - r.impact_usd!) <= 1),
          `risk ${r.id} English formula does not restate its amount: ${r.impact_formula_en}`,
        );
      } else {
        assert.ok(r.unquantified_zh && r.unquantified_en, `risk ${r.id} has no amount and no documented reason: ${r.risk_en}`);
        assert.equal(r.impact_formula_zh, null);
        assert.equal(r.impact_formula_en, null);
      }
    }
  }
});

test('the register table (quantified rows only) never totals $0', () => {
  const m = load();
  for (const variant of [m, noRent(m), thinCluster(m), saturated(m)]) {
    const risks = computeRisks({ ...variant, dev_projects: 2 });
    const priced = risks.filter((r) => r.impact_usd != null);
    assert.ok(priced.length > 0, 'at least one risk carries an amount');
    assert.ok(
      priced.reduce((a, r) => a + (r.impact_usd ?? 0), 0) > 0,
      'the quantified impact total is a real number, not $0',
    );
  }
});

test('the fixture’s amounts are the model’s own arithmetic', () => {
  const m = load();
  const risks = computeRisks({ ...m, dev_projects: 6 });
  const byText = (needle: string) => risks.find((r) => r.risk_en.includes(needle))!;

  // rent delta: rent − captured demand × 10 %
  const rent = byText('of captured revenue');
  assert.equal(rent.impact_usd, Math.round(m.finance.fixed_cost.rent! - m.demand.captured_monthly_usd! * 0.1));

  // break-even gap: break-even − captured demand
  const coverage = byText('of break-even');
  assert.equal(coverage.impact_usd, Math.round(m.finance.breakeven_monthly! - m.demand.captured_monthly_usd!));

  // ticket sensitivity: the engine's own −12.5 % run
  const ticket = byText('ticket drop');
  assert.equal(ticket.impact_usd, Math.abs(m.finance.sensitivity.find((s) => s.id === 'ticket_minus_125')!.monthly_revenue_delta));

  // the construction and CapEx rows genuinely cannot be sized — they carry reasons, not zeros
  for (const needle of ['under construction', 'CapEx not provided']) {
    const r = byText(needle);
    assert.equal(r.impact_usd, null);
    assert.ok(r.unquantified_en!.length > 20);
  }
});

test('closure risk is priced as vacancy months × monthly fixed cost', () => {
  const m = clone(load());
  m.competitors.closure_rate = 0.25;
  const r = computeRisks({ ...m, dev_projects: 0 }).find((x) => x.risk_en.includes('have closed'))!;
  assert.equal(r.impact_usd, Math.round(0.25 * m.finance.fixed_cost.total!));
  assert.match(r.impact_formula_en!, /fixed cost/);
});

test('cold start and the quality bar are priced from the scenarios and the turns run', () => {
  const m = thinCluster(load());
  const risks = computeRisks({ ...m, dev_projects: 0 });
  const cold = risks.find((r) => r.risk_en.includes('cold start'))!;
  const base = m.finance.scenarios.find((s) => s.id === 'base')!;
  assert.equal(cold.impact_usd, Math.round(base.monthly_revenue * 0.6));

  const bar = risks.find((r) => r.risk_en.includes('quality bar'))!;
  assert.equal(bar.impact_usd, Math.abs(m.finance.sensitivity.find((s) => s.id === 'turns_minus_05')!.monthly_revenue_delta));
});

test('an amount is only claimed when its inputs exist', () => {
  const m = clone(load());
  m.finance.sensitivity = [];
  m.finance.fixed_cost.total = null;
  m.competitors.closure_rate = 0.3;
  m.competitors.walk10_l1_l2_count = 20;
  const risks = computeRisks({ ...m, dev_projects: 0 });
  for (const needle of ['have closed', 'saturated']) {
    const r = risks.find((x) => x.risk_en.includes(needle))!;
    assert.equal(r.impact_usd, null, `${needle} must not invent an amount without its inputs`);
    assert.ok(r.unquantified_en, `${needle} must document why`);
  }
});

test('no rent given: the row is priced at the affordable-rent ceiling, and never at the old rent', () => {
  const m = noRent(load());
  const r = computeRisks({ ...m, dev_projects: 0 }).find((x) => x.risk_zh.startsWith('未提供月租'))!;
  assert.equal(r.impact_usd, Math.round(m.finance.max_rent_for_10pct_usd!));
  assert.ok(!r.impact_formula_en!.includes('17,000'), 'the customer’s old rent must not leak into the formula');
});

/* ---------------- fixture variants ---------------- */

function noRent(base: ReportModel): ReportModel {
  const m = clone(base);
  m.finance.rent_excluded = true;
  m.finance.fixed_cost.rent = null;
  m.finance.occupancy_cost_ratio = null;
  m.finance.max_rent_for_10pct_usd = Math.round(m.demand.captured_monthly_usd! * 0.1);
  m.input.rent_usd = null;
  return m;
}

/** No other Chinese restaurant within a 10-minute walk, and a high closure rate: the cold-start shape. */
function thinCluster(base: ReportModel): ReportModel {
  const m = clone(base);
  m.competitors.walk10_l1_l2_count = 0;
  m.competitors.closure_rate = 0.3;
  m.competitors.avg_rating_l1 = 4.6;
  return m;
}

/** A saturated cluster: the price-war shape. */
function saturated(base: ReportModel): ReportModel {
  const m = clone(base);
  m.competitors.walk10_l1_l2_count = 20;
  return m;
}
