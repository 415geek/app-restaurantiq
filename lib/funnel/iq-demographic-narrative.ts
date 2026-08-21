/**
 * D-3: Claude Sonnet 4.5 demographic + purchasing-power narrative writer.
 *
 * Why this exists:
 *   - GPT-4o-mini structured JSON often parrots the ACS anchors back as bullets
 *     and writes "数据抑制" the moment a tract value is null.
 *   - We want a McKinsey-style paragraph that ties race/ethnicity + income brackets
 *     + education to a specific cuisine's pricing & target-customer recommendation.
 *   - Claude Sonnet 4.5 is significantly better at this kind of grounded prose,
 *     so we run it ONCE per paid report, cache the output in iq_market_cache
 *     for 30 days, and feed it into the structured-LLM prompt as a reference.
 *
 * Output shape:
 *   marketData.demographic_narrative = {
 *     provider: 'claude',
 *     model: 'claude-sonnet-4-5-20250929' (or fallback),
 *     generated_at: ISO timestamp,
 *     paragraph_zh: string,   // ~250-400 字
 *     paragraph_en: string,   // ~250-400 words
 *     used_anchors: { ... }   // which ACS fields were actually quoted
 *   }
 *
 * Hard rules baked into the prompt:
 *   - Only quote ACS numbers we pass in; if a field is null, name the field by
 *     ID (B03002 etc.) and say it is suppressed/missing — do NOT silently drop it.
 *   - Pick a concrete weekday-lunch + weekend-dinner USD ticket band for THIS cuisine.
 *   - No generic "this area is diverse / vibrant" filler; every claim must trace
 *     to a number in the provided anchor block.
 */

import { readMarketCache, writeMarketCache, roundCoord } from '@/lib/funnel/iq-market-cache';

const CLAUDE_MODEL = process.env.CLAUDE_DEMO_NARRATIVE_MODEL || 'claude-sonnet-4-5-20250929';
const CLAUDE_FALLBACK_MODEL = process.env.CLAUDE_DEMO_NARRATIVE_FALLBACK || 'claude-3-5-sonnet-latest';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_TOKENS = 1400;

export interface DemographicNarrative {
  provider: 'claude';
  model: string;
  generated_at: string;
  paragraph_zh: string;
  paragraph_en: string;
  word_count: { zh: number; en: number };
}

function getClaudeKey(): string {
  return (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY_BACKUP?.trim() ||
    ''
  );
}

function isUsableAcs(marketData: Record<string, unknown>): boolean {
  const acs = marketData?.acs_context;
  if (!acs || typeof acs !== 'object') return false;
  const a = acs as Record<string, unknown>;
  const tract = (a.tract as Record<string, unknown> | undefined) ?? {};
  const county = (a.county as Record<string, unknown> | undefined) ?? {};
  // Need at least county-level population & income to write anything defensible.
  return Boolean(
    Number(county.population) > 0 ||
      Number(county.median_household_income_usd) > 0 ||
      Number(tract.population) > 0,
  );
}

function buildCuisineHint(cuisine: string | null | undefined): string {
  const c = (cuisine || '').trim();
  if (!c) return '该餐饮业态';
  return c;
}

function summarizeCompetitorMix(marketData: Record<string, unknown>): {
  google: number;
  yelp: number;
  foursquare: number;
  total_named: number;
} {
  const summary = (marketData.summary as Record<string, unknown> | undefined) ?? {};
  const g = Number(summary.competitor_count) || 0;
  const y = Number(summary.competitor_count_yelp) || 0;
  const f = Number(summary.competitor_count_foursquare) || 0;
  return { google: g, yelp: y, foursquare: f, total_named: g + y + f };
}

function buildAnchorBlob(marketData: Record<string, unknown>): string {
  // We just shape the ACS pack + competitor counts into a deterministic text block
  // so Claude has a single source of truth to quote and we can verify post-hoc.
  const acs = marketData.acs_context as Record<string, unknown>;
  const tract = (acs.tract as Record<string, unknown> | undefined) ?? {};
  const county = (acs.county as Record<string, unknown> | undefined) ?? {};
  const tractRace = (tract.race_ethnicity as Record<string, unknown> | undefined) ?? {};
  const countyRace = (county.race_ethnicity as Record<string, unknown> | undefined) ?? {};
  const tractInc = (tract.income_brackets as Record<string, unknown> | undefined) ?? {};
  const countyInc = (county.income_brackets as Record<string, unknown> | undefined) ?? {};
  const tractEdu = (tract.education as Record<string, unknown> | undefined) ?? {};
  const countyEdu = (county.education as Record<string, unknown> | undefined) ?? {};
  const tractAvail = acs.tract_data_available === true;

  const fmtUsd = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? `$${Math.round(v).toLocaleString('en-US')}` : 'SUPPRESSED';
  const fmtPct = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}%` : 'SUPPRESSED';
  const fmtQty = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : 'SUPPRESSED';

  const racePct = (r: Record<string, unknown>, k: string): string => {
    const cell = (r[k] as Record<string, unknown> | undefined) ?? {};
    return fmtPct(cell.pct);
  };

  const lines: string[] = [
    `ACS year: ${acs.acs_year}`,
    `Tract data available: ${tractAvail ? 'yes' : 'no'}`,
    `Tract name: ${tract.name ?? 'n/a'}`,
    `County name: ${county.name ?? 'n/a'}`,
    '',
    'TRACT (only valid if tract_data_available=yes):',
    `  population (B01003): ${fmtQty(tract.population)}`,
    `  median HH income (B19013): ${fmtUsd(tract.median_household_income_usd)}`,
    `  per-capita income (B19301): ${fmtUsd(tract.per_capita_income_usd)}`,
    `  median age (B01002): ${fmtQty(tract.median_age)}`,
    `  median owner home value (B25077): ${fmtUsd(tract.median_home_value_usd)}`,
    `  median gross rent (B25064): ${fmtUsd(tract.median_gross_rent_usd)}`,
    `  race White-NH (B03002_003): ${racePct(tractRace, 'white_nh')}`,
    `  race Asian-NH (B03002_006): ${racePct(tractRace, 'asian_nh')}`,
    `  race Black-NH (B03002_004): ${racePct(tractRace, 'black_nh')}`,
    `  Hispanic any-race (B03002_012): ${racePct(tractRace, 'hispanic_any_race')}`,
    `  HH >= $100k share (B19001 14-17): ${fmtPct(tractInc.pct_100k_plus)}`,
    `  HH >= $200k share (B19001_017): ${fmtPct(tractInc.pct_200k_plus)}`,
    `  Bachelor's+ share of pop 25+ (B15003 22-25): ${fmtPct(tractEdu.bachelors_plus_pct)}`,
    '',
    'COUNTY:',
    `  population (B01003): ${fmtQty(county.population)}`,
    `  median HH income (B19013): ${fmtUsd(county.median_household_income_usd)}`,
    `  per-capita income (B19301): ${fmtUsd(county.per_capita_income_usd)}`,
    `  median age (B01002): ${fmtQty(county.median_age)}`,
    `  median owner home value (B25077): ${fmtUsd(county.median_home_value_usd)}`,
    `  median gross rent (B25064): ${fmtUsd(county.median_gross_rent_usd)}`,
    `  race White-NH (B03002_003): ${racePct(countyRace, 'white_nh')}`,
    `  race Asian-NH (B03002_006): ${racePct(countyRace, 'asian_nh')}`,
    `  race Black-NH (B03002_004): ${racePct(countyRace, 'black_nh')}`,
    `  Hispanic any-race (B03002_012): ${racePct(countyRace, 'hispanic_any_race')}`,
    `  HH >= $100k share (B19001 14-17): ${fmtPct(countyInc.pct_100k_plus)}`,
    `  HH >= $200k share (B19001_017): ${fmtPct(countyInc.pct_200k_plus)}`,
    `  Bachelor's+ share of pop 25+ (B15003 22-25): ${fmtPct(countyEdu.bachelors_plus_pct)}`,
  ];
  return lines.join('\n');
}

interface ClaudeBilingualResponse {
  paragraph_zh: string;
  paragraph_en: string;
}

async function callClaude(opts: {
  apiKey: string;
  model: string;
  anchorBlob: string;
  cuisine: string;
  address: string;
  competitorMix: { google: number; yelp: number; foursquare: number; total_named: number };
}): Promise<ClaudeBilingualResponse | null> {
  const systemPrompt = [
    'You are the senior US site-selection demographic analyst for the LocationIQ engine.',
    'Tone: McKinsey-style, structured, defensible, NO generic filler.',
    'Hard rules:',
    '  1. ONLY cite numbers that appear in the ACS_ANCHORS block. If a field shows SUPPRESSED,',
    '     either name the variable (e.g. "ACS B03002_006 was suppressed at the tract level")',
    '     and switch to the county-level figure, OR omit the claim — NEVER fabricate.',
    '  2. Output MUST be valid JSON with exactly two keys: paragraph_zh and paragraph_en.',
    '     - paragraph_zh: 280-380 中文字符',
    '     - paragraph_en: 220-320 English words',
    '  3. Each paragraph MUST cover, in order:',
    '       a) Population + density + age structure (tract preferred, else county)',
    '       b) Race / ethnicity breakdown with whole-number percentages (B03002 family)',
    '       c) Income + purchasing power: cite median HH income, share >= $100k, share >= $200k',
    '       d) Education proxy: Bachelor\'s+ share',
    '       e) Specific weekday-lunch + weekend-dinner USD ticket band for THIS cuisine,',
    '          tied to step c (e.g. "with 32% of households >= $100k, a $18-26 weekday lunch band is supported")',
    '       f) One sentence on target-customer segments (commuter, family, college, tourist, etc.)',
    '          implied by the demographic mix.',
    '  4. Do NOT mention competitor names — that is handled elsewhere. You may mention',
    '     the named-competitor counts we pass (Google/Yelp/Foursquare).',
    '  5. No bullet points; pure prose. No headings. No markdown.',
    '  6. Never write the string "数据抑制" as a conclusion in Chinese. If you must',
    '     acknowledge suppression, write "ACS 字段 BXXXX 在片区层级被抑制，故引用县级数据" instead.',
  ].join('\n');

  const userPrompt = [
    `ADDRESS: ${opts.address}`,
    `CUISINE / BUSINESS_TYPE: ${opts.cuisine}`,
    `NAMED COMPETITORS WITHIN 1-2 MI: Google=${opts.competitorMix.google}, Yelp=${opts.competitorMix.yelp}, Foursquare=${opts.competitorMix.foursquare}, TOTAL=${opts.competitorMix.total_named}`,
    '',
    'ACS_ANCHORS (sole permitted numeric source — quote exactly):',
    opts.anchorBlob,
    '',
    'Return JSON:',
    '{ "paragraph_zh": "...", "paragraph_en": "..." }',
  ].join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: MAX_TOKENS,
      temperature: 0.25,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.warn('[iq-demographic-narrative] Claude %s HTTP %d: %s', opts.model, response.status, errText.slice(0, 200));
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { content?: Array<{ type?: string; text?: string }> }
    | null;
  if (!payload || !Array.isArray(payload.content)) return null;
  const text = payload.content
    .map((p) => (p?.type === 'text' ? p.text || '' : ''))
    .join('\n')
    .trim();
  if (!text) return null;

  const tryParse = (raw: string): ClaudeBilingualResponse | null => {
    try {
      const parsed = JSON.parse(raw) as ClaudeBilingualResponse;
      if (parsed && typeof parsed.paragraph_zh === 'string' && typeof parsed.paragraph_en === 'string') {
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

function countChars(s: string): number {
  return [...s].length;
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Generate (or read from cache) a Claude Sonnet 4.5 demographic narrative
 * and attach it to marketData under `demographic_narrative`.
 *
 * Safe to call when:
 *   - ANTHROPIC_API_KEY is unset → returns marketData unchanged.
 *   - acs_context is missing / non-US → returns marketData unchanged.
 *   - Claude call fails → logs warning, returns marketData unchanged.
 *
 * Idempotent: if marketData.demographic_narrative already exists, returns as-is.
 */
export async function enrichMarketDataWithDemographicNarrative(
  marketData: Record<string, unknown>,
  opts: { cuisine?: string | null; address?: string | null },
): Promise<Record<string, unknown>> {
  if (marketData.demographic_narrative && typeof marketData.demographic_narrative === 'object') {
    return marketData;
  }

  const apiKey = getClaudeKey();
  if (!apiKey) {
    return marketData;
  }
  if (!isUsableAcs(marketData)) {
    return marketData;
  }

  const cuisine = buildCuisineHint(opts.cuisine);
  const address = (opts.address || '').trim() || '(address withheld)';
  const competitorMix = summarizeCompetitorMix(marketData);

  // Cache key: rounded coords + cuisine. We tolerate ±~50m drift.
  const geo = (marketData.geocode as Record<string, unknown> | undefined) ?? {};
  const lat = Number(geo.lat);
  const lng = Number(geo.lng);
  const cacheKey = `lat=${roundCoord(lat)}::lng=${roundCoord(lng)}::cuisine=${cuisine.toLowerCase()}`;

  const cached = await readMarketCache<DemographicNarrative>({
    source: 'claude_demographics',
    key: cacheKey,
  });
  if (cached && cached.paragraph_zh && cached.paragraph_en) {
    return { ...marketData, demographic_narrative: cached };
  }

  const anchorBlob = buildAnchorBlob(marketData);

  let response: ClaudeBilingualResponse | null = null;
  let usedModel = CLAUDE_MODEL;
  try {
    response = await callClaude({
      apiKey,
      model: CLAUDE_MODEL,
      anchorBlob,
      cuisine,
      address,
      competitorMix,
    });
  } catch (err) {
    console.warn('[iq-demographic-narrative] primary call threw', err);
  }

  if (!response && CLAUDE_FALLBACK_MODEL !== CLAUDE_MODEL) {
    try {
      usedModel = CLAUDE_FALLBACK_MODEL;
      response = await callClaude({
        apiKey,
        model: CLAUDE_FALLBACK_MODEL,
        anchorBlob,
        cuisine,
        address,
        competitorMix,
      });
    } catch (err) {
      console.warn('[iq-demographic-narrative] fallback call threw', err);
    }
  }

  if (!response) {
    return marketData;
  }

  const narrative: DemographicNarrative = {
    provider: 'claude',
    model: usedModel,
    generated_at: new Date().toISOString(),
    paragraph_zh: response.paragraph_zh.trim(),
    paragraph_en: response.paragraph_en.trim(),
    word_count: {
      zh: countChars(response.paragraph_zh.trim()),
      en: countWords(response.paragraph_en.trim()),
    },
  };

  try {
    await writeMarketCache({
      source: 'claude_demographics',
      key: cacheKey,
      payload: narrative,
      ttlSeconds: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.warn('[iq-demographic-narrative] cache write failed', err);
  }

  return { ...marketData, demographic_narrative: narrative };
}
