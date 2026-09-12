/**
 * D1 · Geocode + Census geography.
 *
 * Primary: Census Geocoder (free, returns block GEOID → BG / tract / county / state
 * in one call). Fallback: Google Geocoding ($0.005, recorded on the cost ledger)
 * for coordinates, then Census Geocoder `coordinates` endpoint → FCC Area API for
 * the block FIPS. Both geocoders failing is a hard failure: the pipeline aborts
 * on D1 (研发提示词 Phase 1) because every later module keys off tract / BG.
 *
 * ZIP is never a terminal geography here — ZCTA is carried only as context and
 * D2 must query by tract / block group (audit R2).
 */
import { getHubs } from '@/lib/iq/params';
import { fetchWithTimeout } from './context';
import { DATA_SOURCE_NAMES, failed, nowIso, type CensusGeography, type DataResult, type FetchContext } from './types';

export interface GeocodeData {
  lat: number;
  lng: number;
  matched_address: string;
  geography: CensusGeography;
  /** `sf-bay` when inside params/hubs.yaml metro_bbox, else null. */
  metro: string | null;
  provider: 'census' | 'google';
}

export interface GeocodeInput {
  address: string;
}

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/geographies';
const GOOGLE_GEOCODER = 'https://maps.googleapis.com/maps/api/geocode/json';
const FCC_AREA = 'https://geo.fcc.gov/api/census/area';
const BENCHMARK = 'Public_AR_Current';
const VINTAGE = 'Current_Current';

export const GEOCODE_TIMEOUT_MS = 8_000;
export const GOOGLE_GEOCODE_COST_USD = 0.005;
/** Addresses do not move: cache "forever" (10 years). */
export const GEOCODE_CACHE_TTL_S = 10 * 365 * 24 * 3600;
const CACHE_SOURCE = 'iq360_geocode';

const SOURCE_CENSUS = 'U.S. Census Bureau Geocoder (Public_AR_Current / Current_Current, layers=all)';
const SOURCE_GOOGLE = 'Google Geocoding API + Census Geocoder coordinates / FCC Area API';
const LICENSE_CENSUS = 'Public domain (U.S. Census Bureau)';
const LICENSE_GOOGLE = 'Google Maps Platform ToS (coordinates only; geography from Census/FCC public domain)';

/** Lower-case, collapse whitespace/punctuation so "1711 El Camino Real, Millbrae CA" == "1711 el camino real millbrae ca". */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 5-digit ZIP (optionally ZIP+4) at the end of a US address string. */
export function zipFromAddress(address: string): string | null {
  const m = address.match(/\b(\d{5})(?:-\d{4})?\b\s*(?:,?\s*(?:usa?|united states))?\s*$/i);
  return m ? m[1] : null;
}

/** Derive the full CensusGeography from a 15-digit block GEOID (or 12 / 11 digit BG / tract). */
export function geographyFromGeoid(
  geoid: string,
  extras: Partial<Pick<CensusGeography, 'zcta' | 'county_name' | 'state_abbr'>> = {},
): CensusGeography | null {
  const clean = geoid.replace(/\D/g, '');
  if (clean.length < 11) return null;
  return {
    block: clean.length >= 15 ? clean.slice(0, 15) : '',
    block_group: clean.length >= 12 ? clean.slice(0, 12) : '',
    tract: clean.slice(0, 11),
    county: clean.slice(0, 5),
    state: clean.slice(0, 2),
    zcta: extras.zcta ?? null,
    county_name: extras.county_name ?? null,
    state_abbr: extras.state_abbr ?? null,
  };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function firstLayer(geographies: Rec, predicate: (key: string) => boolean): Rec | null {
  for (const key of Object.keys(geographies)) {
    if (!predicate(key)) continue;
    const arr = geographies[key];
    if (Array.isArray(arr) && isRec(arr[0])) return arr[0];
  }
  return null;
}

/**
 * Parse the `geographies` object shared by the onelineaddress and coordinates
 * endpoints. Tolerant to layer naming drift ("2020 Census ZIP Code Tabulation
 * Areas" vs "Zip Code Tabulation Areas", "Census Blocks" vs "2020 Census Blocks").
 */
export function parseCensusGeographies(geographies: unknown, addressForZip: string): CensusGeography | null {
  if (!isRec(geographies)) return null;
  const lc = (k: string) => k.toLowerCase();
  const block = firstLayer(geographies, (k) => /census blocks?$/.test(lc(k)));
  const bg = firstLayer(geographies, (k) => lc(k).includes('block group'));
  const tract = firstLayer(geographies, (k) => lc(k).includes('census tract'));
  const county = firstLayer(geographies, (k) => lc(k).includes('counties'));
  const state = firstLayer(geographies, (k) => lc(k).includes('states'));
  const zcta = firstLayer(geographies, (k) => lc(k).includes('zip code tabulation') || lc(k).includes('zcta'));

  const geoid = str(block?.GEOID) ?? str(bg?.GEOID) ?? str(tract?.GEOID);
  if (!geoid) return null;
  const zctaId = str(zcta?.GEOID) ?? str(zcta?.ZCTA5) ?? zipFromAddress(addressForZip);
  return geographyFromGeoid(geoid, {
    zcta: zctaId && /^\d{5}$/.test(zctaId) ? zctaId : null,
    county_name: str(county?.NAME) ?? str(county?.BASENAME),
    state_abbr: str(state?.STUSAB),
  });
}

export function metroFor(lat: number, lng: number): string | null {
  const hubs = getHubs();
  const b = hubs.metro_bbox;
  return lat >= b.min_lat && lat <= b.max_lat && lng >= b.min_lng && lng <= b.max_lng ? hubs.metro : null;
}

async function getJson(ctx: FetchContext, url: URL, label: string): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const res = await fetchWithTimeout(ctx, url, { timeoutMs: GEOCODE_TIMEOUT_MS });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) ctx.log(`[D1] ${label} HTTP ${res.status}`);
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    ctx.log(`[D1] ${label} threw`, err instanceof Error ? err.message : err);
    return { ok: false, status: 0, json: null };
  }
}

interface CensusMatch {
  lat: number;
  lng: number;
  matched_address: string;
  geography: CensusGeography;
}

async function censusOneline(ctx: FetchContext, address: string): Promise<CensusMatch | null> {
  const url = new URL(`${CENSUS_GEOCODER}/onelineaddress`);
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', BENCHMARK);
  url.searchParams.set('vintage', VINTAGE);
  url.searchParams.set('layers', 'all');
  url.searchParams.set('format', 'json');
  const { ok, json } = await getJson(ctx, url, 'census onelineaddress');
  if (!ok || !isRec(json) || !isRec(json.result)) return null;
  const matches = json.result.addressMatches;
  if (!Array.isArray(matches) || !isRec(matches[0])) return null;
  const m = matches[0];
  const coords = isRec(m.coordinates) ? m.coordinates : null;
  const lng = Number(coords?.x);
  const lat = Number(coords?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const geography = parseCensusGeographies(m.geographies, address);
  if (!geography) return null;
  return { lat, lng, matched_address: str(m.matchedAddress) ?? address, geography };
}

async function censusByCoordinates(ctx: FetchContext, lat: number, lng: number, address: string): Promise<CensusGeography | null> {
  const url = new URL(`${CENSUS_GEOCODER}/coordinates`);
  url.searchParams.set('x', String(lng));
  url.searchParams.set('y', String(lat));
  url.searchParams.set('benchmark', BENCHMARK);
  url.searchParams.set('vintage', VINTAGE);
  url.searchParams.set('layers', 'all');
  url.searchParams.set('format', 'json');
  const { ok, json } = await getJson(ctx, url, 'census coordinates');
  if (!ok || !isRec(json) || !isRec(json.result)) return null;
  return parseCensusGeographies(json.result.geographies, address);
}

async function fccBlockFips(ctx: FetchContext, lat: number, lng: number, address: string): Promise<CensusGeography | null> {
  const url = new URL(FCC_AREA);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'json');
  const { ok, json } = await getJson(ctx, url, 'fcc area');
  if (!ok || !isRec(json) || !Array.isArray(json.results) || !isRec(json.results[0])) return null;
  const r = json.results[0];
  const fips = str(r.block_fips);
  if (!fips) return null;
  return geographyFromGeoid(fips, {
    zcta: zipFromAddress(address),
    county_name: str(r.county_name),
    state_abbr: str(r.state_code),
  });
}

interface GoogleMatch {
  lat: number;
  lng: number;
  formatted_address: string;
  postal_code: string | null;
}

async function googleGeocode(ctx: FetchContext, address: string): Promise<{ match: GoogleMatch | null; reason: string }> {
  const key = ctx.env('GOOGLE_MAPS_API_KEY');
  if (!key) return { match: null, reason: '缺 GOOGLE_MAPS_API_KEY，跳过 Google 回退' };
  const url = new URL(GOOGLE_GEOCODER);
  url.searchParams.set('address', address);
  url.searchParams.set('region', 'us');
  url.searchParams.set('key', key);
  ctx.cost.add('D1', GOOGLE_GEOCODE_COST_USD, 'Google Geocoding fallback');
  const { ok, json } = await getJson(ctx, url, 'google geocode');
  if (!ok || !isRec(json)) return { match: null, reason: 'Google Geocoding HTTP 失败' };
  const status = str(json.status) ?? 'UNKNOWN';
  const results = json.results;
  if (status !== 'OK' || !Array.isArray(results) || !isRec(results[0])) {
    return { match: null, reason: `Google Geocoding status=${status}` };
  }
  const r = results[0];
  const loc = isRec(r.geometry) && isRec(r.geometry.location) ? r.geometry.location : null;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { match: null, reason: 'Google Geocoding 无坐标' };
  let postal: string | null = null;
  if (Array.isArray(r.address_components)) {
    for (const c of r.address_components) {
      if (isRec(c) && Array.isArray(c.types) && c.types.includes('postal_code')) postal = str(c.short_name) ?? str(c.long_name);
    }
  }
  return { match: { lat, lng, formatted_address: str(r.formatted_address) ?? address, postal_code: postal }, reason: 'ok' };
}

function okResult(
  ctx: FetchContext,
  data: GeocodeData,
  opts: { cache: 'hit' | 'miss'; note: string; cost_usd: number; degraded_from?: string; elapsed_ms: number },
): DataResult<GeocodeData> {
  return {
    id: 'D1',
    name: DATA_SOURCE_NAMES.D1,
    status: 'ok',
    data,
    source: data.provider === 'census' ? SOURCE_CENSUS : SOURCE_GOOGLE,
    fetched_at: nowIso(ctx),
    license: data.provider === 'census' ? LICENSE_CENSUS : LICENSE_GOOGLE,
    cost_usd: opts.cost_usd,
    coverage_note: opts.note,
    cache: opts.cache,
    degraded_from: opts.degraded_from,
    elapsed_ms: opts.elapsed_ms,
  };
}

/**
 * D1 entry point. Never throws for data failures; `status: 'failed'` when neither
 * geocoder yields coordinates + a tract-level GEOID.
 */
export async function fetchGeocode(input: GeocodeInput, ctx: FetchContext): Promise<DataResult<GeocodeData>> {
  const started = Date.now();
  const address = input.address.trim();
  if (!address) {
    return failed('D1', ctx, { source: SOURCE_CENSUS, license: LICENSE_CENSUS, note: '地址为空，无法定位', error: 'empty address' });
  }
  const key = normalizeAddress(address);

  const cached = await ctx.cache.get<GeocodeData>(CACHE_SOURCE, key);
  if (cached && Number.isFinite(cached.lat) && cached.geography?.tract) {
    return okResult(ctx, cached, {
      cache: 'hit',
      note: `缓存命中（${cached.provider}）；tract ${cached.geography.tract} / BG ${cached.geography.block_group || '—'}`,
      cost_usd: 0,
      elapsed_ms: Date.now() - started,
    });
  }

  // 1) Census Geocoder — one call gives coordinates + all geographies.
  const census = await censusOneline(ctx, address);
  if (census) {
    const data: GeocodeData = {
      lat: census.lat,
      lng: census.lng,
      matched_address: census.matched_address,
      geography: census.geography,
      metro: metroFor(census.lat, census.lng),
      provider: 'census',
    };
    await ctx.cache.set(CACHE_SOURCE, key, data, GEOCODE_CACHE_TTL_S);
    const zctaNote = data.geography.zcta ? `ZCTA ${data.geography.zcta}` : 'ZCTA 缺失';
    return okResult(ctx, data, {
      cache: 'miss',
      note: `Census Geocoder 命中：${data.matched_address}；block ${data.geography.block || '—'} → BG ${data.geography.block_group || '—'} / tract ${data.geography.tract} / county ${data.geography.county}；${zctaNote}（仅作上下文，不按 ZIP 查询）`,
      cost_usd: 0,
      elapsed_ms: Date.now() - started,
    });
  }

  // 2) Google Geocoding → Census coordinates → FCC.
  const costBefore = ctx.cost.total();
  const google = await googleGeocode(ctx, address);
  const googleCost = Math.max(0, Math.round((ctx.cost.total() - costBefore) * 10_000) / 10_000);
  if (!google.match) {
    return failed('D1', ctx, {
      source: `${SOURCE_CENSUS}; ${SOURCE_GOOGLE}`,
      license: LICENSE_CENSUS,
      note: `Census Geocoder 无匹配；${google.reason}；两路定位均失败 → D1 failed，报告中止`,
      error: `census: no match; google: ${google.reason}`,
      cost_usd: googleCost,
    });
  }
  const { lat, lng } = google.match;
  let geography = await censusByCoordinates(ctx, lat, lng, address);
  let geoSource = 'Census Geocoder coordinates';
  if (!geography) {
    geography = await fccBlockFips(ctx, lat, lng, address);
    geoSource = 'FCC Area API';
  }
  if (!geography) {
    return failed('D1', ctx, {
      source: `${SOURCE_CENSUS}; ${SOURCE_GOOGLE}`,
      license: LICENSE_GOOGLE,
      note: `Census Geocoder 无匹配；Google 定位成功（${google.match.formatted_address}）但 Census coordinates 与 FCC 均无法解析 GEOID → 无 tract/BG，D1 failed`,
      error: 'google ok; census coordinates + fcc failed',
      cost_usd: googleCost,
    });
  }
  if (!geography.zcta && google.match.postal_code && /^\d{5}$/.test(google.match.postal_code)) {
    geography = { ...geography, zcta: google.match.postal_code };
  }
  const data: GeocodeData = {
    lat,
    lng,
    matched_address: google.match.formatted_address,
    geography,
    metro: metroFor(lat, lng),
    provider: 'google',
  };
  await ctx.cache.set(CACHE_SOURCE, key, data, GEOCODE_CACHE_TTL_S);
  return okResult(ctx, data, {
    cache: 'miss',
    note: `Census Geocoder 无匹配 → Google Geocoding 回退（$${GOOGLE_GEOCODE_COST_USD}）：${data.matched_address}；GEOID 来自 ${geoSource}：BG ${geography.block_group || '—'} / tract ${geography.tract} / county ${geography.county}`,
    cost_usd: googleCost,
    degraded_from: 'census_geocoder',
    elapsed_ms: Date.now() - started,
  });
}
