/**
 * 评审 Spec §4.1 单一结论源 (P0-A) — THE fixed-cost scale.
 *
 * Before this module the paid report ran two finance engines with two private
 * copies of the same constants: `lib/iq/engines/finance.ts` (360°) scaled the
 * non-rent fixed budget by 30/12/8/25 % at a flat wage of 22/18/15, while
 * `lib/funnel/iq-finance-model.ts` (web standard report) scaled a *different*
 * baseline by 32/16/12/22 % at 22/20/17/14 with a fourth "hcol_metro" tier.
 * The same egg-tart report therefore printed utilities $1,920 on one surface and
 * $1,260 on the other, and two different break-even lines.
 *
 * Now both engines resolve (concept → archetype) and (income/state → cost tier)
 * HERE, and read the amounts from the single `cost_scale` block of
 * lib/iq/params/defaults.yaml. There is no other place a wage, a utilities share
 * or a baseline fixed budget may be written down.
 *
 * Rent is deliberately absent: it is never estimated (owner rule
 * 「当用户没输入租金信息时，请不要把你认为的租金信息填上」). When the customer
 * gave none, both engines report a rent-excluded model.
 */
import { cuisineById, getDefaults, type ConceptCategory, type CuisineDef } from '../params';

export type CostTier = 'hcol' | 'mcol' | 'lcol';

/** Cost archetypes — the keys of `cost_scale.concepts` in defaults.yaml. */
export const ARCHETYPE_IDS = [
  'bubble_tea',
  'coffee_bakery',
  'qsr',
  'fast_casual',
  'pizza',
  'asian_casual',
  'casual_dining',
  'fine_dining',
] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

/** Concept category → cost archetype. Subtype exceptions below. */
const CATEGORY_ARCHETYPE: Record<ConceptCategory, ArchetypeId> = {
  chinese_regional: 'asian_casual',
  chinese_format: 'asian_casual',
  asian_other: 'asian_casual',
  bakery_dessert: 'coffee_bakery',
  beverage: 'bubble_tea',
  western_other: 'casual_dining',
};

/** Taxonomy id → cost archetype, where the category alone would be wrong. */
const SUBTYPE_ARCHETYPE: Record<string, ArchetypeId> = {
  hot_pot: 'casual_dining',
  skewers: 'casual_dining',
  chinese_fast: 'qsr',
  mala_tang: 'fast_casual',
  roast: 'qsr',
  noodles: 'fast_casual',
  hk_cafe: 'fast_casual',
  italian: 'pizza',
  mexican: 'fast_casual',
  middle_eastern: 'fast_casual',
};

/**
 * The cost archetype of a concept. Both engines call this, so an "egg tart"
 * shop can never be a bakery on one surface and a fast-casual on the other.
 */
export function archetypeIdFor(cuisine: string | CuisineDef): ArchetypeId {
  const cu = typeof cuisine === 'string' ? cuisineById(cuisine) : cuisine;
  return SUBTYPE_ARCHETYPE[cu.id] ?? CATEGORY_ARCHETYPE[cu.category] ?? 'fast_casual';
}

/** Cost tier from the ring / tract household income, with a state fallback when income is unknown. */
export function costTierFor(median_income: number | null | undefined, state: string | null | undefined): CostTier {
  const cs = getDefaults().cost_scale;
  const inc = typeof median_income === 'number' && Number.isFinite(median_income) ? median_income : null;
  if (inc != null) {
    if (inc >= cs.tiers.hcol.min_median_income) return 'hcol';
    if (inc >= cs.tiers.mcol.min_median_income) return 'mcol';
    return 'lcol';
  }
  const st = (state ?? '').trim().toUpperCase();
  if (!st) return 'mcol';
  return cs.hcol_states.some((s) => s.toUpperCase() === st) ? 'hcol' : 'mcol';
}

/** Blended hourly wage of a tier (loaded by `labor.load_factor` inside `laborMonthlyUsd`). */
export function wageUsdPerHour(tier: CostTier): number {
  return getDefaults().cost_scale.tiers[tier].wage_usd_per_hour;
}

export function laborLoadFactor(): number {
  return getDefaults().cost_scale.labor.load_factor;
}

export function hoursPerFteMonth(): number {
  return getDefaults().cost_scale.labor.hours_per_fte_month;
}

/** Monthly loaded labor cost — the ONE formula (FTE × wage × hours × payroll load). */
export function laborMonthlyUsd(headcount: number, tier: CostTier): number {
  const l = getDefaults().cost_scale.labor;
  return Math.round(headcount * wageUsdPerHour(tier) * l.hours_per_fte_month * l.load_factor);
}

/** Default headcount of an archetype; the taxonomy `fte_default` wins when the concept declares one. */
export function headcountFor(archetype: ArchetypeId): number {
  return getDefaults().cost_scale.concepts[archetype].headcount;
}

export interface FixedCostScale {
  tier: CostTier;
  archetype: ArchetypeId;
  /** Baseline (mcol) non-rent fixed budget of the archetype. */
  baseline_usd: number;
  /** Tier multiplier applied to the baseline. */
  multiplier: number;
  /** baseline × multiplier, i.e. utilities + insurance + pos + marketing + misc. */
  other_fixed_total: number;
  utilities: number;
  insurance: number;
  pos: number;
  marketing: number;
  /** The remainder, so the five rows always add up to `other_fixed_total` exactly. */
  misc: number;
}

/**
 * Utilities / insurance / POS / marketing / misc for a concept at a cost tier.
 * Identical output in both engines for the same (concept, tier) — that identity
 * is asserted by lib/iq/conclusion/conclusion.test.ts.
 */
export function fixedCostScaleFor(cuisine: string | CuisineDef, tier: CostTier): FixedCostScale {
  const cs = getDefaults().cost_scale;
  const archetype = archetypeIdFor(cuisine);
  return fixedCostScaleForArchetype(archetype, tier, cs.concepts[archetype].other_fixed_usd);
}

/** Same table, entered by archetype id (the funnel engine resolves the archetype itself). */
export function fixedCostScaleForArchetype(archetype: ArchetypeId, tier: CostTier, baselineOverride?: number): FixedCostScale {
  const cs = getDefaults().cost_scale;
  const baseline_usd = baselineOverride ?? cs.concepts[archetype].other_fixed_usd;
  const multiplier = cs.tiers[tier].other_fixed_multiplier;
  const other_fixed_total = Math.round(baseline_usd * multiplier);
  const utilities = Math.round(other_fixed_total * cs.split.utilities);
  const insurance = Math.round(other_fixed_total * cs.split.insurance);
  const pos = Math.round(other_fixed_total * cs.split.pos);
  const marketing = Math.round(other_fixed_total * cs.split.marketing);
  return {
    tier,
    archetype,
    baseline_usd,
    multiplier,
    other_fixed_total,
    utilities,
    insurance,
    pos,
    marketing,
    misc: other_fixed_total - utilities - insurance - pos - marketing,
  };
}

/** Human-readable provenance for a cost row ("~30% of the non-rent fixed budget × tier 1.12"). */
export function costScaleNote(scale: FixedCostScale, share: number): string {
  return `~${Math.round(share * 100)}% of the $${scale.baseline_usd.toLocaleString('en-US')} non-rent fixed budget × ${scale.tier} tier scale ${scale.multiplier.toFixed(2)} (cost_scale, defaults.yaml)`;
}

/** The split shares, for callers that need to label the rows. */
export function costSplit(): { utilities: number; insurance: number; pos: number; marketing: number; misc: number } {
  const s = getDefaults().cost_scale.split;
  return { ...s, misc: Math.round((1 - s.utilities - s.insurance - s.pos - s.marketing) * 1000) / 1000 };
}
