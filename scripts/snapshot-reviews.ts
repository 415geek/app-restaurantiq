/**
 * CLI wrapper for lib/iq/ops/snapshot-reviews.ts — monthly Google review-count
 * snapshot for the traffic proxy (D7) into `iq_poi_snapshot`.
 *
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay --dry-run
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay --hub millbrae --max-hubs 1
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay --max-details 300   # also refresh linked iq_poi ids
 *
 * The same job runs on Vercel via GET /api/iq/ops?task=snapshots (1st of each
 * month). Env: GOOGLE_MAPS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (the latter two optional with --dry-run). Exit: 0 ok · 2 missing env · 1 crashed.
 */
import { OpsConfigError } from '@/lib/iq/ops/common';
import { snapshotReviews } from '@/lib/iq/ops/snapshot-reviews';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(name);

snapshotReviews({
  metro: arg('--metro', 'sf-bay'),
  dryRun: flag('--dry-run'),
  onlyHub: arg('--hub', '') || undefined,
  maxHubs: Number(arg('--max-hubs', '999')),
  maxDetails: Number(arg('--max-details', '0')),
})
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    if (err instanceof OpsConfigError) {
      console.error(`[snapshot-reviews] ${err.message}`);
      process.exit(2);
    }
    console.error('[snapshot-reviews] FAIL', err);
    process.exit(1);
  });
