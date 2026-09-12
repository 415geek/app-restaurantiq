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
    google_places_cost_usd_per_call: z.number(),
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

export const cuisineSchema = z.object({
  id: z.string(),
  label_zh: z.string(),
  label_en: z.string(),
  range_class: rangeClassSchema,
  price_tier: z.enum(['$', '$$', '$$$', '$$$$']),
  ticket_in: z.number(),
  keywords: z.array(z.string()),
  mappings: z.array(z.string()),
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

/**
 * Map free text (user input like "湘菜 Hunan restaurant", or a POI name /
 * category) to a taxonomy id. Rule layer of the Phase 3 classifier; also used
 * to normalize the user's cuisine field. Returns `other_chinese` when nothing
 * matches so callers always get a valid id.
 */
export function classifyCuisineText(text: string): { id: string; matched: string | null } {
  const t = getTaxonomy();
  const hay = text.toLowerCase();
  // Longest keyword first so "Hot Pot" beats "Pot", "麻辣烫" beats "麻辣".
  const candidates: Array<{ id: string; kw: string }> = [];
  for (const c of t.cuisines) {
    for (const kw of [...c.keywords, ...c.mappings]) candidates.push({ id: c.id, kw });
  }
  candidates.sort((a, b) => b.kw.length - a.kw.length);
  for (const { id, kw } of candidates) {
    const k = kw.toLowerCase();
    if (!k) continue;
    // Single CJK char keywords (川/湘/粤/台) are too ambiguous inside Latin text; require CJK context.
    if (k.length === 1) {
      if (hay.includes(k) && /[一-鿿]/.test(hay)) return { id, matched: kw };
      continue;
    }
    if (hay.includes(k)) return { id, matched: kw };
  }
  return { id: 'other_chinese', matched: null };
}
