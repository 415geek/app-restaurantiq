/**
 * Load LEHD LODES v8 WAC (workplace area characteristics) into `iq_lodes_wac`
 * for the counties the 360° report engine covers (D3 · lib/iq/data/lodes.ts).
 *
 *   npx tsx scripts/load-lodes.ts --state ca --year 2022 --counties 06081,06075,06085,06001,06013
 *
 * Flags
 *   --state     two-letter state code, lower case (default ca)
 *   --year      LODES vintage (default 2022; LODES8 currently ships 2002–2022)
 *   --counties  comma-separated 5-digit county FIPS (state + county). Rows whose
 *               w_geocode does not start with one of these are skipped.
 *   --dry-run   parse + count only, no writes
 *
 * Source file (≈ 20–60 MB gzipped per state):
 *   https://lehd.ces.census.gov/data/lodes/LODES8/{state}/wac/{state}_wac_S000_JT00_{year}.csv.gz
 *   S000 = all workers, JT00 = all jobs (primary + secondary). Public domain.
 *
 * Pipeline: fetch → gunzip stream → readline → filter by county prefix →
 * map the columns we keep → upsert in batches of 1000 (PK = block_geoid + year).
 * Memory stays flat regardless of the state's size because nothing is buffered
 * beyond one batch.
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role bypasses the
 * deny-all RLS on iq_lodes_wac). Exit codes: 0 ok · 2 bad args/env · 1 crash.
 */
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { supabaseAdmin } from '@/lib/server/supabase-admin';

const BATCH_SIZE = 1000;

/** LODES WAC columns we persist → iq_lodes_wac column. All others are dropped. */
const COLUMN_MAP: Record<string, string> = {
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

interface WacRow {
  block_geoid: string;
  year: number;
  state: string;
  [col: string]: string | number | null;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function parseCounties(raw: string): string[] {
  const out = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const c of out) {
    if (!/^\d{5}$/.test(c)) throw new Error(`county FIPS must be 5 digits (state+county), got "${c}"`);
  }
  return out;
}

async function main(): Promise<number> {
  const state = arg('--state', 'ca').toLowerCase();
  const year = Number(arg('--year', '2022'));
  const counties = parseCounties(arg('--counties', '06081,06075,06085,06001,06013'));
  const dryRun = process.argv.includes('--dry-run');

  if (!/^[a-z]{2}$/.test(state) || !Number.isInteger(year) || year < 2002) {
    console.error('usage: tsx scripts/load-lodes.ts --state ca --year 2022 --counties 06081,06075');
    return 2;
  }

  const url = `https://lehd.ces.census.gov/data/lodes/LODES8/${state}/wac/${state}_wac_S000_JT00_${year}.csv.gz`;
  console.log(`[load-lodes] ${url}`);
  console.log(`[load-lodes] counties: ${counties.join(', ')}${dryRun ? ' (dry run)' : ''}`);

  // Fail fast on env before we download anything.
  const supa = dryRun ? null : supabaseAdmin();

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    console.error(`[load-lodes] download failed: HTTP ${res.status}`);
    return 1;
  }

  // Web ReadableStream → Node stream → gunzip → line reader. Nothing is buffered.
  const gunzip = createGunzip();
  Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(gunzip);
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });

  let header: string[] | null = null;
  let colIndex: Array<{ src: number; dst: string }> = [];
  let geocodeIdx = -1;
  let seen = 0;
  let kept = 0;
  let written = 0;
  let batches = 0;
  let batch: WacRow[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    batches++;
    if (!supa) {
      written += rows.length;
      return;
    }
    // PK (block_geoid, year) → re-running the loader is idempotent.
    const { error } = await supa.from('iq_lodes_wac').upsert(rows, { onConflict: 'block_geoid,year' });
    if (error) throw new Error(`upsert batch ${batches} failed: ${error.message}`);
    written += rows.length;
    if (batches % 20 === 0) console.log(`[load-lodes] … ${written.toLocaleString()} rows written`);
  };

  for await (const line of lines) {
    if (!line) continue;
    if (!header) {
      // First line is the CSV header: w_geocode,C000,CA01,...,createdate
      header = line.split(',').map((h) => h.trim());
      geocodeIdx = header.indexOf('w_geocode');
      if (geocodeIdx < 0) throw new Error('w_geocode column missing — not a WAC file?');
      colIndex = Object.entries(COLUMN_MAP)
        .map(([src, dst]) => ({ src: header!.indexOf(src), dst }))
        .filter((c) => c.src >= 0);
      const missing = Object.keys(COLUMN_MAP).filter((k) => !header!.includes(k));
      if (missing.length) console.warn(`[load-lodes] columns missing in file (stored as null): ${missing.join(', ')}`);
      continue;
    }
    seen++;
    // LODES CSVs have no quoted fields, so a plain split is safe and fast.
    const cells = line.split(',');
    const geocode = cells[geocodeIdx];
    if (!geocode || geocode.length !== 15) continue;
    if (!counties.some((c) => geocode.startsWith(c))) continue;
    kept++;

    const row: WacRow = { block_geoid: geocode, year, state };
    for (const { src, dst } of colIndex) {
      const v = Number(cells[src]);
      row[dst] = Number.isFinite(v) ? v : null;
    }
    if (row.c000 == null) row.c000 = 0; // NOT NULL column; C000 is always present in practice
    batch.push(row);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(
    `[load-lodes] done · scanned ${seen.toLocaleString()} blocks · kept ${kept.toLocaleString()} in ${counties.length} counties · ${dryRun ? 'would write' : 'wrote'} ${written.toLocaleString()} rows in ${batches} batches (year ${year}, state ${state})`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[load-lodes] crashed', e);
    process.exit(1);
  });
