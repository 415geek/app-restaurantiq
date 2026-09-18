/**
 * Typed loader for the calibratable parameter tables (研发提示词 附录 A/B/C).
 * YAML is the source of truth so analysts can tune without touching code;
 * zod guarantees the engines never see a malformed table.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const band = z.tuple([z.number(), z.number(), z.number()]);

export const defaultsSchema = z.object({
  huff: z.object({
    alpha: z.number(),
    beta: z.object({ everyday: z.number(), regular: z.number(), destination: z.number() }),
    adjacent_weight: z.number(),
    default_speed_mph: z.number(),
  }),
  demand: z.object({
    s_cn: z.number(),
    s_other: z.number(),
    lunch_out_rate: z.number(),
    region_multiplier: z.number(),
    workdays_per_month: z.number(),
  }),
  review_to_covers: z.object({ k: z.number() }),
  cluster_score: z.object({ bands: z.array(band), coverage_adjust: z.number() }),
  void_analysis: z.object({
    min_chinese_pop_drive10: z.number(),
    density_ratio_threshold: z.number(),
    min_l2_count: z.number(),
  }),
  competitor_guard: z.object({
    min_metro_pois_for_zero_check: z.number(),
    min_food_pois_drive10: z.number(),
    min_pop_for_poi_check: z.number(),
  }),
  /**
   * §4.1 单一结论源: the ONE fixed-cost scale both finance engines read
   * (lib/iq/engines/finance.ts and lib/funnel/iq-finance-model.ts). Helpers live
   * in lib/iq/conclusion/cost-scale.ts; no engine may carry its own literals.
   */
  cost_scale: z.object({
    tiers: z.record(
      z.enum(['hcol', 'mcol', 'lcol']),
      z.object({ wage_usd_per_hour: z.number(), other_fixed_multiplier: z.number(), min_median_income: z.number() }),
    ),
    hcol_states: z.array(z.string()),
    labor: z.object({ hours_per_fte_month: z.number(), load_factor: z.number() }),
    split: z.object({ utilities: z.number(), insurance: z.number(), pos: z.number(), marketing: z.number() }),
    concepts: z.record(z.string(), z.object({ other_fixed_usd: z.number(), headcount: z.number() })),
  }),
  finance: z.object({
    safety_multiplier: z.number(),
    occupancy_cost_bands: z.array(band),
    days_open_per_month: z.number(),
    cc_fees_pct: z.number(),
    delivery_blended_pct: z.number(),
  }),
  score: z.object({
    weights: z.object({
      demand_coverage: z.number(),
      audience_fit: z.number(),
      competitive_position: z.number(),
      access_traffic: z.number(),
      financial_viability: z.number(),
      occasion_delivery: z.number(),
    }),
    coverage_bands: z.array(band),
    audience_thresholds: z.object({ destination: z.number(), regular: z.number(), everyday: z.number() }),
    quality_gap: z.object({ low_rating: z.number(), high_rating: z.number(), bonus: z.number() }),
    closure_penalty: z.object({ threshold: z.number(), penalty: z.number() }),
  }),
  confidence_weights: z.object({
    acs: z.number(),
    competitors: z.number(),
    traffic_proxy: z.number(),
    rent_comps: z.number(),
    daytime_pop: z.number(),
    transit: z.number(),
    dev_pipeline: z.number(),
    user_inputs: z.number(),
  }),
  verdict: z.object({ go: z.number(), conditional: z.number() }),
  rent_comps: z.object({ min_comps_for_premium: z.number() }),
  data_budget: z.object({
    google_places_max_calls: z.number(),
    /** 底层重构 §3.1: separate budget for truncation refinement (see defaults.yaml). */
    google_places_max_refine_calls: z.number().default(0),
    google_places_cost_usd_per_call: z.number(),
    /** §4.2 walking distance: Distance Matrix calls per report (≤ 25 destinations each). */
    distance_matrix_max_calls: z.number().default(4),
    /** Booked per origin×destination element once GOOGLE_PLACES_BILLED=1 (Google list price $5 / 1000). */
    distance_matrix_cost_usd_per_element: z.number().default(0.005),
    report_cost_cap_usd: z.number(),
    data_cost_cap_usd: z.number(),
  }),
  rings: z.record(
    z.string(),
    z.object({ mode: z.enum(['walking', 'driving']), minutes: z.number(), fallback_radius_mi: z.number() }),
  ),
});
export type Defaults = z.infer<typeof defaultsSchema>;

export const rangeClassSchema = z.enum(['everyday', 'regular', 'destination']);
export type RangeClass = z.infer<typeof rangeClassSchema>;

/**
 * Top-level concept categories (评审 Spec §4.1). Every taxonomy entry belongs to
 * exactly one; the classifier never falls silently into a default bucket.
 */
export const conceptCategorySchema = z.enum(['chinese_regional', 'chinese_format', 'asian_other', 'bakery_dessert', 'beverage', 'western_other']);
export type ConceptCategory = z.infer<typeof conceptCategorySchema>;
export const CONCEPT_CATEGORIES = conceptCategorySchema.options;

/** Which households the demand model draws from: Chinese-speaking households (中餐) or everyone (烘焙 / 饮品 / 西餐). */
export const audienceSchema = z.enum(['chinese', 'general']);
export type Audience = z.infer<typeof audienceSchema>;

export const daypartProfileSchema = z.enum(['lunch_dinner', 'dinner', 'all_day', 'morning_afternoon']);
export type DaypartProfile = z.infer<typeof daypartProfileSchema>;

/**
 * 评审 Spec §4.3 daypart 按业态取值 — the four dayparts every concept's demand is
 * split across. Order is the clock: 早市 → 午市 → 午后 → 晚市.
 */
export const DAYPART_IDS = ['breakfast', 'lunch', 'afternoon', 'dinner'] as const;
export type DaypartId = (typeof DAYPART_IDS)[number];

/** 时段占比之和必须为 1（±0.001）；否则参数表拒绝加载。 */
export const DAYPART_SUM_TOLERANCE = 0.001;

export const daypartsSchema = z
  .object({
    breakfast: z.number().min(0).max(1),
    lunch: z.number().min(0).max(1),
    afternoon: z.number().min(0).max(1),
    dinner: z.number().min(0).max(1),
  })
  .refine((d) => Math.abs(d.breakfast + d.lunch + d.afternoon + d.dinner - 1) <= DAYPART_SUM_TOLERANCE, {
    message: `dayparts must sum to 1 ± ${DAYPART_SUM_TOLERANCE} (breakfast + lunch + afternoon + dinner)`,
  });
export type Dayparts = z.infer<typeof daypartsSchema>;

export const cuisineSchema = z.object({
  id: z.string(),
  label_zh: z.string(),
  label_en: z.string(),
  label_es: z.string().optional(),
  range_class: rangeClassSchema,
  price_tier: z.enum(['$', '$$', '$$$', '$$$$']),
  ticket_in: z.number(),
  keywords: z.array(z.string()),
  mappings: z.array(z.string()),
  // ---- §4.1 downstream parameters (by concept, never by sqft) ----
  category: conceptCategorySchema.default('chinese_regional'),
  audience: audienceSchema.default('chinese'),
  /** Default full-time-equivalent headcount (e.g. 3–4 for an egg-tart bakery, 8–12 for hot pot). */
  fte_default: z.number().optional(),
  /** Share of orders that are takeout / delivery (0–1). */
  takeout_share: z.number().min(0).max(1).optional(),
  daypart_profile: daypartProfileSchema.optional(),
  /**
   * §4.3: the concept's own daypart distribution (早市 / 午市 / 午后 / 晚市, summing to 1).
   * THE demand model splits captured demand with this table — never with a
   * full-service lunch/dinner assumption, so an egg-tart bakery never prints 午市 0%.
   */
  dayparts: daypartsSchema,
  /** Google Places search profile for the three-layer competitor retrieval (§4.2). */
  search: z
    .object({
      /** Layer-1 keywords (subtype words), e.g. ["egg tart", "pastel de nata", "蛋挞"]. */
      keywords: z.array(z.string()),
      /** Places `type` values, e.g. ["bakery", "cafe"]. */
      types: z.array(z.string()),
      /** Layer-2 substitute keywords (same category, other subtypes). */
      substitutes: z.array(z.string()).default([]),
    })
    .optional(),
});
export type CuisineDef = z.infer<typeof cuisineSchema>;

export const taxonomySchema = z.object({
  cuisines: z.array(cuisineSchema).min(1),
  l3_types: z.array(z.string()),
  l4_anchors: z.object({
    grocery_types: z.array(z.string()),
    grocery_names: z.array(z.string()),
    other_types: z.array(z.string()),
    bank_types: z.array(z.string()),
    bank_names: z.array(z.string()),
    /**
     * §4.2 L4 anchors for `audience: general` concepts (bakery / beverage / western):
     * everyday footfall generators instead of Chinese grocers and banks. Places (New)
     * Table A types; default lives here so the YAML need not carry the key.
     */
    general_types: z
      .array(z.string())
      .default(['supermarket', 'grocery_store', 'school', 'university', 'transit_station', 'subway_station', 'train_station', 'corporate_office']),
  }),
});
export type Taxonomy = z.infer<typeof taxonomySchema>;

export const hubsSchema = z.object({
  metro: z.string(),
  hubs: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lng: z.number() })),
  metro_bbox: z.object({ min_lat: z.number(), min_lng: z.number(), max_lat: z.number(), max_lng: z.number() }),
});
export type Hubs = z.infer<typeof hubsSchema>;

const PARAMS_DIR = join(process.cwd(), 'lib', 'iq', 'params');

function loadYaml<T>(file: string, schema: z.ZodType<T>): T {
  const raw = parse(readFileSync(join(PARAMS_DIR, file), 'utf8'));
  return schema.parse(raw);
}

let defaultsCache: Defaults | null = null;
let taxonomyCache: Taxonomy | null = null;
let hubsCache: Hubs | null = null;

export function getDefaults(): Defaults {
  if (!defaultsCache) defaultsCache = loadYaml('defaults.yaml', defaultsSchema);
  return defaultsCache;
}

export function getTaxonomy(): Taxonomy {
  if (!taxonomyCache) taxonomyCache = loadYaml('cuisine_taxonomy.yaml', taxonomySchema);
  return taxonomyCache;
}

export function getHubs(): Hubs {
  if (!hubsCache) hubsCache = loadYaml('hubs.yaml', hubsSchema);
  return hubsCache;
}

/** Test hook: swap parameter tables (e.g. calibration runs). */
export function __setParamsForTests(p: { defaults?: Defaults; taxonomy?: Taxonomy; hubs?: Hubs }): void {
  if (p.defaults) defaultsCache = p.defaults;
  if (p.taxonomy) taxonomyCache = p.taxonomy;
  if (p.hubs) hubsCache = p.hubs;
}

export function cuisineById(id: string): CuisineDef {
  const t = getTaxonomy();
  return t.cuisines.find((c) => c.id === id) ?? t.cuisines.find((c) => c.id === 'other_chinese')!;
}

/** Exact lookup: `null` when the id is not a taxonomy entry (cuisineById falls back to other_chinese). */
export function findCuisine(id: string | null | undefined): CuisineDef | null {
  if (!id) return null;
  return getTaxonomy().cuisines.find((c) => c.id === id) ?? null;
}

export const CHINESE_CATEGORIES: readonly ConceptCategory[] = ['chinese_regional', 'chinese_format'];

export function isChineseCategory(category: ConceptCategory): boolean {
  return (CHINESE_CATEGORIES as readonly string[]).includes(category);
}

export function cuisinesInCategory(category: ConceptCategory): CuisineDef[] {
  return getTaxonomy().cuisines.filter((c) => c.category === category);
}

export type ClassifyScope = 'chinese' | 'all';

/**
 * Map free text (user input like "湘菜 Hunan restaurant", or a POI name /
 * category) to a taxonomy id.
 *
 *   scope 'chinese' (default) — the two Chinese categories only: the POI
 *     sub-cuisine keyword layer of engines/competitor.ts (§3.3), where a name
 *     hit assigns a Chinese sub-cuisine and non-Chinese places are typed by
 *     their `mappings` / the §4.2 search profile instead (a "Bakery" in the
 *     name must not pin a bakery to one bakery subtype).
 *   scope 'all' — every category: the concept classifier (§4.1 step 1,
 *     lib/iq/concept) and engines/cuisine-share.ts#conceptOfPoi.
 *
 * Returns `other_chinese` with `matched: null` when nothing matches so callers
 * always get a valid id — the concept classifier treats that as "unresolved".
 *
 * Longest keyword first ("Hot Pot" beats "Pot", "麻辣烫" beats "麻辣"); among
 * equal-length hits the one appearing earliest in the text wins, then the
 * taxonomy order ("葡挞、甜点" → egg_tart, not dessert).
 */
export function classifyCuisineText(text: string, opts: { scope?: ClassifyScope } = {}): { id: string; matched: string | null } {
  const t = getTaxonomy();
  const scope = opts.scope ?? 'chinese';
  const hay = text.toLowerCase();
  const hasCjk = /[一-鿿]/.test(hay);
  let best: { id: string; kw: string; len: number; at: number; order: number } | null = null;
  let order = 0;
  for (const c of t.cuisines) {
    if (scope === 'chinese' && !isChineseCategory(c.category)) continue;
    for (const kw of [...c.keywords, ...c.mappings]) {
      order++;
      const k = kw.toLowerCase();
      if (!k) continue;
      // Single CJK char keywords (川/湘/粤/台) are too ambiguous inside Latin text; require CJK context.
      if (k.length === 1 && !hasCjk) continue;
      const at = hay.indexOf(k);
      if (at < 0) continue;
      if (!best || k.length > best.len || (k.length === best.len && at < best.at)) best = { id: c.id, kw, len: k.length, at, order };
    }
  }
  return best ? { id: best.id, matched: best.kw } : { id: 'other_chinese', matched: null };
}

/** Label in the report language (`label_es` falls back to English). */
export function cuisineLabel(c: Pick<CuisineDef, 'label_zh' | 'label_en' | 'label_es'>, lang: 'en' | 'zh' | 'es'): string {
  return lang === 'zh' ? c.label_zh : lang === 'es' ? (c.label_es ?? c.label_en) : c.label_en;
}
