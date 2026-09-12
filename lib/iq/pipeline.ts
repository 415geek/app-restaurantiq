/**
 * runReport360 — data (D1–D12) → engines → report_model.json.
 *
 *   input → fetchAllData → TradeAreaEngine → CompetitorEngine → DemandEngine (Huff)
 *         → FinanceEngine → CuisineFitEngine (+ alternatives) → RiskEngine → ConfidenceEngine
 *         → report_model (zod-validated) — narrative + QA gates are applied by the caller
 *
 * Everything numeric in the report is produced here exactly once.
 */
import { circlePolygon, haversineM, pointInGeometry } from './geo';
import { fetchAllData, sourcesFromResults, type DataBundle, type Fetchers } from './data';
import { createFetchContext } from './data/context';
import { cexFafhForHousehold, CEX_2023_TABLE } from './data/cex';
import { fetchGeocode } from './data/geocode';
import { normalizeUserInputs, type RawSiteInput } from './data/user-inputs';
import type { FetchContext, Geometry, LatLng, SiteInput } from './data/types';
import { computeAudience } from './engines/audience';
import {
  applyLlmClassifications,
  clusterScoreFor,
  classifyCandidate,
  computeCompetitors,
  dedupeCandidates,
  normalizeName,
  type CandidatePoi,
  type CompetitorEngineResult,
  type LlmClassifier,
} from './engines/competitor';
import { computeConfidence, type SourceStatusMap } from './engines/confidence';
import { buildConditions, scoreDimensions, totalScore, verdictFor, type ScoreInput } from './engines/cuisine-fit';
import { computeCuisineShare } from './engines/cuisine-share';
import { computeHuff, type HuffCompetitor, type HuffResult } from './engines/demand-huff';
import { computeFinance } from './engines/finance';
import { computeRisks } from './engines/risk';
import { computeTradeArea, primaryRingFor, RING_ORDER, type BlockGroupInput, type RingInput, type TradeAreaResult } from './engines/trade-area';
import { parseReportModel, REPORT_ENGINE_VERSION, type Competitor, type ReportModel, type Ring, type RingId } from './model/schema';
import { classifySubCuisineBatch } from './narrative/llm';
import { cuisineById, getDefaults, getTaxonomy } from './params';

export interface Report360Options {
  ctx?: FetchContext;
  fetchers?: Partial<Fetchers>;
  /** Phase 3.3 layer 3; defaults to the provider router when a key exists. */
  llmClassify?: LlmClassifier | null;
  /** Skip alternative-cuisine ranking (tests / speed). */
  skipAlternatives?: boolean;
}

export interface Report360Result {
  model: ReportModel;
  bundle: DataBundle;
  ctx: FetchContext;
  intermediates: {
    trade_area: TradeAreaResult;
    competitors: CompetitorEngineResult;
    huff: HuffResult;
    cuisine_share: ReturnType<typeof computeCuisineShare>;
  };
}

const MI = 1_609.344;

function ringsFromBundle(bundle: DataBundle, site: LatLng): { rings: RingInput[]; method: 'mapbox' | 'radius' } {
  const iso = bundle.isochrones?.data;
  const d = getDefaults().rings;
  const rings: RingInput[] = RING_ORDER.map((id) => {
    const r = iso?.rings[id];
    if (r) return { id, geometry: r.geometry, method: r.method, minutes: r.minutes, radius_mi: r.radius_mi ?? null };
    const cfg = d[id];
    return { id, geometry: circlePolygon(site, cfg.fallback_radius_mi * MI, 64), method: 'radius', minutes: cfg.minutes, radius_mi: cfg.fallback_radius_mi };
  });
  return { rings, method: rings.every((r) => r.method === 'mapbox') ? 'mapbox' : 'radius' };
}

function blockGroupsFromBundle(bundle: DataBundle): { groups: BlockGroupInput[]; jobs_method: 'lodes_wac' | 'acs_b08301_estimate' | 'none'; asian_job_share: number | null } {
  const acs = bundle.acs?.data;
  if (!acs) return { groups: [], jobs_method: 'none', asian_job_share: null };
  const lodes = bundle.lodes?.data;
  const jobsByBg = new Map<string, number>();
  let asian = 0;
  let jobsTotal = 0;
  if (lodes && lodes.method === 'lodes_wac') {
    for (const b of lodes.by_block) {
      const bg = b.block_geoid.slice(0, 12);
      jobsByBg.set(bg, (jobsByBg.get(bg) ?? 0) + b.jobs);
      asian += b.asian;
      jobsTotal += b.jobs;
    }
  }
  const useLodes = lodes?.method === 'lodes_wac' && jobsByBg.size > 0;
  const groups: BlockGroupInput[] = acs.block_groups.map((b) => ({
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
    renter_households: b.renter_share != null && b.households != null ? b.renter_share * b.households : null,
    occupied_households: b.households,
    commute_total: b.commute.total,
    commute_transit: b.commute.transit,
    commute_walk: b.commute.walk,
    commute_drove_alone: b.commute.drove_alone,
    jobs: useLodes ? (jobsByBg.get(b.geoid) ?? 0) : b.commute.total,
  }));
  return {
    groups,
    jobs_method: useLodes ? 'lodes_wac' : lodes ? 'acs_b08301_estimate' : 'none',
    asian_job_share: jobsTotal > 0 ? asian / jobsTotal : null,
  };
}

/** Candidate pool radius (研发提示词 §3.1): max(3 mi, drive15). Text Search is only *biased* to 5 mi, so Google can return same-cuisine hits from across the metro. */
export const CANDIDATE_POOL_RADIUS_M = 5 * 1_609.344;

function candidatesFromBundle(bundle: DataBundle): CandidatePoi[] {
  const all = rawCandidatesFromBundle(bundle);
  const g = bundle.geocode.data;
  if (!g) return all;
  const site = { lat: g.lat, lng: g.lng };
  return all.filter((c) => haversineM(site, { lat: c.lat, lng: c.lng }) <= CANDIDATE_POOL_RADIUS_M);
}

/** The closest same-cuisine restaurant beyond the pool, so page 7 can say "none within 5 mi; nearest is X at N mi" instead of 未获取. */
function nearestSameCuisineOutsidePool(bundle: DataBundle, site: { lat: number; lng: number }, cuisine: string): { name: string; distance_mi: number } | null {
  let best: { name: string; distance_mi: number } | null = null;
  for (const c of rawCandidatesFromBundle(bundle)) {
    const d = haversineM(site, { lat: c.lat, lng: c.lng });
    if (d <= CANDIDATE_POOL_RADIUS_M) continue;
    if (/closed/i.test(c.operating_status)) continue;
    const k = classifyCandidate(c);
    if (!k.is_food || k.sub_cuisine !== cuisine) continue;
    const distance_mi = Math.round((d / 1_609.344) * 10) / 10;
    if (!best || distance_mi < best.distance_mi) best = { name: c.name, distance_mi };
  }
  return best;
}

function rawCandidatesFromBundle(bundle: DataBundle): CandidatePoi[] {
  const out: CandidatePoi[] = [];
  for (const p of bundle.overture?.data?.pois ?? []) {
    out.push({
      id: p.id,
      source: 'overture',
      name: p.name,
      name_zh: p.name_zh ?? null,
      lat: p.lat,
      lng: p.lng,
      categories: p.taxonomy_path,
      primary_category: p.primary_category,
      operating_status: p.operating_status || 'unknown',
      brand: p.brand,
      google_place_id: p.google_place_id,
      sub_cuisine: p.sub_cuisine,
      sub_cuisine_confidence: p.sub_cuisine_confidence,
      sub_cuisine_method: p.sub_cuisine ? 'rule' : null,
    });
  }
  for (const g of bundle.google?.data?.places ?? []) {
    out.push({
      id: g.id,
      source: 'google',
      name: g.name,
      lat: g.lat,
      lng: g.lng,
      categories: g.types,
      primary_category: g.primary_type,
      rating: g.rating,
      rating_count: g.user_rating_count,
      price_level: g.price_level,
      operating_status: g.business_status ?? 'unknown',
      hours_per_week: g.opening_hours_weekday ? estimateHoursPerWeek(g.opening_hours_weekday) : null,
    });
  }
  return out;
}

function estimateHoursPerWeek(lines: string[]): number | null {
  let total = 0;
  let n = 0;
  for (const l of lines) {
    const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(l);
    if (!m) {
      if (/closed/i.test(l)) n++;
      continue;
    }
    const to24 = (h: string, min: string | undefined, ap: string) => (Number(h) % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0) + (min ? Number(min) / 60 : 0);
    let hrs = to24(m[4], m[5], m[6]) - to24(m[1], m[2], m[3]);
    if (hrs <= 0) hrs += 24;
    total += hrs;
    n++;
  }
  return n ? Math.round(total) : null;
}

function huffCompetitorsOf(c: CompetitorEngineResult): HuffCompetitor[] {
  return [...c.l1, ...c.l2].map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, rating: x.rating, rating_count: x.rating_count, layer: x.layer as 'L1' | 'L2', drive_min: x.drive_min }));
}

function ringGeom(rings: RingInput[], id: RingId): Geometry {
  return rings.find((r) => r.id === id)!.geometry;
}

async function hubMedianDensity(ctx: FetchContext, metro: string | null, cuisine: string): Promise<number | null> {
  if (!metro) return null;
  const hit = await ctx.cache.get<{ median_density_per_10k_chinese: number }>('iq360_hub_density', `${metro}:${cuisine}`);
  return hit?.median_density_per_10k_chinese ?? null;
}

export async function runReport360(raw: RawSiteInput, opts: Report360Options = {}): Promise<Report360Result> {
  const t0 = Date.now();
  const ctx = opts.ctx ?? createFetchContext();
  const { input: site, result: userResult } = normalizeUserInputs(raw);
  const bundle = await fetchAllData(site, userResult, ctx, opts.fetchers);
  if (bundle.fatal || !bundle.geocode.data) throw new Error(bundle.fatal ?? 'geocode failed');
  const geo = bundle.geocode.data;
  const siteLL: LatLng = { lat: geo.lat, lng: geo.lng };
  const cu = cuisineById(site.cuisine);
  const d = getDefaults();

  // ── Trade area (Phase 2) ────────────────────────────────────────────────
  const { rings, method: isoMethod } = ringsFromBundle(bundle, siteLL);
  const { groups, jobs_method, asian_job_share } = blockGroupsFromBundle(bundle);
  const cex = bundle.cex?.data ?? CEX_2023_TABLE;
  const acsCounty = bundle.acs?.data?.county ?? null;
  const county = {
    chinese_hh_share: acsCounty && acsCounty.chinese_speakers != null && (acsCounty.pop5plus ?? 0) > 0 ? acsCounty.chinese_speakers / acsCounty.pop5plus! : null,
    median_income: acsCounty?.median_income ?? null,
  };

  // Competitors first (cuisine_share needs the supply mix).
  const candidates = candidatesFromBundle(bundle);
  const merged = dedupeCandidates(siteLL, candidates);
  // User-named direct competitors (D12 known_competitors): a Chinese-food candidate whose
  // name matches one of them and is still unclassified is read as the site's own sub-cuisine
  // — the user told us it is a direct competitor — so it lands in L1 instead of other_chinese.
  // "Unclassified" = no sub-cuisine yet, or the generic `other_chinese` bucket the category rule
  // assigns to any `chinese_restaurant` type (§3.3 "Chinese-but-unknown"). A specific rule/keyword
  // hit (e.g. "Hunan" in the name) or an LLM decision is never overridden.
  // Same normalized-substring rule as dedupeCandidates.
  if (site.known_competitors.length) {
    // CJK names are short ("湘水缘"), so the anti-false-positive length floor is script-aware.
    const longEnough = (s: string) => s.length >= (/[㐀-鿿]/.test(s) ? 2 : 4);
    const known = site.known_competitors.map(normalizeName).filter(longEnough);
    const matches = (n: string) => longEnough(n) && known.some((k) => n === k || n.includes(k) || k.includes(n));
    const unclassified = (m: (typeof merged)[number]) => !m.sub_cuisine || (m.sub_cuisine === 'other_chinese' && m.classified_by !== 'llm');
    for (const m of merged) {
      if (!m.is_food || !m.is_chinese || !unclassified(m)) continue;
      if (matches(normalizeName(m.name)) || (m.name_zh && matches(normalizeName(m.name_zh)))) {
        m.sub_cuisine = site.cuisine;
        m.classified_by = 'keyword';
      }
    }
  }
  const leftovers = merged.filter((m) => m.is_food && m.is_chinese && !m.sub_cuisine).map((m) => ({ id: m.id, name: m.name, categories: m.categories }));
  if (leftovers.length) {
    const classify: LlmClassifier | null =
      opts.llmClassify === undefined ? (items) => classifySubCuisineBatch(items, { cost: ctx.cost, env: ctx.env }) : opts.llmClassify;
    if (classify) {
      try {
        applyLlmClassifications(merged, await classify(leftovers));
      } catch (e) {
        ctx.log('[iq360] llm classify failed', e);
      }
    }
    // Whatever is still undecided is Chinese-but-unknown → other_chinese (§3.3).
    for (const m of merged) if (m.is_chinese && m.is_food && !m.sub_cuisine) m.sub_cuisine = 'other_chinese';
  }
  // Feed the pre-merged, classified list back as candidates so every downstream call shares one classification.
  const classifiedCandidates: CandidatePoi[] = merged.map((m) => ({ ...m, id: m.id, source: m.sources[0], sub_cuisine: m.sub_cuisine ?? null, sub_cuisine_method: m.classified_by === 'unclassified' ? null : m.classified_by }));

  const share = computeCuisineShare(merged, site.cuisine);
  const tradeArea = computeTradeArea({
    rings,
    block_groups: groups,
    params: {
      cuisine_share: share.share,
      range_class: cu.range_class,
      fafhForIncome: (inc) => cexFafhForHousehold(inc, cex).usd,
      jobs_method,
      county,
    },
  });
  const ringById = (id: RingId): Ring => tradeArea.rings.find((r) => r.id === id)!;
  const primary = ringById(tradeArea.primary_ring);
  const walk10 = ringById('walk10');

  // ── Competitors (Phase 3) ───────────────────────────────────────────────
  const traffic: Record<string, { tier: number | null; monthly_review_growth: number | null }> = {};
  for (const [pid, t] of Object.entries(bundle.traffic?.data?.per_place ?? {})) traffic[pid] = { tier: t.traffic_tier, monthly_review_growth: t.monthly_review_growth };
  const metroTotals = bundle.overture?.data?.metro_counts_by_sub_cuisine ?? {};
  const hubMedian = await hubMedianDensity(ctx, geo.metro, site.cuisine);
  const ticketIn = site.ticket_in ?? cu.ticket_in;
  const competitorInput = {
    site: siteLL,
    candidates: classifiedCandidates,
    rings: tradeArea.rings,
    walk10: ringGeom(rings, 'walk10'),
    drive10: ringGeom(rings, 'drive10'),
    traffic,
    ticket_in: ticketIn,
    target_price_level: cu.price_tier.length,
  };
  const competitors = computeCompetitors({
    ...competitorInput,
    cuisine: site.cuisine,
    metro_sub_cuisine_total: bundle.overture?.data?.loaded ? (metroTotals[site.cuisine] ?? 0) : null,
    hub_median_density_per_10k_chinese: hubMedian,
  });
  competitors.pool_radius_mi = Math.round((CANDIDATE_POOL_RADIUS_M / 1_609.344) * 10) / 10;
  competitors.l1_nearest_outside_pool = nearestSameCuisineOutsidePool(bundle, siteLL, site.cuisine);
  // Google-side failure with an empty pool is a pipeline failure, not "no competition" (R1).
  if (bundle.google?.status === 'failed' && (bundle.overture?.status === 'failed' || !bundle.overture?.data?.loaded)) {
    competitors.guard_notes.push(`竞品源不可用：D5 ${bundle.overture?.coverage_note ?? '—'}；D6 ${bundle.google?.coverage_note ?? '—'}`);
    competitors.guard_passed = false;
  }

  // ── Demand (Phase 2.4) ──────────────────────────────────────────────────
  const lunchTicket = Math.round(ticketIn * 0.75);
  const huff = computeHuff({
    site: siteLL,
    range_class: cu.range_class,
    competitors: huffCompetitorsOf(competitors),
    bg_demand: tradeArea.bg_demand,
    seats: site.seats,
    walk10: ringGeom(rings, 'walk10'),
    lunch: { jobs_walk10: walk10.jobs, asian_job_share, ticket_lunch: lunchTicket, chinese_share: primary.chinese_hh_share ?? county.chinese_hh_share ?? 0.1 },
  });

  // ── Finance (Phase 4.5) ─────────────────────────────────────────────────
  const finance = computeFinance({
    cuisine: site.cuisine,
    rent_usd: site.rent_usd,
    sqft: site.sqft,
    seats: site.seats,
    capex_usd: site.capex_usd,
    ticket_in: site.ticket_in,
    ticket_delivery: site.ticket_delivery,
    delivery_ratio: site.delivery_ratio,
    median_income: primary.median_income,
    state: geo.geography.state_abbr,
    rent_psf_comp: bundle.rent?.data?.comp_median_psf_month ?? null,
    captured_monthly_usd: huff.captured_monthly_usd,
  });
  const coverage_ratio = huff.captured_monthly_usd != null && finance.breakeven_monthly ? Math.round((huff.captured_monthly_usd / finance.breakeven_monthly) * 1000) / 1000 : null;
  competitors.cluster_score = clusterScoreFor(competitors.walk10_l1_l2_count, coverage_ratio);
  const captured_covers_day = huff.captured_monthly_usd != null ? Math.round(huff.captured_monthly_usd / ticketIn / d.finance.days_open_per_month) : null;
  const l1WithShare: Competitor[] = competitors.l1.map((c) => ({ ...c, huff_share: huff.competitor_shares[c.id] ?? null }));
  const l2WithShare: Competitor[] = competitors.l2.map((c) => ({ ...c, huff_share: huff.competitor_shares[c.id] ?? null }));

  // ── Access (Phase 2.5) ──────────────────────────────────────────────────
  const transit = bundle.transit?.data;
  const access: ReportModel['access'] = {
    transit: (transit?.rail_stations ?? []).map((s) => ({ system: s.system, name: s.name, distance_m: Math.round(s.distance_m), avg_weekday_exits: s.avg_weekday_exits })),
    aadt: (transit?.aadt ?? []).map((a) => ({ route: a.route, aadt: a.aadt, year: a.year, distance_m: Math.round(a.distance_m) })),
    parking: site.parking_spaces != null ? { spaces: site.parking_spaces, source: 'user_input' } : { spaces: null, source: 'none' },
    commute_mix: {
      transit: tradeArea.commute_mix.transit == null ? null : Math.round(tradeArea.commute_mix.transit * 1000) / 1000,
      walk: tradeArea.commute_mix.walk == null ? null : Math.round(tradeArea.commute_mix.walk * 1000) / 1000,
      drove_alone: tradeArea.commute_mix.drove_alone == null ? null : Math.round(tradeArea.commute_mix.drove_alone * 1000) / 1000,
    },
  };

  // ── Score (Phase 4.1) ───────────────────────────────────────────────────
  const scoreInputFor = (cuisineId: string, prim: Ring, comp: CompetitorEngineResult, hf: HuffResult, fin: ReportModel['finance'], cov: number | null): ScoreInput => {
    const c = cuisineById(cuisineId);
    const walkable = transit ? transit.rail_stations.some((s) => s.walkable) : null;
    const nearest = transit?.rail_stations.length ? Math.min(...transit.rail_stations.map((s) => s.distance_m)) : null;
    const delivery = comp.l1.filter((x) => x.offers_delivery != null);
    return {
      cuisine: cuisineId,
      range_class: c.range_class,
      coverage_ratio: cov,
      primary_ring: { chinese_hh_share: prim.chinese_hh_share, median_income: prim.median_income, family_share: prim.family_share, hh: prim.hh, area_sq_mi: prim.area_sq_mi },
      drive5: { hh: ringById('drive5').hh, area_sq_mi: ringById('drive5').area_sq_mi },
      jobs_walk10: walk10.jobs,
      competitors: {
        cluster_score: comp.cluster_score,
        walk10_l1_l2_count: comp.walk10_l1_l2_count,
        avg_rating_l1: comp.avg_rating_l1,
        closure_rate: comp.closure_rate,
        l1_delivery_share: delivery.length ? delivery.filter((x) => x.offers_delivery).length / delivery.length : null,
      },
      access: {
        walkable_rail: walkable,
        nearest_rail_m: nearest,
        max_aadt: access.aadt.length ? Math.max(...access.aadt.map((a) => a.aadt)) : null,
        parking: access.parking,
        transit_commute_share: access.commute_mix.transit,
      },
      finance: { occupancy_cost_ratio: fin.occupancy_cost_ratio, rent: fin.fixed_cost.rent, breakeven_monthly: fin.breakeven_monthly, safety_monthly: fin.safety_monthly, base_revenue: fin.scenarios.find((s) => s.id === 'base')?.monthly_revenue ?? null },
      demand: { captured_monthly_usd: hf.captured_monthly_usd, lunch_usd: hf.lunch_usd, dinner_usd: hf.dinner_usd },
    };
  };
  const scoreInput = scoreInputFor(site.cuisine, primary, competitors, huff, finance, coverage_ratio);
  const dims = scoreDimensions(scoreInput);
  const total = totalScore(dims);
  const conditions = buildConditions(dims, scoreInput);

  // ── Alternatives (Phase 4.2): same data, only cuisine-dependent pieces change ──
  const alternatives: ReportModel['score']['alternatives'] = [];
  if (!opts.skipAlternatives) {
    for (const alt of getTaxonomy().cuisines) {
      if (alt.id === site.cuisine) {
        alternatives.push({ cuisine: alt.id, label_zh: alt.label_zh, label_en: alt.label_en, total, verdict: verdictFor(total) });
        continue;
      }
      const altShare = computeCuisineShare(merged, alt.id).share;
      const altComp = computeCompetitors({ ...competitorInput, cuisine: alt.id, ticket_in: alt.ticket_in, target_price_level: alt.price_tier.length, metro_sub_cuisine_total: null, hub_median_density_per_10k_chinese: await hubMedianDensity(ctx, geo.metro, alt.id) });
      const altPrimary = ringById(primaryRingFor(alt.range_class));
      const altHuff = computeHuff({
        site: siteLL,
        range_class: alt.range_class,
        competitors: huffCompetitorsOf(altComp),
        bg_demand: tradeArea.bg_demand.map((b) => ({ ...b, cuisine_demand_usd: b.chinese_spend_usd * altShare })),
        seats: site.seats,
        walk10: ringGeom(rings, 'walk10'),
        lunch: { jobs_walk10: walk10.jobs, asian_job_share, ticket_lunch: Math.round(alt.ticket_in * 0.75), chinese_share: altPrimary.chinese_hh_share ?? county.chinese_hh_share ?? 0.1 },
      });
      const altFin = computeFinance({ cuisine: alt.id, rent_usd: site.rent_usd, sqft: site.sqft, seats: site.seats, capex_usd: site.capex_usd, ticket_in: null, ticket_delivery: null, delivery_ratio: site.delivery_ratio, median_income: altPrimary.median_income, state: geo.geography.state_abbr, rent_psf_comp: bundle.rent?.data?.comp_median_psf_month ?? null, captured_monthly_usd: altHuff.captured_monthly_usd });
      const altCov = altHuff.captured_monthly_usd != null && altFin.breakeven_monthly ? altHuff.captured_monthly_usd / altFin.breakeven_monthly : null;
      altComp.cluster_score = clusterScoreFor(altComp.walk10_l1_l2_count, altCov);
      const altDims = scoreDimensions(scoreInputFor(alt.id, altPrimary, altComp, altHuff, altFin, altCov));
      const altTotal = totalScore(altDims);
      alternatives.push({ cuisine: alt.id, label_zh: alt.label_zh, label_en: alt.label_en, total: altTotal, verdict: verdictFor(altTotal) });
    }
    alternatives.sort((a, b) => b.total - a.total);
  }
  const user_cuisine_rank = Math.max(1, alternatives.findIndex((a) => a.cuisine === site.cuisine) + 1);

  // ── Cannibalization (Phase 4.3) ─────────────────────────────────────────
  const cannibalization: ReportModel['score']['cannibalization'] = [];
  for (const store of site.existing_stores) {
    let ll: LatLng | null = store.lat != null && store.lng != null ? { lat: store.lat, lng: store.lng } : null;
    if (!ll) {
      const g = await fetchGeocode({ address: store.address }, ctx);
      if (g.data) ll = { lat: g.data.lat, lng: g.data.lng };
    }
    if (!ll) continue;
    const comps = huffCompetitorsOf(competitors);
    const before = computeHuff({ site: ll, range_class: cu.range_class, competitors: comps, bg_demand: tradeArea.bg_demand, seats: null, walk10: circlePolygon(ll, 800, 32), lunch: { jobs_walk10: null, asian_job_share: null, ticket_lunch: null, chinese_share: 0 } });
    const after = computeHuff({ site: ll, range_class: cu.range_class, competitors: [...comps, { id: 'new-site', lat: siteLL.lat, lng: siteLL.lng, rating: null, rating_count: 150, layer: 'L1', drive_min: null }], bg_demand: tradeArea.bg_demand, seats: null, walk10: circlePolygon(ll, 800, 32), lunch: { jobs_walk10: null, asian_job_share: null, ticket_lunch: null, chinese_share: 0 } });
    const b = before.dinner_usd ?? 0;
    const a = after.dinner_usd ?? 0;
    cannibalization.push({ store: store.address, diverted_share: b > 0 ? Math.round(((b - a) / b) * 1000) / 1000 : 0 });
  }

  // ── Risks, confidence, sources, meta ────────────────────────────────────
  const sources = sourcesFromResults(bundle.results);
  const statusMap: SourceStatusMap = {};
  for (const r of bundle.results) statusMap[r.id] = { status: r.status, coverage_note: r.coverage_note };
  const confidence = computeConfidence({ sources: statusMap, guard_passed: competitors.guard_passed, user: site });
  const precheck_reasons: string[] = [];
  if (!competitors.guard_passed) precheck_reasons.push(...competitors.guard_notes);
  if (confidence.total < 60) precheck_reasons.push(`置信度 ${confidence.total} < 60`);
  // Bootstrap mode (Overture not loaded yet): Google Places (New) alone is an
  // acceptable POI base when it returned a real pool (≥ 15 food POIs). Declared
  // in meta.degradations and on page 14 — never silent.
  const degradations: string[] = [];
  const overtureLoaded = Boolean(bundle.overture?.data?.loaded);
  const foodPool = merged.filter((m) => m.is_food).length;
  if (!overtureLoaded && (bundle.google?.status === 'ok' || bundle.google?.status === 'partial') && foodPool >= 15) {
    degradations.push(`overture_not_loaded_google_only:${foodPool}`);
  }
  for (const id of ['D1', 'D2', 'D5'] as const) {
    const s = statusMap[id];
    if (id === 'D5' && degradations.some((d) => d.startsWith('overture_not_loaded_google_only'))) continue;
    if (!s || s.status !== 'ok') precheck_reasons.push(`${id} 状态 ${s?.status ?? '缺失'}：${s?.coverage_note ?? ''}`);
  }

  const partial: Omit<ReportModel, 'risks'> = {
    meta: {
      report_id: site.report_id,
      generated_at: ctx.now().toISOString(),
      data_as_of: bundle.acs?.data ? `ACS ${bundle.acs.data.year} 5-year · Overture ${bundle.overture?.data?.release ?? '—'} · Google ${ctx.now().toISOString().slice(0, 10)}` : ctx.now().toISOString().slice(0, 10),
      tier: precheck_reasons.length ? 'precheck' : 'paid',
      engine_version: REPORT_ENGINE_VERSION,
      cost_usd: ctx.cost.total(),
      cost_breakdown: ctx.cost.bySource(),
      elapsed_ms: Date.now() - t0,
      language: site.language,
      precheck_reasons,
      degradations,
    },
    input: {
      address: site.address,
      matched_address: geo.matched_address,
      lat: geo.lat,
      lng: geo.lng,
      cuisine: site.cuisine,
      cuisine_label_zh: cu.label_zh,
      cuisine_label_en: cu.label_en,
      range_class: cu.range_class,
      rent_usd: site.rent_usd,
      sqft: site.sqft,
      seats: site.seats,
      capex_usd: site.capex_usd,
      ticket_in: site.ticket_in,
      ticket_delivery: site.ticket_delivery,
      delivery_ratio: site.delivery_ratio,
      parking_spaces: site.parking_spaces,
      existing_stores: site.existing_stores,
    },
    geo: {
      block: geo.geography.block,
      block_group: geo.geography.block_group,
      tract: geo.geography.tract,
      zcta: geo.geography.zcta,
      county: geo.geography.county,
      county_name: geo.geography.county_name,
      state: geo.geography.state,
      metro: geo.metro,
    },
    trade_area: { primary_ring: tradeArea.primary_ring, rings: tradeArea.rings, county_benchmark: county, isochrone_method: isoMethod },
    audience: computeAudience({ primary, walk10, county, lunch_usd: huff.lunch_usd, dinner_usd: huff.dinner_usd }),
    competitors: {
      guard_passed: competitors.guard_passed,
      guard_notes: competitors.guard_notes,
      candidates_total: competitors.candidates_total,
      l1: l1WithShare,
      l2: l2WithShare,
      l2_count: competitors.l2_count,
      l3_count: competitors.l3_count,
      l4: competitors.l4,
      walk10_l1_l2_count: competitors.walk10_l1_l2_count,
      density_per_10k_residents: competitors.density_per_10k_residents,
      density_per_10k_chinese: competitors.density_per_10k_chinese,
      hhi: competitors.hhi,
      avg_rating_l1: competitors.avg_rating_l1,
      weighted_rating_l1: competitors.weighted_rating_l1,
      price_ladder: competitors.price_ladder,
      closure_rate: competitors.closure_rate,
      cluster_score: competitors.cluster_score,
      benchmark_revenue_band: competitors.benchmark_revenue_band,
      void: competitors.void,
      metro_sub_cuisine_total: competitors.metro_sub_cuisine_total,
    },
    demand: {
      captured_monthly_usd: huff.captured_monthly_usd,
      captured_covers_day,
      lunch_usd: huff.lunch_usd,
      dinner_usd: huff.dinner_usd,
      coverage_ratio,
      by_ring: huff.by_ring,
      cuisine_share: share.share,
      cuisine_share_method: share.method,
      huff: huff.huff,
    },
    access,
    finance,
    score: { total, verdict: verdictFor(total), dimensions: dims, conditions, alternatives, user_cuisine_rank, cannibalization },
    confidence,
    sources,
    narrative: {},
  };
  const risks = computeRisks({ ...partial, dev_projects: bundle.dev?.data?.projects.length ?? 0 });
  const model = parseReportModel({ ...partial, risks });
  return { model, bundle, ctx, intermediates: { trade_area: tradeArea, competitors, huff, cuisine_share: share } };
}

/** Which ring a point falls in (smallest first) — used by renderers. */
export function ringOfPoint(rings: Ring[], p: LatLng): RingId | null {
  for (const id of RING_ORDER) {
    const r = rings.find((x) => x.id === id);
    if (r && pointInGeometry(p, r.geometry)) return id;
  }
  return null;
}

export { haversineM };
export type { SiteInput };
