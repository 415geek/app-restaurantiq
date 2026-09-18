import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCostLedger, createMemoryCache } from '@/lib/iq/data/context';
import type { FetchContext } from '@/lib/iq/data/types';
import { haversineM } from '@/lib/iq/geo';
import { duplicatesGoogle, gatherIqMarketDataFromGoogle, supplementaryLayer, type GoogleCompetitorRow } from './iq-market-data';
import { conceptSearchProfile } from '@/lib/iq/data/search-profile';

const CLEMENT = { lat: 37.7827, lng: -122.472 };
type Raw = { id: string; displayName: { text: string }; formattedAddress: string; location: { latitude: number; longitude: number }; primaryType: string; types: string[]; rating: number; userRatingCount: number; businessStatus: string };
const P = (id: string, name: string, lat: number, lng: number, types: string[], count: number): Raw => ({
  id,
  displayName: { text: name },
  formattedAddress: `${name} St, San Francisco, CA`,
  location: { latitude: lat, longitude: lng },
  primaryType: types[0],
  types,
  rating: 4.5,
  userRatingCount: count,
  businessStatus: 'OPERATIONAL',
});
const BREADBELLY = P('bb', 'Breadbelly', 37.7827, -122.4738, ['bakery', 'cafe'], 900);
const SCHUBERTS = P('sc', "Schubert's Bakery", 37.783, -122.4645, ['bakery'], 1500);
const ARSICAULT = P('ar', 'Arsicault Bakery', 37.7833, -122.459, ['bakery'], 2100);
const CINDERELLA = P('ci', 'Cinderella Bakery & Cafe', 37.7766, -122.4636, ['bakery', 'cafe'], 1300);
const TARTINE = P('ta', 'Tartine Manufactory', 37.7614, -122.4116, ['bakery', 'cafe'], 3000);
const BOHO = P('bo', 'Boho Bakery', 37.8005, -122.437, ['bakery'], 400);
const TOYBOAT = P('tb', 'Toy Boat Dessert Cafe', 37.7833, -122.468, ['dessert_shop', 'cafe'], 700);
const POOL = [BREADBELLY, SCHUBERTS, ARSICAULT, CINDERELLA, TARTINE, BOHO];

function ctx(): FetchContext & { urls: string[] } {
  const urls: string[] = [];
  const stub: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
      return new Response(
        JSON.stringify({
          status: 'OK',
          results: [{ formatted_address: '1115 Clement St, San Francisco, CA 94118, USA', geometry: { location: CLEMENT }, place_id: 'ChIJ-site', address_components: [{ long_name: 'San Francisco', types: ['locality'] }, { short_name: 'CA', types: ['administrative_area_level_1'] }] }],
        }),
        { status: 200 },
      );
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as { includedTypes?: string[]; locationRestriction?: { rectangle?: { low: { latitude: number }; high: { latitude: number } } } }) : {};
    if (url.endsWith(':searchText')) {
      const rect = body.locationRestriction?.rectangle;
      const r = rect ? ((rect.high.latitude - rect.low.latitude) / 2) * 111_320 : Infinity;
      return new Response(JSON.stringify({ places: POOL.filter((p) => haversineM(CLEMENT, { lat: p.location.latitude, lng: p.location.longitude }) <= r) }), { status: 200 });
    }
    if (url.endsWith(':searchNearby')) {
      const types = body.includedTypes ?? [];
      if (types.includes('dessert_shop') || types.includes('bakery')) return new Response(JSON.stringify({ places: [TOYBOAT, BREADBELLY] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }
    if (url.includes('/distancematrix/')) {
      const n = (new URL(url).searchParams.get('destinations') ?? '').split('|').length;
      const elements = Array.from({ length: n }, (_, i) => ({ status: 'OK', distance: { value: 600 + i * 100 }, duration: { value: 450 + i * 75 } }));
      return new Response(JSON.stringify({ status: 'OK', rows: [{ elements }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return {
    fetch: stub,
    cost: createCostLedger(),
    cache: createMemoryCache(),
    env: (n) => (n === 'GOOGLE_MAPS_API_KEY' ? 'AIza-test' : null),
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
    urls,
  };
}

test('tier 2 market data (§4.2): three-layer Google plan replaces the metro-wide Text Search; counts exclude brand anchors', async () => {
  const c = ctx();
  const md = await gatherIqMarketDataFromGoogle({ location: '1115 Clement St, San Francisco, CA', businessType: 'egg tart bakery', ctx: c });
  assert.ok(md, 'market data');
  const summary = md!.summary as Record<string, unknown>;
  const geocode = md!.geocode as { lat: number; lng: number; city?: string; state?: string };
  assert.equal(geocode.city, 'San Francisco');
  assert.equal(geocode.state, 'CA');
  // No legacy "<cuisine> restaurant near <address>" call; every Places request is a restricted / biased (New) search around the geocode.
  assert.ok(!c.urls.some((u) => u.includes('/maps/api/place/textsearch')));
  assert.ok(c.urls.some((u) => u.endsWith(':searchText')) && c.urls.some((u) => u.endsWith(':searchNearby')));
  assert.equal(summary.competitor_count_google, 5, 'Layer 1 (4) + Layer 2 (Toy Boat); Tartine / Boho never counted');
  assert.deepEqual(summary.competitor_layers, { direct: 4, substitute: 1, brand_anchor: 5 });
  const sample = summary.sample_competitors_google as Array<{ name: string; layer: string; walk_min: number | null; distance_m: number; place_id: string }>;
  assert.deepEqual(sample.slice(0, 4).map((r) => r.layer), ['direct', 'direct', 'direct', 'direct']);
  assert.equal(sample[4].layer, 'substitute');
  assert.ok(sample.every((r) => r.walk_min != null && r.distance_m <= 1600 && r.place_id));
  assert.ok(!sample.some((r) => r.name.startsWith('Tartine') || r.name.startsWith('Boho')));
  const anchors = summary.sample_brand_anchors_google as Array<{ name: string; layer: string }>;
  assert.equal(anchors[0].name, 'Tartine Manufactory');
  assert.ok(anchors.every((a) => a.layer === 'brand_anchor'));
  // §3.2: the label carries the alias that was searched, so both radii are
  // present once per alias — assert the radii, which is what the void guard reads.
  assert.deepEqual([...new Set((summary.l1_layers_tried as string[]).map((l) => l.split(':')[0]))], ['direct@800', 'direct@1600']);
  assert.equal(summary.places_status, 'OK');
  assert.equal((summary.concept as { id: string }).id, 'egg_tart');
  // Legacy readers still find the rows under google_raw.textsearch.results, now tagged.
  const raw = (md!.google_raw as { textsearch: { results: GoogleCompetitorRow[] } }).textsearch.results;
  assert.equal(raw.length, 5);
  assert.ok(raw.every((r) => r.layer === 'direct' || r.layer === 'substitute'));
});

test('tier 2: Yelp / Foursquare rows are deduped against Google by name + ≤ 150 m and tagged with a layer', () => {
  const google: GoogleCompetitorRow[] = [
    { name: 'Breadbelly', layer: 'direct', distance_m: 160, walk_m: null, walk_min: null, geometry: { location: { lat: 37.7827, lng: -122.4738 } } },
    { name: 'Tartine Manufactory', layer: 'brand_anchor', distance_m: 5800, walk_m: null, walk_min: null, geometry: { location: { lat: 37.7614, lng: -122.4116 } } },
  ];
  assert.ok(duplicatesGoogle({ name: 'Breadbelly SF', lat: 37.7828, lng: -122.4739 }, google), 'same name, 15 m away');
  assert.equal(duplicatesGoogle({ name: 'Breadbelly', lat: 37.79, lng: -122.4739 }, google), null, 'same name but 800 m away');
  assert.ok(duplicatesGoogle({ name: 'Tartine Manufactory', lat: null, lng: null }, google), 'exact name without coordinates');
  const p = conceptSearchProfile('egg_tart');
  assert.equal(supplementaryLayer({ name: 'Golden Gate Egg Tart', categories: ['Bakeries'] }, p), 'direct');
  assert.equal(supplementaryLayer({ name: 'Sweet Spot', categories: ['Desserts'] }, p), 'substitute');
  assert.equal(supplementaryLayer({ name: 'Burma Superstar', categories: ['Burmese'] }, p), 'other');
});
