/**
 * D3 · LEHD LODES v8 WAC (workplace area characteristics) — daytime / workplace
 * population at census-block level, read from the pre-loaded `iq_lodes_wac`
 * table (scripts/load-lodes.ts).
 *
 * Contract (研发提示词 §1.4): never estimate here. When the table is empty or
 * unreachable we return `status: 'partial'` with `method: 'acs_b08301_estimate'`
 * and an empty `by_block` — Phase 2 derives a *flagged* estimate from ACS
 * B08301 commuters (confidence 0.5). Nothing in this module invents job counts.
 */
import { createHash } from 'node:crypto';
import type { CensusGeography, DataResult, FetchContext } from './types';
import { DATA_SOURCE_NAMES, failed, nowIso } from './types';

export const LODES_SOURCE_ID = 'D3' as const;
export const LODES_LICENSE = 'Public domain (U.S. Census Bureau · LEHD)';
/** Vintages tried in order; 2022 is the latest LODES8 release covering CA. */
export const LODES_DEFAULT_YEARS = [2022, 2021] as const;
/** 12 months — the table only changes on a manual reload. */
export const LODES_CACHE_TTL_S = 365 * 24 * 3600;
const CACHE_SOURCE = 'iq360_lodes';

/** One row of `iq_lodes_wac` (column names mirror the LODES CSV headers, lower-cased). */
export interface LodesWacRow {
  block_geoid: string;
  year: number;
  state?: string;
  c000: number;
  ca01?: number | null;
  ca02?: number | null;
  ca03?: number | null;
  ce01?: number | null;
  ce02?: number | null;
  ce03?: number | null;
  cns07?: number | null;
  cns12?: number | null;
  cns15?: number | null;
  cns18?: number | null;
  cr04?: number | null;
}

export interface LodesBlock {
  block_geoid: string;
  jobs: number;
  jobs_age_29_or_younger: number;
  jobs_age_30_54: number;
  jobs_age_55_plus: number;
  /** ≤ $1,250 / month */
  earn_low: number;
  /** $1,251 – $3,333 / month */
  earn_mid: number;
  /** > $3,333 / month */
  earn_high: number;
  /** NAICS 44-45 */
  retail: number;
  /** NAICS 54 */
  prof_services: number;
  /** NAICS 61 */
  education: number;
  /** NAICS 72 */
  accommodation_food: number;
  /** Race: Asian alone */
  asian: number;
}

export interface LodesData {
  year: number;
  by_block: LodesBlock[];
  total_jobs: number;
  method: 'lodes_wac' | 'acs_b08301_estimate';
}

export interface LodesInput {
  geography: CensusGeography;
  /** Optional 15-digit block ids; their parent tracts are added to `tractGeoids`. */
  blockGeoids?: string[];
  /** 11-digit tract ids covering the trade area. */
  tractGeoids: string[];
  /** Force a vintage; otherwise 2022 then 2021. */
  year?: number;
}

export interface LodesDeps {
  /** Injectable query (tests). Default reads `iq_lodes_wac` through supabaseAdmin. */
  wacQuery?: (tractGeoids: string[], year: number) => Promise<LodesWacRow[]>;
}

const TRACT_BATCH = 40;

/**
 * Default reader: `block_geoid LIKE '<tract>%'` for every tract, batched into
 * PostgREST `or=` filters (PostgREST `like` uses `*` as the wildcard). Throws
 * on transport / SQL errors so the caller can report "unreachable" precisely.
 */
export async function queryLodesWacSupabase(tractGeoids: string[], year: number): Promise<LodesWacRow[]> {
  const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
  const supa = supabaseAdmin();
  const out: LodesWacRow[] = [];
  for (let i = 0; i < tractGeoids.length; i += TRACT_BATCH) {
    const batch = tractGeoids.slice(i, i + TRACT_BATCH);
    const orFilter = batch.map((t) => `block_geoid.like.${t}*`).join(',');
    const { data, error } = await supa
      .from('iq_lodes_wac')
      .select('block_geoid,year,state,c000,ca01,ca02,ca03,ce01,ce02,ce03,cns07,cns12,cns15,cns18,cr04')
      .eq('year', year)
      .or(orFilter)
      .limit(20_000);
    if (error) throw new Error(`iq_lodes_wac: ${error.message}`);
    for (const row of (data ?? []) as LodesWacRow[]) out.push(row);
  }
  return out;
}

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function rowToBlock(r: LodesWacRow): LodesBlock {
  return {
    block_geoid: r.block_geoid,
    jobs: n(r.c000),
    jobs_age_29_or_younger: n(r.ca01),
    jobs_age_30_54: n(r.ca02),
    jobs_age_55_plus: n(r.ca03),
    earn_low: n(r.ce01),
    earn_mid: n(r.ce02),
    earn_high: n(r.ce03),
    retail: n(r.cns07),
    prof_services: n(r.cns12),
    education: n(r.cns15),
    accommodation_food: n(r.cns18),
    asian: n(r.cr04),
  };
}

/** Normalize + dedupe tract ids; block ids contribute their 11-digit prefix. */
export function resolveTractList(input: Pick<LodesInput, 'tractGeoids' | 'blockGeoids' | 'geography'>): string[] {
  const set = new Set<string>();
  for (const t of input.tractGeoids ?? []) {
    const s = String(t).replace(/\D/g, '');
    if (s.length === 11) set.add(s);
  }
  for (const b of input.blockGeoids ?? []) {
    const s = String(b).replace(/\D/g, '');
    if (s.length >= 11) set.add(s.slice(0, 11));
  }
  if (set.size === 0 && input.geography?.tract && /^\d{11}$/.test(input.geography.tract)) set.add(input.geography.tract);
  return [...set].sort();
}

function tractHash(tracts: string[], year: number | 'auto'): string {
  return createHash('sha1').update(`${year}|${tracts.join(',')}`).digest('hex').slice(0, 24);
}

function fallbackResult(
  ctx: FetchContext,
  opts: { tracts: string[]; yearsTried: number[]; reason: string; error?: string; elapsed: number },
): DataResult<LodesData> {
  return {
    id: LODES_SOURCE_ID,
    name: DATA_SOURCE_NAMES.D3,
    status: 'partial',
    data: { year: opts.yearsTried[0] ?? LODES_DEFAULT_YEARS[0], by_block: [], total_jobs: 0, method: 'acs_b08301_estimate' },
    source: `LEHD LODES v8 WAC (iq_lodes_wac · ${opts.yearsTried.join('/')})`,
    fetched_at: nowIso(ctx),
    license: LODES_LICENSE,
    cost_usd: 0,
    coverage_note: `${opts.reason} → LODES 未加载 → 用 ACS B08301 反推 (置信度 0.5)。涉及 ${opts.tracts.length} 个 tract；by_block 为空，日间人口由 Phase 2 按 ACS 通勤者估算并标注。`,
    cache: 'none',
    degraded_from: 'lodes_wac',
    error: opts.error,
    elapsed_ms: opts.elapsed,
  };
}

export async function fetchLodes(
  input: LodesInput,
  ctx: FetchContext,
  deps: LodesDeps = {},
): Promise<DataResult<LodesData>> {
  const started = Date.now();
  const tracts = resolveTractList(input);
  if (tracts.length === 0) {
    return failed<LodesData>(LODES_SOURCE_ID, ctx, {
      source: 'LEHD LODES v8 WAC (iq_lodes_wac)',
      license: LODES_LICENSE,
      note: '无有效 tract GEOID（需 11 位）→ 未查询 LODES。',
      error: 'no_tracts',
    });
  }

  const years: number[] = input.year ? [input.year] : [...LODES_DEFAULT_YEARS];
  const cacheKey = tractHash(tracts, input.year ?? 'auto');
  try {
    const hit = await ctx.cache.get<LodesData>(CACHE_SOURCE, cacheKey);
    if (hit && hit.method === 'lodes_wac' && hit.by_block.length > 0) {
      return {
        id: LODES_SOURCE_ID,
        name: DATA_SOURCE_NAMES.D3,
        status: 'ok',
        data: hit,
        source: `LEHD LODES v8 WAC ${hit.year} (iq_lodes_wac)`,
        fetched_at: nowIso(ctx),
        license: LODES_LICENSE,
        cost_usd: 0,
        coverage_note: `缓存命中：${hit.by_block.length} 个 block · ${tracts.length} 个 tract · 合计 ${hit.total_jobs.toLocaleString()} 个岗位（${hit.year}）。`,
        cache: 'hit',
        elapsed_ms: Date.now() - started,
      };
    }
  } catch (e) {
    ctx.log('[lodes] cache read failed', e);
  }

  const query = deps.wacQuery ?? queryLodesWacSupabase;
  const yearsTried: number[] = [];
  for (const year of years) {
    yearsTried.push(year);
    let rows: LodesWacRow[];
    try {
      rows = await query(tracts, year);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.log('[lodes] query failed', msg);
      return fallbackResult(ctx, {
        tracts,
        yearsTried,
        reason: `iq_lodes_wac 不可达（${msg.slice(0, 120)}）`,
        error: msg,
        elapsed: Date.now() - started,
      });
    }
    // Defensive: only keep rows that actually belong to the requested tracts / year.
    const kept = rows.filter(
      (r) => r && typeof r.block_geoid === 'string' && tracts.some((t) => r.block_geoid.startsWith(t)) && (r.year ?? year) === year,
    );
    if (kept.length === 0) continue;

    const byBlock = kept.map(rowToBlock).sort((a, b) => (a.block_geoid < b.block_geoid ? -1 : 1));
    const totalJobs = byBlock.reduce((s, b) => s + b.jobs, 0);
    const coveredTracts = new Set(byBlock.map((b) => b.block_geoid.slice(0, 11)));
    const missingTracts = tracts.filter((t) => !coveredTracts.has(t));
    const data: LodesData = { year, by_block: byBlock, total_jobs: totalJobs, method: 'lodes_wac' };

    try {
      await ctx.cache.set(CACHE_SOURCE, cacheKey, data, LODES_CACHE_TTL_S);
    } catch (e) {
      ctx.log('[lodes] cache write failed', e);
    }

    const noteParts = [
      `LODES ${year} WAC：${byBlock.length} 个 block · 覆盖 ${coveredTracts.size}/${tracts.length} 个 tract · 合计 ${totalJobs.toLocaleString()} 个岗位。`,
    ];
    if (missingTracts.length) noteParts.push(`${missingTracts.length} 个 tract 无岗位记录（可能为纯住宅/未加载）：${missingTracts.slice(0, 5).join(', ')}${missingTracts.length > 5 ? '…' : ''}。`);
    if (year !== years[0]) noteParts.push(`${years[0]} 无数据，回退至 ${year}。`);
    return {
      id: LODES_SOURCE_ID,
      name: DATA_SOURCE_NAMES.D3,
      status: missingTracts.length === 0 ? 'ok' : 'partial',
      data,
      source: `LEHD LODES v8 WAC ${year} (iq_lodes_wac)`,
      fetched_at: nowIso(ctx),
      license: LODES_LICENSE,
      cost_usd: 0,
      coverage_note: noteParts.join(' '),
      cache: 'miss',
      elapsed_ms: Date.now() - started,
    };
  }

  return fallbackResult(ctx, {
    tracts,
    yearsTried,
    reason: `iq_lodes_wac 无 ${yearsTried.join('/')} 年数据`,
    elapsed: Date.now() - started,
  });
}
