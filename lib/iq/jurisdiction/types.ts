/**
 * 评审 Spec v2 §4.8 物业与许可数据：辖区数据代理 (Jurisdiction Data Agent) — contracts.
 *
 * The question a storefront report must answer is NOT "what does the Zillow
 * listing say about this building" but:
 *
 *   这个铺位以前是不是餐饮？有没有过商用厨房、Type I 排烟罩、隔油池、三相电？
 *
 * §4.8 answers it with an evidence ladder, strongest first:
 *
 *   E1  address's health-department food-facility permit history
 *   E2  address's building / mechanical permits mentioning hood, grease
 *       interceptor, kitchen exhaust — the conversion was already done
 *   E3  prior tenant concept (lib/funnel/external-data/site-history.ts):
 *       a hot-kitchen predecessor ⇒ commercial kitchen very likely
 *   E4  county assessor use code / year built / building area
 *   E5  commercial-listing blurb — where Zillow sits, usually residential;
 *       NEVER a source of `property_facts` (see §4.8.1)
 *
 * Hard rules encoded here:
 *   · `null` on a fact means 未获取. It is never inferred, never filled, and in
 *     particular is never back-filled from `year_built` (the v2 logic hole:
 *     "1912 old building → probably no Type I hood" while the same report knew
 *     the site is run by a hot-kitchen HK café).
 *   · Every fact carries its own evidence level, provenance, license and
 *     confidence, so the renderer can print only what is redistributable.
 */

/** Evidence ladder level. E5 exists to be named and excluded, never produced. */
export type EvidenceLevel = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';

/** Ladder order, strongest first — adapters are called in this order. */
export const EVIDENCE_ORDER: readonly EvidenceLevel[] = ['E1', 'E2', 'E3', 'E4', 'E5'];

export function evidenceRank(e: EvidenceLevel): number {
  const i = EVIDENCE_ORDER.indexOf(e);
  return i < 0 ? EVIDENCE_ORDER.length : i;
}

/**
 * Adapter families. `socrata` and `arcgis_rest` are implemented — between them
 * they cover most US open-data portals and county assessors. The rest are typed
 * stubs that report `not_implemented`; a stub must never fail a report.
 */
export type AdapterType = 'socrata' | 'arcgis_rest' | 'ckan' | 'accela' | 'national_parcel' | 'none';

export const ADAPTER_TYPES: readonly AdapterType[] = [
  'socrata',
  'arcgis_rest',
  'ckan',
  'accela',
  'national_parcel',
  'none',
];

export const IMPLEMENTED_ADAPTER_TYPES: readonly AdapterType[] = ['socrata', 'arcgis_rest'];

export type FactConfidence = 'high' | 'medium' | 'low';

/**
 * One declared data endpoint for one evidence level, exactly as stored in the
 * `jurisdiction_registry` row (§4.8.2).
 *
 * `fields` maps our canonical names onto the dataset's column names:
 *   year_built, use_code, facility_name, permit_type, description, status,
 *   date, street_number, street_name
 */
export interface JurisdictionAdapterSpec {
  evidence: EvidenceLevel;
  type: AdapterType;
  endpoint: string;
  /** Column holding the full street address (or the street name for split schemas). */
  address_field?: string;
  /** For E2: a row only counts as a hood/grease record if its text contains one of these. */
  keyword_filter?: string[];
  license: string;
  fields?: Record<string, string>;
}

/** A `jurisdiction_registry` row (§4.8.2), keyed by county FIPS or place GEOID. */
export interface JurisdictionRegistryRow {
  /** 5-digit county FIPS (e.g. "06075") or 7-digit place GEOID (e.g. "0667000"). */
  jurisdiction_id: string;
  name: string;
  adapters: JurisdictionAdapterSpec[];
  /** 0..1 — how much of the ladder this jurisdiction can answer when everything works. */
  coverage_score: number;
  verified_at: string;
  verified_by: 'auto' | 'human';
  /**
   * Why this row looks the way it does. A discovery run that finds nothing
   * writes `adapters: []` plus the reason here, so the next report reads the
   * persisted "nothing here" instead of retrying (§4.8.4).
   */
  notes?: string;
}

/** A single normalised property fact. `null` in place of this object means 未获取. */
export interface PropertyFact<T> {
  value: T;
  evidence: EvidenceLevel;
  detail?: string;
  source: string;
  license: string;
  retrieved_at: string;
  confidence: FactConfidence;
}

/** §4.8.5 normalised output. Every field is `null` until something proves it. */
export interface PropertyFacts {
  prior_food_facility: PropertyFact<boolean> | null;
  hood_permit_found: PropertyFact<boolean> | null;
  year_built: PropertyFact<number> | null;
  use_code: PropertyFact<string> | null;
}

export function emptyPropertyFacts(): PropertyFacts {
  return { prior_food_facility: null, hood_permit_found: null, year_built: null, use_code: null };
}

export type AdapterStatus = 'ok' | 'no_match' | 'not_implemented' | 'error' | 'skipped';

/** What one adapter call produced. Kept on the pack so every `null` has a stated reason. */
export interface AdapterOutcome {
  evidence: EvidenceLevel;
  type: AdapterType;
  endpoint: string;
  license: string;
  status: AdapterStatus;
  /** At most `MAX_KEPT_ROWS` matched rows, trimmed for the cache. */
  rows: Array<Record<string, unknown>>;
  matched_rows: number;
  /** Rows that also matched `keyword_filter` (E2 hood / grease records). */
  keyword_rows: number;
  reason: string | null;
  retrieved_at: string;
  cache: 'hit' | 'miss' | 'none';
  elapsed_ms: number;
}

/** Contribution handed to the report's `data_confidence` input (§4.8.6). */
export interface JurisdictionConfidenceInput {
  jurisdiction_coverage: number;
  /** Strongest evidence level actually obtained, or null. */
  evidence_level: EvidenceLevel | null;
  /** Percentage points to add to / subtract from `data_confidence_pct`. */
  confidence_delta_pct: number;
  acquired_data: string[];
  missing_data: string[];
}

/** `market_data.jurisdiction` — the whole §4.8 pack. */
export interface JurisdictionPack {
  source: 'jurisdiction';
  address: string;
  /** Registry key actually used (place GEOID wins over county FIPS). */
  jurisdiction_id: string | null;
  jurisdiction_name: string | null;
  county_fips: string | null;
  place_geoid: string | null;
  property_facts: PropertyFacts;
  /** 0..1. 0 means 本辖区许可数据未接入. */
  jurisdiction_coverage: number;
  adapter_results: AdapterOutcome[];
  /** Set when the declared fallback path was taken (no registry row, no adapters, …). */
  fallback_reason: string | null;
  retrieved_at: string;
  data_confidence_input: JurisdictionConfidenceInput;
}

export const MAX_KEPT_ROWS = 5;

// ---------------------------------------------------------------------------
// License gate (§4.8.5: only redistributable values are printed)
// ---------------------------------------------------------------------------

const OPEN_LICENSE_MARKERS = [
  'public domain',
  'publicdomain',
  'cc0',
  'cc-by',
  'cc by',
  'odbl',
  'odc-by',
  'open data commons',
  'open government',
  'open data',
  'pddl',
  'us government work',
];

const CLOSED_LICENSE_MARKERS = [
  'commercial api',
  'proprietary',
  'all rights reserved',
  'terms of service',
  'tos',
  'subscription',
  'internal reasoning only',
  'no redistribution',
  'not redistributable',
];

/**
 * True when the license string permits republishing the value inside a customer
 * report. Unknown / commercial licenses are treated as NOT redistributable —
 * such values may still inform internal reasoning, they are simply not printed.
 */
export function licensePermitsRedistribution(license: string | null | undefined): boolean {
  const s = String(license ?? '').toLowerCase();
  if (!s.trim()) return false;
  if (CLOSED_LICENSE_MARKERS.some((m) => s.includes(m))) return false;
  return OPEN_LICENSE_MARKERS.some((m) => s.includes(m));
}

/**
 * The subset of facts that may appear in the rendered report. Facts from
 * commercial APIs are dropped here (they stay on the pack for reasoning).
 */
export function redistributablePropertyFacts(facts: PropertyFacts): PropertyFacts {
  const keep = <T>(f: PropertyFact<T> | null): PropertyFact<T> | null =>
    f && licensePermitsRedistribution(f.license) ? f : null;
  return {
    prior_food_facility: keep(facts.prior_food_facility),
    hood_permit_found: keep(facts.hood_permit_found),
    year_built: keep(facts.year_built),
    use_code: keep(facts.use_code),
  };
}

/** Strongest evidence level present across the facts, or null when nothing was obtained. */
export function strongestEvidence(facts: PropertyFacts): EvidenceLevel | null {
  const levels = [
    facts.prior_food_facility?.evidence,
    facts.hood_permit_found?.evidence,
    facts.year_built?.evidence,
    facts.use_code?.evidence,
  ].filter((e): e is EvidenceLevel => Boolean(e));
  if (levels.length === 0) return null;
  return levels.reduce((best, e) => (evidenceRank(e) < evidenceRank(best) ? e : best));
}
