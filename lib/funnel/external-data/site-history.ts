/**
 * Site history: the business(es) operating — or that used to operate — at the
 * exact target address, with their Google + Yelp reviews.
 *
 * Every other market source looks at *nearby competitors*; nothing asked the
 * most predictive question in site selection: "what happened to the last
 * restaurant in this very box, and what did customers say about it?" A
 * permanently-closed predecessor with complaints about parking, visibility or
 * price is a site signal, not a competitor signal.
 *
 * Pipeline: Google Find Place + Nearby (≤45 m) ∪ Yelp search (≤60 m) → match
 * by distance or street number → Place Details / Yelp detail for reviews →
 * short LLM theme extraction → `market_data.site_history`.
 */

import { envValue } from '@/lib/env-value';
import { readMarketCache, writeMarketCache, roundCoord } from '@/lib/funnel/iq-market-cache';
import { runIqProviderJson } from '@/lib/funnel/iq-provider-router';
import { fetchGooglePlaceDetail } from '@/lib/funnel/external-data/google-place-details';
import { getYelpBusinessDetail } from '@/lib/funnel/external-data/yelp-competitors';

const MATCH_RADIUS_M = 45;
const YELP_RADIUS_M = 60;
const MAX_BUSINESSES = 4;
const PACK_TTL_S = 7 * 24 * 3600;
const FOOD_TYPES = new Set([
  'restaurant',
  'food',
  'cafe',
  'bar',
  'bakery',
  'meal_takeaway',
  'meal_delivery',
  'night_club',
]);

export type SiteBusinessStatus =
  | 'operational'
  | 'closed_temporarily'
  | 'closed_permanently'
  | 'unknown';

export interface SiteHistoryReview {
  source: 'google' | 'yelp';
  rating: number | null;
  text: string;
  time: string;
  author: string;
}

export interface SiteHistoryBusiness {
  source: 'google' | 'yelp';
  id: string;
  name: string;
  status: SiteBusinessStatus;
  is_food: boolean;
  rating: number | null;
  review_count: number | null;
  price_level: number | null;
  categories: string[];
  address: string | null;
  distance_m: number | null;
  url: string | null;
  reviews: SiteHistoryReview[];
}

export interface SiteHistoryAnalysis {
  prior_business_name: string | null;
  status_summary: string;
  positive_themes: string[];
  negative_themes: string[];
  closure_signals: string[];
  lessons_for_new_operator: string[];
  risk_flag: 'low' | 'medium' | 'high';
  summary_zh: string;
  summary_en: string;
  provider?: string;
  model?: string;
}

export interface SiteHistoryPack {
  source: 'site_history';
  fetched_at: string;
  address: string;
  center: { lat: number; lng: number } | null;
  match_radius_m: number;
  businesses: SiteHistoryBusiness[];
  closed_count: number;
  operational_count: number;
  total_reviews_sampled: number;
  api_status: { google: string; yelp: string };
  analysis: SiteHistoryAnalysis | null;
}

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** "1711 El Camino Real, Millbrae, CA 94030" → "1711 el camino real" */
function streetKey(addr: string | null | undefined): string {
  if (!addr) return '';
  const first = addr.split(',')[0] ?? '';
  return first
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|real|way)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameStreet(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = streetKey(a);
  const kb = streetKey(b);
  if (!ka || !kb) return false;
  const na = ka.match(/^\d+/)?.[0];
  const nb = kb.match(/^\d+/)?.[0];
  return Boolean(na && nb && na === nb && (ka.includes(kb.slice(na.length).trim()) || kb.includes(ka.slice(na.length).trim())));
}

function googleStatus(s: unknown): SiteBusinessStatus {
  if (s === 'OPERATIONAL') return 'operational';
  if (s === 'CLOSED_TEMPORARILY') return 'closed_temporarily';
  if (s === 'CLOSED_PERMANENTLY') return 'closed_permanently';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

type GoogleCandidate = {
  place_id: string;
  name: string;
  formatted_address: string | null;
  business_status: unknown;
  lat: number | null;
  lng: number | null;
  types: string[];
  rating: number | null;
  user_ratings_total: number | null;
  price_level: number | null;
};

async function googleCandidatesAtAddress(
  address: string,
  center: { lat: number; lng: number } | null,
): Promise<{ candidates: GoogleCandidate[]; status: string }> {
  const apiKey = envValue('GOOGLE_MAPS_API_KEY') || envValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return { candidates: [], status: 'no_key' };
  const byId = new Map<string, GoogleCandidate>();
  const push = (r: Record<string, unknown>) => {
    const id = typeof r.place_id === 'string' ? r.place_id : null;
    if (!id || byId.has(id)) return;
    const geo = (r.geometry as { location?: { lat?: number; lng?: number } } | undefined)?.location;
    byId.set(id, {
      place_id: id,
      name: String(r.name ?? ''),
      formatted_address:
        typeof r.formatted_address === 'string' ? r.formatted_address : typeof r.vicinity === 'string' ? r.vicinity : null,
      business_status: r.business_status,
      lat: asNum(geo?.lat),
      lng: asNum(geo?.lng),
      types: Array.isArray(r.types) ? (r.types as string[]) : [],
      rating: asNum(r.rating),
      user_ratings_total: asNum(r.user_ratings_total),
      price_level: asNum(r.price_level),
    });
  };
  let status = 'ok';
  try {
    const fp = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
    fp.searchParams.set('input', address);
    fp.searchParams.set('inputtype', 'textquery');
    fp.searchParams.set('fields', 'place_id,name,formatted_address,business_status,geometry,types,rating,user_ratings_total,price_level');
    fp.searchParams.set('key', apiKey);
    const fpRes = await fetch(fp, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    const fpJson = (await fpRes.json()) as { status?: string; candidates?: Record<string, unknown>[] };
    if (fpJson.status && fpJson.status !== 'OK' && fpJson.status !== 'ZERO_RESULTS') status = fpJson.status;
    (fpJson.candidates ?? []).forEach(push);

    if (center) {
      const nb = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      nb.searchParams.set('location', `${center.lat},${center.lng}`);
      nb.searchParams.set('radius', String(MATCH_RADIUS_M));
      nb.searchParams.set('key', apiKey);
      const nbRes = await fetch(nb, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
      const nbJson = (await nbRes.json()) as { status?: string; results?: Record<string, unknown>[] };
      (nbJson.results ?? []).forEach(push);
    }
  } catch (e) {
    status = `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`;
  }
  return { candidates: [...byId.values()], status };
}

// ---------------------------------------------------------------------------
// Yelp
// ---------------------------------------------------------------------------

type YelpSearchRow = {
  id: string;
  name?: string;
  is_closed?: boolean;
  rating?: number;
  review_count?: number;
  price?: string;
  categories?: Array<{ title?: string }>;
  distance?: number;
  url?: string;
  location?: { display_address?: string[] };
  coordinates?: { latitude?: number; longitude?: number };
};

async function yelpAtAddress(
  address: string,
  center: { lat: number; lng: number } | null,
): Promise<{ rows: YelpSearchRow[]; status: string }> {
  const apiKey = envValue('YELP_API_KEY');
  if (!apiKey) return { rows: [], status: 'no_key' };
  const params = new URLSearchParams({ limit: '8', radius: String(YELP_RADIUS_M) });
  if (center) {
    params.set('latitude', String(center.lat));
    params.set('longitude', String(center.lng));
    params.set('sort_by', 'distance');
  } else {
    params.set('location', address);
  }
  try {
    const res = await fetch(`https://api.yelp.com/v3/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { rows: [], status: `http_${res.status}` };
    const json = (await res.json()) as { businesses?: YelpSearchRow[] };
    return { rows: json.businesses ?? [], status: 'ok' };
  } catch (e) {
    return { rows: [], status: `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}` };
  }
}

// ---------------------------------------------------------------------------
// Pack builder
// ---------------------------------------------------------------------------

export async function fetchSiteHistoryPack(input: {
  address: string;
  center: { lat: number; lng: number } | null;
}): Promise<SiteHistoryPack> {
  const { address, center } = input;
  const cacheKey = center
    ? `${roundCoord(center.lat)},${roundCoord(center.lng)}|${streetKey(address)}`
    : `addr:${address.toLowerCase().trim()}`;
  const cached = await readMarketCache<SiteHistoryPack>({ source: 'site_history', key: cacheKey });
  if (cached) return cached;

  const [g, y] = await Promise.all([googleCandidatesAtAddress(address, center), yelpAtAddress(address, center)]);

  const isAtSite = (lat: number | null, lng: number | null, addr: string | null, dist: number | null): boolean => {
    if (dist != null && dist <= MATCH_RADIUS_M) return true;
    if (center && lat != null && lng != null && haversineM(center.lat, center.lng, lat, lng) <= MATCH_RADIUS_M) return true;
    return sameStreet(addr, address);
  };

  const googleHits = g.candidates
    .map((c) => ({
      c,
      dist: center && c.lat != null && c.lng != null ? Math.round(haversineM(center.lat, center.lng, c.lat, c.lng)) : null,
    }))
    .filter(({ c, dist }) => isAtSite(c.lat, c.lng, c.formatted_address, dist))
    .sort((a, b) => Number(b.c.types.some((t) => FOOD_TYPES.has(t))) - Number(a.c.types.some((t) => FOOD_TYPES.has(t))))
    .slice(0, MAX_BUSINESSES);

  const yelpHits = y.rows
    .filter((r) => {
      const dist = asNum(r.distance);
      const addr = r.location?.display_address?.join(', ') ?? null;
      return isAtSite(asNum(r.coordinates?.latitude), asNum(r.coordinates?.longitude), addr, dist);
    })
    .slice(0, 3);

  const businesses: SiteHistoryBusiness[] = [];

  await Promise.all(
    googleHits.map(async ({ c, dist }) => {
      const detail = await fetchGooglePlaceDetail(c.place_id).catch(() => null);
      businesses.push({
        source: 'google',
        id: c.place_id,
        name: detail?.name || c.name,
        status: googleStatus(c.business_status),
        is_food: c.types.some((t) => FOOD_TYPES.has(t)),
        rating: detail?.rating ?? c.rating,
        review_count: detail?.user_ratings_total ?? c.user_ratings_total,
        price_level: detail?.price_level ?? c.price_level,
        categories: c.types.filter((t) => t !== 'point_of_interest' && t !== 'establishment').slice(0, 4),
        address: c.formatted_address,
        distance_m: dist,
        url: `https://www.google.com/maps/place/?q=place_id:${c.place_id}`,
        reviews: (detail?.reviews ?? []).map((r) => ({
          source: 'google' as const,
          rating: asNum(r.rating),
          text: r.text,
          time: r.relative_time,
          author: r.author_name,
        })),
      });
    }),
  );

  await Promise.all(
    yelpHits.map(async (r) => {
      const detail = await getYelpBusinessDetail(r.id).catch(() => null);
      businesses.push({
        source: 'yelp',
        id: r.id,
        name: detail?.detail.name || String(r.name ?? ''),
        status: r.is_closed === true ? 'closed_permanently' : r.is_closed === false ? 'operational' : 'unknown',
        is_food: true,
        rating: detail?.detail.rating ?? asNum(r.rating),
        review_count: detail?.detail.review_count ?? asNum(r.review_count),
        price_level: r.price ? Math.min(4, r.price.length) : null,
        categories: detail?.detail.categories ?? (r.categories ?? []).map((c) => c.title ?? '').filter(Boolean),
        address: r.location?.display_address?.join(', ') ?? null,
        distance_m: asNum(r.distance) != null ? Math.round(asNum(r.distance)!) : null,
        url: detail?.detail.url || r.url || null,
        reviews: (detail?.reviews ?? []).map((rv) => ({
          source: 'yelp' as const,
          rating: asNum(rv.rating),
          text: rv.text,
          time: rv.time_created,
          author: rv.user_name,
        })),
      });
    }),
  );

  const pack: SiteHistoryPack = {
    source: 'site_history',
    fetched_at: new Date().toISOString(),
    address,
    center,
    match_radius_m: MATCH_RADIUS_M,
    businesses,
    closed_count: businesses.filter((b) => b.status.startsWith('closed')).length,
    operational_count: businesses.filter((b) => b.status === 'operational').length,
    total_reviews_sampled: businesses.reduce((n, b) => n + b.reviews.length, 0),
    api_status: { google: g.status, yelp: y.status },
    analysis: null,
  };
  await writeMarketCache({ source: 'site_history', key: cacheKey, payload: pack, ttlSeconds: PACK_TTL_S });
  return pack;
}

// ---------------------------------------------------------------------------
// LLM theme extraction (short, bounded)
// ---------------------------------------------------------------------------

export async function analyzeSiteHistory(
  pack: SiteHistoryPack,
  opts: { cuisine: string; lang: 'en' | 'zh' },
): Promise<SiteHistoryAnalysis | null> {
  if (pack.businesses.length === 0) return null;
  const excerpts = pack.businesses.flatMap((b) =>
    b.reviews.slice(0, 5).map((r) => ({
      business: b.name,
      status: b.status,
      source: r.source,
      rating: r.rating,
      time: r.time,
      text: r.text.slice(0, 350),
    })),
  );
  const system = [
    'You are a restaurant site-selection analyst. You are given the businesses that operate or operated AT THE EXACT ADDRESS a client wants to lease, with their Google/Yelp review excerpts.',
    'Extract what the site itself taught previous operators. Every theme MUST trace to a supplied excerpt or status field — never invent. If reviews are too few, say so in status_summary and keep arrays short.',
    'Output ONLY a JSON object with keys: prior_business_name (string|null), status_summary (string), positive_themes (string[]), negative_themes (string[]), closure_signals (string[]), lessons_for_new_operator (string[]), risk_flag ("low"|"medium"|"high"), summary_zh (string, 中文 2-3 句), summary_en (string, 2-3 sentences).',
    'risk_flag: high = a food business at this address closed permanently with location/operations complaints; medium = closed or mixed signals; low = operational with good reviews or no prior food business.',
  ].join('\n');
  const user = JSON.stringify(
    {
      address: pack.address,
      new_concept: opts.cuisine,
      businesses: pack.businesses.map((b) => ({
        name: b.name,
        source: b.source,
        status: b.status,
        is_food: b.is_food,
        rating: b.rating,
        review_count: b.review_count,
        price_level: b.price_level,
        categories: b.categories,
        distance_m: b.distance_m,
      })),
      review_excerpts: excerpts,
    },
    null,
    1,
  );
  const routed = await runIqProviderJson<Record<string, unknown>>({
    task: 'iq_competitor_insights',
    system,
    user,
    timeoutMs: 45_000,
    maxTokens: 1_400,
  });
  const d = routed?.data;
  if (!d) return null;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 6) : []);
  const flag = String(d.risk_flag ?? '').toLowerCase();
  return {
    prior_business_name: typeof d.prior_business_name === 'string' ? d.prior_business_name : null,
    status_summary: String(d.status_summary ?? ''),
    positive_themes: arr(d.positive_themes),
    negative_themes: arr(d.negative_themes),
    closure_signals: arr(d.closure_signals),
    lessons_for_new_operator: arr(d.lessons_for_new_operator),
    risk_flag: flag === 'high' || flag === 'medium' || flag === 'low' ? flag : 'medium',
    summary_zh: String(d.summary_zh ?? ''),
    summary_en: String(d.summary_en ?? ''),
    provider: routed?.provider,
    model: routed?.model,
  };
}

/**
 * Attach `site_history` to market_data (idempotent: keeps an existing pack
 * that already carries an analysis).
 */
export async function enrichMarketDataWithSiteHistory(
  base: Record<string, unknown>,
  opts: { address: string; cuisine: string; lang: 'en' | 'zh' },
): Promise<Record<string, unknown>> {
  const existing = base.site_history as SiteHistoryPack | undefined;
  if (existing && typeof existing === 'object' && existing.analysis) return base;

  const geo = base.geocode as { lat?: number; lng?: number } | undefined;
  const center =
    geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lng)) && Number(geo.lat) !== 0
      ? { lat: Number(geo.lat), lng: Number(geo.lng) }
      : null;

  const pack = existing && typeof existing === 'object' && Array.isArray(existing.businesses)
    ? existing
    : await fetchSiteHistoryPack({ address: opts.address, center });

  if (pack.businesses.length > 0 && pack.total_reviews_sampled >= 2 && !pack.analysis) {
    try {
      pack.analysis = await analyzeSiteHistory(pack, { cuisine: opts.cuisine, lang: opts.lang });
    } catch (e) {
      console.warn('[site-history] analysis failed:', e instanceof Error ? e.message : e);
    }
  }
  console.log(
    `[site-history] ${pack.businesses.length} business(es) at address (${pack.closed_count} closed, ${pack.total_reviews_sampled} reviews) google=${pack.api_status.google} yelp=${pack.api_status.yelp}`,
  );
  return { ...base, site_history: pack };
}

// ---------------------------------------------------------------------------
// Prompt anchors
// ---------------------------------------------------------------------------

export function buildSiteHistoryBlock(pack: SiteHistoryPack | null | undefined, lang: 'en' | 'zh'): string {
  if (!pack || typeof pack !== 'object') return '';
  const zh = lang === 'zh';
  const L: string[] = [];
  L.push(
    zh
      ? '\n\n【该地址过往/现有商家（实测数据 — site_history 字段必须基于此，禁止臆测）】'
      : '\n\n[BUSINESSES AT THIS EXACT ADDRESS — retrieved; site_history MUST be grounded here, never guessed]',
  );
  if (pack.businesses.length === 0) {
    L.push(
      zh
        ? `- 在 ${pack.match_radius_m}m 半径内未检索到任何商家记录（Google: ${pack.api_status.google}, Yelp: ${pack.api_status.yelp}）。site_history.prior_failures_detected 写 false 并说明「无历史商家记录」。`
        : `- No business found within ${pack.match_radius_m} m (Google: ${pack.api_status.google}, Yelp: ${pack.api_status.yelp}). Set site_history.prior_failures_detected=false and state "no prior business on record".`,
    );
    return L.join('\n');
  }
  for (const b of pack.businesses) {
    const status = zh
      ? { operational: '营业中', closed_temporarily: '暂停营业', closed_permanently: '已永久关闭', unknown: '状态未知' }[b.status]
      : b.status.replace('_', ' ');
    L.push(
      `- ${b.name} [${b.source}] — ${status}; ${b.rating ?? '?'}★ / ${b.review_count ?? '?'} reviews; ${b.categories.slice(0, 3).join(', ') || (b.is_food ? 'food' : 'non-food')}${b.distance_m != null ? `; ${b.distance_m} m` : ''}`,
    );
    for (const r of b.reviews.slice(0, 3)) {
      L.push(`    · (${r.rating ?? '?'}★ ${r.time}) "${r.text.slice(0, 220).replace(/\s+/g, ' ')}"`);
    }
  }
  if (pack.analysis) {
    const a = pack.analysis;
    L.push(zh ? `- 评论主题提炼（${a.risk_flag} 风险）：` : `- Review theme extraction (${a.risk_flag} risk):`);
    if (a.negative_themes.length) L.push(`  ${zh ? '负面' : 'negative'}: ${a.negative_themes.join(' | ')}`);
    if (a.positive_themes.length) L.push(`  ${zh ? '正面' : 'positive'}: ${a.positive_themes.join(' | ')}`);
    if (a.closure_signals.length) L.push(`  ${zh ? '关店信号' : 'closure signals'}: ${a.closure_signals.join(' | ')}`);
    if (a.lessons_for_new_operator.length) L.push(`  ${zh ? '对新经营者的启示' : 'lessons'}: ${a.lessons_for_new_operator.join(' | ')}`);
  }
  L.push(
    zh
      ? `- 要求：site_history 须填 prior_business_name / prior_business_status / review_themes_positive / review_themes_negative / lessons_for_new_operator；若餐饮商家已永久关闭，prior_failures_detected=true 且 decision_tier 不高于 go_with_conditions；并在 risks 与 site_and_access_assessment 中引用具体评论主题。`
      : `- Required: fill site_history.prior_business_name / prior_business_status / review_themes_positive / review_themes_negative / lessons_for_new_operator; if a food business here closed permanently, prior_failures_detected=true and decision_tier no higher than go_with_conditions; cite the concrete review themes in risks and site_and_access_assessment.`,
  );
  return L.join('\n');
}
