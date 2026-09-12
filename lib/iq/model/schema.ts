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
});
export type Competitor = z.infer<typeof competitorSchema>;

export const reportModelSchema = z.object({
  meta: z.object({
    report_id: z.string(),
    generated_at: z.string(),
    data_as_of: z.string(),
    tier: z.enum(['paid', 'precheck']),
    engine_version: z.string(),
    cost_usd: z.number(),
    cost_breakdown: z.record(z.string(), z.number()),
    elapsed_ms: z.number(),
    language: z.enum(['en', 'zh']),
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
  }),
  demand: z.object({
    captured_monthly_usd: nullableNum,
    captured_covers_day: nullableNum,
    lunch_usd: nullableNum,
    dinner_usd: nullableNum,
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
    rent_source: z.string(),
    contribution_margin: nullableNum,
    variable_rate: nullableNum,
    breakeven_monthly: nullableNum,
    safety_monthly: nullableNum,
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
    occupancy_cost_ratio: nullableNum, // rent / captured revenue
    payback_months: nullableNum, // null unless capex provided
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
    alternatives: z.array(z.object({ cuisine: z.string(), label_zh: z.string(), label_en: z.string(), total: z.number(), verdict: z.string() })),
    user_cuisine_rank: z.number(),
    cannibalization: z.array(z.object({ store: z.string(), diverted_share: z.number() })),
  }),
  risks: z.array(
    z.object({
      id: z.number(),
      risk_zh: z.string(),
      risk_en: z.string(),
      prob: z.enum(['low', 'medium', 'high']),
      impact_usd: nullableNum,
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
});

export type ReportModel = z.infer<typeof reportModelSchema>;

export const REPORT_ENGINE_VERSION = '360.1.0';

/** Validate; throws ZodError with the offending path when the document is malformed. */
export function parseReportModel(raw: unknown): ReportModel {
  return reportModelSchema.parse(raw);
}
