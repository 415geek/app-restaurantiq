import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, type Locale } from '@/lib/i18n/locale';
import { getIqPaywallLockedItems } from './iq-paywall-sections';
import {
  decisionTierDisplay,
  layerLabel,
  productPositioningLine,
  radarLabel,
  scoreLayerFootnote,
} from './iq-risk-audit-model';
import {
  applyCompetitorWhitelist,
  applyFinanceModelOverride,
  confidenceLabel,
  isHighConfidenceText,
  isMediumConfidenceText,
  localizeFinanceText,
  normalizeConfidenceLevel,
} from './iq-full-report-schema';
import {
  LANGUAGE_INSTRUCTION,
  defaultBusinessTypeLabel,
  locationIqV2FreeSystem,
  locationIqV2FreeUser,
  locationIqV2PremiumSystem,
  narrativeNumberAlignmentBlock,
  locationIqV2PremiumUser,
  outputLanguageBlock,
} from './iq-prompts-locationiq-v2';
import { buildCompetitorWhitelistPromptBlock, extractCompetitorWhitelist } from './iq-market-signals';
import { computeFinanceModel, financeArchetypeLabel, formatFinanceModelForAnchors } from './iq-finance-model';
import { computeSiteMetrics, formatMetricsDigest } from './agents/metrics';
import { buildDecisionMatrix, tierFromComposite } from './agents/orchestrator';
import { SPECIALISTS } from './agents/specialists';
import { buildSiteHistoryBlock, siteHistorySummary, type SiteHistoryPack } from './external-data/site-history';
import { formatCaltransForAnchors } from './external-data/caltrans';
import { formatListingsForAnchors } from './external-data/commercial-listings';
import { formatBrightDataForAnchors } from './external-data/brightdata';
import { summarizeDeepResearchForAnchors, type DeepResearchPack } from './iq-web-research';
import { buildFreeTierMarketBrief, buildPremiumMarketDataSection } from './iq-premium-anchors';

const CJK = /[一-鿿]/;
const SPANISH_MARKERS = /\b(de|la|el|los|las|con|para|del)\b/;

function assertSpanish(s: string, label: string) {
  assert.ok(s.length > 0, `${label}: empty`);
  assert.ok(!CJK.test(s), `${label}: contains Chinese characters`);
  assert.ok(SPANISH_MARKERS.test(s), `${label}: does not read as Spanish: ${s.slice(0, 80)}`);
}

test('paywall locked items: every locale gets its own six lines, Spanish is not English or Chinese', () => {
  for (const lang of LOCALES) {
    assert.equal(getIqPaywallLockedItems(lang).length, 6, lang);
  }
  const en = getIqPaywallLockedItems('en');
  const es = getIqPaywallLockedItems('es');
  assert.notDeepEqual(es, en);
  es.forEach((line, i) => assertSpanish(line, `paywall es[${i}]`));
  assert.ok(en.every((l) => !CJK.test(l)));
});

test('risk-audit labels resolve in all three languages', () => {
  const tierEs = decisionTierDisplay('go_with_conditions', 'es');
  assert.ok(tierEs);
  assertSpanish(tierEs.label + ' ' + tierEs.desc, 'decision tier es');
  assert.equal(decisionTierDisplay('no_go', 'en')?.label, 'No Go');
  assert.equal(decisionTierDisplay('no_go', 'zh')?.label, '不建议');
  assert.equal(decisionTierDisplay(undefined, 'es'), null);

  assert.equal(layerLabel('cost_pressure', 'es'), 'Presión de costos');
  assert.equal(layerLabel('cost_pressure', 'en'), 'Cost pressure');
  assert.equal(layerLabel('unknown_layer', 'es'), 'unknown_layer');
  assert.equal(radarLabel('delivery_potential', 'es'), 'Potencial de entrega a domicilio');
  assert.equal(radarLabel('some_new_key', 'es'), 'some new key');

  assertSpanish(scoreLayerFootnote('es'), 'footnote es');
  assertSpanish(productPositioningLine('es'), 'positioning es');
  assert.ok(!CJK.test(scoreLayerFootnote('en')));
});

test('confidence normalizer understands English, Chinese and Spanish levels', () => {
  assert.equal(normalizeConfidenceLevel('High'), 'High');
  assert.equal(normalizeConfidenceLevel('高'), 'High');
  assert.equal(normalizeConfidenceLevel('Alta'), 'High');
  assert.equal(normalizeConfidenceLevel('media'), 'Medium');
  assert.equal(normalizeConfidenceLevel('Baja'), 'Low');
  assert.equal(normalizeConfidenceLevel('whatever'), undefined);
  assert.equal(isHighConfidenceText('Alta'), true);
  assert.equal(isMediumConfidenceText('Media'), true);
  assert.equal(isMediumConfidenceText('Alta'), false);
  assert.equal(confidenceLabel('Low', 'es'), 'Baja');
  assert.equal(confidenceLabel('Low', 'zh'), '低');
  assert.equal(confidenceLabel('Low', 'en'), 'Low');
});

test('grounding + finance warnings are emitted in the report language', () => {
  const whitelist = extractCompetitorWhitelist({
    summary: { sample_competitors_google: [{ name: 'Boba Guys' }] },
  });
  const report = { competitors: [{ name: 'Boba Guys', threat_level: 'Alta' }, { name: 'Invented Cafe', threat_level: 'Baja' }] };
  const es = applyCompetitorWhitelist(report, whitelist, 'es');
  assert.equal(es.competitors && (es.competitors as unknown[]).length, 1);
  assert.deepEqual(es._dropped_competitor_names, ['Invented Cafe']);
  assert.ok(es._warnings && es._warnings.length >= 1);
  es._warnings!.forEach((w, i) => assertSpanish(w, `whitelist warning es[${i}]`));
  const en = applyCompetitorWhitelist(report, whitelist);
  assert.ok(en._warnings![0].startsWith('Dropped 1 unverified competitor name'));

  const fm = computeFinanceModel({ marketData: {}, businessType: 'taqueria', location: 'x' });
  const withFinanceEs = applyFinanceModelOverride({}, fm, 'es');
  assert.equal(withFinanceEs._finance_model_applied, true);
  assertSpanish(withFinanceEs._warnings![0], 'finance note es');
  assert.ok(withFinanceEs._warnings![0].includes('solo valores predeterminados'), 'confidence reasons localized');
  const rowsEs = (withFinanceEs.risk_audit as { cost_breakdown: Array<{ item: string }> }).cost_breakdown;
  assert.equal(rowsEs[0].item, 'Renta (NNN)');
  assert.equal(rowsEs[rowsEs.length - 1].item, 'Total fijo / mes');
  const withFinanceZh = applyFinanceModelOverride({}, fm, 'zh');
  assert.ok(CJK.test(withFinanceZh._warnings![0]));
  assert.equal((withFinanceZh.risk_audit as { cost_breakdown: Array<{ item: string }> }).cost_breakdown[0].item, '租金（NNN）');
  assert.equal((applyFinanceModelOverride({}, fm).risk_audit as { cost_breakdown: Array<{ item: string }> }).cost_breakdown[0].item, 'Rent (NNN)');
  assert.equal(localizeFinanceText('unknown label', 'es'), 'unknown label');
});

test('prompt library: exact language instruction per locale, Spanish free + premium prompts', () => {
  assert.equal(LANGUAGE_INSTRUCTION.en, 'Write in standard U.S. English.');
  assert.equal(
    LANGUAGE_INSTRUCTION.es,
    'Escribe en español neutro (Estados Unidos / Latinoamérica), claro y profesional.',
  );
  assert.ok(CJK.test(LANGUAGE_INSTRUCTION.zh));

  for (const lang of LOCALES) {
    for (const sys of [locationIqV2FreeSystem(lang), locationIqV2PremiumSystem(lang)]) {
      assert.ok(sys.includes(LANGUAGE_INSTRUCTION[lang]), `${lang} system prompt carries its language instruction`);
      assert.ok(sys.includes(outputLanguageBlock(lang).trim()), `${lang} system prompt carries the output-language block`);
    }
  }

  const freeEs = locationIqV2FreeUser('es', { location: '1 Main St', businessType: '' });
  assertSpanish(freeEs, 'free user es');
  assert.ok(freeEs.includes('"verdict": "go|caution|no"'), 'JSON keys stay English');
  const premiumEs = locationIqV2PremiumUser('es', {
    location: '1 Main St',
    businessType: 'Taquería',
    headline: 'h',
    reason: 'r',
    marketDataSection: '',
  });
  assertSpanish(premiumEs, 'premium user es');
  for (const needle of ['"threat_level": "Alta"', '"probability": "Media"', '"name": "Conservador"', '"confidence": "Media"', 'Alta, Media o Baja']) {
    assert.ok(premiumEs.includes(needle), `premium es contains ${needle}`);
  }
  assert.ok(!CJK.test(locationIqV2PremiumSystem('en')));
  assert.ok(!CJK.test(locationIqV2PremiumSystem('es')));
  assert.equal(defaultBusinessTypeLabel('es'), 'Restaurante');
  assert.equal(defaultBusinessTypeLabel('en'), 'Restaurant');
});

test('competitor whitelist prompt block localizes for es (empty and populated)', () => {
  const empty = extractCompetitorWhitelist(null);
  assertSpanish(buildCompetitorWhitelistPromptBlock(empty, 'es'), 'empty whitelist es');
  const wl = extractCompetitorWhitelist({ summary: { sample_competitors_google: [{ name: 'Boba Guys' }, { name: 'Tea Hut' }] } });
  const block = buildCompetitorWhitelistPromptBlock(wl, 'es');
  assertSpanish(block, 'whitelist es');
  assert.ok(block.includes('Boba Guys') && block.includes('LISTA BLANCA'));
  assert.ok(buildCompetitorWhitelistPromptBlock(wl, 'en').includes('[COMPETITOR WHITELIST — HARD CONSTRAINT]'));
});

test('finance model carries Spanish labels and a Spanish anchor block', () => {
  const fm = computeFinanceModel({ marketData: {}, businessType: 'bubble tea', location: 'x' });
  assert.equal(fm.cuisine_archetype_label_es, 'Tienda de té de burbujas / boba');
  assert.equal(financeArchetypeLabel(fm, 'es'), fm.cuisine_archetype_label_es);
  assert.equal(financeArchetypeLabel({ ...fm, cuisine_archetype_label_es: undefined }, 'es'), fm.cuisine_archetype_label_en);
  assert.ok(fm.occupancy_nra_benchmark_note_es && !CJK.test(fm.occupancy_nra_benchmark_note_es));
  const block = formatFinanceModelForAnchors(fm, 'es');
  assertSpanish(block, 'finance anchors es');
  assert.ok(block.includes(String(fm.break_even_revenue_monthly_usd)));
  assert.ok(formatFinanceModelForAnchors(fm, 'en').includes('[DETERMINISTIC BREAK-EVEN MODEL'));
});

test('multi-agent engine copy: metrics digest, decision matrix, tier labels, specialist prompts in es', () => {
  const metrics = computeSiteMetrics({ marketData: {}, businessType: 'boba' });
  assert.equal(metrics.cuisine.notes_es.length > 0, true);
  const digest = formatMetricsDigest(metrics, 'es');
  assert.ok(digest.startsWith('[MÉTRICAS CALCULADAS'));
  assert.ok(formatMetricsDigest(metrics, 'en').startsWith('[COMPUTED METRICS'));

  const { rows, gaps } = buildDecisionMatrix(new Map(), 'es');
  assert.equal(rows.length, 5);
  assert.equal(rows[0].dimension, 'Potencial de tráfico peatonal');
  assert.equal(gaps.length, 5);
  gaps.forEach((g, i) => {
    assert.ok(g.includes('especialista no disponible'), `matrix gap es[${i}]: ${g}`);
    assert.ok(!CJK.test(g));
  });
  assert.ok(buildDecisionMatrix(new Map(), 'en').gaps[0].includes('specialist unavailable'));
  assert.equal(tierFromComposite(85, 'es'), '🟢 Muy recomendable');
  assert.equal(tierFromComposite(85, 'en'), '🟢 Strong recommend');

  for (const def of SPECIALISTS) {
    const sys = def.system('es');
    assert.ok(sys.includes(LANGUAGE_INSTRUCTION.es), `${def.discipline} system es`);
    assert.ok(!CJK.test(sys), `${def.discipline} system es has no Chinese`);
    const user = def.user({ location: '1 Main St', businessType: 'taquería', language: 'es', metrics, marketData: {} });
    assert.ok(user.startsWith('Dirección: 1 Main St'), `${def.discipline} user es`);
  }
});

test('external-data anchor blocks localize for es', () => {
  const pack: SiteHistoryPack = {
    address: '1 Main St',
    match_radius_m: 45,
    api_status: { google: 'ok', yelp: 'ok' },
    businesses: [
      {
        source: 'google',
        id: 'g1',
        name: 'Old Noodle House',
        status: 'closed_permanently',
        is_food: true,
        rating: 3.9,
        review_count: 120,
        price_level: 2,
        categories: ['restaurant'],
        address: '1 Main St',
        distance_m: 3,
        url: null,
        reviews: [{ source: 'google', rating: 2, text: 'Parking was impossible', time: '2023-01', author: 'a' }],
      },
    ],
    closed_count: 1,
    total_reviews_sampled: 1,
    fetched_at: '2024-01-01T00:00:00Z',
    analysis: {
      prior_business_name: 'Old Noodle House',
      status_summary: 'closed',
      positive_themes: [],
      negative_themes: ['parking'],
      closure_signals: ['closed 2023'],
      lessons_for_new_operator: ['validate parking'],
      risk_flag: 'high',
      summary_zh: '中文摘要',
      summary_en: 'English summary',
      summary_es: 'Resumen en español',
    },
  } as unknown as SiteHistoryPack;
  const es = buildSiteHistoryBlock(pack, 'es');
  assert.ok(es.includes('cerrado permanentemente') && es.includes('Resumen en español'));
  assert.ok(!CJK.test(es));
  assert.equal(siteHistorySummary({ ...pack.analysis!, summary_es: undefined }, 'es'), 'English summary');
  assert.ok(buildSiteHistoryBlock(pack, 'zh').includes('已永久关闭'));

  const caltrans = formatCaltransForAnchors(
    [{ routeNumber: 1, routeName: 'CA-1', county: 'San Mateo', aadt: 38000, year: 2023 }] as never,
    'es',
  );
  assert.ok(caltrans.includes('vehículos/día') && caltrans.includes('38,000'));

  assert.ok(formatListingsForAnchors({ status: 'ok', listings: [] } as never, 'es').includes('No se encontraron'));
  const listings = formatListingsForAnchors(
    { status: 'ok', listings: [{ address: '2 Main St', sqft: 1200, monthlyRent: 4500, pricePerSqft: 3.75 }] } as never,
    'es',
  );
  assert.ok(listings.includes('| Dirección |'));

  const bd = formatBrightDataForAnchors(
    { search_results: [{ title: 't', description: 'd', url: 'u' }], competitor_reviews: null, real_estate_data: null } as never,
    'es',
  );
  assert.ok(bd.includes('Resultados de búsqueda web'));

  const timeoutPack = { status: 'timeout', response_time_sec: 75 } as DeepResearchPack;
  assertSpanish(summarizeDeepResearchForAnchors(timeoutPack, 'es'), 'deep research timeout es');
  const completed = {
    status: 'completed',
    model: 'pro',
    response_time_sec: 40,
    report: { executive_summary: 'x', site_suitability_verdict: 'marginal' },
    sources: [],
  } as unknown as DeepResearchPack;
  const digest = summarizeDeepResearchForAnchors(completed, 'es');
  assert.ok(digest.includes('Informe de investigación profunda') && digest.includes('**Marginal**'));
  assert.ok(summarizeDeepResearchForAnchors(completed, 'en').includes('**Marginal**'));
});

test('premium market-data section and free brief fall back gracefully in es', () => {
  assertSpanish(buildFreeTierMarketBrief(null, 'es'), 'free brief es');
  const section = buildPremiumMarketDataSection(null, 'es');
  assertSpanish(section, 'premium section es');
  assert.ok(section.includes('[ANCLAJES DEL SISTEMA]') && section.includes('[ANCLAJES DEMOGRÁFICOS]'));
  const withData = buildPremiumMarketDataSection(
    { summary: { competitor_count_google: 3, sample_competitors_google: [{ name: 'Boba Guys' }] }, user_inputs: { monthly_rent_usd: 5000 } },
    'es',
  );
  assert.ok(withData.includes('JSON DE DATOS DE MERCADO') && withData.includes('Renta mensual USD: 5000'));
  const langs: Locale[] = ['en', 'zh', 'es'];
  for (const l of langs) assert.ok(buildPremiumMarketDataSection({}, l).length > 100);
});

test('§4.5 P1-b: every premium system prompt carries the narrative / number alignment rule in its own language', () => {
  for (const lang of LOCALES) {
    const block = narrativeNumberAlignmentBlock(lang);
    assert.ok(block.includes('12.5%'), `${lang} names the sensitivity trigger`);
    assert.ok(locationIqV2PremiumSystem(lang).includes(block.trim()), `${lang} premium system carries the block`);
  }
  // the exact wording the spec asks for, per language
  assert.match(narrativeNumberAlignmentBlock('zh'), /三档情景（保守 \/ 基准 \/ 乐观）营收均高于安全线时，\*\*不得\*\*出现「利润会被迅速侵蚀」/);
  assert.match(narrativeNumberAlignmentBlock('zh'), /综合 ≥ 70 → 可做 \/ GO；55–69 → 有条件可做；< 55 → 不建议/);
  assert.match(narrativeNumberAlignmentBlock('en'), /all three scenarios .*clear the safety line, do NOT write that profit "will be eroded quickly"/);
  assert.match(narrativeNumberAlignmentBlock('en'), /≥ 70 → GO; 55–69 → CONDITIONAL GO; < 55 → NO GO/);
  assert.match(narrativeNumberAlignmentBlock('es'), /los tres escenarios .*superan la línea de seguridad/);
  assert.match(narrativeNumberAlignmentBlock('es'), /≥ 70 → VIABLE \/ GO; 55–69 → VIABLE CON CONDICIONES; < 55 → NO VIABLE/);
  // Spanish and English blocks stay free of Chinese.
  assert.ok(!CJK.test(narrativeNumberAlignmentBlock('en')));
  assert.ok(!CJK.test(narrativeNumberAlignmentBlock('es')));
});
