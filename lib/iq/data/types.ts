/**
 * Phase 1 data layer — shared contracts.
 *
 * Every data module exposes `fetch(site, ctx) -> DataResult<T>`; failures are
 * reported in `status` and `coverage_note`, never papered over with estimates
 * (研发提示词 §1.4 第 3 条). `sources[]` in report_model.json is built directly
 * from these results.
 */

export type DataSourceId =
  | 'D1' // geocode + census geography
  | 'D2' // ACS population & income (block group + tract)
  | 'D3' // LODES daytime / workplace population
  | 'D4' // isochrones
  | 'D5' // Overture POI base map
  | 'D6' // Google Places freshness / quality signals
  | 'D7' // traffic proxy (review-count snapshots)
  | 'D8' // rent comps
  | 'D9' // transit + AADT
  | 'D10' // BLS CEX food-away-from-home
  | 'D11' // development pipeline
  | 'D12'; // user inputs

export type DataStatus = 'ok' | 'partial' | 'failed';

export interface DataResult<T> {
  id: DataSourceId;
  name: string;
  status: DataStatus;
  data: T | null;
  /** Human-readable provenance (API + vintage), goes to the sources table verbatim. */
  source: string;
  fetched_at: string;
  license: string;
  cost_usd: number;
  /** What was / was not covered, and any degradation applied. */
  coverage_note: string;
  cache: 'hit' | 'miss' | 'none';
  /** Set when a fallback replaced the primary path (e.g. straight-line radius for isochrones). */
  degraded_from?: string;
  error?: string;
  elapsed_ms?: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON subset used across the engines. */
export type Position = [number, number]; // [lng, lat]
export interface Polygon {
  type: 'Polygon';
  coordinates: Position[][];
}
export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}
export type Geometry = Polygon | MultiPolygon;

export interface CensusGeography {
  block: string; // 15-digit GEOID
  block_group: string; // 12-digit
  tract: string; // 11-digit
  county: string; // 5-digit
  state: string; // 2-digit
  zcta: string | null;
  county_name: string | null;
  state_abbr: string | null;
}

/** Normalized user inputs (D12). Nulls mean "not provided" — never defaulted here. */
export interface SiteInput {
  report_id: string;
  address: string;
  cuisine: string; // taxonomy id
  language: 'en' | 'zh';
  rent_usd: number | null;
  sqft: number | null;
  seats: number | null;
  capex_usd: number | null;
  ticket_in: number | null;
  ticket_delivery: number | null;
  delivery_ratio: number | null;
  parking_spaces: number | null;
  existing_stores: Array<{ address: string; lat?: number; lng?: number }>;
  /** Optional listing URLs the user supplied for rent comps (D8). */
  listing_urls: string[];
  /** Direct competitors the user named (≤ 10). Drive extra D6 Text Searches and L1 pre-classification. */
  known_competitors: string[];
}

export interface CostEntry {
  source: DataSourceId | 'llm' | 'search' | 'render';
  usd: number;
  note: string;
  at: string;
}

export interface CostLedger {
  add(source: CostEntry['source'], usd: number, note: string): void;
  total(): number;
  entries(): CostEntry[];
  bySource(): Record<string, number>;
}

export interface CacheAdapter {
  get<T>(source: string, key: string): Promise<T | null>;
  set(source: string, key: string, payload: unknown, ttlSeconds: number): Promise<void>;
}

export interface FetchContext {
  fetch: typeof fetch;
  cost: CostLedger;
  cache: CacheAdapter;
  env: (name: string) => string | null;
  now: () => Date;
  log: (msg: string, extra?: unknown) => void;
  /** Wall-clock budget hint for the whole data phase (ms). Modules should keep each call well under it. */
  budgetMs: number;
}

export const DATA_SOURCE_NAMES: Record<DataSourceId, string> = {
  D1: 'Geocode · Census geography',
  D2: 'Census ACS 5-year (block group + tract)',
  D3: 'LEHD LODES v8 workplace population',
  D4: 'Isochrones (walk 10 / drive 5 · 10 · 15)',
  D5: 'Overture Maps Places (POI base map)',
  D6: 'Google Places (freshness & quality)',
  D7: 'Traffic proxy (review-count snapshots)',
  D8: 'Rent comps',
  D9: 'Transit & traffic counts',
  D10: 'BLS Consumer Expenditure Survey',
  D11: 'Development pipeline',
  D12: 'User inputs',
};

export function nowIso(ctx: Pick<FetchContext, 'now'>): string {
  return ctx.now().toISOString();
}

export function failed<T>(
  id: DataSourceId,
  ctx: Pick<FetchContext, 'now'>,
  opts: { source: string; license: string; note: string; error?: string; cost_usd?: number },
): DataResult<T> {
  return {
    id,
    name: DATA_SOURCE_NAMES[id],
    status: 'failed',
    data: null,
    source: opts.source,
    fetched_at: nowIso(ctx),
    license: opts.license,
    cost_usd: opts.cost_usd ?? 0,
    coverage_note: opts.note,
    cache: 'none',
    error: opts.error,
  };
}
