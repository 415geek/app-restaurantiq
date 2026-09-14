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
