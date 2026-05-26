/**
 * Google Places "Details" fetcher for paid LocationIQ reports.
 *
 * Separate from lib/server/social-radar/google-places.ts (which is the social
 * radar product). This one is funnel-scoped, uses the funnel's
 * GOOGLE_MAPS_API_KEY env var, caches via iq_market_cache (TTL 14d), and only
 * returns the fields we need for D-5 DeepSeek competitor-insight analysis:
 *  - rating + user_ratings_total
 *  - editorial_summary (when available)
 *  - up to 5 most-helpful review excerpts (~600 chars each)
 *  - opening_hours summary
 *  - price_level
 *
 * Never throws on auth/quota failures — returns null so callers degrade.
 */

import { envValue } from '@/lib/env-value';
import { readMarketCache, writeMarketCache } from '@/lib/funnel/iq-market-cache';

const PLACE_DETAILS_TTL_S = 14 * 24 * 60 * 60;

export interface GooglePlaceReviewExcerpt {
  text: string;
  rating: number;
  relative_time: string;
  language: string;
  author_name: string;
}

export interface GooglePlaceDetailPack {
  place_id: string;
  name: string;
  rating: number | null;
  user_ratings_total: number | null;
  price_level: number | null;
  editorial_summary: string | null;
  reviews: GooglePlaceReviewExcerpt[];
  fetched_at: string;
}

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchGooglePlaceDetail(placeId: string): Promise<GooglePlaceDetailPack | null> {
  if (!placeId) return null;
  const apiKey = envValue('GOOGLE_MAPS_API_KEY') || envValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return null;

  const cacheKey = `place_id=${placeId}`;
  const cached = await readMarketCache<GooglePlaceDetailPack>({
    source: 'google_place_details',
    key: cacheKey,
  });
  if (cached) return cached;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set(
      'fields',
      'place_id,name,rating,user_ratings_total,price_level,editorial_summary,reviews',
    );
    url.searchParams.set('reviews_sort', 'most_relevant');
    url.searchParams.set('reviews_no_translations', 'false');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[iq-google-place-details] http=%d for place_id=%s', res.status, placeId);
      return null;
    }
    const data = (await res.json()) as {
      status?: string;
      error_message?: string;
      result?: {
        place_id?: string;
        name?: string;
        rating?: number;
        user_ratings_total?: number;
        price_level?: number;
        editorial_summary?: { overview?: string };
        reviews?: Array<{
          author_name?: string;
          rating?: number;
          text?: string;
          relative_time_description?: string;
          language?: string;
        }>;
      };
    };
    if (data.status !== 'OK' || !data.result) {
      console.warn(
        '[iq-google-place-details] status=%s message=%s place_id=%s',
        data.status,
        data.error_message ?? '',
        placeId,
      );
      return null;
    }
    const r = data.result;
    const pack: GooglePlaceDetailPack = {
      place_id: String(r.place_id ?? placeId),
      name: String(r.name ?? ''),
      rating: asNum(r.rating),
      user_ratings_total: asNum(r.user_ratings_total),
      price_level: asNum(r.price_level),
      editorial_summary:
        r.editorial_summary && typeof r.editorial_summary.overview === 'string'
          ? r.editorial_summary.overview.trim() || null
          : null,
      reviews: Array.isArray(r.reviews)
        ? r.reviews.slice(0, 5).map((rv) => ({
            text: String(rv.text ?? '').slice(0, 600),
            rating: Number(rv.rating ?? 0),
            relative_time: String(rv.relative_time_description ?? ''),
            language: String(rv.language ?? 'en'),
            author_name: String(rv.author_name ?? ''),
          }))
        : [],
      fetched_at: new Date().toISOString(),
    };

    await writeMarketCache({
      source: 'google_place_details',
      key: cacheKey,
      payload: pack,
      ttlSeconds: PLACE_DETAILS_TTL_S,
    });

    return pack;
  } catch (err) {
    console.warn('[iq-google-place-details] threw for place_id=%s:', placeId, err);
    return null;
  }
}

export function isGooglePlaceDetailsConfigured(): boolean {
  return Boolean(envValue('GOOGLE_MAPS_API_KEY') || envValue('GOOGLE_PLACES_API_KEY'));
}
