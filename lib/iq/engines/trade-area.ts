/**
 * TradeAreaEngine (研发提示词 Phase 2.1 / 2.3 / 2.5).
 *
 * Four fixed rings (walk10 / drive5 / drive10 / drive15). Block-group ACS
 * metrics are clipped into each ring by area share (sampling-based
 * ST_Intersection, see geo.areaShareInside) and summed. Demand per block group:
 *
 *   restaurant_spend_i = hh_i × CEX(income_i).fafh × region_multiplier
 *   chinese_spend_i    = restaurant_spend_i × [p_cn_i × s_cn + (1 − p_cn_i) × s_other]
 *   cuisine_demand_i   = chinese_spend_i × cuisine_share            (audience 'chinese', default)
 *                      = restaurant_spend_i × cuisine_share         (audience 'general', §4.1: 烘焙 / 饮品 / 西餐 …)
 *
 * Pure function: no I/O, every input is explicit so tests are deterministic.
 */
import { areaM2, areaShareInside, centroid } from '../geo';
import type { Geometry, LatLng } from '../data/types';
import type { Ring, RingId } from '../model/schema';
import { getDefaults, type RangeClass } from '../params';

export interface BlockGroupInput {
  geoid: string;
  tract: string;
  geometry: Geometry | null;
  pop: number | null;
  pop5plus: number | null;
  households: number | null;
  median_income: number | null;
  chinese_speakers: number | null;
  chinese_pop_est: number | null;
  age_25_44: number | null;
  families_with_children: number | null;
  renter_households: number | null;
  occupied_households: number | null;
  commute_total: number | null;
  commute_transit: number | null;
  commute_walk: number | null;
  commute_drove_alone: number | null;
  /** Jobs located in this BG (LODES WAC aggregated from blocks); null when LODES unavailable. */
  jobs: number | null;
}

export interface RingInput {
  id: RingId;
  geometry: Geometry;
  method: 'mapbox' | 'radius';
  minutes: number;
  radius_mi: number | null;
}

export interface TradeAreaParams {
  /** Share of the demand basis going to the concept (sub-cuisine share of Chinese spend, or category × subtype share of all restaurant spend). */
  cuisine_share: number;
  /** Which spend the share multiplies; defaults to Chinese-restaurant spend (the 中餐 path). */
  demand_basis?: 'chinese_spend' | 'restaurant_spend';
  range_class: RangeClass;
  /** CEX food-away-from-home USD/yr for a household at a given median income. */
  fafhForIncome: (medianIncome: number) => number;
  jobs_method: 'lodes_wac' | 'acs_b08301_estimate' | 'none';
  county: { chinese_hh_share: number | null; median_income: number | null };
}

export interface BlockGroupDemand {
  geoid: string;
  centroid: LatLng;
  cuisine_demand_usd: number; // annual
  chinese_spend_usd: number;
  restaurant_spend_usd: number;
  pop: number;
  weightByRing: Partial<Record<RingId, number>>;
}

export interface TradeAreaResult {
  primary_ring: RingId;
  rings: Ring[];
  county_benchmark: { chinese_hh_share: number | null; median_income: number | null };
  isochrone_method: 'mapbox' | 'radius';
  /** Per-block-group demand (used by the Huff engine). Only BGs with geometry. */
  bg_demand: BlockGroupDemand[];
  commute_mix: { transit: number | null; walk: number | null; drove_alone: number | null };
  coverage: { bg_total: number; bg_with_geometry: number };
}

export const RING_ORDER: RingId[] = ['walk10', 'drive5', 'drive10', 'drive15'];

export function primaryRingFor(range: RangeClass): RingId {
  return range === 'everyday' ? 'drive5' : range === 'regular' ? 'drive10' : 'drive15';
}

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function computeBlockGroupDemand(bg: BlockGroupInput, p: TradeAreaParams): {
  restaurant: number;
  chinese: number;
  cuisine: number;
  p_cn: number | null;
} {
  const d = getDefaults().demand;
  const hh = n(bg.households);
  if (hh <= 0 || bg.median_income == null) return { restaurant: 0, chinese: 0, cuisine: 0, p_cn: null };
  const restaurant = hh * p.fafhForIncome(bg.median_income) * d.region_multiplier;
  // C16001 (Chinese speakers) when the block group has it; otherwise B02018 Chinese ancestry ÷ pop
  // (downscaled from the tract) — never a county-wide average when a local signal exists.
  const p_cn =
    bg.chinese_speakers != null && n(bg.pop5plus) > 0
      ? Math.min(1, n(bg.chinese_speakers) / n(bg.pop5plus))
      : bg.chinese_pop_est != null && n(bg.pop) > 0
        ? Math.min(1, n(bg.chinese_pop_est) / n(bg.pop))
        : null;
  const pcn = p_cn ?? (p.county.chinese_hh_share ?? 0);
  const chinese = restaurant * (pcn * d.s_cn + (1 - pcn) * d.s_other);
  const basis = p.demand_basis === 'restaurant_spend' ? restaurant : chinese;
  return { restaurant, chinese, cuisine: basis * p.cuisine_share, p_cn };
}

export function computeTradeArea(input: {
  rings: RingInput[];
  block_groups: BlockGroupInput[];
  params: TradeAreaParams;
}): TradeAreaResult {
  const { rings, block_groups, params } = input;
  const withGeom = block_groups.filter((b) => b.geometry);
  const demandByGeoid = new Map<string, BlockGroupDemand>();
  for (const bg of withGeom) {
    const d = computeBlockGroupDemand(bg, params);
    demandByGeoid.set(bg.geoid, {
      geoid: bg.geoid,
      centroid: centroid(bg.geometry!),
      cuisine_demand_usd: d.cuisine,
      chinese_spend_usd: d.chinese,
      restaurant_spend_usd: d.restaurant,
      pop: n(bg.pop),
      weightByRing: {},
    });
  }

  const outRings: Ring[] = [];
  let commute = { transit: 0, walk: 0, drove: 0, total: 0 };
  for (const ring of rings) {
    let pop = 0;
    let pop5 = 0;
    let hh = 0;
    let incomeHh = 0; // Σ hh × median_income
    let incomeHhBase = 0;
    let cn = 0;
    let cnPop = 0;
    let age = 0;
    let fam = 0;
    let renter = 0;
    let occupied = 0;
    let jobs = 0;
    let jobsSeen = false;
    let rest = 0;
    let chinese = 0;
    let cuisine = 0;
    let contributing = 0;
    let ct = { transit: 0, walk: 0, drove: 0, total: 0 };
    for (const bg of withGeom) {
      const w = areaShareInside(bg.geometry!, ring.geometry);
      if (w <= 0) continue;
      contributing++;
      const dem = demandByGeoid.get(bg.geoid)!;
      dem.weightByRing[ring.id] = w;
      pop += w * n(bg.pop);
      pop5 += w * n(bg.pop5plus);
      hh += w * n(bg.households);
      if (bg.median_income != null && n(bg.households) > 0) {
        incomeHh += w * n(bg.households) * bg.median_income;
        incomeHhBase += w * n(bg.households);
      }
      cn += w * n(bg.chinese_speakers);
      cnPop += w * n(bg.chinese_pop_est);
      age += w * n(bg.age_25_44);
      fam += w * n(bg.families_with_children);
      renter += w * n(bg.renter_households);
      occupied += w * n(bg.occupied_households);
      if (bg.jobs != null) {
        jobs += w * bg.jobs;
        jobsSeen = true;
      }
      rest += w * dem.restaurant_spend_usd;
      chinese += w * dem.chinese_spend_usd;
      cuisine += w * dem.cuisine_demand_usd;
      ct = {
        transit: ct.transit + w * n(bg.commute_transit),
        walk: ct.walk + w * n(bg.commute_walk),
        drove: ct.drove + w * n(bg.commute_drove_alone),
        total: ct.total + w * n(bg.commute_total),
      };
    }
    if (ring.id === 'drive10') commute = ct;
    const jobsValue = params.jobs_method === 'none' ? null : jobsSeen ? Math.round(jobs) : null;
    outRings.push({
      id: ring.id,
      method: ring.method,
      minutes: ring.minutes,
      radius_mi: ring.radius_mi,
      geometry: ring.geometry,
      area_sq_mi: Math.round((areaM2(ring.geometry) / 2_589_988) * 100) / 100,
      pop: contributing ? Math.round(pop) : null,
      hh: contributing ? Math.round(hh) : null,
      median_income: incomeHhBase > 0 ? Math.round(incomeHh / incomeHhBase) : null,
      chinese_hh_share: pop5 > 0 ? Math.round((cn / pop5) * 1000) / 1000 : pop > 0 && cnPop > 0 ? Math.round((cnPop / pop) * 1000) / 1000 : null,
      chinese_pop: contributing ? Math.round(cnPop) : null,
      age_25_44_share: pop > 0 ? Math.round((age / pop) * 1000) / 1000 : null,
      family_share: hh > 0 ? Math.round((fam / hh) * 1000) / 1000 : null,
      avg_hh_size: hh > 0 ? Math.round((pop / hh) * 100) / 100 : null,
      renter_share: occupied > 0 ? Math.round((renter / occupied) * 1000) / 1000 : null,
      jobs: jobsValue,
      jobs_method: jobsValue == null ? 'none' : params.jobs_method,
      restaurant_spend_usd: contributing ? Math.round(rest) : null,
      chinese_spend_usd: contributing ? Math.round(chinese) : null,
      cuisine_demand_usd: contributing ? Math.round(cuisine) : null,
      block_groups: contributing,
    });
  }

  return {
    primary_ring: primaryRingFor(params.range_class),
    rings: RING_ORDER.map((id) => outRings.find((r) => r.id === id)).filter((r): r is Ring => Boolean(r)),
    county_benchmark: params.county,
    isochrone_method: rings.every((r) => r.method === 'mapbox') ? 'mapbox' : 'radius',
    bg_demand: [...demandByGeoid.values()],
    commute_mix: {
      transit: ratio(commute.transit, commute.total),
      walk: ratio(commute.walk, commute.total),
      drove_alone: ratio(commute.drove, commute.total),
    },
    coverage: { bg_total: block_groups.length, bg_with_geometry: withGeom.length },
  };
}
