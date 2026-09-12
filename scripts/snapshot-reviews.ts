/**
 * Monthly Google review-count snapshot for the traffic proxy (D7).
 *
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay --dry-run
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay --hub millbrae --max-hubs 1
 *   npx tsx scripts/snapshot-reviews.ts --metro sf-bay --max-details 300   # also refresh linked iq_poi ids
 *
 * For every hub centre in lib/iq/params/hubs.yaml it runs the D6 Nearby plan
 * (≤ 6 calls per hub, Pro field mask only — no reviews/atmosphere) through
 * `fetchGooglePlaces`, dedupes places across hubs, and upserts one row per
 * (place_id, snapshot_month = first of this month) into `iq_poi_snapshot`.
 *
 * Optionally (`--max-details N`) it also refreshes iq_poi rows that carry a
 * `google_place_id` but were not covered by the Nearby grid, via Place Details
 * with the same minimal field mask (billed per call — capped by N).
 *
 * The context uses an in-memory cache on purpose: the 30-day D6 cache would
 * otherwise hand back last month's counts. Cost is printed at the end and, when
 * not a dry run, written to iq_cost_log under report_id `snapshot-<month>`.
 *
 * Cron: 1st of each month. Env: GOOGLE_MAPS_API_KEY, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (the latter two optional with --dry-run).
 * Exit: 0 ok · 2 missing env · 1 crashed.
 */
import { createCostLedger, createFetchContext, createMemoryCache, fetchWithTimeout } from '@/lib/iq/data/context';
import { fetchGooglePlaces, type GooglePlace, type PlaceCall } from '@/lib/iq/data/google-places';
import { getDefaults, getHubs } from '@/lib/iq/params';
import { envValue } from '@/lib/env-value';

const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const DETAILS_FIELD_MASK = 'id,rating,userRatingCount,businessStatus';
/** Place Details Pro SKU (rating / count) list price; kept next to the nearby price in defaults.yaml. */
const DETAILS_COST_USD = 0.017;
const UPSERT_BATCH = 500;

/** Snapshot plan: nested Chinese-restaurant radii (Nearby caps at 20/call, ranked by prominence) + the L3/L4 types. */
const SNAPSHOT_PLAN: PlaceCall[] = [
  { includedTypes: ['chinese_restaurant'], radiusM: 805, label: 'chinese_restaurant @0.5mi' },
  { includedTypes: ['chinese_restaurant'], radiusM: 1609, label: 'chinese_restaurant @1mi' },
  { includedTypes: ['chinese_restaurant'], radiusM: 3219, label: 'chinese_restaurant @2mi' },
  { includedTypes: ['chinese_restaurant'], radiusM: 4828, label: 'chinese_restaurant @3mi' },
  { includedTypes: ['restaurant'], radiusM: 1609, label: 'restaurant @1mi' },
  { includedTypes: ['bubble_tea_shop', 'dessert_shop'], radiusM: 1609, label: 'boba/dessert @1mi' },
];

interface SnapshotRow {
  place_id: string;
  snapshot_month: string;
  metro: string;
  rating: number | null;
  user_rating_count: number | null;
  business_status: string | null;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(name);

function firstOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function fetchDetails(
  ctx: ReturnType<typeof createFetchContext>,
  key: string,
  placeId: string,
): Promise<Pick<GooglePlace, 'rating' | 'user_rating_count' | 'business_status'> | null> {
  try {
    const res = await fetchWithTimeout(ctx, `${DETAILS_URL}${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
      timeoutMs: 8_000,
    });
    ctx.cost.add('D7', DETAILS_COST_USD, `Place Details ${placeId} → HTTP ${res.status}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { rating?: number; userRatingCount?: number; businessStatus?: string };
    return {
      rating: typeof j.rating === 'number' ? j.rating : null,
      user_rating_count: typeof j.userRatingCount === 'number' ? j.userRatingCount : null,
      business_status: j.businessStatus ?? null,
    };
  } catch {
    return null;
  }
}

async function main() {
  const metro = arg('--metro', 'sf-bay');
  const dryRun = flag('--dry-run');
  const onlyHub = arg('--hub', '');
  const maxHubs = Number(arg('--max-hubs', '999'));
  const maxDetails = Number(arg('--max-details', '0'));

  const apiKey = envValue('GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    console.error('[snapshot-reviews] GOOGLE_MAPS_API_KEY missing');
    process.exit(2);
  }
  const hasSupa = Boolean(envValue('SUPABASE_URL') && envValue('SUPABASE_SERVICE_ROLE_KEY'));
  if (!dryRun && !hasSupa) {
    console.error('[snapshot-reviews] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (use --dry-run)');
    process.exit(2);
  }

  const hubsDoc = getHubs();
  if (hubsDoc.metro !== metro) {
    console.error(`[snapshot-reviews] hubs.yaml is for metro=${hubsDoc.metro}, not ${metro}`);
    process.exit(2);
  }
  const hubs = hubsDoc.hubs.filter((h) => !onlyHub || h.id === onlyHub).slice(0, maxHubs);
  const month = firstOfMonth(new Date());
  const perHubCap = getDefaults().data_budget.google_places_max_calls;
  const ctx = createFetchContext({ cache: createMemoryCache(), cost: createCostLedger(), log: () => {} });

  console.log(`[snapshot-reviews] metro=${metro} month=${month} hubs=${hubs.length} calls/hub≤${perHubCap} dry_run=${dryRun}`);

  // 1. Nearby grid over hub centres.
  const byPlace = new Map<string, SnapshotRow>();
  let calls = 0;
  const t0 = Date.now();
  for (const hub of hubs) {
    const r = await fetchGooglePlaces({ lat: hub.lat, lng: hub.lng, cuisineId: 'other_chinese', maxCalls: perHubCap, plan: SNAPSHOT_PLAN }, ctx);
    calls += r.data?.calls_made ?? 0;
    const places = r.data?.places ?? [];
    for (const p of places) {
      if (byPlace.has(p.id)) continue;
      byPlace.set(p.id, {
        place_id: p.id,
        snapshot_month: month,
        metro,
        rating: p.rating,
        user_rating_count: p.user_rating_count,
        business_status: p.business_status,
      });
    }
    console.log(`  ${hub.id.padEnd(22)} ${r.status.padEnd(7)} places=${String(places.length).padStart(3)} total=${byPlace.size} ${r.status !== 'ok' ? r.coverage_note : ''}`);
    if (r.status === 'failed' && /403|PERMISSION_DENIED|RESOURCE_EXHAUSTED/.test(r.error ?? '')) {
      console.error('[snapshot-reviews] fatal API error — stopping grid');
      break;
    }
  }

  // 2. Optional: linked iq_poi ids the grid missed.
  let detailsCalls = 0;
  let linkedTotal = 0;
  let linkedMissing = 0;
  if (hasSupa) {
    try {
      const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
      const supa = supabaseAdmin();
      const linked: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supa
          .from('iq_poi')
          .select('google_place_id')
          .eq('metro', metro)
          .not('google_place_id', 'is', null)
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const row of data) if (row.google_place_id) linked.push(row.google_place_id as string);
        if (data.length < 1000) break;
      }
      linkedTotal = linked.length;
      const missing = linked.filter((id) => !byPlace.has(id));
      linkedMissing = missing.length;
      console.log(`[snapshot-reviews] iq_poi linked ids=${linkedTotal}, not covered by grid=${linkedMissing}, refreshing ≤${maxDetails}`);
      for (const id of missing.slice(0, Math.max(0, maxDetails))) {
        const d = await fetchDetails(ctx, apiKey, id);
        detailsCalls++;
        if (!d) continue;
        byPlace.set(id, { place_id: id, snapshot_month: month, metro, ...d });
      }
    } catch (err) {
      console.warn(`[snapshot-reviews] iq_poi lookup skipped: ${(err as Error).message}`);
    }
  }

  // 3. Upsert.
  const rows = [...byPlace.values()];
  const withCounts = rows.filter((r) => r.user_rating_count != null).length;
  if (dryRun) {
    console.log(`[snapshot-reviews] dry run — would upsert ${rows.length} rows (${withCounts} with counts)`);
    for (const r of rows.slice(0, 5)) console.log('   ', JSON.stringify(r));
  } else {
    const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
    const supa = supabaseAdmin();
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const batch = rows.slice(i, i + UPSERT_BATCH);
      const { error } = await supa.from('iq_poi_snapshot').upsert(batch, { onConflict: 'place_id,snapshot_month' });
      if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
    }
    console.log(`[snapshot-reviews] upserted ${rows.length} rows into iq_poi_snapshot (${withCounts} with counts)`);
    const entries = ctx.cost.entries();
    if (entries.length) {
      const { error } = await supa
        .from('iq_cost_log')
        .insert(entries.map((e) => ({ report_id: `snapshot-${month}`, source: e.source, usd: e.usd, note: e.note })));
      if (error) console.warn(`[snapshot-reviews] iq_cost_log insert failed: ${error.message}`);
    }
  }

  // 4. Cost summary.
  const by = ctx.cost.bySource();
  console.log('\n[snapshot-reviews] cost summary');
  console.table([
    { item: 'Nearby calls (D6)', count: calls, usd: by.D6 ?? 0 },
    { item: 'Place Details (D7)', count: detailsCalls, usd: by.D7 ?? 0 },
    { item: 'TOTAL', count: calls + detailsCalls, usd: ctx.cost.total() },
  ]);
  console.log(`[snapshot-reviews] places=${rows.length} hubs=${hubs.length} elapsed=${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((err) => {
  console.error('[snapshot-reviews] FAIL', err);
  process.exit(1);
});
