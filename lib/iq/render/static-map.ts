/**
 * Google Maps Static API basemap for the /print report (page 3 hero + cover
 * thumbnail).
 *
 * ToS note: Google map data may only be drawn on a Google map, so the raster
 * basemap comes from the Static Maps API and OUR layers (isochrone rings,
 * competitors, anchors, site) are drawn by Google on top of it via `path=` /
 * `markers=` parameters. The API key stays server-side: `resolveStaticMap`
 * fetches the PNG and returns a `data:` URL, so the key never reaches the
 * rendered HTML/PDF.
 *
 * Sizes: the Static Maps API caps `size` at 640×640 (per side) and `scale=2`
 * doubles the delivered pixels — the hero preset therefore requests
 * 600×360 @ scale 2 = a 1200×720 px image.
 */
import type { Geometry, LatLng, Position } from '../data/types';
import { areaM2, polygonsOf } from '../geo';
import type { Competitor, ReportModel, RingId } from '../model/schema';

export const STATIC_MAP_ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';
/** Google's hard cap per side for `size=` (scale multiplies delivered pixels). */
export const STATIC_MAP_MAX_SIDE = 640;
export const STATIC_MAP_MAX_URL = 8000;
export const STATIC_MAP_MAX_RING_VERTICES = 40;
export const STATIC_MAP_FETCH_TIMEOUT_MS = 8_000;
export const STATIC_MAP_CACHE_TTL_MS = 10 * 60_000;

export const L1_MARKER_CAP = 8;
export const L2_MARKER_CAP = 20;
export const L4_MARKER_CAP = 8;
export const RAIL_MARKER_CAP = 6;

/** Marker colours (24-bit, no alpha) — the legend in map.tsx mirrors these. */
export const MARKER_COLOR = {
  site: '0xFF6B35',
  l1: '0x1B2A4F',
  l2: '0x8A94A6',
  l4: '0x1F8A5B',
  rail: '0x1B2A4F',
} as const;

/** Ring fill/stroke as 32-bit 0xRRGGBBAA (navy; fill 8–12 %, stroke ~50 %). Drawn largest first. */
export const RING_PATH_STYLE: Record<RingId, { fill: string; stroke: string; weight: number }> = {
  drive15: { fill: '0x1B2A4F14', stroke: '0x1B2A4F66', weight: 1 },
  drive10: { fill: '0x1B2A4F14', stroke: '0x1B2A4F80', weight: 1 },
  drive5: { fill: '0x1B2A4F1A', stroke: '0x1B2A4F80', weight: 2 },
  walk10: { fill: '0x1B2A4F1F', stroke: '0x1B2A4F99', weight: 2 },
};
export const RING_DRAW_ORDER: RingId[] = ['drive15', 'drive10', 'drive5', 'walk10'];

/** Light, muted roadmap so the navy/coral layers stand out. POI pins off, transit simplified. */
export const STATIC_MAP_STYLES: string[] = [
  'feature:poi|visibility:off',
  'feature:poi.park|element:geometry|visibility:on|color:0xe4ede3',
  'feature:transit|visibility:simplified',
  'feature:landscape|element:geometry|color:0xf5f6f8',
  'feature:water|element:geometry|color:0xd4e1ec',
  'feature:administrative|element:labels.text.fill|color:0x4a5568',
  'feature:road|element:geometry.fill|color:0xffffff',
  'feature:road|element:geometry.stroke|color:0xdfe3e8',
  'feature:road.highway|element:geometry.fill|color:0xf1e8d6',
  'feature:road.highway|element:geometry.stroke|color:0xe3d7bd',
  'feature:road|element:labels.text.fill|color:0x6b7280',
];

export type StaticMapVariant = 'hero' | 'thumb';

export interface StaticMapSize {
  width: number;
  height: number;
  scale: 1 | 2;
}

/** hero → 1200×720 px delivered (600×360 @2); thumb → 1280×720 px (640×360 @2, crisp in print). */
export const STATIC_MAP_PRESETS: Record<StaticMapVariant, StaticMapSize> = {
  hero: { width: 600, height: 360, scale: 2 },
  thumb: { width: 640, height: 360, scale: 2 },
};

export interface ResolvedStaticMap {
  /** `data:image/png;base64,…` — safe to inline into the HTML/PDF. */
  dataUrl: string;
  /** e.g. "Map data ©2026 Google" (the image also carries Google's own logo/copyright). */
  attribution: string;
}

/** Prop shape `ReportDocument` accepts (`staticMaps?: StaticMaps`). */
export interface StaticMaps {
  hero: ResolvedStaticMap | null;
  thumb: ResolvedStaticMap | null;
}

/* ------------------------------------------------------------------ */
/* Encoded polyline (https://developers.google.com/maps/documentation/utilities/polylinealgorithm) */
/* ------------------------------------------------------------------ */

function encodeSigned(v: number, out: string[]): void {
  let n = v < 0 ? ~(v << 1) : v << 1;
  while (n >= 0x20) {
    out.push(String.fromCharCode((0x20 | (n & 0x1f)) + 63));
    n >>= 5;
  }
  out.push(String.fromCharCode(n + 63));
}

/** Google encoded polyline of [lat, lng] points (1e-5 precision). */
export function encodePolyline(points: ReadonlyArray<readonly [number, number]>): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lng * 1e5);
    encodeSigned(la - prevLat, out);
    encodeSigned(lo - prevLng, out);
    prevLat = la;
    prevLng = lo;
  }
  return out.join('');
}

/** Inverse of encodePolyline → [lat, lng] points. */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += readValue();
    lng += readValue();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/* ------------------------------------------------------------------ */
/* Layer planning                                                        */
/* ------------------------------------------------------------------ */

/** Outer ring of the largest polygon of a (Multi)Polygon, as [lng, lat]. */
export function outerRingOf(geom: Geometry): Position[] {
  let best: Position[] = [];
  let bestArea = -1;
  for (const poly of polygonsOf(geom)) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const a = areaM2({ type: 'Polygon', coordinates: [outer] });
    if (a > bestArea) {
      bestArea = a;
      best = outer;
    }
  }
  return best;
}

/**
 * Evenly downsample a closed ring to at most `max` vertices (closing vertex
 * included). Returns [lat, lng] pairs ready for encodePolyline.
 */
export function downsampleRing(ring: Position[], max = STATIC_MAP_MAX_RING_VERTICES): Array<[number, number]> {
  if (ring.length === 0) return [];
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring;
  const budget = Math.max(3, max - 1); // leave room for the closing vertex
  const step = open.length > budget ? open.length / budget : 1;
  const picked: Array<[number, number]> = [];
  for (let i = 0; i < open.length && picked.length < budget; i += step) {
    const [lng, lat] = open[Math.floor(i)];
    picked.push([lat, lng]);
  }
  if (picked.length >= 2) picked.push(picked[0]);
  return picked;
}

export interface PlannedMarker {
  lat: number;
  lng: number;
  label?: string;
  name?: string;
}

export interface StaticMapPlan {
  rings: Array<{ id: RingId; points: Array<[number, number]> }>;
  site: PlannedMarker;
  l1: PlannedMarker[];
  l2: PlannedMarker[];
  l4: PlannedMarker[];
  rail: PlannedMarker[];
}

/** Same ordering page 7 uses for its numbered cards (Huff share desc, then distance asc). */
export function rankedL1(model: ReportModel): Competitor[] {
  return [...model.competitors.l1].sort((a, b) => (b.huff_share ?? 0) - (a.huff_share ?? 0) || a.distance_mi - b.distance_mi);
}

function finiteLatLng(o: unknown): LatLng | null {
  if (!o || typeof o !== 'object') return null;
  const { lat, lng } = o as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const isRail = (system: string) => !/bus|shuttle/i.test(system);

/** Rail stations with coordinates (access.transit carries distance only today → usually empty). */
export function railStations(model: ReportModel): PlannedMarker[] {
  const out: PlannedMarker[] = [];
  for (const t of model.access.transit) {
    if (!isRail(t.system)) continue;
    const p = finiteLatLng(t);
    if (p) out.push({ ...p, name: `${t.system} ${t.name}` });
  }
  return out;
}

const toMarker = (c: Competitor): PlannedMarker | null => {
  const p = finiteLatLng(c);
  return p ? { ...p, name: c.name_zh ?? c.name } : null;
};

export function planStaticMap(model: ReportModel, opts: { ringVertices?: number } = {}): StaticMapPlan {
  const byId = new Map(model.trade_area.rings.map((r) => [r.id, r] as const));
  const rings: StaticMapPlan['rings'] = [];
  for (const id of RING_DRAW_ORDER) {
    const r = byId.get(id);
    if (!r) continue;
    const pts = downsampleRing(outerRingOf(r.geometry), opts.ringVertices);
    if (pts.length >= 4) rings.push({ id, points: pts });
  }
  // Label = page-7 rank (index + 1), so a competitor without coordinates leaves its number unused rather than renumbering.
  const l1: PlannedMarker[] = [];
  rankedL1(model)
    .slice(0, L1_MARKER_CAP)
    .forEach((c, i) => {
      const m = toMarker(c);
      if (m) l1.push({ ...m, label: String(i + 1) });
    });
  const l2 = model.competitors.l2.map(toMarker).filter((m): m is PlannedMarker => m !== null).slice(0, L2_MARKER_CAP);
  const l4 = model.competitors.l4.map(toMarker).filter((m): m is PlannedMarker => m !== null).slice(0, L4_MARKER_CAP);
  const rail = railStations(model).slice(0, RAIL_MARKER_CAP);
  return { rings, site: { lat: model.input.lat, lng: model.input.lng, label: 'S' }, l1, l2, l4, rail };
}

/* ------------------------------------------------------------------ */
/* URL                                                                   */
/* ------------------------------------------------------------------ */

export interface StaticMapUrlOptions {
  width: number;
  height: number;
  scale?: 1 | 2;
  key: string;
  lang: 'zh' | 'en';
  /** Total URL length budget (default 8000). Layers are dropped L2 → rail → L4 → coarser rings → drive15 until it fits. */
  maxUrlLength?: number;
}

const fmt = (n: number) => n.toFixed(5).replace(/\.?0+$/, '');
const latLng = (m: PlannedMarker) => `${fmt(m.lat)},${fmt(m.lng)}`;

/** Percent-encode a parameter value, keeping `:` and `,` readable (both are query-safe); `|` becomes %7C as Google documents. */
function encodeValue(v: string): string {
  return encodeURIComponent(v).replace(/%3A/gi, ':').replace(/%2C/gi, ',');
}

/** Clamp to Google's 640 px per side, preserving aspect. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const k = Math.min(1, STATIC_MAP_MAX_SIDE / w, STATIC_MAP_MAX_SIDE / h);
  return { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)) };
}

interface Assembly {
  plan: StaticMapPlan;
  includeL2: boolean;
  includeRail: boolean;
  includeL4: boolean;
  includeDrive15: boolean;
}

function assemble(a: Assembly, opts: StaticMapUrlOptions): string {
  const { width, height } = clampSize(opts.width, opts.height);
  const params: string[] = [];
  const add = (k: string, v: string) => params.push(`${k}=${encodeValue(v)}`);
  add('size', `${width}x${height}`);
  add('scale', String(opts.scale ?? 1));
  add('maptype', 'roadmap');
  add('format', 'png');
  add('language', opts.lang === 'zh' ? 'zh-CN' : 'en');
  for (const s of STATIC_MAP_STYLES) add('style', s);
  // Paths: largest ring first so the smaller ones paint on top (no center/zoom → Google fits to these).
  for (const r of a.plan.rings) {
    if (r.id === 'drive15' && !a.includeDrive15) continue;
    const st = RING_PATH_STYLE[r.id];
    add('path', `fillcolor:${st.fill}|color:${st.stroke}|weight:${st.weight}|enc:${encodePolyline(r.points)}`);
  }
  if (a.includeL2 && a.plan.l2.length) add('markers', `size:small|color:${MARKER_COLOR.l2}|${a.plan.l2.map(latLng).join('|')}`);
  if (a.includeL4 && a.plan.l4.length) add('markers', `size:small|color:${MARKER_COLOR.l4}|${a.plan.l4.map(latLng).join('|')}`);
  if (a.includeRail && a.plan.rail.length) add('markers', `size:tiny|color:${MARKER_COLOR.rail}|${a.plan.rail.map(latLng).join('|')}`);
  for (const m of a.plan.l1) add('markers', `color:${MARKER_COLOR.l1}|label:${m.label}|${latLng(m)}`);
  add('markers', `color:${MARKER_COLOR.site}|label:S|${latLng(a.plan.site)}`);
  add('key', opts.key);
  return `${STATIC_MAP_ENDPOINT}?${params.join('&')}`;
}

/**
 * Static Maps URL: muted roadmap, the four isochrone rings as encoded-polyline
 * paths (largest first), site `S` in coral, L1 numbered 1..8 in navy (page-7
 * order), L2 small grey, L4 small green, rail tiny navy. Auto-fit (no
 * center/zoom). Layers are shed (L2 first) to stay under `maxUrlLength`.
 */
export function buildStaticMapUrl(model: ReportModel, opts: StaticMapUrlOptions): string {
  const max = opts.maxUrlLength ?? STATIC_MAP_MAX_URL;
  const full = planStaticMap(model);
  const steps: Array<Partial<Assembly> & { ringVertices?: number }> = [
    {},
    { includeL2: false },
    { includeL2: false, includeRail: false },
    { includeL2: false, includeRail: false, includeL4: false },
    { includeL2: false, includeRail: false, includeL4: false, ringVertices: 24 },
    { includeL2: false, includeRail: false, includeL4: false, ringVertices: 24, includeDrive15: false },
    { includeL2: false, includeRail: false, includeL4: false, ringVertices: 12, includeDrive15: false },
  ];
  let url = '';
  for (const step of steps) {
    const plan = step.ringVertices ? planStaticMap(model, { ringVertices: step.ringVertices }) : full;
    url = assemble({ plan, includeL2: true, includeRail: true, includeL4: true, includeDrive15: true, ...step }, opts);
    if (url.length <= max) return url;
  }
  return url; // last resort: minimal layers even if still over budget (Google's own cap is 16 384)
}

/* ------------------------------------------------------------------ */
/* Server-side resolution → data URL                                     */
/* ------------------------------------------------------------------ */

export interface ResolveStaticMapOptions {
  width: number;
  height: number;
  scale?: 1 | 2;
  lang: 'zh' | 'en';
  /** Test hooks. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface CacheEntry {
  value: ResolvedStaticMap;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = 64;

export function clearStaticMapCache(): void {
  cache.clear();
}

const redact = (url: string) => url.replace(/([?&]key=)[^&]*/, '$1***');

/**
 * Fetches the Static Maps PNG with the server-side key and returns it as a
 * data URL (+ attribution). null when the key is missing, the request fails,
 * times out (8 s) or the body is not an image. Cached per URL for 10 min.
 */
export async function resolveStaticMap(model: ReportModel, opts: ResolveStaticMapOptions): Promise<ResolvedStaticMap | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return null;
  const now = opts.now ?? Date.now;
  const url = buildStaticMapUrl(model, { width: opts.width, height: opts.height, scale: opts.scale, key, lang: opts.lang });

  const hit = cache.get(url);
  if (hit && hit.expires > now()) return hit.value;
  if (hit) cache.delete(url);

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? STATIC_MAP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (res.status !== 200) {
      console.warn(`[static-map] HTTP ${res.status} for ${redact(url)}`);
      return null;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) {
      console.warn(`[static-map] non-image response (${type || 'no content-type'}) for ${redact(url)}`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    const value: ResolvedStaticMap = {
      dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
      attribution: `Map data ©${new Date(now()).getUTCFullYear()} Google`,
    };
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(url, { value, expires: now() + STATIC_MAP_CACHE_TTL_MS });
    return value;
  } catch (err) {
    console.warn(`[static-map] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Both report sizes in parallel; each is null independently when unavailable. */
export async function resolveStaticMaps(model: ReportModel, opts: { lang?: 'zh' | 'en'; fetchImpl?: typeof fetch } = {}): Promise<StaticMaps> {
  const lang = opts.lang ?? model.meta.language ?? 'zh';
  const [hero, thumb] = await Promise.all([
    resolveStaticMap(model, { ...STATIC_MAP_PRESETS.hero, lang, fetchImpl: opts.fetchImpl }),
    resolveStaticMap(model, { ...STATIC_MAP_PRESETS.thumb, lang, fetchImpl: opts.fetchImpl }),
  ]);
  return { hero, thumb };
}
