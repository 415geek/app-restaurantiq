/**
 * Phase 6: each Millbrae defect R1–R8 has a failing case that the gates catch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runQaGates } from './gates';
import type { ReportModel } from '../model/schema';
import { PAGES, templateNarrative } from '../narrative/templates';

function loadModel(): ReportModel {
  const m = JSON.parse(readFileSync(join(process.cwd(), 'qa/fixtures/report_model_millbrae.json'), 'utf8')) as ReportModel;
  // fixture is data-only; give it template narratives (what the generator does without an LLM)
  for (const p of PAGES) m.narrative[p.id] = templateNarrative(m, p.id);
  return m;
}
const clone = (m: ReportModel): ReportModel => JSON.parse(JSON.stringify(m));

test('healthy model passes schema / reconciliation / number guard / wording', () => {
  const r = runQaGates(loadModel());
  const byId = Object.fromEntries(r.gates.map((g) => [g.id, g]));
  assert.equal(byId.schema.passed, true);
  assert.equal(byId.reconciliation.passed, true, byId.reconciliation.details.join('; '));
  assert.equal(byId.number_guard.passed, true, byId.number_guard.details.join('; '));
  assert.equal(byId.wording.passed, true, byId.wording.details.join('; '));
});

test('page count: the gates cover all 15 pages, including 总结与建议 (page_15)', () => {
  assert.equal(PAGES.length, 15);
  assert.equal(PAGES[14].id, 'page_15');
  assert.equal(PAGES[13].id, 'page_14');
  const m = loadModel();
  assert.equal(Object.keys(m.narrative).length, 15);
  assert.equal(runQaGates(m).passed, true);
  delete m.narrative.page_15;
  const r = runQaGates(m);
  assert.ok(r.failures.some((f) => f.includes('page_15 无叙事')), r.failures.join('\n'));
  // a page-15 summary that invents a number is caught like any other page
  const m2 = loadModel();
  m2.narrative.page_15 = { title: '不建议', body: '需求覆盖率 88% [src:demand.coverage_ratio]', refs: ['demand.coverage_ratio'] };
  assert.ok(runQaGates(m2).failures.some((f) => f.includes('page_15') && f.includes('88%')));
});

test('R1: zero competitors from a broken pipeline → integrity gate fails, precheck', () => {
  const m = loadModel();
  m.competitors.guard_passed = false;
  m.competitors.guard_notes = ['竞品抓取异常：metro 内该子菜系 POI 25 家，但 drive10 内 L1+L2 = 0'];
  const r = runQaGates(m);
  assert.equal(r.tier, 'precheck');
  assert.ok(r.failures.some((f) => f.includes('竞品抓取异常')));
  // and the "opportunity" wording is blocked
  m.narrative.page_6 = { title: '零竞争空白 · 机会', body: '本址为零竞争空白 [src:competitors.l1]', refs: [] };
  assert.ok(runQaGates(m).failures.some((f) => f.includes('禁用措辞')));
});

test('R2: ACS unresolved → D2 not ok → integrity fails', () => {
  const m = loadModel();
  const d2 = m.sources.find((s) => s.id === 'D2')!;
  d2.status = 'failed';
  d2.coverage_note = 'ACS 无法解析';
  assert.ok(runQaGates(m).failures.some((f) => f.includes('D2')));
});

test('R4: scenario table that contradicts seats × turns is caught', () => {
  const m = loadModel();
  m.finance.scenarios[1].orders_day = 246;
  m.finance.scenarios[1].dine_in_covers_day = 200; // 60 × 2 ≠ 200
  const r = runQaGates(m);
  assert.ok(r.failures.some((f) => f.includes('seats×turns')), r.failures.join('\n'));
});

test('R5: a second score that disagrees with Σ weight × score is caught', () => {
  const m = loadModel();
  m.score.total = m.score.total + 1.4;
  assert.ok(runQaGates(m).failures.some((f) => f.includes('总分')));
  const m2 = loadModel();
  m2.score.dimensions[0].weight = 30;
  assert.ok(runQaGates(m2).failures.some((f) => f.includes('权重和')));
});

test('R6: payback without CapEx is caught', () => {
  const m = loadModel();
  m.finance.payback_months = 24;
  assert.ok(runQaGates(m).failures.some((f) => f.includes('回收期')));
});

test('R8: a number that exists nowhere in the model (租金溢价 127%) is caught by NumberGuard', () => {
  const m = loadModel();
  m.narrative.page_10 = { title: '租金溢价 127%，偏高', body: '单一挂牌推出溢价 127% [src:finance.fixed_cost.rent]', refs: ['finance.fixed_cost.rent'] };
  const r = runQaGates(m);
  assert.ok(r.failures.some((f) => f.includes('127%')), r.failures.join('\n'));
});

test('sanity: chinese share out of range / rent psf out of band', () => {
  const m = loadModel();
  m.trade_area.rings[2].chinese_hh_share = 1.4;
  m.input.sqft = 100; // $12,000 / 100 sf = $120 psf
  const r = runQaGates(m);
  assert.ok(r.failures.some((f) => f.includes('越界')));
  assert.ok(r.failures.some((f) => f.includes('/sf/月')));
  assert.equal(clone(m).input.sqft, 100);
});

test('wording gate is locale-aware: English and Spanish banned phrases, "significant" on official statistics', () => {
  const en = loadModel();
  en.meta.language = 'en';
  en.meta.narrative_language = 'en';
  for (const p of PAGES) en.narrative[p.id] = templateNarrative(en, p.id, 'en');
  const ok = runQaGates(en);
  assert.equal(ok.passed, true, ok.failures.join('\n'));
  en.narrative.page_6 = { title: 'Zero competition: an opportunity', body: 'Approximately zero competition nearby [src:competitors.l1]', refs: [] };
  const r = runQaGates(en);
  assert.ok(r.failures.some((f) => f.includes('[wording]') && f.includes('approximately')), r.failures.join('\n'));
  assert.ok(r.failures.some((f) => f.includes('[wording]') && f.includes('zero competition')), r.failures.join('\n'));
  en.narrative.page_4 = { title: 'Significant population', body: 'The Census population is significantly higher [src:trade_area]', refs: [] };
  assert.ok(runQaGates(en).failures.some((f) => f.includes('page_4') && f.includes('显著')), 'significant + census caught');

  const es = loadModel();
  es.meta.language = 'es';
  es.meta.narrative_language = 'es';
  for (const p of PAGES) es.narrative[p.id] = templateNarrative(es, p.id, 'es');
  const okEs = runQaGates(es);
  assert.equal(okEs.passed, true, okEs.failures.join('\n'));
  es.narrative.page_6 = { title: 'Sin competencia', body: 'Aproximadamente sin competencia [src:competitors.l1]', refs: [] };
  const rEs = runQaGates(es);
  assert.ok(rEs.failures.some((f) => f.includes('aproximadamente')) && rEs.failures.some((f) => f.includes('sin competencia')), rEs.failures.join('\n'));
  // a Chinese-only banned word is not reported for a Spanish narrative
  es.narrative.page_6 = { title: 'Escasa oferta', body: '空白 en el mercado [src:competitors.l1]', refs: [] };
  assert.ok(!runQaGates(es).failures.some((f) => f.includes('空白')));
});
