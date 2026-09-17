/**
 * D6 · Google Places API (New) — competitor retrieval + freshness & quality signals.
 *
 * 评审 Spec §4.2 「竞品检索：先近后远、先同品类后替代，距离用路网」. The call plan
 * (capped by defaults.yaml `data_budget.google_places_max_calls`, 8) is layered:
 *
 *   Layer 1 直接竞品   Text Search for the concept's Layer-1 keyword, *restricted* to
 *                      800 m; widened to 1600 m only when fewer than 5 hits          → layer 'direct'
 *   Layer 2 替代竞品   same category, other subtypes: Nearby (Table A types) and/or a
 *                      Text Search for the free-text substitutes, 1600 m             → layer 'substitute'
 *   Layer 3 品牌锚点   the Layer-1 query biased city-wide (8 km); the fetcher tags the
 *                      hits and the caller keeps ≥ 500 reviews, top 5 by review count → layer 'brand_anchor'
 *   L3 / L4            restaurant @1 mi (occasion substitutes) and the community anchors
 *                      (Chinese grocers / tea & dessert, or general anchors)           → 'l3' / 'l4'
 *
 * Nearby is preferred wherever Table A types suffice (cheaper, no keyword). The
 * field mask stays on id / name / address / location / types / rating / count /
 * price / status / hours, plus the ONE field §4.2 品类空白判定 needs —
 * `places.reviews` — whose text is the only evidence that a same-category store
 * (a Chinese bakery) also sells the concept (egg tarts). Review text is trimmed
 * to `REVIEW_TEXTS_PER_PLACE` × `REVIEW_TEXT_MAX_CHARS` before it is cached or
 * returned; no other atmosphere field is requested and no extra call is made.
 * Each *network* call is charged to the ledger at
 * `data_budget.google_places_cost_usd_per_call` (cache hits are free) and cached
 * 30 days by (lat/lng@4dp, query or types, radius, restriction). Results are
 * deduped by place id across calls keeping the richer record and the union of
 * the layers that returned it; a 401/403/429 aborts the remaining plan and yields
 * `partial` (some calls succeeded) or `failed` (none did).
 */
import { classifyConceptSync } from '@/lib/iq/concept/classify';
import { haversineM } from '@/lib/iq/geo';
import { getDefaults, getTaxonomy } from '@/lib/iq/params';
import { roundCoord } from '@/lib/funnel/iq-market-cache';
import { fetchWithTimeout } from './context';
import { fetchWalkingDistances, type WalkLeg } from './distance-matrix';
import { conceptSearchProfile, isChineseCategory, matchesLayer1, textSearchProfile, type ConceptSearchProfile } from './search-profile';
import { DATA_SOURCE_NAMES, failed, nowIso, type DataResult, type DataStatus, type FetchContext } from './types';

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

/** Which §4.2 layer a plan step feeds; every hit is tagged with the layers of the calls that returned it. */
export type PlaceLayer = 'direct' | 'substitute' | 'brand_anchor' | 'l3' | 'l4' | 'user';

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
  formatted_address: string | null;
  /** Straight-line distance from the site, metres. */
  distance_m: number;
  /** Layers of the plan steps that returned this place (union across calls). */
  layers: PlaceLayer[];
  /** Walking leg from the site when the Distance Matrix ran for this place (fetchThreeLayerCompetitors). */
  walk_m?: number | null;
  walk_min?: number | null;
  /**
   * §4.2 category-gap text probe: up to REVIEW_TEXTS_PER_PLACE review snippets.
   * An empty array means Google returned no review text for this place — the
   * probe result is `unknown`, never "does not sell it".
   */
  review_texts: string[];
  /** Editorial summary when Google carries one (some records only). */
  editorial_summary: string | null;
}

export interface GooglePlacesData {
  places: GooglePlace[];
  calls_made: number;
  /** ok | partial | error | no_key */
  api_status: 'ok' | 'partial' | 'error' | 'no_key';
  /** Which plan steps ran, with outcome, for the sources table. */
  calls: PlaceCallOutcome[];
  /** Largest Layer-1 radius that was searched successfully (null when no direct step completed). */
  l1_search_radius_m: number | null;
  /** Direct-layer steps that completed, e.g. ['direct@800', 'direct@1600'] — a void claim needs both. */
  l1_layers_tried: string[];
}

export interface GooglePlacesInput {
  lat: number;
  lng: number;
  cuisineId: string;
  /**
   * Hard cap for this request. With the default plan it never exceeds
   * defaults.data_budget.google_places_max_calls; an explicit `plan` carries its
   * own budget (index.ts appends ≤ 3 user-named competitor Text Searches).
   */
  maxCalls?: number;
  /** Override the default plan (used by scripts/snapshot-reviews.ts and user-named competitors). */
  plan?: PlaceCall[];
}

export interface PlaceCall {
  includedTypes: string[];
  radiusM: number;
  label: string;
  /** When set, the call uses Text Search (New) with this query instead of Nearby. */
  textQuery?: string;
  /** §4.2 layer the step feeds (hits are tagged with it). */
  layer?: PlaceLayer;
  /** Text Search only: restrict to the circle (rectangle restriction + client-side circle filter) instead of merely biasing. */
  restrict?: boolean;
  /** 先近后远: run only when fewer than this many places tagged with `layer` have been found by the earlier steps. */
  only_if_fewer_than?: number;
}

export interface PlaceCallOutcome extends PlaceCall {
  cache: 'hit' | 'miss' | 'skipped';
  results: number;
  error?: string;
}

const SOURCE_ID = 'D6' as const;
const CACHE_SOURCE = 'iq360_google_places';
const CACHE_TTL_S = 30 * 24 * 3600;
const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.rating,places.userRatingCount,places.priceLevel,places.businessStatus,places.regularOpeningHours,places.reviews';
const LICENSE = 'Google Maps Platform ToS (Places API (New) Nearby / Text Search; Pro fields + places.reviews for the §4.2 category-gap text probe)';
/** §4.2 text probe: how much review text is kept per place (the rest is dropped before caching). */
export const REVIEW_TEXTS_PER_PLACE = 3;
export const REVIEW_TEXT_MAX_CHARS = 240;
const NO_KEY_NOTE = 'GOOGLE_MAPS_API_KEY 未设置：评分类指标标「未获取」';
const ONE_MILE_M = 1609;
const THREE_MILES_M = 4828;

/** §4.2 radii and thresholds. */
export const L1_RADIUS_NEAR_M = 800;
export const L1_RADIUS_FAR_M = 1600;
export const L2_RADIUS_M = 1600;
export const BRAND_ANCHOR_BIAS_M = 8000;
export const L1_MIN_HITS_BEFORE_WIDENING = 5;
export const BRAND_ANCHOR_MIN_REVIEWS = 500;
export const BRAND_ANCHOR_TOP_N = 5;

const PRICE_LEVELS: Record<string, 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** Build the layered plan for a concept profile (§4.2), capped at `maxCalls`. */
export function buildCallPlanForProfile(p: ConceptSearchProfile, maxCalls?: number): PlaceCall[] {
  const cap = Math.max(0, Math.min(maxCalls ?? Infinity, getDefaults().data_budget.google_places_max_calls));
  const anchors = getTaxonomy().l4_anchors;
  const chinese = isChineseCategory(p.category);
  const plan: PlaceCall[] = [
    { includedTypes: p.types, radiusM: L1_RADIUS_NEAR_M, label: `direct@${L1_RADIUS_NEAR_M}`, textQuery: p.query, layer: 'direct', restrict: true },
    { includedTypes: p.types, radiusM: L1_RADIUS_FAR_M, label: `direct@${L1_RADIUS_FAR_M}`, textQuery: p.query, layer: 'direct', restrict: true, only_if_fewer_than: L1_MIN_HITS_BEFORE_WIDENING },
  ];
  if (p.substitute_types.length) plan.push({ includedTypes: p.substitute_types, radiusM: L2_RADIUS_M, label: `substitute@${L2_RADIUS_M}`, layer: 'substitute' });
  if (p.substitute_terms.length) plan.push({ includedTypes: [], radiusM: L2_RADIUS_M, label: `substitute:text@${L2_RADIUS_M}`, textQuery: p.substitute_terms[0], layer: 'substitute', restrict: true });
  plan.push({ includedTypes: p.types, radiusM: BRAND_ANCHOR_BIAS_M, label: `brand_anchor@${BRAND_ANCHOR_BIAS_M}`, textQuery: p.query, layer: 'brand_anchor' });
  plan.push({ includedTypes: ['restaurant'], radiusM: ONE_MILE_M, label: 'restaurant @1mi', layer: 'l3' });
  if (p.audience === 'general') {
    plan.push({ includedTypes: anchors.general_types, radiusM: ONE_MILE_M, label: 'anchors:general @1mi', layer: 'l4' });
  } else {
    plan.push({ includedTypes: ['asian_grocery_store', 'supermarket'], radiusM: ONE_MILE_M, label: 'grocery @1mi', layer: 'l4' });
    // Places (New) Table A has no bubble_tea_shop; tea_house + dessert_shop cover boba/dessert anchors.
    plan.push({ includedTypes: ['tea_house', 'dessert_shop'], radiusM: ONE_MILE_M, label: 'tea/dessert @1mi', layer: 'l4' });
  }
  // Chinese concepts: the wider Chinese pool feeds the drive-10 density / closure metrics (§3.5).
  if (chinese) plan.push({ includedTypes: ['chinese_restaurant'], radiusM: THREE_MILES_M, label: 'chinese_restaurant @3mi', layer: 'substitute' });
  return plan.slice(0, cap);
}

/** Build the ≤ maxCalls plan for a taxonomy id (§Phase 1 D6 → §4.2). */
export function buildCallPlan(cuisineId: string, maxCalls?: number): PlaceCall[] {
  return buildCallPlanForProfile(conceptSearchProfile(cuisineId), maxCalls);
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  /** §4.2 text probe (field mask `places.reviews`); trimmed by `slimRawPlace` before caching. */
  reviews?: Array<{ text?: { text?: string; languageCode?: string }; originalText?: { text?: string } }>;
  /** Only present on records Google carries a summary for; never requested on its own. */
  editorialSummary?: { text?: string };
}
interface NearbyResponse {
  places?: RawPlace[];
  error?: { code?: number; message?: string; status?: string };
}

/** Review texts a raw record carries, trimmed to the probe budget (original language preferred, then the translation). */
export function reviewTextsOf(raw: RawPlace): string[] {
  if (!Array.isArray(raw.reviews)) return [];
  const out: string[] = [];
  for (const r of raw.reviews) {
    const t = (r?.originalText?.text ?? r?.text?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    out.push(t.slice(0, REVIEW_TEXT_MAX_CHARS));
    if (out.length >= REVIEW_TEXTS_PER_PLACE) break;
  }
  return out;
}

/** Drop everything the report never reads before the raw response goes into the 30-day cache. */
export function slimRawPlace(raw: RawPlace): RawPlace {
  const texts = reviewTextsOf(raw);
  const slim: RawPlace = { ...raw };
  if (texts.length) slim.reviews = texts.map((t) => ({ text: { text: t } }));
  else delete slim.reviews;
  return slim;
}

export function toGooglePlace(raw: RawPlace, site: { lat: number; lng: number }, layers: PlaceLayer[] = []): GooglePlace | null {
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
    opening_hours_weekday: Array.isArray(raw.regularOpeningHours?.weekdayDescriptions) ? raw.regularOpeningHours.weekdayDescriptions : null,
    formatted_address: typeof raw.formattedAddress === 'string' ? raw.formattedAddress : null,
    distance_m: Math.round(haversineM(site, { lat, lng })),
    layers: [...layers],
    review_texts: reviewTextsOf(raw),
    editorial_summary: raw.editorialSummary?.text?.trim() || null,
  };
}

function callCacheKey(site: { lat: number; lng: number }, call: PlaceCall): string {
  const what = call.textQuery ? `text=${call.textQuery}${call.includedTypes.length === 1 ? `+${call.includedTypes[0]}` : ''}` : [...call.includedTypes].sort().join('+');
  return `${roundCoord(site.lat)},${roundCoord(site.lng)}:${what}:${call.radiusM}${call.restrict ? ':r' : ''}`;
}

/** Bounding rectangle of the circle — Text Search (New) only restricts by rectangle; the circle is enforced client-side. */
export function rectangleAround(site: { lat: number; lng: number }, radiusM: number): { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.1, Math.cos((site.lat * Math.PI) / 180)));
  return { low: { latitude: site.lat - dLat, longitude: site.lng - dLng }, high: { latitude: site.lat + dLat, longitude: site.lng + dLng } };
}

type CallResult =
  | { ok: true; places: RawPlace[]; cache: 'hit' | 'miss' }
  | { ok: false; status: number; message: string; fatal: boolean };

async function nearby(ctx: FetchContext, key: string, site: { lat: number; lng: number }, call: PlaceCall): Promise<CallResult> {
  const ck = callCacheKey(site, call);
  const cached = await ctx.cache.get<{ places: RawPlace[] }>(CACHE_SOURCE, ck);
  if (cached && Array.isArray(cached.places)) return { ok: true, places: cached.places, cache: 'hit' };

  const cost = perCallCost(ctx);
  const circle = { center: { latitude: site.lat, longitude: site.lng }, radius: call.radiusM };
  const body = call.textQuery
    ? {
        textQuery: call.textQuery,
        ...(call.includedTypes.length === 1 ? { includedType: call.includedTypes[0] } : {}),
        maxResultCount: 20,
        ...(call.restrict ? { locationRestriction: { rectangle: rectangleAround(site, call.radiusM) } } : { locationBias: { circle } }),
      }
    : { includedTypes: call.includedTypes, maxResultCount: 20, locationRestriction: { circle } };
  let res: Response;
  try {
    res = await fetchWithTimeout(ctx, call.textQuery ? TEXT_URL : NEARBY_URL, {
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
  ctx.cost.add(SOURCE_ID, cost, `${call.textQuery ? 'TextSearch' : 'Nearby'} ${call.label} → HTTP ${res.status}`);

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
  const places = (Array.isArray(json.places) ? json.places : []).map(slimRawPlace);
  await ctx.cache.set(CACHE_SOURCE, ck, { places }, CACHE_TTL_S);
  return { ok: true, places, cache: 'miss' };
}

/** Merge a hit into the pool: keep the richer record, union the layers. */
function mergePlace(byId: Map<string, GooglePlace>, p: GooglePlace): void {
  const prev = byId.get(p.id);
  if (!prev) {
    byId.set(p.id, p);
    return;
  }
  const layers = [...new Set([...prev.layers, ...p.layers])];
  const richer = (prev.rating == null && p.rating != null) || p.types.length > prev.types.length ? p : prev;
  // §4.2 probe text is evidence: keep whichever call returned it (one call may omit reviews the other carried).
  const review_texts = [...new Set([...prev.review_texts, ...p.review_texts])].slice(0, REVIEW_TEXTS_PER_PLACE);
  byId.set(p.id, {
    ...richer,
    layers,
    review_texts,
    editorial_summary: richer.editorial_summary ?? prev.editorial_summary ?? p.editorial_summary,
    formatted_address: richer.formatted_address ?? prev.formatted_address ?? p.formatted_address,
  });
}

export async function fetchGooglePlaces(input: GooglePlacesInput, ctx: FetchContext): Promise<DataResult<GooglePlacesData>> {
  const t0 = Date.now();
  const site = { lat: input.lat, lng: input.lng };
  const base = { id: SOURCE_ID, name: DATA_SOURCE_NAMES[SOURCE_ID], license: LICENSE, fetched_at: nowIso(ctx) };
  const key = ctx.env('GOOGLE_MAPS_API_KEY');
  if (!key) {
    return failed(SOURCE_ID, ctx, { source: 'Google Places API (New) Nearby / Text Search', license: LICENSE, note: NO_KEY_NOTE, error: 'no api key' });
  }

  const defaultCap = getDefaults().data_budget.google_places_max_calls;
  // An explicit plan is trusted to size its own budget (caller passes maxCalls); the default plan is always yaml-capped.
  const maxCalls = input.plan ? (input.maxCalls ?? defaultCap) : Math.min(input.maxCalls ?? Infinity, defaultCap);
  const plan = (input.plan ?? buildCallPlan(input.cuisineId, input.maxCalls)).slice(0, Math.max(0, maxCalls));
  const byId = new Map<string, GooglePlace>();
  const outcomes: PlaceCallOutcome[] = [];
  const errors: string[] = [];
  const l1Tried: string[] = [];
  let l1Radius: number | null = null;
  let networkCalls = 0;
  let succeeded = 0;
  let cacheHits = 0;
  let fatal: string | null = null;

  const layerCount = (layer: PlaceLayer) => [...byId.values()].filter((p) => p.layers.includes(layer)).length;

  for (const call of plan) {
    // 先近后远: the wider Layer-1 radius runs only when the near one came back thin.
    if (call.only_if_fewer_than != null && call.layer && layerCount(call.layer) >= call.only_if_fewer_than) {
      outcomes.push({ ...call, cache: 'skipped', results: 0 });
      continue;
    }
    const r = await nearby(ctx, key, site, call);
    if (r.ok) {
      succeeded++;
      if (r.cache === 'hit') cacheHits++;
      else networkCalls++;
      let n = 0;
      for (const raw of r.places) {
        const p = toGooglePlace(raw, site, call.layer ? [call.layer] : []);
        if (!p) continue;
        // A restricted Text Search is only rectangle-restricted by Google: enforce the circle here.
        if (call.restrict && p.distance_m > call.radiusM) continue;
        n++;
        mergePlace(byId, p);
      }
      outcomes.push({ ...call, cache: r.cache, results: n });
      if (call.layer === 'direct') {
        l1Tried.push(call.label);
        l1Radius = Math.max(l1Radius ?? 0, call.radiusM);
      }
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
  const source = 'Google Places API (New) Nearby / Text Search · Pro field mask';
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
      data: { places: [], calls_made: networkCalls, api_status: 'error', calls: outcomes, l1_search_radius_m: null, l1_layers_tried: [] },
      elapsed_ms: Date.now() - t0,
    };
  }

  const closed = places.filter((p) => p.business_status === 'CLOSED_PERMANENTLY').length;
  const ran = outcomes.filter((o) => o.cache !== 'skipped').length;
  const direct = layerCount('direct');
  const notes = [
    `${plan.length} 步计划（执行 ${ran}）：成功 ${succeeded}（网络 ${networkCalls}，缓存 ${cacheHits}），去重后 ${places.length} 个地点，其中永久关闭 ${closed} 个。`,
    l1Radius != null ? `直接竞品关键词检索 ${l1Tried.map((l) => l.replace('direct@', '')).join(' → ')} m，命中 ${direct} 家。` : '直接竞品关键词检索未完成。',
  ];
  const data: GooglePlacesData = {
    places,
    calls_made: networkCalls,
    api_status: errors.length ? 'partial' : 'ok',
    calls: outcomes,
    l1_search_radius_m: l1Radius,
    l1_layers_tried: l1Tried,
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

/* ------------------------------------------------------------------ */
/* Three-layer competitor set (shared by both report tiers)              */
/* ------------------------------------------------------------------ */

function isOpen(p: GooglePlace): boolean {
  return !/CLOSED_PERMANENTLY/i.test(p.business_status ?? '');
}

/**
 * Split a fetched pool into the §4.2 layers with the shared recognition rule.
 * Pure; the CompetitorEngine applies the same rule on the merged Overture ∪
 * Google pool, this is the Google-only version tier 2 relies on.
 */
export function layerPlaces(places: GooglePlace[], profile: ConceptSearchProfile): { direct: GooglePlace[]; substitute: GooglePlace[]; brand_anchors: GooglePlace[] } {
  const direct = places.filter((p) => isOpen(p) && p.layers.includes('direct') && p.distance_m <= L1_RADIUS_FAR_M && matchesLayer1(p.name, [p.primary_type, ...p.types], profile));
  const directIds = new Set(direct.map((p) => p.id));
  const substitute = places.filter((p) => isOpen(p) && !directIds.has(p.id) && p.layers.includes('substitute') && p.distance_m <= L2_RADIUS_M);
  const brand_anchors = places
    .filter((p) => isOpen(p) && p.layers.includes('brand_anchor') && (p.user_rating_count ?? 0) >= BRAND_ANCHOR_MIN_REVIEWS && matchesLayer1(p.name, [p.primary_type, ...p.types], profile))
    .sort((a, b) => (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0) || a.distance_m - b.distance_m)
    .slice(0, BRAND_ANCHOR_TOP_N);
  return { direct, substitute, brand_anchors };
}

export interface ThreeLayerInput {
  lat: number;
  lng: number;
  /** Taxonomy id when known (report 360 / confirmed concept). */
  conceptId?: string | null;
  /** Free text when the id is unknown (tier 2 business type); resolved with classifyConceptSync, else searched verbatim. */
  text?: string | null;
  maxCalls?: number;
  /** Skip the Distance Matrix leg (default: run it for Layer 1 + 2 within 1600 m). */
  walking?: boolean;
}

export interface ThreeLayerCompetitors {
  concept: { id: string; label_en: string; label_zh: string; category: string; resolved_by: 'id' | 'text' | 'verbatim' };
  profile: ConceptSearchProfile;
  direct: GooglePlace[];
  substitute: GooglePlace[];
  brand_anchors: GooglePlace[];
  /** Every deduped place the plan returned (L3 / L4 pools included). */
  places: GooglePlace[];
  l1_search_radius_m: number | null;
  l1_layers_tried: string[];
  /** Walking legs by place id (Layer 1 + 2 within 1600 m). */
  walk: Record<string, WalkLeg>;
  status: DataStatus;
  api_status: GooglePlacesData['api_status'];
  calls: PlaceCallOutcome[];
  calls_made: number;
  cost_usd: number;
  note: string;
}

function resolveProfile(input: Pick<ThreeLayerInput, 'conceptId' | 'text'>): { profile: ConceptSearchProfile; resolved_by: ThreeLayerCompetitors['concept']['resolved_by'] } {
  const known = new Set(getTaxonomy().cuisines.map((c) => c.id));
  if (input.conceptId && known.has(input.conceptId)) return { profile: conceptSearchProfile(input.conceptId), resolved_by: 'id' };
  const text = (input.text ?? '').trim();
  if (text) {
    const hit = classifyConceptSync(text);
    if (!hit.needs_confirmation && known.has(hit.id)) return { profile: conceptSearchProfile(hit.id), resolved_by: 'text' };
    return { profile: textSearchProfile(text), resolved_by: 'verbatim' };
  }
  return { profile: conceptSearchProfile('other_chinese'), resolved_by: 'id' };
}

/**
 * §4.2 three-layer competitor retrieval around a point: the layered plan, the
 * shared recognition rule, and walking legs for Layer 1 + 2 within 1600 m.
 * Reused by report 360 (through fetchGooglePlaces + the engine) and by the
 * tier-2 market snapshot (lib/funnel/iq-market-data.ts).
 */
export async function fetchThreeLayerCompetitors(input: ThreeLayerInput, ctx: FetchContext): Promise<ThreeLayerCompetitors> {
  const { profile, resolved_by } = resolveProfile(input);
  const concept = { id: profile.id, label_en: profile.label_en, label_zh: profile.label_zh, category: profile.category, resolved_by };
  const plan = buildCallPlanForProfile(profile, input.maxCalls);
  const r = await fetchGooglePlaces({ lat: input.lat, lng: input.lng, cuisineId: profile.id, maxCalls: plan.length, plan }, ctx);
  const data = r.data ?? { places: [], calls_made: 0, api_status: r.error === 'no api key' ? ('no_key' as const) : ('error' as const), calls: [], l1_search_radius_m: null, l1_layers_tried: [] };
  const layered = layerPlaces(data.places, profile);
  let walk: Record<string, WalkLeg> = {};
  let walkNote = '';
  if (input.walking !== false && r.data) {
    const targets = [...layered.direct, ...layered.substitute].filter((p) => p.distance_m <= L1_RADIUS_FAR_M).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }));
    if (targets.length) {
      const w = await fetchWalkingDistances({ origin: { lat: input.lat, lng: input.lng }, destinations: targets }, ctx);
      walk = w.walk;
      walkNote = w.note;
      for (const list of [layered.direct, layered.substitute]) {
        for (const p of list) {
          const leg = walk[p.id];
          p.walk_m = leg?.walk_m ?? null;
          p.walk_min = leg?.walk_min ?? null;
        }
      }
    }
  }
  const byWalk = (a: GooglePlace, b: GooglePlace) => (a.walk_m ?? a.distance_m) - (b.walk_m ?? b.distance_m);
  return {
    concept,
    profile,
    direct: [...layered.direct].sort(byWalk),
    substitute: [...layered.substitute].sort(byWalk),
    brand_anchors: layered.brand_anchors,
    places: data.places,
    l1_search_radius_m: data.l1_search_radius_m,
    l1_layers_tried: data.l1_layers_tried,
    walk,
    status: r.status,
    api_status: data.api_status,
    calls: data.calls,
    calls_made: data.calls_made,
    cost_usd: r.cost_usd,
    note: [r.coverage_note, walkNote].filter(Boolean).join(' '),
  };
}
