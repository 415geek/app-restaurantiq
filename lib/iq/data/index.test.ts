import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCostLedger, createMemoryCache } from './context';
import { buildGooglePlacesRequest, fetchAllData, KNOWN_COMPETITOR_MAX_CALLS, type Fetchers } from './index';
import { buildCallPlan, type GooglePlacesInput } from './google-places';
import { normalizeUserInputs } from './user-inputs';
import { getDefaults } from '@/lib/iq/params';
import { failed, type DataResult, type DataSourceId, type FetchContext } from './types';
import type { GeocodeData } from './geocode';

const CAP = getDefaults().data_budget.google_places_max_calls;

function ctx(): FetchContext {
  return {
    fetch: async () => new Response('{}', { status: 200 }),
    cost: createCostLedger(),
    cache: createMemoryCache(),
    env: () => null,
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
  };
}

const GEO: GeocodeData = {
  lat: 37.5985,
  lng: -122.3872,
  matched_address: '1711 El Camino Real, Millbrae, CA 94030',
  geography: { block: '060816023001001', block_group: '060816023001', tract: '06081602300', county: '06081', state: '06', zcta: '94030', county_name: 'San Mateo', state_abbr: 'CA' },
  metro: 'sf-bay',
  provider: 'census',
};

function ok<T>(id: DataSourceId, data: T, c: FetchContext): DataResult<T> {
  return { id, name: id, status: 'ok', data, source: 'stub', fetched_at: c.now().toISOString(), license: '', cost_usd: 0, coverage_note: 'stub', cache: 'none' };
}
const down = (id: DataSourceId) => async (_i: unknown, c: FetchContext) => failed<never>(id, c, { source: 'stub', license: '', note: 'stub down' });

/** Every fetcher stubbed; the Google one records what the orchestrator asked for. */
function stubFetchers(seen: GooglePlacesInput[]): Partial<Fetchers> {
  return {
    geocode: async (_i, c) => ok('D1', GEO, c),
    acs: down('D2') as Fetchers['acs'],
    lodes: down('D3') as Fetchers['lodes'],
    isochrones: down('D4') as Fetchers['isochrones'],
    overture: down('D5') as Fetchers['overture'],
    google: async (i, c) => {
      seen.push(i);
      return ok('D6', { places: [], calls_made: 0, api_status: 'ok' as const, calls: [], l1_search_radius_m: null, l1_layers_tried: [] }, c);
    },
    traffic: down('D7') as Fetchers['traffic'],
    rent: down('D8') as Fetchers['rent'],
    transit: down('D9') as Fetchers['transit'],
    cex: down('D10') as Fetchers['cex'],
    dev: down('D11') as Fetchers['dev'],
  };
}

test('D6 request: no known competitors → historical request (yaml cap, no explicit plan)', () => {
  const req = buildGooglePlacesRequest({ cuisine: 'hunan', known_competitors: [] }, 1, 2);
  assert.deepEqual(req, { lat: 1, lng: 2, cuisineId: 'hunan', maxCalls: CAP });
});

test('D6 request: known competitors append ≤ 3 Text Searches and raise the cap by exactly that many', () => {
  const two = buildGooglePlacesRequest({ cuisine: 'sichuan', known_competitors: ['Hunan Home Kitchen', '湘水缘'] }, 1, 2);
  assert.equal(two.maxCalls, CAP + 2);
  assert.equal(two.plan!.length, CAP + 2);
  assert.deepEqual(two.plan!.slice(0, CAP), buildCallPlan('sichuan'));
  assert.deepEqual(two.plan![CAP], { includedTypes: ['restaurant'], radiusM: 8047, label: 'text:user:Hunan Home Kitchen', textQuery: 'Hunan Home Kitchen', layer: 'user' });
  assert.deepEqual(two.plan![CAP + 1], { includedTypes: ['restaurant'], radiusM: 8047, label: 'text:user:湘水缘', textQuery: '湘水缘', layer: 'user' });

  const five = buildGooglePlacesRequest({ cuisine: 'hunan', known_competitors: ['a', 'b', 'c', 'd', 'e'] }, 1, 2);
  assert.equal(KNOWN_COMPETITOR_MAX_CALLS, 3);
  assert.equal(five.maxCalls, CAP + 3);
  assert.equal(five.plan!.length, CAP + 3);
  assert.deepEqual(five.plan!.slice(CAP).map((p) => p.textQuery), ['a', 'b', 'c']);
  assert.ok(five.plan!.slice(CAP).every((p) => p.label.startsWith('text:user:')));
});

test('fetchAllData passes the raised plan / cap to the Google fetcher (stubbed, offline)', async () => {
  const c = ctx();
  const seen: GooglePlacesInput[] = [];
  const { input, result } = normalizeUserInputs({ report_id: 'r', address: '1711 El Camino Real, Millbrae, CA 94030', cuisine: 'hunan', known_competitors: 'Hunan Home Kitchen, 湘水缘, Golden Dragon, Fourth Place' });
  const bundle = await fetchAllData(input, result, c, stubFetchers(seen));
  assert.equal(bundle.fatal, null);
  assert.equal(seen.length, 1);
  const req = seen[0];
  assert.equal(req.cuisineId, 'hunan');
  assert.equal(req.lat, GEO.lat);
  assert.equal(req.maxCalls, CAP + 3, 'defaults + min(known, 3)');
  assert.equal(req.plan!.length, CAP + 3);
  assert.deepEqual(
    req.plan!.filter((p) => p.label.startsWith('text:user:')).map((p) => p.textQuery),
    ['Hunan Home Kitchen', '湘水缘', 'Golden Dragon'],
  );
  assert.ok(req.plan!.slice(CAP).every((p) => p.radiusM === 8047 && p.includedTypes.length === 1 && p.includedTypes[0] === 'restaurant'));
  assert.equal(bundle.google?.status, 'ok');

  // Without known competitors the request is unchanged.
  const seen2: GooglePlacesInput[] = [];
  const plain = normalizeUserInputs({ report_id: 'r', address: 'x', cuisine: 'hunan' });
  await fetchAllData(plain.input, plain.result, c, stubFetchers(seen2));
  assert.deepEqual(seen2[0], { lat: GEO.lat, lng: GEO.lng, cuisineId: 'hunan', maxCalls: CAP });
});
