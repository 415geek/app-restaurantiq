/**
 * Block-group / tract boundary mirror.
 *
 * D2 attaches geometry to its ACS rows by querying TIGERweb's ArcGIS endpoint
 * per report. That endpoint is a single point of failure outside our control:
 * when it is unreachable the ACS rows still arrive but cannot be allocated to
 * any ring, so the trade area has no population and demand coverage and
 * audience fit both fall back to a neutral 50 — a report that looks complete
 * and has no demographics behind it.
 *
 * Census boundaries change once a year. Fetching them per report was always the
 * wrong shape; this reads them from our own mirror instead, and falls back to
 * live TIGERweb when no mirror is configured or the file is missing.
 *
 * The mirror is a flat set of files, one per county per layer:
 *
 *   {IQ_GEOMETRY_MIRROR_URL}/bg/06075.json
 *   {IQ_GEOMETRY_MIRROR_URL}/tract/06075.json
 *
 * built by `scripts/build-geometry-mirror.ts` on a machine that can reach
 * TIGERweb, and hostable anywhere that serves static files over HTTPS
 * (Supabase Storage, R2, a GitHub release). Each file is fetched once per
 * county and cached, so every later report in that county is a cache hit.
 */
import { fetchWithTimeout } from './context';
import type { FetchContext, Geometry } from './types';

export type MirrorLayer = 'bg' | 'tract';

export interface MirrorFeature {
  geoid: string;
  geometry: Geometry;
}

export interface MirrorFile {
  /** Vintage of the boundaries, e.g. 2023 — printed in the sources table. */
  year: number;
  layer: MirrorLayer;
  /** 5-digit state+county FIPS. */
  county: string;
  features: MirrorFeature[];
}

const CACHE_SOURCE = 'iq360_geometry_mirror';
/** Boundaries are annual; a month of caching is conservative. */
const CACHE_TTL_S = 30 * 24 * 3600;
const TIMEOUT_MS = 20_000;

export function mirrorBaseUrl(ctx: Pick<FetchContext, 'env'>): string | null {
  const raw = ctx.env('IQ_GEOMETRY_MIRROR_URL');
  return raw ? raw.replace(/\/+$/, '') : null;
}

export function mirrorFileUrl(base: string, layer: MirrorLayer, county: string): string {
  return `${base}/${layer}/${county}.json`;
}

function isFeature(v: unknown): v is MirrorFeature {
  if (typeof v !== 'object' || v === null) return false;
  const geoid = (v as { geoid?: unknown }).geoid;
  const g = (v as { geometry?: unknown }).geometry;
  if (typeof geoid !== 'string' || typeof g !== 'object' || g === null) return false;
  const t = (g as { type?: unknown }).type;
  return (t === 'Polygon' || t === 'MultiPolygon') && Array.isArray((g as { coordinates?: unknown }).coordinates);
}

/** Validate a mirror payload without trusting its shape — a bad file must degrade, not throw. */
export function parseMirrorFile(json: unknown, layer: MirrorLayer, county: string): MirrorFile | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.features)) return null;
  const features = o.features.filter(isFeature);
  if (!features.length) return null;
  return {
    year: typeof o.year === 'number' ? o.year : 0,
    layer: o.layer === 'bg' || o.layer === 'tract' ? o.layer : layer,
    county: typeof o.county === 'string' ? o.county : county,
    features,
  };
}

export interface MirrorResult {
  file: MirrorFile | null;
  cache: 'hit' | 'miss' | 'off';
  error: string | null;
}

/**
 * Read one county's boundaries from the mirror. Returns `{file: null}` — never
 * throws — when no mirror is configured or the county is not in it, so the
 * caller falls through to TIGERweb exactly as before.
 */
export async function fetchMirrorGeometry(ctx: FetchContext, layer: MirrorLayer, county: string): Promise<MirrorResult> {
  const base = mirrorBaseUrl(ctx);
  if (!base) return { file: null, cache: 'off', error: null };
  if (!/^\d{5}$/.test(county)) return { file: null, cache: 'off', error: `bad county fips ${county}` };

  const key = `${layer}:${county}`;
  const cached = await ctx.cache.get<MirrorFile>(CACHE_SOURCE, key);
  if (cached && Array.isArray(cached.features) && cached.features.length) return { file: cached, cache: 'hit', error: null };

  const url = mirrorFileUrl(base, layer, county);
  try {
    const res = await fetchWithTimeout(ctx, url, { timeoutMs: Math.min(TIMEOUT_MS, ctx.budgetMs) });
    if (!res.ok) {
      // 404 is the ordinary "this county is not mirrored yet" case, not a fault.
      return { file: null, cache: 'miss', error: res.status === 404 ? null : `HTTP ${res.status}` };
    }
    const parsed = parseMirrorFile(await res.json().catch(() => null), layer, county);
    if (!parsed) return { file: null, cache: 'miss', error: 'unparseable mirror file' };
    await ctx.cache.set(CACHE_SOURCE, key, parsed, CACHE_TTL_S);
    return { file: parsed, cache: 'miss', error: null };
  } catch (err) {
    return { file: null, cache: 'miss', error: err instanceof Error ? err.message : String(err) };
  }
}
