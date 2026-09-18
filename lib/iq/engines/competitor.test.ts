import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circlePolygon, destination, haversineM } from '../geo';
import { applyLlmClassifications, classifyCandidate, clusterScoreFor, computeCompetitors, dedupeCandidates, isLayer1, promoteDirectLayerHits, selectBrandAnchors, type CandidatePoi } from './competitor';
import { conceptSearchProfile } from '../data/search-profile';
import { applyWalkingLegs } from '../pipeline';
import type { Ring } from '../model/schema';

const site = { lat: 37.5985, lng: -122.3872 };
const walk10 = circlePolygon(site, 800, 48);
const drive10 = circlePolygon(site, 4_828, 48);
const rings: Ring[] = [
  { id: 'drive10', method: 'radius', minutes: 10, radius_mi: 3, geometry: drive10, area_sq_mi: 28, pop: 60_000, hh: 22_000, median_income: 130_000, chinese_hh_share: 0.3, chinese_pop: 18_000, age_25_44_share: 0.3, family_share: 0.3, avg_hh_size: 2.7, renter_share: 0.4, jobs: 20_000, jobs_method: 'lodes_wac', restaurant_spend_usd: 1e8, chinese_spend_usd: 2e7, cuisine_demand_usd: 2e6, block_groups: 40 },
];

function poi(id: string, name: string, bearing: number, distM: number, over: Partial<CandidatePoi> = {}): CandidatePoi {
  const p = destination(site, bearing, distM);
  return { id, source: 'overture', name, lat: p.lat, lng: p.lng, categories: ['chinese_restaurant'], primary_category: 'chinese_restaurant', operating_status: 'open', rating: 4.2, rating_count: 300, price_level: 2, ...over };
}

test('classifier rule → keyword → leftover', () => {
  assert.equal(classifyCandidate(poi('a', 'Hunan Impression', 0, 100)).sub_cuisine, 'hunan');
  assert.equal(classifyCandidate(poi('b', 'Golden Wok', 0, 100)).sub_cuisine, 'chinese_fast');
  assert.equal(classifyCandidate(poi('b2', 'Golden Dragon', 0, 100)).sub_cuisine, 'other_chinese');
  const j = classifyCandidate(poi('c', 'Sushi Ran', 0, 100, { categories: ['japanese_restaurant'], primary_category: 'japanese_restaurant' }));
  assert.equal(j.is_chinese, false);
  const cjk = classifyCandidate(poi('d', '老友记', 0, 100, { categories: ['restaurant'], primary_category: 'restaurant' }));
  assert.equal(cjk.sub_cuisine, null);
  assert.equal(cjk.is_chinese, true);
});

test('dedupe merges Overture + Google within 100 m, keeps both ids, Google freshness wins', () => {
  const o = poi('ov1', 'Hunan Home Restaurant', 0, 200, { rating: null, rating_count: null });
  const g = poi('g1', 'Hunan Home', 0, 230, { source: 'google', rating: 4.4, rating_count: 900, operating_status: 'OPERATIONAL' });
  const m = dedupeCandidates(site, [o, g]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].ids, { overture: 'ov1', google: 'g1', yelp: null });
  assert.equal(m[0].rating_count, 900);
});

test('layers, metrics, void conditions and guard', () => {
  const cands: CandidatePoi[] = [
    poi('h1', 'Hunan Impression', 10, 500),
    poi('h2', '湘味轩', 200, 3_000, { rating_count: 1_200, rating: 4.5 }),
    poi('s1', 'Little Sichuan', 20, 600),
    poi('c1', 'Koi Palace Dim Sum', 30, 1_500, { rating_count: 5_000, price_level: 3 }),
    poi('c2', 'Golden Dragon', 40, 700),
    poi('c3', 'Panda Express', 50, 400, { rating_count: 200 }),
    poi('c4', 'Hong Kong Flower Lounge', 60, 900),
    poi('dead', 'Old Hunan Place', 70, 800, { operating_status: 'closed_permanently' }),
    poi('j1', 'Sushi Ran', 80, 300, { categories: ['japanese_restaurant'], primary_category: 'japanese_restaurant', price_level: 2 }),
    poi('r1', '99 Ranch Market', 90, 600, { categories: ['asian_grocery_store'], primary_category: 'asian_grocery_store' }),
    poi('bank', 'East West Bank', 100, 500, { categories: ['bank'], primary_category: 'bank' }),
    ...Array.from({ length: 12 }, (_, i) => poi(`f${i}`, `Generic Eatery ${i}`, i * 25, 1_200 + i * 100, { categories: ['restaurant'], primary_category: 'restaurant' })),
  ];
  const r = computeCompetitors({ site, cuisine: 'hunan', candidates: cands, rings, walk10, drive10, metro_sub_cuisine_total: 25, hub_median_density_per_10k_chinese: 2.0, traffic: {}, ticket_in: 24, target_price_level: 2 });
  assert.equal(r.l1.length, 2, JSON.stringify(r.l1.map((x) => x.name)));
  assert.ok(r.l2_count >= 5, String(r.l2_count));
  assert.equal(r.l3_count, 1);
  assert.equal(r.l4.length, 2);
  assert.ok(r.closure_rate! > 0);
  assert.ok(r.hhi! > 0 && r.hhi! <= 1);
  assert.ok(r.walk10_l1_l2_count >= 4);
  assert.equal(r.guard_passed, true, r.guard_notes.join('; '));
  assert.ok(r.chain_names.includes('Panda Express'));
  assert.equal(r.void.is_void, false); // density above threshold: 2 L1 / 18k chinese = 1.11 per 10k vs hub 2.0 → 0.56 ≥ 0.5
  assert.equal(r.benchmark_revenue_band.method, 'insufficient_history');
});

test('R1 guard: metro has the cuisine but drive10 has zero → DataIntegrityError signal', () => {
  const r = computeCompetitors({ site, cuisine: 'hunan', candidates: [], rings, walk10, drive10, metro_sub_cuisine_total: 25, hub_median_density_per_10k_chinese: 2, traffic: {}, ticket_in: 24, target_price_level: 2 });
  assert.equal(r.guard_passed, false);
  assert.ok(r.guard_notes.some((n) => n.includes('竞品抓取异常')));
  assert.ok(r.guard_notes.some((n) => n.includes('POI 覆盖异常')));
});

test('cluster score U-shape and LLM leftovers', () => {
  assert.equal(clusterScoreFor(0, null), 30);
  assert.equal(clusterScoreFor(5, null), 85);
  assert.equal(clusterScoreFor(20, null), 35);
  assert.equal(clusterScoreFor(5, 1.3), 95);
  const m = dedupeCandidates(site, [poi('x', '老友记', 0, 100, { categories: ['restaurant'], primary_category: 'restaurant' })]);
  applyLlmClassifications(m, [{ id: 'x', sub_cuisine: 'dongbei', confidence: 0.9 }]);
  assert.equal(m[0].sub_cuisine, 'dongbei');
  const m2 = dedupeCandidates(site, [poi('y', '好味道', 0, 100, { categories: ['restaurant'], primary_category: 'restaurant' })]);
  applyLlmClassifications(m2, [{ id: 'y', sub_cuisine: 'hunan', confidence: 0.4 }]);
  assert.equal(m2[0].sub_cuisine, 'other_chinese');
});

test('dedupe: Overture 湘园 + Google "Xiang Yuan Hunan Cuisine" at the same spot merge; google_place_id link merges regardless of distance/name', () => {
  const zh = poi('ov2', '湘园', 0, 300, { rating: null, rating_count: null });
  const en = poi('g2', 'Xiang Yuan Hunan Cuisine', 0, 330, { source: 'google', rating: 4.5, rating_count: 275, operating_status: 'OPERATIONAL' });
  const m = dedupeCandidates(site, [zh, en]);
  assert.equal(m.length, 1);
  assert.equal(m[0].name, 'Xiang Yuan Hunan Cuisine');
  assert.equal(m[0].name_zh, '湘园');
  assert.equal(m[0].rating_count, 275);
  const linked = poi('ov3', '老北京', 90, 900, { google_place_id: 'ChIJ-link' });
  const g = poi('ChIJ-link', 'Old Beijing Restaurant', 120, 1400, { source: 'google', rating: 4.1, rating_count: 90 });
  const m2 = dedupeCandidates(site, [linked, g]);
  assert.equal(m2.length, 1);
  assert.deepEqual(m2[0].ids, { overture: 'ov3', google: 'ChIJ-link', yelp: null });
  // two different Chinese-named restaurants 300 m apart stay separate
  const a = poi('a', '川味观', 0, 200);
  const b = poi('b', 'Sichuan House', 0, 500, { source: 'google' });
  assert.equal(dedupeCandidates(site, [a, b]).length, 2);
});

/* ------------------------------------------------------------------ */
/* §4.2 three-layer semantics for a non-Chinese concept (egg tart)      */
/* ------------------------------------------------------------------ */

const clement = { lat: 37.7827, lng: -122.472 };
const cWalk10 = circlePolygon(clement, 800, 48);
const cDrive10 = circlePolygon(clement, 4_828, 48);
const cRings: Ring[] = [{ ...rings[0], geometry: cDrive10 }];
function gpoi(id: string, name: string, lat: number, lng: number, types: string[], count: number, layers: CandidatePoi['layers'], over: Partial<CandidatePoi> = {}): CandidatePoi {
  return { id, source: 'google', name, lat, lng, categories: types, primary_category: types[0], operating_status: 'OPERATIONAL', rating: 4.5, rating_count: count, price_level: 2, layers, ...over };
}
const BREADBELLY = gpoi('bb', 'Breadbelly', 37.7827, -122.4738, ['bakery', 'cafe', 'food'], 900, ['direct', 'substitute']);
const SCHUBERTS = gpoi('sc', "Schubert's Bakery", 37.783, -122.4645, ['bakery', 'food'], 1500, ['direct']);
const ARSICAULT = gpoi('ar', 'Arsicault Bakery', 37.7833, -122.459, ['bakery'], 2100, ['direct', 'brand_anchor']);
const CINDERELLA = gpoi('ci', 'Cinderella Bakery & Cafe', 37.7766, -122.4636, ['bakery', 'cafe'], 1300, ['direct']);
const TARTINE = gpoi('ta', 'Tartine Manufactory', 37.7614, -122.4116, ['bakery', 'cafe', 'restaurant'], 3000, ['brand_anchor']);
const BOHO = gpoi('bo', 'Boho Bakery', 37.8005, -122.437, ['bakery'], 400, ['brand_anchor']);
const TOYBOAT = gpoi('tb', 'Toy Boat Dessert Cafe', 37.7833, -122.468, ['dessert_shop', 'cafe'], 700, ['substitute']);
const SAFEWAY = gpoi('sw', 'Safeway', 37.7808, -122.47, ['supermarket', 'grocery_store'], 2000, ['l4']);
const DIMSUM = gpoi('ds', 'Good Luck Dim Sum', 37.7829, -122.4727, ['chinese_restaurant', 'restaurant'], 1800, ['direct']); // "egg tart" query hit, but a dim sum house
// ≥ 15 food POIs inside drive10 keeps the §3.9 coverage guard quiet (ring pop 60k) so the tests exercise the §4.2 guard alone.
const eateries = Array.from({ length: 16 }, (_, i) => {
  const p = destination(clement, i * 25, 900 + i * 60);
  return gpoi(`f${i}`, `Generic Eatery ${i}`, p.lat, p.lng, ['restaurant'], 100, ['l3']);
});
const L1_QUERY = { layers_tried: ['direct@800', 'direct@1600'], radius_m: 1600 };

test('§4.2 egg tart: Layer-1 rule = query hit + name / type match; Tartine & Boho outside; substitutes and general anchors', () => {
  const p = conceptSearchProfile('egg_tart');
  assert.equal(p.origin, 'search');
  assert.deepEqual(p.types, ['bakery', 'cafe']);
  const cands = [BREADBELLY, SCHUBERTS, ARSICAULT, CINDERELLA, TARTINE, BOHO, TOYBOAT, SAFEWAY, DIMSUM, ...eateries];
  const r = computeCompetitors({ site: clement, cuisine: 'egg_tart', candidates: cands, rings: cRings, walk10: cWalk10, drive10: cDrive10, metro_sub_cuisine_total: null, hub_median_density_per_10k_chinese: null, traffic: {}, ticket_in: 10, target_price_level: 1, l1_query: L1_QUERY });
  assert.deepEqual(r.l1.map((c) => c.name).sort(), ['Arsicault Bakery', 'Breadbelly', 'Cinderella Bakery & Cafe', "Schubert's Bakery"], r.guard_notes.join('; '));
  assert.ok(r.l1.every((c) => c.sub_cuisine === 'egg_tart' && c.layer === 'L1'));
  assert.ok(!r.l2.some((c) => c.name.startsWith('Tartine')), 'Tartine (3.6 mi, brand-anchor query only) is not Layer 2');
  assert.ok(![...r.l1, ...r.l2].some((c) => c.name.startsWith('Boho')), 'Boho (Marina) is not Layer 1 / 2');
  assert.ok(![...r.l1, ...r.l2].some((c) => c.name === 'Good Luck Dim Sum'), 'a Layer-1 query hit that is a dim sum house is not Layer 1 / 2 for egg tart');
  assert.deepEqual(r.l2.map((c) => c.name), ['Toy Boat Dessert Cafe']);
  assert.deepEqual(r.l4.map((c) => c.name), ['Safeway'], 'general-audience anchors: supermarket, not 99 Ranch / East West Bank');
  assert.equal(r.guard_passed, true, r.guard_notes.join('; '));
  assert.equal(r.l1_search_radius_m, 1600);
  assert.deepEqual(r.l1_layers_tried, ['direct@800', 'direct@1600']);
  assert.equal(r.walk10_l1_l2_count, 3, 'Breadbelly, Schubert\'s, Toy Boat inside the 800 m walk ring');
  // Brand anchors from the unfiltered pool: ≥ 500 reviews, top 5 by count; Arsicault is also a direct competitor.
  const anchors = selectBrandAnchors(clement, cands, 'egg_tart', new Set(r.l1.map((c) => c.id)));
  assert.deepEqual(anchors.map((a) => `${a.name}:${a.in_trade_area}`), ['Tartine Manufactory:false', 'Arsicault Bakery:true']);
  assert.ok(anchors[0].distance_mi > 2.5);
  // Without the query provenance (alternative cuisines) the query-hit path is off: only classified ids count.
  assert.equal(isLayer1(dedupeCandidates(clement, [BREADBELLY])[0], p, false), false);
  assert.equal(isLayer1(dedupeCandidates(clement, [gpoi('gg', 'Golden Gate Egg Tart', 37.7829, -122.4725, ['bakery'], 50, [])])[0], p, false), true, 'keyword classification stays');
  // Promotion is idempotent and never overrides a specific other subtype.
  const merged = dedupeCandidates(clement, [BREADBELLY, DIMSUM]);
  assert.equal(promoteDirectLayerHits(merged, 'egg_tart'), 1);
  assert.equal(promoteDirectLayerHits(merged, 'egg_tart'), 0);
  assert.equal(merged.find((m) => m.id === 'ds')!.sub_cuisine, 'dim_sum');
});

test('§4.2 void guard: Layer 1 = 0 is a finding only after both radii (800 / 1600) were searched', () => {
  const base = { site: clement, cuisine: 'egg_tart', candidates: [...eateries, SAFEWAY], rings: cRings, walk10: cWalk10, drive10: cDrive10, metro_sub_cuisine_total: null, hub_median_density_per_10k_chinese: null, traffic: {}, ticket_in: 10, target_price_level: 1 };
  const both = computeCompetitors({ ...base, l1_query: L1_QUERY });
  assert.equal(both.l1.length, 0);
  assert.equal(both.guard_passed, true, both.guard_notes.join('; '));
  assert.equal(both.l1_search_radius_m, 1600);
  assert.deepEqual(both.l1_layers_tried, ['direct@800', 'direct@1600']);

  const near = computeCompetitors({ ...base, l1_query: { layers_tried: ['direct@800'], radius_m: 800 } });
  assert.equal(near.guard_passed, false);
  assert.ok(near.guard_notes.some((n) => n.includes('不能判定为空档')), near.guard_notes.join('; '));

  const none = computeCompetitors({ ...base, l1_query: { layers_tried: [], radius_m: null } });
  assert.equal(none.guard_passed, false, 'Google did not run → no void claim');
  assert.equal(none.l1_search_radius_m, null);
});

test('§4.2 walking legs replace the straight-line distance on the cards (Cinderella 1000 m → 0.62 mi)', () => {
  const r = computeCompetitors({ site: clement, cuisine: 'egg_tart', candidates: [BREADBELLY, CINDERELLA, ...eateries], rings: cRings, walk10: cWalk10, drive10: cDrive10, metro_sub_cuisine_total: null, hub_median_density_per_10k_chinese: null, traffic: {}, ticket_in: 10, target_price_level: 1, l1_query: L1_QUERY });
  const straight = r.l1.find((c) => c.name.startsWith('Cinderella'))!;
  assert.equal(straight.distance_mi, Math.round((haversineM(clement, CINDERELLA) / 1609.344) * 100) / 100);
  const walked = applyWalkingLegs(r.l1, { ci: { walk_m: 1000, walk_min: 13 } });
  const c = walked.find((x) => x.name.startsWith('Cinderella'))!;
  assert.equal(c.walk_m, 1000);
  assert.equal(c.walk_min, 13);
  assert.ok(c.distance_mi >= 0.55 && c.distance_mi <= 0.7, String(c.distance_mi));
  assert.equal(walked.find((x) => x.name === 'Breadbelly')!.walk_min, null, 'no leg → straight-line kept');
});

/* ------------------------------------------------------------------ */
/* §4.2 品类空白判定加硬约束 (P0-B) — report a7217ad7, 1115 Clement St     */
/* ------------------------------------------------------------------ */

/**
 * The real 1115 Clement report devoted a page to 「1 英里内没有同品类直接竞品，
 * 本址是葡挞/蛋挞的空档」 because the egg-tart keyword search returned 0 hits —
 * while the same report listed four Chinese bakeries that sell egg tarts daily.
 * Layer-1 hits = 0 is the situation here: the bakeries come back from the
 * Layer-2 (substitute) call, not from the keyword query.
 */
const withText = (c: CandidatePoi, reviews: string[], editorial?: string): CandidatePoi => ({ ...c, review_texts: reviews, editorial_summary: editorial ?? null });
const asL2 = (c: CandidatePoi): CandidatePoi => ({ ...c, layers: ['substitute'] });

const NO_EGG_TART = [
  asL2(withText(BREADBELLY, ['The milk toast and the kimchi rice are the reason to come; get there before 11.'])),
  asL2(withText(SCHUBERTS, ['Classic princess cake and petit fours — a San Francisco institution since 1911.'])),
  asL2(withText(ARSICAULT, ['Best croissant in the country. The kouign amann sells out by noon.'])),
  asL2(withText(CINDERELLA, ['Russian bakery: piroshki, borscht and honey cake. Cash only for small orders.'])),
];
const WING_LEE = asL2(withText(gpoi('wl', 'Wing Lee Bakery', 37.7825, -122.4692, ['bakery', 'food'], 620, []), ['Cheap and fast — the egg tarts are still warm and the char siu bao is huge.']));
const PINEAPPLE_KING = asL2(withText(gpoi('pk', 'Pineapple King Bakery', 37.7831, -122.4705, ['bakery', 'store'], 1771, []), ['菠萝包一流，蛋挞也是刚出炉的，排队值得。']));
const GOOD_LUCK = asL2(withText(gpoi('gl', 'Good Luck Dim Sum', 37.7829, -122.4727, ['chinese_restaurant', 'restaurant'], 2045, []), ['Line out the door. Shrimp dumplings, sesame balls and an egg tart for under $5.']));
const ALSO_SELLING_SET = [...NO_EGG_TART, WING_LEE, PINEAPPLE_KING, GOOD_LUCK, ...eateries];
const gapInput = (candidates: CandidatePoi[], l1_query = L1_QUERY) => ({
  site: clement,
  cuisine: 'egg_tart',
  candidates,
  rings: cRings,
  walk10: cWalk10,
  drive10: cDrive10,
  metro_sub_cuisine_total: null,
  hub_median_density_per_10k_chinese: null,
  traffic: {},
  ticket_in: 10,
  target_price_level: 1,
  l1_query,
});

test('§4.2 P0-B: 0 keyword hits is NOT a gap when same-category stores also sell it (1115 Clement egg tart)', () => {
  const r = computeCompetitors(gapInput(ALSO_SELLING_SET));
  assert.equal(r.l1.length, 0, 'the egg-tart keyword search returned nothing');
  assert.equal(r.category_gap, 'false');
  assert.deepEqual(
    r.also_selling.map((a) => a.name).sort(),
    ['Good Luck Dim Sum', 'Pineapple King Bakery', 'Wing Lee Bakery'],
  );
  for (const a of r.also_selling) {
    assert.equal(a.evidence, 'review');
    assert.ok(a.quote && /egg tart|蛋挞/i.test(a.quote), `${a.name}: ${a.quote}`);
    assert.ok(a.distance_mi > 0 && a.distance_mi < 1);
  }
  assert.equal(r.also_selling_unknown_count, 0, 'every Layer-2 store carried review text');
  assert.equal(r.coverage_discount, null);
  assert.equal(r.coverage_adjustment, null);
  // The void panel is never produced: page 7 and page 8 only claim a gap when category_gap === 'true',
  // which the assertion above rules out — they render 「无专营{concept}店，但 N 家兼售」 and the list instead.

  // §4.4: one count set, and it is the set every surface prints.
  assert.equal(r.counts.direct, r.l1.length);
  assert.equal(r.counts.same_category, r.l2.length);
  assert.equal(r.counts.total, r.l1.length + r.l2.length);
  assert.equal(r.counts.l3, r.l3_count);
  assert.equal(r.counts.anchors, 0, 'brand anchors are added by the pipeline and never counted in total');
  assert.equal(r.counts.by_source.google, r.counts.total, 'every candidate here is a Google record');
  assert.equal(r.counts.by_source.yelp + r.counts.by_source.foursquare, 0);
});

test('§4.2 P0-B: no text at all → unknown (never a gap) and the demand coverage is discounted 0.8', () => {
  const noText = [...NO_EGG_TART, WING_LEE, PINEAPPLE_KING, GOOD_LUCK].map((c) => ({ ...c, review_texts: null, editorial_summary: null }));
  const r = computeCompetitors(gapInput([...noText, ...eateries]));
  assert.equal(r.l1.length, 0);
  assert.equal(r.category_gap, 'unknown');
  assert.deepEqual(r.also_selling, []);
  assert.equal(r.also_selling_unknown_count, 7);
  assert.equal(r.coverage_discount, 0.8);
  assert.ok(r.coverage_adjustment?.includes('0.8'), String(r.coverage_adjustment));
});

test('§4.2 P0-B: a genuinely empty market is a gap — but only after both radii were searched', () => {
  const r = computeCompetitors(gapInput([...NO_EGG_TART, ...eateries]));
  assert.equal(r.l1.length, 0);
  assert.equal(r.category_gap, 'true', 'four bakeries, every one verified by review text as not selling egg tarts');
  assert.deepEqual(r.also_selling, []);
  assert.equal(r.also_selling_unknown_count, 0);
  assert.equal(r.coverage_discount, null, 'nothing was unverifiable → no discount');

  // 0.5 mi only: condition (1) is not established, so the gap claim is withheld.
  const near = computeCompetitors(gapInput([...NO_EGG_TART, ...eateries], { layers_tried: ['direct@800'], radius_m: 800 }));
  assert.equal(near.category_gap, 'unknown');
  assert.equal(near.guard_passed, false);

  // One unverifiable store among the four: still a gap, but the coverage ratio is discounted.
  const partial = computeCompetitors(gapInput([...NO_EGG_TART.slice(1), { ...NO_EGG_TART[0], review_texts: [], editorial_summary: null }, ...eateries]));
  assert.equal(partial.category_gap, 'true');
  assert.equal(partial.also_selling_unknown_count, 1);
  assert.equal(partial.coverage_discount, 0.8);
});
