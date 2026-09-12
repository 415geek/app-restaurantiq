/**
 * CLI wrapper for lib/iq/ops/refresh-hubs.ts — precompute hub benchmarks for
 * the void analysis (研发提示词 §3.7 / 附录 C) into iq_market_cache
 * (`iq360_hub_density` / `<metro>:<cuisine>`, TTL 35 days; run monthly).
 *
 *   npx tsx scripts/refresh-hubs.ts --metro sf-bay [--dry-run]
 *
 * The same job runs on Vercel via GET /api/iq/ops?task=hubs (monthly cron).
 * Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and iq_poi loaded
 * (scripts/load_overture.py). Network: Census Geocoder + ACS + TIGERweb only.
 */
import { OpsConfigError } from '@/lib/iq/ops/common';
import { refreshHubs } from '@/lib/iq/ops/refresh-hubs';

const args = process.argv.slice(2);
const metro = args[args.indexOf('--metro') + 1] || 'sf-bay';
const dryRun = args.includes('--dry-run');

refreshHubs({ metro, dryRun })
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((e) => {
    if (e instanceof OpsConfigError) {
      console.error(`[refresh-hubs] ${e.message}`);
      process.exit(2);
    }
    console.error('[refresh-hubs] FAIL', e);
    process.exit(1);
  });
