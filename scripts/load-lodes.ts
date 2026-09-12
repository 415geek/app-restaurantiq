/**
 * CLI wrapper for lib/iq/ops/lodes-loader.ts — load LEHD LODES v8 WAC into
 * `iq_lodes_wac` for the counties the 360° report engine covers.
 *
 *   npx tsx scripts/load-lodes.ts --state ca --year 2022 --counties 06081,06075,06085,06001,06013
 *
 * Flags
 *   --state     two-letter state code, lower case (default ca)
 *   --year      LODES vintage (default 2022; LODES8 currently ships 2002–2022)
 *   --counties  comma-separated 5-digit county FIPS (state + county)
 *   --dry-run   parse + count only, no writes
 *   --budget-ms stop cleanly after this long and print counties_remaining
 *   --force     ignore recorded progress (reload counties already marked done)
 *
 * The same job runs on Vercel via GET /api/iq/ops?task=lodes (weekly cron).
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Exit: 0 ok · 2 bad args/env · 1 crash.
 */
import { OpsConfigError } from '@/lib/iq/ops/common';
import { loadLodes, parseCountyList } from '@/lib/iq/ops/lodes-loader';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

async function main(): Promise<number> {
  const budgetRaw = Number(arg('--budget-ms', ''));
  const result = await loadLodes({
    state: arg('--state', 'ca'),
    year: Number(arg('--year', '2022')),
    counties: parseCountyList(arg('--counties', '06081,06075,06085,06001,06013')),
    dryRun: process.argv.includes('--dry-run'),
    skipDone: process.argv.includes('--force') ? false : undefined,
    budgetMs: Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : undefined,
  });
  console.log(JSON.stringify(result));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof OpsConfigError) {
      console.error(`[load-lodes] ${e.message}`);
      console.error('usage: tsx scripts/load-lodes.ts --state ca --year 2022 --counties 06081,06075 [--dry-run]');
      process.exit(2);
    }
    console.error('[load-lodes] crashed', e);
    process.exit(1);
  });
