/**
 * D9 · Transit & traffic counts.
 *   rail: BART + Caltrain stations from lib/iq/params/bart_stations.json —
 *         everything within `walkRadiusM` (default 800 m) plus the nearest 3.
 *   aadt: Caltrans Traffic_AADT ArcGIS query (state highways only, CA only),
 *         2-mile radius, top 5 by AADT. Same query shape as
 *         lib/funnel/external-data/caltrans.ts but routed through ctx.fetch.
 *
 * BART ridership figures in the JSON are approximate FY2024 exits; Caltrain
 * has none → any station with null ridership makes the result `partial`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { roundCoord } from '@/lib/funnel/iq-market-cache';
import { haversineM, METERS_PER_MILE } from '@/lib/iq/geo';
import { fetchWithTimeout } from './context';
import type { DataResult, FetchContext } from './types';
import { DATA_SOURCE_NAMES, failed, nowIso } from './types';

export const TRANSIT_SOURCE_ID = 'D9' as const;
export const TRANSIT_LICENSE = 'BART / Caltrain open data (station list) · Caltrans Traffic Census (public)';
export const AADT_CACHE_TTL_S = 180 * 24 * 3600;
const AADT_CACHE_SOURCE = 'iq360_aadt';
const AADT_RADIUS_MI = 2;
const AADT_TOP_N = 5;
const NEAREST_N = 3;
export const DEFAULT_WALK_RADIUS_M = 800;
/** Station table only covers the Bay Area; beyond this the "nearest 3" are meaningless. */
const STATION_TABLE_MAX_M = 60_000;

export const CALTRANS_AADT_URL =
  'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0/query';

export type RailSystem = 'BART' | 'Caltrain' | 'Muni' | 'VTA';

export interface RailStation {
  system: RailSystem;
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
  /** true when within walkRadiusM */
  walkable: boolean;
  avg_weekday_exits: number | null;
  ridership_source: string | null;
}

export interface AadtSegment {
  route: string;
  route_name: string;
  aadt: number;
  year: number;
  distance_m: number;
}

export interface TransitData {
  rail_stations: RailStation[];
  aadt: AadtSegment[];
  aadt_source: 'caltrans' | 'none';
  walk_radius_m: number;
}

export interface TransitInput {
  lat: number;
  lng: number;
  stateAbbr: string | null;
  walkRadiusM?: number;
}

export interface StationRecord {
  system: RailSystem;
  name: string;
  lat: number;
  lng: number;
  avg_weekday_exits: number | null;
}

export interface TransitDeps {
  /** Injectable station table (tests). Default: lib/iq/params/bart_stations.json. */
  stations?: () => { ridership_source: string | null; stations: StationRecord[] };
}

const stationFileSchema = z.object({
  ridership_source: z.string().nullable(),
  stations: z.array(
    z.object({
      system: z.enum(['BART', 'Caltrain', 'Muni', 'VTA']),
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      avg_weekday_exits: z.number().nullable(),
    }),
  ),
});

let stationCache: z.infer<typeof stationFileSchema> | null = null;

export function loadStationTable(): { ridership_source: string | null; stations: StationRecord[] } {
  if (!stationCache) {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'lib', 'iq', 'params', 'bart_stations.json'), 'utf8'));
    stationCache = stationFileSchema.parse(raw);
  }
  return stationCache;
}

interface CaltransFeature {
  attributes: {
    ROUTE?: string | number;
    ROUTE_NAME?: string;
    COUNTY?: string;
    AADT?: number;
    PEAK_HR?: number;
    POSTMILE?: number;
    DATA_YEAR?: number;
  };
  geometry?: { x: number; y: number };
}

export function buildCaltransQueryUrl(lat: number, lng: number, radiusMiles = AADT_RADIUS_MI): string {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(radiusMiles * METERS_PER_MILE),
    units: 'esriSRUnit_Meter',
    outFields: 'ROUTE,ROUTE_NAME,COUNTY,AADT,PEAK_HR,POSTMILE,DATA_YEAR',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  return `${CALTRANS_AADT_URL}?${params}`;
}

/** Top-N segments by AADT with distance to the site; throws on transport / HTTP errors. */
async function queryCaltransAadt(site: { lat: number; lng: number }, ctx: FetchContext): Promise<AadtSegment[]> {
  const res = await fetchWithTimeout(ctx, buildCaltransQueryUrl(site.lat, site.lng), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeoutMs: 12_000,
  });
  if (!res.ok) throw new Error(`caltrans HTTP ${res.status}`);
  const raw = (await res.json()) as { features?: CaltransFeature[]; error?: { message?: string } };
  if (raw.error) throw new Error(`caltrans: ${raw.error.message ?? 'query error'}`);
  const segs: AadtSegment[] = [];
  for (const f of raw.features ?? []) {
    const a = f.attributes ?? {};
    const aadt = Number(a.AADT);
    if (!Number.isFinite(aadt) || aadt <= 0) continue;
    const route = String(a.ROUTE ?? '').trim();
    const distance = f.geometry ? Math.round(haversineM(site, { lat: f.geometry.y, lng: f.geometry.x })) : Number.NaN;
    segs.push({
      route,
      route_name: (a.ROUTE_NAME ?? '').trim() || (route ? `CA-${route}` : 'unknown'),
      aadt: Math.round(aadt),
      year: Number(a.DATA_YEAR) || 0,
      distance_m: Number.isFinite(distance) ? distance : -1,
    });
  }
  segs.sort((x, y) => y.aadt - x.aadt);
  return segs.slice(0, AADT_TOP_N);
}

export function rankStations(
  site: { lat: number; lng: number },
  table: { ridership_source: string | null; stations: StationRecord[] },
  walkRadiusM: number,
): RailStation[] {
  const ranked = table.stations
    .map((s) => {
      const d = Math.round(haversineM(site, s));
      return {
        system: s.system,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        distance_m: d,
        walkable: d <= walkRadiusM,
        avg_weekday_exits: s.avg_weekday_exits,
        ridership_source: s.avg_weekday_exits != null ? table.ridership_source : null,
      };
    })
    .filter((s) => s.distance_m <= STATION_TABLE_MAX_M)
    .sort((a, b) => a.distance_m - b.distance_m);
  const out: RailStation[] = [];
  for (const s of ranked) {
    if (s.walkable || out.length < NEAREST_N) out.push(s);
  }
  return out;
}

export async function fetchTransit(
  input: TransitInput,
  ctx: FetchContext,
  deps: TransitDeps = {},
): Promise<DataResult<TransitData>> {
  const started = Date.now();
  const walkRadiusM = input.walkRadiusM && input.walkRadiusM > 0 ? input.walkRadiusM : DEFAULT_WALK_RADIUS_M;
  const site = { lat: input.lat, lng: input.lng };
  const notes: string[] = [];
  const errors: string[] = [];
  let cache: DataResult<TransitData>['cache'] = 'none';

  // rail
  let rail: RailStation[] = [];
  let railThrew = false;
  try {
    const table = (deps.stations ?? loadStationTable)();
    rail = rankStations(site, table, walkRadiusM);
    const walkable = rail.filter((s) => s.walkable);
    if (rail.length === 0) notes.push('站点库仅覆盖湾区 BART/Caltrain，60 km 内无站点');
    else {
      notes.push(
        `步行 ${walkRadiusM} m 内 ${walkable.length} 站` +
          (walkable.length ? `（${walkable.map((s) => `${s.system} ${s.name} ${s.distance_m} m`).join('、')}）` : '') +
          `；最近站 ${rail[0].system} ${rail[0].name} ${rail[0].distance_m} m`,
      );
      if (rail.some((s) => s.avg_weekday_exits == null)) notes.push('部分站点无客流（Caltrain 未提供站点出站量）');
      if (rail.some((s) => s.avg_weekday_exits != null)) notes.push('BART 客流为 FY2024 近似值（±15%）');
    }
  } catch (e) {
    railThrew = true;
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`stations: ${msg}`);
    notes.push(`站点表加载失败（${msg.slice(0, 80)}）`);
  }

  // aadt
  let aadt: AadtSegment[] = [];
  let aadtSource: TransitData['aadt_source'] = 'none';
  let aadtThrew = false;
  const isCa = (input.stateAbbr ?? '').trim().toUpperCase() === 'CA';
  if (!isCa) {
    notes.push('非加州：AADT 未获取');
  } else {
    const cacheKey = `${roundCoord(input.lat)},${roundCoord(input.lng)}:r${AADT_RADIUS_MI}`;
    let hit: AadtSegment[] | null = null;
    try {
      hit = await ctx.cache.get<AadtSegment[]>(AADT_CACHE_SOURCE, cacheKey);
    } catch (e) {
      ctx.log('[transit] cache read failed', e);
    }
    if (hit) {
      aadt = hit;
      aadtSource = 'caltrans';
      cache = 'hit';
    } else {
      try {
        aadt = await queryCaltransAadt(site, ctx);
        aadtSource = 'caltrans';
        cache = 'miss';
        try {
          await ctx.cache.set(AADT_CACHE_SOURCE, cacheKey, aadt, AADT_CACHE_TTL_S);
        } catch (e) {
          ctx.log('[transit] cache write failed', e);
        }
      } catch (e) {
        aadtThrew = true;
        const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e);
        errors.push(`caltrans: ${msg}`);
        notes.push(`Caltrans AADT 查询失败（${msg.slice(0, 80)}）`);
      }
    }
    if (aadtSource === 'caltrans') {
      notes.push(
        aadt.length
          ? `Caltrans AADT 2 mi 内 ${aadt.length} 段（仅州道/高速，不含市政道路）：${aadt.map((a) => `${a.route_name} ${a.aadt.toLocaleString()}/日 ${a.distance_m} m`).join('、')}`
          : 'Caltrans AADT 2 mi 内无州道计数点（市政道路无 AADT）',
      );
    }
  }

  if (railThrew && (aadtThrew || !isCa)) {
    return failed<TransitData>(TRANSIT_SOURCE_ID, ctx, {
      source: 'BART/Caltrain station table + Caltrans AADT',
      license: TRANSIT_LICENSE,
      note: notes.join('；'),
      error: errors.join(' | '),
    });
  }

  const hasAny = rail.length > 0 || aadt.length > 0;
  const ridershipMissing = rail.some((s) => s.avg_weekday_exits == null);
  const status: DataResult<TransitData>['status'] = !hasAny || ridershipMissing || aadtThrew || railThrew ? 'partial' : 'ok';
  return {
    id: TRANSIT_SOURCE_ID,
    name: DATA_SOURCE_NAMES.D9,
    status,
    data: { rail_stations: rail, aadt, aadt_source: aadtSource, walk_radius_m: walkRadiusM },
    source: `BART/Caltrain station table (lib/iq/params/bart_stations.json)${aadtSource === 'caltrans' ? ' + Caltrans Traffic_AADT (ArcGIS)' : ''}`,
    fetched_at: nowIso(ctx),
    license: TRANSIT_LICENSE,
    cost_usd: 0,
    coverage_note: notes.join('；'),
    cache,
    error: errors.length ? errors.join(' | ') : undefined,
    elapsed_ms: Date.now() - started,
  };
}
