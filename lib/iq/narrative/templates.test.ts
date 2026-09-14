/**
 * Template narratives in all three report languages: same numbers, same
 * citations, NumberGuard-clean, plain words only, and never a foreign script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALES } from '@/lib/i18n/locale';
import type { ReportModel } from '../model/schema';
import { numberGuard } from './number-guard';
import { hasCjk, localizedField, plainEn, plainEs, plainZh } from './plain';
import { PAGES, cuisineName, pageFragment, templateNarrative, verdictWord } from './templates';

const load = (): ReportModel => JSON.parse(readFileSync(join(process.cwd(), 'qa/fixtures/report_model_millbrae.json'), 'utf8')) as ReportModel;
const prose = (s: string) => s.replace(/\s*\[src:[^\]]*\]/g, '');
const JARGON = /\b(walk10|drive5|drive10|drive15|L1|L2|L3|L4|coverage_ratio|cluster_score|Huff|HHI|P25|P75|CapEx)\b|β|α|报告成本|置信度/;

test('en / es / zh templates pass NumberGuard on their own fragment and cite only fragment paths', () => {
  const m = load();
  for (const lang of LOCALES) {
    for (const p of PAGES) {
      const t = templateNarrative(m, p.id, lang);
      assert.ok(t.title.trim() && t.body.trim(), `${lang} ${p.id} empty`);
      const g = numberGuard(`${t.title} ${t.body}`, pageFragment(m, p.id), { isVoid: m.competitors.void.is_void, lang });
      assert.ok(g.ok, `${lang} ${p.id} fails guard: ${JSON.stringify(g)} :: ${t.title} ${t.body}`);
      for (const r of t.refs) assert.ok(p.fragment.some((k) => r === k || r.startsWith(k + '.') || k.startsWith(r + '.')), `${lang} ${p.id} ref ${r} outside fragment`);
      assert.ok(!JARGON.test(prose(`${t.title} ${t.body}`)), `${lang} ${p.id} leaks jargon: ${t.title} ${t.body}`);
    }
  }
});

test('English and Spanish templates carry no Chinese; Chinese templates carry no English sentences', () => {
  const m = load();
  for (const lang of ['en', 'es'] as const) {
    for (const p of PAGES) {
      const t = templateNarrative(m, p.id, lang);
      assert.ok(!hasCjk(prose(`${t.title} ${t.body}`)), `${lang} ${p.id} contains CJK: ${t.title} ${t.body}`);
    }
  }
  for (const p of PAGES) {
    const t = templateNarrative(m, p.id, 'zh');
    assert.ok(!/\b[A-Za-z]+(?: [a-z]+){4,}\b/.test(prose(`${t.title} ${t.body}`)), `zh ${p.id} contains an English sentence: ${t.body}`);
  }
});

test('the three editions cite the same numbers and refs; the default language is the model language', () => {
  const m = load();
  const nums = (s: string) => (prose(s).match(/\$?\d+(?:,\d{3})*(?:\.\d+)?%?/g) ?? []).sort();
  for (const p of PAGES) {
    const zh = templateNarrative(m, p.id, 'zh');
    const en = templateNarrative(m, p.id, 'en');
    const es = templateNarrative(m, p.id, 'es');
    assert.deepEqual(en.refs, zh.refs, `${p.id} refs differ (en)`);
    assert.deepEqual(es.refs, zh.refs, `${p.id} refs differ (es)`);
    // the deciding numbers of the closing pages are identical across languages
    if (p.id === 'page_15' || p.id === 'page_9' || p.id === 'page_2') {
      assert.deepEqual(nums(en.body), nums(zh.body), `${p.id} numbers differ en vs zh`);
      assert.deepEqual(nums(es.body), nums(zh.body), `${p.id} numbers differ es vs zh`);
    }
  }
  assert.equal(m.meta.language, 'zh');
  assert.deepEqual(templateNarrative(m, 'page_1'), templateNarrative(m, 'page_1', 'zh'));
  const enModel: ReportModel = { ...m, meta: { ...m.meta, language: 'en' } };
  assert.deepEqual(templateNarrative(enModel, 'page_1'), templateNarrative(m, 'page_1', 'en'));
  assert.equal(templateNarrative(m, 'page_1', 'en').title, `${m.input.cuisine_label_en}: ${verdictWord(m.score.verdict, 'en')}`);
  assert.equal(templateNarrative(m, 'page_1', 'es').title, `${cuisineName(m.input, 'es')}: ${verdictWord(m.score.verdict, 'es')}`);
  assert.ok(templateNarrative(m, 'page_15', 'en').body.includes('Must do before signing:'));
  assert.ok(templateNarrative(m, 'page_15', 'es').body.includes('Imprescindible antes de firmar:'));
  for (const c of m.score.conditions) {
    assert.ok(templateNarrative(m, 'page_15', 'en').body.includes(c.text_en));
    assert.ok(templateNarrative(m, 'page_15', 'es').body.includes(localizedField(c.text_zh, c.text_en, 'es')));
  }
});

test('plainEn / plainEs translate engine strings (drivers, triggers, inputs_missing) without touching digits', () => {
  const m = load();
  const engine = [
    ...m.score.dimensions.flatMap((d) => d.drivers),
    ...m.risks.flatMap((r) => [r.trigger, r.hedge]),
    ...m.audience.segments.map((s) => s.basis),
    ...m.finance.inputs_missing,
    m.finance.method,
    m.demand.cuisine_share_method,
    m.competitors.void.reason,
  ].filter((s) => s && s !== '—');
  for (const s of engine) {
    const en = plainEn(s);
    const es = plainEs(s);
    assert.ok(!hasCjk(en), `plainEn left CJK in "${s}" → "${en}"`);
    assert.ok(!hasCjk(es), `plainEs left CJK in "${s}" → "${es}"`);
    assert.ok(!JARGON.test(en), `plainEn leaks jargon: "${en}"`);
    assert.ok(!JARGON.test(plainZh(s)), `plainZh leaks jargon: "${plainZh(s)}"`);
    // identifiers (walk10, L1, D5) are spelled out, so compare the real numbers as sets
    const digits = (x: string) => new Set(x.replace(/\b(walk|drive|[LD])\d+\b/g, '').match(/\d+(?:[.,]\d+)*/g) ?? []);
    const src = digits(s);
    for (const d of src) assert.ok(digits(en).has(d), `number ${d} lost: "${s}" → "${en}"`);
  }
  assert.equal(plainEn('walk10 岗位 2273'), 'Jobs within a 10-minute walk: 2273');
  assert.equal(plainEs('capex(缺 → 回收期隐藏)'), 'inversión inicial (falta → recuperación oculta)');
  assert.equal(plainEn('停车 —（none）'), 'Parking — (not provided)');
  assert.equal(plainEn('sqft × mid 档位 $4.5/sf/月'), 'floor area × mid-tier $4.5/sf/mo');
  assert.equal(plainZh('walk10 内 L1+L2 13 家'), '步行 10 分钟范围 内 同菜系竞品 + 其他中餐 13 家');
  // Spanish falls back to the English field only when Chinese would remain
  assert.equal(localizedField('未知的引擎短语', 'Engine phrase', 'es'), 'Engine phrase');
  assert.equal(localizedField(m.risks[0].risk_zh, m.risks[0].risk_en, 'en'), m.risks[0].risk_en);
  assert.ok(!hasCjk(localizedField(m.risks[0].risk_zh, m.risks[0].risk_en, 'es')));
});
