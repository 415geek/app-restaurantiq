/**
 * Server-side market snapshot for IQ funnel when n8n analyze is not used.
 * Shape loosely matches n8n GatherMarketData `external_data` so paid prompts behave consistently.
 *
 * As of D-1 (2026-05-26) this is a multi-source gather:
 *   1. Google Places — geocode + textsearch (existing)
 *   2. Yelp Fusion   — businesses/search around the geocoded lat/lng
 *   3. Foursquare    — places/search around the geocoded lat/lng (US fallback + price tier)
 *
 * Each source is independent: any one of them succeeding produces useful market_data.
 * Total wall-clock <3s when caches are warm; <8s cold.
 */

import { envValue } from '@/lib/env-value';
import {
  searchYelpCompetitors,
  isYelpCompetitorSearchConfigured,
  type YelpCompetitorRow,
} from '@/lib/funnel/external-data/yelp-competitors';
import {
  searchFoursquareCompetitors,
  isFoursquareConfigured,
  type FoursquareCompetitorRow,
} from '@/lib/funnel/external-data/foursquare-places';

type GeocodeResult = {
  formatted_address: string;
  lat: number;
  lng: number;
  place_id?: string;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Convert Yelp '$' / '$$' / '$$$' / '$$$$' to integer 1..4 to match Google's price_level. */
function yelpPriceToInt(p: string | null): number | null {
  if (!p) return null;
  const n = p.length;
  return n >= 1 && n <= 4 ? n : null;
}

export async function gatherIqMarketDataFromGoogle(input: {
  location: string;
  businessType: string;
}): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return null;

  const location = input.location.trim();
  const cuisine = input.businessType.trim();
  if (!location) return null;

  try {
    const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    geocodeUrl.searchParams.set('address', location);
    geocodeUrl.searchParams.set('key', apiKey);
    const geocodeRes = await fetch(geocodeUrl, { cache: 'no-store' });
    if (!geocodeRes.ok) return null;
    const geocodeData = (await geocodeRes.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string; geometry?: { location?: { lat: number; lng: number } }; place_id?: string }>;
    };
    if (geocodeData.status !== 'OK' || !geocodeData.results?.length) return null;

    const top = geocodeData.results[0];
    const geocode: GeocodeResult = {
      formatted_address: String(top.formatted_address ?? location),
      lat: top.geometry?.location?.lat ?? 0,
      lng: top.geometry?.location?.lng ?? 0,
      place_id: top.place_id,
    };

    const query =
      cuisine.length > 0
        ? `${cuisine} restaurant near ${location}`
        : `restaurants near ${location}`;
    const placesUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    placesUrl.searchParams.set('query', query);
    placesUrl.searchParams.set('type', 'restaurant');
    placesUrl.searchParams.set('key', apiKey);
    const placesRes = await fetch(placesUrl, { cache: 'no-store' });
    if (!placesRes.ok) return null;
    const placesData = (await placesRes.json()) as {
      status?: string;
      results?: Array<{
        name?: string;
        rating?: number;
        user_ratings_total?: number;
        price_level?: number;
        formatted_address?: string;
        types?: string[];
        place_id?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };

    const gRows = Array.isArray(placesData.results) ? placesData.results.slice(0, 12) : [];
    const ratings = gRows.map((x) => num(x.rating)).filter((x): x is number => x !== null);
    const reviews = gRows.map((x) => num(x.user_ratings_total)).filter((x): x is number => x !== null);
    const avg = (arr: number[]) =>
      arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

    // Fan out to Yelp + Foursquare in parallel using the geocoded lat/lng.
    // The cuisine term (when present) is much more selective than a bare address query.
    const yelpTerm = cuisine || 'restaurant';
    const fsqTerm = cuisine || 'restaurant';
    const [yelpPack, fsqPack] = await Promise.all([
      isYelpCompetitorSearchConfigured()
        ? searchYelpCompetitors({ lat: geocode.lat, lng: geocode.lng, term: yelpTerm, limit: 20 }).catch(() => null)
        : Promise.resolve(null),
      isFoursquareConfigured()
        ? searchFoursquareCompetitors({ lat: geocode.lat, lng: geocode.lng, term: fsqTerm, limit: 20 }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const yelpRows: YelpCompetitorRow[] = yelpPack?.api_status === 'ok' ? yelpPack.competitors : [];
    const fsqRows: FoursquareCompetitorRow[] = fsqPack?.api_status === 'ok' ? fsqPack.competitors : [];

    const yelpRatings = yelpRows
      .map((r) => num(r.rating))
      .filter((x): x is number => x !== null);
    const yelpReviewCounts = yelpRows
      .map((r) => num(r.review_count))
      .filter((x): x is number => x !== null);

    const summary = {
      competitor_count_google: gRows.length,
      competitor_count_yelp: yelpRows.length,
      competitor_count_foursquare: fsqRows.length,
      avg_rating_google: avg(ratings),
      avg_rating_yelp: avg(yelpRatings),
      avg_review_count_google: avg(reviews),
      avg_review_count_yelp: avg(yelpReviewCounts),
      sample_competitors_google: gRows.slice(0, 10).map((x) => ({
        name: x.name ?? 'Unknown',
        rating: x.rating ?? null,
        reviews: x.user_ratings_total ?? null,
        price_level: x.price_level ?? null,
        address: x.formatted_address ?? null,
        lat: x.geometry?.location?.lat ?? null,
        lng: x.geometry?.location?.lng ?? null,
        types: Array.isArray(x.types) ? x.types.slice(0, 4) : [],
      })),
      sample_competitors_yelp: yelpRows.slice(0, 12).map((r) => ({
        yelp_id: r.yelp_id,
        name: r.name,
        rating: r.rating,
        reviews: r.review_count,
        price_level: yelpPriceToInt(r.price_level),
        price_label: r.price_level,
        categories: r.categories,
        distance_m: r.distance_m,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        url: r.url,
        transactions: r.transactions,
      })),
      sample_competitors_foursquare: fsqRows.slice(0, 12).map((r) => ({
        fsq_id: r.fsq_id,
        name: r.name,
        categories: r.categories,
        price_tier: r.price_tier,
        distance_m: r.distance_m,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
      })),
      places_status: placesData.status ?? 'UNKNOWN',
      yelp_status: yelpPack?.api_status ?? 'not_configured',
      foursquare_status: fsqPack?.api_status ?? 'not_configured',
    };

    return {
      source: 'multi_source',
      fetched_at: new Date().toISOString(),
      address: location,
      cuisine: cuisine || undefined,
      geocode,
      summary,
      google_raw: {
        textsearch: {
          status: placesData.status,
          results: gRows,
        },
      },
      yelp_raw: yelpPack
        ? {
            search: yelpPack,
            details: [],
            reviews: [],
          }
        : {
            search: null,
            details: [],
            reviews: [],
          },
      foursquare_raw: fsqPack ? { search: fsqPack } : null,
    };
  } catch (err) {
    // Defensive: keep returning null on transport errors so callers can fall back to
    // existing market_data. Don't crash the report path.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[iq-market-data] gather failed:', err);
    }
    return null;
  }
}

// Re-export the function with a name that better matches its new behaviour, while
// keeping the legacy import name working for existing call sites.
export { gatherIqMarketDataFromGoogle as gatherIqMarketDataMultiSource };

