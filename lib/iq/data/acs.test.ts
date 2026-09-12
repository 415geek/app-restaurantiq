import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFetchContext, createMemoryCache } from './context';
import {
  ACS_BG_VAR_LIST,
  ACS_MAX_VARS_PER_CALL,
  TIGERWEB_BG_LAYER,
  TIGERWEB_TRACT_LAYER,
  chunkVars,
  fetchAcs,
  parseCensusValue,
  rowsFromCensusJson,
} from './acs';
import type { CensusGeography } from './types';

const FIXTURES = join(process.cwd(), 'qa', 'fixtures');
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

type Table = string[][];
const GEO_COLS = ['state', 'county', 'tract', 'block group'];

/** Join the two chunk fixtures by geography into one wide table. */
function wideTable(files: string[]): Table {
  const rows = new Map<string, Record<string, string | null>>();
  const header = new Set<string>();
  for (const f of files) {
    const t = fixture(f) as Array<Array<string | null>>;
    const h = t[0] as string[];
    h.forEach((k) => header.add(k));
    for (const cells of t.slice(1)) {
      const rec: Record<string, string | null> = {};
      h.forEach((k, i) => (rec[k] = cells[i] ?? null));
      const key = GEO_COLS.map((c) => rec[c] ?? '').join('|');
      rows.set(key, { ...(rows.get(key) ?? {}), ...rec });
    }
  }
  const cols = [...header].filter((c) => !GEO_COLS.includes(c)).concat(GEO_COLS.filter((c) => header.has(c)));
  return [cols, ...[...rows.values()].map((r) => cols.map((c) => r[c] as string))];
}

/** Select requested `get` columns (+ geo columns) out of a wide table, Census-style. */
function select(table: Table, vars: string[]): Array<Array<string | null>> {
  const header = table[0];
  const geo = header.filter((h) => GEO_COLS.includes(h));
  const cols = [...vars, ...geo];
  const idx = cols.map((c) => header.indexOf(c));
  if (idx.some((i) => i < 0)) throw new Error(`fixture lacks ${cols.filter((_, i) => idx[i] < 0).join(',')}`);
  return [cols, ...table.slice(1).map((row) => idx.map((i) => row[i] ?? null))];
}

const BG_TABLE = wideTable(['acs_bg_06081_chunk1.json', 'acs_bg_06081_chunk2.json']);
const COUNTY_TABLE = fixture('acs_county_06081.json') as Table;
const TRACT_B02018 = fixture('acs_tract_b02018.json') as Table;
const TRACT_B02015: Table = TRACT_B02018.map((row, i) => (i === 0 ? row.map((h) => h.replace('B02018', 'B02015')) : row));

interface StubOptions {
  years?: number[]; // years that have data (others → 204)
  rejectB02018?: boolean;
  rejectAllTracts?: boolean;
  tigerwebBgFail?: boolean;
  tigerwebTractFail?: boolean;
  noBgRows?: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function stub(o: StubOptions = {}) {
  const calls: URL[] = [];
  const years = o.years ?? [2023];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);
    if (url.hostname === 'api.census.gov') {
      const year = Number(url.pathname.split('/')[2]);
      if (!years.includes(year)) return new Response(null, { status: 204 });
      const vars = (url.searchParams.get('get') ?? '').split(',');
      const forClause = url.searchParams.get('for') ?? '';
      if (forClause.startsWith('block group')) {
        if (o.noBgRows) return new Response(null, { status: 204 });
        return jsonResponse(select(BG_TABLE, vars));
      }
      if (forClause.startsWith('county')) return jsonResponse(select(COUNTY_TABLE, vars));
      if (forClause.startsWith('tract')) {
        if (o.rejectAllTracts) return jsonResponse('error: unknown variable', 400);
        if (vars.some((v) => v.startsWith('B02018'))) {
          if (o.rejectB02018) return jsonResponse("error: error: unknown variable 'B02018_001E'", 400);
          return jsonResponse(select(TRACT_B02018, vars));
        }
        return jsonResponse(select(TRACT_B02015, vars));
      }
      return jsonResponse('bad for clause', 400);
    }
    if (url.hostname === 'tigerweb.geo.census.gov') {
      const layer = Number(url.pathname.split('/').at(-2));
      if (layer === TIGERWEB_BG_LAYER) {
        return o.tigerwebBgFail ? jsonResponse('Service Unavailable', 503) : jsonResponse(fixture('tigerweb_bg_millbrae.geojson'));
      }
      if (layer === TIGERWEB_TRACT_LAYER) {
        if (o.tigerwebTractFail) return jsonResponse({ error: { code: 500, message: 'Unable to complete operation.' } });
        return jsonResponse({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { GEOID: '06081602300' },
              geometry: { type: 'Polygon', coordinates: [[[-122.4, 37.59], [-122.38, 37.59], [-122.38, 37.61], [-122.4, 37.61], [-122.4, 37.59]]] },
            },
          ],
        });
      }
    }
    return jsonResponse({ error: 'unrouted' }, 404);
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

const GEO: CensusGeography = {
  block: '060816023001005',
  block_group: '060816023001',
  tract: '06081602300',
  county: '06081',
  state: '06',
  zcta: '94030',
  county_name: 'San Mateo County',
  state_abbr: 'CA',
};
const INPUT = { geography: GEO, lat: 37.5995, lng: -122.3895, radiusM: 1_500 };

function ctxWith(o: StubOptions = {}) {
  const s = stub(o);
  const cache = createMemoryCache();
  const ctx = createFetchContext({ fetch: s.fetch, cache, env: () => null, log: () => {}, now: () => new Date('2026-09-12T00:00:00Z') });
  return { ctx, calls: s.calls, cache };
}

test('D2 variable list is 44 vars, chunked ≤ 45 per call', () => {
  assert.equal(ACS_BG_VAR_LIST.length, 44);
  assert.equal(new Set(ACS_BG_VAR_LIST).size, 44);
  assert.ok(ACS_MAX_VARS_PER_CALL <= 45);
  assert.equal(chunkVars(ACS_BG_VAR_LIST).length, 1);
  assert.deepEqual(
    chunkVars(ACS_BG_VAR_LIST, 24).map((c) => c.length),
    [24, 20],
  );
});

test('D2 sentinel parsing: negatives and null → null, never 0', () => {
  assert.equal(parseCensusValue('-666666666'), null);
  assert.equal(parseCensusValue(-888888888), null);
  assert.equal(parseCensusValue(null), null);
  assert.equal(parseCensusValue(''), null);
  assert.equal(parseCensusValue('abc'), null);
  assert.equal(parseCensusValue('0'), 0);
  assert.equal(parseCensusValue('2.71'), 2.71);
  assert.equal(rowsFromCensusJson({ not: 'an array' }), null);
  assert.deepEqual(rowsFromCensusJson([['A', 'state'], ['1', '06']]), [{ A: '1', state: '06' }]);
});

test('D2 happy path (2023): BG + county + tract + geometry → ok; suppressed cells are null', async () => {
  const { ctx, calls, cache } = ctxWith();
  const r = await fetchAcs(INPUT, ctx, { maxVarsPerCall: 24 });
  assert.equal(r.status, 'ok', r.coverage_note);
  assert.equal(r.cache, 'miss');
  assert.equal(r.cost_usd, 0);
  assert.ok(r.data);
  const d = r.data;
  assert.equal(d.year, 2023);
  assert.equal(d.ancestry_table, 'B02018');
  assert.equal(d.block_groups.length, 5);
  assert.equal(d.tracts.length, 4);
  assert.deepEqual(d.coverage, { bg_with_geometry: 3, bg_total: 5, bg_in_bbox: 3, tract_with_geometry: 0 });
  assert.match(r.coverage_note, /不按 ZIP 查询/);
  assert.match(r.coverage_note, /tract 06081602300/);

  // never queried by ZIP; 2 BG chunks + 2 county chunks + 1 tract + 1 tigerweb
  const census = calls.filter((u) => u.hostname === 'api.census.gov');
  assert.equal(census.length, 5);
  assert.ok(census.every((u) => !/zip/i.test(u.search)));
  assert.equal(census.filter((u) => u.searchParams.get('for') === 'block group:*').length, 2);
  assert.equal(census.find((u) => u.searchParams.get('for') === 'block group:*')?.searchParams.get('in'), 'state:06 county:081 tract:*');
  assert.ok(census.every((u) => (u.searchParams.get('get') ?? '').split(',').length <= 45));
  const tiger = calls.filter((u) => u.hostname === 'tigerweb.geo.census.gov');
  assert.equal(tiger.length, 1);
  assert.equal(tiger[0].searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(tiger[0].searchParams.get('f'), 'geojson');
  assert.equal(tiger[0].searchParams.get('outFields'), 'GEOID');

  const bg1 = d.block_groups.find((b) => b.geoid === '060816023001');
  assert.ok(bg1);
  assert.equal(bg1.tract, '06081602300');
  assert.equal(bg1.pop, 1520);
  assert.equal(bg1.households, 560);
  assert.equal(bg1.median_income, 128500);
  assert.equal(bg1.income_dist.length, 16);
  assert.equal(bg1.income_dist.reduce<number>((s, v) => s + (v ?? 0), 0), 560);
  assert.equal(bg1.income_total, 560);
  assert.equal(bg1.age_25_44, 454);
  assert.equal(bg1.families_with_children, 150);
  assert.equal(bg1.families_total, 380);
  assert.equal(bg1.avg_hh_size, 2.71);
  assert.ok(Math.abs((bg1.renter_share ?? 0) - 230 / 560) < 1e-9);
  assert.deepEqual(bg1.commute, { transit: 160, walk: 35, drove_alone: 470, total: 780 });
  assert.equal(bg1.chinese_speakers, 610);
  assert.equal(bg1.pop5plus, 1440);
  assert.equal(bg1.median_rent, 2450);
  assert.equal(bg1.median_home_value, 1250000);
  // tract 602300 Chinese (1480 + 120) downscaled by BG pop share 1520 / 4610
  assert.ok(Math.abs((bg1.chinese_pop_est ?? 0) - (1600 * 1520) / 4610) < 1e-6);
  assert.equal(bg1.geometry?.type, 'Polygon');

  const bg3 = d.block_groups.find((b) => b.geoid === '060816023003');
  assert.equal(bg3?.median_home_value, null); // JSON null cell
  assert.equal(bg3?.geometry, null); // not in TIGERweb fixture

  const suppressed = d.block_groups.find((b) => b.geoid === '060816024001');
  assert.ok(suppressed);
  assert.equal(suppressed.pop, 45);
  assert.equal(suppressed.median_income, null);
  assert.equal(suppressed.avg_hh_size, null);
  assert.equal(suppressed.median_rent, null);
  assert.equal(suppressed.median_home_value, null);
  assert.notEqual(suppressed.median_income, 0);
  assert.equal(suppressed.chinese_pop_est, 5); // tract 602400: 5 + 0, single BG

  const t6021 = d.tracts.find((t) => t.geoid === '06081602100');
  assert.equal(t6021?.chinese_pop, null);
  assert.equal(t6021?.taiwanese_pop, null);
  const t6023 = d.tracts.find((t) => t.geoid === '06081602300');
  assert.equal(t6023?.chinese_pop, 1600);
  assert.equal(t6023?.taiwanese_pop, 120);

  assert.ok(d.county);
  assert.equal(d.county.geoid, '06081');
  assert.equal(d.county.pop, 764442);
  assert.equal(d.county.median_income, 149907);
  assert.equal(d.county.age_25_44, 226000);
  assert.equal(d.county.families_with_children, 76000);
  assert.equal(d.county.chinese_pop_est, 1600 + 420 + 5); // tract sum, null tract skipped
  assert.equal(d.county.income_dist.length, 16);

  // 3 cache lines: acs_bg, acs_tract, bg_geometry
  assert.equal(cache.size(), 3);

  // second call → all cache hits, zero network
  const before = calls.length;
  const r2 = await fetchAcs(INPUT, ctx, { maxVarsPerCall: 24 });
  assert.equal(r2.cache, 'hit');
  assert.equal(r2.status, 'ok');
  assert.equal(calls.length, before);
  assert.deepEqual(r2.data?.coverage, d.coverage);
});

test('D2 year fallback: 2023 empty (204) → 2022', async () => {
  const { ctx, calls } = ctxWith({ years: [2022] });
  const r = await fetchAcs(INPUT, ctx);
  assert.equal(r.status, 'ok', r.coverage_note);
  assert.equal(r.data?.year, 2022);
  assert.match(r.source, /2022/);
  const years = calls.filter((u) => u.hostname === 'api.census.gov').map((u) => u.pathname.split('/')[2]);
  assert.ok(years.includes('2023') && years.includes('2022'));
  // default chunk size → single BG call per year
  assert.equal(calls.filter((u) => u.searchParams.get('for') === 'block group:*').length, 2);
});

test('D2 partial when TIGERweb BG layer fails → tract geometries used, note says 圈层按质心归属', async () => {
  const { ctx } = ctxWith({ tigerwebBgFail: true });
  const r = await fetchAcs(INPUT, ctx);
  assert.equal(r.status, 'partial');
  assert.ok(r.data);
  assert.match(r.coverage_note, /无 block group 几何 → 圈层按质心归属/);
  assert.ok(r.data.block_groups.every((b) => b.geometry === null));
  assert.equal(r.data.coverage.bg_with_geometry, 0);
  assert.equal(r.data.coverage.tract_with_geometry, 1);
  assert.equal(r.data.tracts.find((t) => t.geoid === '06081602300')?.geometry?.type, 'Polygon');
  assert.equal(r.degraded_from, 'acs_bg_tract_geometry');
  // demographic data still intact
  assert.equal(r.data.block_groups.length, 5);
  assert.equal(r.data.county?.pop, 764442);
});

test('D2 partial when both TIGERweb layers fail', async () => {
  const { ctx } = ctxWith({ tigerwebBgFail: true, tigerwebTractFail: true });
  const r = await fetchAcs(INPUT, ctx);
  assert.equal(r.status, 'partial');
  assert.equal(r.data?.coverage.tract_with_geometry, 0);
  assert.match(r.coverage_note, /tract 几何亦不可用/);
});

test('D2 B02018 rejected → B02015 fallback, still ok', async () => {
  const { ctx, calls } = ctxWith({ rejectB02018: true });
  const r = await fetchAcs(INPUT, ctx);
  assert.equal(r.status, 'ok', r.coverage_note);
  assert.equal(r.data?.ancestry_table, 'B02015');
  assert.match(r.coverage_note, /B02015/);
  const tractCalls = calls.filter((u) => u.searchParams.get('for') === 'tract:*');
  assert.equal(tractCalls.length, 2);
  assert.equal(r.data?.tracts.find((t) => t.geoid === '06081602300')?.chinese_pop, 1600);
});

test('D2 partial when tract-level Chinese ancestry missing → chinese_pop_est null (not estimated)', async () => {
  const { ctx } = ctxWith({ rejectAllTracts: true });
  const r = await fetchAcs(INPUT, ctx);
  assert.equal(r.status, 'partial');
  assert.ok(r.data);
  assert.equal(r.data.ancestry_table, null);
  assert.equal(r.data.tracts.length, 0);
  assert.ok(r.data.block_groups.every((b) => b.chinese_pop_est === null));
  assert.equal(r.data.county?.chinese_pop_est, null);
  assert.match(r.coverage_note, /华裔祖源.*缺失/);
  // language proxy still there
  assert.equal(r.data.block_groups.find((b) => b.geoid === '060816023001')?.chinese_speakers, 610);
});

test('D2 failed when no BG rows in either year', async () => {
  const { ctx, calls } = ctxWith({ noBgRows: true });
  const r = await fetchAcs(INPUT, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(r.data, null);
  assert.match(r.coverage_note, /2023\/2022 均无 block group 行/);
  assert.match(r.coverage_note, /未按 ZIP 查询/);
  assert.equal(calls.filter((u) => u.hostname === 'tigerweb.geo.census.gov').length, 0);
});

test('D2 failed when D1 geography lacks tract/county (never falls back to ZIP)', async () => {
  const { ctx, calls } = ctxWith();
  const r = await fetchAcs({ ...INPUT, geography: { ...GEO, tract: '', county: '', state: '' } }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(calls.length, 0);
  assert.match(r.coverage_note, /不按 ZIP 查询/);
});

test('D2 never throws on network errors', async () => {
  const boom = async () => {
    throw new Error('ETIMEDOUT');
  };
  const ctx = createFetchContext({ fetch: boom as unknown as typeof fetch, cache: createMemoryCache(), env: () => null, log: () => {} });
  const r = await fetchAcs(INPUT, ctx);
  assert.equal(r.status, 'failed');
  assert.match(r.error ?? '', /ETIMEDOUT/);
});
