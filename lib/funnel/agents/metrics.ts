/**
 * Deterministic site metrics — the quantitative backbone of the multi-agent engine.
 *
 * Professional site-selection platforms (Buxton, SiteZeus, esri Business Analyst) differ
 * from prompt-only tools in one key way: scores come from reproducible formulas over real
 * data, and the narrative is written around the numbers — not the other way. This module
 * computes those numbers; LLM agents interpret them and are forbidden from inventing new ones.
 *
 * Benchmark constants (documented so they can be audited/updated):
 * - US median household income: ACS 2023 1-yr ≈ $77,719 (B19013).
 * - Food-away-from-home spend: BLS Consumer Expenditure Survey 2024 ≈ $3,945/household/yr.
 *   Income elasticity of FAFH ≈ 0.8 (spend scales sub-linearly with income).
 * - Restaurant saturation: ~749k US restaurants / ~335M pop ≈ 2.2 per 1,000 residents.
 * - Occupancy cost (rent+NNN) healthy band: 6–10% of sales, >10% red flag (Lavu/RRG);
 *   8% used as the planning line.
 * - Prime cost (COGS+labor) targets: QSR 55–60%, casual FSR 60–65%, fine dining ≤68%.
 * - Scenario method (industry practice): pessimistic = revenue −20% & costs +5%;
 *   optimistic = revenue +15%; ramp: month 1 at 40–50% of target, month 2 at 60–70%,
 *   steady state months 3–6.
 * - Huff gravity model: P_j = (A_j/T^b) / Σ_k (A_k/T^b), b≈1.5–2.0; attractiveness here
 *   A = rating × ln(1+reviews). Distance decay is omitted because Places textsearch
 *   results are already within the trade area; when point distances become available,
 *   add T^-b with b≈2 for QSR / 1.5 for destination dining.
 * - Average US household size: ≈ 2.5 persons (ACS).
 */

import type {
  CuisineBenchmarks,
  CuisineCategory,
  ScoredCompetitor,
  SiteMetrics,
} from './types';

const US_MEDIAN_HHI_USD = 77_719;
const FAFH_BASE_PER_HOUSEHOLD_USD = 3_945;
const FAFH_INCOME_ELASTICITY = 0.8;
const US_RESTAURANTS_PER_1K = 2.2;
const OCCUPANCY_PLANNING_PCT = 0.08;
const AVG_HOUSEHOLD_SIZE = 2.5;
/** A new entrant is assumed to open at 4.2★ with modest review velocity (~150 reviews year one). */
const ENTRANT_MEDIAN_RATING = 4.2;
const ENTRANT_MEDIAN_REVIEWS = 150;
const ENTRANT_STRONG_RATING = 4.6;
const ENTRANT_STRONG_REVIEWS = 400;

const CUISINE_TABLE: Record<CuisineCategory, CuisineBenchmarks> = {
  hotpot_bbq: {
    category: 'hotpot_bbq',
    tradeAreaRadiusMi: 4,
    avgTicketUsd: [25, 60],
    turnsPerDay: [1.5, 2.5],
    typicalSeats: [60, 120],
    notes_en: 'Destination social dining: parking > foot traffic; evening-weighted; summer softness (-30–40%); ventilation/fire compliance.',
    notes_zh: '目的地型聚餐业态：停车 > 人流；晚市为主；夏季淡季（营收可降30-40%）；排烟消防合规是硬门槛。',
  },
  boba_coffee: {
    category: 'boba_coffee',
    tradeAreaRadiusMi: 0.8,
    avgTicketUsd: [5, 12],
    turnsPerDay: null,
    typicalSeats: [8, 25],
    notes_en: 'Impulse/high-frequency: foot traffic density decides; 500m same-category count is the key competitive metric; healthy volume 200–500 cups/day.',
    notes_zh: '冲动型高频消费：人流密度定生死；500米内同类门店数是核心竞争指标；健康日销200-500杯。',
  },
  full_service: {
    category: 'full_service',
    tradeAreaRadiusMi: 3,
    avgTicketUsd: [18, 45],
    turnsPerDay: [2, 3],
    typicalSeats: [50, 100],
    notes_en: 'Community stores live on residential density × income; mall stores on spending power × parking; labor 28–33% of sales.',
    notes_zh: '社区店看居民密度与收入结构；商圈店看消费力与停车；人工成本占营收28-33%。',
  },
  qsr_fast: {
    category: 'qsr_fast',
    tradeAreaRadiusMi: 1.5,
    avgTicketUsd: [8, 15],
    turnsPerDay: [4, 8],
    typicalSeats: [20, 50],
    notes_en: 'Lunch-rush driven: office/industrial density; delivery mix often 40–60%; platform commission 15–30% compresses margin.',
    notes_zh: '午市高峰驱动：写字楼/工业区密度；外卖占比常达40-60%；平台抽成15-30%挤压利润。',
  },
  general: {
    category: 'general',
    tradeAreaRadiusMi: 2.5,
    avgTicketUsd: [12, 35],
    turnsPerDay: [2, 4],
    typicalSeats: [40, 90],
    notes_en: 'No specific cuisine matched — general restaurant framework applied.',
    notes_zh: '未匹配特定菜系，采用通用餐饮分析框架。',
  },
};

export function classifyCuisine(businessType: string): CuisineBenchmarks {
  const t = (businessType || '').toLowerCase();
  if (/hot\s*pot|hotpot|火锅|串串|烤肉|烧烤|bbq|barbecue|korean\s*grill|yakiniku|skewer/.test(t)) {
    return CUISINE_TABLE.hotpot_bbq;
  }
  if (/boba|bubble\s*tea|奶茶|咖啡|coffee|café|cafe|tea\s*house|dessert|甜品|juice|果汁|smoothie/.test(t)) {
    return CUISINE_TABLE.boba_coffee;
  }
  if (/fast|快餐|qsr|noodle|面馆|面条|便当|bento|轻食|salad|sandwich|deli|taco|burger|pizza\s*slice/.test(t)) {
    return CUISINE_TABLE.qsr_fast;
  }
  if (/川菜|湘菜|粤菜|日料|sushi|japanese|chinese|sichuan|hunan|cantonese|western|italian|french|steak|seafood|dim\s*sum|早茶|正餐|fine|bistro|thai|vietnamese|pho|indian|mexican/.test(t)) {
    return CUISINE_TABLE.full_service;
  }
  return CUISINE_TABLE.general;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function attractiveness(rating: number | null, reviews: number | null): number | null {
  if (rating == null) return null;
  return rating * Math.log(1 + Math.max(0, reviews ?? 0));
}

type MarketSummaryLike = {
  competitor_count_google?: unknown;
  avg_rating_google?: unknown;
  avg_review_count_google?: unknown;
  sample_competitors_google?: unknown;
};

type AcsRowLike = {
  population?: unknown;
  median_household_income_usd?: unknown;
};

/**
 * Compute all deterministic metrics from the accumulated market_data object.
 * Never throws; missing inputs surface as `data_available: false` + an entry in `gaps`.
 */
export function computeSiteMetrics(input: {
  marketData: Record<string, unknown> | null | undefined;
  businessType: string;
}): SiteMetrics {
  const md = input.marketData ?? {};
  const cuisine = classifyCuisine(input.businessType);
  const gaps: string[] = [];
  const sources: string[] = [];

  // ---- competitors (Google Places) -------------------------------------
  const summary = (md.summary ?? {}) as MarketSummaryLike;
  const sample = Array.isArray(summary.sample_competitors_google)
    ? (summary.sample_competitors_google as Array<Record<string, unknown>>)
    : [];
  const competitors: ScoredCompetitor[] = sample
    .map((r) => {
      const rating = num(r.rating);
      const reviews = num(r.reviews);
      return {
        name: String(r.name ?? 'Unknown'),
        rating,
        reviews,
        price_level: num(r.price_level),
        address: typeof r.address === 'string' ? r.address : null,
        attractiveness: attractiveness(rating, reviews),
      };
    })
    .sort((a, b) => (b.attractiveness ?? 0) - (a.attractiveness ?? 0));

  const competitorCount = num(summary.competitor_count_google) ?? competitors.length;
  const hasCompetition = competitorCount > 0 || competitors.length > 0;
  if (hasCompetition) sources.push('Google Places textsearch sample');
  else gaps.push('No competitor sample from Google Places — competition metrics unavailable.');

  const priceTiers: Record<string, number> = {};
  for (const c of competitors) {
    const key = c.price_level == null ? 'unknown' : '$'.repeat(Math.max(1, Math.min(4, c.price_level)));
    priceTiers[key] = (priceTiers[key] ?? 0) + 1;
  }

  const totalAttr = competitors.reduce((s, c) => s + (c.attractiveness ?? 0), 0) || null;

  // ---- demographics (Census ACS) ----------------------------------------
  const acs = (md.acs_context ?? null) as
    | { tract?: AcsRowLike; county?: AcsRowLike; tract_data_available?: unknown; acs_year?: unknown }
    | null;
  const tract = acs?.tract ?? {};
  const county = acs?.county ?? {};
  const tractPop = num(tract.population);
  const countyPop = num(county.population);
  const mhi = num(tract.median_household_income_usd) ?? num(county.median_household_income_usd);
  const hasAcs = Boolean(acs && (tractPop != null || countyPop != null || mhi != null));
  if (hasAcs) sources.push(`US Census ACS ${String(acs?.acs_year ?? '5-year')} (tract/county)`);
  else gaps.push('No ACS demographics (non-US address or geocode failure) — demand pool is a rough estimate.');

  // Trade-area population proxy: tract population scaled to the cuisine radius.
  // A census tract averages ~4k people over ~2 sq mi in urban areas; we scale by area
  // ratio, capped by county population. This is a stated approximation, not a claim.
  let tradeAreaPop: number | null = null;
  if (tractPop != null && tractPop > 0) {
    const assumedTractRadiusMi = 0.8;
    const areaRatio = (cuisine.tradeAreaRadiusMi / assumedTractRadiusMi) ** 2;
    tradeAreaPop = Math.min(tractPop * areaRatio, countyPop ?? Number.POSITIVE_INFINITY);
  } else if (countyPop != null) {
    tradeAreaPop = countyPop * 0.05; // fallback: assume trade area captures ~5% of county
    gaps.push('Tract population missing — trade-area population approximated as 5% of county.');
  }

  const incomeRatio = mhi != null ? mhi / US_MEDIAN_HHI_USD : null;
  const fafhPerHh =
    incomeRatio != null
      ? FAFH_BASE_PER_HOUSEHOLD_USD * incomeRatio ** FAFH_INCOME_ELASTICITY
      : hasAcs
        ? FAFH_BASE_PER_HOUSEHOLD_USD
        : null;
  const tradeAreaHh = tradeAreaPop != null ? tradeAreaPop / AVG_HOUSEHOLD_SIZE : null;
  const fafhPool = tradeAreaHh != null && fafhPerHh != null ? tradeAreaHh * fafhPerHh : null;

  // ---- saturation ---------------------------------------------------------
  // Places textsearch caps around 12–20 rows, so the sample is a FLOOR of the true
  // competitive set. The benchmark-expected count is what fair-share economics use.
  let saturationPer1k: number | null = null;
  let saturationIndex: number | null = null;
  let expectedRestaurants: number | null = null;
  if (tradeAreaPop != null && tradeAreaPop > 0) {
    expectedRestaurants = Math.max(
      competitorCount,
      round((tradeAreaPop / 1000) * US_RESTAURANTS_PER_1K),
    );
    if (hasCompetition) {
      saturationPer1k = (competitorCount / tradeAreaPop) * 1000;
      saturationIndex = saturationPer1k / US_RESTAURANTS_PER_1K;
      if (competitorCount >= 12) {
        gaps.push(
          'Places sample is capped (~12 rows) — true trade-area competitor count is higher; sample-based saturation is a floor. Fair-share economics use the benchmark-expected count instead.',
        );
      }
    }
  }

  // ---- fair-share revenue model (calibrated Huff) ---------------------------
  // Average operator take = pool / expected restaurant count (sanity: lands near the
  // ~$1M/yr US average unit volume). The entrant's deviation from average is a
  // Huff-style attractiveness ratio vs the sampled set, capped at 0.5–2.0× because
  // a single unit rarely does <½ or >2× local fair share on positioning alone.
  const fairShare =
    fafhPool != null && expectedRestaurants != null && expectedRestaurants > 0
      ? fafhPool / expectedRestaurants
      : null;
  const attrValues = competitors
    .map((c) => c.attractiveness)
    .filter((x): x is number => x != null && x > 0);
  const avgAttr = attrValues.length
    ? attrValues.reduce((a, b) => a + b, 0) / attrValues.length
    : null;
  const clampMult = (x: number) => Math.max(0.5, Math.min(2, x));
  const multMedian =
    avgAttr != null && avgAttr > 0
      ? clampMult(attractiveness(ENTRANT_MEDIAN_RATING, ENTRANT_MEDIAN_REVIEWS)! / avgAttr)
      : 1;
  const multStrong =
    avgAttr != null && avgAttr > 0
      ? clampMult(attractiveness(ENTRANT_STRONG_RATING, ENTRANT_STRONG_REVIEWS)! / avgAttr)
      : 1.3;
  const impliedMedian = fairShare != null ? fairShare * multMedian : null;
  const impliedStrong = fairShare != null ? fairShare * multStrong : null;

  // ---- economics (commercial listings) ------------------------------------
  const listingsPack = (md.commercial_listings ?? null) as
    | { status?: unknown; listings?: Array<Record<string, unknown>> }
    | null;
  const listings = Array.isArray(listingsPack?.listings) ? listingsPack!.listings! : [];
  const rents = listings
    .map((l) => num(l.monthly_rent_usd ?? l.rent_monthly_usd ?? l.price_monthly))
    .filter((x): x is number => x != null && x > 200);
  const sqftRents = listings
    .map((l) => {
      const rent = num(l.monthly_rent_usd ?? l.rent_monthly_usd ?? l.price_monthly);
      const sqft = num(l.sqft ?? l.square_feet);
      return rent != null && sqft != null && sqft > 100 ? (rent * 12) / sqft : null;
    })
    .filter((x): x is number => x != null);
  const median = (arr: number[]): number | null => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const medianRent = median(rents);
  const medianSqft = median(sqftRents);
  if (medianRent != null) sources.push('Commercial listings (asking rents)');
  else gaps.push('No usable asking-rent listings — occupancy economics use benchmark bands only.');

  const requiredRevenue = medianRent != null ? medianRent / OCCUPANCY_PLANNING_PCT : null;

  const [ticketLo, ticketHi] = cuisine.avgTicketUsd;
  let bottomUp: [number, number] | null = null;
  if (cuisine.turnsPerDay) {
    const [seatsLo, seatsHi] = cuisine.typicalSeats;
    const [turnsLo, turnsHi] = cuisine.turnsPerDay;
    bottomUp = [
      round(seatsLo * turnsLo * ticketLo * 30),
      round(seatsHi * turnsHi * ticketHi * 30),
    ];
  } else {
    // cup-count formats: 200–500 cups/day × ticket
    bottomUp = [round(200 * ticketLo * 30), round(500 * ticketHi * 30)];
  }

  const midTicket = (ticketLo + ticketHi) / 2;
  const breakevenCovers =
    requiredRevenue != null ? round(requiredRevenue / 30 / midTicket) : null;

  // ---- traffic (Caltrans AADT) ---------------------------------------------
  const caltrans = Array.isArray(md.caltrans_traffic)
    ? (md.caltrans_traffic as Array<Record<string, unknown>>)
    : [];
  const segments = caltrans.slice(0, 5).map((s) => ({
    route: String(s.route ?? s.route_name ?? 'unknown'),
    aadt: num(s.aadt ?? s.back_aadt ?? s.ahead_aadt),
    description: typeof s.description === 'string' ? s.description : null,
  }));
  const maxAadt = segments.reduce<number | null>(
    (mx, s) => (s.aadt != null && (mx == null || s.aadt > mx) ? s.aadt : mx),
    null,
  );
  if (segments.length) sources.push('Caltrans AADT (state highways)');

  return {
    computed_at: new Date().toISOString(),
    cuisine,
    demand: {
      data_available: hasAcs,
      tract_population: tractPop,
      county_population: countyPop,
      median_household_income_usd: mhi,
      income_vs_us_median: incomeRatio != null ? round(incomeRatio, 2) : null,
      fafh_per_household_usd: fafhPerHh != null ? round(fafhPerHh) : null,
      trade_area_households: tradeAreaHh != null ? round(tradeAreaHh) : null,
      trade_area_fafh_pool_usd: fafhPool != null ? round(fafhPool) : null,
    },
    competition: {
      data_available: hasCompetition,
      competitor_count: competitorCount,
      avg_rating: num(summary.avg_rating_google),
      avg_review_count: num(summary.avg_review_count_google),
      saturation_per_1k: saturationPer1k != null ? round(saturationPer1k, 2) : null,
      saturation_index: saturationIndex != null ? round(saturationIndex, 2) : null,
      price_tier_distribution: priceTiers,
      top_competitors: competitors.slice(0, 8),
      total_attractiveness: totalAttr != null ? round(totalAttr, 1) : null,
    },
    market_share: {
      data_available: impliedMedian != null,
      estimated_restaurants_in_trade_area: expectedRestaurants,
      fair_share_annual_revenue_usd: fairShare != null ? round(fairShare) : null,
      entrant_multiplier_median: round(multMedian, 2),
      entrant_multiplier_strong: round(multStrong, 2),
      implied_annual_revenue_median_usd: impliedMedian != null ? round(impliedMedian) : null,
      implied_annual_revenue_strong_usd: impliedStrong != null ? round(impliedStrong) : null,
    },
    economics: {
      data_available: medianRent != null,
      median_monthly_rent_usd: medianRent != null ? round(medianRent) : null,
      median_rent_per_sqft_usd: medianSqft != null ? round(medianSqft, 2) : null,
      required_monthly_revenue_at_8pct_usd: requiredRevenue != null ? round(requiredRevenue) : null,
      bottom_up_monthly_revenue_range_usd: bottomUp,
      breakeven_covers_per_day: breakevenCovers,
    },
    traffic: {
      data_available: segments.length > 0,
      max_aadt: maxAadt,
      segments,
    },
    data_sources: sources,
    gaps,
  };
}

/**
 * Compact bilingual digest of computed metrics for prompt injection.
 * Free tier appends this to the market brief; specialists receive the full object.
 */
export function formatMetricsDigest(m: SiteMetrics, lang: 'en' | 'zh'): string {
  const L: string[] = [];
  const zh = lang === 'zh';
  L.push(zh ? '【量化指标（公式计算，非估算）】' : '[COMPUTED METRICS (formula-derived, not estimated)]');

  if (m.demand.data_available) {
    L.push(
      zh
        ? `- 需求池：贸易区约 ${m.demand.trade_area_households?.toLocaleString() ?? '?'} 户 × 年外出就餐支出 ~$${m.demand.fafh_per_household_usd?.toLocaleString() ?? '?'}/户 = 年需求池 ~$${m.demand.trade_area_fafh_pool_usd?.toLocaleString() ?? '?'}（BLS CEX 基准按收入弹性0.8调整）`
        : `- Demand pool: ~${m.demand.trade_area_households?.toLocaleString() ?? '?'} households × ~$${m.demand.fafh_per_household_usd?.toLocaleString() ?? '?'}/yr food-away-from-home = ~$${m.demand.trade_area_fafh_pool_usd?.toLocaleString() ?? '?'}/yr trade-area pool (BLS CEX base, income elasticity 0.8)`,
    );
  }
  if (m.competition.data_available) {
    const sat =
      m.competition.saturation_index != null
        ? zh
          ? `饱和指数 ${m.competition.saturation_index}（>1 表示高于美国均值 2.2 家/千人）`
          : `saturation index ${m.competition.saturation_index} (>1 = above the 2.2/1k-resident US norm)`
        : zh
          ? '饱和度不可计算'
          : 'saturation not computable';
    L.push(
      zh
        ? `- 竞争：样本 ${m.competition.competitor_count} 家，均分 ${m.competition.avg_rating ?? '?'}★，${sat}`
        : `- Competition: sample n=${m.competition.competitor_count}, avg ${m.competition.avg_rating ?? '?'}★, ${sat}`,
    );
  }
  if (m.market_share.data_available) {
    L.push(
      zh
        ? `- 公平份额模型：贸易区估计约 ${m.market_share.estimated_restaurants_in_trade_area?.toLocaleString()} 家餐厅分食需求池 → 平均每家年营收 ~$${m.market_share.fair_share_annual_revenue_usd?.toLocaleString()}；新店（4.2★中位，吸引力乘数 ${m.market_share.entrant_multiplier_median}x）隐含年营收 ~$${m.market_share.implied_annual_revenue_median_usd?.toLocaleString()}；强执行（4.6★，${m.market_share.entrant_multiplier_strong}x）→ ~$${m.market_share.implied_annual_revenue_strong_usd?.toLocaleString()}`
        : `- Fair-share model: ~${m.market_share.estimated_restaurants_in_trade_area?.toLocaleString()} restaurants split the trade-area pool → avg unit ~$${m.market_share.fair_share_annual_revenue_usd?.toLocaleString()}/yr; median entrant (4.2★, ${m.market_share.entrant_multiplier_median}x attractiveness) implies ~$${m.market_share.implied_annual_revenue_median_usd?.toLocaleString()}/yr; strong operator (4.6★, ${m.market_share.entrant_multiplier_strong}x) → ~$${m.market_share.implied_annual_revenue_strong_usd?.toLocaleString()}/yr`,
    );
  }
  if (m.economics.data_available) {
    L.push(
      zh
        ? `- 租金经济：市场中位月租 ~$${m.economics.median_monthly_rent_usd?.toLocaleString()}，按8%租售比需月营收 ≥$${m.economics.required_monthly_revenue_at_8pct_usd?.toLocaleString()}（即日均 ${m.economics.breakeven_covers_per_day ?? '?'} 单）`
        : `- Rent economics: median asking ~$${m.economics.median_monthly_rent_usd?.toLocaleString()}/mo → needs ≥$${m.economics.required_monthly_revenue_at_8pct_usd?.toLocaleString()}/mo revenue at the 8% occupancy line (~${m.economics.breakeven_covers_per_day ?? '?'} covers/day)`,
    );
  }
  if (m.economics.bottom_up_monthly_revenue_range_usd) {
    const [lo, hi] = m.economics.bottom_up_monthly_revenue_range_usd;
    L.push(
      zh
        ? `- 产能上限（自下而上）：该业态典型月营收区间 $${lo.toLocaleString()}–$${hi.toLocaleString()}`
        : `- Capacity check (bottom-up): typical monthly revenue band for this format $${lo.toLocaleString()}–$${hi.toLocaleString()}`,
    );
  }
  if (m.traffic.data_available) {
    L.push(
      zh
        ? `- 车流：最高 AADT ${m.traffic.max_aadt?.toLocaleString()}（Caltrans 州级公路）`
        : `- Traffic: max AADT ${m.traffic.max_aadt?.toLocaleString()} (Caltrans state highways)`,
    );
  }
  if (m.gaps.length) {
    L.push(zh ? `- 数据缺口：${m.gaps.join('；')}` : `- Data gaps: ${m.gaps.join(' | ')}`);
  }
  return L.join('\n');
}
