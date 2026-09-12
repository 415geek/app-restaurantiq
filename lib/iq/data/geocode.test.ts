import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createFetchContext, createMemoryCache } from './context';
import {
  fetchGeocode,
  geographyFromGeoid,
  metroFor,
  normalizeAddress,
  parseCensusGeographies,
  zipFromAddress,
  GOOGLE_GEOCODE_COST_USD,
} from './geocode';

const FIXTURES = join(process.cwd(), 'qa', 'fixtures');
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const ADDRESS = '1711 El Camino Real, Millbrae, CA 94030';

type Route = (url: URL) => Response | null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stub fetch: first matching route wins; unmatched URLs return 404. Records every URL. */
function stubFetch(routes: Route[]) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url.toString());
    for (const r of routes) {
      const res = r(url);
      if (res) return res;
    }
    return jsonResponse({ error: 'unrouted' }, 404);
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

const censusOk: Route = (u) => (u.pathname.endsWith('/onelineaddress') ? jsonResponse(fixture('census_geocoder_millbrae.json')) : null);
const censusNoMatch: Route = (u) =>
  u.pathname.endsWith('/onelineaddress') ? jsonResponse({ result: { input: {}, addressMatches: [] } }) : null;
const censusDown: Route = (u) => (u.pathname.endsWith('/onelineaddress') ? jsonResponse('<html>503</html>', 503) : null);
const googleOk: Route = (u) => (u.hostname === 'maps.googleapis.com' ? jsonResponse(fixture('google_geocode_millbrae.json')) : null);
const googleZero: Route = (u) => (u.hostname === 'maps.googleapis.com' ? jsonResponse({ results: [], status: 'ZERO_RESULTS' }) : null);
const coordsOk: Route = (u) =>
  u.pathname.endsWith('/coordinates') ? jsonResponse(fixture('census_geocoder_coordinates_millbrae.json')) : null;
const coordsDown: Route = (u) => (u.pathname.endsWith('/coordinates') ? jsonResponse({}, 500) : null);
const fccOk: Route = (u) => (u.hostname === 'geo.fcc.gov' ? jsonResponse(fixture('fcc_area_millbrae.json')) : null);

function ctxWith(routes: Route[], env: Record<string, string> = {}) {
  const { fetch, calls } = stubFetch(routes);
  const cache = createMemoryCache();
  const cost = createCostLedger();
  const ctx = createFetchContext({
    fetch,
    cache,
    cost,
    env: (n) => env[n] ?? null,
    log: () => {},
    now: () => new Date('2026-09-12T00:00:00Z'),
  });
  return { ctx, calls, cache, cost };
}

test('D1 census success path → full geography, metro sf-bay, cached forever', async () => {
  const { ctx, calls, cache } = ctxWith([censusOk]);
  const r = await fetchGeocode({ address: ADDRESS }, ctx);
  assert.equal(r.status, 'ok');
  assert.equal(r.id, 'D1');
  assert.equal(r.cache, 'miss');
  assert.equal(r.cost_usd, 0);
  assert.ok(r.data);
  assert.equal(r.data.provider, 'census');
  assert.ok(Math.abs(r.data.lat - 37.5995) < 0.001);
  assert.ok(Math.abs(r.data.lng - -122.3895) < 0.001);
  assert.equal(r.data.matched_address, '1711 EL CAMINO REAL, MILLBRAE, CA, 94030');
  assert.deepEqual(r.data.geography, {
    block: '060816023001005',
    block_group: '060816023001',
    tract: '06081602300',
    county: '06081',
    state: '06',
    zcta: '94030',
    county_name: 'San Mateo County',
    state_abbr: 'CA',
  });
  assert.equal(r.data.metro, 'sf-bay');
  assert.match(r.coverage_note, /不按 ZIP 查询/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /benchmark=Public_AR_Current/);
  assert.match(calls[0], /layers=all/);
  assert.equal(cache.size(), 1);

  // second call: cache hit, no network
  const r2 = await fetchGeocode({ address: ' 1711 el camino real,  millbrae ca 94030 ' }, ctx);
  assert.equal(r2.cache, 'hit');
  assert.equal(calls.length, 1);
  assert.deepEqual(r2.data?.geography, r.data.geography);
});

test('D1 google fallback → cost 0.005, geography from Census coordinates endpoint', async () => {
  const { ctx, calls, cost } = ctxWith([censusNoMatch, googleOk, coordsOk], { GOOGLE_MAPS_API_KEY: 'test-key' });
  const r = await fetchGeocode({ address: ADDRESS }, ctx);
  assert.equal(r.status, 'ok');
  assert.ok(r.data);
  assert.equal(r.data.provider, 'google');
  assert.equal(r.degraded_from, 'census_geocoder');
  assert.equal(r.cost_usd, GOOGLE_GEOCODE_COST_USD);
  assert.equal(cost.total(), GOOGLE_GEOCODE_COST_USD);
  assert.equal(cost.bySource().D1, GOOGLE_GEOCODE_COST_USD);
  assert.equal(r.data.matched_address, '1711 El Camino Real, Millbrae, CA 94030, USA');
  assert.equal(r.data.geography.block, '060816023001005');
  assert.equal(r.data.geography.tract, '06081602300');
  assert.equal(r.data.geography.zcta, '94030'); // tolerant "Zip Code Tabulation Areas" key
  assert.equal(r.data.geography.state_abbr, 'CA');
  assert.equal(r.data.metro, 'sf-bay');
  assert.equal(calls.length, 3);
  assert.ok(calls.some((c) => c.includes('maps.googleapis.com') && c.includes('key=test-key')));
  assert.ok(calls.some((c) => c.includes('/coordinates?') && c.includes('x=-122.3894612') && c.includes('y=37.5994987')));
  assert.match(r.coverage_note, /Google Geocoding 回退/);
});

test('D1 google fallback → Census coordinates down → FCC block_fips', async () => {
  const { ctx, calls } = ctxWith([censusDown, googleOk, coordsDown, fccOk], { GOOGLE_MAPS_API_KEY: 'k' });
  const r = await fetchGeocode({ address: ADDRESS }, ctx);
  assert.equal(r.status, 'ok');
  assert.ok(r.data);
  assert.equal(r.data.provider, 'google');
  assert.equal(r.data.geography.block, '060816023001005');
  assert.equal(r.data.geography.block_group, '060816023001');
  assert.equal(r.data.geography.county, '06081');
  assert.equal(r.data.geography.county_name, 'San Mateo');
  assert.equal(r.data.geography.state_abbr, 'CA');
  assert.equal(r.data.geography.zcta, '94030'); // parsed from the address string
  assert.equal(calls.length, 4);
  assert.match(r.coverage_note, /FCC Area API/);
});

test('D1 both geocoders fail → status failed (no key: google skipped, cost 0)', async () => {
  const { ctx, calls, cost } = ctxWith([censusNoMatch]);
  const r = await fetchGeocode({ address: 'nowhere street 0, atlantis' }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(r.data, null);
  assert.equal(r.cost_usd, 0);
  assert.equal(cost.total(), 0);
  assert.match(r.coverage_note, /缺 GOOGLE_MAPS_API_KEY/);
  assert.match(r.coverage_note, /两路定位均失败/);
  assert.equal(calls.length, 1);
});

test('D1 both geocoders fail → status failed (google ZERO_RESULTS still billed)', async () => {
  const { ctx, cost } = ctxWith([censusDown, googleZero], { GOOGLE_MAPS_API_KEY: 'k' });
  const r = await fetchGeocode({ address: 'nowhere street 0, atlantis' }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(r.data, null);
  assert.equal(r.cost_usd, GOOGLE_GEOCODE_COST_USD);
  assert.equal(cost.total(), GOOGLE_GEOCODE_COST_USD);
  assert.match(r.coverage_note, /ZERO_RESULTS/);
  assert.ok(r.error);
});

test('D1 google ok but no GEOID from Census/FCC → failed (geography is mandatory)', async () => {
  const { ctx } = ctxWith([censusNoMatch, googleOk, coordsDown], { GOOGLE_MAPS_API_KEY: 'k' });
  const r = await fetchGeocode({ address: ADDRESS }, ctx);
  assert.equal(r.status, 'failed');
  assert.match(r.coverage_note, /无法解析 GEOID/);
});

test('D1 network errors never throw', async () => {
  const boom = async () => {
    throw new Error('ECONNRESET');
  };
  const ctx = createFetchContext({
    fetch: boom as unknown as typeof fetch,
    cache: createMemoryCache(),
    env: () => 'k',
    log: () => {},
  });
  const r = await fetchGeocode({ address: ADDRESS }, ctx);
  assert.equal(r.status, 'failed');
});

test('D1 helpers: normalize, zip, geoid derivation, tolerant ZCTA keys, metro bbox', () => {
  assert.equal(normalizeAddress(' 1711 El Camino Real,  Millbrae, CA 94030 '), '1711 el camino real millbrae ca 94030');
  assert.equal(zipFromAddress('1711 El Camino Real, Millbrae, CA 94030'), '94030');
  assert.equal(zipFromAddress('1711 El Camino Real, Millbrae, CA 94030-1234, USA'), '94030');
  assert.equal(zipFromAddress('1711 El Camino Real, Millbrae, CA'), null);

  const g = geographyFromGeoid('060816023001005');
  assert.equal(g?.block_group, '060816023001');
  assert.equal(geographyFromGeoid('06081602300')?.block, '');
  assert.equal(geographyFromGeoid('0608160230')?.tract, undefined);

  const parsed = parseCensusGeographies(
    {
      'Census Blocks': [{ GEOID: '060816023001005' }],
      'ZCTA5 2020': [{ GEOID: '94030' }],
      Counties: [{ BASENAME: 'San Mateo' }],
      States: [{ STUSAB: 'CA' }],
    },
    '',
  );
  assert.equal(parsed?.zcta, '94030');
  assert.equal(parsed?.county_name, 'San Mateo');
  const noZcta = parseCensusGeographies({ 'Census Block Groups': [{ GEOID: '060816023001' }] }, 'x, CA 94030');
  assert.equal(noZcta?.zcta, '94030');
  assert.equal(noZcta?.block, '');

  assert.equal(metroFor(37.5985, -122.3872), 'sf-bay');
  assert.equal(metroFor(34.05, -118.24), null);
});
