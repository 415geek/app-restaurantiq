/**
 * D6 · Google Places API (New) — freshness & quality signals only.
 *
 * Nearby Search (`places:searchNearby`) with a fixed call plan capped by
 * defaults.yaml `data_budget.google_places_max_calls` (6). The field mask is
 * limited to the "Pro" tier (id / name / location / types / rating / count /
 * price / status / hours) — reviews, atmosphere and editorial fields are never
 * requested, which both bounds the SKU and avoids ToS-restricted content.
 *
 * Each *network* call is charged to the ledger at
 * `data_budget.google_places_cost_usd_per_call` (cache hits are free) and
 * cached 30 days by (lat/lng@4dp, includedTypes, radius). Results are deduped
 * by place id across calls; a 403/429 aborts the remaining plan and yields
 * `partial` (some calls succeeded) or `failed` (none did).
 */
import { haversineM } from '@/lib/iq/geo';
import { cuisineById, getDefaults } from '@/lib/iq/params';
import { roundCoord } from '@/lib/funnel/iq-market-cache';
import { fetchWithTimeout } from './context';
import { DATA_SOURCE_NAMES, failed, nowIso, type DataResult, type FetchContext } from './types';

/**
 * Nearby Search (Pro SKU) sits inside Google's monthly free allowance for the
 * volumes this product runs (研发提示词 D6: 免费额度内 → $0). Set
 * GOOGLE_PLACES_BILLED=1 once the account exceeds the allowance and every
 * network call is booked at data_budget.google_places_cost_usd_per_call.
 */
export function perCallCost(ctx: Pick<FetchContext, 'env'>): number {
  const billed = (ctx.env('GOOGLE_PLACES_BILLED') ?? '').toLowerCase();
  return billed === '1' || billed === 'true' ? getDefaults().data_budget.google_places_cost_usd_per_call : 0;
}

export interface GooglePlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  primary_type: string | null;
  types: string[];
  rating: number | null;
  user_rating_count: number | null;
  /** 1 = inexpensive … 4 = very expensive; null when Google omits it. */
  price_level: 1 | 2 | 3 | 4 | null;
  business_status: string | null;
  opening_hours_weekday: string[] | null;
  distance_m: number;
}

export interface GooglePlacesData {
  places: GooglePlace[];
  calls_made: number;
  /** ok | partial | error | no_key */
  api_status: 'ok' | 'partial' | 'error' | 'no_key';
  /** Which plan steps ran, with outcome, for the sources table. */
  calls: PlaceCallOutcome[];
}

export interface GooglePlacesInput {
  lat: number;
  lng: number;
  cuisineId: string;
  /** Hard cap for this request; never exceeds defaults.data_budget.google_places_max_calls. */
  maxCalls?: number;
  /** Override the default plan (used by scripts/snapshot-reviews.ts). */
  plan?: PlaceCall[];
}

export interface PlaceCall {
  includedTypes: string[];
  radiusM: number;
  label: string;
}

export interface PlaceCallOutcome extends PlaceCall {
  cache: 'hit' | 'miss';
  results: number;
  error?: string;
}

const SOURCE_ID = 'D6' as const;
const CACHE_SOURCE = 'iq360_google_places';
const CACHE_TTL_S = 30 * 24 * 3600;
const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const FIELD_MASK =
  'places.id,places.displayName,places.location,places.primaryType,places.types,places.rating,places.userRatingCount,places.priceLevel,places.businessStatus,places.regularOpeningHours';
const LICENSE = 'Google Maps Platform ToS (Places API (New) Nearby Search Pro SKU; no reviews/atmosphere fields)';
const NO_KEY_NOTE = 'GOOGLE_MAPS_API_KEY 未设置：评分类指标标「未获取」';
const ONE_MILE_M = 1609;
const THREE_MILES_M = 4828;

const PRICE_LEVELS: Record<string, 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** Google Places (New) Table A types we already cover generically; a cuisine mapping equal to one of these gets no extra call. */
const GENERIC_TYPES = new Set(['chinese_restaurant', 'restaurant']);

/** Build the ≤ maxCalls plan (§Phase 1 D6). */
export function buildCallPlan(cuisineId: string, maxCalls?: number): PlaceCall[] {
  const cap = Math.max(0, Math.min(maxCalls ?? Infinity, getDefaults().data_budget.google_places_max_calls));
  const plan: PlaceCall[] = [
    { includedTypes: ['chinese_restaurant'], radiusM: ONE_MILE_M, label: 'chinese_restaurant @1mi' },
    { includedTypes: ['chinese_restaurant'], radiusM: THREE_MILES_M, label: 'chinese_restaurant @3mi' },
    { includedTypes: ['restaurant'], radiusM: ONE_MILE_M, label: 'restaurant @1mi' },
    { includedTypes: ['asian_grocery_store', 'supermarket'], radiusM: ONE_MILE_M, label: 'grocery @1mi' },
    { includedTypes: ['bubble_tea_shop', 'dessert_shop'], radiusM: ONE_MILE_M, label: 'boba/dessert @1mi' },
  ];
  const cuisine = cuisineById(cuisineId);
  const specific = cuisine.mappings.find((m) => /_restaurant$|_house$|_cafe$/.test(m) && !GENERIC_TYPES.has(m));
  if (specific) plan.push({ includedTypes: [specific], radiusM: THREE_MILES_M, label: `${specific} @3mi` });
  return plan.slice(0, cap);
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}
interface NearbyResponse {
  places?: RawPlace[];
  error?: { code?: number; message?: string; status?: string };
}

export function toGooglePlace(raw: RawPlace, site: { lat: number; lng: number }): GooglePlace | null {
  if (!raw.id || typeof raw.location?.latitude !== 'number' || typeof raw.location?.longitude !== 'number') return null;
  const lat = raw.location.latitude;
  const lng = raw.location.longitude;
  return {
    id: raw.id,
    name: raw.displayName?.text ?? '',
    lat,
    lng,
    primary_type: raw.primaryType ?? null,
    types: Array.isArray(raw.types) ? raw.types : [],
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    user_rating_count: typeof raw.userRatingCount === 'number' ? raw.userRatingCount : null,
    price_level: raw.priceLevel ? (PRICE_LEVELS[raw.priceLevel] ?? null) : null,
    business_status: raw.businessStatus ?? null,
    opening_hours_weekday: Array.isArray(raw.regularOpeningHours?.weekdayDescriptions)
      ? raw.regularOpeningHours.weekdayDescriptions
      : null,
    distance_m: Math.round(haversineM(site, { lat, lng })),
  };
}

function callCacheKey(site: { lat: number; lng: number }, call: PlaceCall): string {
  return `${roundCoord(site.lat)},${roundCoord(site.lng)}:${[...call.includedTypes].sort().join('+')}:${call.radiusM}`;
}

type CallResult =
  | { ok: true; places: RawPlace[]; cache: 'hit' | 'miss' }
  | { ok: false; status: number; message: string; fatal: boolean };

async function nearby(ctx: FetchContext, key: string, site: { lat: number; lng: number }, call: PlaceCall): Promise<CallResult> {
  const ck = callCacheKey(site, call);
  const cached = await ctx.cache.get<{ places: RawPlace[] }>(CACHE_SOURCE, ck);
  if (cached && Array.isArray(cached.places)) return { ok: true, places: cached.places, cache: 'hit' };

  const cost = perCallCost(ctx);
  const body = {
    includedTypes: call.includedTypes,
    maxResultCount: 20,
    locationRestriction: { circle: { center: { latitude: site.lat, longitude: site.lng }, radius: call.radiusM } },
  };
  let res: Response;
  try {
    res = await fetchWithTimeout(ctx, NEARBY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify(body),
      timeoutMs: Math.min(10_000, ctx.budgetMs),
    });
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? 'timeout' : String((err as Error)?.message ?? err);
    return { ok: false, status: 0, message: msg, fatal: false };
  }
  // Charged whenever a request reached Google — the conservative direction for the cost cap.
  ctx.cost.add(SOURCE_ID, cost, `Nearby ${call.label} → HTTP ${res.status}`);

  let json: NearbyResponse = {};
  try {
    json = (await res.json()) as NearbyResponse;
  } catch {
    /* empty body is valid for zero results */
  }
  if (!res.ok) {
    const message = json.error?.message ?? `HTTP ${res.status}`;
    const status = json.error?.status ? `${json.error.status}: ${message}` : message;
    return { ok: false, status: res.status, message: status, fatal: res.status === 403 || res.status === 429 || res.status === 401 };
  }
  const places = Array.isArray(json.places) ? json.places : [];
  await ctx.cache.set(CACHE_SOURCE, ck, { places }, CACHE_TTL_S);
  return { ok: true, places, cache: 'miss' };
}

export async function fetchGooglePlaces(input: GooglePlacesInput, ctx: FetchContext): Promise<DataResult<GooglePlacesData>> {
  const t0 = Date.now();
  const site = { lat: input.lat, lng: input.lng };
  const base = { id: SOURCE_ID, name: DATA_SOURCE_NAMES[SOURCE_ID], license: LICENSE, fetched_at: nowIso(ctx) };
  const key = ctx.env('GOOGLE_MAPS_API_KEY');
  if (!key) {
    return failed(SOURCE_ID, ctx, { source: 'Google Places API (New) Nearby Search', license: LICENSE, note: NO_KEY_NOTE, error: 'no api key' });
  }

  const maxCalls = Math.min(input.maxCalls ?? Infinity, getDefaults().data_budget.google_places_max_calls);
  const plan = (input.plan ?? buildCallPlan(input.cuisineId, input.maxCalls)).slice(0, Math.max(0, maxCalls));
  const byId = new Map<string, GooglePlace>();
  const outcomes: PlaceCallOutcome[] = [];
  const errors: string[] = [];
  let networkCalls = 0;
  let succeeded = 0;
  let cacheHits = 0;
  let fatal: string | null = null;

  for (const call of plan) {
    const r = await nearby(ctx, key, site, call);
    if (r.ok) {
      succeeded++;
      if (r.cache === 'hit') cacheHits++;
      else networkCalls++;
      let n = 0;
      for (const raw of r.places) {
        const p = toGooglePlace(raw, site);
        if (!p) continue;
        n++;
        const prev = byId.get(p.id);
        // Keep the richer record (more types / has rating) when the same place appears twice.
        if (!prev || (prev.rating == null && p.rating != null) || p.types.length > prev.types.length) byId.set(p.id, p);
      }
      outcomes.push({ ...call, cache: r.cache, results: n });
      continue;
    }
    if (r.status !== 0) networkCalls++;
    outcomes.push({ ...call, cache: 'miss', results: 0, error: r.message });
    errors.push(`${call.label}: ${r.message}`);
    if (r.fatal) {
      fatal = r.message;
      break;
    }
  }

  const places = [...byId.values()].sort((a, b) => a.distance_m - b.distance_m);
  const costUsd = Math.round(networkCalls * perCallCost(ctx) * 10_000) / 10_000;
  const source = 'Google Places API (New) Nearby Search · Pro field mask';
  const cache: DataResult<GooglePlacesData>['cache'] = cacheHits > 0 ? 'hit' : 'miss';

  if (succeeded === 0) {
    return {
      ...failed<GooglePlacesData>(SOURCE_ID, ctx, {
        source,
        license: LICENSE,
        note: `Google Places 调用失败（${fatal ?? (errors.join('；') || '未知')}）：评分类指标标「未获取」`,
        error: fatal ?? errors.join('; '),
        cost_usd: costUsd,
      }),
      data: { places: [], calls_made: networkCalls, api_status: 'error', calls: outcomes },
      elapsed_ms: Date.now() - t0,
    };
  }

  const closed = places.filter((p) => p.business_status === 'CLOSED_PERMANENTLY').length;
  const notes = [
    `${plan.length} 步计划：成功 ${succeeded}（网络 ${networkCalls}，缓存 ${cacheHits}），去重后 ${places.length} 个地点，其中永久关闭 ${closed} 个。`,
  ];
  const data: GooglePlacesData = {
    places,
    calls_made: networkCalls,
    api_status: errors.length ? 'partial' : 'ok',
    calls: outcomes,
  };
  if (errors.length) {
    notes.push(`未完成：${errors.join('；')}${fatal ? '（已中止剩余调用）' : ''}。受影响类型的地点缺失，不做补估。`);
    return {
      ...base,
      status: 'partial',
      data,
      source,
      cost_usd: costUsd,
      coverage_note: notes.join(' '),
      cache,
      error: errors.join('; '),
      elapsed_ms: Date.now() - t0,
    };
  }
  return {
    ...base,
    status: 'ok',
    data,
    source,
    cost_usd: costUsd,
    coverage_note: notes.join(' '),
    cache,
    elapsed_ms: Date.now() - t0,
  };
}
