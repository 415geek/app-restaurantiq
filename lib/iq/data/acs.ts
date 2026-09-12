/**
 * D2 · Census ACS 5-year — block group + tract for the site's whole county,
 * plus block-group geometries from TIGERweb for isochrone ⟂ BG weighting.
 *
 * Geography always comes from D1 (tract / block group GEOIDs). ACS is never
 * queried by ZIP: ZIP-as-terminal-state was the root cause of audit R2
 * ("ACS for ZIP 94030 无法解析"), so the only `for=` clauses used here are
 * `block group:*`, `tract:*` and `county:CCC`.
 *
 * Variable notes (verify against api.census.gov/data/2023/acs/acs5/variables.json):
 *   B01003_001E  total population
 *   B11001_001E  households
 *   B19013_001E  median household income
 *   B19001_001E..017E  household income distribution (001 = total, 002..017 = 16 buckets <$10k … $200k+)
 *   B01001_001E  sex-by-age total; 011..014 male 25–44; 035..038 female 25–44
 *   B25010_001E  average household size (occupied units)
 *   B11003_001E  families total; 003 / 010 / 016 = with own children <18 for
 *                married-couple / male householder / female householder families
 *   B08301_001E  workers 16+; 003 drove alone; 010 public transportation; 019 walked
 *   B25064_001E  median gross rent;  B25077_001E median home value
 *   B25003_001E  occupied units;     B25003_003E renter-occupied
 *   C16001_001E  population 5+ (language universe); C16001_021E Chinese (incl. Mandarin, Cantonese)
 *                → `p_cn` proxy. Household-language table B16002 stopped breaking out Chinese
 *                after 2016 (collapsed to "Asian and Pacific Island languages"), so the
 *                population-5+ speaker share from C16001 is used instead.
 *   B02018_001E / 007E / 020E  Asian alone or in any combination: total / Chinese (except
 *                Taiwanese) / Taiwanese — tract level only (not published for BGs). Tract Chinese
 *                population is downscaled to block groups by BG population share within the tract.
 *                Fallback B02015 (Asian alone) uses the same line numbers.
 *
 * Sentinel values (-666666666 not available, -888888888 suppressed, -999999999 N/A,
 * -222222222 / -333333333 / -555555555 special) and nulls parse to `null`, never 0.
 */
import { bboxAround, type BBox } from '@/lib/iq/geo';
import { fetchWithTimeout } from './context';
import {
  DATA_SOURCE_NAMES,
  failed,
  nowIso,
  type CensusGeography,
  type DataResult,
  type DataStatus,
  type FetchContext,
  type Geometry,
} from './types';

export const ACS_YEARS = [2023, 2022] as const;
/** Census API hard limit is 50 variables per call; keep headroom for geo columns. */
export const ACS_MAX_VARS_PER_CALL = 45;
/** 12 months — ACS vintages are annual. */
export const ACS_CACHE_TTL_S = 365 * 24 * 3600;
export const ACS_TIMEOUT_MS = 12_000;

/**
 * TIGERweb Tracts_Blocks MapServer layer ids. VERIFY against
 * https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer
 * — the service lists "Census Tracts" and "Census Block Groups" as separate layers and
 * the ids have shifted between vintages.
 */
export const TIGERWEB_BG_LAYER = 1;
export const TIGERWEB_TRACT_LAYER = 0;
const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer';

const CACHE_BG = 'iq360_acs_bg';
const CACHE_TRACT = 'iq360_acs_tract';
const CACHE_GEOM = 'iq360_bg_geometry';

const LICENSE = 'Public domain (U.S. Census Bureau ACS / TIGERweb)';

export const ACS_BG_VARS = {
  pop: 'B01003_001E',
  households: 'B11001_001E',
  median_income: 'B19013_001E',
  income_total: 'B19001_001E',
  income_dist: Array.from({ length: 16 }, (_, i) => `B19001_${String(i + 2).padStart(3, '0')}E`),
  age_total: 'B01001_001E',
  age_25_44: ['B01001_011E', 'B01001_012E', 'B01001_013E', 'B01001_014E', 'B01001_035E', 'B01001_036E', 'B01001_037E', 'B01001_038E'],
  avg_hh_size: 'B25010_001E',
  families_total: 'B11003_001E',
  families_with_children: ['B11003_003E', 'B11003_010E', 'B11003_016E'],
  commute_total: 'B08301_001E',
  commute_drove_alone: 'B08301_003E',
  commute_transit: 'B08301_010E',
  commute_walk: 'B08301_019E',
  median_rent: 'B25064_001E',
  median_home_value: 'B25077_001E',
  tenure_total: 'B25003_001E',
  tenure_renter: 'B25003_003E',
  pop5plus: 'C16001_001E',
  chinese_speakers: 'C16001_021E',
} as const;

export const ACS_BG_VAR_LIST: string[] = [
  ACS_BG_VARS.pop,
  ACS_BG_VARS.households,
  ACS_BG_VARS.median_income,
  ACS_BG_VARS.income_total,
  ...ACS_BG_VARS.income_dist,
  ACS_BG_VARS.age_total,
  ...ACS_BG_VARS.age_25_44,
  ACS_BG_VARS.avg_hh_size,
  ACS_BG_VARS.families_total,
  ...ACS_BG_VARS.families_with_children,
  ACS_BG_VARS.commute_total,
  ACS_BG_VARS.commute_drove_alone,
  ACS_BG_VARS.commute_transit,
  ACS_BG_VARS.commute_walk,
  ACS_BG_VARS.median_rent,
  ACS_BG_VARS.median_home_value,
  ACS_BG_VARS.tenure_total,
  ACS_BG_VARS.tenure_renter,
  ACS_BG_VARS.pop5plus,
  ACS_BG_VARS.chinese_speakers,
];

export interface TractVarSet {
  table: 'B02018' | 'B02015';
  total: string;
  chinese_ex_taiwanese: string;
  taiwanese: string;
}
/** Asian alone or in any combination (preferred: captures multiracial Chinese). */
export const ACS_TRACT_VARS_B02018: TractVarSet = {
  table: 'B02018',
  total: 'B02018_001E',
  chinese_ex_taiwanese: 'B02018_002E',
  taiwanese: 'B02018_008E',
};
/** Asian alone (fallback when the API rejects B02018 for the vintage). */
export const ACS_TRACT_VARS_B02015: TractVarSet = {
  table: 'B02015',
  total: 'B02015_001E',
  chinese_ex_taiwanese: 'B02015_002E',
  taiwanese: 'B02015_008E',
};

export interface AcsInput {
  geography: CensusGeography;
  lat: number;
  lng: number;
  /** Radius (m) of the geometry envelope pulled from TIGERweb — cover the widest ring. */
  radiusM: number;
}

export interface AcsCommute {
  transit: number | null;
  walk: number | null;
  drove_alone: number | null;
  total: number | null;
}

/** Fields shared by county and block-group rows. */
export interface AcsCommonFields {
  pop: number | null;
  households: number | null;
  median_income: number | null;
  /** 16 buckets B19001_002E..017E (<$10k … ≥$200k); null per bucket when suppressed. */
  income_dist: Array<number | null>;
  income_total: number | null;
  age_25_44: number | null;
  families_total: number | null;
  families_with_children: number | null;
  avg_hh_size: number | null;
  renter_share: number | null;
  commute: AcsCommute;
  chinese_speakers: number | null;
  pop5plus: number | null;
  /** From B02018 tracts (BG: downscaled by pop share; county: tract sum). null when tract table missing. */
  chinese_pop_est: number | null;
  median_rent: number | null;
  median_home_value: number | null;
}

export interface AcsBlockGroup extends AcsCommonFields {
  geoid: string; // 12-digit
  tract: string; // 11-digit
  geometry: Geometry | null;
}

export interface AcsCounty extends AcsCommonFields {
  geoid: string; // 5-digit
}

export interface AcsTract {
  geoid: string; // 11-digit
  pop: number | null;
  /** Chinese except Taiwanese + Taiwanese. */
  chinese_pop: number | null;
  taiwanese_pop: number | null;
  /** Only filled when the BG layer failed and the tract layer was used as fallback. */
  geometry: Geometry | null;
}

export interface AcsData {
  year: number;
  county: AcsCounty | null;
  block_groups: AcsBlockGroup[];
  tracts: AcsTract[];
  /** Source table actually used for Chinese ancestry (null when unavailable). */
  ancestry_table: 'B02018' | 'B02015' | null;
  coverage: {
    /** County BGs that received a polygon (only those intersecting the radius bbox can). */
    bg_with_geometry: number;
    /** All BG rows in the county. */
    bg_total: number;
    /** BGs intersecting the requested bbox according to TIGERweb. */
    bg_in_bbox: number;
    tract_with_geometry: number;
  };
}

export interface AcsOptions {
  /** Test hook — smaller chunks exercise the multi-call merge path. */
  maxVarsPerCall?: number;
}

/* ---------- parsing helpers ---------- */

/** Census numeric cell → number | null. Every negative sentinel and null/blank is null, never 0. */
export function parseCensusValue(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

export function chunkVars(vars: string[], size = ACS_MAX_VARS_PER_CALL): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < vars.length; i += Math.max(1, size)) out.push(vars.slice(i, i + Math.max(1, size)));
  return out;
}

type CensusRow = Record<string, string | null>;

/** Census API array-of-arrays → records keyed by header. */
export function rowsFromCensusJson(json: unknown): CensusRow[] | null {
  if (!Array.isArray(json) || json.length === 0 || !Array.isArray(json[0])) return null;
  const header = (json[0] as unknown[]).map((h) => String(h));
  const rows: CensusRow[] = [];
  for (let i = 1; i < json.length; i++) {
    const cells = json[i];
    if (!Array.isArray(cells)) continue;
    const rec: CensusRow = {};
    header.forEach((h, j) => {
      const c = cells[j];
      rec[h] = c === null || c === undefined ? null : String(c);
    });
    rows.push(rec);
  }
  return rows;
}

function sumStrict(rec: CensusRow, vars: readonly string[]): number | null {
  let total = 0;
  for (const v of vars) {
    const n = parseCensusValue(rec[v]);
    if (n === null) return null;
    total += n;
  }
  return total;
}

function ratio(num: number | null, denom: number | null): number | null {
  if (num === null || denom === null || denom <= 0) return null;
  return num / denom;
}

export function parseCommonFields(rec: CensusRow): Omit<AcsCommonFields, 'chinese_pop_est'> {
  const V = ACS_BG_VARS;
  const cell = (k: string) => parseCensusValue(rec[k]);
  return {
    pop: cell(V.pop),
    households: cell(V.households),
    median_income: cell(V.median_income),
    income_dist: V.income_dist.map(cell),
    income_total: cell(V.income_total),
    age_25_44: sumStrict(rec, V.age_25_44),
    families_total: cell(V.families_total),
    families_with_children: sumStrict(rec, V.families_with_children),
    avg_hh_size: cell(V.avg_hh_size),
    renter_share: ratio(cell(V.tenure_renter), cell(V.tenure_total)),
    commute: {
      transit: cell(V.commute_transit),
      walk: cell(V.commute_walk),
      drove_alone: cell(V.commute_drove_alone),
      total: cell(V.commute_total),
    },
    chinese_speakers: cell(V.chinese_speakers),
    pop5plus: cell(V.pop5plus),
    median_rent: cell(V.median_rent),
    median_home_value: cell(V.median_home_value),
  };
}

function bgGeoid(rec: CensusRow): string | null {
  const s = rec.state ?? '';
  const c = rec.county ?? '';
  const t = rec.tract ?? '';
  const b = rec['block group'] ?? '';
  const id = `${s}${c}${t}${b}`;
  return /^\d{12}$/.test(id) ? id : null;
}

function tractGeoid(rec: CensusRow): string | null {
  const id = `${rec.state ?? ''}${rec.county ?? ''}${rec.tract ?? ''}`;
  return /^\d{11}$/.test(id) ? id : null;
}

/* ---------- Census API ---------- */

interface CensusQueryResult {
  ok: boolean;
  status: number;
  rows: CensusRow[];
  error: string | null;
}

async function censusQuery(
  ctx: FetchContext,
  year: number,
  vars: string[],
  forClause: string,
  inClause: string | null,
): Promise<CensusQueryResult> {
  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set('get', vars.join(','));
  url.searchParams.set('for', forClause);
  if (inClause) url.searchParams.set('in', inClause);
  const key = ctx.env('CENSUS_API_KEY');
  if (key) url.searchParams.set('key', key);
  try {
    const res = await fetchWithTimeout(ctx, url, { timeoutMs: ACS_TIMEOUT_MS });
    if (res.status === 204) return { ok: true, status: 204, rows: [], error: null };
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      ctx.log(`[D2] ACS ${year} ${forClause} HTTP ${res.status}`, text.slice(0, 200));
      return { ok: false, status: res.status, rows: [], error: `HTTP ${res.status} ${text.slice(0, 120)}` };
    }
    const json: unknown = await res.json().catch(() => null);
    const rows = rowsFromCensusJson(json);
    if (!rows) return { ok: false, status: res.status, rows: [], error: 'unparseable ACS payload' };
    return { ok: true, status: res.status, rows, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log(`[D2] ACS ${year} ${forClause} threw`, msg);
    return { ok: false, status: 0, rows: [], error: msg };
  }
}

/** Fetch `vars` in chunks and merge rows by `keyFn`. Returns null when any chunk fails. */
async function censusChunked(
  ctx: FetchContext,
  year: number,
  vars: string[],
  forClause: string,
  inClause: string | null,
  keyFn: (rec: CensusRow) => string | null,
  maxVars: number,
): Promise<{ rows: Map<string, CensusRow> | null; error: string | null }> {
  const merged = new Map<string, CensusRow>();
  for (const chunk of chunkVars(vars, maxVars)) {
    const r = await censusQuery(ctx, year, chunk, forClause, inClause);
    if (!r.ok) return { rows: null, error: r.error };
    for (const rec of r.rows) {
      const k = keyFn(rec);
      if (!k) continue;
      merged.set(k, { ...(merged.get(k) ?? {}), ...rec });
    }
  }
  return { rows: merged, error: null };
}

interface BgCachePayload {
  year: number;
  county: CensusRow | null;
  block_groups: CensusRow[];
}

interface TractCachePayload {
  year: number;
  table: 'B02018' | 'B02015';
  tracts: CensusRow[];
}

interface GeomCachePayload {
  features: Array<{ geoid: string; geometry: Geometry }>;
}

/* ---------- TIGERweb ---------- */

function roundBbox(b: BBox): string {
  const r = (n: number) => Math.round(n * 10_000) / 10_000;
  return `${r(b.minLng)},${r(b.minLat)},${r(b.maxLng)},${r(b.maxLat)}`;
}

function isGeometry(g: unknown): g is Geometry {
  if (typeof g !== 'object' || g === null) return false;
  const t = (g as { type?: unknown }).type;
  const c = (g as { coordinates?: unknown }).coordinates;
  return (t === 'Polygon' || t === 'MultiPolygon') && Array.isArray(c);
}

async function fetchTigerweb(
  ctx: FetchContext,
  layer: number,
  bbox: BBox,
): Promise<{ features: GeomCachePayload['features'] | null; cache: 'hit' | 'miss'; error: string | null }> {
  const cacheKey = `${layer}:${roundBbox(bbox)}`;
  const cached = await ctx.cache.get<GeomCachePayload>(CACHE_GEOM, cacheKey);
  if (cached && Array.isArray(cached.features)) return { features: cached.features, cache: 'hit', error: null };

  const url = new URL(`${TIGERWEB_BASE}/${layer}/query`);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`);
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'GEOID');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('f', 'geojson');
  try {
    const res = await fetchWithTimeout(ctx, url, { timeoutMs: ACS_TIMEOUT_MS });
    if (!res.ok) {
      ctx.log(`[D2] TIGERweb layer ${layer} HTTP ${res.status}`);
      return { features: null, cache: 'miss', error: `HTTP ${res.status}` };
    }
    const json: unknown = await res.json().catch(() => null);
    if (typeof json !== 'object' || json === null) return { features: null, cache: 'miss', error: 'unparseable' };
    // ArcGIS reports errors as 200 + {error:{...}}
    if ('error' in json) {
      const e = (json as { error: { message?: string } }).error;
      ctx.log(`[D2] TIGERweb layer ${layer} error`, e);
      return { features: null, cache: 'miss', error: e?.message ?? 'arcgis error' };
    }
    const raw = (json as { features?: unknown }).features;
    if (!Array.isArray(raw)) return { features: null, cache: 'miss', error: 'no features array' };
    const features: GeomCachePayload['features'] = [];
    for (const f of raw) {
      if (typeof f !== 'object' || f === null) continue;
      const props = (f as { properties?: Record<string, unknown> }).properties ?? {};
      const geoid = props.GEOID ?? props.geoid;
      const geometry = (f as { geometry?: unknown }).geometry;
      if (typeof geoid !== 'string' || !isGeometry(geometry)) continue;
      features.push({ geoid, geometry });
    }
    await ctx.cache.set(CACHE_GEOM, cacheKey, { features } satisfies GeomCachePayload, ACS_CACHE_TTL_S);
    return { features, cache: 'miss', error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log(`[D2] TIGERweb layer ${layer} threw`, msg);
    return { features: null, cache: 'miss', error: msg };
  }
}

/* ---------- main ---------- */

async function loadBgYear(
  ctx: FetchContext,
  state: string,
  county: string,
  year: number,
  maxVars: number,
): Promise<{ payload: BgCachePayload | null; cache: 'hit' | 'miss'; error: string | null }> {
  const cacheKey = `${state}${county}:${year}`;
  const cached = await ctx.cache.get<BgCachePayload>(CACHE_BG, cacheKey);
  if (cached && Array.isArray(cached.block_groups) && cached.block_groups.length > 0) {
    return { payload: cached, cache: 'hit', error: null };
  }
  const bg = await censusChunked(
    ctx,
    year,
    ACS_BG_VAR_LIST,
    'block group:*',
    `state:${state} county:${county} tract:*`,
    bgGeoid,
    maxVars,
  );
  if (!bg.rows) return { payload: null, cache: 'miss', error: bg.error };
  if (bg.rows.size === 0) return { payload: null, cache: 'miss', error: 'no block group rows' };
  const countyRows = await censusChunked(
    ctx,
    year,
    ACS_BG_VAR_LIST,
    `county:${county}`,
    `state:${state}`,
    (rec) => `${rec.state ?? ''}${rec.county ?? ''}`,
    maxVars,
  );
  const payload: BgCachePayload = {
    year,
    county: countyRows.rows?.get(`${state}${county}`) ?? null,
    block_groups: [...bg.rows.values()],
  };
  await ctx.cache.set(CACHE_BG, cacheKey, payload, ACS_CACHE_TTL_S);
  return { payload, cache: 'miss', error: null };
}

async function loadTracts(
  ctx: FetchContext,
  state: string,
  county: string,
  year: number,
): Promise<{ payload: TractCachePayload | null; cache: 'hit' | 'miss'; error: string | null }> {
  const cacheKey = `${state}${county}:${year}`;
  const cached = await ctx.cache.get<TractCachePayload>(CACHE_TRACT, cacheKey);
  if (cached && Array.isArray(cached.tracts) && cached.tracts.length > 0) return { payload: cached, cache: 'hit', error: null };
  let lastError: string | null = null;
  for (const set of [ACS_TRACT_VARS_B02018, ACS_TRACT_VARS_B02015]) {
    const r = await censusQuery(
      ctx,
      year,
      [ACS_BG_VARS.pop, set.total, set.chinese_ex_taiwanese, set.taiwanese],
      'tract:*',
      `state:${state} county:${county}`,
    );
    if (!r.ok) {
      lastError = `${set.table}: ${r.error}`;
      continue;
    }
    const tracts = r.rows.filter((rec) => tractGeoid(rec));
    if (tracts.length === 0) {
      lastError = `${set.table}: no tract rows`;
      continue;
    }
    const payload: TractCachePayload = { year, table: set.table, tracts };
    await ctx.cache.set(CACHE_TRACT, cacheKey, payload, ACS_CACHE_TTL_S);
    return { payload, cache: 'miss', error: null };
  }
  return { payload: null, cache: 'miss', error: lastError };
}

export async function fetchAcs(input: AcsInput, ctx: FetchContext, opts: AcsOptions = {}): Promise<DataResult<AcsData>> {
  const started = Date.now();
  const maxVars = opts.maxVarsPerCall ?? ACS_MAX_VARS_PER_CALL;
  const { geography } = input;
  const state = geography.state;
  const county = geography.county.slice(2, 5);
  const source = (year: number | null) =>
    `U.S. Census Bureau ACS 5-year${year ? ` ${year}` : ''} (block group + tract, api.census.gov) + TIGERweb Tracts_Blocks`;

  if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county) || !geography.tract) {
    return failed('D2', ctx, {
      source: source(null),
      license: LICENSE,
      note: 'D1 未提供 tract/county GEOID → 无法查询 ACS（不按 ZIP 查询）',
      error: 'missing census geography',
    });
  }

  // a) block group + county rows, year 2023 → 2022
  let bgPayload: BgCachePayload | null = null;
  let bgCache: 'hit' | 'miss' = 'miss';
  const yearErrors: string[] = [];
  for (const year of ACS_YEARS) {
    const r = await loadBgYear(ctx, state, county, year, maxVars);
    if (r.payload) {
      bgPayload = r.payload;
      bgCache = r.cache;
      break;
    }
    yearErrors.push(`${year}: ${r.error ?? 'unknown'}`);
  }
  if (!bgPayload) {
    return failed('D2', ctx, {
      source: source(null),
      license: LICENSE,
      note: `county ${state}${county} 在 ACS ${ACS_YEARS.join('/')} 均无 block group 行 → D2 failed（地理来自 D1 tract ${geography.tract}，未按 ZIP 查询）`,
      error: yearErrors.join('; '),
    });
  }
  const year = bgPayload.year;
  const notes: string[] = [
    `ACS ${year} 5 年；地理来自 D1 tract/BG（tract ${geography.tract}），不按 ZIP 查询`,
    `county ${state}${county} block group ${bgPayload.block_groups.length} 行${bgPayload.county ? '' : '（county 行缺失）'}`,
  ];
  let status: DataStatus = bgPayload.county ? 'ok' : 'partial';

  // b) tract-level Chinese ancestry
  const tractRes = await loadTracts(ctx, state, county, year);
  const tractRows = tractRes.payload?.tracts ?? [];
  const tractSet = tractRes.payload?.table === 'B02015' ? ACS_TRACT_VARS_B02015 : ACS_TRACT_VARS_B02018;
  const tractMap = new Map<string, AcsTract>();
  for (const rec of tractRows) {
    const geoid = tractGeoid(rec);
    if (!geoid) continue;
    const cn = parseCensusValue(rec[tractSet.chinese_ex_taiwanese]);
    const tw = parseCensusValue(rec[tractSet.taiwanese]);
    tractMap.set(geoid, {
      geoid,
      pop: parseCensusValue(rec[ACS_BG_VARS.pop]),
      chinese_pop: cn === null && tw === null ? null : (cn ?? 0) + (tw ?? 0),
      taiwanese_pop: tw,
      geometry: null,
    });
  }
  if (tractMap.size === 0) {
    status = 'partial';
    notes.push(`tract 级华裔祖源 (B02018/B02015) 缺失（${tractRes.error ?? 'no rows'}）→ chinese_pop_est 记 null，不估算`);
  } else {
    notes.push(`tract 级华裔祖源 ${tractRes.payload?.table} ${tractMap.size} 行 → 按 BG 人口份额下推`);
  }

  // c) geometries
  const bbox = bboxAround({ lat: input.lat, lng: input.lng }, Math.max(100, input.radiusM));
  const bgGeom = await fetchTigerweb(ctx, TIGERWEB_BG_LAYER, bbox);
  const geomMap = new Map<string, Geometry>();
  for (const f of bgGeom.features ?? []) geomMap.set(f.geoid, f.geometry);
  let tractGeomCount = 0;
  if (!bgGeom.features) {
    status = 'partial';
    const tractGeom = await fetchTigerweb(ctx, TIGERWEB_TRACT_LAYER, bbox);
    for (const f of tractGeom.features ?? []) {
      const t = tractMap.get(f.geoid);
      if (t) {
        t.geometry = f.geometry;
        tractGeomCount++;
      }
    }
    notes.push(
      `TIGERweb BG 几何失败（${bgGeom.error ?? 'unknown'}）→ 无 block group 几何 → 圈层按质心归属` +
        (tractGeomCount > 0 ? `；tract 几何 ${tractGeomCount} 个可用` : '；tract 几何亦不可用'),
    );
  }

  // assemble block groups
  const bgPopByTract = new Map<string, number>();
  const parsedBgs: Array<{ geoid: string; tract: string; fields: Omit<AcsCommonFields, 'chinese_pop_est'> }> = [];
  for (const rec of bgPayload.block_groups) {
    const geoid = bgGeoid(rec);
    if (!geoid) continue;
    const fields = parseCommonFields(rec);
    const tract = geoid.slice(0, 11);
    if (fields.pop !== null) bgPopByTract.set(tract, (bgPopByTract.get(tract) ?? 0) + fields.pop);
    parsedBgs.push({ geoid, tract, fields });
  }
  let bgWithGeometry = 0;
  const block_groups: AcsBlockGroup[] = parsedBgs.map(({ geoid, tract, fields }) => {
    const t = tractMap.get(tract);
    const tractPop = bgPopByTract.get(tract) ?? 0;
    const chinese_pop_est =
      t && t.chinese_pop !== null && fields.pop !== null && tractPop > 0 ? (t.chinese_pop * fields.pop) / tractPop : null;
    const geometry = geomMap.get(geoid) ?? null;
    if (geometry) bgWithGeometry++;
    return { geoid, tract, ...fields, chinese_pop_est, geometry };
  });

  let county_row: AcsCounty | null = null;
  if (bgPayload.county) {
    let cnSum: number | null = null;
    for (const t of tractMap.values()) {
      if (t.chinese_pop !== null) cnSum = (cnSum ?? 0) + t.chinese_pop;
    }
    county_row = { geoid: `${state}${county}`, ...parseCommonFields(bgPayload.county), chinese_pop_est: cnSum };
  }

  const bgInBbox = (bgGeom.features ?? []).length;
  if (bgGeom.features && bgWithGeometry === 0) {
    status = 'partial';
    notes.push(`TIGERweb 返回 ${bgInBbox} 个 BG 几何但无一匹配 county ${state}${county} 的 GEOID（检查 TIGERWEB_BG_LAYER=${TIGERWEB_BG_LAYER}）→ 圈层按质心归属`);
  } else if (bgGeom.features) {
    notes.push(`BG 几何 ${bgWithGeometry}/${block_groups.length}（bbox 内 ${bgInBbox} 个，半径 ${Math.round(input.radiusM)} m）`);
  }

  const data: AcsData = {
    year,
    county: county_row,
    block_groups,
    tracts: [...tractMap.values()],
    ancestry_table: tractRes.payload?.table ?? null,
    coverage: {
      bg_with_geometry: bgWithGeometry,
      bg_total: block_groups.length,
      bg_in_bbox: bgInBbox,
      tract_with_geometry: tractGeomCount,
    },
  };
  const allHit = bgCache === 'hit' && (tractRes.cache === 'hit' || !tractRes.payload) && bgGeom.cache === 'hit';
  return {
    id: 'D2',
    name: DATA_SOURCE_NAMES.D2,
    status,
    data,
    source: source(year),
    fetched_at: nowIso(ctx),
    license: LICENSE,
    cost_usd: 0,
    coverage_note: notes.join('；'),
    cache: allHit ? 'hit' : 'miss',
    degraded_from: status === 'partial' ? 'acs_bg_tract_geometry' : undefined,
    elapsed_ms: Date.now() - started,
  };
}
