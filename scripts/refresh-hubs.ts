/**
 * Precompute hub benchmarks for the void analysis (研发提示词 §3.7 / 附录 C):
 * for every hub in lib/iq/params/hubs.yaml, count L1 restaurants per
 * sub-cuisine inside a 3-mile (drive10 proxy) circle from iq_poi and divide
 * by the ACS Chinese population of that circle → density per 10k Chinese
 * residents. The median across hubs is cached in iq_market_cache as
 * `iq360_hub_density` / `<metro>:<cuisine>` (TTL 35 days; run monthly).
 *
 *   npx tsx scripts/refresh-hubs.ts --metro sf-bay [--dry-run]
 *
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

const MI = 1_609.344;
const args = process.argv.slice(2);
const metro = args[args.indexOf('--metro') + 1] || 'sf-bay';
const dryRun = args.includes('--dry-run');

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const hubs = getHubs();
  if (hubs.metro !== metro) throw new Error(`hubs.yaml is for ${hubs.metro}, not ${metro}`);
  const ctx = createFetchContext({ budgetMs: 120_000 });
  const cuisines = getTaxonomy().cuisines.map((c) => c.id);
  const perCuisine: Record<string, number[]> = Object.fromEntries(cuisines.map((c) => [c, []]));

  for (const hub of hubs.hubs) {
    const geo = await fetchGeocode({ address: `${hub.name.replace(/\s*\(.*\)$/, '')}, CA` }, ctx);
    if (!geo.data) {
      console.warn(`[refresh-hubs] ${hub.id}: geocode failed (${geo.coverage_note})`);
      continue;
    }
    const center = { lat: hub.lat, lng: hub.lng };
    const [acs, pois] = await Promise.all([
      fetchAcs({ geography: geo.data.geography, lat: center.lat, lng: center.lng, radiusM: 3.5 * MI }, ctx),
      fetchOverturePois({ lat: center.lat, lng: center.lng, radiusM: 3 * MI, metro }, ctx),
    ]);
    if (!acs.data || !pois.data?.loaded) {
      console.warn(`[refresh-hubs] ${hub.id}: acs=${acs.status} overture=${pois.status}`);
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
      console.warn(`[refresh-hubs] ${hub.id}: no Chinese population estimate (ancestry table missing)`);
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
    console.log(`[refresh-hubs] ${hub.id}: chinese_pop=${Math.round(chinesePop)} pois=${open.length}`, row);
  }

  const computed_at = new Date().toISOString();
  for (const c of cuisines) {
    const m = median(perCuisine[c]);
    const payload = { median_density_per_10k_chinese: m, hubs: perCuisine[c].length, computed_at, metro, cuisine: c };
    console.log(`[refresh-hubs] ${metro}:${c} median=${m == null ? 'n/a' : m.toFixed(2)} (n=${perCuisine[c].length})`);
    if (!dryRun && m != null) await ctx.cache.set('iq360_hub_density', `${metro}:${c}`, payload, 35 * 24 * 3600);
  }
  console.log(`[refresh-hubs] done; data cost $${ctx.cost.total().toFixed(3)}${dryRun ? ' (dry run, nothing written)' : ''}`);
}

main().catch((e) => {
  console.error('[refresh-hubs] FAIL', e);
  process.exit(1);
});
