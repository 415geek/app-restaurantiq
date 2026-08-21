/**
 * Yelp Fusion competitor search for LocationIQ paid reports.
 *
 * Separate from lib/server/social-radar/yelp.ts (which searches Yelp by name for an
 * already-known business). This one searches by lat/lng + category/term so we can pull
 * the actual competitive set around a candidate location.
 *
 * Endpoints used:
 *   GET /v3/businesses/search                      — top N by distance/rating
 *   GET /v3/businesses/{id}                        — categories, price, transactions, hours, photos
 *   GET /v3/businesses/{id}/reviews?limit=3        — 3 most recent review excerpts
 *
 * Rate limit: 5000/day on free tier. We cache search results for 7d, detail/reviews for 14d.
 */

import { envValue } from '@/lib/env-value';
import {
  readMarketCache,
  writeMarketCache,
  roundCoord,
} from '@/lib/funnel/iq-market-cache';

const YELP_BASE = 'https://api.yelp.com/v3';
const SEARCH_TTL_S = 7 * 24 * 60 * 60;
const DETAIL_TTL_S = 14 * 24 * 60 * 60;

export interface YelpCompetitorRow {
  yelp_id: string;
  name: string;
  rating: number | null;
  review_count: number | null;
  price_level: string | null; // '$', '$$', '$$$', '$$$$' or null
  categories: string[];
  distance_m: number | null;
  is_closed: boolean | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  url: string | null;
  phone: string | null;
  transactions: string[]; // 'delivery', 'pickup', etc.
}

export interface YelpCompetitorSearchResult {
  source: 'yelp_fusion';
  fetched_at: string;
  query: { lat: number; lng: number; term: string; radius_m: number };
  count: number;
  competitors: YelpCompetitorRow[];
  api_status: 'ok' | 'no_key' | 'rate_limited' | 'error';
  error?: string;
}

export interface YelpBusinessDetail {
  yelp_id: string;
  name: string;
  rating: number | null;
  review_count: number | null;
  price_level: string | null;
  categories: string[];
  photos: string[];
  hours_summary: string | null;
  transactions: string[];
  url: string;
  /** Yelp does not return menus directly; user-facing menu URL when available. */
  menu_url: string | null;
}

export interface YelpReviewExcerpt {
  text: string;
  rating: number;
  time_created: string;
  user_name: string;
}

function fmtPrice(price: unknown): string | null {
  if (typeof price === 'string' && /^\$+$/.test(price)) return price;
  return null;
}

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function yelpFetch<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const apiKey = envValue('YELP_API_KEY');
  if (!apiKey) return { ok: false, status: 0, error: 'no_key' };
  const res = await fetch(`${YELP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: text.slice(0, 200) };
  }
  const data = (await res.json()) as T;
  return { ok: true, data };
}

/**
 * Search competitors around a lat/lng. `term` is the cuisine/category (e.g. "bubble tea").
 * Returns up to `limit` competitor rows ordered by Yelp's default best_match ranking.
 */
export async function searchYelpCompetitors(input: {
  lat: number;
  lng: number;
  term?: string;
  /** Yelp search radius in meters, max 40000. Default 2400 (≈1.5mi). */
  radiusM?: number;
  limit?: number;
}): Promise<YelpCompetitorSearchResult> {
  const radiusM = Math.min(Math.max(Math.round(input.radiusM ?? 2400), 100), 40000);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const term = (input.term ?? '').trim() || 'restaurant';
  const lat = roundCoord(input.lat);
  const lng = roundCoord(input.lng);

  const cacheKey = `${lat},${lng}|${term.toLowerCase()}|r=${radiusM}|n=${limit}`;
  const cached = await readMarketCache<YelpCompetitorSearchResult>({
    source: 'yelp_search',
    key: cacheKey,
  });
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    radius: String(radiusM),
    term,
    limit: String(limit),
    sort_by: 'best_match',
  });
  // Yelp lets us scope to the food/restaurants category to filter out gas stations etc.
  params.set('categories', 'restaurants,food,bubbletea,coffee,desserts');

  const res = await yelpFetch<{
    businesses?: Array<{
      id: string;
      name: string;
      rating?: number;
      review_count?: number;
      price?: string;
      categories?: Array<{ alias?: string; title?: string }>;
      coordinates?: { latitude?: number; longitude?: number };
      location?: { display_address?: string[] };
      url?: string;
      phone?: string;
      is_closed?: boolean;
      distance?: number;
      transactions?: string[];
    }>;
  }>(`/businesses/search?${params.toString()}`);

  if (!res.ok) {
    const status = res.error === 'no_key' ? 'no_key' : res.status === 429 ? 'rate_limited' : 'error';
    return {
      source: 'yelp_fusion',
      fetched_at: new Date().toISOString(),
      query: { lat, lng, term, radius_m: radiusM },
      count: 0,
      competitors: [],
      api_status: status,
      error: res.error,
    };
  }

  const rows: YelpCompetitorRow[] = (res.data.businesses ?? []).map((b) => ({
    yelp_id: String(b.id),
    name: String(b.name ?? 'Unknown'),
    rating: asNum(b.rating),
    review_count: asNum(b.review_count),
    price_level: fmtPrice(b.price),
    categories: Array.isArray(b.categories)
      ? b.categories.map((c) => c.title ?? '').filter((s): s is string => !!s)
      : [],
    distance_m: asNum(b.distance),
    is_closed: typeof b.is_closed === 'boolean' ? b.is_closed : null,
    address: Array.isArray(b.location?.display_address) && b.location?.display_address.length
      ? b.location!.display_address.join(', ')
      : null,
    lat: asNum(b.coordinates?.latitude),
    lng: asNum(b.coordinates?.longitude),
    url: b.url ?? null,
    phone: b.phone ?? null,
    transactions: Array.isArray(b.transactions) ? b.transactions : [],
  }));

  const result: YelpCompetitorSearchResult = {
    source: 'yelp_fusion',
    fetched_at: new Date().toISOString(),
    query: { lat, lng, term, radius_m: radiusM },
    count: rows.length,
    competitors: rows,
    api_status: 'ok',
  };

  await writeMarketCache({
    source: 'yelp_search',
    key: cacheKey,
    payload: result,
    ttlSeconds: SEARCH_TTL_S,
  });

  return result;
}

/**
 * Fetches business detail + up to 3 review excerpts for AI menu/review analysis.
 * Returns null on any error so callers can skip gracefully.
 */
export async function getYelpBusinessDetail(yelpId: string): Promise<{
  detail: YelpBusinessDetail;
  reviews: YelpReviewExcerpt[];
} | null> {
  if (!yelpId) return null;
  const cacheKey = `detail:${yelpId}`;
  const cached = await readMarketCache<{ detail: YelpBusinessDetail; reviews: YelpReviewExcerpt[] }>(
    { source: 'yelp_business_detail', key: cacheKey },
  );
  if (cached) return cached;

  const [detailRes, reviewsRes] = await Promise.all([
    yelpFetch<{
      id: string;
      name: string;
      rating?: number;
      review_count?: number;
      price?: string;
      categories?: Array<{ title?: string }>;
      photos?: string[];
      hours?: Array<{ open?: Array<{ day: number; start: string; end: string }> }>;
      transactions?: string[];
      url?: string;
      attributes?: Record<string, unknown>;
      menu_url?: string;
    }>(`/businesses/${yelpId}`),
    yelpFetch<{
      reviews?: Array<{
        text: string;
        rating: number;
        time_created: string;
        user?: { name?: string };
      }>;
    }>(`/businesses/${yelpId}/reviews?limit=3&sort_by=yelp_sort`),
  ]);

  if (!detailRes.ok) return null;
  const d = detailRes.data;

  const detail: YelpBusinessDetail = {
    yelp_id: String(d.id),
    name: String(d.name ?? 'Unknown'),
    rating: asNum(d.rating),
    review_count: asNum(d.review_count),
    price_level: fmtPrice(d.price),
    categories: Array.isArray(d.categories) ? d.categories.map((c) => c.title ?? '').filter(Boolean) : [],
    photos: Array.isArray(d.photos) ? d.photos.slice(0, 3) : [],
    hours_summary: null, // not yet flattening hours[] — TODO if prompt needs it
    transactions: Array.isArray(d.transactions) ? d.transactions : [],
    url: d.url ?? '',
    menu_url: typeof d.menu_url === 'string' ? d.menu_url : null,
  };

  const reviews: YelpReviewExcerpt[] = reviewsRes.ok
    ? (reviewsRes.data.reviews ?? []).map((r) => ({
        text: String(r.text ?? '').slice(0, 600),
        rating: Number(r.rating ?? 0),
        time_created: String(r.time_created ?? ''),
        user_name: String(r.user?.name ?? ''),
      }))
    : [];

  const result = { detail, reviews };
  await writeMarketCache({
    source: 'yelp_business_detail',
    key: cacheKey,
    payload: result,
    ttlSeconds: DETAIL_TTL_S,
  });
  return result;
}

export function isYelpCompetitorSearchConfigured(): boolean {
  return Boolean(envValue('YELP_API_KEY'));
}
