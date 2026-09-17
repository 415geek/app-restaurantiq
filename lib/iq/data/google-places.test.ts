import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { buildCallPlan, fetchGooglePlaces, fetchThreeLayerCompetitors, L1_RADIUS_FAR_M, L1_RADIUS_NEAR_M, layerPlaces } from './google-places';
import { conceptSearchProfile } from './search-profile';
import { haversineM, METERS_PER_MILE } from '@/lib/iq/geo';
import { getDefaults } from '@/lib/iq/params';
import type { FetchContext } from './types';

const FIX = join(process.cwd(), 'qa', 'fixtures');
const chinese = readFileSync(join(FIX, 'google_places_nearby_chinese_1mi.json'), 'utf8');
const restaurant = readFileSync(join(FIX, 'google_places_nearby_restaurant_1mi.json'), 'utf8');
const millbrae = { lat: 37.5985, lng: -122.3872 };
const COST = getDefaults().data_budget.google_places_cost_usd_per_call;
const CAP = getDefaults().data_budget.google_places_max_calls;

interface Req {
  url: string;
  headers: Record<string, string>;
  body: {
    includedTypes?: string[];
    includedType?: string;
    textQuery?: string;
    maxResultCount?: number;
    locationRestriction?: { circle?: { center: { latitude: number; longitude: number }; radius: number }; rectangle?: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } };
    locationBias?: { circle: { center: { latitude: number; longitude: number }; radius: number } };
  };
}

/** Radius a Text Search request asked for: rectangle restriction half-height, or Infinity for a bias. */
function radiusOf(req: Req): number {
  const rect = req.body.locationRestriction?.rectangle;
  if (rect) return Math.round(((rect.high.latitude - rect.low.latitude) / 2) * 111_320);
  return req.body.locationRestriction?.circle?.radius ?? Infinity;
}

function ctxWith(opts: { key?: string | null; respond?: (req: Req, n: number) => Response }): FetchContext & { reqs: Req[] } {
  const reqs: Req[] = [];
  const stub: typeof fetch = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: Req = { url: String(input), headers, body: init?.body ? JSON.parse(String(init.body)) : {} };
    reqs.push(req);
    if (opts.respond) return opts.respond(req, reqs.length);
    const types = (req.body.includedTypes ?? []).join(',');
    if (types === 'chinese_restaurant') return new Response(chinese, { status: 200 });
    if (types === 'restaurant') return new Response(restaurant, { status: 200 });
    return new Response('{}', { status: 200 });
  };
  return {
    fetch: stub,
    cost: createCostLedger(),
    cache: createMemoryCache(),
    // Tests exercise the billed path so cost accounting is verified end to end.
    env: (n) => (n === 'GOOGLE_MAPS_API_KEY' ? (opts.key === undefined ? 'AIza-test' : opts.key) : n === 'GOOGLE_PLACES_BILLED' ? '1' : null),
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
    reqs,
  };
}

test('D6 call plan (§4.2): direct 800 → 1600 (conditional), substitute, brand anchor, L3 / L4, ≤ yaml cap', () => {
  const hunan = buildCallPlan('hunan');
  assert.equal(hunan.length, CAP);
  assert.deepEqual(hunan[0], { includedTypes: ['chinese_restaurant'], radiusM: L1_RADIUS_NEAR_M, label: 'direct@800', textQuery: 'Hunan', layer: 'direct', restrict: true });
  assert.equal(hunan[1].radiusM, L1_RADIUS_FAR_M);
  assert.equal(hunan[1].only_if_fewer_than, 5);
  assert.deepEqual(hunan[2], { includedTypes: ['chinese_restaurant'], radiusM: 1600, label: 'substitute@1600', layer: 'substitute' });
  assert.equal(hunan[3].layer, 'brand_anchor');
  assert.equal(hunan[3].radiusM, 8000);
  assert.equal(hunan[3].restrict, undefined, 'brand anchors are biased city-wide, not restricted');
  assert.deepEqual(hunan.map((c) => c.label), ['direct@800', 'direct@1600', 'substitute@1600', 'brand_anchor@8000', 'restaurant @1mi', 'grocery @1mi', 'tea/dessert @1mi', 'chinese_restaurant @3mi']);
  // Nearby wherever Table A types suffice: only the keyword layers and brand anchors are Text Searches.
  assert.equal(hunan.filter((c) => c.textQuery).length, 3);
  // Every Chinese concept uses the same Table-A-valid steps; caps are respected.
  assert.equal(buildCallPlan('other_chinese').length, CAP);
  assert.equal(buildCallPlan('hunan', 3).length, 3);
  assert.equal(buildCallPlan('hunan', 99).length, CAP);

  // A general-audience concept (egg tart) gets general anchors instead of Chinese grocers / tea houses.
  const egg = buildCallPlan('egg_tart');
  const labels = egg.map((c) => c.label);
  assert.ok(labels.includes('anchors:general @1mi'), labels.join(','));
  assert.ok(!labels.includes('grocery @1mi') && !labels.includes('tea/dessert @1mi') && !labels.includes('chinese_restaurant @3mi'));
  assert.equal(egg[0].textQuery, 'egg tart');
  assert.deepEqual(egg[0].includedTypes, ['bakery', 'cafe']);
  const sub = egg.find((c) => c.label === 'substitute@1600')!;
  assert.ok(sub.includedTypes.includes('dessert_shop') && sub.includedTypes.includes('bakery'), sub.includedTypes.join(','));
  assert.ok(egg.length <= CAP);
});

test('D6 ok: layered plan, Pro field mask, restricted Text Search, cost accounting, dedupe, 30 d cache', async () => {
  const ctx = ctxWith({});
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'ok', r.coverage_note);
  assert.equal(ctx.reqs.length, CAP);
  assert.equal(r.data!.calls_made, CAP);
  assert.equal(r.data!.api_status, 'ok');
  const texts = ctx.reqs.filter((q) => q.url.endsWith(':searchText'));
  assert.equal(texts.length, 3, 'direct ×2 + brand anchor');
  assert.equal(texts[0].body.textQuery, 'Hunan');
  assert.equal(texts[0].body.includedType, 'chinese_restaurant');
  assert.equal(radiusOf(texts[0]), 800);
  assert.equal(radiusOf(texts[1]), 1600, 'widened because the 800 m search came back with < 5 hits');
  assert.equal(texts[2].body.locationBias?.circle.radius, 8000);
  for (const q of ctx.reqs) {
    assert.equal(q.headers['X-Goog-Api-Key'], 'AIza-test');
    // §4.2 品类空白判定 needs review text — exactly ONE atmosphere field is requested, nothing else.
    assert.ok(!/atmosphere|editorial|photos|contactless/i.test(q.headers['X-Goog-FieldMask']));
    assert.ok(q.headers['X-Goog-FieldMask'].includes('places.reviews'));
    assert.ok(q.headers['X-Goog-FieldMask'].includes('places.userRatingCount'));
    assert.equal(q.body.maxResultCount, 20);
  }
  assert.deepEqual(
    ctx.reqs.filter((q) => q.body.includedTypes).map((q) => `${(q.body.includedTypes ?? []).join('+')}@${q.body.locationRestriction!.circle!.radius}`),
    ['chinese_restaurant@1600', 'restaurant@1609', 'asian_grocery_store+supermarket@1609', 'dessert_shop+tea_house@1609'.replace('dessert_shop+tea_house', 'tea_house+dessert_shop'), 'chinese_restaurant@4828'],
  );
  // Cost: one per-call price per network call, attributed to D6.
  assert.equal(r.cost_usd, Math.round(CAP * COST * 10_000) / 10_000);
  assert.equal(ctx.cost.bySource().D6, r.cost_usd);
  assert.equal(ctx.cost.entries().length, CAP);
  // Dedupe: chinese fixture (14) served twice + restaurant fixture (10, of which 4 overlap) → 20 unique.
  const places = r.data!.places;
  assert.equal(places.length, 20);
  assert.equal(new Set(places.map((p) => p.id)).size, 20);
  for (let i = 1; i < places.length; i++) assert.ok(places[i - 1].distance_m <= places[i].distance_m);
  const hunan = places.find((p) => p.name === 'Hunan Home Kitchen')!;
  assert.equal(hunan.price_level, 2);
  assert.equal(hunan.rating, 4.3);
  assert.equal(hunan.user_rating_count, 812);
  assert.equal(hunan.opening_hours_weekday?.length, 7);
  assert.ok(hunan.types.includes('meal_takeaway'), 'richer duplicate record wins');
  assert.deepEqual(hunan.layers, ['substitute', 'l3'], 'tagged with every layer whose step returned it (chinese_restaurant Nearby + restaurant @1mi)');
  assert.equal(places.filter((p) => p.business_status === 'CLOSED_PERMANENTLY').length, 2);
  assert.ok(places.some((p) => p.price_level === 3));
  assert.ok(r.coverage_note.includes('永久关闭 2'));
  // §4.2 provenance for the void guard.
  assert.deepEqual(r.data!.l1_layers_tried, ['direct@800', 'direct@1600']);
  assert.equal(r.data!.l1_search_radius_m, 1600);

  // Cached per call (lat/lng@4dp + query/types + radius): a nearby re-run makes no network calls and costs nothing.
  const again = await fetchGooglePlaces({ lat: 37.59851, lng: -122.38722, cuisineId: 'hunan' }, ctx);
  assert.equal(ctx.reqs.length, CAP);
  assert.equal(again.cache, 'hit');
  assert.equal(again.data!.calls_made, 0);
  assert.equal(again.cost_usd, 0);
  assert.equal(again.data!.places.length, 20);
});

test('D6 maxCalls caps the plan', async () => {
  const ctx = ctxWith({});
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'sichuan', maxCalls: 3 }, ctx);
  assert.equal(ctx.reqs.length, 3);
  assert.equal(r.data!.calls_made, 3);
  assert.equal(r.cost_usd, Math.round(3 * COST * 10_000) / 10_000);
  assert.equal(r.data!.places.length, 14, 'direct ×2 (empty) + substitute Nearby (chinese fixture)');
});

test('D6 no key → failed with the 未获取 note, no calls', async () => {
  const ctx = ctxWith({ key: null });
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(r.coverage_note, 'GOOGLE_MAPS_API_KEY 未设置：评分类指标标「未获取」');
  assert.equal(r.data, null);
  assert.equal(ctx.reqs.length, 0);
  assert.equal(r.cost_usd, 0);
});

test('D6 403 on first call → failed with API message and remaining calls aborted', async () => {
  const ctx = ctxWith({
    respond: () =>
      new Response(JSON.stringify({ error: { code: 403, message: 'Places API (New) has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }), { status: 403 }),
  });
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(ctx.reqs.length, 1, 'aborts after a fatal 403');
  assert.ok(r.error?.includes('PERMISSION_DENIED'));
  assert.ok(r.coverage_note.includes('has not been used in project 123'));
  assert.equal(r.data?.api_status, 'error');
  assert.equal(r.data?.calls_made, 1);
  assert.equal(r.cost_usd, COST);
  assert.deepEqual(r.data?.l1_layers_tried, []);
});

test('D6 429 after two successes → partial, keeps places, notes the gap', async () => {
  const ctx = ctxWith({
    respond: (req, n) => {
      if (n <= 2) return new Response(chinese, { status: 200 });
      return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
    },
  });
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'partial');
  // 800 m direct: 14 raw hits, all beyond 800 m straight-line from the site except the near ones → still < 5? No: the fixture
  // is a 1-mi Nearby pull, so the client-side circle keeps only the places inside 800 m; the 1600 m step then runs.
  assert.equal(ctx.reqs.length, 3);
  assert.equal(r.data!.api_status, 'partial');
  assert.equal(r.data!.places.length, 14);
  assert.equal(r.data!.calls_made, 3);
  assert.ok(r.coverage_note.includes('RESOURCE_EXHAUSTED'));
  assert.ok(r.coverage_note.includes('不做补估'));
  assert.equal(r.data!.calls.filter((c) => c.error).length, 1);
});

/* ------------------------------------------------------------------ */
/* §4.2 acceptance: egg tart at 1115 Clement St, San Francisco           */
/* ------------------------------------------------------------------ */

const CLEMENT = { lat: 37.7827, lng: -122.472 };
type Raw = { id: string; displayName: { text: string }; location: { latitude: number; longitude: number }; primaryType: string; types: string[]; rating: number; userRatingCount: number; businessStatus: string };
const P = (id: string, name: string, lat: number, lng: number, types: string[], count: number, rating = 4.5): Raw => ({
  id,
  displayName: { text: name },
  location: { latitude: lat, longitude: lng },
  primaryType: types[0],
  types,
  rating,
  userRatingCount: count,
  businessStatus: 'OPERATIONAL',
});
const BREADBELLY = P('bb', 'Breadbelly', 37.7827, -122.4738, ['bakery', 'cafe', 'food'], 900); // 1408 Clement
const SCHUBERTS = P('sc', "Schubert's Bakery", 37.783, -122.4645, ['bakery', 'food'], 1500); // 521 Clement
const ARSICAULT = P('ar', 'Arsicault Bakery', 37.7833, -122.459, ['bakery', 'food'], 2100); // 397 Arguello
const CINDERELLA = P('ci', 'Cinderella Bakery & Cafe', 37.7766, -122.4636, ['bakery', 'cafe'], 1300); // 436 Balboa
const TARTINE = P('ta', 'Tartine Manufactory', 37.7614, -122.4116, ['bakery', 'cafe', 'restaurant'], 3000); // 595 Alabama
const BOHO = P('bo', 'Boho Bakery', 37.8005, -122.437, ['bakery'], 400); // Marina
const TOYBOAT = P('tb', 'Toy Boat Dessert Cafe', 37.7833, -122.468, ['dessert_shop', 'cafe'], 700);
const SAFEWAY = P('sw', 'Safeway', 37.7808, -122.47, ['supermarket', 'grocery_store'], 2000, 3.9);
const ll = (p: Raw) => ({ lat: p.location.latitude, lng: p.location.longitude });

/** Mocked Places (New) + Distance Matrix: Google honours the rectangle restriction, the matrix returns a fixed Cinderella leg. */
function eggTartCtx(textPool: Raw[]) {
  return ctxWith({
    respond: (req) => {
      if (req.url.endsWith(':searchText')) {
        const r = radiusOf(req);
        return new Response(JSON.stringify({ places: textPool.filter((p) => haversineM(CLEMENT, ll(p)) <= r) }), { status: 200 });
      }
      if (req.url.endsWith(':searchNearby')) {
        const types = req.body.includedTypes ?? [];
        if (types.includes('dessert_shop') || types.includes('bakery')) return new Response(JSON.stringify({ places: [TOYBOAT, BREADBELLY] }), { status: 200 });
        if (types.includes('supermarket')) return new Response(JSON.stringify({ places: [SAFEWAY] }), { status: 200 });
        return new Response('{}', { status: 200 });
      }
      if (req.url.includes('/distancematrix/')) {
        const u = new URL(req.url);
        const dests = (u.searchParams.get('destinations') ?? '').split('|').map((s) => s.split(',').map(Number));
        assert.equal(u.searchParams.get('mode'), 'walking');
        const elements = dests.map(([lat, lng]) => {
          const straight = haversineM(CLEMENT, { lat, lng });
          const isCinderella = Math.abs(lat - CINDERELLA.location.latitude) < 1e-6;
          const m = isCinderella ? 1000 : Math.round(straight * 1.25);
          return { status: 'OK', distance: { value: m }, duration: { value: Math.round((m / 80) * 60) } };
        });
        return new Response(JSON.stringify({ status: 'OK', rows: [{ elements }] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    },
  });
}
const ALL = [BREADBELLY, SCHUBERTS, ARSICAULT, CINDERELLA, TARTINE, BOHO];

test('§4.2 egg tart @ Clement St: Layer 1 = the four bakeries, Tartine only a brand anchor, Boho excluded, Cinderella walks 0.55–0.7 mi', async () => {
  const ctx = eggTartCtx(ALL);
  const r = await fetchThreeLayerCompetitors({ ...CLEMENT, conceptId: 'egg_tart' }, ctx);
  assert.equal(r.status, 'ok', r.note);
  assert.equal(r.concept.id, 'egg_tart');
  assert.equal(r.concept.resolved_by, 'id');
  const names = (xs: Array<{ name: string }>) => xs.map((x) => x.name).sort();
  assert.deepEqual(names(r.direct), ['Arsicault Bakery', 'Breadbelly', 'Cinderella Bakery & Cafe', "Schubert's Bakery"]);
  assert.ok(!r.direct.some((p) => p.name.startsWith('Tartine')) && !r.substitute.some((p) => p.name.startsWith('Tartine')), 'Tartine (2.5+ mi) is not Layer 1 / 2');
  assert.ok(!r.direct.some((p) => p.name.startsWith('Boho')) && !r.substitute.some((p) => p.name.startsWith('Boho')), 'Boho (Marina) is not Layer 1 / 2');
  assert.ok(r.brand_anchors.some((p) => p.name === 'Tartine Manufactory'), 'Tartine is a brand anchor');
  assert.ok(r.brand_anchors.every((p) => (p.user_rating_count ?? 0) >= 500) && r.brand_anchors.length <= 5);
  assert.ok(!r.brand_anchors.some((p) => p.name.startsWith('Boho')), '400 reviews < 500');
  assert.equal(r.brand_anchors[0].name, 'Tartine Manufactory', 'ranked by review count');
  assert.deepEqual(names(r.substitute), ['Toy Boat Dessert Cafe'], 'substitute Nearby hit that is not Layer 1');
  // 先近后远: 800 m returned 2 (< 5) so the 1600 m step ran.
  const direct = r.calls.filter((c) => c.layer === 'direct');
  assert.deepEqual(direct.map((c) => `${c.label}:${c.cache}:${c.results}`), ['direct@800:miss:2', 'direct@1600:miss:4']);
  assert.deepEqual(r.l1_layers_tried, ['direct@800', 'direct@1600']);
  assert.equal(r.l1_search_radius_m, 1600);
  // Walking legs via Distance Matrix for Layer 1 + 2 (5 destinations → one call).
  const cinderella = r.direct.find((p) => p.name.startsWith('Cinderella'))!;
  assert.equal(cinderella.walk_m, 1000);
  const walkMi = cinderella.walk_m! / METERS_PER_MILE;
  assert.ok(walkMi >= 0.55 && walkMi <= 0.7, `walk ${walkMi}`);
  assert.equal(cinderella.walk_min, 13);
  assert.equal(Object.keys(r.walk).length, 5);
  assert.equal(ctx.reqs.filter((q) => q.url.includes('/distancematrix/')).length, 1);
  // The Layer-1 pool is ordered by walking distance; the L4 general anchor was fetched too.
  assert.equal(r.direct[0].name, 'Breadbelly');
  assert.ok(r.places.some((p) => p.name === 'Safeway' && p.layers.includes('l4')));
  assert.ok(ctx.reqs.length <= CAP);

  // The pure splitter applies the same rule.
  const split = layerPlaces(r.places, conceptSearchProfile('egg_tart'));
  assert.deepEqual(names(split.direct), names(r.direct));
});

test('§4.2 先近后远: Layer 1 = 0 at 800 m but > 0 at 1600 m → the second radius is tried', async () => {
  const ctx = eggTartCtx([ARSICAULT, CINDERELLA, TARTINE, BOHO]);
  const r = await fetchThreeLayerCompetitors({ ...CLEMENT, conceptId: 'egg_tart' }, ctx);
  const direct = r.calls.filter((c) => c.layer === 'direct');
  assert.deepEqual(direct.map((c) => `${c.label}:${c.cache}:${c.results}`), ['direct@800:miss:0', 'direct@1600:miss:2']);
  assert.deepEqual(r.direct.map((p) => p.name).sort(), ['Arsicault Bakery', 'Cinderella Bakery & Cafe']);
  assert.deepEqual(r.l1_layers_tried, ['direct@800', 'direct@1600']);
});

test('§4.2 void: Layer 1 = 0 at both radii → both steps recorded, radius 1600, brand anchors still reported', async () => {
  const ctx = eggTartCtx([TARTINE, BOHO]);
  const r = await fetchThreeLayerCompetitors({ ...CLEMENT, conceptId: 'egg_tart' }, ctx);
  assert.equal(r.direct.length, 0);
  assert.deepEqual(r.l1_layers_tried, ['direct@800', 'direct@1600']);
  assert.equal(r.l1_search_radius_m, 1600);
  assert.deepEqual(r.brand_anchors.map((p) => p.name), ['Tartine Manufactory']);
  assert.equal(r.calls.filter((c) => c.layer === 'direct' && c.results === 0).length, 2);
});

test('§4.2 near radius already rich (≥ 5 hits) → the 1600 m step is skipped and not charged', async () => {
  const five = [BREADBELLY, SCHUBERTS, P('x1', 'Golden Gate Egg Tart', 37.7829, -122.4725, ['bakery'], 50), P('x2', 'Clement Bakery', 37.7825, -122.4712, ['bakery'], 60), P('x3', 'Tart House', 37.7831, -122.4732, ['cafe'], 70)];
  const ctx = eggTartCtx(five);
  const r = await fetchThreeLayerCompetitors({ ...CLEMENT, conceptId: 'egg_tart', walking: false }, ctx);
  const direct = r.calls.filter((c) => c.layer === 'direct');
  assert.deepEqual(direct.map((c) => `${c.label}:${c.cache}`), ['direct@800:miss', 'direct@1600:skipped']);
  assert.deepEqual(r.l1_layers_tried, ['direct@800']);
  assert.equal(r.l1_search_radius_m, 800);
  assert.equal(r.direct.length, 5);
  assert.equal(Object.keys(r.walk).length, 0, 'walking disabled');
});

test('§4.2 free-text concept the taxonomy does not know is searched verbatim', async () => {
  const ctx = ctxWith({ respond: () => new Response('{}', { status: 200 }) });
  const r = await fetchThreeLayerCompetitors({ ...CLEMENT, text: 'Ethiopian injera house' }, ctx);
  assert.equal(r.concept.resolved_by, 'verbatim');
  assert.equal(r.profile.origin, 'text');
  assert.equal(r.profile.query, 'Ethiopian injera house');
  assert.deepEqual(r.profile.types, ['restaurant']);
  assert.equal(ctx.reqs[0].body.textQuery, 'Ethiopian injera house');
  assert.equal(ctx.reqs[0].body.includedType, 'restaurant');
  // A free text the taxonomy does know resolves through the dictionary.
  const known = await fetchThreeLayerCompetitors({ ...CLEMENT, text: 'Italian trattoria' }, ctxWith({ respond: () => new Response('{}', { status: 200 }) }));
  assert.equal(known.concept.resolved_by, 'text');
  assert.equal(known.concept.id, 'italian');
});
