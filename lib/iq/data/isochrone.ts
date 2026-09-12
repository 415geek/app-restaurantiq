/**
 * D4 · Isochrones (walk 10 / drive 5 · 10 · 15).
 *
 * Primary: Mapbox Isochrone API (two calls — one walking, one driving with three
 * contours). Free-tier so cost is recorded as $0 with a note. Cached 90 days by
 * 100 m grid cell (gridKey100m) because the same site is replayed many times.
 *
 * Fallback (no token / HTTP error / malformed polygon): straight-line circles
 * from defaults.yaml `rings[*].fallback_radius_mi`. Any fallback ring flips the
 * result to `partial` with `degraded_from: 'mapbox'` and a `[直线半径]` note so
 * the report never presents a circle as a drive-time polygon.
 */
import { circlePolygon, gridKey100m, METERS_PER_MILE } from '@/lib/iq/geo';
import { getDefaults } from '@/lib/iq/params';
import { fetchWithTimeout } from './context';
import {
  DATA_SOURCE_NAMES,
  nowIso,
  type DataResult,
  type FetchContext,
  type Geometry,
  type LatLng,
  type Position,
} from './types';

export type RingId = 'walk10' | 'drive5' | 'drive10' | 'drive15';
export const RING_IDS: RingId[] = ['walk10', 'drive5', 'drive10', 'drive15'];

export interface IsochroneRing {
  geometry: Geometry;
  method: 'mapbox' | 'radius';
  minutes: number;
  /** Only set for `method: 'radius'`. */
  radius_mi?: number;
}

export interface IsochroneData {
  rings: Record<RingId, IsochroneRing>;
  provider: 'mapbox' | 'radius' | 'mixed';
}

const SOURCE_ID = 'D4' as const;
const CACHE_SOURCE = 'iq360_isochrone';
const CACHE_TTL_S = 90 * 24 * 3600;
const MAPBOX_BASE = 'https://api.mapbox.com/isochrone/v1/mapbox';
const LICENSE = 'Mapbox Terms of Service (isochrone geometry; free tier)';

interface MapboxFeature {
  type?: string;
  properties?: { contour?: number | string } & Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}
interface MapboxFeatureCollection {
  type?: string;
  features?: MapboxFeature[];
  message?: string;
}

/** Ensure every ring is closed and has ≥ 4 positions; returns null for junk. */
export function normalizeGeometry(raw: unknown): Geometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { type?: string; coordinates?: unknown };
  const fixRing = (ring: unknown): Position[] | null => {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const out: Position[] = [];
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) return null;
      const lng = Number(p[0]);
      const lat = Number(p[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      out.push([lng, lat]);
    }
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
    return out.length >= 4 ? out : null;
  };
  const fixPolygon = (poly: unknown): Position[][] | null => {
    if (!Array.isArray(poly) || poly.length === 0) return null;
    const rings: Position[][] = [];
    for (const r of poly) {
      const fixed = fixRing(r);
      if (!fixed) return null;
      rings.push(fixed);
    }
    return rings;
  };
  if (g.type === 'Polygon') {
    const rings = fixPolygon(g.coordinates);
    return rings ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (g.type === 'MultiPolygon') {
    if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return null;
    const polys: Position[][][] = [];
    for (const p of g.coordinates) {
      const fixed = fixPolygon(p);
      if (!fixed) return null;
      polys.push(fixed);
    }
    return { type: 'MultiPolygon', coordinates: polys };
  }
  return null;
}

function parseContours(fc: MapboxFeatureCollection): Map<number, Geometry> {
  const out = new Map<number, Geometry>();
  for (const f of fc.features ?? []) {
    const minutes = Number(f.properties?.contour);
    if (!Number.isFinite(minutes)) continue;
    const geom = normalizeGeometry(f.geometry);
    if (geom) out.set(minutes, geom);
  }
  return out;
}

function radiusRing(center: LatLng, ringId: RingId): IsochroneRing {
  const def = getDefaults().rings[ringId];
  return {
    geometry: circlePolygon(center, def.fallback_radius_mi * METERS_PER_MILE, 64),
    method: 'radius',
    minutes: def.minutes,
    radius_mi: def.fallback_radius_mi,
  };
}

async function callMapbox(
  ctx: FetchContext,
  profile: 'walking' | 'driving',
  center: LatLng,
  minutes: number[],
  token: string,
): Promise<{ contours: Map<number, Geometry> } | { error: string }> {
  const url =
    `${MAPBOX_BASE}/${profile}/${center.lng.toFixed(6)},${center.lat.toFixed(6)}` +
    `?contours_minutes=${minutes.join(',')}&polygons=true&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetchWithTimeout(ctx, url, { timeoutMs: Math.min(12_000, ctx.budgetMs) });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as MapboxFeatureCollection;
        if (body?.message) msg += ` ${body.message}`;
      } catch {
        /* body not JSON */
      }
      return { error: `${profile}: ${msg}` };
    }
    const body = (await res.json()) as MapboxFeatureCollection;
    const contours = parseContours(body);
    if (contours.size === 0) return { error: `${profile}: 响应无有效 polygon` };
    return { contours };
  } catch (err) {
    const name = err instanceof Error && err.name === 'AbortError' ? 'timeout' : String((err as Error)?.message ?? err);
    return { error: `${profile}: ${name}` };
  }
}

export async function fetchIsochrones(input: LatLng, ctx: FetchContext): Promise<DataResult<IsochroneData>> {
  const t0 = Date.now();
  const center = { lat: input.lat, lng: input.lng };
  const key = gridKey100m(center);
  const fetched_at = nowIso(ctx);
  const base = { id: SOURCE_ID, name: DATA_SOURCE_NAMES[SOURCE_ID], license: LICENSE, fetched_at };

  const cached = await ctx.cache.get<IsochroneData>(CACHE_SOURCE, key);
  if (cached && cached.rings && RING_IDS.every((r) => cached.rings[r]?.geometry)) {
    return {
      ...base,
      status: 'ok',
      data: cached,
      source: 'Mapbox Isochrone API v1 (cached ≤ 90 d)',
      cost_usd: 0,
      coverage_note: '等时圈来自 Mapbox（缓存命中，100 m 网格）。',
      cache: 'hit',
      elapsed_ms: Date.now() - t0,
    };
  }

  const token = ctx.env('MAPBOX_TOKEN');
  const errors: string[] = [];
  const mapboxRings: Partial<Record<RingId, IsochroneRing>> = {};

  if (!token) {
    errors.push('MAPBOX_TOKEN 未设置');
  } else {
    const defs = getDefaults().rings;
    const [walk, drive] = await Promise.all([
      callMapbox(ctx, 'walking', center, [defs.walk10.minutes], token),
      callMapbox(ctx, 'driving', center, [defs.drive5.minutes, defs.drive10.minutes, defs.drive15.minutes], token),
    ]);
    ctx.cost.add(SOURCE_ID, 0, 'Mapbox Isochrone ×2 · 免费额度内（100k req/月）');
    if ('error' in walk) errors.push(walk.error);
    else {
      const g = walk.contours.get(defs.walk10.minutes);
      if (g) mapboxRings.walk10 = { geometry: g, method: 'mapbox', minutes: defs.walk10.minutes };
      else errors.push(`walking: 缺少 ${defs.walk10.minutes} 分钟 contour`);
    }
    if ('error' in drive) errors.push(drive.error);
    else {
      for (const r of ['drive5', 'drive10', 'drive15'] as const) {
        const g = drive.contours.get(defs[r].minutes);
        if (g) mapboxRings[r] = { geometry: g, method: 'mapbox', minutes: defs[r].minutes };
        else errors.push(`driving: 缺少 ${defs[r].minutes} 分钟 contour`);
      }
    }
  }

  const rings = {} as Record<RingId, IsochroneRing>;
  const fallbackIds: RingId[] = [];
  for (const r of RING_IDS) {
    const mb = mapboxRings[r];
    if (mb) rings[r] = mb;
    else {
      rings[r] = radiusRing(center, r);
      fallbackIds.push(r);
    }
  }

  const allMapbox = fallbackIds.length === 0;
  const provider: IsochroneData['provider'] = allMapbox ? 'mapbox' : fallbackIds.length === RING_IDS.length ? 'radius' : 'mixed';
  const data: IsochroneData = { rings, provider };

  if (allMapbox) {
    await ctx.cache.set(CACHE_SOURCE, key, data, CACHE_TTL_S);
    return {
      ...base,
      status: 'ok',
      data,
      source: 'Mapbox Isochrone API v1 (walking 10 · driving 5/10/15)',
      cost_usd: 0,
      coverage_note: '等时圈来自 Mapbox 路网（步行 10 分钟；驾车 5/10/15 分钟）。',
      cache: 'miss',
      elapsed_ms: Date.now() - t0,
    };
  }

  const fbDesc = fallbackIds
    .map((r) => `${r}=${rings[r].radius_mi} mi`)
    .join('、');
  const why = errors.length ? errors.join('；') : '未知原因';
  return {
    ...base,
    status: 'partial',
    data,
    source: allMapbox
      ? 'Mapbox Isochrone API v1'
      : provider === 'radius'
        ? '直线半径（defaults.yaml rings.fallback_radius_mi）'
        : 'Mapbox Isochrone API v1 + 直线半径回退',
    cost_usd: 0,
    coverage_note: `[直线半径] ${fallbackIds.length}/${RING_IDS.length} 个圈层以直线半径替代等时圈（${fbDesc}）；原因：${why}。覆盖人口/竞品数按圆形估算，非路网可达范围。`,
    cache: 'none',
    degraded_from: 'mapbox',
    error: why,
    elapsed_ms: Date.now() - t0,
  };
}
