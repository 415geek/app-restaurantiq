/**
 * report_model.json — the single source of truth for every number in the
 * paid report (研发提示词 附录 D, extended with the fields the engines need).
 *
 * Rules enforced here and in lib/iq/qa/gates.ts:
 * - every figure the report shows exists in this document exactly once
 * - missing data is `null` (rendered as 「未获取」), never an estimate
 * - narrative is generated FROM this document and may only cite its fields
 */
import { z } from 'zod';
import { conclusionSchema } from '../conclusion/schema';
import { reconcileModelToConclusion } from '../conclusion/reconcile';

export const nullableNum = z.number().nullable();

export const sourceRowSchema = z.object({
  id: z.string(), // D1..D12
  name: z.string(),
  status: z.enum(['ok', 'partial', 'failed']),
  fetched_at: z.string(),
  coverage_note: z.string(),
  license: z.string(),
  cost_usd: z.number(),
  source: z.string(),
  degraded_from: z.string().optional(),
});
export type SourceRow = z.infer<typeof sourceRowSchema>;

export const ringIdSchema = z.enum(['walk10', 'drive5', 'drive10', 'drive15']);
export type RingId = z.infer<typeof ringIdSchema>;

export const geometrySchema = z.union([
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))),
  }),
]);

export const ringSchema = z.object({
  id: ringIdSchema,
  method: z.enum(['mapbox', 'radius']),
  minutes: z.number(),
  radius_mi: nullableNum,
  geometry: geometrySchema,
  area_sq_mi: z.number(),
  pop: nullableNum,
  hh: nullableNum,
  median_income: nullableNum, // household-weighted
  chinese_hh_share: nullableNum, // C16001 Chinese-speaker share (proxy, see D2)
  chinese_pop: nullableNum,
  age_25_44_share: nullableNum,
  family_share: nullableNum,
  avg_hh_size: nullableNum,
  renter_share: nullableNum,
  jobs: nullableNum,
  jobs_method: z.enum(['lodes_wac', 'acs_b08301_estimate', 'none']),
  restaurant_spend_usd: nullableNum, // annual
  chinese_spend_usd: nullableNum, // annual
  cuisine_demand_usd: nullableNum, // annual, for input cuisine
  block_groups: z.number(), // count contributing
});
export type Ring = z.infer<typeof ringSchema>;

export const competitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_zh: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  distance_mi: z.number(),
  drive_min: nullableNum,
  rating: nullableNum,
  rating_count: nullableNum,
  price_level: nullableNum,
  sub_cuisine: z.string(),
  layer: z.enum(['L1', 'L2', 'L3', 'L4']),
  is_chain: z.boolean(),
  traffic_tier: z.number().int().min(1).max(5).nullable(),
  monthly_review_growth: nullableNum,
  huff_share: nullableNum,
  operating_status: z.string(),
  source: z.enum(['overture', 'google', 'both']),
  hours_per_week: nullableNum,
  offers_delivery: z.boolean().nullable(),
  /** §4.2 walking network distance (Distance Matrix), metres; when present `distance_mi` is the walking distance. */
  walk_m: nullableNum.optional(),
  walk_min: nullableNum.optional(),
});
export type Competitor = z.infer<typeof competitorSchema>;

/** §4.2 Layer 3 品牌锚点: city-wide brand benchmarks (≥ 500 reviews) — never counted in density / cluster / Huff / coverage. */
export const brandAnchorSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_zh: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  /** Straight-line distance from the site. */
  distance_mi: z.number(),
  rating: nullableNum,
  rating_count: nullableNum,
  price_level: nullableNum,
  primary_type: z.string().nullable(),
  /** True when the anchor is also inside Layer 1 / 2 (shown on a card as well). */
  in_trade_area: z.boolean(),
});
export type BrandAnchor = z.infer<typeof brandAnchorSchema>;

/**
 * 评审 Spec §4.4 计数单一化: the ONE set of competitor counts every surface
 * prints (page 7 / 8, the dashboard, the confidence section, the provenance
 * table, the funnel metrics digest). No module re-counts and no narrative may
 * restate a competitor number that is not one of these fields.
 *
 * `total` = direct + same_category — the competitive set. Layer-3 occasion
 * substitutes (`l3`) and city-wide brand anchors (`anchors`) are reported
 * separately and are NEVER inside `total`.
 */
export const competitorCountsSchema = z.object({
  total: z.number(),
  direct: z.number(),
  same_category: z.number(),
  l3: z.number(),
  anchors: z.number(),
  by_source: z.object({ google: z.number(), yelp: z.number(), foursquare: z.number() }),
});
export type CompetitorCounts = z.infer<typeof competitorCountsSchema>;

/** §4.2 品类空白判定: a same-category store whose menu / review / editorial text shows it also sells the concept. */
export const alsoSellingSchema = z.object({
  id: z.string(),
  name: z.string(),
  distance_mi: z.number(),
  evidence: z.enum(['review', 'editorial', 'menu']),
  quote: z.string().optional(),
});
export type AlsoSellingStore = z.infer<typeof alsoSellingSchema>;

/** Counts for a model stored before §4.4 — derived once, here, so no surface ever counts for itself. */
function backfillCounts(c: {
  l1: Competitor[];
  l2: Competitor[];
  l2_count: number;
  l3_count: number;
  brand_anchors?: BrandAnchor[];
}): CompetitorCounts {
  const counted = [...c.l1, ...c.l2];
  return {
    total: c.l1.length + c.l2.length,
    direct: c.l1.length,
    same_category: c.l2.length || c.l2_count,
    l3: c.l3_count,
    anchors: c.brand_anchors?.length ?? 0,
    by_source: { google: counted.filter((x) => x.source === 'google' || x.source === 'both').length, yelp: 0, foursquare: 0 },
  };
}

/** The document shape. `reportModelSchema` below adds the single-conclusion guard. */
const reportModelShape = z.object({
  meta: z.object({
    report_id: z.string(),
    generated_at: z.string(),
    data_as_of: z.string(),
    tier: z.enum(['paid', 'precheck']),
    engine_version: z.string(),
    cost_usd: z.number(),
    cost_breakdown: z.record(z.string(), z.number()),
    elapsed_ms: z.number(),
    /** Report language (the language the narratives were generated in). */
    language: z.enum(['en', 'zh', 'es']),
    /** Language of the stored narrative_json when it differs from `language` (set by the loader from `narrative_json.__lang`). */
    narrative_language: z.enum(['en', 'zh', 'es']).optional(),
    /**
     * §4.1 ordering: 'template' when the deterministic core ran without prose (it now
     * runs BEFORE the web draft), 'llm' once the narrative pass has written the pages.
     * The 360° route uses it to run the prose pass exactly once, never recomputing
     * the frozen numbers.
     */
    narrative_pass: z.enum(['template', 'llm']).optional(),
    precheck_reasons: z.array(z.string()),
    /** Declared fallbacks that keep the report deliverable (e.g. Overture not loaded → Google-only POI base). */
    degradations: z.array(z.string()),
  }),
  input: z.object({
    address: z.string(),
    matched_address: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
    cuisine: z.string(),
    cuisine_label_zh: z.string(),
    cuisine_label_en: z.string(),
    /** §4.1: Spanish label, concept category and demand audience of the taxonomy entry (absent on models stored before §4.1 → Chinese). */
    cuisine_label_es: z.string().optional(),
    concept_category: z.enum(['chinese_regional', 'chinese_format', 'asian_other', 'bakery_dessert', 'beverage', 'western_other']).optional(),
    audience: z.enum(['chinese', 'general']).optional(),
    range_class: z.enum(['everyday', 'regular', 'destination']),
    rent_usd: nullableNum,
    sqft: nullableNum,
    seats: nullableNum,
    capex_usd: nullableNum,
    ticket_in: nullableNum,
    ticket_delivery: nullableNum,
    delivery_ratio: nullableNum,
    parking_spaces: nullableNum,
    existing_stores: z.array(z.object({ address: z.string(), lat: z.number().optional(), lng: z.number().optional() })),
  }),
  geo: z.object({
    block: z.string(),
    block_group: z.string(),
    tract: z.string(),
    zcta: z.string().nullable(),
    county: z.string(),
    county_name: z.string().nullable(),
    state: z.string(),
    metro: z.string().nullable(),
  }),
  trade_area: z.object({
    primary_ring: ringIdSchema,
    rings: z.array(ringSchema),
    county_benchmark: z.object({
      chinese_hh_share: nullableNum,
      median_income: nullableNum,
    }),
    isochrone_method: z.enum(['mapbox', 'radius']),
  }),
  audience: z.object({
    /**
     * P1-i 客群指数: `share` and `index` share ONE basis (engines/audience.ts).
     * `share` is the segment's share of the primary ring's households — the four
     * segments partition the ring and sum to 1 ± 0.02. `index` is that share ÷ the
     * SAME segment's county share × 100 (100 = the county average), null when the
     * county row is missing. `basis` names that denominator in the report.
     */
    segments: z.array(
      z.object({
        id: z.enum(['chinese_family', 'commuter_professional', 'young_chinese', 'non_chinese_explorer']),
        share: z.number(),
        index: nullableNum,
        basis: z.string(),
      }),
    ),
    lunch_dinner_split: z.tuple([z.number(), z.number()]),
  }),
  competitors: z.object({
    guard_passed: z.boolean(),
    guard_notes: z.array(z.string()),
    /**
     * 底层重构 §3.1: a Layer-1/2 search came back at the API's per-call cap, so
     * its area was never exhausted. Defaults false so models stored before this
     * field still parse — they simply make no truncation claim either way.
     */
    pool_truncated: z.boolean().default(false),
    candidates_total: z.number(),
    l1: z.array(competitorSchema),
    l2: z.array(competitorSchema),
    l2_count: z.number(),
    l3_count: z.number(),
    l4: z.array(competitorSchema),
    walk10_l1_l2_count: z.number(),
    density_per_10k_residents: nullableNum,
    density_per_10k_chinese: nullableNum,
    hhi: nullableNum,
    avg_rating_l1: nullableNum,
    weighted_rating_l1: nullableNum,
    price_ladder: z.array(z.object({ level: z.number(), count: z.number() })),
    closure_rate: nullableNum,
    cluster_score: z.number(),
    benchmark_revenue_band: z.object({ p25: nullableNum, median: nullableNum, p75: nullableNum, method: z.string() }),
    void: z.object({
      is_void: z.boolean(),
      reason: z.string(),
      density_vs_hub_median: nullableNum,
      conditions: z.object({ chinese_pop_ok: z.boolean(), density_ok: z.boolean(), l2_ok: z.boolean() }),
    }),
    metro_sub_cuisine_total: nullableNum,
    /** Candidate pool radius (§3.1, max(3 mi, drive15)); L1/L2 are only searched inside it. */
    pool_radius_mi: z.number().optional(),
    /** Nearest same-cuisine restaurant found *outside* the pool — "no L1" is a finding, not a gap. */
    l1_nearest_outside_pool: z.object({ name: z.string(), distance_mi: z.number() }).nullable().optional(),
    /** §4.2 Layer 3 brand anchors (city-wide, ≥ 500 reviews, top 5). Not competitors: excluded from every count. */
    brand_anchors: z.array(brandAnchorSchema).optional(),
    /** Largest Layer-1 keyword-search radius completed (800 → 1600 m); null when Google did not run. */
    l1_search_radius_m: nullableNum.optional(),
    /** Layer-1 steps completed (e.g. ["direct@800", "direct@1600"]); a void claim requires both. */
    l1_layers_tried: z.array(z.string()).optional(),
    /**
     * §4.2 品类空白判定加硬约束. 'true' only when the Layer-1 keyword search
     * returned 0 hits at BOTH 0.5 and 1 mile AND no Layer-2 (same-category)
     * store's menu / review / editorial text mentions the concept. 'unknown'
     * when the text probe could not be completed — never a gap claim.
     */
    category_gap: z.enum(['true', 'false', 'unknown']).default('unknown'),
    /** Same-category stores that also sell the concept ("无专营店，但 N 家兼售"). */
    also_selling: z.array(alsoSellingSchema).default([]),
    /** Same-category stores with no text at all: unverifiable, never counted as "does not sell it". */
    also_selling_unknown_count: z.number().default(0),
    /** §4.2 demand consequence: factor the demand coverage ratio must be multiplied by (0.8), or null. */
    coverage_discount: nullableNum.default(null),
    /** Why `coverage_discount` was applied; null when it was not. */
    coverage_adjustment: z.string().nullable().default(null),
    /** §4.4 P1-e: the ONE competitive-strength number — score.dimensions.competitive_position. Never recomputed. */
    competition_score: nullableNum.default(null),
    /** §4.4 P1-a: the ONE set of counts every surface prints. */
    counts: competitorCountsSchema.optional(),
  }).transform((c) => ({ ...c, counts: c.counts ?? backfillCounts(c) })),
  demand: z.object({
    captured_monthly_usd: nullableNum,
    captured_covers_day: nullableNum,
    /** 午市 daypart total (resident 午市 slice + the walk10 workplace pool). */
    lunch_usd: nullableNum,
    /** 晚市 daypart total. */
    dinner_usd: nullableNum,
    /**
     * §4.3 daypart 按业态取值 — captured demand split across 早市 / 午市 / 午后 / 晚市 by
     * the concept's own taxonomy table, in clock order, `share` summing to 1. `[]` on a
     * model stored before §4.3 (page 5 then falls back to lunch_usd / dinner_usd).
     */
    dayparts: z
      .array(z.object({ id: z.enum(['breakfast', 'lunch', 'afternoon', 'dinner']), share: z.number(), monthly_usd: z.number() }))
      .default([]),
    coverage_ratio: nullableNum,
    by_ring: z.array(z.object({ ring: ringIdSchema, monthly_usd: z.number(), share: z.number() })),
    cuisine_share: z.number(),
    cuisine_share_method: z.string(),
    huff: z.object({ alpha: z.number(), beta: z.number(), site_attractiveness: nullableNum, competitor_set: z.number() }),
  }),
  access: z.object({
    transit: z.array(
      z.object({ system: z.string(), name: z.string(), distance_m: z.number(), avg_weekday_exits: nullableNum }),
    ),
    aadt: z.array(z.object({ route: z.string(), aadt: z.number(), year: z.number(), distance_m: z.number() })),
    parking: z.object({ spaces: nullableNum, source: z.enum(['user_input', 'overture_estimate', 'none']) }),
    commute_mix: z.object({ transit: nullableNum, walk: nullableNum, drove_alone: nullableNum }),
  }),
  finance: z.object({
    method: z.string(),
    fixed_cost: z.object({
      rent: nullableNum,
      labor: nullableNum,
      utilities: nullableNum,
      insurance: nullableNum,
      pos: nullableNum,
      marketing: nullableNum,
      misc: nullableNum,
      total: nullableNum,
    }),
    /** 'user_input' when the customer gave a monthly rent, 'not_provided' otherwise (rent is never estimated). */
    rent_source: z.string(),
    /** True when no rent was provided: fixed_cost.total, break-even, safety line, vs_breakeven and coverage EXCLUDE rent. */
    rent_excluded: z.boolean().default(false),
    /** Monthly rent that keeps rent ÷ captured demand ≤ 10 % — the ceiling to negotiate to; null when captured demand is unknown. */
    max_rent_for_10pct_usd: nullableNum.default(null),
    contribution_margin: nullableNum,
    variable_rate: nullableNum,
    breakeven_monthly: nullableNum,
    safety_monthly: nullableNum,
    /**
     * §4.1 单一结论源: which basis produced `scenarios` — seats × turns (the
     * default), or the modelled captured demand when the customer gave neither
     * seats nor floor area. The conclusion prints it; there is never a second table.
     */
    revenue_basis: z.enum(['seats_turns', 'demand_capture']).default('seats_turns'),
    scenarios: z.array(
      z.object({
        id: z.enum(['pessimistic', 'base', 'optimistic']),
        turns_per_day: z.number(),
        delivery_ratio: z.number(),
        ticket_in: z.number(),
        ticket_delivery: z.number(),
        seats: z.number(),
        days_open: z.number(),
        dine_in_covers_day: z.number(),
        delivery_orders_day: z.number(),
        orders_day: z.number(),
        monthly_revenue: z.number(),
        vs_breakeven: nullableNum,
      }),
    ),
    sensitivity: z.array(
      z.object({ id: z.string(), label_zh: z.string(), label_en: z.string(), monthly_revenue_delta: z.number(), breaks_breakeven: z.boolean() }),
    ),
    occupancy_cost_ratio: nullableNum, // rent / captured revenue; null when rent was not provided
    payback_months: nullableNum, // null unless capex provided (and rent provided — profit without rent is not a payback)
    inputs_missing: z.array(z.string()),
  }),
  score: z.object({
    total: z.number(),
    verdict: z.enum(['GO', 'CONDITIONAL_GO', 'NO_GO']),
    dimensions: z.array(
      z.object({
        id: z.enum([
          'demand_coverage',
          'audience_fit',
          'competitive_position',
          'access_traffic',
          'financial_viability',
          'occasion_delivery',
        ]),
        label_zh: z.string(),
        label_en: z.string(),
        score: z.number(),
        weight: z.number(),
        weighted: z.number(),
        drivers: z.array(z.string()),
      }),
    ),
    conditions: z.array(z.object({ dimension: z.string(), text_zh: z.string(), text_en: z.string(), value: nullableNum })),
    alternatives: z.array(z.object({ cuisine: z.string(), label_zh: z.string(), label_en: z.string(), label_es: z.string().optional(), total: z.number(), verdict: z.string() })),
    user_cuisine_rank: z.number(),
    cannibalization: z.array(z.object({ store: z.string(), diverted_share: z.number() })),
  }),
  /**
   * 评审 Spec §4.6 (P1-c): every risk carries EITHER a monthly `impact_usd` with
   * the formula that produced it, OR the reason no amount exists. The renderer
   * puts the first kind in the register table (whose total is therefore never $0)
   * and folds the second kind into the pre-lease checklist prose.
   * The four `*_zh / *_en` fields default to null so models stored before §4.6 parse.
   */
  risks: z.array(
    z.object({
      id: z.number(),
      risk_zh: z.string(),
      risk_en: z.string(),
      prob: z.enum(['low', 'medium', 'high']),
      impact_usd: nullableNum,
      /** The arithmetic behind `impact_usd`, in plain words and model numbers; null when there is no amount. */
      impact_formula_zh: z.string().nullable().default(null),
      impact_formula_en: z.string().nullable().default(null),
      /** Why this risk carries no amount; null when it does. */
      unquantified_zh: z.string().nullable().default(null),
      unquantified_en: z.string().nullable().default(null),
      trigger: z.string(),
      hedge: z.string(),
    }),
  ),
  confidence: z.object({
    total: z.number(),
    level: z.enum(['low', 'medium', 'high']),
    components: z.record(z.string(), z.object({ weight: z.number(), quality: z.number(), note: z.string() })),
  }),
  sources: z.array(sourceRowSchema),
  narrative: z.record(
    z.string(),
    z.object({ title: z.string(), body: z.string(), refs: z.array(z.string()), provider: z.string().optional(), guard: z.string().optional() }),
  ),
  /**
   * 评审 Spec §4.1 单一结论源 (P0-A): THE conclusion both surfaces print — score,
   * verdict, break-even, safety line, fixed cost, occupancy, scenarios and the one
   * data-confidence number. Derived by lib/iq/conclusion/conclusion.ts and nowhere
   * else. `.default(null)` so models stored before P0-A (and qa/fixtures/*.json)
   * still parse.
   */
  conclusion: conclusionSchema.nullable().default(null),
});

export type ReportModel = z.infer<typeof reportModelShape>;

/**
 * 评审 Spec §4.1 临时方案 (interim safety net, kept permanently): every parse of a
 * stored model — the print/PDF loader included — runs the conclusion guard, so a
 * model that drifted from its stored conclusion is rendered with the CONCLUSION's
 * numbers. The PDF can never print a recomputation the web page does not show.
 */
export const reportModelSchema = reportModelShape.transform((m): ReportModel => reconcileModelToConclusion(m));

export const REPORT_ENGINE_VERSION = '360.1.0';

/** Validate; throws ZodError with the offending path when the document is malformed. */
export function parseReportModel(raw: unknown): ReportModel {
  return reportModelSchema.parse(raw);
}
