/**
 * Offline fixture router for end-to-end tests: one stub `fetch` (+ Supabase
 * `deps`) that answers every data module the way the live APIs would for the
 * Millbrae golden case. No network is ever used.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createFetchContext, createMemoryCache } from '@/lib/iq/data/context';
import { TIGERWEB_BG_LAYER, TIGERWEB_TRACT_LAYER } from '@/lib/iq/data/acs';
import type { OverturePoiRow } from '@/lib/iq/data/overture';
import type { LodesWacRow } from '@/lib/iq/data/lodes';
import type { SnapshotRow } from '@/lib/iq/data/traffic-proxy';
import type { FetchContext } from '@/lib/iq/data/types';
import type { BBox } from '@/lib/iq/geo';

const FIX = join(process.cwd(), 'qa', 'fixtures');
export const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIX, name), 'utf8'));
export const fixtureText = (name: string): string => readFileSync(join(FIX, name), 'utf8');

type Table = string[][];
const GEO_COLS = ['state', 'county', 'tract', 'block group'];

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

function select(table: Table, vars: string[]): Array<Array<string | null>> {
  const header = table[0];
  const geo = header.filter((h) => GEO_COLS.includes(h));
  const cols = [...vars, ...geo];
  const idx = cols.map((c) => header.indexOf(c));
  if (idx.some((i) => i < 0)) throw new Error(`fixture lacks ${cols.filter((_, i) => idx[i] < 0).join(',')}`);
  return [cols, ...table.slice(1).map((row) => idx.map((i) => row[i] ?? null))];
}

const json = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface RouterOptions {
  /** Simulate the R1 failure mode: Google returns an auth error and Overture is not loaded. */
  competitorsDown?: boolean;
  noMapbox?: boolean;
  env?: Record<string, string>;
}

export function createOfflineContext(opts: RouterOptions = {}) {
  const BG = wideTable(['acs_bg_06081_chunk1.json', 'acs_bg_06081_chunk2.json']);
  const COUNTY = fixture('acs_county_06081.json') as Table;
  const TRACT = fixture('acs_tract_b02018.json') as Table;
  const calls: string[] = [];
  const env: Record<string, string> = {
    GOOGLE_MAPS_API_KEY: 'AIza-test',
    MAPBOX_TOKEN: opts.noMapbox ? '' : 'pk.test',
    TAVILY_API_KEY: 'tvly-test',
    ...opts.env,
  };

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url.toString());
    const host = url.hostname;
    if (host === 'geocoding.geo.census.gov' && url.pathname.endsWith('/onelineaddress')) return json(fixture('census_geocoder_millbrae.json'));
    if (host === 'api.census.gov') {
      const year = Number(url.pathname.split('/')[2]);
      if (year !== 2023) return new Response(null, { status: 204 });
      const vars = (url.searchParams.get('get') ?? '').split(',');
      const forClause = url.searchParams.get('for') ?? '';
      if (forClause.startsWith('block group')) return json(select(BG, vars));
      if (forClause.startsWith('county')) return json(select(COUNTY, vars));
      if (forClause.startsWith('tract')) return json(select(TRACT, vars));
      return json('bad for clause', 400);
    }
    if (host === 'tigerweb.geo.census.gov') {
      const layer = Number(url.pathname.split('/').at(-2));
      if (layer === TIGERWEB_BG_LAYER) return json(fixture('tigerweb_bg_millbrae.geojson'));
      if (layer === TIGERWEB_TRACT_LAYER) return json({ type: 'FeatureCollection', features: [] });
    }
    if (host === 'api.mapbox.com') {
      if (url.pathname.includes('/walking/')) return json(fixture('mapbox_isochrone_walk.json'));
      if (url.pathname.includes('/driving/')) return json(fixture('mapbox_isochrone_drive.json'));
    }
    if (host === 'places.googleapis.com') {
      if (opts.competitorsDown) return json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Places API (New) has not been used in project 123' } }, 403);
      const body = JSON.parse(String(init?.body ?? '{}')) as { includedTypes?: string[] };
      const types = (body.includedTypes ?? []).join(',');
      if (types === 'chinese_restaurant') return json(fixture('google_places_nearby_chinese_1mi.json'));
      if (types === 'restaurant') return json(fixture('google_places_nearby_restaurant_1mi.json'));
      return json({});
    }
    if (host === 'api.tavily.com') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (/lease|\$\/SF|for lease/i.test(body.query ?? '')) return json(fixture('tavily_rent_search.json'));
      return json(fixture('tavily_dev_pipeline.json'));
    }
    if (host === 'caltrans-gis.dot.ca.gov') return json(fixture('caltrans_aadt_millbrae.json'));
    if (url.toString() === 'https://listings.example/1711-el-camino-real') return new Response(fixtureText('listing_page_sample.html'), { status: 200, headers: { 'content-type': 'text/html' } });
    return json({ error: `unrouted ${url}` }, 404);
  };

  const ctx: FetchContext = createFetchContext({
    fetch: fetchImpl as unknown as typeof fetch,
    cache: createMemoryCache(),
    cost: createCostLedger(),
    env: (n) => env[n] || null,
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
  });

  const overtureRows = fixture('overture_pois_millbrae.json') as OverturePoiRow[];
  const inBbox = (b: BBox, r: OverturePoiRow) => r.lat >= b.minLat && r.lat <= b.maxLat && r.lng >= b.minLng && r.lng <= b.maxLng;
  const deps = {
    poiQuery: async (bbox: BBox, metro: string) => (opts.competitorsDown ? [] : overtureRows.filter((x) => x.metro === metro && inBbox(bbox, x))),
    metroSummaryQuery: undefined as undefined,
    wacQuery: async (_tracts: string[], year: number) => (year === 2022 ? (fixture('lodes_wac_sample.json') as { rows: LodesWacRow[] }).rows : []),
    snapshotQuery: async (metro: string) => (fixture('poi_snapshots_sample.json') as Array<SnapshotRow & { metro: string }>).filter((s) => s.metro === metro),
  };
  return { ctx, calls, deps };
}
