import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { buildCaltransQueryUrl, fetchTransit, loadStationTable, rankStations } from './transit';
import type { FetchContext } from './types';

const caltransFixture = readFileSync(join(process.cwd(), 'qa', 'fixtures', 'caltrans_aadt_millbrae.json'), 'utf8');

function makeCtx(mode: 'ok' | 'throw' | 'http500' = 'ok') {
  const calls: string[] = [];
  const ctx: FetchContext = {
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (!url.startsWith('https://caltrans-gis.dot.ca.gov/')) throw new Error(`unexpected fetch ${url}`);
      if (mode === 'throw') throw new Error('socket hang up');
      if (mode === 'http500') return new Response('boom', { status: 500 });
      return new Response(caltransFixture, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
    cost: createCostLedger(),
    cache: createMemoryCache(),
    env: () => null,
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
  };
  return { ctx, calls };
}

const millbrae = { lat: 37.6005, lng: -122.387, stateAbbr: 'CA' };

test('D9 station table loads: 50 BART + 30 Caltrain, BART ridership marked approximate', () => {
  const t = loadStationTable();
  assert.equal(t.stations.filter((s) => s.system === 'BART').length, 50);
  assert.equal(t.stations.filter((s) => s.system === 'Caltrain').length, 30);
  assert.ok(t.stations.filter((s) => s.system === 'BART').every((s) => s.avg_weekday_exits != null));
  assert.ok(t.stations.filter((s) => s.system === 'Caltrain').every((s) => s.avg_weekday_exits == null));
  assert.match(t.ridership_source ?? '', /FY2024/);
});

test('D9 transit: Millbrae → walkable BART + Caltrain, nearest 3, AADT top 5 by volume', async () => {
  const { ctx, calls } = makeCtx();
  const r = await fetchTransit(millbrae, ctx);
  assert.equal(r.id, 'D9');
  assert.ok(r.data);
  assert.equal(r.data.walk_radius_m, 800);

  const rail = r.data.rail_stations;
  assert.equal(rail.length, 3, 'two walkable + nearest fill to 3');
  assert.equal(rail[0].name, 'Millbrae');
  assert.ok(rail[0].distance_m < 100);
  const walkable = rail.filter((s) => s.walkable);
  assert.deepEqual(walkable.map((s) => s.system).sort(), ['BART', 'Caltrain']);
  const bart = rail.find((s) => s.system === 'BART' && s.name === 'Millbrae');
  assert.equal(bart?.avg_weekday_exits, 2600);
  assert.match(bart?.ridership_source ?? '', /BART FY2024/);
  const caltrain = rail.find((s) => s.system === 'Caltrain');
  assert.equal(caltrain?.avg_weekday_exits, null);
  assert.equal(caltrain?.ridership_source, null);
  assert.ok(!rail[2].walkable && rail[2].distance_m > 800, 'third is the non-walkable nearest fill');
  for (let i = 1; i < rail.length; i++) assert.ok(rail[i].distance_m >= rail[i - 1].distance_m);

  assert.equal(r.data.aadt_source, 'caltrans');
  assert.equal(r.data.aadt.length, 5);
  assert.deepEqual(
    r.data.aadt.map((a) => a.aadt),
    [231000, 218000, 126000, 98000, 34500],
  );
  assert.equal(r.data.aadt[0].route_name, 'US-101');
  assert.equal(r.data.aadt[0].year, 2022);
  assert.ok(r.data.aadt.every((a) => a.distance_m > 0 && a.distance_m < 2 * 1609.344 + 500));
  const ecr = r.data.aadt.find((a) => a.route === '82');
  assert.ok(ecr && ecr.distance_m < 200, 'El Camino Real segment is right at the site');

  assert.equal(r.status, 'partial', 'Caltrain ridership null → partial');
  assert.match(r.coverage_note, /步行 800 m 内 2 站/);
  assert.match(r.coverage_note, /Caltrans AADT 2 mi 内 5 段/);
  assert.equal(calls.length, 1);
  assert.equal(r.cache, 'miss');

  const r2 = await fetchTransit(millbrae, ctx);
  assert.equal(r2.cache, 'hit');
  assert.equal(calls.length, 1, 'AADT served from cache');
});

test('D9 transit: all-BART walkable set → ok when every station has ridership', async () => {
  const { ctx } = makeCtx();
  const r = await fetchTransit(millbrae, ctx, {
    stations: () => ({
      ridership_source: 'test',
      stations: [
        { system: 'BART', name: 'A', lat: 37.6005, lng: -122.387, avg_weekday_exits: 100 },
        { system: 'BART', name: 'B', lat: 37.62, lng: -122.39, avg_weekday_exits: 200 },
      ],
    }),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.data?.rail_stations.length, 2);
});

test('D9 transit: non-CA → aadt [] with note, no Caltrans call', async () => {
  const { ctx, calls } = makeCtx();
  const r = await fetchTransit({ lat: 40.7128, lng: -74.006, stateAbbr: 'NY' }, ctx);
  assert.equal(r.status, 'partial');
  assert.deepEqual(r.data?.aadt, []);
  assert.equal(r.data?.aadt_source, 'none');
  assert.deepEqual(r.data?.rail_stations, [], 'Bay Area station table is not applied 4,000 km away');
  assert.match(r.coverage_note, /非加州：AADT 未获取/);
  assert.match(r.coverage_note, /仅覆盖湾区/);
  assert.equal(calls.length, 0);
});

test('D9 transit: Caltrans failure → partial with rail intact, never throws', async () => {
  const { ctx } = makeCtx('throw');
  const r = await fetchTransit(millbrae, ctx);
  assert.equal(r.status, 'partial');
  assert.equal(r.data?.rail_stations.length, 3);
  assert.deepEqual(r.data?.aadt, []);
  assert.equal(r.data?.aadt_source, 'none');
  assert.match(r.error ?? '', /caltrans: socket hang up/);

  const { ctx: ctx500 } = makeCtx('http500');
  const r500 = await fetchTransit(millbrae, ctx500);
  assert.equal(r500.status, 'partial');
  assert.match(r500.error ?? '', /HTTP 500/);
});

test('D9 transit: station table failure everywhere → failed', async () => {
  const { ctx } = makeCtx('throw');
  const r = await fetchTransit(millbrae, ctx, {
    stations: () => {
      throw new Error('bad json');
    },
  });
  assert.equal(r.status, 'failed');
  assert.equal(r.data, null);
  assert.match(r.error ?? '', /stations: bad json/);
});

test('D9 helpers: rankStations respects custom walk radius; Caltrans URL mirrors legacy query', () => {
  const table = loadStationTable();
  const wide = rankStations(millbrae, table, 3000);
  assert.ok(wide.filter((s) => s.walkable).length >= 4, 'SFO + Broadway join within 3 km');
  const url = new URL(buildCaltransQueryUrl(37.6, -122.39));
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryPoint');
  assert.equal(url.searchParams.get('units'), 'esriSRUnit_Meter');
  assert.equal(url.searchParams.get('distance'), String(2 * 1609.344));
  assert.equal(url.searchParams.get('f'), 'json');
});
