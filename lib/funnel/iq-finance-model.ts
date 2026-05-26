/**
 * Deterministic restaurant break-even & safe-revenue model.
 *
 * Replaces the LLM's "guessed" `risk_audit.break_even_revenue_monthly_usd` and
 * `risk_audit.safe_revenue_monthly_usd` with a formula-driven calculation
 * grounded in:
 *   - user inputs (monthly rent, sqft) when provided
 *   - ACS county median household income (drives wage / rent tier when unknown)
 *   - commercial_listings median rent (LoopNet) when user didn't provide rent
 *   - cuisine archetype (food cost %, headcount, ticket band, prime cost target)
 *
 * Formula (industry-standard pre-lease P&L):
 *   fixed_total = rent + labor + utilities + insurance + pos + marketing + misc
 *   variable_rate = food_cost_pct + cc_fees_pct + delivery_blended_pct + paper_pct
 *   break_even_revenue = fixed_total / (1 - variable_rate)
 *   safe_revenue = break_even × 1.25  (covers ~5% owner takeout + 5% reinvest + 15% buffer)
 *
 * Returns a structured model containing every assumption used, so the LLM and UI
 * can cite the numbers verbatim (no hallucinated cost tables).
 */
import type { CommercialListingsResult } from '@/lib/funnel/external-data/commercial-listings';

export interface FinanceModelInputs {
  marketData: Record<string, unknown> | null | undefined;
  businessType: string | null | undefined;
  location: string;
}

export type CuisineArchetypeId =
  | 'bubble_tea'
  | 'coffee_bakery'
  | 'qsr'
  | 'fast_casual'
  | 'pizza'
  | 'asian_casual'
  | 'casual_dining'
  | 'fine_dining';

export interface CuisineArchetype {
  id: CuisineArchetypeId;
  label_en: string;
  label_zh: string;
  /** Average ticket size USD (mid of band). */
  avg_ticket_usd: number;
  /** Food cost as share of revenue (COGS). */
  food_cost_pct: number;
  /** Paper goods / packaging as share of revenue. */
  paper_pct: number;
  /** FTE-equivalent core headcount (manager + line). Hourly assumed. */
  headcount: number;
  /** Avg shift hours/month per FTE (40 hr/wk × 4.33 ≈ 173). */
  hours_per_fte_month: number;
  /** Baseline non-rent fixed costs (utilities, insurance, POS, marketing, misc). */
  baseline_other_fixed_usd: number;
  /** Cuisine-specific safety-margin floor (for "safe revenue" multiplier). */
  safe_revenue_multiplier: number;
}

export interface DeterministicFinanceModel {
  version: '1.0';
  generated_at: string;

  /** Selected cuisine archetype + why it was chosen. */
  cuisine_archetype: CuisineArchetypeId;
  cuisine_archetype_label_en: string;
  cuisine_archetype_label_zh: string;
  cuisine_match_reason: string;

  /** Resolved rent USD/month + provenance trail. */
  monthly_rent_usd: number;
  rent_source: 'user_input' | 'commercial_listings_median' | 'sqft_estimate' | 'tier_estimate';
  rent_evidence: string;

  /** Resolved labor USD/month. */
  monthly_labor_usd: number;
  labor_headcount: number;
  hourly_wage_blended_usd: number;
  labor_evidence: string;

  /** Other recurring fixed costs (non-rent / non-labor). */
  monthly_other_fixed_usd: number;
  monthly_utilities_usd: number;
  monthly_insurance_usd: number;
  monthly_pos_software_usd: number;
  monthly_marketing_usd: number;
  monthly_misc_usd: number;

  /** Sum of fixed costs. */
  fixed_total_monthly_usd: number;

  /** Variable-cost rate components (sum to total_variable_rate). */
  food_cost_pct: number;
  paper_pct: number;
  cc_fees_pct: number;
  delivery_blended_pct: number;
  total_variable_rate: number; // 0–1
  contribution_margin_rate: number; // 1 - total_variable_rate

  /** Headline outputs. */
  break_even_revenue_monthly_usd: number;
  safe_revenue_monthly_usd: number;
  break_even_daily_revenue_usd: number;
  safe_daily_revenue_usd: number;

  /** Cover counts at avg ticket (operator-friendly KPI). */
  avg_ticket_usd: number;
  daily_covers_needed_breakeven: number;
  daily_covers_needed_safe: number;

  /** Cost-breakdown rows (compatible with risk_audit.cost_breakdown shape). */
  cost_breakdown: Array<{ item: string; amount_usd: number; note: string }>;

  /** Confidence in the model (drives UI badge). */
  confidence: 'high' | 'medium' | 'low';
  confidence_reasons: string[];

  /** Audit trail: every key assumption + its source for LLM/UI display. */
  assumptions: string[];

  /** Pre-formatted markdown citations block (e.g. "[user-input]", "[ACS-2023]", "[LoopNet]", "[industry-benchmark]"). */
  citations: string[];
}

/* ------------------------------------------------------------------------ */
/*                       Cuisine archetype lookup table                       */
/* ------------------------------------------------------------------------ */

const ARCHETYPES: Record<CuisineArchetypeId, CuisineArchetype> = {
  bubble_tea: {
    id: 'bubble_tea',
    label_en: 'Bubble tea / boba shop',
    label_zh: '奶茶 / 茶饮店',
    avg_ticket_usd: 8.5,
    food_cost_pct: 0.28,
    paper_pct: 0.04,
    headcount: 5,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 4_500,
    safe_revenue_multiplier: 1.25,
  },
  coffee_bakery: {
    id: 'coffee_bakery',
    label_en: 'Coffee shop / bakery / dessert',
    label_zh: '咖啡 / 烘焙 / 甜品店',
    avg_ticket_usd: 11,
    food_cost_pct: 0.30,
    paper_pct: 0.03,
    headcount: 6,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 4_800,
    safe_revenue_multiplier: 1.25,
  },
  qsr: {
    id: 'qsr',
    label_en: 'QSR / fast food',
    label_zh: '快餐 / QSR',
    avg_ticket_usd: 13,
    food_cost_pct: 0.30,
    paper_pct: 0.03,
    headcount: 8,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 6_000,
    safe_revenue_multiplier: 1.28,
  },
  fast_casual: {
    id: 'fast_casual',
    label_en: 'Fast casual',
    label_zh: '快休闲餐饮',
    avg_ticket_usd: 16,
    food_cost_pct: 0.31,
    paper_pct: 0.025,
    headcount: 10,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 7_200,
    safe_revenue_multiplier: 1.28,
  },
  pizza: {
    id: 'pizza',
    label_en: 'Pizza / Italian QSR',
    label_zh: '披萨 / 意式快餐',
    avg_ticket_usd: 22,
    food_cost_pct: 0.30,
    paper_pct: 0.025,
    headcount: 9,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 6_500,
    safe_revenue_multiplier: 1.28,
  },
  asian_casual: {
    id: 'asian_casual',
    label_en: 'Asian casual (Chinese / Japanese / Thai / Korean / Vietnamese)',
    label_zh: '亚洲休闲餐厅（中/日/泰/韩/越）',
    avg_ticket_usd: 21,
    food_cost_pct: 0.32,
    paper_pct: 0.02,
    headcount: 12,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 7_800,
    safe_revenue_multiplier: 1.30,
  },
  casual_dining: {
    id: 'casual_dining',
    label_en: 'Casual dining (full service)',
    label_zh: '休闲正餐（堂食服务）',
    avg_ticket_usd: 26,
    food_cost_pct: 0.32,
    paper_pct: 0.015,
    headcount: 16,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 9_000,
    safe_revenue_multiplier: 1.30,
  },
  fine_dining: {
    id: 'fine_dining',
    label_en: 'Fine dining',
    label_zh: '高端正餐',
    avg_ticket_usd: 70,
    food_cost_pct: 0.35,
    paper_pct: 0.01,
    headcount: 25,
    hours_per_fte_month: 173,
    baseline_other_fixed_usd: 14_000,
    safe_revenue_multiplier: 1.35,
  },
};

function detectArchetype(businessType: string | null | undefined): {
  archetype: CuisineArchetype;
  reason_en: string;
  reason_zh: string;
} {
  const raw = (businessType ?? '').toLowerCase().trim();
  if (!raw) {
    return {
      archetype: ARCHETYPES.fast_casual,
      reason_en: 'No cuisine specified → defaulted to fast_casual benchmarks.',
      reason_zh: '未指定业态 → 默认采用快休闲餐饮基准。',
    };
  }
  const matchers: Array<{ test: RegExp; id: CuisineArchetypeId; reason_en: string; reason_zh: string }> = [
    {
      test: /(bubble\s*tea|boba|奶茶|茶饮|tea\s*shop|奶盖|珍珠|brew\s*tea)/i,
      id: 'bubble_tea',
      reason_en: 'Matched "bubble tea / boba / 奶茶" → bubble_tea archetype.',
      reason_zh: '匹配「奶茶 / 茶饮 / 珍珠 / boba」→ 选用奶茶店模型。',
    },
    {
      test: /(coffee|cafe|café|espresso|latte|bakery|pastry|dessert|甜品|咖啡|烘焙|面包|蛋糕|甜点)/i,
      id: 'coffee_bakery',
      reason_en: 'Matched coffee/bakery/dessert keyword → coffee_bakery archetype.',
      reason_zh: '匹配咖啡/烘焙/甜品类关键词 → 选用咖啡烘焙模型。',
    },
    {
      test: /(fine\s*dining|tasting\s*menu|michelin|chef[''']s\s*table|高端|米其林|品鉴菜单)/i,
      id: 'fine_dining',
      reason_en: 'Matched fine-dining keyword → fine_dining archetype.',
      reason_zh: '匹配高端正餐关键词 → 选用高端正餐模型。',
    },
    {
      test: /(pizza|pizzeria|披萨|比萨)/i,
      id: 'pizza',
      reason_en: 'Matched pizza keyword → pizza archetype.',
      reason_zh: '匹配披萨/比萨关键词 → 选用披萨模型。',
    },
    {
      test: /(chinese|sichuan|cantonese|dim\s*sum|hot\s*pot|sushi|japanese|ramen|izakaya|thai|korean|kbbq|vietnamese|pho|banh\s*mi|asian|中餐|川菜|粤菜|火锅|日料|寿司|拉面|居酒屋|泰式|韩式|韩国|越南|河粉)/i,
      id: 'asian_casual',
      reason_en: 'Matched Asian-cuisine keyword → asian_casual archetype.',
      reason_zh: '匹配亚洲餐饮关键词 → 选用亚洲休闲餐厅模型。',
    },
    {
      test: /(fast\s*casual|chipotle|sweetgreen|build[-\s]your[-\s]own|快休闲|快\s*休闲)/i,
      id: 'fast_casual',
      reason_en: 'Matched fast-casual keyword → fast_casual archetype.',
      reason_zh: '匹配快休闲关键词 → 选用快休闲餐饮模型。',
    },
    {
      test: /(qsr|fast\s*food|burger|fried\s*chicken|taco|sandwich|sub|deli|快餐|汉堡|炸鸡|墨西哥|三明治)/i,
      id: 'qsr',
      reason_en: 'Matched QSR / fast-food keyword → qsr archetype.',
      reason_zh: '匹配快餐 / 汉堡 / 炸鸡 等关键词 → 选用 QSR 模型。',
    },
    {
      test: /(restaurant|bistro|grill|dining|餐厅|餐馆|小馆|烧烤|料理)/i,
      id: 'casual_dining',
      reason_en: 'Matched generic full-service restaurant keyword → casual_dining archetype.',
      reason_zh: '匹配通用堂食/正餐关键词 → 选用休闲正餐模型。',
    },
  ];
  for (const m of matchers) {
    if (m.test.test(raw)) {
      return { archetype: ARCHETYPES[m.id], reason_en: m.reason_en, reason_zh: m.reason_zh };
    }
  }
  return {
    archetype: ARCHETYPES.fast_casual,
    reason_en: `Cuisine "${businessType}" did not match any archetype → defaulted to fast_casual.`,
    reason_zh: `业态「${businessType}」未匹配现有模型 → 默认采用快休闲餐饮基准。`,
  };
}

/* ------------------------------------------------------------------------ */
/*                         Wage / rent tier resolution                        */
/* ------------------------------------------------------------------------ */

type CostTier = 'hcol_metro' | 'hcol' | 'mcol' | 'lcol';

interface TierBenchmarks {
  hourly_wage_usd: number; // blended hourly wage (loaded includes payroll tax via labor_loading)
  rent_psf_monthly_usd: number; // retail food space, NNN, per sqft per month
  description_en: string;
  description_zh: string;
}

const TIER_BENCHMARKS: Record<CostTier, TierBenchmarks> = {
  hcol_metro: {
    hourly_wage_usd: 22,
    rent_psf_monthly_usd: 8.5,
    description_en: 'Top-tier metro (SF/NYC/LA core; MHI ≥ $130k)',
    description_zh: '顶级都会（旧金山/纽约/洛杉矶核心；中位家庭收入 ≥ $13万）',
  },
  hcol: {
    hourly_wage_usd: 20,
    rent_psf_monthly_usd: 6.5,
    description_en: 'High cost-of-living (MHI $100k–$130k)',
    description_zh: '高生活成本（中位家庭收入 $10–13万）',
  },
  mcol: {
    hourly_wage_usd: 17,
    rent_psf_monthly_usd: 4.5,
    description_en: 'Medium cost-of-living (MHI $70k–$100k)',
    description_zh: '中等生活成本（中位家庭收入 $7–10万）',
  },
  lcol: {
    hourly_wage_usd: 14,
    rent_psf_monthly_usd: 3.0,
    description_en: 'Low cost-of-living (MHI < $70k)',
    description_zh: '低生活成本（中位家庭收入 < $7万）',
  },
};

const HCOL_METRO_STATES = new Set(['california', 'ca', 'new york', 'ny', 'massachusetts', 'ma']);

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickAcsCounty(marketData: Record<string, unknown> | null | undefined) {
  const acs = marketData?.acs_context;
  if (!acs || typeof acs !== 'object') return null;
  const county = (acs as Record<string, unknown>).county;
  if (!county || typeof county !== 'object') return null;
  return county as Record<string, unknown>;
}

function pickAcsTract(marketData: Record<string, unknown> | null | undefined) {
  const acs = marketData?.acs_context;
  if (!acs || typeof acs !== 'object') return null;
  const tract_avail = (acs as Record<string, unknown>).tract_data_available;
  if (tract_avail !== true) return null;
  const tract = (acs as Record<string, unknown>).tract;
  if (!tract || typeof tract !== 'object') return null;
  return tract as Record<string, unknown>;
}

function resolveCostTier(marketData: Record<string, unknown> | null | undefined): {
  tier: CostTier;
  benchmarks: TierBenchmarks;
  source_label: string;
  mhi_used_usd: number | null;
} {
  const tract = pickAcsTract(marketData);
  const county = pickAcsCounty(marketData);

  const tractMhi = num(tract?.median_household_income_usd);
  const countyMhi = num(county?.median_household_income_usd);
  const mhi = tractMhi ?? countyMhi;

  const stateRaw =
    (marketData?.geocode as Record<string, unknown> | undefined)?.state ??
    (county?.name as string | undefined) ??
    '';
  const stateStr = String(stateRaw).toLowerCase();
  const isHcolMetroState = [...HCOL_METRO_STATES].some((s) => stateStr.includes(s));

  let tier: CostTier;
  if (mhi == null) {
    tier = isHcolMetroState ? 'hcol' : 'mcol';
  } else if (mhi >= 130_000 && isHcolMetroState) {
    tier = 'hcol_metro';
  } else if (mhi >= 100_000) {
    tier = 'hcol';
  } else if (mhi >= 70_000) {
    tier = 'mcol';
  } else {
    tier = 'lcol';
  }
  return {
    tier,
    benchmarks: TIER_BENCHMARKS[tier],
    source_label: mhi != null
      ? `ACS county MHI=$${Math.round(mhi).toLocaleString('en-US')}`
      : 'ACS unavailable; defaulted by state',
    mhi_used_usd: mhi ?? null,
  };
}

/* ------------------------------------------------------------------------ */
/*                            Rent resolution                                */
/* ------------------------------------------------------------------------ */

function listingsMedianRent(marketData: Record<string, unknown> | null | undefined): {
  median_usd: number | null;
  sample_count: number;
} {
  const cl = marketData?.commercial_listings as CommercialListingsResult | undefined;
  if (!cl || typeof cl !== 'object') return { median_usd: null, sample_count: 0 };
  const rows = Array.isArray(cl.listings) ? cl.listings : [];
  const rents = rows
    .map((r) => num(r?.monthlyRent))
    .filter((n): n is number => n != null && n > 1_000 && n < 60_000)
    .sort((a, b) => a - b);
  if (rents.length === 0) return { median_usd: null, sample_count: 0 };
  const mid = Math.floor(rents.length / 2);
  const median = rents.length % 2 === 0 ? (rents[mid - 1] + rents[mid]) / 2 : rents[mid];
  return { median_usd: Math.round(median), sample_count: rents.length };
}

function pickUserInputs(marketData: Record<string, unknown> | null | undefined) {
  const ui = marketData?.user_inputs;
  if (!ui || typeof ui !== 'object') return { monthly_rent_usd: null as number | null, sqft: null as number | null };
  const u = ui as Record<string, unknown>;
  return {
    monthly_rent_usd: num(u.monthly_rent_usd),
    sqft: num(u.sqft),
  };
}

function resolveRent(
  archetype: CuisineArchetype,
  marketData: Record<string, unknown> | null | undefined,
  tierResult: ReturnType<typeof resolveCostTier>,
): {
  monthly_rent_usd: number;
  source: DeterministicFinanceModel['rent_source'];
  evidence: string;
} {
  const ui = pickUserInputs(marketData);
  if (ui.monthly_rent_usd != null && ui.monthly_rent_usd > 800) {
    return {
      monthly_rent_usd: Math.round(ui.monthly_rent_usd),
      source: 'user_input',
      evidence: `user_inputs.monthly_rent_usd=${ui.monthly_rent_usd}`,
    };
  }

  // Estimate sqft if not provided (archetype default footprint).
  const defaultSqft: Record<CuisineArchetypeId, number> = {
    bubble_tea: 700,
    coffee_bakery: 900,
    qsr: 1_200,
    fast_casual: 1_800,
    pizza: 1_500,
    asian_casual: 2_200,
    casual_dining: 2_800,
    fine_dining: 3_500,
  };
  const sqftAssumed = ui.sqft != null && ui.sqft >= 300 ? ui.sqft : defaultSqft[archetype.id];

  // If user gave sqft → tier × sqft is the most defensible estimate.
  if (ui.sqft != null && ui.sqft >= 300) {
    const r = Math.round(ui.sqft * tierResult.benchmarks.rent_psf_monthly_usd);
    return {
      monthly_rent_usd: r,
      source: 'sqft_estimate',
      evidence: `user sqft=${ui.sqft} × tier rent $${tierResult.benchmarks.rent_psf_monthly_usd}/sqft/mo (${tierResult.tier})`,
    };
  }

  // Try commercial_listings median (LoopNet etc.)
  const listings = listingsMedianRent(marketData);
  if (listings.median_usd != null && listings.sample_count >= 2) {
    return {
      monthly_rent_usd: listings.median_usd,
      source: 'commercial_listings_median',
      evidence: `LoopNet/commercial_listings median rent (n=${listings.sample_count}) = $${listings.median_usd.toLocaleString('en-US')}/mo`,
    };
  }

  // Final fallback: tier × archetype default sqft.
  const r = Math.round(sqftAssumed * tierResult.benchmarks.rent_psf_monthly_usd);
  return {
    monthly_rent_usd: r,
    source: 'tier_estimate',
    evidence: `archetype default ${sqftAssumed} sqft × ${tierResult.tier} tier $${tierResult.benchmarks.rent_psf_monthly_usd}/sqft/mo (${tierResult.source_label})`,
  };
}

/* ------------------------------------------------------------------------ */
/*                              Labor calc                                   */
/* ------------------------------------------------------------------------ */

function resolveLabor(
  archetype: CuisineArchetype,
  tierResult: ReturnType<typeof resolveCostTier>,
): { monthly_labor_usd: number; hourly_blended: number; evidence: string } {
  const hourly = tierResult.benchmarks.hourly_wage_usd;
  const LOAD_FACTOR = 1.18; // payroll tax + benefits
  const monthly = archetype.headcount * hourly * archetype.hours_per_fte_month * LOAD_FACTOR;
  const evidence = `${archetype.headcount} FTE × $${hourly}/hr × ${archetype.hours_per_fte_month} hrs/mo × ${LOAD_FACTOR}× payroll load (tier ${tierResult.tier}, ${tierResult.source_label})`;
  return { monthly_labor_usd: Math.round(monthly), hourly_blended: hourly, evidence };
}

/* ------------------------------------------------------------------------ */
/*                              Main compute                                 */
/* ------------------------------------------------------------------------ */

const CC_FEES_PCT = 0.025;
const DELIVERY_BLENDED_PCT = 0.07; // assume 25% revenue at 28% commission ≈ 7% of revenue blended
const SAFETY_FLOOR = 1.20; // never drop safe-revenue multiplier below this

export function computeFinanceModel(input: FinanceModelInputs): DeterministicFinanceModel {
  const { marketData, businessType, location } = input;
  void location;

  const { archetype, reason_en, reason_zh } = detectArchetype(businessType);
  const tierResult = resolveCostTier(marketData);
  const rent = resolveRent(archetype, marketData, tierResult);
  const labor = resolveLabor(archetype, tierResult);

  // Other fixed costs: 70% baseline + 30% tier-scaled
  const tierScale = tierResult.tier === 'hcol_metro' ? 1.25 : tierResult.tier === 'hcol' ? 1.12 : tierResult.tier === 'lcol' ? 0.88 : 1.0;
  const scaledOther = Math.round(archetype.baseline_other_fixed_usd * tierScale);
  // Decompose for breakdown visibility (industry typical mix):
  const utilities = Math.round(scaledOther * 0.32);
  const insurance = Math.round(scaledOther * 0.16);
  const pos = Math.round(scaledOther * 0.12);
  const marketing = Math.round(scaledOther * 0.22);
  const misc = scaledOther - utilities - insurance - pos - marketing;

  const fixed_total = rent.monthly_rent_usd + labor.monthly_labor_usd + utilities + insurance + pos + marketing + misc;

  const variable_rate = archetype.food_cost_pct + archetype.paper_pct + CC_FEES_PCT + DELIVERY_BLENDED_PCT;
  const contribution_margin = Math.max(0.15, 1 - variable_rate); // guardrail
  const break_even = Math.round(fixed_total / contribution_margin);
  const safe_multiplier = Math.max(SAFETY_FLOOR, archetype.safe_revenue_multiplier);
  const safe = Math.round(break_even * safe_multiplier);

  const days = 30;
  const breakEvenDaily = Math.round(break_even / days);
  const safeDaily = Math.round(safe / days);
  const breakEvenCovers = Math.max(1, Math.round(breakEvenDaily / archetype.avg_ticket_usd));
  const safeCovers = Math.max(1, Math.round(safeDaily / archetype.avg_ticket_usd));

  // Confidence: high when ≥3 of {user_rent, user_sqft, ACS, listings} confirmed
  const ui = pickUserInputs(marketData);
  const acs = !!pickAcsTract(marketData) || !!pickAcsCounty(marketData);
  const haveListings = listingsMedianRent(marketData).sample_count >= 2;
  const signals = [
    ui.monthly_rent_usd != null,
    ui.sqft != null,
    acs,
    haveListings,
  ];
  const positives = signals.filter(Boolean).length;
  const confidence: 'high' | 'medium' | 'low' = positives >= 3 ? 'high' : positives >= 2 ? 'medium' : 'low';
  const confidence_reasons: string[] = [];
  if (ui.monthly_rent_usd != null) confidence_reasons.push('user-provided monthly rent');
  if (ui.sqft != null) confidence_reasons.push('user-provided sqft');
  if (acs) confidence_reasons.push('ACS county/tract anchors');
  if (haveListings) confidence_reasons.push('commercial-listings rent sample');
  if (confidence_reasons.length === 0) confidence_reasons.push('address + cuisine + tier defaults only');

  const cost_breakdown: DeterministicFinanceModel['cost_breakdown'] = [
    { item: 'Rent (NNN)', amount_usd: rent.monthly_rent_usd, note: rent.evidence },
    { item: 'Labor (loaded)', amount_usd: labor.monthly_labor_usd, note: labor.evidence },
    { item: 'Utilities', amount_usd: utilities, note: `~32% of baseline non-rent fixed × tier scale ${tierScale.toFixed(2)}` },
    { item: 'Insurance', amount_usd: insurance, note: `~16% of baseline non-rent fixed × tier scale ${tierScale.toFixed(2)}` },
    { item: 'POS / software', amount_usd: pos, note: `~12% of baseline non-rent fixed × tier scale ${tierScale.toFixed(2)}` },
    { item: 'Marketing / loyalty', amount_usd: marketing, note: `~22% of baseline non-rent fixed × tier scale ${tierScale.toFixed(2)}` },
    { item: 'Misc / admin', amount_usd: misc, note: `~18% of baseline non-rent fixed × tier scale ${tierScale.toFixed(2)}` },
    { item: 'Fixed total / mo', amount_usd: fixed_total, note: 'Sum of rent + labor + other fixed' },
  ];

  const assumptions = [
    `Cuisine archetype: ${archetype.label_en} (${reason_en})`,
    `Average ticket: $${archetype.avg_ticket_usd} (industry-benchmark for ${archetype.label_en})`,
    `Food cost: ${(archetype.food_cost_pct * 100).toFixed(0)}% of revenue (COGS); paper goods: ${(archetype.paper_pct * 100).toFixed(1)}%`,
    `Variable cost rate: food ${(archetype.food_cost_pct * 100).toFixed(0)}% + paper ${(archetype.paper_pct * 100).toFixed(1)}% + CC fees ${(CC_FEES_PCT * 100).toFixed(1)}% + delivery commission blended ${(DELIVERY_BLENDED_PCT * 100).toFixed(1)}% = ${(variable_rate * 100).toFixed(1)}%`,
    `Contribution margin: ${(contribution_margin * 100).toFixed(1)}%`,
    `Rent: $${rent.monthly_rent_usd.toLocaleString('en-US')}/mo — ${rent.evidence}`,
    `Labor: $${labor.monthly_labor_usd.toLocaleString('en-US')}/mo — ${labor.evidence}`,
    `Other fixed (utilities + insurance + POS + marketing + misc): $${scaledOther.toLocaleString('en-US')}/mo (baseline $${archetype.baseline_other_fixed_usd.toLocaleString('en-US')} × tier scale ${tierScale.toFixed(2)})`,
    `Break-even revenue = fixed total ($${fixed_total.toLocaleString('en-US')}) / contribution margin (${(contribution_margin * 100).toFixed(1)}%) = $${break_even.toLocaleString('en-US')}/mo`,
    `Safe revenue = break-even × ${safe_multiplier.toFixed(2)} (cushion for owner takeout + reinvest + seasonality) = $${safe.toLocaleString('en-US')}/mo`,
    `Daily run-rate: break-even $${breakEvenDaily.toLocaleString('en-US')}/day (~${breakEvenCovers} covers @ $${archetype.avg_ticket_usd}); safe $${safeDaily.toLocaleString('en-US')}/day (~${safeCovers} covers).`,
  ];

  const citations: string[] = [];
  if (ui.monthly_rent_usd != null) citations.push('[user-input rent]');
  if (ui.sqft != null) citations.push('[user-input sqft]');
  if (acs) citations.push('[ACS-2023]');
  if (haveListings) citations.push('[commercial-listings]');
  citations.push('[industry-benchmark: prime-cost / contribution-margin]');

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),

    cuisine_archetype: archetype.id,
    cuisine_archetype_label_en: archetype.label_en,
    cuisine_archetype_label_zh: archetype.label_zh,
    cuisine_match_reason: `${reason_en} / ${reason_zh}`,

    monthly_rent_usd: rent.monthly_rent_usd,
    rent_source: rent.source,
    rent_evidence: rent.evidence,

    monthly_labor_usd: labor.monthly_labor_usd,
    labor_headcount: archetype.headcount,
    hourly_wage_blended_usd: labor.hourly_blended,
    labor_evidence: labor.evidence,

    monthly_other_fixed_usd: scaledOther,
    monthly_utilities_usd: utilities,
    monthly_insurance_usd: insurance,
    monthly_pos_software_usd: pos,
    monthly_marketing_usd: marketing,
    monthly_misc_usd: misc,

    fixed_total_monthly_usd: fixed_total,

    food_cost_pct: archetype.food_cost_pct,
    paper_pct: archetype.paper_pct,
    cc_fees_pct: CC_FEES_PCT,
    delivery_blended_pct: DELIVERY_BLENDED_PCT,
    total_variable_rate: variable_rate,
    contribution_margin_rate: contribution_margin,

    break_even_revenue_monthly_usd: break_even,
    safe_revenue_monthly_usd: safe,
    break_even_daily_revenue_usd: breakEvenDaily,
    safe_daily_revenue_usd: safeDaily,

    avg_ticket_usd: archetype.avg_ticket_usd,
    daily_covers_needed_breakeven: breakEvenCovers,
    daily_covers_needed_safe: safeCovers,

    cost_breakdown,
    confidence,
    confidence_reasons,
    assumptions,
    citations,
  };
}

/* ------------------------------------------------------------------------ */
/*                       LLM anchor block formatter                          */
/* ------------------------------------------------------------------------ */

export function formatFinanceModelForAnchors(
  fm: DeterministicFinanceModel,
  lang: 'en' | 'zh',
): string {
  if (lang === 'zh') {
    const lines = [
      '\n\n【确定性盈亏平衡模型——硬锚点（D-4，必须在 risk_audit.break_even_revenue_monthly_usd / safe_revenue_monthly_usd / cost_breakdown 中**逐字使用**，禁止 LLM 自行重新估算）】',
      `- 业态原型：${fm.cuisine_archetype_label_zh}（${fm.cuisine_archetype}）`,
      `- 月租金（USD）：$${fm.monthly_rent_usd.toLocaleString('en-US')} — 依据：${fm.rent_evidence}`,
      `- 月人工成本（已加 18% 工资税/福利负载）：$${fm.monthly_labor_usd.toLocaleString('en-US')} — 依据：${fm.labor_evidence}`,
      `- 其他固定成本（水电+保险+POS+营销+杂项）合计：$${fm.monthly_other_fixed_usd.toLocaleString('en-US')}`,
      `  · 水电：$${fm.monthly_utilities_usd.toLocaleString('en-US')}；保险：$${fm.monthly_insurance_usd.toLocaleString('en-US')}；POS/软件：$${fm.monthly_pos_software_usd.toLocaleString('en-US')}；营销：$${fm.monthly_marketing_usd.toLocaleString('en-US')}；杂项：$${fm.monthly_misc_usd.toLocaleString('en-US')}`,
      `- 固定成本合计：$${fm.fixed_total_monthly_usd.toLocaleString('en-US')}/月`,
      `- 可变成本率：食材 ${(fm.food_cost_pct * 100).toFixed(0)}% + 包装 ${(fm.paper_pct * 100).toFixed(1)}% + 信用卡费 ${(fm.cc_fees_pct * 100).toFixed(1)}% + 外卖佣金混合 ${(fm.delivery_blended_pct * 100).toFixed(1)}% = ${(fm.total_variable_rate * 100).toFixed(1)}%`,
      `- 边际贡献率：${(fm.contribution_margin_rate * 100).toFixed(1)}%`,
      '',
      `- 【硬约束 1】break_even_revenue_monthly_usd 必须 = ${fm.break_even_revenue_monthly_usd}（USD/月）`,
      `- 【硬约束 2】safe_revenue_monthly_usd 必须 = ${fm.safe_revenue_monthly_usd}（USD/月；保本 × ${(fm.safe_revenue_monthly_usd / Math.max(1, fm.break_even_revenue_monthly_usd)).toFixed(2)}）`,
      `- 【硬约束 3】cost_breakdown 至少包含以下 8 行（item / amount_usd / note 须一致）：Rent / Labor / Utilities / Insurance / POS / Marketing / Misc / Fixed total`,
      `- 【硬约束 4】revenue_model.breakeven 与 revenue_model.scenarios 的 key_assumptions 必须显式引用上述客单价 $${fm.avg_ticket_usd}、每日保本覆盖数 ${fm.daily_covers_needed_breakeven}、安全覆盖数 ${fm.daily_covers_needed_safe}；禁止使用与本表冲突的数字。`,
      `- 引用标签建议：${fm.citations.join('、')}；模型置信度：${fm.confidence}（依据：${fm.confidence_reasons.join('；')}）`,
      '',
      '【写作铁律——D-4】',
      '- 任何关于「需要多少营收才能活下去 / 才能赚钱 / 每天多少单」的叙述，**必须**直接引用上面 4 条硬约束的具体数字，不得自行四舍五入或单独估算。',
      '- 若你认为锚点不合理（例如租金偏低/偏高），可在 risk_matrix 中提出「rent_assumption_risk」一行说明，但**不得**修改 break_even / safe_revenue 的数值。',
      '',
    ];
    return lines.join('\n');
  }

  const lines = [
    '\n\n[DETERMINISTIC BREAK-EVEN MODEL — HARD ANCHORS (D-4; LLM MUST use these numbers verbatim in risk_audit.break_even_revenue_monthly_usd / safe_revenue_monthly_usd / cost_breakdown — DO NOT re-estimate)]',
    `- Cuisine archetype: ${fm.cuisine_archetype_label_en} (${fm.cuisine_archetype})`,
    `- Monthly rent (USD): $${fm.monthly_rent_usd.toLocaleString('en-US')} — basis: ${fm.rent_evidence}`,
    `- Monthly labor (loaded 1.18× payroll tax/benefits): $${fm.monthly_labor_usd.toLocaleString('en-US')} — basis: ${fm.labor_evidence}`,
    `- Other fixed (utilities + insurance + POS + marketing + misc) total: $${fm.monthly_other_fixed_usd.toLocaleString('en-US')}`,
    `  · Utilities $${fm.monthly_utilities_usd.toLocaleString('en-US')}; Insurance $${fm.monthly_insurance_usd.toLocaleString('en-US')}; POS $${fm.monthly_pos_software_usd.toLocaleString('en-US')}; Marketing $${fm.monthly_marketing_usd.toLocaleString('en-US')}; Misc $${fm.monthly_misc_usd.toLocaleString('en-US')}`,
    `- Fixed total: $${fm.fixed_total_monthly_usd.toLocaleString('en-US')}/mo`,
    `- Variable rate: food ${(fm.food_cost_pct * 100).toFixed(0)}% + paper ${(fm.paper_pct * 100).toFixed(1)}% + CC ${(fm.cc_fees_pct * 100).toFixed(1)}% + delivery commission blended ${(fm.delivery_blended_pct * 100).toFixed(1)}% = ${(fm.total_variable_rate * 100).toFixed(1)}%`,
    `- Contribution margin: ${(fm.contribution_margin_rate * 100).toFixed(1)}%`,
    '',
    `- [HARD RULE 1] risk_audit.break_even_revenue_monthly_usd MUST equal ${fm.break_even_revenue_monthly_usd} (USD/mo)`,
    `- [HARD RULE 2] risk_audit.safe_revenue_monthly_usd MUST equal ${fm.safe_revenue_monthly_usd} (USD/mo; break-even × ${(fm.safe_revenue_monthly_usd / Math.max(1, fm.break_even_revenue_monthly_usd)).toFixed(2)})`,
    `- [HARD RULE 3] cost_breakdown MUST contain at least these 8 rows (item / amount_usd / note must match): Rent / Labor / Utilities / Insurance / POS / Marketing / Misc / Fixed total`,
    `- [HARD RULE 4] revenue_model.breakeven AND every revenue_model.scenarios.key_assumptions MUST explicitly cite avg ticket $${fm.avg_ticket_usd}, daily breakeven covers ${fm.daily_covers_needed_breakeven}, daily safe covers ${fm.daily_covers_needed_safe}; NO numbers that contradict this table.`,
    `- Suggested citation tags: ${fm.citations.join(', ')}; model confidence: ${fm.confidence} (reasons: ${fm.confidence_reasons.join('; ')}).`,
    '',
    '[NARRATIVE RULES — D-4]',
    '- Any prose about "how much revenue is needed to survive / break even / daily orders" MUST quote the 4 hard rules above verbatim. NO independent rounding, NO separate guesses.',
    '- If you believe an anchor is unreasonable (e.g. rent looks low/high), add a "rent_assumption_risk" row to risk_matrix explaining the gap, but DO NOT change the break_even / safe_revenue numbers.',
    '',
  ];
  return lines.join('\n');
}
