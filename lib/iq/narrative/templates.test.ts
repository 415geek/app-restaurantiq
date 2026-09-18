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
import { PAGES, RISK_WORDING_RULE, allScenariosAboveSafetyLine, cuisineName, pageFragment, templateNarrative, verdictWord } from './templates';

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

/* §4.5 叙事与数字对齐 (P1-b) ---------------------------------------------- */

/** All three scenarios comfortably above the safety line, as in report a7217ad7. */
function comfortable(m: ReportModel): ReportModel {
  const x: ReportModel = JSON.parse(JSON.stringify(m));
  x.finance.breakeven_monthly = 51_800;
  x.finance.safety_monthly = 62_200;
  const revenue = [72_019, 86_000, 104_000];
  x.finance.scenarios = x.finance.scenarios.map((s, i) => ({ ...s, monthly_revenue: revenue[i] ?? 72_019, vs_breakeven: Math.round(((revenue[i] ?? 72_019) / 51_800) * 100) / 100 }));
  return x;
}

/** Wording the numbers forbid once every scenario clears the safety line. */
const FRAGILITY = {
  zh: /迅速侵蚀|随时会亏|稍有(闪失|不及)|不堪一击/,
  en: /erode[sd]? quickly|quickly erod|any shortfall in traffic (quickly )?eats|could lose money at any time|razor-thin/i,
  es: /se erosionar|se come la utilidad|puede perder dinero en cualquier momento/i,
} as const;

test('§4.5 P1-b: with all three scenarios above the safety line no template writes fragility wording (zh / en / es)', () => {
  const m = comfortable(load());
  assert.equal(allScenariosAboveSafetyLine(m), true);
  for (const lang of LOCALES) {
    for (const p of PAGES) {
      const t = templateNarrative(m, p.id, lang);
      const text = prose(`${t.title} ${t.body}`);
      assert.doesNotMatch(text, FRAGILITY[lang], `${lang} ${p.id}: ${text}`);
      // still NumberGuard-clean with the alignment sentence in place
      const g = numberGuard(`${t.title} ${t.body}`, pageFragment(m, p.id), { isVoid: m.competitors.void.is_void, lang });
      assert.ok(g.ok, `${lang} ${p.id} fails guard: ${JSON.stringify(g)} :: ${text}`);
    }
    // the risk page says so positively, and keeps the sensitivity trigger
    const risk = prose(templateNarrative(m, 'page_12', lang).body);
    assert.match(risk, lang === 'zh' ? /安全线之上/ : lang === 'es' ? /línea de seguridad/ : /above the safety line/, `${lang}: ${risk}`);
  }
});

test('§4.5 P1-b: a site whose scenarios fall below the safety line is NOT declared safe', () => {
  const m = load();
  const weak: ReportModel = JSON.parse(JSON.stringify(m));
  weak.finance.safety_monthly = 500_000;
  assert.equal(allScenariosAboveSafetyLine(weak), false);
  for (const lang of LOCALES) {
    const risk = prose(templateNarrative(weak, 'page_12', lang).body);
    assert.doesNotMatch(risk, lang === 'zh' ? /安全线之上/ : lang === 'es' ? /por encima de la línea de seguridad/ : /above the safety line/, `${lang}: ${risk}`);
  }
});

test('§4.5: the risk-wording rule exists in all three languages and names its trigger', () => {
  for (const lang of LOCALES) assert.ok(RISK_WORDING_RULE[lang].length > 80, lang);
  assert.match(RISK_WORDING_RULE.zh, /12\.5%/);
  assert.match(RISK_WORDING_RULE.en, /12\.5%/);
  assert.match(RISK_WORDING_RULE.es, /12\.5%/);
  assert.match(RISK_WORDING_RULE.zh, /score\.verdict/);
});

test('§4.3: page 5 prints the four dayparts of the concept, never a 午市 0% pair', () => {
  const m = load();
  const bakery: ReportModel = JSON.parse(JSON.stringify(m));
  bakery.demand.dayparts = [
    { id: 'breakfast', share: 0.35, monthly_usd: 24_500 },
    { id: 'lunch', share: 0.25, monthly_usd: 17_500 },
    { id: 'afternoon', share: 0.3, monthly_usd: 21_000 },
    { id: 'dinner', share: 0.1, monthly_usd: 7_000 },
  ];
  for (const lang of LOCALES) {
    const t = templateNarrative(bakery, 'page_5', lang);
    const text = prose(`${t.title} ${t.body}`);
    assert.match(text, /35%/, `${lang}: ${text}`);
    assert.match(text, /25%/, `${lang}: ${text}`);
    assert.match(text, /30%/, `${lang}: ${text}`);
    assert.match(text, /10%/, `${lang}: ${text}`);
    const g = numberGuard(`${t.title} ${t.body}`, pageFragment(bakery, 'page_5'), { isVoid: bakery.competitors.void.is_void, lang });
    assert.ok(g.ok, `${lang} page_5 guard: ${JSON.stringify(g)} :: ${text}`);
  }
});

test('§4.6 risk amounts and their missing-amount reasons are translated, not left in English', () => {
  // The Spanish edition printed "Neither the construction schedule nor the
  // hoarding footprint is available…" mid-paragraph on page 13, because the
  // §4.6 strings were added in zh/en only and localizedField falls back to
  // English when the phrase table leaves Chinese behind.
  const zhStrings = [
    '既没有月租，也没有捕获月需求，算不出可承受的租金上限',
    '缺少月租或参照营收，算不出超出警戒线的金额',
    '缺少月固定成本，算不出空置一个月的金额',
    '缺少基准情景月营收，算不出冷启动缺口',
    '缺少客单价敏感度测算，算不出价格战的金额',
    '缺少翻台敏感度测算，算不出评分不达标的金额',
    '缺少保本线或捕获月需求，算不出缺口金额',
    '未提供装修与设备投入，回收期和投入金额都算不出来',
    '施工的工期与围挡范围未获取，客流影响的幅度算不出来',
    '等时圈未获取，没有第二套边界可以对比，高估了多少无法算出',
    '捕获月需求 $12,000 × 10% = 可承受月租上限 $1,200；这笔月度占用成本目前完全未知',
    '月租 $17,000 − 参照营收 $120,000 × 10% = 每月多付 $5,000',
    '客单价 −12.5%：基准月营收 $100,000 → 每月少收 $12,500',
    '关店率 20% × 月固定成本 $80,000 = $16,000：空置一个月就要照付的固定成本敞口',
    '保本线 $140,000 − 捕获月需求 $60,000 = 每月差 $80,000',
  ];
  for (const zh of zhStrings) {
    const es = plainEs(zh);
    assert.ok(!/[一-鿿]/.test(es), `left in Chinese: ${zh} → ${es}`);
    assert.ok(es.length > 0);
  }
  // The numbers inside a formula are copied through untouched.
  assert.match(plainEs('保本线 $140,000 − 捕获月需求 $60,000 = 每月差 $80,000'), /\$140,000.*\$60,000.*\$80,000/);
});
