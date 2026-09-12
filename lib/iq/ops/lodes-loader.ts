/**
 * LEHD LODES v8 WAC (workplace area characteristics) → `iq_lodes_wac`, for the
 * counties the 360° report engine covers (D3 · lib/iq/data/lodes.ts).
 *
 * Source (≈ 20–60 MB gzipped per state, public domain):
 *   https://lehd.ces.census.gov/data/lodes/LODES8/{state}/wac/{state}_wac_S000_JT00_{year}.csv.gz
 *   S000 = all workers, JT00 = all jobs. Rows are sorted by w_geocode.
 *
 * Pipeline: fetch → gunzip stream → readline → filter by county prefix →
 * keep the columns below → upsert in batches of 1000 (PK = block_geoid + year).
 * Memory stays flat because nothing is buffered beyond one batch.
 *
 * Budget: the loader stops CLEANLY when `budgetMs` is nearly used (Vercel
 * kills a function at maxDuration, so we never let the request race it). It
 * returns `counties_done` / `counties_remaining`; completed counties are also
 * recorded in iq_market_cache (`iq360_ops_progress` / `lodes:<state>:<year>`)
 * so the next cron invocation with the same query string skips them. Because
 * every run is a full scan of the state file, the default when budgetMs < 120 s
 * is to load ONE county per call.
 *
 * Runs on Vercel (app/api/iq/ops) and locally (scripts/load-lodes.ts). Tests
 * inject `source` (a gz stream) and `upsert`, so nothing touches the network.
 */
import { createInterface } from 'node:readline';
import { Readable, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createSupabaseCache } from '@/lib/iq/data/context';
import type { CacheAdapter } from '@/lib/iq/data/types';
import { createBudget, OpsConfigError, prefixedLog, type OpsBaseOptions } from './common';

export const LODES_BATCH_SIZE = 1000;
/** Below this budget a call only loads one county (each call re-streams the whole state file). */
export const ONE_COUNTY_BUDGET_MS = 120_000;
const PROGRESS_SOURCE = 'iq360_ops_progress';
const PROGRESS_TTL_S = 400 * 24 * 3600;

/** LODES WAC columns we persist → iq_lodes_wac column. All others are dropped. */
export const LODES_COLUMN_MAP: Record<string, string> = {
  C000: 'c000', // total jobs
  CA01: 'ca01', // age ≤ 29
  CA02: 'ca02', // age 30–54
  CA03: 'ca03', // age ≥ 55
  CE01: 'ce01', // earnings ≤ $1,250 / mo
  CE02: 'ce02', // $1,251 – $3,333 / mo
  CE03: 'ce03', // > $3,333 / mo
  CNS07: 'cns07', // NAICS 44-45 retail trade
  CNS12: 'cns12', // NAICS 54 professional, scientific, technical
  CNS15: 'cns15', // NAICS 61 educational services
  CNS18: 'cns18', // NAICS 72 accommodation & food services
  CR04: 'cr04', // race: Asian alone
};

export interface WacRow {
  block_geoid: string;
  year: number;
  state: string;
  [col: string]: string | number | null;
}

export interface WacHeaderSpec {
  geocodeIdx: number;
  colIndex: Array<{ src: number; dst: string }>;
  missing: string[];
}

export function lodesWacUrl(state: string, year: number): string {
  return `https://lehd.ces.census.gov/data/lodes/LODES8/${state}/wac/${state}_wac_S000_JT00_${year}.csv.gz`;
}

export function parseCountyList(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(',');
  const out = Array.from(new Set(parts.map((s) => s.trim()).filter(Boolean)));
  for (const c of out) {
    if (!/^\d{5}$/.test(c)) throw new OpsConfigError(`county FIPS must be 5 digits (state+county), got "${c}"`);
  }
  return out;
}

/** First CSV line: w_geocode,C000,CA01,...,createdate */
export function parseWacHeader(line: string): WacHeaderSpec {
  const header = line.split(',').map((h) => h.trim());
  const geocodeIdx = header.indexOf('w_geocode');
  if (geocodeIdx < 0) throw new Error('w_geocode column missing — not a WAC file?');
  const colIndex = Object.entries(LODES_COLUMN_MAP)
    .map(([src, dst]) => ({ src: header.indexOf(src), dst }))
    .filter((c) => c.src >= 0);
  const missing = Object.keys(LODES_COLUMN_MAP).filter((k) => !header.includes(k));
  return { geocodeIdx, colIndex, missing };
}

/** One data line → row, or null when the geocode is malformed or outside `counties`. */
export function parseWacLine(line: string, spec: WacHeaderSpec, counties: string[], year: number, state: string): WacRow | null {
  // LODES CSVs have no quoted fields, so a plain split is safe and fast.
  return parseWacCells(line.split(','), spec, counties, year, state);
}

export function parseWacCells(cells: string[], spec: WacHeaderSpec, counties: string[], year: number, state: string): WacRow | null {
  const geocode = cells[spec.geocodeIdx];
  if (!geocode || geocode.length !== 15) return null;
  if (!counties.some((c) => geocode.startsWith(c))) return null;
  const row: WacRow = { block_geoid: geocode, year, state };
  for (const { src, dst } of spec.colIndex) {
    const v = Number(cells[src]);
    row[dst] = Number.isFinite(v) ? v : null;
  }
  if (row.c000 == null) row.c000 = 0; // NOT NULL column; C000 is always present in practice
  return row;
}

export interface LoadLodesOptions extends OpsBaseOptions {
  /** two-letter lower-case state code, e.g. `ca` */
  state: string;
  /** LODES vintage (LODES8 ships 2002–2022) */
  year: number;
  /** 5-digit county FIPS (state + county) */
  counties: string[];
  /** Stop after this many kept rows (smoke tests). */
  maxRows?: number;
  /** Override the one-county-per-call heuristic. */
  countiesPerRun?: number;
  /** Skip counties recorded as done for (state, year). Default true unless dryRun. */
  skipDone?: boolean;
  /** Test hook: batch size (default 1000). */
  batchSize?: number;
  /** Test hook: returns the gzipped CSV as a Node stream instead of fetching. */
  source?: (url: string, signal: AbortSignal) => Promise<Readable>;
  /** Test hook: replaces the Supabase upsert. */
  upsert?: (rows: WacRow[]) => Promise<void>;
  /** Progress store; defaults to iq_market_cache (no-op without Supabase env). */
  progress?: CacheAdapter;
}

export interface LoadLodesResult {
  rows_upserted: number;
  rows_scanned: number;
  counties_done: string[];
  counties_remaining: string[];
  /** Counties skipped because a previous run already completed them. */
  counties_skipped: string[];
  truncated: boolean;
  truncated_reason: 'budget' | 'max_rows' | null;
  elapsed_ms: number;
  dry_run: boolean;
  url: string;
}

interface ProgressRecord {
  done: string[];
  updated_at: string;
}

async function defaultSource(url: string, signal: AbortSignal): Promise<Readable> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`LODES download failed: HTTP ${res.status} for ${url}`);
  return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>);
}

async function defaultUpsert(rows: WacRow[]): Promise<void> {
  const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
  const { error } = await supabaseAdmin().from('iq_lodes_wac').upsert(rows, { onConflict: 'block_geoid,year' });
  if (error) throw new Error(`iq_lodes_wac upsert failed: ${error.message}`);
}

export async function loadLodes(opts: LoadLodesOptions): Promise<LoadLodesResult> {
  const log = prefixedLog('load-lodes', opts.log);
  const now = opts.now ?? Date.now;
  const state = opts.state.toLowerCase();
  const { year } = opts;
  if (!/^[a-z]{2}$/.test(state)) throw new OpsConfigError(`state must be a two-letter code, got "${opts.state}"`);
  if (!Number.isInteger(year) || year < 2002 || year > 2100) throw new OpsConfigError(`year must be a LODES vintage ≥ 2002, got "${opts.year}"`);
  const requested = parseCountyList(opts.counties);
  if (!requested.length) throw new OpsConfigError('at least one county FIPS is required');
  const dryRun = Boolean(opts.dryRun);
  const batchSize = opts.batchSize ?? LODES_BATCH_SIZE;
  const budget = createBudget(opts.budgetMs, now);
  const url = lodesWacUrl(state, year);
  const progress = opts.progress ?? createSupabaseCache();
  const progressKey = `lodes:${state}:${year}`;

  // Which counties still need loading?
  const skipDone = opts.skipDone ?? !dryRun;
  const previouslyDone = new Set<string>();
  if (skipDone) {
    const rec = await progress.get<ProgressRecord>(PROGRESS_SOURCE, progressKey).catch(() => null);
    for (const c of rec?.done ?? []) previouslyDone.add(c);
  }
  const counties_skipped = requested.filter((c) => previouslyDone.has(c));
  const pending = requested.filter((c) => !previouslyDone.has(c));
  const perRun = opts.countiesPerRun ?? (opts.budgetMs != null && opts.budgetMs < ONE_COUNTY_BUDGET_MS ? 1 : pending.length);
  const counties = pending.slice(0, Math.max(1, perRun));
  const deferred = pending.slice(counties.length);

  const base = {
    rows_upserted: 0,
    rows_scanned: 0,
    counties_skipped,
    dry_run: dryRun,
    url,
  };
  if (!counties.length) {
    log(`nothing to do — all ${requested.length} counties already loaded for ${state}/${year}`);
    return { ...base, counties_done: [], counties_remaining: [], truncated: false, truncated_reason: null, elapsed_ms: budget.elapsed() };
  }

  // Fail fast on env before we download anything.
  const upsert = opts.upsert ?? (dryRun ? async () => {} : defaultUpsert);
  if (!opts.upsert && !dryRun) {
    const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
    supabaseAdmin(); // throws OpsConfigError-like message when SUPABASE_* are missing
  }

  log(`${url}`);
  log(`counties: ${counties.join(', ')}${deferred.length ? ` (deferred: ${deferred.join(', ')})` : ''}${dryRun ? ' (dry run)' : ''}`);

  const ctrl = new AbortController();
  const src = await (opts.source ?? defaultSource)(url, ctrl.signal);
  const gunzip = createGunzip();
  const stream: { error: Error | null } = { error: null };
  pipeline(src, gunzip, (err) => {
    // Premature close after we abort on purpose is expected; anything else is reported.
    if (err && !ctrl.signal.aborted) stream.error = err;
  });
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });

  let spec: WacHeaderSpec | null = null;
  let scanned = 0;
  let kept = 0;
  let written = 0;
  let batches = 0;
  let batch: WacRow[] = [];
  let truncated_reason: LoadLodesResult['truncated_reason'] = null;
  let lastGeocode = '';
  let sorted = true;
  const maxCounty = counties.reduce((a, b) => (a > b ? a : b));

  const flush = async () => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    batches++;
    await upsert(rows);
    written += rows.length;
    if (batches % 20 === 0) log(`… ${written.toLocaleString()} rows ${dryRun ? 'parsed' : 'written'}`);
  };

  try {
    for await (const line of lines) {
      if (!line) continue;
      if (!spec) {
        spec = parseWacHeader(line);
        if (spec.missing.length) log(`columns missing in file (stored as null): ${spec.missing.join(', ')}`);
        continue;
      }
      scanned++;
      const cells = line.split(',');
      const geocode = cells[spec.geocodeIdx] ?? '';
      if (geocode < lastGeocode) sorted = false;
      const row = parseWacCells(cells, spec, counties, year, state);
      if (row) {
        lastGeocode = geocode;
        kept++;
        batch.push(row);
        if (batch.length >= batchSize) {
          await flush();
          if (budget.exhausted()) {
            truncated_reason = 'budget';
            break;
          }
        }
        if (opts.maxRows && kept >= opts.maxRows) {
          truncated_reason = 'max_rows';
          break;
        }
      } else if (sorted && geocode.length === 15 && geocode.slice(0, 5) > maxCounty) {
        // Sorted file and we are already past every requested county → stop streaming early.
        break;
      }
      // Check the clock every 5k lines (a full state file is a few hundred thousand lines).
      if (scanned % 5_000 === 0 && budget.exhausted()) {
        truncated_reason = 'budget';
        break;
      }
    }
    // Always persist what was parsed before a stop.
    await flush();
  } finally {
    ctrl.abort();
    lines.close();
    src.destroy();
    gunzip.destroy();
  }
  if (stream.error) throw stream.error;
  if (!spec) throw new Error('LODES file was empty (no header line)');

  const truncated = truncated_reason !== null;
  let counties_done: string[];
  if (!truncated) {
    counties_done = [...counties];
  } else if (sorted) {
    // Files are sorted by w_geocode: every county whose prefix is below the last row we
    // parsed is complete; the one we were inside (or beyond) is not.
    const cursor = lastGeocode.slice(0, 5);
    counties_done = counties.filter((c) => c < cursor);
  } else {
    counties_done = [];
  }
  const partial = counties.filter((c) => !counties_done.includes(c));
  const counties_remaining = [...partial, ...deferred];

  if (!dryRun && counties_done.length) {
    const done = Array.from(new Set([...previouslyDone, ...counties_done])).sort();
    await progress.set(PROGRESS_SOURCE, progressKey, { done, updated_at: new Date().toISOString() } satisfies ProgressRecord, PROGRESS_TTL_S).catch(() => {});
  }

  log(
    `${truncated ? `stopped (${truncated_reason})` : 'done'} · scanned ${scanned.toLocaleString()} blocks · kept ${kept.toLocaleString()} · ${dryRun ? 'would write' : 'wrote'} ${written.toLocaleString()} rows in ${batches} batches · done=[${counties_done.join(',')}] remaining=[${counties_remaining.join(',')}] · ${Math.round(budget.elapsed() / 1000)}s`,
  );

  return {
    ...base,
    rows_upserted: written,
    rows_scanned: scanned,
    counties_done,
    counties_remaining,
    truncated,
    truncated_reason,
    elapsed_ms: budget.elapsed(),
  };
}
