/**
 * Server-side market snapshot for IQ funnel when n8n analyze is not used.
 * Shape loosely matches n8n GatherMarketData `external_data` so paid prompts behave consistently.
 *
 * Multi-source gather:
 *   1. Google — geocode, then the §4.2 three-layer competitor retrieval
 *      (lib/iq/data/google-places.ts `fetchThreeLayerCompetitors`): Layer 1 直接竞品
 *      (concept keyword, 800 → 1600 m), Layer 2 替代竞品 (same category, 1600 m),
 *      Layer 3 品牌锚点 (city-wide, ≥ 500 reviews, top 5) + walking legs (Distance Matrix).
 *      The legacy metro-wide "<cuisine> restaurant near <address>" Text Search is gone.
 *   2. Yelp Fusion   — businesses/search around the geocoded lat/lng (supplementary)
 *   3. Foursquare    — places/search around the geocoded lat/lng (supplementary)
 *   Yelp / Foursquare rows that duplicate a Google record (name + ≤ 150 m) are dropped;
 *   survivors are tagged with the layer their name / categories imply.
 *
 * 评审 Spec §4.4 计数单一化: `summary.counts` is the ONE count set — total / direct /
 * same_category / l3 / anchors / by_source — and every other competitor number here
 * (`competitor_count_google|yelp|foursquare|total`, `competitor_layers`) is read from
 * it, never counted again. `total` = Layer 1 + Layer 2 across the three platforms after
 * deduplication; brand anchors and 'other' supplementary rows are never inside it.
 * Every `sample_competitors_google[]` row carries `layer` and `walk_min`.
 *
 * Each source is independent: any one of them succeeding produces useful market_data.
 */

import { createFetchContext } from '@/lib/iq/data/context';
import { fetchThreeLayerCompetitors, type GooglePlace, type PlaceLayer, type ThreeLayerCompetitors } from '@/lib/iq/data/google-places';
import { matchesLayer1, toTableAType, typesMatch, type ConceptSearchProfile } from '@/lib/iq/data/search-profile';
import type { FetchContext } from '@/lib/iq/data/types';
import type { CompetitorCounts } from '@/lib/iq/model/schema';
import { haversineM } from '@/lib/iq/geo';
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

export type GeocodeResult = {
  formatted_address: string;
  lat: number;
  lng: number;
  place_id?: string;
  /** From address_components — gates Caltrans (CA-only) and scopes listings search. */
  city?: string;
  state?: string;
};

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

/** Legacy Places row shape every downstream reader (competitor map, DeepSeek insights, anchors) already understands, plus the §4.2 fields. */
export type GoogleCompetitorRow = {
  name: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  formatted_address?: string;
  types?: string[];
  place_id?: string;
  geometry?: { location?: { lat: number; lng: number } };
  business_status?: string | null;
  /** §4.2 layer: direct | substitute | brand_anchor. */
  layer: PlaceLayer;
  /** Straight-line metres from the site. */
  distance_m: number;
  /** Walking leg (Distance Matrix) when available. */
  walk_m: number | null;
  walk_min: number | null;
};

/** Layer tag for a supplementary (Yelp / Foursquare) row. */
export type SupplementaryLayer = 'direct' | 'substitute' | 'other';

function componentOfType(components: AddressComponent[] | undefined, type: string): string | undefined {
  const c = components?.find((x) => Array.isArray(x.types) && x.types.includes(type));
  return c?.long_name || c?.short_name || undefined;
}

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

/**
 * Yelp can geocode the bare address itself via `location=` (no lat/lng required), but
 * we still want a lat/lng to power the competitor map. Until we add a Google-independent
 * geocoder, fall back to a coarse city-centroid lookup for known SF / LA / NYC ZIP
 * prefixes so paid reports don't crash when Google geocode silently fails on Vercel.
 */
function staticGeocodeFallback(addressRaw: string): GeocodeResult | null {
  const address = addressRaw.toLowerCase();
  if (/\bsan francisco\b/.test(address) || /,\s*sf\b/.test(address)) {
    return { formatted_address: addressRaw, lat: 37.7749, lng: -122.4194 };
  }
  if (/\blos angeles\b/.test(address) || /,\s*la\b/.test(address)) {
    return { formatted_address: addressRaw, lat: 34.0522, lng: -118.2437 };
  }
  if (/\bnew york\b/.test(address) || /,\s*ny\b/.test(address)) {
    return { formatted_address: addressRaw, lat: 40.7128, lng: -74.006 };
  }
  return null;
}

export function toGoogleCompetitorRow(p: GooglePlace, layer: PlaceLayer): GoogleCompetitorRow {
  return {
    name: p.name || 'Unknown',
    rating: p.rating ?? undefined,
    user_ratings_total: p.user_rating_count ?? undefined,
    price_level: p.price_level ?? undefined,
    formatted_address: p.formatted_address ?? undefined,
    types: p.types,
    place_id: p.id,
    geometry: { location: { lat: p.lat, lng: p.lng } },
    business_status: p.business_status,
    layer,
    distance_m: p.distance_m,
    walk_m: p.walk_m ?? null,
    walk_min: p.walk_min ?? null,
  };
}

const nameKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(the|restaurant|cafe|bakery|kitchen|house|inc|llc|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const DEDUPE_RADIUS_M = 150;

/** True when a supplementary row is the same business as one of the Google records (normalized name + ≤ 150 m). */
export function duplicatesGoogle(row: { name: string; lat: number | null; lng: number | null }, google: GoogleCompetitorRow[]): GoogleCompetitorRow | null {
  const k = nameKey(row.name);
  if (!k) return null;
  for (const g of google) {
    const gk = nameKey(g.name);
    const nameHit = gk === k || (gk.length > 3 && k.length > 3 && (gk.includes(k) || k.includes(gk)));
    if (!nameHit) continue;
    const gl = g.geometry?.location;
    if (row.lat == null || row.lng == null || !gl) {
      if (gk === k) return g; // exact name, no coordinates to disprove it
      continue;
    }
    if (haversineM({ lat: row.lat, lng: row.lng }, gl) <= DEDUPE_RADIUS_M) return g;
  }
  return null;
}

/** Layer a supplementary row implies from its name / categories (no query provenance available). */
export function supplementaryLayer(row: { name: string; categories: string[] }, profile: ConceptSearchProfile): SupplementaryLayer {
  const catTypes = row.categories.map((c) => toTableAType(c.toLowerCase().replace(/ies$/, 'y').replace(/s$/, ''))).filter((x): x is string => x != null);
  if (matchesLayer1(`${row.name} ${row.categories.join(' ')}`, [...catTypes], profile)) return 'direct';
  if (typesMatch(catTypes, profile.types) && profile.origin !== 'text') return 'direct';
  if (typesMatch(catTypes, profile.substitute_types)) return 'substitute';
  if (profile.sibling_ids.length && row.categories.some((c) => /chinese|中餐/i.test(c)) && profile.substitute_types.includes('chinese_restaurant')) return 'substitute';
  return 'other';
}

function placesStatusOf(three: ThreeLayerCompetitors | null): string {
  if (!three) return 'NOT_RUN';
  if (three.api_status === 'ok') return 'OK';
  if (three.api_status === 'no_key') return 'NO_KEY';
  if (three.api_status === 'partial') return 'PARTIAL';
  return 'ERROR';
}

/**
 * Step 1 on its own: the geocode every other leg hangs off. Exposed so the
 * resolver can start the Census pull the moment the point is known instead of
 * after the whole competitor search has finished.
 */
export async function geocodeIqLocation(locationRaw: string, ctx: FetchContext): Promise<GeocodeResult | null> {
  const apiKey = (ctx.env('GOOGLE_MAPS_API_KEY') ?? '').trim();
  const location = locationRaw.trim();
  if (!location) return null;
  let geocode: GeocodeResult | null = null;
  if (apiKey) {
    try {
      const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      geocodeUrl.searchParams.set('address', location);
      geocodeUrl.searchParams.set('key', apiKey);
      const geocodeRes = await ctx.fetch(geocodeUrl, { cache: 'no-store' });
      if (geocodeRes.ok) {
        const geocodeData = (await geocodeRes.json()) as {
          status?: string;
          error_message?: string;
          results?: Array<{ formatted_address?: string; geometry?: { location?: { lat: number; lng: number } }; place_id?: string; address_components?: AddressComponent[] }>;
        };
        if (geocodeData.status === 'OK' && geocodeData.results?.length) {
          const top = geocodeData.results[0];
          geocode = {
            formatted_address: String(top.formatted_address ?? location),
            lat: top.geometry?.location?.lat ?? 0,
            lng: top.geometry?.location?.lng ?? 0,
            place_id: top.place_id,
            city: componentOfType(top.address_components, 'locality'),
            state: componentOfType(top.address_components, 'administrative_area_level_1'),
          };
        } else {
          console.warn('[iq-market-data] geocode non-OK status=%s message=%s', geocodeData.status, geocodeData.error_message ?? '');
        }
      } else {
        console.warn('[iq-market-data] geocode http=%d', geocodeRes.status);
      }
    } catch (err) {
      console.warn('[iq-market-data] geocode threw:', err);
    }
  } else {
    console.warn('[iq-market-data] GOOGLE_MAPS_API_KEY missing — skipping Google leg');
  }

  // Fall back to a coarse city-centroid lookup so Yelp + Foursquare still run.
  if (!geocode) {
    const fallback = staticGeocodeFallback(location);
    if (fallback) {
      console.warn('[iq-market-data] using static fallback geocode for %s', location);
      geocode = fallback;
    }
  }
  return geocode;
}

export async function gatherIqMarketDataFromGoogle(input: {
  location: string;
  businessType: string;
  /** Taxonomy id when the concept was already confirmed (skips the text classifier). */
  conceptId?: string | null;
  /** Injectable fetch / cache / env / cost context (tests, scripts); defaults to the Supabase-cached production context. */
  ctx?: FetchContext;
  /** Already-resolved geocode (geocodeIqLocation); when given, step 1 is skipped. */
  geocode?: GeocodeResult | null;
}): Promise<Record<string, unknown> | null> {
  const ctx = input.ctx ?? createFetchContext();
  const apiKey = (ctx.env('GOOGLE_MAPS_API_KEY') ?? '').trim();
  const location = input.location.trim();
  const cuisine = input.businessType.trim();
  if (!location) return null;

  // ── Step 1: Google geocode (best-effort) ────────────────────────────────────────
  const geocode = input.geocode !== undefined ? input.geocode : await geocodeIqLocation(location, ctx);
  if (!geocode) return null;
  let three: ThreeLayerCompetitors | null = null;

  // ── Step 2: §4.2 three-layer competitor retrieval (Places (New) + Distance Matrix) ──
  if (apiKey) {
    try {
      three = await fetchThreeLayerCompetitors({ lat: geocode.lat, lng: geocode.lng, conceptId: input.conceptId ?? null, text: cuisine || 'restaurant' }, ctx);
      if (three.status === 'failed') console.warn('[iq-market-data] places three-layer failed: %s', three.note);
    } catch (err) {
      console.warn('[iq-market-data] places three-layer threw:', err);
    }
  }

  try {
    const direct = (three?.direct ?? []).map((p) => toGoogleCompetitorRow(p, 'direct'));
    const substitute = (three?.substitute ?? []).map((p) => toGoogleCompetitorRow(p, 'substitute'));
    const brandAnchors = (three?.brand_anchors ?? []).map((p) => toGoogleCompetitorRow(p, 'brand_anchor'));
    // Layer 1 first, then Layer 2 — each by walking distance (straight-line when no leg).
    const gRows: GoogleCompetitorRow[] = [...direct, ...substitute];
    const allGoogle = [...gRows, ...brandAnchors];

    const ratings = gRows.map((x) => num(x.rating)).filter((x): x is number => x !== null);
    const reviews = gRows.map((x) => num(x.user_ratings_total)).filter((x): x is number => x !== null);
    const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null);

    // Fan out to Yelp + Foursquare in parallel using the geocoded lat/lng (supplementary lists).
    const term = three?.profile.query || cuisine || 'restaurant';
    const [yelpPack, fsqPack] = await Promise.all([
      isYelpCompetitorSearchConfigured() ? searchYelpCompetitors({ lat: geocode.lat, lng: geocode.lng, term, limit: 20 }).catch(() => null) : Promise.resolve(null),
      isFoursquareConfigured() ? searchFoursquareCompetitors({ lat: geocode.lat, lng: geocode.lng, term, limit: 20 }).catch(() => null) : Promise.resolve(null),
    ]);

    const yelpAll: YelpCompetitorRow[] = yelpPack?.api_status === 'ok' ? yelpPack.competitors : [];
    const fsqAll: FoursquareCompetitorRow[] = fsqPack?.api_status === 'ok' ? fsqPack.competitors : [];
    const profile = three?.profile ?? null;
    const tagged = <T extends { name: string; lat: number | null; lng: number | null; categories: string[] }>(rows: T[]) => {
      const kept: Array<T & { layer: SupplementaryLayer }> = [];
      let duplicates = 0;
      for (const r of rows) {
        if (duplicatesGoogle(r, allGoogle)) {
          duplicates++;
          continue;
        }
        kept.push({ ...r, layer: profile ? supplementaryLayer(r, profile) : 'other' });
      }
      return { kept, duplicates };
    };
    const yelp = tagged(yelpAll);
    const fsq = tagged(fsqAll);

    const yelpRatings = yelp.kept.map((r) => num(r.rating)).filter((x): x is number => x !== null);
    const yelpReviewCounts = yelp.kept.map((r) => num(r.review_count)).filter((x): x is number => x !== null);

    // 评审 Spec §4.4 计数单一化 (P1-a): ONE set of counts. Every competitor number any surface
    // prints (dashboard, provenance table, metrics digest, prompts) reads these fields — nothing
    // re-counts. `total` = direct + same_category across all three platforms after deduplication;
    // supplementary rows that are neither (layer 'other') sit in `l3`, brand anchors in `anchors`,
    // and neither is ever inside `total`.
    const layerCountOf = (rows: Array<{ layer: SupplementaryLayer }>, layer: SupplementaryLayer) => rows.filter((r) => r.layer === layer).length;
    const countedOf = (rows: Array<{ layer: SupplementaryLayer }>) => layerCountOf(rows, 'direct') + layerCountOf(rows, 'substitute');
    const counts: CompetitorCounts = {
      total: direct.length + substitute.length + countedOf(yelp.kept) + countedOf(fsq.kept),
      direct: direct.length + layerCountOf(yelp.kept, 'direct') + layerCountOf(fsq.kept, 'direct'),
      same_category: substitute.length + layerCountOf(yelp.kept, 'substitute') + layerCountOf(fsq.kept, 'substitute'),
      l3: layerCountOf(yelp.kept, 'other') + layerCountOf(fsq.kept, 'other'),
      anchors: brandAnchors.length,
      by_source: { google: direct.length + substitute.length, yelp: countedOf(yelp.kept), foursquare: countedOf(fsq.kept) },
    };

    const summary = {
      /** §4.4: the single source of truth for every competitor count in this report. */
      counts,
      /** §4.2: Layer 1 + Layer 2 within 1600 m; brand anchors are never counted. Reads `counts`, never re-counts. */
      competitor_count_google: counts.by_source.google,
      competitor_layers: { direct: direct.length, substitute: substitute.length, brand_anchor: counts.anchors },
      competitor_count_yelp: counts.by_source.yelp,
      competitor_count_foursquare: counts.by_source.foursquare,
      /** Total competitive set across platforms — the number the dashboard and the narrative must quote. */
      competitor_count_total: counts.total,
      avg_rating_google: avg(ratings),
      avg_rating_yelp: avg(yelpRatings),
      avg_review_count_google: avg(reviews),
      avg_review_count_yelp: avg(yelpReviewCounts),
      sample_competitors_google: gRows.slice(0, 12).map((x) => ({
        name: x.name,
        rating: x.rating ?? null,
        reviews: x.user_ratings_total ?? null,
        price_level: x.price_level ?? null,
        address: x.formatted_address ?? null,
        lat: x.geometry?.location?.lat ?? null,
        lng: x.geometry?.location?.lng ?? null,
        types: Array.isArray(x.types) ? x.types.slice(0, 4) : [],
        // D-5: include place_id so the DeepSeek competitor-insight pipeline
        // can pull Place Details reviews without a second name->id lookup.
        place_id: x.place_id ?? null,
        layer: x.layer,
        distance_m: x.distance_m,
        walk_m: x.walk_m,
        walk_min: x.walk_min,
      })),
      /** §4.2 Layer 3 品牌锚点 — city-wide benchmarks, reported separately, not competition. */
      sample_brand_anchors_google: brandAnchors.map((x) => ({
        name: x.name,
        rating: x.rating ?? null,
        reviews: x.user_ratings_total ?? null,
        price_level: x.price_level ?? null,
        address: x.formatted_address ?? null,
        lat: x.geometry?.location?.lat ?? null,
        lng: x.geometry?.location?.lng ?? null,
        place_id: x.place_id ?? null,
        layer: 'brand_anchor' as const,
        distance_m: x.distance_m,
      })),
      sample_competitors_yelp: yelp.kept.slice(0, 12).map((r) => ({
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
        layer: r.layer,
      })),
      sample_competitors_foursquare: fsq.kept.slice(0, 12).map((r) => ({
        fsq_id: r.fsq_id,
        name: r.name,
        categories: r.categories,
        price_tier: r.price_tier,
        distance_m: r.distance_m,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        layer: r.layer,
      })),
      supplementary_duplicates_dropped: { yelp: yelp.duplicates, foursquare: fsq.duplicates },
      places_status: placesStatusOf(three),
      yelp_status: yelpPack?.api_status ?? 'not_configured',
      foursquare_status: fsqPack?.api_status ?? 'not_configured',
      /** §4.2 provenance: which Layer-1 radii were searched (a void needs both) and how the concept resolved. */
      l1_search_radius_m: three?.l1_search_radius_m ?? null,
      l1_layers_tried: three?.l1_layers_tried ?? [],
      concept: three ? { ...three.concept, query: three.profile.query } : null,
    };

    return {
      source: 'multi_source',
      fetched_at: new Date().toISOString(),
      address: location,
      cuisine: cuisine || undefined,
      geocode,
      summary,
      google_raw: {
        // Legacy key kept for readers of the old textsearch shape; the rows are the Layer 1 + 2 set.
        textsearch: { status: summary.places_status, results: gRows },
        three_layer: three ? { concept: three.concept, calls: three.calls, calls_made: three.calls_made, cost_usd: three.cost_usd, note: three.note, brand_anchors: brandAnchors } : null,
      },
      yelp_raw: yelpPack ? { search: yelpPack, details: [], reviews: [] } : { search: null, details: [], reviews: [] },
      foursquare_raw: fsqPack ? { search: fsqPack } : null,
    };
  } catch (err) {
    // Defensive: keep returning null on transport errors so callers can fall back to
    // existing market_data. Log on every env so we can diagnose Vercel issues.
    console.warn('[iq-market-data] gather failed (post-geocode):', err);
    return null;
  }
}

// Re-export the function with a name that better matches its new behaviour, while
// keeping the legacy import name working for existing call sites.
export { gatherIqMarketDataFromGoogle as gatherIqMarketDataMultiSource };
