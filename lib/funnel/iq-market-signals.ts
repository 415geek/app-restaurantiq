/**
 * Single source of truth for "what competitors are actually retrieved" so that
 * prompts, schema validation, the competitor map, and UI badges all agree.
 *
 * Why this file exists (B-1 of report-grounding upgrade):
 *   The LLM has historically invented competitor names ("Boba Express", "A 外卖")
 *   even when given a verbatim Places list. We can patch the prompt all day but
 *   we still need a post-LLM enforcement layer so anything the model hallucinates
 *   gets silently dropped, with the report degraded to "insufficient data".
 *
 * Sources merged (in priority order):
 *   - google_raw.textsearch.results[].name
 *   - summary.sample_competitors_google[].name
 *   - summary.sample_competitors_yelp[].name
 *   - brightdata_research.search_results[] (best-effort)
 *
 * The whitelist is lowercase + punctuation-stripped; exact case + accents are
 * preserved on `originalByKey` for re-display.
 */

export const MIN_WHITELIST_FOR_GROUNDED_REPORT = 3;

export type CompetitorWhitelistEntry = {
  /** Best display name (from the first source that yielded this normalized key). */
  display: string;
  /** Optional address from Google Places. */
  address?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  /** lat,lng if known — used by the competitor map. */
  lat?: number;
  lng?: number;
  /** ['google', 'yelp', 'brightdata'] — the sources that mention this name. */
  sources: string[];
};

export type CompetitorWhitelist = {
  /** Normalized lowercase keys (use for matching). */
  keys: Set<string>;
  /** Normalized key → entry. */
  byKey: Map<string, CompetitorWhitelistEntry>;
  /** Display names preserving original capitalization (deduped). */
  displayNames: string[];
  /** Total distinct competitors after dedupe. */
  total: number;
  /** Granular per-source counts (for confidence chips + UI). */
  countsBySource: { google: number; yelp: number; brightdata: number };
};

// Smart quotes, em/en-dash, common ASCII punctuation, middle dot.
const PUNCT_RE = /[\u2018\u2019\u201c\u201d\u2013\u2014''"`'""·\-!@#$%^&*()_+={}\[\]|\\:;<>,.?/~]/g;

/** Lowercase + strip punctuation + collapse whitespace. Used for fuzzy whitelist match. */
export function normalizeCompetitorName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function addEntry(
  byKey: Map<string, CompetitorWhitelistEntry>,
  source: string,
  raw: {
    name?: unknown;
    address?: unknown;
    rating?: unknown;
    reviewCount?: unknown;
    priceLevel?: unknown;
    lat?: unknown;
    lng?: unknown;
  },
): void {
  const display = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!display) return;
  const key = normalizeCompetitorName(display);
  if (!key) return;

  const existing = byKey.get(key);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    // Backfill missing fields from later sources without overwriting.
    if (existing.address == null && typeof raw.address === 'string') existing.address = raw.address;
    if (existing.rating == null) existing.rating = pickNum(raw.rating);
    if (existing.reviewCount == null) existing.reviewCount = pickNum(raw.reviewCount);
    if (existing.priceLevel == null) existing.priceLevel = pickNum(raw.priceLevel);
    if (existing.lat == null) existing.lat = pickNum(raw.lat);
    if (existing.lng == null) existing.lng = pickNum(raw.lng);
    return;
  }
  byKey.set(key, {
    display,
    address: typeof raw.address === 'string' ? raw.address : undefined,
    rating: pickNum(raw.rating),
    reviewCount: pickNum(raw.reviewCount),
    priceLevel: pickNum(raw.priceLevel),
    lat: pickNum(raw.lat),
    lng: pickNum(raw.lng),
    sources: [source],
  });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Derive a normalized competitor whitelist from any market_data shape we ship:
 * top-level `summary` + `google_raw` + `brightdata_research`, or the nested
 * `external_data` shape coming back from n8n.
 *
 * Pure function — no I/O, safe to run anywhere.
 */
export function extractCompetitorWhitelist(
  marketData: Record<string, unknown> | null | undefined,
): CompetitorWhitelist {
  const byKey = new Map<string, CompetitorWhitelistEntry>();
  const counts = { google: 0, yelp: 0, brightdata: 0 };

  if (!marketData) {
    return { keys: new Set(), byKey, displayNames: [], total: 0, countsBySource: counts };
  }

  // Resolve either flat or nested-under-external_data shape.
  const root: Record<string, unknown> = marketData;
  const ext = asRecord(root.external_data);
  const summary =
    asRecord(root.summary) ?? (ext ? asRecord(ext.summary) : null);
  const googleRaw =
    asRecord(root.google_raw) ?? (ext ? asRecord(ext.google_raw) : null);
  const brightData =
    asRecord(root.brightdata_research) ?? (ext ? asRecord(ext.brightdata_research) : null);

  // Pass 1: Google Places text-search raw rows (highest fidelity — has lat/lng).
  const textsearch = googleRaw ? asRecord(googleRaw.textsearch) : null;
  const googleRows = textsearch ? asArray(textsearch.results) : [];
  const beforeGoogle = byKey.size;
  for (const row of googleRows) {
    const r = asRecord(row);
    if (!r) continue;
    const geo = asRecord(r.geometry);
    const loc = geo ? asRecord(geo.location) : null;
    addEntry(byKey, 'google', {
      name: r.name,
      address: r.formatted_address ?? r.vicinity,
      rating: r.rating,
      reviewCount: r.user_ratings_total,
      priceLevel: r.price_level,
      lat: loc?.lat,
      lng: loc?.lng,
    });
  }
  counts.google = byKey.size - beforeGoogle;

  // Pass 2: summary.sample_competitors_google (already normalized rows).
  for (const row of summary ? asArray(summary.sample_competitors_google) : []) {
    const r = asRecord(row);
    if (!r) continue;
    addEntry(byKey, 'google', {
      name: r.name,
      address: r.address,
      rating: r.rating,
      reviewCount: r.reviews,
      priceLevel: r.price_level,
      lat: r.lat,
      lng: r.lng,
    });
  }
  // Recount google because sample rows can add new names.
  counts.google = 0;
  for (const e of byKey.values()) if (e.sources.includes('google')) counts.google += 1;

  // Pass 3: Yelp samples.
  const beforeYelp = byKey.size;
  for (const row of summary ? asArray(summary.sample_competitors_yelp) : []) {
    const r = asRecord(row);
    if (!r) continue;
    addEntry(byKey, 'yelp', {
      name: r.name,
      address: r.address,
      rating: r.rating,
      reviewCount: r.review_count ?? r.reviews,
      priceLevel: r.price,
      lat: r.lat ?? (asRecord(r.coordinates)?.latitude as unknown),
      lng: r.lng ?? (asRecord(r.coordinates)?.longitude as unknown),
    });
  }
  counts.yelp = 0;
  for (const e of byKey.values()) if (e.sources.includes('yelp')) counts.yelp += 1;

  // Pass 4: Bright Data — looser shape; try a couple of known fields.
  if (brightData) {
    const competitors = asArray(brightData.competitor_reviews);
    for (const row of competitors) {
      const r = asRecord(row);
      if (!r) continue;
      addEntry(byKey, 'brightdata', {
        name: r.business_name ?? r.name,
        address: r.address,
        rating: r.rating,
        reviewCount: r.review_count ?? r.reviews,
      });
    }
    // Generic SERP / search results often carry a `title` and `domain`.
    for (const row of asArray(brightData.search_results)) {
      const r = asRecord(row);
      if (!r) continue;
      const title = typeof r.title === 'string' ? r.title : '';
      // Only treat as a competitor if title looks restaurant-ish AND we don't
      // already have it. We're conservative here because SERP titles can be
      // press articles, directory pages, etc. Drop very long titles.
      if (!title || title.length > 80) continue;
      addEntry(byKey, 'brightdata', { name: title });
    }
  }
  counts.brightdata = 0;
  for (const e of byKey.values()) if (e.sources.includes('brightdata')) counts.brightdata += 1;

  const keys = new Set(byKey.keys());
  const displayNames = Array.from(byKey.values()).map((e) => e.display);
  return { keys, byKey, displayNames, total: byKey.size, countsBySource: counts };
}

export function isCompetitorWhitelisted(name: unknown, wl: CompetitorWhitelist): boolean {
  if (!wl || wl.total === 0) return false;
  const key = normalizeCompetitorName(name);
  if (!key) return false;
  if (wl.keys.has(key)) return true;
  // Loose match: a whitelisted name appears as a contained token in the LLM
  // output (e.g. "Boba Guys — Hayes Valley" matches "Boba Guys").
  for (const k of wl.keys) {
    if (k.length >= 4 && (key.startsWith(k + ' ') || key.endsWith(' ' + k) || key.includes(' ' + k + ' '))) {
      return true;
    }
  }
  return false;
}

/**
 * Render a high-emphasis whitelist block for the premium prompt. Listed as a
 * fenced ALLOWED_COMPETITORS array so the model has zero ambiguity.
 * Returns '' when whitelist is empty (caller should swap in a "no data" path).
 */
export function buildCompetitorWhitelistPromptBlock(
  wl: CompetitorWhitelist,
  lang: 'en' | 'zh',
): string {
  if (wl.total === 0) {
    return lang === 'zh'
      ? '\n\n【竞品白名单】无 — 系统未检索到任何具名竞品。本次报告 competitors 数组必须为空数组 []，并在 competition_landscape 中明确写「未检索到附近具名竞品（Google/Yelp 同时返回空）」。禁止编造 A/B/C 占位名。\n'
      : '\n\n[COMPETITOR WHITELIST] EMPTY — no named competitors were retrieved. Return competitors as []; competition_landscape must say "no named competitors retrieved from Google/Yelp"; do NOT invent A/B/C placeholders.\n';
  }
  const lines = wl.displayNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n');
  if (lang === 'zh') {
    return [
      '\n\n【竞品白名单——硬约束】',
      `本次检索到的具名竞品（共 ${wl.total} 家，Google=${wl.countsBySource.google} / Yelp=${wl.countsBySource.yelp} / BrightData=${wl.countsBySource.brightdata}）：`,
      lines,
      '',
      '规则：',
      `- competitors[].name 必须**逐字**来自上述白名单；大小写与空格请保留。`,
      `- 不在白名单内的店名将被后端**静默剔除**，因此请勿编造任何 A/B/C/「Boba Express」等代号。`,
      `- 若白名单不足以填满 5 行，输出更少行（最少 0 行）而不是补造；同时在 confidence_rationale 提到「检索竞品数 N=${wl.total}」。`,
      '',
    ].join('\n');
  }
  return [
    '\n\n[COMPETITOR WHITELIST — HARD CONSTRAINT]',
    `Retrieved named competitors (total ${wl.total}; Google=${wl.countsBySource.google} / Yelp=${wl.countsBySource.yelp} / BrightData=${wl.countsBySource.brightdata}):`,
    lines,
    '',
    'Rules:',
    `- Every competitors[].name MUST appear VERBATIM in the whitelist above (case/spacing preserved).`,
    `- Names outside this whitelist will be silently dropped by the backend, so do NOT invent A/B/C, "Boba Express", or similar placeholders.`,
    `- If the whitelist has fewer than 5 entries, output FEWER rows (min 0) rather than fabricate; mention N=${wl.total} in confidence_rationale.`,
    '',
  ].join('\n');
}
