/**
 * D8 · Rent comps. Three tiers of evidence, all kept apart in `comps[].source`:
 *   user_input   — the subject's own rent / sqft (never counted as a comp)
 *   user_listing — pages the user linked (fetched, text-only, ≤ 300 KB)
 *   web_search   — ONE Tavily / Brave search, prices parsed from titles + snippets
 *
 * `premium_pct` is only computed with ≥ defaults.rent_comps.min_comps_for_premium
 * comps; otherwise it is null and the note carries "[样本不足]" (研发提示词 §1.4:
 * no estimates in place of missing data).
 *
 * This file also hosts `runWebSearch`, the single search adapter shared with
 * D11 (dev-pipeline.ts) so both modules record cost identically.
 */
import { createHash } from 'node:crypto';
import { getDefaults } from '@/lib/iq/params';
import { fetchWithTimeout } from './context';
import type { DataResult, FetchContext } from './types';
import { DATA_SOURCE_NAMES, failed, nowIso } from './types';

export const RENT_COMPS_SOURCE_ID = 'D8' as const;
export const RENT_COMPS_LICENSE = 'Web search snippets + user-supplied listings (fair use; quoted asking rates)';
export const RENT_SEARCH_CACHE_TTL_S = 30 * 24 * 3600;
const CACHE_SOURCE = 'iq360_rent_comps';

const LISTING_TIMEOUT_MS = 6_000;
const LISTING_MAX_BYTES = 300 * 1024;
const MAX_COMPS = 8;
/** Plausibility window for monthly retail $/SF (Bay Area 2025: ~$1.5–$12). Outside → not a lease quote. */
const PSF_MONTH_MIN = 0.5;
const PSF_MONTH_MAX = 25;
/** Unit-less "$X/SF": values at or above this are read as annual (÷12); flagged in the snippet. */
const PSF_ANNUAL_HEURISTIC_MIN = 12;

// ───────────────────────────── shared web search ─────────────────────────────

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutcome {
  provider: 'tavily' | 'brave' | null;
  hits: WebSearchHit[];
  cost_usd: number;
  /** 'no_key' when neither TAVILY_API_KEY nor BRAVE_SEARCH_API_KEY is set. */
  error?: string;
}

export const SEARCH_COST_USD = { tavily: 0.03, brave: 0.005 } as const;

/**
 * Exactly one search call. Tavily is preferred when its key exists, Brave is
 * the alternative; cost is booked to the ledger under 'search'. Never throws.
 */
export async function runWebSearch(
  query: string,
  ctx: FetchContext,
  opts: { maxResults?: number; timeoutMs?: number; costNote?: string } = {},
): Promise<WebSearchOutcome> {
  const maxResults = opts.maxResults ?? 10;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const tavilyKey = ctx.env('TAVILY_API_KEY');
  const braveKey = ctx.env('BRAVE_SEARCH_API_KEY');
  if (!tavilyKey && !braveKey) return { provider: null, hits: [], cost_usd: 0, error: 'no_key' };

  try {
    if (tavilyKey) {
      const res = await fetchWithTimeout(ctx, 'https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
          include_answer: false,
        }),
        timeoutMs,
      });
      ctx.cost.add('search', SEARCH_COST_USD.tavily, opts.costNote ?? `tavily: ${query.slice(0, 60)}`);
      if (!res.ok) return { provider: 'tavily', hits: [], cost_usd: SEARCH_COST_USD.tavily, error: `HTTP ${res.status}` };
      const raw = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      const hits = (raw.results ?? [])
        .map((r) => ({
          title: String(r.title ?? '').trim(),
          url: String(r.url ?? '').trim(),
          snippet: String(r.content ?? '').trim().slice(0, 1200),
        }))
        .filter((h) => h.url || h.snippet);
      return { provider: 'tavily', hits, cost_usd: SEARCH_COST_USD.tavily };
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(20, maxResults)));
    const res = await fetchWithTimeout(ctx, url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey! },
      timeoutMs,
    });
    ctx.cost.add('search', SEARCH_COST_USD.brave, opts.costNote ?? `brave: ${query.slice(0, 60)}`);
    if (!res.ok) return { provider: 'brave', hits: [], cost_usd: SEARCH_COST_USD.brave, error: `HTTP ${res.status}` };
    const raw = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    const hits = (raw.web?.results ?? [])
      .map((r) => ({
        title: String(r.title ?? '').trim(),
        url: String(r.url ?? '').trim(),
        snippet: String(r.description ?? '').trim().slice(0, 1200),
      }))
      .filter((h) => h.url || h.snippet);
    return { provider: 'brave', hits, cost_usd: SEARCH_COST_USD.brave };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e);
    ctx.log('[web-search] failed', msg);
    // Cost was booked only if the request went out; a thrown fetch never billed.
    return { provider: tavilyKey ? 'tavily' : 'brave', hits: [], cost_usd: 0, error: msg };
  }
}

export function queryHash(query: string): string {
  return createHash('sha1').update(query).digest('hex').slice(0, 24);
}

// ───────────────────────────── price parsing ─────────────────────────────

export interface ParsedRent {
  /** monthly $/SF, already ÷12 when quoted per year */
  psf_month: number | null;
  /** original unit (mo / yr / inferred) */
  psf_unit: 'month' | 'year' | 'inferred_year' | 'inferred_month' | null;
  monthly_rent_usd: number | null;
  sqft: number | null;
}

const PSF_RE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:\/|per)\s*(?:SF|sq\.? ?ft|sqft)\s*(?:\/|per)?\s*(mo|month|yr|year|annum)?/gi;
const MONTHLY_TOTAL_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d+)?\s*(?:\/|per)\s*(?:mo|month)\b/gi;
const SQFT_RE = /(?<![\d.,$])(\d{1,3}(?:,\d{3})*|\d{3,6})\s*(?:SF|sq\.? ?ft|sqft)\b(?!\s*(?:\/|per))/gi;

function toNum(s: string): number {
  return Number(s.replace(/,/g, ''));
}

/** Parse the first plausible lease quote out of free text (page text, title or snippet). */
export function parseRentText(text: string): ParsedRent {
  let psf: number | null = null;
  let unit: ParsedRent['psf_unit'] = null;
  for (const m of text.matchAll(PSF_RE)) {
    const value = toNum(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const u = (m[2] ?? '').toLowerCase();
    let monthly: number;
    if (u === 'yr' || u === 'year' || u === 'annum') {
      monthly = value / 12;
      unit = 'year';
    } else if (u === 'mo' || u === 'month') {
      monthly = value;
      unit = 'month';
    } else if (value >= PSF_ANNUAL_HEURISTIC_MIN) {
      monthly = value / 12;
      unit = 'inferred_year';
    } else {
      monthly = value;
      unit = 'inferred_month';
    }
    if (monthly < PSF_MONTH_MIN || monthly > PSF_MONTH_MAX) {
      unit = null;
      continue;
    }
    psf = Math.round(monthly * 100) / 100;
    break;
  }

  let monthlyTotal: number | null = null;
  for (const m of text.matchAll(MONTHLY_TOTAL_RE)) {
    const v = toNum(m[1]);
    if (v >= 500 && v <= 500_000) {
      monthlyTotal = v;
      break;
    }
  }

  let sqft: number | null = null;
  for (const m of text.matchAll(SQFT_RE)) {
    const v = toNum(m[1]);
    if (v >= 200 && v <= 200_000) {
      sqft = v;
      break;
    }
  }

  return { psf_month: psf, psf_unit: unit, monthly_rent_usd: monthlyTotal, sqft };
}

/** Strip scripts/styles/tags and collapse whitespace so regexes see prose only. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#36;/g, '$')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') return (await res.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* stream already closed */
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.subarray(0, maxBytes).toString('utf8');
}

/** "1711 El Camino Real, Millbrae, CA 94030" → "El Camino Real". Null when no street part is found. */
export function streetFromAddress(address: string): string | null {
  const first = address.split(',')[0]?.trim() ?? '';
  const street = first
    .replace(/^\d+[a-z]?(?:-\d+)?\s+/i, '')
    .replace(/\s+(?:#|suite|ste\.?|unit|apt\.?)\s*\S+$/i, '')
    .trim();
  return street.length >= 3 ? street : null;
}

// ───────────────────────────── module ─────────────────────────────

export interface RentComp {
  source: 'user_input' | 'user_listing' | 'web_search';
  address_or_label: string;
  monthly_rent_usd: number | null;
  sqft: number | null;
  rent_psf_month: number | null;
  url: string | null;
  snippet: string;
}

export interface RentCompsData {
  comps: RentComp[];
  subject_psf_month: number | null;
  comp_median_psf_month: number | null;
  premium_pct: number | null;
  sample_sufficient: boolean;
  search_query: string | null;
}

export interface RentCompsInput {
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  userRentUsd: number | null;
  userSqft: number | null;
  listingUrls: string[];
}

function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, '');
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 100) / 100;
}

function unitTag(unit: ParsedRent['psf_unit']): string {
  switch (unit) {
    case 'year':
      return '（年租金 ÷12）';
    case 'inferred_year':
      return '（未标单位，按年租金 ÷12 [单位推断]）';
    case 'inferred_month':
      return '（未标单位，按月租金 [单位推断]）';
    default:
      return '';
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 60);
  }
}

export function buildRentSearchQuery(input: Pick<RentCompsInput, 'address' | 'city' | 'state'>): string {
  const street = streetFromAddress(input.address);
  const parts = [`"${input.city.trim()}, ${input.state.trim().toUpperCase()}"`, 'retail restaurant space for lease'];
  if (street) parts.push(`"${street}"`);
  parts.push('$/SF');
  return parts.join(' ');
}

export async function fetchRentComps(input: RentCompsInput, ctx: FetchContext): Promise<DataResult<RentCompsData>> {
  const started = Date.now();
  const minComps = getDefaults().rent_comps.min_comps_for_premium;
  const comps: RentComp[] = [];
  const notes: string[] = [];
  let costUsd = 0;
  let cache: DataResult<RentCompsData>['cache'] = 'none';

  // (a) subject
  const rent = input.userRentUsd != null && input.userRentUsd > 0 ? input.userRentUsd : null;
  const sqft = input.userSqft != null && input.userSqft > 0 ? input.userSqft : null;
  const subjectPsf = rent != null && sqft != null ? Math.round((rent / sqft) * 100) / 100 : null;
  if (rent != null || sqft != null) {
    comps.push({
      source: 'user_input',
      address_or_label: input.address,
      monthly_rent_usd: rent,
      sqft,
      rent_psf_month: subjectPsf,
      url: null,
      snippet: '用户输入的标的租金 / 面积（不计入样本）',
    });
  }
  if (subjectPsf == null) notes.push(rent == null && sqft == null ? '用户未提供租金与面积 → 标的 $/SF 未知' : '租金或面积缺一 → 标的 $/SF 未知');

  const seen = new Set<string>();
  const evidence: RentComp[] = [];
  const pushComp = (c: RentComp) => {
    const key = c.url ? normUrl(c.url) : c.address_or_label.toLowerCase();
    if (seen.has(key) || evidence.length >= MAX_COMPS) return;
    seen.add(key);
    evidence.push(c);
  };

  // (b) user listings
  const listingUrls = (input.listingUrls ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 5);
  let listingFailures = 0;
  for (const url of listingUrls) {
    try {
      const res = await fetchWithTimeout(ctx, url, {
        method: 'GET',
        headers: { Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', 'User-Agent': 'Mozilla/5.0 (compatible; RestaurantIQ/1.0)' },
        timeoutMs: LISTING_TIMEOUT_MS,
      });
      if (!res.ok) {
        listingFailures++;
        notes.push(`挂牌页 ${hostLabel(url)} HTTP ${res.status}`);
        continue;
      }
      const raw = await readTextCapped(res, LISTING_MAX_BYTES);
      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const text = htmlToText(raw);
      const parsed = parseRentText(text);
      let psf = parsed.psf_month;
      let tag = unitTag(parsed.psf_unit);
      if (psf == null && parsed.monthly_rent_usd != null && parsed.sqft != null) {
        psf = Math.round((parsed.monthly_rent_usd / parsed.sqft) * 100) / 100;
        tag = '（月租 ÷ 面积）';
      }
      if (psf == null) {
        listingFailures++;
        notes.push(`挂牌页 ${hostLabel(url)} 未解析出 $/SF`);
        continue;
      }
      pushComp({
        source: 'user_listing',
        address_or_label: titleMatch ? htmlToText(titleMatch[1]).slice(0, 120) : hostLabel(url),
        monthly_rent_usd: parsed.monthly_rent_usd,
        sqft: parsed.sqft,
        rent_psf_month: psf,
        url,
        snippet: `$${psf}/SF/mo ${tag}`.trim(),
      });
    } catch (e) {
      listingFailures++;
      const msg = e instanceof Error ? (e.name === 'AbortError' ? '超时 6s' : e.message) : String(e);
      notes.push(`挂牌页 ${hostLabel(url)} 抓取失败（${msg.slice(0, 60)}）`);
    }
  }

  // (c) ONE web search (cached 30 d by query)
  const query = buildRentSearchQuery(input);
  let searchHits: WebSearchHit[] | null = null;
  let searchError: string | null = null;
  const cacheKey = queryHash(query);
  try {
    const hit = await ctx.cache.get<{ hits: WebSearchHit[] }>(CACHE_SOURCE, cacheKey);
    if (hit?.hits) {
      searchHits = hit.hits;
      cache = 'hit';
    }
  } catch (e) {
    ctx.log('[rent-comps] cache read failed', e);
  }
  if (!searchHits) {
    const out = await runWebSearch(query, ctx, { maxResults: 10, costNote: 'D8 rent comps' });
    costUsd += out.cost_usd;
    if (out.error === 'no_key') {
      searchError = 'no_key';
      notes.push('无搜索 key（TAVILY_API_KEY / BRAVE_SEARCH_API_KEY）→ 未做网络比价');
    } else if (out.error) {
      searchError = out.error;
      notes.push(`网络比价搜索失败（${out.provider}: ${out.error}）`);
    } else {
      searchHits = out.hits;
      cache = 'miss';
      try {
        await ctx.cache.set(CACHE_SOURCE, cacheKey, { hits: out.hits, provider: out.provider }, RENT_SEARCH_CACHE_TTL_S);
      } catch (e) {
        ctx.log('[rent-comps] cache write failed', e);
      }
    }
  }
  let webUsable = 0;
  for (const h of searchHits ?? []) {
    const text = `${h.title} ${h.snippet}`;
    const parsed = parseRentText(text);
    let psf = parsed.psf_month;
    let tag = unitTag(parsed.psf_unit);
    if (psf == null && parsed.monthly_rent_usd != null && parsed.sqft != null) {
      psf = Math.round((parsed.monthly_rent_usd / parsed.sqft) * 100) / 100;
      tag = '（月租 ÷ 面积）';
    }
    if (psf == null) continue;
    webUsable++;
    pushComp({
      source: 'web_search',
      address_or_label: h.title.slice(0, 120) || hostLabel(h.url),
      monthly_rent_usd: parsed.monthly_rent_usd,
      sqft: parsed.sqft,
      rent_psf_month: psf,
      url: h.url || null,
      snippet: `${h.snippet.slice(0, 200)} ${tag}`.trim(),
    });
  }
  if (searchHits && webUsable === 0) notes.push('搜索结果中未解析出可用 $/SF');

  // (d) median + premium
  const sample = evidence.map((c) => c.rent_psf_month).filter((v): v is number => v != null);
  const compMedian = median(sample);
  const sampleSufficient = sample.length >= minComps;
  let premium: number | null = null;
  if (sampleSufficient && subjectPsf != null && compMedian != null && compMedian > 0) {
    premium = Math.round((subjectPsf / compMedian - 1) * 1000) / 10;
  }

  const summary = `样本 ${sample.length} 条（挂牌 ${evidence.filter((c) => c.source === 'user_listing').length} · 搜索 ${webUsable}）` +
    (compMedian != null ? `，中位 $${compMedian}/SF/mo` : '') +
    (subjectPsf != null ? `，标的 $${subjectPsf}/SF/mo` : '') +
    (premium != null ? `，溢价 ${premium > 0 ? '+' : ''}${premium}%` : '');
  if (!sampleSufficient) notes.unshift(`[样本不足] 比价样本 ${sample.length} < ${minComps} → premium_pct 不计算`);
  else if (subjectPsf == null) notes.unshift('标的 $/SF 未知 → premium_pct 不计算');

  const data: RentCompsData = {
    comps: [...comps, ...evidence],
    subject_psf_month: subjectPsf,
    comp_median_psf_month: compMedian,
    premium_pct: premium,
    sample_sufficient: sampleSufficient,
    search_query: searchError === 'no_key' ? null : query,
  };

  if (evidence.length === 0 && subjectPsf == null) {
    return {
      ...failed<RentCompsData>(RENT_COMPS_SOURCE_ID, ctx, {
        source: 'Rent comps (user listings + web search)',
        license: RENT_COMPS_LICENSE,
        note: `无任何租金证据：${notes.join('；')}`,
        error: searchError ?? (listingFailures ? 'listings_unparsed' : 'no_evidence'),
        cost_usd: costUsd,
      }),
      data,
      cache,
      elapsed_ms: Date.now() - started,
    };
  }

  const status: DataResult<RentCompsData>['status'] = searchError || !sampleSufficient || listingFailures > 0 ? 'partial' : 'ok';
  return {
    id: RENT_COMPS_SOURCE_ID,
    name: DATA_SOURCE_NAMES.D8,
    status,
    data,
    source: `Rent comps · ${searchHits ? (cache === 'hit' ? '搜索缓存' : '网络搜索') : '无搜索'}${listingUrls.length ? ` + ${listingUrls.length} 个用户挂牌页` : ''}`,
    fetched_at: nowIso(ctx),
    license: RENT_COMPS_LICENSE,
    cost_usd: costUsd,
    coverage_note: [summary, ...notes].join('；'),
    cache,
    error: searchError && searchError !== 'no_key' ? searchError : undefined,
    elapsed_ms: Date.now() - started,
  };
}
