/**
 * Render-level contract for a report whose customer did not enter a monthly
 * rent: no rent figure may appear anywhere, every break-even / coverage label
 * says it excludes rent, and the rent ceiling replaces the guess — in all
 * three report languages. The with-rent fixture keeps rendering as before.
 *
 * (`.test.ts` rather than `.test.tsx` because the test:iq glob is *.test.ts;
 * the document is built with createElement.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LOCALES, type Locale } from '@/lib/i18n/locale';
import { parseReportModel, type ReportModel } from '../model/schema';
import { rederiveWithoutRent } from '../pipeline';
import { strings } from './i18n';
import { ReportDocument } from './pages';

const FIXTURE = join(process.cwd(), 'qa', 'fixtures', 'report_model_millbrae.json');
const loadModel = (): ReportModel => parseReportModel(JSON.parse(readFileSync(FIXTURE, 'utf8')));

/** Decode the handful of entities react-dom/server emits so assertions can match plain text. */
const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const render = (model: ReportModel, lang: Locale) => decode(renderToStaticMarkup(createElement(ReportDocument, { model, lang })));
const pageOf = (html: string, n: number) => {
  const m = new RegExp(`<section class="page page-${n}"[\\s\\S]*?</section>`).exec(html);
  assert.ok(m, `page ${n} rendered`);
  return m[0];
};

const EX_RENT: Record<Locale, string> = { zh: '（不含租金）', en: '(excluding rent)', es: '(sin renta)' };
/** The page-10 rent row as rendered when the customer gave a rent: `<th>Rent<span class="muted"> · your input</span>`. */
const rentRowYourInput = (lang: Locale) => `${strings(lang).p10.rent}<span class="muted"> · ${strings(lang).p10.yourInput}</span>`;

test('rent not provided: no $17,000 anywhere, ex-rent labels on pages 10 and 15, rent ceiling shown', () => {
  const model = rederiveWithoutRent(loadModel());
  assert.equal(model.input.rent_usd, null);
  const ceiling = `$${model.finance.max_rent_for_10pct_usd!.toLocaleString('en-US')}`;
  for (const lang of LOCALES) {
    const html = render(model, lang);
    const S = strings(lang);
    assert.ok(!html.includes('$17,000') && !html.includes('17,000') && !html.includes('17000'), `${lang}: the customer's old rent leaks`);
    assert.ok(!html.includes('rent_per_1000') && !html.includes('not_provided'), `${lang}: engine ids leak`);
    const p10 = pageOf(html, 10);
    assert.ok(p10.includes(EX_RENT[lang]), `${lang}: page 10 lacks "${EX_RENT[lang]}"`);
    assert.ok(p10.includes(S.p10.rentNotProvided), `${lang}: page 10 rent row does not say "not provided"`);
    assert.ok(p10.includes(S.p10.maxRent) && p10.includes(ceiling), `${lang}: page 10 lacks the rent ceiling ${ceiling}`);
    assert.ok(!p10.includes(rentRowYourInput(lang)), `${lang}: page 10 must not label rent as your input`);
    const p15 = pageOf(html, 15);
    assert.ok(p15.includes(EX_RENT[lang]), `${lang}: page 15 lacks "${EX_RENT[lang]}"`);
    assert.ok(p15.includes(S.p15.maxRent) && p15.includes(ceiling), `${lang}: page 15 lacks the rent ceiling`);
    assert.ok(!p15.includes(S.p15.occupancy + '<'), `${lang}: page 15 still shows the occupancy key number`);
    assert.ok(p15.includes(S.p15.step2NoRent.split('{')[0].trim()), `${lang}: page 15 next step does not ask for the rent`);
    for (const n of [2, 9]) assert.ok(pageOf(html, n).includes(EX_RENT[lang]), `${lang}: page ${n} lacks "${EX_RENT[lang]}"`);
    // the no-rent verdict is never GO and the conditions lead with the rent condition
    assert.ok(!pageOf(html, 1).includes('data-verdict="GO"'), `${lang}: GO verdict without a rent`);
    assert.ok(pageOf(html, 13).includes(ceiling), `${lang}: page 13 checklist lacks the rent ceiling`);
  }
});

test('rent provided: the fixture renders without any ex-rent wording or rent ceiling (no regression)', () => {
  const model = loadModel();
  for (const lang of LOCALES) {
    const html = render(model, lang);
    const S = strings(lang);
    assert.ok(html.includes('$17,000'), `${lang}: the given rent is shown`);
    assert.ok(!html.includes(EX_RENT[lang]), `${lang}: ex-rent label shown although rent was given`);
    assert.ok(!html.includes(S.p10.maxRent) && !html.includes(S.p10.rentNotProvided), `${lang}: no-rent widgets shown although rent was given`);
    assert.ok(pageOf(html, 10).includes(rentRowYourInput(lang)));
  }
});

/** §4.2 page-7 brand anchors: city-wide table + in-trade-area tag on the overlapping L1 card. */
test('page 7: brand anchors render as a city-wide table and tag overlapping L1 cards', () => {
  const base = loadModel();
  const l1 = base.competitors.l1[0]!;
  const model: ReportModel = {
    ...base,
    competitors: {
      ...base.competitors,
      brand_anchors: [
        {
          id: 'anchor-city',
          name: 'Citywide Brand Anchor',
          name_zh: '全城品牌锚点',
          lat: l1.lat + 0.05,
          lng: l1.lng + 0.05,
          distance_mi: 3.6,
          rating: 4.7,
          rating_count: 3200,
          price_level: 2,
          primary_type: 'chinese_restaurant',
          in_trade_area: false,
        },
        {
          id: l1.id,
          name: l1.name,
          name_zh: l1.name_zh,
          lat: l1.lat,
          lng: l1.lng,
          distance_mi: l1.distance_mi,
          rating: l1.rating,
          rating_count: l1.rating_count,
          price_level: l1.price_level,
          primary_type: 'chinese_restaurant',
          in_trade_area: true,
        },
      ],
    },
  };
  for (const lang of LOCALES) {
    const html = render(model, lang);
    const S = strings(lang);
    const p7 = pageOf(html, 7);
    assert.ok(p7.includes(S.p7.anchors), `${lang}: page 7 missing brand-anchors heading`);
    assert.ok(p7.includes(S.p7.anchorsNote), `${lang}: page 7 missing brand-anchors note`);
    assert.ok(p7.includes('Citywide Brand Anchor'), `${lang}: city-wide anchor name missing`);
    assert.ok(p7.includes(l1.name), `${lang}: in-trade-area anchor name missing`);
    assert.ok(p7.includes(S.p7.anchorTag), `${lang}: overlapping L1 card missing brand-anchor tag`);
    assert.ok(p7.includes(S.p7.yes) && p7.includes(S.p7.no), `${lang}: in_trade_area yes/no cells missing`);
  }
});

/* 评审 Spec §4.6 PDF 交付质量 (P1-c / P1-d) ------------------------------- */

test('P1-c: the risk register table carries only quantified risks; the rest are checklist prose', () => {
  const model = loadModel();
  const priced = model.risks.filter((r) => r.impact_usd != null);
  const unpriced = model.risks.filter((r) => r.impact_usd == null);
  assert.ok(priced.length > 0 && unpriced.length > 0, 'the fixture exercises both kinds of risk');
  for (const lang of LOCALES) {
    const html = render(model, lang);
    const S = strings(lang);
    const p12 = pageOf(html, 12);
    const p13 = pageOf(html, 13);
    const rows = p12.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
    const bodyRows = rows.filter((r) => /class="dot"/.test(r));
    assert.equal(bodyRows.length, priced.length, `${lang}: the register table has one row per quantified risk`);
    for (const r of bodyRows) assert.ok(!r.includes(`>${S.na}<`), `${lang}: a register row prints the 'not available' placeholder: ${r.slice(0, 120)}`);
    // the total is a real number, never $0, and each amount travels with its formula
    const total = priced.reduce((a, r) => a + (r.impact_usd ?? 0), 0);
    assert.ok(total > 0);
    assert.ok(p12.includes(`$${total.toLocaleString('en-US')}`), `${lang}: page 12 does not print the quantified total`);
    assert.equal((p12.match(/class="cell-formula"/g) ?? []).length, priced.length, `${lang}: every amount needs its formula`);
    // the unquantified ones are named on page 12 and written out on page 13
    assert.ok(p12.includes(longestLiteral(S.p12.unquantifiedNote)), `${lang}: page 12 lacks the "risks without an amount" line`);
    assert.ok(p13.includes(S.p13.riskNoAmount), `${lang}: page 13 does not carry the unquantified risks`);
    assert.equal((p13.match(/class="risk-item"/g) ?? []).length, unpriced.length, `${lang}: page 13 must list every unquantified risk`);
  }
});

test('P1-c: with every risk quantified, page 12 shows no "risks without an amount" line', () => {
  const base = loadModel();
  const model: ReportModel = {
    ...base,
    risks: base.risks.map((r) => (r.impact_usd == null ? { ...r, impact_usd: 1234, impact_formula_zh: '测试 $1,234', impact_formula_en: 'test $1,234', unquantified_zh: null, unquantified_en: null } : r)),
  };
  for (const lang of LOCALES) {
    const S = strings(lang);
    const html = render(model, lang);
    assert.ok(!pageOf(html, 12).includes(longestLiteral(S.p12.unquantifiedNote)), `${lang}: the "N without an amount" line must only appear when such rows exist`);
    assert.ok(!pageOf(html, 13).includes('class="risk-item"'), `${lang}: nothing to fold into the checklist`);
  }
});

test('P1-d: a review-count distribution that is more than half missing collapses instead of printing 「未获取」', () => {
  const base = loadModel();
  // the P1-d bug itself: every Layer-1 store without a review count
  const model: ReportModel = {
    ...base,
    competitors: { ...base.competitors, l1: base.competitors.l1.map((x) => ({ ...x, rating_count: null, rating: null })) },
  };
  for (const lang of LOCALES) {
    const html = render(model, lang);
    const S = strings(lang);
    const p7 = pageOf(html, 7);
    assert.ok(!p7.includes(P7_TITLE[lang]), `${lang}: the distribution heading must be gone, not printed over empty bars`);
    assert.ok(p7.includes(S.sparse), `${lang}: the collapsed block must say why`);
    // and the page still carries content: the nearby-Chinese fallback benchmark
    assert.ok(p7.includes(S.p7.otherChinese), `${lang}: page 7 must fall back to the nearby-Chinese benchmark`);
  }
});

/** The longest literal run of a `{placeholder}` template — what to look for in the rendered page. */
function longestLiteral(template: string): string {
  return template
    .split(/\{\w+\}/)
    .map((s) => s.trim())
    .sort((a, b) => b.length - a.length)[0];
}

/** Heading of the Layer-1 review-count block (pages.tsx → P7_REVIEW_DIST). */
const P7_TITLE: Record<Locale, string> = {
  zh: '同类竞品评论量分布',
  en: 'Layer-1 review-count distribution',
  es: 'Distribución de reseñas de competidores directos',
};
