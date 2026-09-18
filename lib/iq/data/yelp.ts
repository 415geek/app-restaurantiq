/**
 * D13 · Yelp Fusion — the independent second retrieval source (底层重构 §3.1 / §3.2).
 *
 * Why a second source at all. Google Text Search matches what a business is
 * *called*: measured at 900 Grant Ave, `"egg tart"` returned 0 results because
 * nothing in "Golden Gate Bakery" says egg tart in English. Yelp matches what a
 * business *sells* — the same query returns 241 businesses there, Golden Gate
 * Bakery first, and it surfaces Good Mong Kok Bakery (158 m, 3,883 reviews),
 * which no Google Layer-1 alias returned. The two engines fail differently, and
 * §3.2 asks a negative claim to survive both before it may be printed.
 *
 * Scope is deliberately narrow: this fetches Layer-1 candidates for the concept
 * and nothing else. Ratings and review counts stay attributed to Yelp rather
 * than averaged into Google's — the two populations differ by 3× on the same
 * shop, so mixing them would produce a number neither platform would recognise.
 *
 * Yelp's free tier allows 5,000 calls/day and its search returns at most 50 per
 * call, so the §3.1 truncation contract applies here too: a call that comes back
 * at the cap has not exhausted its area and says so.
 */
import { conceptSearchProfile, type ConceptSearchProfile } from './search-profile';
import { fetchWithTimeout } from './context';
import { DATA_SOURCE_NAMES, failed, nowIso, type DataResult, type FetchContext } from './types';
import { haversineM } from '../geo';

const SOURCE_ID = 'D13' as const;
const CACHE_SOURCE = 'iq360_yelp';
const CACHE_TTL_S = 7 * 24 * 3600;
const SEARCH_URL = 'https://api.yelp.com/v3/businesses/search';
const LICENSE = 'Yelp Fusion API Terms of Use (display requires attribution; data may not be redistributed)';
const NO_KEY_NOTE = 'YELP_API_KEY 未设置：Yelp 作为第二检索源未启用，否定性结论仅有单一来源';
/** Yelp Fusion returns at most this many businesses per search call. */
export const YELP_PER_CALL_CAP = 50;
/** Layer-1 radius, metres. Yelp caps `radius` at 40000. */
export const YELP_RADIUS_M = 1600;

export interface YelpPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  categories: string[];
  rating: number | null;
  review_count: number | null;
  price_level: number | null;
  distance_m: number;
  is_closed: boolean;
  /** The alias query that returned it, for the sources table. */
  matched_query: string;
}

export interface YelpData {
  places: YelpPlace[];
  calls_made: number;
  /** §3.1: a search came back at Yelp's per-call cap, so its area is not exhausted. */
  pool_truncated: boolean;
  truncated_queries: string[];
  queries_tried: string[];
}

interface RawYelpBusiness {
  id?: string;
  name?: string;
  coordinates?: { latitude?: number; longitude?: number };
  categories?: Array<{ alias?: string; title?: string }>;
  rating?: number;
  review_count?: number;
  price?: string;
  distance?: number;
  is_closed?: boolean;
}

/**
 * Yelp category aliases → Places (New) Table A types. The layer rules are written
 * against Google's vocabulary, so an unmapped Yelp record merging onto a Google
 * one can overwrite `bakery` with `bakeries` and drop the merged shop out of
 * Layer 1 — adding a source would then *reduce* the competitor count. Only the
 * aliases the concept taxonomy actually searches for are mapped; anything else
 * is carried through unchanged and simply never matches a type rule.
 */
export const YELP_ALIAS_TO_TABLE_A: Record<string, string> = {
  bakeries: 'bakery',
  desserts: 'dessert_shop',
  icecream: 'ice_cream_shop',
  gelato: 'ice_cream_shop',
  donuts: 'donut_shop',
  bagels: 'bagel_shop',
  coffee: 'coffee_shop',
  cafes: 'cafe',
  hkcafe: 'cafe',
  bubbletea: 'tea_house',
  tea: 'tea_house',
  juicebars: 'juice_shop',
  chinese: 'chinese_restaurant',
  cantonese: 'chinese_restaurant',
  szechuan: 'chinese_restaurant',
  hunan: 'chinese_restaurant',
  shanghainese: 'chinese_restaurant',
  dimsum: 'chinese_restaurant',
  hotpot: 'chinese_restaurant',
  noodles: 'chinese_restaurant',
  taiwanese: 'chinese_restaurant',
  japanese: 'japanese_restaurant',
  korean: 'korean_restaurant',
  vietnamese: 'vietnamese_restaurant',
  thai: 'thai_restaurant',
  ramen: 'ramen_restaurant',
  sushi: 'sushi_restaurant',
  pizza: 'pizza_restaurant',
  mexican: 'mexican_restaurant',
  italian: 'italian_restaurant',
  sandwiches: 'sandwich_shop',
  delis: 'deli',
  burgers: 'hamburger_restaurant',
  breakfast_brunch: 'breakfast_restaurant',
  seafood: 'seafood_restaurant',
  steak: 'steak_house',
  bbq: 'barbecue_restaurant',
  vegan: 'vegan_restaurant',
  vegetarian: 'vegetarian_restaurant',
  restaurants: 'restaurant',
};

/** A Yelp record's categories in Google's type vocabulary, originals kept alongside. */
export function mapYelpCategories(aliases: string[]): string[] {
  const out: string[] = [];
  for (const a of aliases) {
    const mapped = YELP_ALIAS_TO_TABLE_A[a];
    if (mapped && !out.includes(mapped)) out.push(mapped);
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

export function toYelpPlace(raw: RawYelpBusiness, site: { lat: number; lng: number }, query: string): YelpPlace | null {
  const lat = raw.coordinates?.latitude;
  const lng = raw.coordinates?.longitude;
  if (!raw.id || typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    id: raw.id,
    name: raw.name ?? '',
    lat,
    lng,
    categories: mapYelpCategories((raw.categories ?? []).map((c) => c.alias ?? '').filter(Boolean)),
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    review_count: typeof raw.review_count === 'number' ? raw.review_count : null,
    // Yelp prices are "$".."$$$$"; Google's are 1..4. Same scale, different spelling.
    price_level: raw.price ? Math.min(4, Math.max(1, raw.price.length)) : null,
    distance_m: typeof raw.distance === 'number' ? Math.round(raw.distance) : Math.round(haversineM(site, { lat, lng })),
    is_closed: raw.is_closed === true,
    matched_query: query,
  };
}

export interface YelpInput {
  lat: number;
  lng: number;
  cuisineId: string;
  /** Override the alias set (defaults to the concept profile's §3.2 queries). */
  queries?: string[];
}

/**
 * Fetch Layer-1 candidates from Yelp for the concept's alias set. Never throws:
 * a missing key or a failed call degrades the source and is reported, because a
 * second opinion that silently disappears is worse than none.
 */
export async function fetchYelpCompetitors(input: YelpInput, ctx: FetchContext): Promise<DataResult<YelpData>> {
  const t0 = Date.now();
  const site = { lat: input.lat, lng: input.lng };
  const base = { id: SOURCE_ID, name: DATA_SOURCE_NAMES[SOURCE_ID], license: LICENSE, fetched_at: nowIso(ctx) };
  const key = ctx.env('YELP_API_KEY');
  const profile: ConceptSearchProfile = conceptSearchProfile(input.cuisineId);
  const queries = (input.queries ?? profile.queries).filter(Boolean);

  if (!key) {
    return failed(SOURCE_ID, ctx, { source: 'Yelp Fusion /businesses/search', license: LICENSE, note: NO_KEY_NOTE, error: 'no api key' });
  }

  const byId = new Map<string, YelpPlace>();
  const truncatedQueries: string[] = [];
  const errors: string[] = [];
  let calls = 0;

  for (const q of queries) {
    const ck = `${input.lat.toFixed(4)},${input.lng.toFixed(4)}:${q}:${YELP_RADIUS_M}`;
    const cached = await ctx.cache.get<{ businesses: RawYelpBusiness[] }>(CACHE_SOURCE, ck);
    let businesses: RawYelpBusiness[] | null = cached?.businesses ?? null;

    if (!businesses) {
      const url = new URL(SEARCH_URL);
      url.searchParams.set('term', q);
      url.searchParams.set('latitude', String(input.lat));
      url.searchParams.set('longitude', String(input.lng));
      url.searchParams.set('radius', String(YELP_RADIUS_M));
      url.searchParams.set('limit', String(YELP_PER_CALL_CAP));
      try {
        const res = await fetchWithTimeout(ctx, url, { headers: { Authorization: `Bearer ${key}` }, timeoutMs: Math.min(10_000, ctx.budgetMs) });
        calls++;
        if (!res.ok) {
          errors.push(`${q}: HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as { businesses?: RawYelpBusiness[] };
        businesses = Array.isArray(json.businesses) ? json.businesses : [];
        await ctx.cache.set(CACHE_SOURCE, ck, { businesses }, CACHE_TTL_S);
      } catch (err) {
        errors.push(`${q}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }

    for (const raw of businesses) {
      const p = toYelpPlace(raw, site, q);
      if (!p || p.is_closed) continue;
      if (p.distance_m > YELP_RADIUS_M) continue;
      // First query to return a business wins its attribution; later ones only add.
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    if (businesses.length >= YELP_PER_CALL_CAP) truncatedQueries.push(q);
  }

  const places = [...byId.values()].sort((a, b) => a.distance_m - b.distance_m);
  const data: YelpData = {
    places,
    calls_made: calls,
    pool_truncated: truncatedQueries.length > 0,
    truncated_queries: truncatedQueries,
    queries_tried: queries,
  };
  const note = `Yelp 别名检索 ${queries.length} 条（${queries.join(' / ')}），半径 ${YELP_RADIUS_M} m，去重后 ${places.length} 家。${truncatedQueries.length ? `${truncatedQueries.length} 条触及单次返回上限，范围未穷尽。` : ''}`;

  if (!places.length && errors.length) {
    return {
      ...failed<YelpData>(SOURCE_ID, ctx, { source: 'Yelp Fusion /businesses/search', license: LICENSE, note: `Yelp 检索失败（${errors.join('；')}）`, error: errors.join('; ') }),
      data,
      elapsed_ms: Date.now() - t0,
    };
  }
  return {
    ...base,
    status: errors.length ? 'partial' : 'ok',
    data,
    source: 'Yelp Fusion /businesses/search',
    cost_usd: 0,
    coverage_note: errors.length ? `${note} 未完成：${errors.join('；')}。` : note,
    cache: calls === 0 ? 'hit' : 'miss',
    ...(errors.length ? { error: errors.join('; ') } : {}),
    elapsed_ms: Date.now() - t0,
  };
}
