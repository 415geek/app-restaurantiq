/**
 * CompetitorEngine (研发提示词 Phase 3).
 *
 * 3.1 candidate pool = Overture (open) ∪ Google, range max(3 mi, drive15)
 * 3.2 dedupe: normalized name + ≤100 m + same broad type → merge (keep both ids)
 * 3.3 classifier: rule (category mappings) → keyword (name) → LLM (injected, only for leftovers)
 * 3.4 layers L1 direct / L2 adjacent Chinese / L3 occasion substitutes / L4 traffic anchors
 * 3.5 metrics, 3.6 U-shaped cluster score, 3.7 void analysis, 3.9 data-integrity guard
 *
 * Pure: no I/O. The LLM classifier is an injected async function so the engine
 * stays deterministic in tests.
 */
import { haversineM, METERS_PER_MILE, pointInGeometry } from '../geo';
import type { Geometry, LatLng } from '../data/types';
import type { Competitor, Ring } from '../model/schema';
import { classifyCuisineText, cuisineById, getDefaults, getTaxonomy } from '../params';

export interface CandidatePoi {
  id: string;
  source: 'overture' | 'google';
  name: string;
  name_zh?: string | null;
  lat: number;
  lng: number;
  /** Overture taxonomy path / categories, or Google `types`. */
  categories: string[];
  primary_category: string | null;
  rating?: number | null;
  rating_count?: number | null;
  price_level?: number | null;
  operating_status: string; // open | closed_temporarily | closed_permanently | unknown | OPERATIONAL | CLOSED_PERMANENTLY
  brand?: string | null;
  hours_per_week?: number | null;
  /** Overture rows that were already linked to a Google place (iq_poi.google_place_id). */
  google_place_id?: string | null;
  /** Pre-classified (Phase 3.3 stored on iq_poi.sub_cuisine). */
  sub_cuisine?: string | null;
  sub_cuisine_confidence?: number | null;
  sub_cuisine_method?: 'rule' | 'keyword' | 'llm' | null;
}

export interface MergedPoi extends CandidatePoi {
  ids: { overture: string | null; google: string | null };
  sources: Array<'overture' | 'google'>;
  is_chinese: boolean;
  is_food: boolean;
  classified_by: 'rule' | 'keyword' | 'llm' | 'unclassified';
  distance_m: number;
}

export type LlmClassifier = (
  items: Array<{ id: string; name: string; categories: string[] }>,
) => Promise<Array<{ id: string; sub_cuisine: string; confidence: number; is_chain?: boolean; price_tier?: string }>>;

export interface CompetitorEngineInput {
  site: LatLng;
  cuisine: string; // taxonomy id
  candidates: CandidatePoi[];
  rings: Ring[];
  walk10: Geometry;
  drive10: Geometry;
  /** metro-wide count of POIs already classified as the input sub-cuisine (from iq_poi). */
  metro_sub_cuisine_total: number | null;
  /** hub median density (L1 per 10k Chinese residents) for the input cuisine; null when hubs not computed. */
  hub_median_density_per_10k_chinese: number | null;
  traffic: Record<string, { tier: number | null; monthly_review_growth: number | null }>;
  ticket_in: number;
  /** Google price-level of the user's target ticket (1..4). */
  target_price_level: number;
}

export interface CompetitorEngineResult {
  guard_passed: boolean;
  guard_notes: string[];
  candidates_total: number;
  merged: MergedPoi[];
  l1: Competitor[];
  l2: Competitor[];
  l2_count: number;
  l3_count: number;
  l4: Competitor[];
  walk10_l1_l2_count: number;
  density_per_10k_residents: number | null;
  density_per_10k_chinese: number | null;
  hhi: number | null;
  avg_rating_l1: number | null;
  weighted_rating_l1: number | null;
  price_ladder: Array<{ level: number; count: number }>;
  closure_rate: number | null;
  cluster_score: number;
  benchmark_revenue_band: { p25: number | null; median: number | null; p75: number | null; method: string };
  void: {
    is_void: boolean;
    reason: string;
    density_vs_hub_median: number | null;
    conditions: { chinese_pop_ok: boolean; density_ok: boolean; l2_ok: boolean };
  };
  metro_sub_cuisine_total: number | null;
  unclassified: Array<{ id: string; name: string; categories: string[] }>;
  chain_names: string[];
}

const CHINESE_IDS = new Set(getTaxonomy().cuisines.map((c) => c.id));

const FOOD_CATEGORY_RE = /restaurant|cafe|coffee|bakery|dessert|tea|boba|food|noodle|dim_sum|hot_pot|bbq|barbecue|takeout|meal|eatery|diner|bistro|pizza|sandwich|sushi|ramen/i;
const CHINESE_CATEGORY_RE = /chinese|cantonese|szechuan|sichuan|hunan|shanghai|taiwan|dim_sum|hot_pot|hotpot|noodle_house|bubble_tea|boba/i;
const NON_CHINESE_FOOD_RE = /japanese|korean|vietnamese|thai|indian|mexican|italian|american|french|mediterranean|pizza|burger|sandwich|sushi|ramen|pho|fast_food|hamburger|steak|seafood_restaurant|breakfast|brunch|bar_and_grill/i;
const CHAIN_RE = /panda express|p\.?f\.? chang|pei wei|din tai fung|haidilao|hai di lao|boiling point|xiao long kan|little sheep|happy lamb|85°c|85c|sharetea|gong cha|kung fu tea|tpumps|boba guys|t4|yifang|tiger sugar|chatime|coco fresh|hey tea|meet fresh|mr\. ?wish|joy luck|ranch 99|99 ranch/i;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(the|restaurant|cafe|kitchen|house|inc|llc|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isClosed(status: string): boolean {
  return /closed_permanently|CLOSED_PERMANENTLY/i.test(status);
}
function isTempClosed(status: string): boolean {
  return /closed_temporarily|CLOSED_TEMPORARILY/i.test(status);
}

/** 3.3 rule + keyword layers. Returns null when neither layer can decide. */
export function classifyCandidate(c: CandidatePoi): { sub_cuisine: string | null; method: 'rule' | 'keyword' | null; is_chinese: boolean; is_food: boolean } {
  const cats = [c.primary_category ?? '', ...c.categories].filter(Boolean).map((x) => x.toLowerCase());
  const catStr = cats.join(' ');
  const is_food = FOOD_CATEGORY_RE.test(catStr) || /[餐饭菜馆茶饮面粥粉]/.test(c.name);
  if (c.sub_cuisine && CHINESE_IDS.has(c.sub_cuisine)) {
    return { sub_cuisine: c.sub_cuisine, method: c.sub_cuisine_method === 'keyword' ? 'keyword' : 'rule', is_chinese: true, is_food: true };
  }
  const t = getTaxonomy();
  // Rule: explicit category mapping.
  for (const cu of t.cuisines) {
    if (cu.id === 'other_chinese') continue;
    if (cu.mappings.some((m) => cats.includes(m.toLowerCase()))) return { sub_cuisine: cu.id, method: 'rule', is_chinese: true, is_food: true };
  }
  // Keyword: name (CJK + Latin).
  const kw = classifyCuisineText(`${c.name} ${c.name_zh ?? ''}`);
  if (kw.matched) return { sub_cuisine: kw.id, method: 'keyword', is_chinese: true, is_food: true };
  // Category says Chinese but no finer keyword → other_chinese via rule.
  if (CHINESE_CATEGORY_RE.test(catStr)) return { sub_cuisine: 'other_chinese', method: 'rule', is_chinese: true, is_food: true };
  if (NON_CHINESE_FOOD_RE.test(catStr)) return { sub_cuisine: null, method: 'rule', is_chinese: false, is_food: true };
  // CJK name with generic restaurant category → probably Chinese but sub-cuisine unknown → leave for LLM.
  if (/[一-鿿]/.test(c.name) && is_food) return { sub_cuisine: null, method: null, is_chinese: true, is_food: true };
  return { sub_cuisine: null, method: null, is_chinese: false, is_food };
}

/** 3.2 merge Overture + Google records that are the same business. */
export function dedupeCandidates(site: LatLng, candidates: CandidatePoi[]): MergedPoi[] {
  const merged: MergedPoi[] = [];
  const isCjk = (s: string) => /[一-鿿]/.test(s) && !/[A-Za-z]{3,}/.test(s);
  for (const c of candidates) {
    const norm = normalizeName(c.name);
    const cls = classifyCandidate(c);
    const existing = merged.find((m) => {
      // 1) explicit link: Overture row already carries this Google place id (or vice versa)
      if (c.source === 'google' && m.ids.overture && m.google_place_id === c.id) return true;
      if (c.source === 'overture' && c.google_place_id && m.ids.google === c.google_place_id) return true;
      const dist = haversineM(m, c);
      if (dist > 100) return false;
      const mn = normalizeName(m.name);
      const nameMatch = mn === norm || (mn.length > 3 && norm.length > 3 && (mn.includes(norm) || norm.includes(mn)));
      if (nameMatch && m.is_food === cls.is_food) return true;
      // 2) same spot, one record named in Chinese and the other in English (Overture 湘园 vs Google
      //    "Xiang Yuan Hunan Cuisine"): same business, different script. Only for food POIs, ≤ 60 m,
      //    and only when the Chinese-named side has no Latin name of its own to compare.
      const cjkA = isCjk(m.name);
      const cjkB = isCjk(c.name);
      if (dist <= 60 && m.is_food && cls.is_food && cjkA !== cjkB) {
        const zhSide = cjkA ? m : c;
        const zhAlt = zhSide.name_zh ?? null;
        return zhAlt == null || normalizeName(zhAlt) === (cjkA ? norm : mn);
      }
      return false;
    });
    if (existing) {
      if (c.source === 'google') existing.ids.google = c.id;
      else existing.ids.overture = c.id;
      if (!existing.sources.includes(c.source)) existing.sources.push(c.source);
      // Google carries the fresher quality/status signal; Overture the taxonomy.
      if (c.source === 'google') {
        existing.rating = c.rating ?? existing.rating;
        existing.rating_count = c.rating_count ?? existing.rating_count;
        existing.price_level = c.price_level ?? existing.price_level;
        existing.hours_per_week = c.hours_per_week ?? existing.hours_per_week;
        if (c.operating_status && c.operating_status !== 'unknown') existing.operating_status = c.operating_status;
      }
      if (!existing.sub_cuisine && cls.sub_cuisine) {
        existing.sub_cuisine = cls.sub_cuisine;
        existing.classified_by = cls.method ?? 'rule';
        existing.is_chinese = true;
      }
      // Keep both scripts: Latin name as `name`, Chinese as `name_zh` (renderers show 中文 first).
      if (isCjk(existing.name) && !isCjk(c.name)) {
        existing.name_zh = existing.name_zh ?? existing.name;
        existing.name = c.name;
      } else if (!isCjk(existing.name) && isCjk(c.name) && !existing.name_zh) {
        existing.name_zh = c.name;
      }
      if (c.google_place_id && !existing.google_place_id) existing.google_place_id = c.google_place_id;
      continue;
    }
    merged.push({
      ...c,
      sub_cuisine: cls.sub_cuisine,
      ids: { overture: c.source === 'overture' ? c.id : null, google: c.source === 'google' ? c.id : null },
      sources: [c.source],
      is_chinese: cls.is_chinese,
      is_food: cls.is_food,
      classified_by: cls.method ?? 'unclassified',
      distance_m: haversineM(site, c),
    });
  }
  return merged;
}

/** Apply LLM decisions to leftovers (confidence < 0.6 → other_chinese per §3.3). */
export function applyLlmClassifications(
  merged: MergedPoi[],
  decisions: Array<{ id: string; sub_cuisine: string; confidence: number; is_chain?: boolean }>,
): void {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  for (const m of merged) {
    const d = byId.get(m.id);
    if (!d || m.sub_cuisine) continue;
    if (d.confidence < 0.6 || !CHINESE_IDS.has(d.sub_cuisine)) {
      if (m.is_chinese) {
        m.sub_cuisine = 'other_chinese';
        m.classified_by = 'llm';
      }
      continue;
    }
    m.sub_cuisine = d.sub_cuisine;
    m.sub_cuisine_confidence = d.confidence;
    m.classified_by = 'llm';
    m.is_chinese = true;
  }
}

function toCompetitor(m: MergedPoi, layer: Competitor['layer'], traffic: CompetitorEngineInput['traffic']): Competitor {
  const tr = traffic[m.ids.google ?? ''] ?? traffic[m.id];
  return {
    id: m.id,
    name: m.name,
    name_zh: m.name_zh ?? null,
    lat: m.lat,
    lng: m.lng,
    distance_mi: Math.round((m.distance_m / METERS_PER_MILE) * 100) / 100,
    drive_min: null,
    rating: m.rating ?? null,
    rating_count: m.rating_count ?? null,
    price_level: m.price_level ?? null,
    sub_cuisine: m.sub_cuisine ?? (m.is_chinese ? 'other_chinese' : 'non_chinese'),
    layer,
    is_chain: Boolean(m.brand) || CHAIN_RE.test(m.name),
    traffic_tier: (tr?.tier as Competitor['traffic_tier']) ?? null,
    monthly_review_growth: tr?.monthly_review_growth ?? null,
    huff_share: null,
    operating_status: m.operating_status,
    source: m.sources.length === 2 ? 'both' : m.sources[0],
    hours_per_week: m.hours_per_week ?? null,
    offers_delivery: null,
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function clusterScoreFor(count: number, coverageRatio: number | null): number {
  const cs = getDefaults().cluster_score;
  let base = cs.bands[cs.bands.length - 1][2];
  for (const [lo, hi, score] of cs.bands) {
    if (count >= lo && count <= hi) {
      base = score;
      break;
    }
  }
  if (coverageRatio == null) return base;
  const adj = coverageRatio >= 1.2 ? cs.coverage_adjust : coverageRatio < 0.8 ? -cs.coverage_adjust : 0;
  return Math.max(0, Math.min(100, base + adj));
}

export function computeCompetitors(input: CompetitorEngineInput): CompetitorEngineResult {
  const d = getDefaults();
  const t = getTaxonomy();
  const cu = cuisineById(input.cuisine);
  const merged = dedupeCandidates(input.site, input.candidates);
  const l3Types = new Set(t.l3_types.map((x) => x.toLowerCase()));
  const anchors = t.l4_anchors;

  const drive10 = input.rings.find((r) => r.id === 'drive10');
  const inDrive10 = (m: MergedPoi) => pointInGeometry(m, input.drive10);
  const inWalk10 = (m: MergedPoi) => pointInGeometry(m, input.walk10);

  const openFood = merged.filter((m) => m.is_food && !isClosed(m.operating_status));
  const closedChinese = merged.filter((m) => m.is_chinese && isClosed(m.operating_status) && inDrive10(m));

  const l1m = openFood.filter((m) => m.is_chinese && m.sub_cuisine === cu.id);
  const l2m = openFood.filter((m) => m.is_chinese && m.sub_cuisine !== cu.id);
  const l3m = openFood.filter((m) => {
    if (m.is_chinese) return false;
    if (!inWalk10(m)) return false;
    const cats = [m.primary_category ?? '', ...m.categories].map((x) => x.toLowerCase());
    const typeOk = cats.some((c) => l3Types.has(c));
    const priceOk = m.price_level == null || Math.abs(m.price_level - input.target_price_level) <= 1;
    return typeOk && priceOk;
  });
  const l4m = merged.filter((m) => {
    if (isClosed(m.operating_status)) return false;
    const cats = [m.primary_category ?? '', ...m.categories].map((x) => x.toLowerCase());
    const nameHit = (names: string[]) => names.some((n) => m.name.toLowerCase().includes(n.toLowerCase()));
    if (cats.some((c) => anchors.grocery_types.includes(c)) && (nameHit(anchors.grocery_names) || /[华亚超市]/.test(m.name))) return true;
    if (cats.some((c) => anchors.other_types.includes(c))) return true;
    if (cats.some((c) => anchors.bank_types.includes(c)) && nameHit(anchors.bank_names)) return true;
    return false;
  });

  const l1 = l1m.map((m) => toCompetitor(m, 'L1', input.traffic)).sort((a, b) => a.distance_mi - b.distance_mi);
  const l2 = l2m.map((m) => toCompetitor(m, 'L2', input.traffic)).sort((a, b) => a.distance_mi - b.distance_mi);
  const l4 = l4m.map((m) => toCompetitor(m, 'L4', input.traffic)).sort((a, b) => a.distance_mi - b.distance_mi);

  // 3.5 metrics
  const l1d10 = l1m.filter(inDrive10);
  const l2d10 = l2m.filter(inDrive10);
  const pop10 = drive10?.pop ?? null;
  const cn10 = drive10?.chinese_pop ?? null;
  const density_per_10k_residents = pop10 && pop10 > 0 ? Math.round(((l1d10.length + l2d10.length) / pop10) * 10_000 * 100) / 100 : null;
  const density_per_10k_chinese = cn10 && cn10 > 0 ? Math.round((l1d10.length / cn10) * 10_000 * 100) / 100 : null;

  const counts = l1m.map((m) => m.rating_count ?? 0).filter((x) => x > 0);
  const totalCounts = counts.reduce((s, x) => s + x, 0);
  const hhi = totalCounts > 0 ? Math.round(counts.reduce((s, x) => s + (x / totalCounts) ** 2, 0) * 10_000) / 10_000 : null;
  const ratings = l1m.map((m) => m.rating).filter((x): x is number => typeof x === 'number');
  const avg_rating_l1 = ratings.length ? Math.round((ratings.reduce((s, x) => s + x, 0) / ratings.length) * 100) / 100 : null;
  const wr = l1m.filter((m) => typeof m.rating === 'number' && (m.rating_count ?? 0) > 0);
  const wSum = wr.reduce((s, m) => s + (m.rating_count ?? 0), 0);
  const weighted_rating_l1 = wSum > 0 ? Math.round((wr.reduce((s, m) => s + (m.rating as number) * (m.rating_count ?? 0), 0) / wSum) * 100) / 100 : null;

  const ladderMap = new Map<number, number>();
  for (const m of [...l1m, ...l2m]) if (m.price_level != null) ladderMap.set(m.price_level, (ladderMap.get(m.price_level) ?? 0) + 1);
  const price_ladder = [1, 2, 3, 4].map((level) => ({ level, count: ladderMap.get(level) ?? 0 }));

  const chineseD10 = merged.filter((m) => m.is_chinese && inDrive10(m));
  const closure_rate = chineseD10.length ? Math.round((closedChinese.length / chineseD10.length) * 1000) / 1000 : null;

  // Benchmark revenue band (analog method): monthly review growth × k → covers → × ticket.
  const k = d.review_to_covers.k;
  const growthRev = l1
    .map((c) => (c.monthly_review_growth != null && c.monthly_review_growth > 0 ? c.monthly_review_growth * k * input.ticket_in : null))
    .filter((x): x is number => x != null);
  const benchmark_revenue_band = growthRev.length >= 3
    ? { p25: Math.round(quantile(growthRev, 0.25)!), median: Math.round(median(growthRev)!), p75: Math.round(quantile(growthRev, 0.75)!), method: `review_growth×k(${k})×ticket` }
    : { p25: null, median: null, p75: null, method: l1.some((c) => c.traffic_tier != null) ? 'relative_tier_only' : 'insufficient_history' };

  const walk10_l1_l2_count = [...l1m, ...l2m].filter(inWalk10).length;
  const cluster_score = clusterScoreFor(walk10_l1_l2_count, null);

  // 3.7 void analysis — all three conditions required.
  const va = d.void_analysis;
  const chinese_pop_ok = (cn10 ?? 0) >= va.min_chinese_pop_drive10;
  const density_vs_hub_median =
    density_per_10k_chinese != null && input.hub_median_density_per_10k_chinese != null && input.hub_median_density_per_10k_chinese > 0
      ? Math.round((density_per_10k_chinese / input.hub_median_density_per_10k_chinese) * 100) / 100
      : null;
  const density_ok = density_vs_hub_median != null && density_vs_hub_median < va.density_ratio_threshold;
  const l2_ok = l2d10.length >= va.min_l2_count;
  const is_void = chinese_pop_ok && density_ok && l2_ok;
  const reason = is_void
    ? `drive10 华裔居民 ${cn10} ≥ ${va.min_chinese_pop_drive10}；密度为枢纽中位数的 ${Math.round((density_vs_hub_median ?? 0) * 100)}%；L2 ${l2d10.length} 家`
    : `未满足品类缺口三条件（只可写「该品类供给较少」）：华裔人口${chinese_pop_ok ? '达标' : '不足'}、密度对标${density_vs_hub_median == null ? '缺失' : density_ok ? '达标' : '未低于 50%'}、L2 ${l2d10.length} 家${l2_ok ? '' : '（< ' + va.min_l2_count + '）'}`;

  // 3.9 guard
  const g = d.competitor_guard;
  const guard_notes: string[] = [];
  const foodD10 = openFood.filter(inDrive10).length;
  if ((input.metro_sub_cuisine_total ?? 0) >= g.min_metro_pois_for_zero_check && l1d10.length + l2d10.length === 0) {
    guard_notes.push(`竞品抓取异常：metro 内该子菜系 POI ${input.metro_sub_cuisine_total} 家，但 drive10 内 L1+L2 = 0`);
  }
  if (foodD10 < g.min_food_pois_drive10 && (pop10 ?? 0) > g.min_pop_for_poi_check) {
    guard_notes.push(`POI 覆盖异常：drive10 内餐饮 POI ${foodD10} < ${g.min_food_pois_drive10}，而圈层人口 ${Math.round(pop10 ?? 0)}`);
  }
  if (input.candidates.length === 0) guard_notes.push('候选池为空：Overture 与 Google 均未返回记录');

  const unclassified = merged
    .filter((m) => m.is_food && m.is_chinese && !m.sub_cuisine)
    .map((m) => ({ id: m.id, name: m.name, categories: m.categories }));

  return {
    guard_passed: guard_notes.length === 0,
    guard_notes,
    candidates_total: input.candidates.length,
    merged,
    l1,
    l2,
    l2_count: l2.length,
    l3_count: l3m.length,
    l4,
    walk10_l1_l2_count,
    density_per_10k_residents,
    density_per_10k_chinese,
    hhi,
    avg_rating_l1,
    weighted_rating_l1,
    price_ladder,
    closure_rate,
    cluster_score,
    benchmark_revenue_band,
    void: { is_void, reason, density_vs_hub_median, conditions: { chinese_pop_ok, density_ok, l2_ok } },
    metro_sub_cuisine_total: input.metro_sub_cuisine_total,
    unclassified,
    chain_names: [...l1, ...l2].filter((c) => c.is_chain).map((c) => c.name),
  };
}

export { isClosed, isTempClosed };
