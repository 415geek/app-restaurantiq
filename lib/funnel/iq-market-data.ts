/**
 * Server-side market snapshot for IQ funnel when n8n analyze is not used.
 * Shape loosely matches n8n GatherMarketData `external_data` so paid prompts behave consistently.
 */

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

    const summary = {
      competitor_count_google: gRows.length,
      competitor_count_yelp: 0,
      avg_rating_google: avg(ratings),
      avg_rating_yelp: null as number | null,
      avg_review_count_google: avg(reviews),
      avg_review_count_yelp: null as number | null,
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
      sample_competitors_yelp: [] as unknown[],
      places_status: placesData.status ?? 'UNKNOWN',
    };

    return {
      source: 'google_places',
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
      yelp_raw: {
        search: null,
        details: [],
        reviews: [],
      },
    };
  } catch {
    return null;
  }
}
