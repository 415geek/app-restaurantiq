/**
 * Multi-agent LocationIQ engine — shared types.
 *
 * Pipeline: deterministic metrics → parallel specialist analysts → synthesis → critic review.
 * Specialists receive only the data slice relevant to their discipline, keeping each
 * context small and the analysis focused (mirrors how a site-selection firm staffs
 * an engagement: market analyst, competition analyst, real-estate analyst, financial
 * analyst, risk officer, then a partner who writes the final memo).
 */

export type Lang = 'en' | 'zh';

export type CuisineCategory = 'hotpot_bbq' | 'boba_coffee' | 'full_service' | 'qsr_fast' | 'general';

export type CuisineBenchmarks = {
  category: CuisineCategory;
  /** Typical trade-area radius in miles for this format. */
  tradeAreaRadiusMi: number;
  /** Average ticket per person, USD. */
  avgTicketUsd: [number, number];
  /** Table turns per day (or null when the format is cup-count driven). */
  turnsPerDay: [number, number] | null;
  /** Seats assumed for a typical unit of this format. */
  typicalSeats: [number, number];
  /** Notes injected into specialist prompts. */
  notes_en: string;
  notes_zh: string;
};

/** One competitor scored for gravity/attractiveness modeling. */
export type ScoredCompetitor = {
  name: string;
  rating: number | null;
  reviews: number | null;
  price_level: number | null;
  address: string | null;
  /** rating × ln(1+reviews) — proxy for drawing power (Huff attractiveness). */
  attractiveness: number | null;
};

/** Deterministic, formula-derived metrics. Every number here is reproducible from inputs. */
export type SiteMetrics = {
  computed_at: string;
  cuisine: CuisineBenchmarks;

  demand: {
    data_available: boolean;
    tract_population: number | null;
    county_population: number | null;
    median_household_income_usd: number | null;
    income_vs_us_median: number | null; // ratio, US median HHI baseline
    /** Estimated annual food-away-from-home spend per household (BLS CEX baseline scaled by income elasticity). */
    fafh_per_household_usd: number | null;
    /** Trade-area household estimate (population / avg household size). */
    trade_area_households: number | null;
    /** Total annual FAFH demand pool in the trade area, USD. */
    trade_area_fafh_pool_usd: number | null;
  };

  competition: {
    data_available: boolean;
    competitor_count: number;
    avg_rating: number | null;
    avg_review_count: number | null;
    /** Restaurants per 1,000 residents in trade area vs ~2.2/1k US benchmark. */
    saturation_per_1k: number | null;
    saturation_index: number | null; // ratio vs benchmark; >1 = more saturated than typical
    price_tier_distribution: Record<string, number>;
    top_competitors: ScoredCompetitor[];
    /** Sum of attractiveness across competitors (Huff denominator component). */
    total_attractiveness: number | null;
  };

  market_share: {
    data_available: boolean;
    /** Benchmark-estimated total restaurants in the trade area (Places sample is only a floor). */
    estimated_restaurants_in_trade_area: number | null;
    /** Demand pool ÷ estimated restaurant count — the average operator's annual take. */
    fair_share_annual_revenue_usd: number | null;
    /** Huff-style attractiveness multiplier vs the sampled competitive set (capped 0.5–2.0). */
    entrant_multiplier_median: number | null;
    entrant_multiplier_strong: number | null;
    /** Fair share × multiplier = implied annual revenue capacity. */
    implied_annual_revenue_median_usd: number | null;
    implied_annual_revenue_strong_usd: number | null;
  };

  economics: {
    data_available: boolean;
    /** Median asking rent from commercial listings when present. */
    median_monthly_rent_usd: number | null;
    median_rent_per_sqft_usd: number | null;
    /** Revenue needed to keep occupancy at 8% of sales (industry healthy band 6–10%). */
    required_monthly_revenue_at_8pct_usd: number | null;
    /** Bottom-up capacity check: seats × turns × ticket × 30. */
    bottom_up_monthly_revenue_range_usd: [number, number] | null;
    /** Covers/day needed to hit the 8% rent line at cuisine avg ticket. */
    breakeven_covers_per_day: number | null;
  };

  traffic: {
    data_available: boolean;
    max_aadt: number | null;
    segments: Array<{ route: string; aadt: number | null; description: string | null }>;
  };

  /** Where each block's inputs came from — cited in the report. */
  data_sources: string[];
  /** Blocks that had to be skipped and why — the synthesis agent must disclose these. */
  gaps: string[];
};

/** Structured output of one specialist analyst. */
export type SpecialistFinding = {
  discipline: 'market' | 'competition' | 'site' | 'financial' | 'risk';
  /** 0–100 score for this dimension with the reasoning behind it. */
  score_100: number;
  score_rationale: string;
  /** Narrative section body (Markdown allowed). */
  narrative: string;
  /** Hard findings the synthesis agent must not drop. */
  key_findings: string[];
  /** Discipline-specific structured payload (competitor table, scenario table, risk rows…). */
  payload?: Record<string, unknown>;
  /** Confidence: how much data backed this analysis. */
  confidence: 'high' | 'medium' | 'low';
};

export type CriticReview = {
  passed: boolean;
  critical_issues: string[];
  minor_issues: string[];
};

export type AgentTrace = {
  engine: 'multi_agent_v1';
  specialists_run: string[];
  specialists_failed: string[];
  critic_passed: boolean;
  revision_applied: boolean;
  total_ms: number;
};
