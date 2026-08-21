/**
 * D-5: DeepSeek-V3 competitor insights writer.
 *
 * Why this exists:
 *   - GPT-4o-mini structured JSON treats competitors as a count + a list of names,
 *     never actually reading the reviews/menus. Result: paid reports keep saying
 *     "consider differentiation on price and product" with zero specificity.
 *   - We have real Yelp Fusion reviews, Google Place Details reviews, and category
 *     tags from Foursquare. DeepSeek-V3 is ~50x cheaper than Claude/GPT-4 and is
 *     great at "summarize 30 review snippets into 1 paragraph of positioning".
 *   - Run ONCE per paid report. Cache for 14 days keyed by rounded coords + cuisine
 *     + sorted comp names. Feed the structured result into the main paid prompt as
 *     an authoritative anchor block.
 *
 * Output shape attached to marketData.competitor_insights:
 *   {
 *     provider: 'deepseek',
 *     model: 'deepseek-chat',
 *     generated_at: ISO,
 *     reviews_fetched: { google: n, yelp: n, total_excerpts: n },
 *     per_competitor: [
 *       { name, source, rating, review_count, positioning, signature_items,
 *         top_complaints, top_praise, pricing_perception, threat_level, ai_takeaway }
 *     ],
 *     cluster_summary_zh: '...',
 *     cluster_summary_en: '...',
 *     gaps_and_openings_zh: '...',
 *     gaps_and_openings_en: '...'
 *   }
 *
 * Hard rules baked into the prompt:
 *   - Only quote phrases that appear (or are clearly paraphrased) in the supplied
 *     review excerpts; never invent items not present.
 *   - Every competitor MUST get a threat_level in {high, medium, low} based on
 *     review_count * rating proximity to user's cuisine.
 *   - Gaps must be product/price/service gaps that the supplied reviews actually
 *     complain about (e.g. "long wait", "expensive boba toppings", "no oat milk").
 */

import {
  fetchGooglePlaceDetail,
  type GooglePlaceDetailPack,
} from '@/lib/funnel/external-data/google-place-details';
import {
  readMarketCache,
  writeMarketCache,
  roundCoord,
} from '@/lib/funnel/iq-market-cache';
import {
  getYelpBusinessDetail,
  type YelpBusinessDetail,
  type YelpReviewExcerpt,
} from '@/lib/funnel/external-data/yelp-competitors';

const DEEPSEEK_MODEL = process.env.DEEPSEEK_COMPETITOR_MODEL || 'deepseek-chat';
const DEEPSEEK_FALLBACK_MODEL = process.env.DEEPSEEK_COMPETITOR_FALLBACK || 'deepseek-chat';
const DEEPSEEK_ENDPOINT = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const MAX_COMPETITORS = 6; // keep token budget tight; top 6 are enough for narrative
const MAX_TOKENS = 2000;

export interface CompetitorInsightRow {
  name: string;
  source: 'google' | 'yelp' | 'foursquare' | 'mixed';
  rating: number | null;
  review_count: number | null;
  price_tier: string | null;
  positioning: string;
  signature_items: string[];
  top_complaints: string[];
  top_praise: string[];
  pricing_perception: string;
  threat_level: 'high' | 'medium' | 'low';
  ai_takeaway_zh: string;
  ai_takeaway_en: string;
}

export interface CompetitorInsights {
  provider: 'deepseek';
  model: string;
  generated_at: string;
  reviews_fetched: {
    google_competitors: number;
    yelp_competitors: number;
    total_review_excerpts: number;
  };
  per_competitor: CompetitorInsightRow[];
  cluster_summary_zh: string;
  cluster_summary_en: string;
  gaps_and_openings_zh: string;
  gaps_and_openings_en: string;
}

function getDeepSeekKey(): string {
  return (
    process.env.DEEPSEEK_API_KEY?.trim() ||
    process.env.DEEPSEEK_API_KEY_BACKUP?.trim() ||
    ''
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1: select top-N competitors across all sources, dedupe by normalized   */
/* name, and prefer rows with rating + review_count.                           */
/* -------------------------------------------------------------------------- */

interface NormalizedCompetitor {
  source: 'google' | 'yelp' | 'foursquare';
  name: string;
  rating: number | null;
  review_count: number | null;
  price_tier: string | null;
  place_id?: string | null;
  yelp_id?: string | null;
  categories?: string[];
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickTopCompetitors(
  marketData: Record<string, unknown>,
): NormalizedCompetitor[] {
  const g = Array.isArray(marketData.sample_competitors_google)
    ? (marketData.sample_competitors_google as Array<Record<string, unknown>>)
    : [];
  const y = Array.isArray(marketData.sample_competitors_yelp)
    ? (marketData.sample_competitors_yelp as Array<Record<string, unknown>>)
    : [];
  const fsq = Array.isArray(marketData.sample_competitors_foursquare)
    ? (marketData.sample_competitors_foursquare as Array<Record<string, unknown>>)
    : [];

  const rows: NormalizedCompetitor[] = [];
  for (const r of g) {
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    rows.push({
      source: 'google',
      name,
      rating: num(r.rating),
      review_count: num(r.user_ratings_total ?? r.review_count),
      price_tier: typeof r.price_level === 'number' ? '$'.repeat(Math.max(1, Math.min(4, Number(r.price_level)))) : null,
      place_id: typeof r.place_id === 'string' ? r.place_id : null,
    });
  }
  for (const r of y) {
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    rows.push({
      source: 'yelp',
      name,
      rating: num(r.rating),
      review_count: num(r.review_count),
      price_tier: typeof r.price_level === 'string' ? r.price_level : null,
      yelp_id: typeof r.yelp_id === 'string' ? r.yelp_id : null,
      categories: Array.isArray(r.categories) ? (r.categories as string[]) : [],
    });
  }
  for (const r of fsq) {
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    rows.push({
      source: 'foursquare',
      name,
      rating: num(r.rating),
      review_count: num(r.review_count ?? r.popularity),
      price_tier: typeof r.price_tier === 'string' ? r.price_tier : null,
      categories: Array.isArray(r.categories) ? (r.categories as string[]) : [],
    });
  }

  // dedupe by normalized name, keeping the row with the highest review_count
  const byName = new Map<string, NormalizedCompetitor>();
  for (const row of rows) {
    const k = normalizeName(row.name);
    if (!k) continue;
    const prev = byName.get(k);
    if (!prev) {
      byName.set(k, row);
      continue;
    }
    const a = prev.review_count ?? 0;
    const b = row.review_count ?? 0;
    if (b > a) {
      // keep new row but carry over IDs from previous (e.g. yelp_id from yelp row
      // when google row wins on review_count) so we can still pull reviews from
      // whichever side has them.
      byName.set(k, {
        ...row,
        place_id: row.place_id ?? prev.place_id ?? null,
        yelp_id: row.yelp_id ?? prev.yelp_id ?? null,
        categories: row.categories ?? prev.categories,
      });
    } else {
      byName.set(k, {
        ...prev,
        place_id: prev.place_id ?? row.place_id ?? null,
        yelp_id: prev.yelp_id ?? row.yelp_id ?? null,
        categories: prev.categories ?? row.categories,
      });
    }
  }

  // Sort by review_count desc (rating breaks ties), take top N
  return Array.from(byName.values())
    .sort((a, b) => {
      const ar = a.review_count ?? 0;
      const br = b.review_count ?? 0;
      if (br !== ar) return br - ar;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .slice(0, MAX_COMPETITORS);
}

/* -------------------------------------------------------------------------- */
/* Step 2: fetch reviews/menu for each top competitor in parallel.             */
/* -------------------------------------------------------------------------- */

interface CompetitorPack {
  comp: NormalizedCompetitor;
  google_detail: GooglePlaceDetailPack | null;
  yelp_detail: YelpBusinessDetail | null;
  yelp_reviews: YelpReviewExcerpt[];
}

async function hydrateCompetitor(comp: NormalizedCompetitor): Promise<CompetitorPack> {
  const [google_detail, yelpRes] = await Promise.all([
    comp.place_id ? fetchGooglePlaceDetail(comp.place_id) : Promise.resolve(null),
    comp.yelp_id ? getYelpBusinessDetail(comp.yelp_id) : Promise.resolve(null),
  ]);
  return {
    comp,
    google_detail,
    yelp_detail: yelpRes?.detail ?? null,
    yelp_reviews: yelpRes?.reviews ?? [],
  };
}

/* -------------------------------------------------------------------------- */
/* Step 3: build a single anchor blob for DeepSeek                             */
/* -------------------------------------------------------------------------- */

function buildAnchorBlob(packs: CompetitorPack[], cuisine: string, address: string): string {
  const lines: string[] = [];
  lines.push(`USER_BUSINESS_CUISINE: ${cuisine || '(not specified)'}`);
  lines.push(`USER_BUSINESS_ADDRESS: ${address || '(withheld)'}`);
  lines.push('');
  lines.push(`COMPETITORS (top ${packs.length} by review_count across Google + Yelp + Foursquare):`);
  lines.push('');

  packs.forEach((p, i) => {
    const c = p.comp;
    lines.push(`[#${i + 1}] ${c.name}`);
    lines.push(`  primary_source: ${c.source}`);
    if (c.rating != null) lines.push(`  rating: ${c.rating}`);
    if (c.review_count != null) lines.push(`  review_count: ${c.review_count}`);
    if (c.price_tier) lines.push(`  price_tier: ${c.price_tier}`);
    if (c.categories?.length) lines.push(`  categories: ${c.categories.slice(0, 6).join(', ')}`);

    if (p.google_detail?.editorial_summary) {
      lines.push(`  google_editorial: "${p.google_detail.editorial_summary.replace(/"/g, "'")}"`);
    }
    if (p.yelp_detail?.menu_url) {
      lines.push(`  yelp_menu_url: ${p.yelp_detail.menu_url}`);
    }
    if (p.yelp_detail?.transactions?.length) {
      lines.push(`  transactions: ${p.yelp_detail.transactions.join(', ')}`);
    }

    const googleReviews = (p.google_detail?.reviews ?? []).slice(0, 4);
    if (googleReviews.length) {
      lines.push('  google_reviews:');
      for (const r of googleReviews) {
        const snippet = r.text.replace(/\s+/g, ' ').slice(0, 350);
        lines.push(`    - (${r.rating}/5, ${r.relative_time}) "${snippet}"`);
      }
    }

    const yelpReviews = p.yelp_reviews.slice(0, 3);
    if (yelpReviews.length) {
      lines.push('  yelp_reviews:');
      for (const r of yelpReviews) {
        const snippet = r.text.replace(/\s+/g, ' ').slice(0, 350);
        lines.push(`    - (${r.rating}/5) "${snippet}"`);
      }
    }

    if (!googleReviews.length && !yelpReviews.length) {
      lines.push('  reviews: (no review excerpts available; rely on rating + name + categories)');
    }
    lines.push('');
  });

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Step 4: call DeepSeek                                                       */
/* -------------------------------------------------------------------------- */

interface DeepSeekResponseShape {
  per_competitor: Array<{
    name: string;
    positioning: string;
    signature_items: string[];
    top_complaints: string[];
    top_praise: string[];
    pricing_perception: string;
    threat_level: 'high' | 'medium' | 'low';
    ai_takeaway_zh: string;
    ai_takeaway_en: string;
  }>;
  cluster_summary_zh: string;
  cluster_summary_en: string;
  gaps_and_openings_zh: string;
  gaps_and_openings_en: string;
}

function buildSystemPrompt(): string {
  return [
    'You are a McKinsey site-selection analyst specializing in restaurant + beverage retail.',
    'You will receive a structured anchor block describing the top 4-6 competitors near a candidate location,',
    'with Yelp/Google review excerpts, ratings, review counts, price tiers, and category tags.',
    '',
    'STRICT RULES:',
    '1. Every claim about a competitor MUST trace back to a phrase that appears in (or is a near paraphrase of)',
    '   the supplied review excerpts, editorial summaries, or category tags. Do NOT invent menu items, prices,',
    '   wait times, or hours that the data does not show.',
    '2. signature_items: pull from review/editorial mentions (e.g. "brown sugar boba", "taro slush"). If reviews',
    '   never name specific items, return [].',
    '3. top_complaints and top_praise: list at most 3 each, each a 4-10 word phrase grounded in actual reviews.',
    '4. threat_level: high = direct cuisine + nearby + >=200 reviews + rating >=4.0;',
    '                  medium = adjacent cuisine OR 50-200 reviews;',
    '                  low = <50 reviews OR clearly different segment.',
    '5. pricing_perception: short phrase (e.g. "perceived as cheap and fast", "premium teahouse pricing").',
    '6. cluster_summary_zh / cluster_summary_en (2-3 sentences each): describe the overall competitive cluster',
    '   shape — how many high-threat players, the dominant positioning, the price band ceiling/floor.',
    '7. gaps_and_openings_zh / gaps_and_openings_en (2-3 sentences each): name 2-3 concrete product / service /',
    '   price gaps the user could exploit, grounded in actual review complaints.',
    '8. Return ONLY valid JSON matching the requested schema. No prose outside the JSON envelope.',
    '9. zh fields: write in Simplified Chinese.  en fields: write in English.',
    '10. Lists in JSON must be JSON arrays, not comma-separated strings.',
  ].join('\n');
}

function buildUserPrompt(anchorBlob: string): string {
  return [
    'Analyse the following competitive set and return JSON.',
    '',
    '------ ANCHOR DATA ------',
    anchorBlob,
    '------ END ANCHOR ------',
    '',
    'Return JSON matching exactly this schema (no comments, no trailing commas):',
    '{',
    '  "per_competitor": [',
    '    {',
    '      "name": "(exact competitor name from anchor)",',
    '      "positioning": "(1 sentence, 12-25 words)",',
    '      "signature_items": ["...", "..."],',
    '      "top_complaints": ["...", "..."],',
    '      "top_praise": ["...", "..."],',
    '      "pricing_perception": "(short phrase)",',
    '      "threat_level": "high" | "medium" | "low",',
    '      "ai_takeaway_zh": "(1-2 Chinese sentences specific to this competitor)",',
    '      "ai_takeaway_en": "(1-2 English sentences specific to this competitor)"',
    '    }',
    '  ],',
    '  "cluster_summary_zh": "(2-3 Chinese sentences)",',
    '  "cluster_summary_en": "(2-3 English sentences)",',
    '  "gaps_and_openings_zh": "(2-3 Chinese sentences, name specific gaps)",',
    '  "gaps_and_openings_en": "(2-3 English sentences, name specific gaps)"',
    '}',
  ].join('\n');
}

async function callDeepSeek(opts: {
  apiKey: string;
  model: string;
  anchorBlob: string;
}): Promise<DeepSeekResponseShape | null> {
  const url = `${DEEPSEEK_ENDPOINT.replace(/\/$/, '')}/chat/completions`;
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(opts.anchorBlob);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      cache: 'no-store',
    });
  } catch (err) {
    console.warn('[iq-deepseek-competitor-insights] fetch threw:', err);
    return null;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.warn(
      '[iq-deepseek-competitor-insights] %s HTTP %d: %s',
      opts.model,
      response.status,
      errText.slice(0, 200),
    );
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  if (!payload || !Array.isArray(payload.choices) || !payload.choices.length) {
    return null;
  }
  const text = String(payload.choices[0]?.message?.content ?? '').trim();
  if (!text) return null;

  const tryParse = (raw: string): DeepSeekResponseShape | null => {
    try {
      const parsed = JSON.parse(raw) as DeepSeekResponseShape;
      if (parsed && Array.isArray(parsed.per_competitor)) {
        return parsed;
      }
    } catch {
      /* swallow */
    }
    return null;
  };

  const direct = tryParse(text);
  if (direct) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return tryParse(text.slice(start, end + 1));
  return null;
}

/* -------------------------------------------------------------------------- */
/* Step 5: zip DeepSeek output back onto the picked competitors + sanity-check */
/* -------------------------------------------------------------------------- */

function buildFinalRows(
  packs: CompetitorPack[],
  ds: DeepSeekResponseShape,
): CompetitorInsightRow[] {
  // Map by normalized name so DeepSeek can use the exact comp name from the anchor.
  const dsByName = new Map<string, DeepSeekResponseShape['per_competitor'][number]>();
  for (const row of ds.per_competitor || []) {
    if (row?.name) dsByName.set(normalizeName(row.name), row);
  }

  return packs.map((pack) => {
    const c = pack.comp;
    const ds = dsByName.get(normalizeName(c.name));
    const threat: 'high' | 'medium' | 'low' =
      ds?.threat_level === 'high' || ds?.threat_level === 'low' ? ds.threat_level : 'medium';
    return {
      name: c.name,
      source: c.source,
      rating: c.rating,
      review_count: c.review_count,
      price_tier: c.price_tier,
      positioning: typeof ds?.positioning === 'string' ? ds.positioning.trim() : '',
      signature_items: Array.isArray(ds?.signature_items)
        ? ds!.signature_items.map((s) => String(s).trim()).filter(Boolean).slice(0, 5)
        : [],
      top_complaints: Array.isArray(ds?.top_complaints)
        ? ds!.top_complaints.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
        : [],
      top_praise: Array.isArray(ds?.top_praise)
        ? ds!.top_praise.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
        : [],
      pricing_perception: typeof ds?.pricing_perception === 'string' ? ds.pricing_perception.trim() : '',
      threat_level: threat,
      ai_takeaway_zh: typeof ds?.ai_takeaway_zh === 'string' ? ds.ai_takeaway_zh.trim() : '',
      ai_takeaway_en: typeof ds?.ai_takeaway_en === 'string' ? ds.ai_takeaway_en.trim() : '',
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Idempotent. Returns marketData unchanged if:
 *  - DEEPSEEK_API_KEY is unset
 *  - marketData.competitor_insights is already populated
 *  - no usable competitors in marketData
 *  - DeepSeek call fails (logs a warning)
 */
export async function enrichMarketDataWithCompetitorInsights(
  marketData: Record<string, unknown>,
  opts: { cuisine?: string | null; address?: string | null },
): Promise<Record<string, unknown>> {
  if (marketData.competitor_insights && typeof marketData.competitor_insights === 'object') {
    return marketData;
  }

  const apiKey = getDeepSeekKey();
  if (!apiKey) {
    return marketData;
  }

  const picked = pickTopCompetitors(marketData);
  if (!picked.length) {
    return marketData;
  }

  // Cache key: rounded geo + cuisine + sorted comp names.
  const geo = (marketData.geocode as Record<string, unknown> | undefined) ?? {};
  const lat = Number(geo.lat);
  const lng = Number(geo.lng);
  const cuisine = (opts.cuisine || '').trim().toLowerCase() || 'restaurant';
  const address = (opts.address || '').trim() || '(withheld)';
  const sortedNames = picked
    .map((p) => normalizeName(p.name))
    .sort()
    .join('|');
  const cacheKey = `lat=${roundCoord(lat)}::lng=${roundCoord(lng)}::cuisine=${cuisine}::comps=${sortedNames}`;

  const cached = await readMarketCache<CompetitorInsights>({
    source: 'deepseek_competitor_insights',
    key: cacheKey,
  });
  if (cached && Array.isArray(cached.per_competitor) && cached.per_competitor.length) {
    return { ...marketData, competitor_insights: cached };
  }

  // Fetch reviews for picked competitors (parallel).
  const packs = await Promise.all(picked.map(hydrateCompetitor));

  // Count what we actually got — if we have zero excerpts across the board, the
  // LLM has nothing to summarize and would hallucinate. Skip.
  const totalExcerpts = packs.reduce(
    (acc, p) => acc + (p.google_detail?.reviews?.length ?? 0) + p.yelp_reviews.length,
    0,
  );
  const googleHits = packs.filter((p) => p.google_detail).length;
  const yelpHits = packs.filter((p) => p.yelp_detail).length;
  if (totalExcerpts < 2) {
    console.log(
      '[iq-deepseek-competitor-insights] only %d review excerpts available, skipping (google_hits=%d yelp_hits=%d)',
      totalExcerpts,
      googleHits,
      yelpHits,
    );
    return marketData;
  }

  const anchorBlob = buildAnchorBlob(packs, cuisine, address);

  let dsResp: DeepSeekResponseShape | null = null;
  let usedModel = DEEPSEEK_MODEL;
  try {
    dsResp = await callDeepSeek({ apiKey, model: DEEPSEEK_MODEL, anchorBlob });
  } catch (err) {
    console.warn('[iq-deepseek-competitor-insights] primary call threw', err);
  }

  if (!dsResp && DEEPSEEK_FALLBACK_MODEL !== DEEPSEEK_MODEL) {
    try {
      usedModel = DEEPSEEK_FALLBACK_MODEL;
      dsResp = await callDeepSeek({ apiKey, model: DEEPSEEK_FALLBACK_MODEL, anchorBlob });
    } catch (err) {
      console.warn('[iq-deepseek-competitor-insights] fallback call threw', err);
    }
  }

  if (!dsResp) {
    return marketData;
  }

  const insights: CompetitorInsights = {
    provider: 'deepseek',
    model: usedModel,
    generated_at: new Date().toISOString(),
    reviews_fetched: {
      google_competitors: googleHits,
      yelp_competitors: yelpHits,
      total_review_excerpts: totalExcerpts,
    },
    per_competitor: buildFinalRows(packs, dsResp),
    cluster_summary_zh: String(dsResp.cluster_summary_zh ?? '').trim(),
    cluster_summary_en: String(dsResp.cluster_summary_en ?? '').trim(),
    gaps_and_openings_zh: String(dsResp.gaps_and_openings_zh ?? '').trim(),
    gaps_and_openings_en: String(dsResp.gaps_and_openings_en ?? '').trim(),
  };

  try {
    await writeMarketCache({
      source: 'deepseek_competitor_insights',
      key: cacheKey,
      payload: insights,
      ttlSeconds: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.warn('[iq-deepseek-competitor-insights] cache write failed', err);
  }

  return { ...marketData, competitor_insights: insights };
}

export function isDeepSeekCompetitorInsightsConfigured(): boolean {
  return Boolean(getDeepSeekKey());
}
