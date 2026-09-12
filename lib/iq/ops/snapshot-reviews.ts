/**
 * Monthly Google review-count snapshot for the traffic proxy (D7).
 *
 * For every hub centre in lib/iq/params/hubs.yaml it runs the D6 Nearby plan
 * (≤ 6 calls per hub, Pro field mask only — no reviews/atmosphere) through
 * `fetchGooglePlaces`, dedupes places across hubs, and upserts one row per
 * (place_id, snapshot_month = first of this month) into `iq_poi_snapshot`.
 *
 * Optionally (`maxDetails`) it also refreshes iq_poi rows that carry a
 * `google_place_id` but were not covered by the Nearby grid, via Place Details
 * with the same minimal field mask (billed per call — capped by N).
 *
 * The context uses an in-memory cache on purpose: the 30-day D6 cache would
 * otherwise hand back last month's counts. Cost is returned and, when not a
 * dry run, written to iq_cost_log under report_id `snapshot-<month>`.
 *
 * Runs on Vercel (app/api/iq/ops?task=snapshots, 1st of each month) and locally
 * (scripts/snapshot-reviews.ts). Env: GOOGLE_MAPS_API_KEY, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (the latter two optional with dryRun).
 */
import { createCostLedger, createFetchContext, createMemoryCache, fetchWithTimeout } from '@/lib/iq/data/context';
import { fetchGooglePlaces, type GooglePlace, type PlaceCall } from '@/lib/iq/data/google-places';
import type { FetchContext } from '@/lib/iq/data/types';
import { getDefaults, getHubs } from '@/lib/iq/params';
import { envValue } from '@/lib/env-value';
import { createBudget, OpsConfigError, prefixedLog, round4, type OpsBaseOptions } from './common';

const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const DETAILS_FIELD_MASK = 'id,rating,userRatingCount,businessStatus';
/** Place Details Pro SKU (rating / count) list price; kept next to the nearby price in defaults.yaml. */
const DETAILS_COST_USD = 0.017;
const UPSERT_BATCH = 500;

/** Snapshot plan: nested Chinese-restaurant radii (Nearby caps at 20/call, ranked by prominence) + the L3/L4 types. */
export const SNAPSHOT_PLAN: PlaceCall[] = [
  { includedTypes: ['chinese_restaurant'], radiusM: 805, label: 'chinese_restaurant @0.5mi' },
  { includedTypes: ['chinese_restaurant'], radiusM: 1609, label: 'chinese_restaurant @1mi' },
  { includedTypes: ['chinese_restaurant'], radiusM: 3219, label: 'chinese_restaurant @2mi' },
  { includedTypes: ['chinese_restaurant'], radiusM: 4828, label: 'chinese_restaurant @3mi' },
  { includedTypes: ['restaurant'], radiusM: 1609, label: 'restaurant @1mi' },
  { includedTypes: ['bubble_tea_shop', 'dessert_shop'], radiusM: 1609, label: 'boba/dessert @1mi' },
];

export interface SnapshotRow {
  place_id: string;
  snapshot_month: string;
  metro: string;
  rating: number | null;
  user_rating_count: number | null;
  business_status: string | null;
}

export interface SnapshotReviewsOptions extends OpsBaseOptions {
  metro: string;
  /** Only this hub id (smoke tests). */
  onlyHub?: string;
  maxHubs?: number;
  /** Also refresh up to N linked iq_poi ids the grid missed via Place Details (billed). Default 0. */
  maxDetails?: number;
}

export interface SnapshotReviewsResult {
  metro: string;
  month: string;
  hubs: number;
  hubs_done: number;
  places: number;
  places_with_counts: number;
  rows_upserted: number;
  calls: number;
  details_calls: number;
  linked_total: number;
  linked_missing: number;
  cost_usd: number;
  cost_by_source: Record<string, number>;
  warnings: string[];
  truncated: boolean;
  elapsed_ms: number;
  dry_run: boolean;
}

export function firstOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function fetchDetails(
  ctx: FetchContext,
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

export async function snapshotReviews(opts: SnapshotReviewsOptions): Promise<SnapshotReviewsResult> {
  const log = prefixedLog('snapshot-reviews', opts.log);
  const dryRun = Boolean(opts.dryRun);
  const budget = createBudget(opts.budgetMs, opts.now);
  const warnings: string[] = [];
  const warn = (msg: string) => {
    warnings.push(msg);
    log(`warn: ${msg}`);
  };
  const { metro } = opts;
  const maxHubs = opts.maxHubs ?? 999;
  const maxDetails = Math.max(0, opts.maxDetails ?? 0);

  const apiKey = envValue('GOOGLE_MAPS_API_KEY');
  if (!apiKey) throw new OpsConfigError('GOOGLE_MAPS_API_KEY missing');
  const hasSupa = Boolean(envValue('SUPABASE_URL') && envValue('SUPABASE_SERVICE_ROLE_KEY'));
  if (!dryRun && !hasSupa) throw new OpsConfigError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (use dryRun)');

  const hubsDoc = getHubs();
  if (hubsDoc.metro !== metro) throw new OpsConfigError(`hubs.yaml is for metro=${hubsDoc.metro}, not ${metro}`);
  const hubs = hubsDoc.hubs.filter((h) => !opts.onlyHub || h.id === opts.onlyHub).slice(0, maxHubs);
  const month = firstOfMonth(new Date());
  const perHubCap = getDefaults().data_budget.google_places_max_calls;
  const ctx = createFetchContext({ cache: createMemoryCache(), cost: createCostLedger(), log: () => {} });

  log(`metro=${metro} month=${month} hubs=${hubs.length} calls/hub≤${perHubCap} dry_run=${dryRun}`);

  // 1. Nearby grid over hub centres.
  const byPlace = new Map<string, SnapshotRow>();
  let calls = 0;
  let hubsDone = 0;
  let truncated = false;
  for (const hub of hubs) {
    if (budget.exhausted()) {
      truncated = true;
      warn(`budget exhausted after ${hubsDone}/${hubs.length} hubs`);
      break;
    }
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
    hubsDone++;
    log(`  ${hub.id.padEnd(22)} ${r.status.padEnd(7)} places=${String(places.length).padStart(3)} total=${byPlace.size} ${r.status !== 'ok' ? r.coverage_note : ''}`);
    if (r.status === 'failed' && /403|PERMISSION_DENIED|RESOURCE_EXHAUSTED/.test(r.error ?? '')) {
      warn(`fatal Google API error (${r.error}) — stopping grid`);
      truncated = true;
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
      log(`iq_poi linked ids=${linkedTotal}, not covered by grid=${linkedMissing}, refreshing ≤${maxDetails}`);
      for (const id of missing.slice(0, maxDetails)) {
        if (budget.exhausted()) {
          truncated = true;
          warn(`budget exhausted after ${detailsCalls} Place Details calls`);
          break;
        }
        const d = await fetchDetails(ctx, apiKey, id);
        detailsCalls++;
        if (!d) continue;
        byPlace.set(id, { place_id: id, snapshot_month: month, metro, ...d });
      }
    } catch (err) {
      warn(`iq_poi lookup skipped: ${(err as Error).message}`);
    }
  }

  // 3. Upsert.
  const rows = [...byPlace.values()];
  const withCounts = rows.filter((r) => r.user_rating_count != null).length;
  let rowsUpserted = 0;
  if (dryRun) {
    log(`dry run — would upsert ${rows.length} rows (${withCounts} with counts)`);
    for (const r of rows.slice(0, 5)) log(`   ${JSON.stringify(r)}`);
  } else {
    const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
    const supa = supabaseAdmin();
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const batch = rows.slice(i, i + UPSERT_BATCH);
      const { error } = await supa.from('iq_poi_snapshot').upsert(batch, { onConflict: 'place_id,snapshot_month' });
      if (error) throw new Error(`iq_poi_snapshot upsert failed at ${i}: ${error.message}`);
      rowsUpserted += batch.length;
    }
    log(`upserted ${rowsUpserted} rows into iq_poi_snapshot (${withCounts} with counts)`);
    const entries = ctx.cost.entries();
    if (entries.length) {
      const { error } = await supa
        .from('iq_cost_log')
        .insert(entries.map((e) => ({ report_id: `snapshot-${month}`, source: e.source, usd: e.usd, note: e.note })));
      if (error) warn(`iq_cost_log insert failed: ${error.message}`);
    }
  }

  // 4. Cost summary.
  const by = ctx.cost.bySource();
  const cost_usd = round4(ctx.cost.total());
  log(`cost · Nearby (D6) ${calls} calls $${(by.D6 ?? 0).toFixed(3)} · Place Details (D7) ${detailsCalls} calls $${(by.D7 ?? 0).toFixed(3)} · total $${cost_usd.toFixed(3)}`);
  log(`places=${rows.length} hubs=${hubsDone}/${hubs.length} elapsed=${Math.round(budget.elapsed() / 1000)}s`);

  return {
    metro,
    month,
    hubs: hubs.length,
    hubs_done: hubsDone,
    places: rows.length,
    places_with_counts: withCounts,
    rows_upserted: rowsUpserted,
    calls,
    details_calls: detailsCalls,
    linked_total: linkedTotal,
    linked_missing: linkedMissing,
    cost_usd,
    cost_by_source: by,
    warnings,
    truncated,
    elapsed_ms: budget.elapsed(),
    dry_run: dryRun,
  };
}
