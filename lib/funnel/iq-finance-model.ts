/**
 * Deterministic restaurant break-even & safe-revenue model (web standard report).
 *
 * 评审 Spec §4.1 单一结论源 (P0-A): this engine no longer owns any cost constant.
 * Wages, the non-rent fixed budget and its utilities / insurance / POS / marketing
 * / misc split all come from the ONE `cost_scale` table in
 * lib/iq/params/defaults.yaml, through lib/iq/conclusion/cost-scale.ts — the same
 * helpers the 360° engine (lib/iq/engines/finance.ts) calls. For the same concept
 * and cost tier both engines now return identical cost rows; before P0-A they
 * printed $1,920 and $1,260 of utilities for the same paid report.
 *
 * Rent is NEVER estimated (owner rule): when the customer gave no monthly rent the
 * model is rent-excluded — `monthly_rent_usd` is 0, `rent_excluded` is true, and
 * break-even / safe revenue / occupancy are computed and labelled without rent,
 * exactly as the 360° engine does.
 *
 * Formula (industry-standard pre-lease P&L):
 *   fixed_total = rent + labor + utilities + insurance + pos + marketing + misc
 *   variable_rate = food_cost_pct + cc_fees_pct + delivery_blended_pct + paper_pct
 *   break_even_revenue = fixed_total / (1 - variable_rate)
 *   safe_revenue = break_even × finance.safety_multiplier (defaults.yaml)
 *
 * Returns a structured model containing every assumption used, so the LLM and UI
 * can cite the numbers verbatim (no hallucinated cost tables).
 */
import { type Locale, pick } from '@/lib/i18n/locale';
import { classifyConceptSync } from '@/lib/iq/concept/classify';
import {
  archetypeIdFor,
  costScaleNote,
  costSplit,
  costTierFor,
  fixedCostScaleForArchetype,
  headcountFor,
  hoursPerFteMonth,
  laborLoadFactor,
  laborMonthlyUsd,
  wageUsdPerHour,
  type ArchetypeId,
  type CostTier,
} from '@/lib/iq/conclusion/cost-scale';
import { cuisineById, getDefaults } from '@/lib/iq/params';

export interface FinanceModelInputs {
  marketData: Record<string, unknown> | null | undefined;
  businessType: string | null | undefined;
  location: string;
}

/** The archetype ids of the shared `cost_scale` table (lib/iq/conclusion/cost-scale.ts). */
export type CuisineArchetypeId = ArchetypeId;

export interface CuisineArchetype {
  id: CuisineArchetypeId;
  label_en: string;
  label_zh: string;
  label_es: string;
  /** Average ticket size USD (mid of band). */
  avg_ticket_usd: number;
  /** Food cost as share of revenue (COGS). */
  food_cost_pct: number;
  /** Paper goods / packaging as share of revenue. */
  paper_pct: number;
  /** FTE-equivalent core headcount (taxonomy `fte_default`, else the cost_scale default). */
  headcount: number;
}

export interface DeterministicFinanceModel {
  version: '1.0';
  generated_at: string;

  /** Selected cuisine archetype + why it was chosen. */
  cuisine_archetype: CuisineArchetypeId;
  cuisine_archetype_label_en: string;
  cuisine_archetype_label_zh: string;
  /** Optional only so models persisted before Spanish support still parse; always set by computeFinanceModel. */
  cuisine_archetype_label_es?: string;
  cuisine_match_reason: string;

  /** The customer's monthly rent, or 0 when none was given (rent is NEVER estimated). */
  monthly_rent_usd: number;
  rent_source: 'user_input' | 'not_provided';
  rent_evidence: string;
  /** True when no rent was provided: fixed total, break-even, safe revenue and occupancy EXCLUDE rent. */
  rent_excluded: boolean;

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

  /** Occupancy cost % = monthly rent / safe revenue (NRA-style headline KPI). */
  occupancy_cost_pct_at_safe: number;
  occupancy_cost_pct_at_breakeven: number;
  occupancy_nra_benchmark_note_en: string;
  occupancy_nra_benchmark_note_zh: string;
  occupancy_nra_benchmark_note_es?: string;
}

/** Localized archetype label (English fallback for models stored before Spanish support). */
export function financeArchetypeLabel(fm: Pick<DeterministicFinanceModel, 'cuisine_archetype_label_en' | 'cuisine_archetype_label_zh' | 'cuisine_archetype_label_es'>, lang: Locale): string {
  return pick(lang, {
    en: fm.cuisine_archetype_label_en,
    zh: fm.cuisine_archetype_label_zh,
    es: fm.cuisine_archetype_label_es || fm.cuisine_archetype_label_en,
  });
}

/* ------------------------------------------------------------------------ */
/*                       Cuisine archetype lookup table                       */
/* ------------------------------------------------------------------------ */

type ArchetypeBase = Omit<CuisineArchetype, 'headcount'>;

/** Ticket band + variable-cost benchmarks. Headcount and every $ figure come from `cost_scale`. */
const ARCHETYPES: Record<CuisineArchetypeId, ArchetypeBase> = {
  bubble_tea: {
    id: 'bubble_tea',
    label_en: 'Bubble tea / boba shop',
    label_zh: '奶茶 / 茶饮店',
    label_es: 'Tienda de té de burbujas / boba',
    avg_ticket_usd: 8.5,
    food_cost_pct: 0.28,
    paper_pct: 0.04,
  },
  coffee_bakery: {
    id: 'coffee_bakery',
    label_en: 'Coffee shop / bakery / dessert',
    label_zh: '咖啡 / 烘焙 / 甜品店',
    label_es: 'Cafetería / panadería / postres',
    avg_ticket_usd: 11,
    food_cost_pct: 0.30,
    paper_pct: 0.03,
  },
  qsr: {
    id: 'qsr',
    label_en: 'QSR / fast food',
    label_zh: '快餐 / QSR',
    label_es: 'Comida rápida / QSR',
    avg_ticket_usd: 13,
    food_cost_pct: 0.30,
    paper_pct: 0.03,
  },
  fast_casual: {
    id: 'fast_casual',
    label_en: 'Fast casual',
    label_zh: '快休闲餐饮',
    label_es: 'Fast casual',
    avg_ticket_usd: 16,
    food_cost_pct: 0.31,
    paper_pct: 0.025,
  },
  pizza: {
    id: 'pizza',
    label_en: 'Pizza / Italian QSR',
    label_zh: '披萨 / 意式快餐',
    label_es: 'Pizza / comida rápida italiana',
    avg_ticket_usd: 22,
    food_cost_pct: 0.30,
    paper_pct: 0.025,
  },
  asian_casual: {
    id: 'asian_casual',
    label_en: 'Asian casual (Chinese / Japanese / Thai / Korean / Vietnamese)',
    label_zh: '亚洲休闲餐厅（中/日/泰/韩/越）',
    label_es: 'Asiático casual (chino / japonés / tailandés / coreano / vietnamita)',
    avg_ticket_usd: 21,
    food_cost_pct: 0.32,
    paper_pct: 0.02,
  },
  casual_dining: {
    id: 'casual_dining',
    label_en: 'Casual dining (full service)',
    label_zh: '休闲正餐（堂食服务）',
    label_es: 'Restaurante casual (servicio completo)',
    avg_ticket_usd: 26,
    food_cost_pct: 0.32,
    paper_pct: 0.015,
  },
  fine_dining: {
    id: 'fine_dining',
    label_en: 'Fine dining',
    label_zh: '高端正餐',
    label_es: 'Alta cocina',
    avg_ticket_usd: 70,
    food_cost_pct: 0.35,
    paper_pct: 0.01,
  },
};

/**
 * §4.1 单一结论源: concept → archetype is resolved by the SHARED `archetypeIdFor`
 * (lib/iq/conclusion/cost-scale.ts), so this engine and the 360° engine can never
 * put the same concept in two different cost archetypes.
 */

/** An archetype row completed with the headcount the shared table (or the taxonomy) gives it. */
function withHeadcount(base: ArchetypeBase, fteDefault?: number | null): CuisineArchetype {
  return { ...base, headcount: fteDefault ?? headcountFor(base.id) };
}

/**
 * Tier 1/2 archetype: the §4.1 concept classifier first (category → archetype,
 * headcount and ticket from the taxonomy entry), the keyword regex list only
 * when the dictionary cannot place the text, fast_casual last.
 */
export function detectArchetype(businessType: string | null | undefined): {
  archetype: CuisineArchetype;
  reason_en: string;
  reason_zh: string;
} {
  const raw = (businessType ?? '').toLowerCase().trim();
  if (!raw) {
    return {
      archetype: withHeadcount(ARCHETYPES.fast_casual),
      reason_en: 'No cuisine specified → defaulted to fast_casual benchmarks.',
      reason_zh: '未指定业态 → 默认采用快休闲餐饮基准。',
    };
  }
  const concept = classifyConceptSync(businessType ?? '');
  if (!concept.needs_confirmation) {
    const entry = cuisineById(concept.id);
    const id = archetypeIdFor(entry);
    const archetype: CuisineArchetype = {
      ...withHeadcount(ARCHETYPES[id], entry.fte_default),
      avg_ticket_usd: entry.ticket_in,
    };
    return {
      archetype,
      reason_en: `Concept "${concept.label_en}" (${concept.category}, matched "${concept.matched}") → ${id} archetype; ${archetype.headcount} FTE and $${archetype.avg_ticket_usd} ticket from the concept taxonomy.`,
      reason_zh: `业态「${concept.label_zh}」（${concept.category}，匹配「${concept.matched}」）→ ${id} 模型；人手 ${archetype.headcount} 人、客单价 $${archetype.avg_ticket_usd} 取自业态分类表。`,
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
      return { archetype: withHeadcount(ARCHETYPES[m.id]), reason_en: m.reason_en, reason_zh: m.reason_zh };
    }
  }
  return {
    archetype: withHeadcount(ARCHETYPES.fast_casual),
    reason_en: `Cuisine "${businessType}" did not match any archetype → defaulted to fast_casual.`,
    reason_zh: `业态「${businessType}」未匹配现有模型 → 默认采用快休闲餐饮基准。`,
  };
}

/* ------------------------------------------------------------------------ */
/*                    Wage tier resolution (shared cost_scale)                */
/* ------------------------------------------------------------------------ */

/**
 * §4.1 单一结论源: the tiers, their wages and their multipliers live in
 * `cost_scale` (defaults.yaml). The fourth "hcol_metro" tier this engine used to
 * carry is gone — it was the reason the same address produced a $20/hr wage here
 * and $22/hr in the 360°. Rent $/sf benchmarks are gone too: rent is never estimated.
 */

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

/** Two-letter state code out of whatever the market pack carries ("California", "CA, USA", …). */
function stateCodeOf(marketData: Record<string, unknown> | null | undefined, county: Record<string, unknown> | null): string | null {
  const raw = String(
    (marketData?.geocode as Record<string, unknown> | undefined)?.state ?? (county?.name as string | undefined) ?? '',
  ).trim();
  if (!raw) return null;
  const NAMES: Record<string, string> = { california: 'CA', 'new york': 'NY', washington: 'WA', massachusetts: 'MA', hawaii: 'HI', 'district of columbia': 'DC', 'new jersey': 'NJ' };
  const lower = raw.toLowerCase();
  for (const [name, code] of Object.entries(NAMES)) if (lower.includes(name)) return code;
  const m = /\b([A-Z]{2})\b/.exec(raw.toUpperCase());
  return m ? m[1] : null;
}

function resolveCostTier(marketData: Record<string, unknown> | null | undefined): {
  tier: CostTier;
  source_label: string;
  mhi_used_usd: number | null;
} {
  const tract = pickAcsTract(marketData);
  const county = pickAcsCounty(marketData);
  const mhi = num(tract?.median_household_income_usd) ?? num(county?.median_household_income_usd);
  const tier = costTierFor(mhi, stateCodeOf(marketData, county));
  return {
    tier,
    source_label: mhi != null ? `ACS MHI=$${Math.round(mhi).toLocaleString('en-US')}` : 'ACS unavailable; defaulted by state',
    mhi_used_usd: mhi ?? null,
  };
}

/* ------------------------------------------------------------------------ */
/*                            Rent resolution                                */
/* ------------------------------------------------------------------------ */

function pickUserInputs(marketData: Record<string, unknown> | null | undefined) {
  const ui = marketData?.user_inputs;
  if (!ui || typeof ui !== 'object') return { monthly_rent_usd: null as number | null, sqft: null as number | null };
  const u = ui as Record<string, unknown>;
  return {
    monthly_rent_usd: num(u.monthly_rent_usd),
    sqft: num(u.sqft),
  };
}

/**
 * The customer's monthly rent — or nothing at all.
 *
 * No listings median, no $/sf × sqft, no tier estimate: a rent the customer never
 * gave must not drive break-even, occupancy cost or the verdict (owner rule, and
 * the rule the 360° engine already shipped). When it is missing the model is
 * rent-excluded and says so everywhere.
 */
function resolveRent(marketData: Record<string, unknown> | null | undefined): {
  monthly_rent_usd: number;
  source: DeterministicFinanceModel['rent_source'];
  evidence: string;
  excluded: boolean;
} {
  const ui = pickUserInputs(marketData);
  if (ui.monthly_rent_usd != null && ui.monthly_rent_usd > 800) {
    return {
      monthly_rent_usd: Math.round(ui.monthly_rent_usd),
      source: 'user_input',
      evidence: `user_inputs.monthly_rent_usd=${ui.monthly_rent_usd}`,
      excluded: false,
    };
  }
  return {
    monthly_rent_usd: 0,
    source: 'not_provided',
    evidence: 'no monthly rent was provided — rent is never estimated; break-even and safe revenue EXCLUDE rent',
    excluded: true,
  };
}

/* ------------------------------------------------------------------------ */
/*                              Labor calc                                   */
/* ------------------------------------------------------------------------ */

/** Labor from the shared formula — the same one lib/iq/engines/finance.ts calls. */
function resolveLabor(
  archetype: CuisineArchetype,
  tierResult: ReturnType<typeof resolveCostTier>,
): { monthly_labor_usd: number; hourly_blended: number; evidence: string } {
  const hourly = wageUsdPerHour(tierResult.tier);
  const hours = hoursPerFteMonth();
  const load = laborLoadFactor();
  const evidence = `${archetype.headcount} FTE × $${hourly}/hr × ${hours} hrs/mo × ${load}× payroll load (cost_scale tier ${tierResult.tier}, ${tierResult.source_label})`;
  return { monthly_labor_usd: laborMonthlyUsd(archetype.headcount, tierResult.tier), hourly_blended: hourly, evidence };
}

/* ------------------------------------------------------------------------ */
/*                              Main compute                                 */
/* ------------------------------------------------------------------------ */

export function computeFinanceModel(input: FinanceModelInputs): DeterministicFinanceModel {
  const { marketData, businessType, location } = input;
  void location;
  // §4.1 单一结论源: every rate below comes from defaults.yaml, so the two engines
  // share one contribution margin and one safety multiplier as well.
  const d = getDefaults().finance;
  const CC_FEES_PCT = d.cc_fees_pct;
  const DELIVERY_BLENDED_PCT = d.delivery_blended_pct;

  const { archetype, reason_en, reason_zh } = detectArchetype(businessType);
  const tierResult = resolveCostTier(marketData);
  const rent = resolveRent(marketData);
  const labor = resolveLabor(archetype, tierResult);

  // The five non-rent fixed rows — from the ONE cost_scale table.
  const scale = fixedCostScaleForArchetype(archetype.id, tierResult.tier);
  const split = costSplit();
  const { utilities, insurance, pos, marketing, misc } = scale;
  const scaledOther = scale.other_fixed_total;

  // Excludes rent when the customer gave none (declared by rent_excluded, never silently).
  const fixed_total = rent.monthly_rent_usd + labor.monthly_labor_usd + utilities + insurance + pos + marketing + misc;

  const variable_rate = archetype.food_cost_pct + archetype.paper_pct + CC_FEES_PCT + DELIVERY_BLENDED_PCT;
  const contribution_margin = Math.max(0.15, 1 - variable_rate); // guardrail
  const break_even = Math.round(fixed_total / contribution_margin);
  const safe_multiplier = d.safety_multiplier;
  const safe = Math.round(break_even * safe_multiplier);

  const days = d.days_open_per_month;
  const breakEvenDaily = Math.round(break_even / days);
  const safeDaily = Math.round(safe / days);
  const breakEvenCovers = Math.max(1, Math.round(breakEvenDaily / archetype.avg_ticket_usd));
  const safeCovers = Math.max(1, Math.round(safeDaily / archetype.avg_ticket_usd));

  // Confidence: high when ≥3 of {user_rent, user_sqft, ACS, listings} confirmed
  const ui = pickUserInputs(marketData);
  const acs = !!pickAcsTract(marketData) || !!pickAcsCounty(marketData);
  const signals = [ui.monthly_rent_usd != null, ui.sqft != null, acs];
  const positives = signals.filter(Boolean).length;
  const confidence: 'high' | 'medium' | 'low' = positives >= 3 ? 'high' : positives >= 2 ? 'medium' : 'low';
  const confidence_reasons: string[] = [];
  if (ui.monthly_rent_usd != null) confidence_reasons.push('user-provided monthly rent');
  if (ui.sqft != null) confidence_reasons.push('user-provided sqft');
  if (acs) confidence_reasons.push('ACS county/tract anchors');
  if (confidence_reasons.length === 0) confidence_reasons.push('address + cuisine + tier defaults only');

  const cost_breakdown: DeterministicFinanceModel['cost_breakdown'] = [
    { item: 'Rent (NNN)', amount_usd: rent.monthly_rent_usd, note: rent.evidence },
    { item: 'Labor (loaded)', amount_usd: labor.monthly_labor_usd, note: labor.evidence },
    { item: 'Utilities', amount_usd: utilities, note: costScaleNote(scale, split.utilities) },
    { item: 'Insurance', amount_usd: insurance, note: costScaleNote(scale, split.insurance) },
    { item: 'POS / software', amount_usd: pos, note: costScaleNote(scale, split.pos) },
    { item: 'Marketing / loyalty', amount_usd: marketing, note: costScaleNote(scale, split.marketing) },
    { item: 'Misc / admin', amount_usd: misc, note: costScaleNote(scale, split.misc) },
    { item: 'Fixed total / mo', amount_usd: fixed_total, note: rent.excluded ? 'Sum of labor + other fixed — EXCLUDES rent (none was provided; rent is never estimated)' : 'Sum of rent + labor + other fixed' },
  ];

  const assumptions = [
    `Cuisine archetype: ${archetype.label_en} (${reason_en})`,
    `Average ticket: $${archetype.avg_ticket_usd} (industry-benchmark for ${archetype.label_en})`,
    `Food cost: ${(archetype.food_cost_pct * 100).toFixed(0)}% of revenue (COGS); paper goods: ${(archetype.paper_pct * 100).toFixed(1)}%`,
    `Variable cost rate: food ${(archetype.food_cost_pct * 100).toFixed(0)}% + paper ${(archetype.paper_pct * 100).toFixed(1)}% + CC fees ${(CC_FEES_PCT * 100).toFixed(1)}% + delivery commission blended ${(DELIVERY_BLENDED_PCT * 100).toFixed(1)}% = ${(variable_rate * 100).toFixed(1)}%`,
    `Contribution margin: ${(contribution_margin * 100).toFixed(1)}%`,
    `Rent: $${rent.monthly_rent_usd.toLocaleString('en-US')}/mo — ${rent.evidence}`,
    `Labor: $${labor.monthly_labor_usd.toLocaleString('en-US')}/mo — ${labor.evidence}`,
    `Other fixed (utilities + insurance + POS + marketing + misc): $${scaledOther.toLocaleString('en-US')}/mo (cost_scale baseline $${scale.baseline_usd.toLocaleString('en-US')} × ${scale.tier} tier scale ${scale.multiplier.toFixed(2)})`,
    `Break-even revenue = fixed total ($${fixed_total.toLocaleString('en-US')}) / contribution margin (${(contribution_margin * 100).toFixed(1)}%) = $${break_even.toLocaleString('en-US')}/mo`,
    `Safe revenue = break-even × ${safe_multiplier.toFixed(2)} (cushion for owner takeout + reinvest + seasonality) = $${safe.toLocaleString('en-US')}/mo`,
    `Daily run-rate: break-even $${breakEvenDaily.toLocaleString('en-US')}/day (~${breakEvenCovers} covers @ $${archetype.avg_ticket_usd}); safe $${safeDaily.toLocaleString('en-US')}/day (~${safeCovers} covers).`,
  ];

  const citations: string[] = [];
  if (ui.monthly_rent_usd != null) citations.push('[user-input rent]');
  if (ui.sqft != null) citations.push('[user-input sqft]');
  if (acs) citations.push('[ACS-2023]');
  citations.push('[industry-benchmark: prime-cost / contribution-margin]');

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),

    cuisine_archetype: archetype.id,
    cuisine_archetype_label_en: archetype.label_en,
    cuisine_archetype_label_zh: archetype.label_zh,
    cuisine_archetype_label_es: archetype.label_es,
    cuisine_match_reason: `${reason_en} / ${reason_zh}`,

    monthly_rent_usd: rent.monthly_rent_usd,
    rent_source: rent.source,
    rent_evidence: rent.evidence,
    rent_excluded: rent.excluded,

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

    // No rent → no occupancy cost. 0 here means "not computable", and every caller
    // must show it as 未获取 rather than as a flattering 0 %.
    occupancy_cost_pct_at_safe: !rent.excluded && safe > 0 ? Math.round((rent.monthly_rent_usd / safe) * 1000) / 10 : 0,
    occupancy_cost_pct_at_breakeven:
      !rent.excluded && break_even > 0 ? Math.round((rent.monthly_rent_usd / break_even) * 1000) / 10 : 0,
    occupancy_nra_benchmark_note_en:
      'NRA 2025 Restaurant Operations Data Abstract medians: full-service occupancy ~5.7% of revenue, limited-service ~5.2%, downtown ~6.0%; healthy band 5–8% (rent + CAM + tax + insurance + utilities as % of sales).',
    occupancy_nra_benchmark_note_zh:
      'NRA 2025 餐饮业数据摘要：全服务占比租金约 5.7% 营业额、有限服务约 5.2%、市中心约 6.0%；健康区间 5–8%（含租金+CAM+物业税+保险+水电）。',
    occupancy_nra_benchmark_note_es:
      'Medianas del NRA 2025 Restaurant Operations Data Abstract: ocupación en servicio completo ~5.7% de los ingresos, servicio limitado ~5.2%, centro urbano ~6.0%; banda saludable 5–8% (renta + CAM + impuestos + seguros + servicios como % de las ventas).',
  };
}

/* ------------------------------------------------------------------------ */
/*                       LLM anchor block formatter                          */
/* ------------------------------------------------------------------------ */

export function formatFinanceModelForAnchors(
  fm: DeterministicFinanceModel,
  lang: Locale,
): string {
  const usd = (v: number) => v.toLocaleString('en-US');
  if (lang === 'es') {
    const lines = [
      '\n\n[MODELO DETERMINISTA DE PUNTO DE EQUILIBRIO — ANCLAJES ESTRICTOS (D-4; el LLM DEBE usar estas cifras textualmente en risk_audit.break_even_revenue_monthly_usd / safe_revenue_monthly_usd / cost_breakdown — NO volver a estimar)]',
      `- Arquetipo de cocina: ${financeArchetypeLabel(fm, 'es')} (${fm.cuisine_archetype})`,
      `- Renta mensual (USD): $${usd(fm.monthly_rent_usd)} — base: ${fm.rent_evidence}`,
      `- Mano de obra mensual (con carga 1.18× de impuestos de nómina/prestaciones): $${usd(fm.monthly_labor_usd)} — base: ${fm.labor_evidence}`,
      `- Otros fijos (servicios + seguros + POS + marketing + varios) total: $${usd(fm.monthly_other_fixed_usd)}`,
      `  · Servicios $${usd(fm.monthly_utilities_usd)}; Seguros $${usd(fm.monthly_insurance_usd)}; POS $${usd(fm.monthly_pos_software_usd)}; Marketing $${usd(fm.monthly_marketing_usd)}; Varios $${usd(fm.monthly_misc_usd)}`,
      `- Total fijo: $${usd(fm.fixed_total_monthly_usd)}/mes`,
      `- Tasa variable: alimentos ${(fm.food_cost_pct * 100).toFixed(0)}% + empaque ${(fm.paper_pct * 100).toFixed(1)}% + comisiones de tarjeta ${(fm.cc_fees_pct * 100).toFixed(1)}% + comisión de delivery ponderada ${(fm.delivery_blended_pct * 100).toFixed(1)}% = ${(fm.total_variable_rate * 100).toFixed(1)}%`,
      `- Margen de contribución: ${(fm.contribution_margin_rate * 100).toFixed(1)}%`,
      '',
      `- [REGLA ESTRICTA 1] risk_audit.break_even_revenue_monthly_usd DEBE ser igual a ${fm.break_even_revenue_monthly_usd} (USD/mes)`,
      `- [REGLA ESTRICTA 2] risk_audit.safe_revenue_monthly_usd DEBE ser igual a ${fm.safe_revenue_monthly_usd} (USD/mes; equilibrio × ${(fm.safe_revenue_monthly_usd / Math.max(1, fm.break_even_revenue_monthly_usd)).toFixed(2)})`,
      `- [REGLA ESTRICTA 3] cost_breakdown DEBE contener al menos estas 8 filas (item / amount_usd / note deben coincidir): Renta / Mano de obra / Servicios / Seguros / POS / Marketing / Varios / Total fijo`,
      `- [REGLA ESTRICTA 4] revenue_model.breakeven Y cada revenue_model.scenarios.key_assumptions DEBEN citar explícitamente el ticket promedio $${fm.avg_ticket_usd}, los cubiertos diarios de equilibrio ${fm.daily_covers_needed_breakeven} y los cubiertos diarios seguros ${fm.daily_covers_needed_safe}; NINGUNA cifra que contradiga esta tabla.`,
      `- [REGLA ESTRICTA 5] dashboard.occupancy_cost_pct DEBE ser igual a ${fm.occupancy_cost_pct_at_safe}% (renta / ingreso seguro); en equilibrio ${fm.occupancy_cost_pct_at_breakeven}%. ${fm.occupancy_nra_benchmark_note_es ?? fm.occupancy_nra_benchmark_note_en}`,
      `- Etiquetas de cita sugeridas: ${fm.citations.join(', ')}; confianza del modelo: ${fm.confidence} (razones: ${fm.confidence_reasons.join('; ')}).`,
      '',
      '[REGLAS NARRATIVAS — D-4]',
      '- Cualquier prosa sobre "cuánto ingreso se necesita para sobrevivir / alcanzar el equilibrio / órdenes diarias" DEBE citar textualmente las 4 reglas estrictas anteriores. SIN redondeos independientes, SIN estimaciones aparte.',
      '- Si consideras que un anclaje no es razonable (p. ej., la renta parece baja/alta), agrega una fila "rent_assumption_risk" a risk_matrix explicando la brecha, pero NO cambies las cifras de break_even / safe_revenue.',
      '',
    ];
    return lines.join('\n');
  }
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
      `- 【硬约束 5】dashboard.occupancy_cost_pct 必须 = ${fm.occupancy_cost_pct_at_safe}%（月租金/安全营收）；保本口径 ${fm.occupancy_cost_pct_at_breakeven}%。${fm.occupancy_nra_benchmark_note_zh}`,
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
    `- [HARD RULE 5] dashboard.occupancy_cost_pct MUST equal ${fm.occupancy_cost_pct_at_safe}% (rent / safe revenue); at break-even ${fm.occupancy_cost_pct_at_breakeven}%. ${fm.occupancy_nra_benchmark_note_en}`,
    `- Suggested citation tags: ${fm.citations.join(', ')}; model confidence: ${fm.confidence} (reasons: ${fm.confidence_reasons.join('; ')}).`,
    '',
    '[NARRATIVE RULES — D-4]',
    '- Any prose about "how much revenue is needed to survive / break even / daily orders" MUST quote the 4 hard rules above verbatim. NO independent rounding, NO separate guesses.',
    '- If you believe an anchor is unreasonable (e.g. rent looks low/high), add a "rent_assumption_risk" row to risk_matrix explaining the gap, but DO NOT change the break_even / safe_revenue numbers.',
    '',
  ];
  return lines.join('\n');
}
