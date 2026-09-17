/**
 * DemandEngine — Huff gravity capture (研发提示词 Phase 2.4).
 *
 *   P_ij = A_j^α · d_ij^(−β) / Σ_k A_k^α · d_ik^(−β)
 *   A_k  = log(1 + rating_count_k) × (rating_k / 4.2)
 *   A_j  = median A of direct (L1) competitors; scaled by seats / median seats when given
 *   d    = drive minutes (straight-line / default_speed_mph when no matrix)
 *
 *   captured_j = Σ_i cuisine_demand_i × P_ij            (resident pool, all BGs)
 *              + lunch_demand × P_lunch                 (walk10 workplace pool, walk10 competitor set only)
 *
 *   lunch_demand = jobs_walk10 × lunch_out_rate × audience_share × asian_adj × ticket_lunch × workdays
 *     audience_share = Chinese-speaking share of the primary ring for a 中餐 concept, or the
 *     concept's category share for a general-audience concept (asian_adj = 1 then);
 *     `daypart_profile: dinner` concepts (hot pot, skewers) have no lunch pool.
 *
 * 评审 Spec §4.3 daypart 按业态取值 — the split is four dayparts, not lunch/dinner:
 *   resident pool  → split by the concept's own `dayparts` table (早市 / 午市 / 午后 / 晚市),
 *                    i.e. breakfast and afternoon draw on residents and passers-by exactly as
 *                    dinner does, weighted by what the concept actually sells at that hour;
 *   workplace pool → added to the 午市 daypart only (it is a jobs pool, by construction).
 * The captured total is unchanged (resident + workplace); only its distribution across the
 * day is now concept-specific, so a bakery never reports 午市 0% / 晚市 100%.
 *
 * The site competes with L1 (weight 1) and L2 (weight adjacent_weight) for each
 * block group's demand. Everything is a pure function of explicit inputs.
 */
import { haversineM, METERS_PER_MILE, pointInGeometry } from '../geo';
import type { Geometry, LatLng } from '../data/types';
import type { RingId } from '../model/schema';
import { DAYPART_IDS, getDefaults, type Audience, type DaypartId, type DaypartProfile, type Dayparts, type RangeClass } from '../params';
import type { BlockGroupDemand } from './trade-area';

export interface HuffCompetitor {
  id: string;
  lat: number;
  lng: number;
  rating: number | null;
  rating_count: number | null;
  layer: 'L1' | 'L2';
  drive_min: number | null;
}

export interface HuffInput {
  site: LatLng;
  range_class: RangeClass;
  competitors: HuffCompetitor[];
  bg_demand: BlockGroupDemand[];
  seats: number | null;
  /** Typical seats for the cuisine's L1 set when known; else 60. */
  median_seats?: number;
  walk10: Geometry;
  /**
   * `chinese_share` is the share of the walk10 workforce in the concept's audience: Chinese-speaking share
   * for a 中餐 concept, the category share for a general-audience concept (see lunchAudienceFor).
   */
  lunch: { jobs_walk10: number | null; asian_job_share: number | null; ticket_lunch: number | null; chinese_share: number };
  /**
   * §4.3: the concept's own daypart distribution. The resident pool is split with it;
   * omitted only by callers that do not report a daypart mix (cannibalisation probes),
   * which then fall back to the neutral lunch/dinner split below.
   */
  dayparts?: Dayparts;
  ring_of_bg?: (geoid: string) => RingId | null;
}

/**
 * Fallback when a caller has no concept in hand (cannibalisation probes): the historical
 * full-service basis, kept explicit so nothing silently re-introduces 午市 0% for a bakery.
 */
export const NEUTRAL_DAYPARTS: Dayparts = { breakfast: 0, lunch: 0.4, afternoon: 0.05, dinner: 0.55 };

/**
 * Lunch-pool audience inputs by concept (评审 Spec §4.1 step 4): a 中餐 concept draws on the Chinese-speaking
 * share of the workforce (with the Asian-jobs adjustment); a general-audience concept draws on everyone,
 * weighted by its category share; a dinner-only format has no lunch pool.
 */
export function lunchAudienceFor(
  concept: { audience: Audience; daypart_profile?: DaypartProfile },
  p: { chinese_share: number; asian_job_share: number | null; concept_share: number; ticket_lunch: number | null },
): { asian_job_share: number | null; ticket_lunch: number | null; chinese_share: number } {
  if (concept.daypart_profile === 'dinner') return { asian_job_share: null, ticket_lunch: null, chinese_share: 0 };
  if (concept.audience === 'general') return { asian_job_share: null, ticket_lunch: p.ticket_lunch, chinese_share: p.concept_share };
  return { asian_job_share: p.asian_job_share, ticket_lunch: p.ticket_lunch, chinese_share: p.chinese_share };
}

/** §4.3 one daypart of the captured demand: its share of the day and the dollars behind it. */
export interface DaypartCapture {
  id: DaypartId;
  share: number;
  monthly_usd: number;
}

export interface HuffResult {
  captured_monthly_usd: number | null;
  captured_covers_day: number | null;
  /** 午市 daypart total (resident 午市 slice + the walk10 workplace pool). */
  lunch_usd: number | null;
  /** 晚市 daypart total. */
  dinner_usd: number | null;
  /** §4.3 all four dayparts, always in clock order; empty when nothing could be captured. */
  dayparts: DaypartCapture[];
  /** Resident (block-group) pool before the daypart split, monthly. */
  resident_usd: number | null;
  /** walk10 workplace lunch pool captured, monthly — the only part that is not resident demand. */
  workplace_lunch_usd: number | null;
  by_ring: Array<{ ring: RingId; monthly_usd: number; share: number }>;
  huff: { alpha: number; beta: number; site_attractiveness: number | null; competitor_set: number };
  competitor_shares: Record<string, number>; // share of the site's own captured demand diverted per competitor, for cards
  p_distribution: { min: number; median: number; max: number } | null;
}

export function attractiveness(c: { rating: number | null; rating_count: number | null }): number {
  const cnt = c.rating_count ?? 0;
  const rating = c.rating ?? 4.2;
  return Math.log(1 + cnt) * (rating / 4.2);
}

function driveMinutes(a: LatLng, b: LatLng, speedMph: number): number {
  const miles = haversineM(a, b) / METERS_PER_MILE;
  // Straight-line → road distance factor 1.3; never below 1 minute.
  return Math.max(1, (miles * 1.3 * 60) / speedMph);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeHuff(input: HuffInput): HuffResult {
  const d = getDefaults();
  const alpha = d.huff.alpha;
  const beta = d.huff.beta[input.range_class];
  const speed = d.huff.default_speed_mph;

  const l1 = input.competitors.filter((c) => c.layer === 'L1');
  const aValues = l1.map(attractiveness).filter((a) => a > 0);
  let siteA = median(aValues);
  if (siteA == null) siteA = input.competitors.length ? median(input.competitors.map(attractiveness)) : null;
  if (siteA == null) siteA = Math.log(1 + 150) * 1; // cold-start prior: a 150-review 4.2★ restaurant
  const medianSeats = input.median_seats ?? 60;
  if (input.seats && input.seats > 0) siteA = siteA * (input.seats / medianSeats);

  const compTerms = input.competitors.map((c) => ({
    c,
    a: Math.pow(attractiveness(c), alpha) * (c.layer === 'L2' ? d.huff.adjacent_weight : 1),
    pos: { lat: c.lat, lng: c.lng },
  }));

  const shareAccum: Record<string, number> = {};
  const pValues: number[] = [];
  let residentAnnual = 0;
  const ringAnnual: Partial<Record<RingId, number>> = {};

  for (const bg of input.bg_demand) {
    if (bg.cuisine_demand_usd <= 0) continue;
    const dSite = driveMinutes(bg.centroid, input.site, speed);
    const siteTerm = Math.pow(siteA, alpha) * Math.pow(dSite, -beta);
    let denom = siteTerm;
    const compTerm: number[] = [];
    for (const t of compTerms) {
      const dk = t.c.drive_min ?? driveMinutes(bg.centroid, t.pos, speed);
      const term = t.a * Math.pow(Math.max(1, dk), -beta);
      compTerm.push(term);
      denom += term;
    }
    const p = denom > 0 ? siteTerm / denom : 0;
    pValues.push(p);
    const captured = bg.cuisine_demand_usd * p;
    residentAnnual += captured;
    // Diversion: how much of this BG's demand goes to each competitor (for cards).
    compTerms.forEach((t, idx) => {
      shareAccum[t.c.id] = (shareAccum[t.c.id] ?? 0) + bg.cuisine_demand_usd * (compTerm[idx] / denom);
    });
    const ringId = input.ring_of_bg?.(bg.geoid) ?? ringFromWeights(bg.weightByRing);
    if (ringId) ringAnnual[ringId] = (ringAnnual[ringId] ?? 0) + captured;
  }

  // 午市 workplace pool: walk10 jobs demand shared with the walk10 competitor set only.
  let workplaceLunchMonthly: number | null = null;
  const L = input.lunch;
  if (L.jobs_walk10 != null && L.ticket_lunch != null && L.ticket_lunch > 0) {
    const asianAdj = L.asian_job_share != null ? Math.min(1.5, 0.5 + L.asian_job_share * 2) : 1;
    const lunchPool = L.jobs_walk10 * d.demand.lunch_out_rate * L.chinese_share * asianAdj * L.ticket_lunch * d.demand.workdays_per_month;
    const walkComps = compTerms.filter((t) => pointInGeometry(t.pos, input.walk10));
    const siteTerm = Math.pow(siteA, alpha);
    const denom = siteTerm + walkComps.reduce((s, t) => s + t.a, 0);
    const pLunch = denom > 0 ? siteTerm / denom : 0;
    workplaceLunchMonthly = lunchPool * pLunch;
  }

  const residentMonthly = input.bg_demand.length ? residentAnnual / 12 : null;
  const capturedMonthly =
    residentMonthly == null && workplaceLunchMonthly == null ? null : (residentMonthly ?? 0) + (workplaceLunchMonthly ?? 0);

  // §4.3: split the resident pool by the concept's own daypart table, then add the
  // workplace pool to 午市 — that pool is by construction a lunch-hour jobs pool.
  const profile = input.dayparts ?? NEUTRAL_DAYPARTS;
  const resident = residentMonthly ?? 0;
  const perDaypart: Record<DaypartId, number> = {
    breakfast: resident * profile.breakfast,
    lunch: resident * profile.lunch + (workplaceLunchMonthly ?? 0),
    afternoon: resident * profile.afternoon,
    dinner: resident * profile.dinner,
  };
  const daypartTotal = DAYPART_IDS.reduce((s, id) => s + perDaypart[id], 0);
  const dayparts: DaypartCapture[] =
    capturedMonthly == null
      ? []
      : DAYPART_IDS.map((id) => ({
          id,
          share: daypartTotal > 0 ? Math.round((perDaypart[id] / daypartTotal) * 1000) / 1000 : 0,
          monthly_usd: Math.round(perDaypart[id]),
        }));

  const totalAnnualRing = Object.values(ringAnnual).reduce((s, v) => s + (v ?? 0), 0);
  const by_ring = (Object.entries(ringAnnual) as Array<[RingId, number]>)
    .map(([ring, v]) => ({ ring, monthly_usd: Math.round(v / 12), share: totalAnnualRing > 0 ? Math.round((v / totalAnnualRing) * 1000) / 1000 : 0 }))
    .sort((a, b) => b.monthly_usd - a.monthly_usd);

  const totalDiverted = Object.values(shareAccum).reduce((s, v) => s + v, 0) + residentAnnual;
  const competitor_shares: Record<string, number> = {};
  for (const [id, v] of Object.entries(shareAccum)) competitor_shares[id] = totalDiverted > 0 ? Math.round((v / totalDiverted) * 1000) / 1000 : 0;

  const sortedP = [...pValues].sort((a, b) => a - b);
  return {
    captured_monthly_usd: capturedMonthly == null ? null : Math.round(capturedMonthly),
    captured_covers_day: null, // filled by the pipeline once the ticket is known (÷ ticket ÷ days_open)
    lunch_usd: capturedMonthly == null ? null : Math.round(perDaypart.lunch),
    dinner_usd: capturedMonthly == null ? null : Math.round(perDaypart.dinner),
    dayparts,
    resident_usd: residentMonthly == null ? null : Math.round(residentMonthly),
    workplace_lunch_usd: workplaceLunchMonthly == null ? null : Math.round(workplaceLunchMonthly),
    by_ring,
    huff: { alpha, beta, site_attractiveness: Math.round(siteA * 1000) / 1000, competitor_set: input.competitors.length },
    competitor_shares,
    p_distribution: sortedP.length
      ? { min: sortedP[0], median: sortedP[Math.floor(sortedP.length / 2)], max: sortedP[sortedP.length - 1] }
      : null,
  };
}

/** Smallest ring that fully (≥50 %) contains the block group, for the by-ring stack. */
function ringFromWeights(w: Partial<Record<RingId, number>>): RingId | null {
  for (const id of ['walk10', 'drive5', 'drive10', 'drive15'] as RingId[]) {
    if ((w[id] ?? 0) >= 0.5) return id;
  }
  const any = (['drive15', 'drive10', 'drive5', 'walk10'] as RingId[]).find((id) => (w[id] ?? 0) > 0);
  return any ?? null;
}
