/**
 * Foursquare Places API — secondary competitor source.
 *
 * Foursquare's Places API has the strongest "category" taxonomy and good price tier
 * coverage outside the US. We use it as a 3rd source after Google + Yelp to:
 *   1. Cross-verify competitor existence (whitelist confidence)
 *   2. Pull venue categories Google/Yelp miss
 *   3. Fill in price tier when Google's price_level is missing
 *
 * Endpoint: GET https://places-api.foursquare.com/places/search
 * Auth: header  Authorization: Bearer <FOURSQUARE_API_KEY>
 *       header  X-Places-Api-Version: 2025-06-17
 *
 *   (Foursquare migrated to Service Keys + Bearer scheme in mid-2025; the previous
 *    bare API-key auth on api.foursquare.com/v3 now returns 401 "Invalid request token".
 *    See https://docs.foursquare.com/fsq-developers-users/reference/migration-guide)
 *
 * Rate limit: 4000 req/day on developer tier; we cache 7d.
 */

import { envValue } from '@/lib/env-value';
import { readMarketCache, writeMarketCache, roundCoord } from '@/lib/funnel/iq-market-cache';

const FSQ_BASE = 'https://places-api.foursquare.com';
const SEARCH_TTL_S = 7 * 24 * 60 * 60;

export interface FoursquareCompetitorRow {
  fsq_id: string;
  name: string;
  categories: string[];
  /** Foursquare's price tier: 1 = $, 2 = $$, 3 = $$$, 4 = $$$$ (1-4). */
  price_tier: number | null;
  distance_m: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface FoursquareSearchResult {
  source: 'foursquare_places';
  fetched_at: string;
  query: { lat: number; lng: number; term: string; radius_m: number };
  count: number;
  competitors: FoursquareCompetitorRow[];
  api_status: 'ok' | 'no_key' | 'rate_limited' | 'error';
  error?: string;
}

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fsqFetch<T>(
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const apiKey = envValue('FOURSQUARE_API_KEY');
  if (!apiKey) return { ok: false, status: 0, error: 'no_key' };
  const res = await fetch(`${FSQ_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      // Foursquare requests API version pinning to avoid breaking changes.
      'X-Places-Api-Version': '2025-06-17',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: text.slice(0, 200) };
  }
  const data = (await res.json()) as T;
  return { ok: true, data };
}

export async function searchFoursquareCompetitors(input: {
  lat: number;
  lng: number;
  term?: string;
  /** Default 2400m (≈1.5mi). */
  radiusM?: number;
  limit?: number;
}): Promise<FoursquareSearchResult> {
  const radiusM = Math.min(Math.max(Math.round(input.radiusM ?? 2400), 100), 100_000);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const term = (input.term ?? 'restaurant').trim();
  const lat = roundCoord(input.lat);
  const lng = roundCoord(input.lng);

  const cacheKey = `${lat},${lng}|${term.toLowerCase()}|r=${radiusM}|n=${limit}`;
  const cached = await readMarketCache<FoursquareSearchResult>({
    source: 'foursquare_search',
    key: cacheKey,
  });
  if (cached) return cached;

  const params = new URLSearchParams({
    ll: `${lat},${lng}`,
    radius: String(radiusM),
    limit: String(limit),
    sort: 'RELEVANCE',
    query: term,
  });
  // Foursquare category id 13065 = "Restaurant" parent.
  params.set('categories', '13065');

  const res = await fsqFetch<{
    results?: Array<{
      fsq_id: string;
      name: string;
      categories?: Array<{ name?: string; short_name?: string }>;
      price?: number; // 1..4
      distance?: number;
      location?: { formatted_address?: string };
      geocodes?: { main?: { latitude?: number; longitude?: number } };
    }>;
  }>(`/places/search?${params.toString()}`);

  if (!res.ok) {
    const status = res.error === 'no_key' ? 'no_key' : res.status === 429 ? 'rate_limited' : 'error';
    return {
      source: 'foursquare_places',
      fetched_at: new Date().toISOString(),
      query: { lat, lng, term, radius_m: radiusM },
      count: 0,
      competitors: [],
      api_status: status,
      error: res.error,
    };
  }

  const rows: FoursquareCompetitorRow[] = (res.data.results ?? []).map((r) => ({
    fsq_id: String(r.fsq_id),
    name: String(r.name ?? 'Unknown'),
    categories: Array.isArray(r.categories)
      ? r.categories.map((c) => c.short_name || c.name || '').filter((s): s is string => !!s)
      : [],
    price_tier: typeof r.price === 'number' && r.price >= 1 && r.price <= 4 ? r.price : null,
    distance_m: asNum(r.distance),
    address: r.location?.formatted_address ?? null,
    lat: asNum(r.geocodes?.main?.latitude),
    lng: asNum(r.geocodes?.main?.longitude),
  }));

  const result: FoursquareSearchResult = {
    source: 'foursquare_places',
    fetched_at: new Date().toISOString(),
    query: { lat, lng, term, radius_m: radiusM },
    count: rows.length,
    competitors: rows,
    api_status: 'ok',
  };

  await writeMarketCache({
    source: 'foursquare_search',
    key: cacheKey,
    payload: result,
    ttlSeconds: SEARCH_TTL_S,
  });

  return result;
}

export function isFoursquareConfigured(): boolean {
  return Boolean(envValue('FOURSQUARE_API_KEY'));
}
