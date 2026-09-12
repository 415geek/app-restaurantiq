/**
 * Hub benchmarks for the void analysis (研发提示词 §3.7 / 附录 C): for every hub
 * in lib/iq/params/hubs.yaml, count L1 restaurants per sub-cuisine inside a
 * 3-mile (drive10 proxy) circle from iq_poi and divide by the ACS Chinese
 * population of that circle → density per 10k Chinese residents. The median
 * across hubs is cached in iq_market_cache as `iq360_hub_density` /
 * `<metro>:<cuisine>` (TTL 35 days; run monthly).
 *
 * Runs on Vercel (app/api/iq/ops?task=hubs) and locally (scripts/refresh-hubs.ts).
 * Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and iq_poi loaded
 * (scripts/load_overture.py). Network: Census Geocoder + ACS + TIGERweb only.
 */
import { circlePolygon } from '@/lib/iq/geo';
import { createFetchContext } from '@/lib/iq/data/context';
import { fetchAcs } from '@/lib/iq/data/acs';
import { fetchGeocode } from '@/lib/iq/data/geocode';
import { fetchOverturePois } from '@/lib/iq/data/overture';
import { computeTradeArea } from '@/lib/iq/engines/trade-area';
import { getHubs, getTaxonomy } from '@/lib/iq/params';
import { createBudget, OpsConfigError, prefixedLog, round4, type OpsBaseOptions } from './common';

const MI = 1_609.344;
const HUB_DENSITY_TTL_S = 35 * 24 * 3600;

export interface RefreshHubsOptions extends OpsBaseOptions {
  metro: string;
  /** Only these hub ids (smoke tests). */
  onlyHubs?: string[];
}

export interface RefreshHubsResult {
  metro: string;
  hubs_total: number;
  hubs_done: number;
  hubs_skipped: string[];
  cuisines_written: number;
  /** median density per 10k Chinese residents, by cuisine (null when no hub produced a value) */
  medians: Record<string, number | null>;
  cost_usd: number;
  warnings: string[];
  truncated: boolean;
  elapsed_ms: number;
  dry_run: boolean;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function refreshHubs(opts: RefreshHubsOptions): Promise<RefreshHubsResult> {
  const log = prefixedLog('refresh-hubs', opts.log);
  const dryRun = Boolean(opts.dryRun);
  const budget = createBudget(opts.budgetMs, opts.now);
  const warnings: string[] = [];
  const warn = (msg: string) => {
    warnings.push(msg);
    log(`warn: ${msg}`);
  };

  const hubsDoc = getHubs();
  if (hubsDoc.metro !== opts.metro) throw new OpsConfigError(`hubs.yaml is for ${hubsDoc.metro}, not ${opts.metro}`);
  const hubs = hubsDoc.hubs.filter((h) => !opts.onlyHubs?.length || opts.onlyHubs.includes(h.id));
  const metro = opts.metro;
  // Per-fetch budget: the context budget is per source call, not the whole job.
  const ctx = createFetchContext({ budgetMs: Math.min(120_000, Math.max(20_000, opts.budgetMs ?? 120_000)), log: () => {} });
  const cuisines = getTaxonomy().cuisines.map((c) => c.id);
  const perCuisine: Record<string, number[]> = Object.fromEntries(cuisines.map((c) => [c, []]));

  let hubsDone = 0;
  const hubsSkipped: string[] = [];
  let truncated = false;
  for (const hub of hubs) {
    if (budget.exhausted()) {
      truncated = true;
      warn(`budget exhausted after ${hubsDone} hubs; medians use the hubs processed so far`);
      break;
    }
    const geo = await fetchGeocode({ address: `${hub.name.replace(/\s*\(.*\)$/, '')}, CA` }, ctx);
    if (!geo.data) {
      warn(`${hub.id}: geocode failed (${geo.coverage_note})`);
      hubsSkipped.push(hub.id);
      continue;
    }
    const center = { lat: hub.lat, lng: hub.lng };
    const [acs, pois] = await Promise.all([
      fetchAcs({ geography: geo.data.geography, lat: center.lat, lng: center.lng, radiusM: 3.5 * MI }, ctx),
      fetchOverturePois({ lat: center.lat, lng: center.lng, radiusM: 3 * MI, metro }, ctx),
    ]);
    if (!acs.data || !pois.data?.loaded) {
      warn(`${hub.id}: acs=${acs.status} overture=${pois.status}`);
      hubsSkipped.push(hub.id);
      continue;
    }
    const ring = circlePolygon(center, 3 * MI, 64);
    const ta = computeTradeArea({
      rings: [{ id: 'drive10', geometry: ring, method: 'radius', minutes: 10, radius_mi: 3 }],
      block_groups: acs.data.block_groups.map((b) => ({
        geoid: b.geoid,
        tract: b.tract,
        geometry: b.geometry,
        pop: b.pop,
        pop5plus: b.pop5plus,
        households: b.households,
        median_income: b.median_income,
        chinese_speakers: b.chinese_speakers,
        chinese_pop_est: b.chinese_pop_est,
        age_25_44: b.age_25_44,
        families_with_children: b.families_with_children,
        renter_households: null,
        occupied_households: b.households,
        commute_total: b.commute.total,
        commute_transit: b.commute.transit,
        commute_walk: b.commute.walk,
        commute_drove_alone: b.commute.drove_alone,
        jobs: null,
      })),
      params: { cuisine_share: 0.1, range_class: 'regular', fafhForIncome: () => 0, jobs_method: 'none', county: { chinese_hh_share: null, median_income: null } },
    });
    const chinesePop = ta.rings[0]?.chinese_pop ?? null;
    if (!chinesePop || chinesePop <= 0) {
      warn(`${hub.id}: no Chinese population estimate (ancestry table missing)`);
      hubsSkipped.push(hub.id);
      continue;
    }
    const open = pois.data.pois.filter((p) => p.sub_cuisine && !/closed_permanently/i.test(p.operating_status));
    const row: Record<string, number> = {};
    for (const c of cuisines) {
      const n = open.filter((p) => p.sub_cuisine === c).length;
      const density = (n / chinesePop) * 10_000;
      perCuisine[c].push(density);
      row[c] = Math.round(density * 100) / 100;
    }
    hubsDone++;
    log(`${hub.id}: chinese_pop=${Math.round(chinesePop)} pois=${open.length}`, row);
  }

  const computed_at = new Date().toISOString();
  const medians: Record<string, number | null> = {};
  let cuisinesWritten = 0;
  for (const c of cuisines) {
    const m = median(perCuisine[c]);
    medians[c] = m;
    const payload = { median_density_per_10k_chinese: m, hubs: perCuisine[c].length, computed_at, metro, cuisine: c };
    log(`${metro}:${c} median=${m == null ? 'n/a' : m.toFixed(2)} (n=${perCuisine[c].length})`);
    if (!dryRun && m != null) {
      await ctx.cache.set('iq360_hub_density', `${metro}:${c}`, payload, HUB_DENSITY_TTL_S);
      cuisinesWritten++;
    }
  }
  const cost_usd = round4(ctx.cost.total());
  log(`done · hubs ${hubsDone}/${hubs.length} · cuisines written ${cuisinesWritten} · data cost $${cost_usd.toFixed(3)}${dryRun ? ' (dry run, nothing written)' : ''}`);

  return {
    metro,
    hubs_total: hubs.length,
    hubs_done: hubsDone,
    hubs_skipped: hubsSkipped,
    cuisines_written: cuisinesWritten,
    medians,
    cost_usd,
    warnings,
    truncated,
    elapsed_ms: budget.elapsed(),
    dry_run: dryRun,
  };
}
