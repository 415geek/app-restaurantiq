/**
 * v4 §1.3 异常输入阻断 — the input sanity layer.
 *
 * The report that prompted this: a $400/month storefront on Grant Ave. The free
 * tier flagged it as implausible and the paid tier used it anyway, computed an
 * occupancy cost of 0.8%, scored financial viability 90 and pushed the overall
 * score into GO. A number the customer almost certainly mistyped (or quoted as
 * NNN base, or as a promotional period) decided the verdict.
 *
 * Rule: an input that fails a sanity check does NOT enter any score until the
 * customer confirms what it is. The report says what was flagged, against what
 * benchmark, and asks. Until the answer arrives the dependent dimension reads
 * 待确认 and the verdict is locked at CONDITIONAL_GO (lib/iq/conclusion).
 *
 * Benchmarks, in order of preference:
 *   1. a corridor median the caller passes in (rent comps), ±tolerance;
 *   2. the $/sqft band when a size is known;
 *   3. the cost-tier rent floor from defaults.yaml — a storefront in a hcol
 *      metro does not rent for $400/month, whatever the corridor.
 * Every threshold lives in defaults.yaml `input_sanity`; nothing is a literal here.
 */
import { getDefaults } from '../params';
import type { InputSanityFlag } from '../model/schema';
import type { CostTier } from '../conclusion/cost-scale';
import { archetypeFor, tierFor } from './finance';

export type RentConfirmation = NonNullable<InputSanityFlag['confirmation']>;
export const RENT_CONFIRMATIONS: readonly RentConfirmation[] = ['net', 'nnn_base', 'promo', 'typo'];

export interface InputSanityInput {
  cuisine: string;
  rent_usd: number | null;
  sqft: number | null;
  ticket_in: number | null;
  /** For the cost tier (same resolution the finance engine uses). */
  median_income: number | null;
  state: string | null;
  /** Corridor median monthly rent for a comparable size, when rent comps exist. */
  corridor_rent_usd?: { value: number; source: string } | null;
  /** The customer's answer from the confirmation bar, if any. */
  rent_confirmation?: RentConfirmation | null;
}

const round = (n: number) => Math.round(n);

/**
 * Pure. Returns one flag per failing input; an empty array means every input is
 * plausible (or absent). A confirmed flag is still returned — the report keeps
 * printing what was questioned and what the customer said — but no longer
 * blocks scoring, except `typo`, which means the value must not be used at all.
 */
export function checkInputSanity(input: InputSanityInput): InputSanityFlag[] {
  const p = getDefaults().input_sanity;
  const tier: CostTier = tierFor(input.median_income, input.state);
  const flags: InputSanityFlag[] = [];

  if (input.rent_usd != null) {
    const rent = input.rent_usd;
    let flag: Omit<InputSanityFlag, 'blocks_scoring' | 'confirmation' | 'confirmed'> | null = null;
    const corridor = input.corridor_rent_usd ?? null;
    if (corridor && corridor.value > 0) {
      const lo = corridor.value * (1 - p.corridor_tolerance);
      const hi = corridor.value * (1 + p.corridor_tolerance);
      if (rent < lo) flag = { field: 'rent_usd', value: rent, reason: 'below_corridor', benchmark: { value: round(corridor.value), label: 'corridor_median_monthly', source: corridor.source } };
      else if (rent > hi) flag = { field: 'rent_usd', value: rent, reason: 'above_corridor', benchmark: { value: round(corridor.value), label: 'corridor_median_monthly', source: corridor.source } };
    }
    if (!flag && input.sqft != null && input.sqft > 0) {
      const psf = rent / input.sqft;
      if (psf < p.rent_psf_month.min) flag = { field: 'rent_usd', value: rent, reason: 'below_floor', benchmark: { value: round(p.rent_psf_month.min * input.sqft), label: 'psf_band_min_monthly', source: 'defaults.yaml input_sanity.rent_psf_month' } };
      else if (psf > p.rent_psf_month.max) flag = { field: 'rent_usd', value: rent, reason: 'above_corridor', benchmark: { value: round(p.rent_psf_month.max * input.sqft), label: 'psf_band_max_monthly', source: 'defaults.yaml input_sanity.rent_psf_month' } };
    }
    if (!flag) {
      const floor = p.rent_floor_usd[tier];
      if (rent < floor) flag = { field: 'rent_usd', value: rent, reason: 'below_floor', benchmark: { value: floor, label: `tier_floor_${tier}`, source: 'defaults.yaml input_sanity.rent_floor_usd' } };
    }
    if (flag) {
      const answer = input.rent_confirmation ?? null;
      const confirmed = answer != null;
      // `typo` confirms the flag was right: the number is withdrawn, not scored.
      const blocks = !confirmed || answer === 'typo';
      flags.push({ ...flag, blocks_scoring: blocks, confirmation: answer, confirmed });
    }
  }

  if (input.sqft != null && (input.sqft < p.sqft.min || input.sqft > p.sqft.max)) {
    flags.push({
      field: 'sqft',
      value: input.sqft,
      reason: 'size_concept_mismatch',
      benchmark: { value: input.sqft < p.sqft.min ? p.sqft.min : p.sqft.max, label: 'plausible_sqft_band', source: 'defaults.yaml input_sanity.sqft' },
      // Size feeds seats and $/sqft only; it is kept, but the report says it looks wrong.
      blocks_scoring: false,
      confirmation: null,
      confirmed: false,
    });
  }

  if (input.ticket_in != null) {
    const ref = archetypeFor(input.cuisine).ticket_in;
    if (ref > 0 && (input.ticket_in < ref * p.ticket_multiple.min || input.ticket_in > ref * p.ticket_multiple.max)) {
      flags.push({
        field: 'ticket_in',
        value: input.ticket_in,
        reason: 'ticket_out_of_band',
        benchmark: { value: ref, label: 'concept_default_ticket', source: 'cuisine_taxonomy.yaml ticket_in' },
        // A ticket 3× the concept's norm rewrites revenue; the concept default is used until confirmed.
        blocks_scoring: true,
        confirmation: null,
        confirmed: false,
      });
    }
  }

  return flags;
}

/** True when a flag for `field` keeps that input out of the scores. */
export function inputBlocked(flags: InputSanityFlag[], field: InputSanityFlag['field']): boolean {
  return flags.some((f) => f.field === field && f.blocks_scoring);
}
