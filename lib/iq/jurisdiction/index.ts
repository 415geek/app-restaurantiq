/**
 * 评审 Spec v2 §4.8 辖区数据代理 — entry point.
 *
 * Resolution path (§4.8.2):
 *   address → the Census geocoder the platform already uses (lib/iq/data/geocode.ts)
 *           → state/county FIPS (+ optional place GEOID)
 *           → jurisdiction_registry lookup
 *           → adapters in E1 → E2 → E4 order
 *           → normalise (+ the E3 prior-tenant signal from site-history)
 *
 * What this replaces: the v2 report described a storefront with the RESIDENTIAL
 * Zillow record of the flats upstairs ("1912 年建、8 卧 6 卫 Multi-Family、
 * 4,685 sqft") and then reasoned "1912 old building → probably no Type I hood",
 * while the same report already knew the site is operated by Ah Ma's Kitchen, a
 * hot-kitchen HK café. No fact in `property_facts` may come from a listing
 * blurb, and no conclusion about exhaust may come from `year_built`.
 */

import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import { createFetchContext } from '@/lib/iq/data/context';
import type { FetchContext } from '@/lib/iq/data/types';
import { fetchGeocode } from '@/lib/iq/data/geocode';
import {
  priorTenantSignal,
  type PriorTenantSignal,
  type SiteHistoryPack,
} from '@/lib/funnel/external-data/site-history';
import { runAdapters } from './adapters';
import {
  jurisdictionConclusion,
  jurisdictionConclusionAllLocales,
  jurisdictionConfidenceInput,
  type JurisdictionConclusion,
} from './conclusion';
import { normalizeJurisdictionFacts } from './normalize';
import {
  createSupabaseJurisdictionStore,
  lookupJurisdiction,
  type JurisdictionStore,
} from './registry';
import {
  emptyPropertyFacts,
  redistributablePropertyFacts,
  type JurisdictionPack,
  type PropertyFacts,
} from './types';

export * from './types';
export * from './address';
export * from './registry';
export * from './adapters';
export * from './normalize';
export * from './conclusion';
export * from './discovery';

/** The §4.8 pack plus the pre-rendered, trilingual §4.8.6 wording. */
export interface JurisdictionReportPack extends JurisdictionPack {
  /** Facts whose license permits redistribution — the ONLY ones that may be printed. */
  printable_property_facts: PropertyFacts;
  /** Why each absent fact is absent. `null` never means "no permit exists". */
  gap_reasons: Record<keyof PropertyFacts, string | null>;
  conclusion: JurisdictionConclusion;
  conclusion_i18n: Record<Locale, JurisdictionConclusion>;
  /** E3 input that drove the hood reasoning (null when no prior tenant was found). */
  prior_tenant: PriorTenantSignal | null;
}

export interface ResolveJurisdictionInput {
  address: string;
  lang?: Locale;
  /** 5-digit county FIPS. When absent it is resolved through the Census geocoder. */
  countyFips?: string | null;
  /** Optional 7-digit place GEOID; a registered place row wins over the county row. */
  placeGeoid?: string | null;
  /** The site-history pack already fetched for this report (E3). */
  siteHistory?: SiteHistoryPack | null;
}

export interface ResolveJurisdictionDeps {
  ctx?: FetchContext;
  store?: JurisdictionStore;
  /**
   * Called when the address resolves to a jurisdiction with no registry row.
   * MUST NOT fetch: discovery is asynchronous and out of band (§4.8.4). The
   * default just logs, so report generation never waits on it.
   */
  onUnknownJurisdiction?: (input: { jurisdictionId: string | null; address: string }) => void;
}

function emptyPack(input: {
  address: string;
  lang: Locale;
  jurisdictionId: string | null;
  jurisdictionName: string | null;
  county: string | null;
  place: string | null;
  reason: string;
  priorTenant: PriorTenantSignal | null;
  now: Date;
}): JurisdictionReportPack {
  const facts = emptyPropertyFacts();
  const gaps: Record<keyof PropertyFacts, string | null> = {
    prior_food_facility: input.reason,
    hood_permit_found: input.reason,
    year_built: input.reason,
    use_code: input.reason,
  };
  return buildPack({
    address: input.address,
    lang: input.lang,
    jurisdictionId: input.jurisdictionId,
    jurisdictionName: input.jurisdictionName,
    county: input.county,
    place: input.place,
    facts,
    coverage: 0,
    outcomes: [],
    gaps,
    fallbackReason: input.reason,
    priorTenant: input.priorTenant,
    now: input.now,
  });
}

function buildPack(args: {
  address: string;
  lang: Locale;
  jurisdictionId: string | null;
  jurisdictionName: string | null;
  county: string | null;
  place: string | null;
  facts: PropertyFacts;
  coverage: number;
  outcomes: JurisdictionPack['adapter_results'];
  gaps: Record<keyof PropertyFacts, string | null>;
  fallbackReason: string | null;
  priorTenant: PriorTenantSignal | null;
  now: Date;
}): JurisdictionReportPack {
  return {
    source: 'jurisdiction',
    address: args.address,
    jurisdiction_id: args.jurisdictionId,
    jurisdiction_name: args.jurisdictionName,
    county_fips: args.county,
    place_geoid: args.place,
    property_facts: args.facts,
    printable_property_facts: redistributablePropertyFacts(args.facts),
    jurisdiction_coverage: args.coverage,
    adapter_results: args.outcomes,
    gap_reasons: args.gaps,
    fallback_reason: args.fallbackReason,
    retrieved_at: args.now.toISOString(),
    data_confidence_input: jurisdictionConfidenceInput(args.facts, args.coverage, args.lang, args.gaps),
    conclusion: jurisdictionConclusion(args.facts, args.lang),
    conclusion_i18n: jurisdictionConclusionAllLocales(args.facts),
    prior_tenant: args.priorTenant,
  };
}

/**
 * §4.8 resolution. Never throws and never blocks on discovery: an unregistered
 * jurisdiction returns `jurisdiction_coverage: 0` with every fact `null` and a
 * stated reason, immediately.
 */
export async function resolveJurisdictionFacts(
  input: ResolveJurisdictionInput,
  deps: ResolveJurisdictionDeps = {},
): Promise<JurisdictionReportPack> {
  const ctx = deps.ctx ?? createFetchContext();
  const store = deps.store ?? createSupabaseJurisdictionStore();
  const lang = input.lang ?? DEFAULT_LOCALE;
  const now = ctx.now();
  const address = String(input.address ?? '').trim();
  const priorTenant = priorTenantSignal(input.siteHistory ?? null);

  if (!address) {
    return emptyPack({
      address,
      lang,
      jurisdictionId: null,
      jurisdictionName: null,
      county: null,
      place: null,
      reason: 'no_address: 未提供地址，无法定位辖区',
      priorTenant,
      now,
    });
  }

  // 1) address → FIPS. Reuses the platform's Census geocoder (cached forever).
  let county = input.countyFips && /^\d{5}$/.test(input.countyFips) ? input.countyFips : null;
  const place = input.placeGeoid && /^\d{7}$/.test(input.placeGeoid) ? input.placeGeoid : null;
  if (!county) {
    try {
      const geo = await fetchGeocode({ address }, ctx);
      if (geo.status === 'ok' && geo.data?.geography?.county) county = geo.data.geography.county;
    } catch {
      county = null;
    }
  }

  // 2) registry lookup — a pure read, never a discovery fetch.
  const lookup = await lookupJurisdiction(store, { county, place });
  if (!lookup.row) {
    try {
      (deps.onUnknownJurisdiction ??
        ((x) => ctx.log(`[jurisdiction] ${x.jurisdictionId ?? '?'} not registered — discovery is out of band`)))({
        jurisdictionId: lookup.jurisdiction_id,
        address,
      });
    } catch {
      /* the declared fallback path must never be blocked by the notifier */
    }
    return emptyPack({
      address,
      lang,
      jurisdictionId: lookup.jurisdiction_id,
      jurisdictionName: null,
      county,
      place,
      reason: lookup.reason ?? 'jurisdiction_not_registered',
      priorTenant,
      now,
    });
  }

  // 3) adapters, E1 → E2 → E4.
  const outcomes = await runAdapters(lookup.row.adapters, address, ctx);

  // 4) normalise (E3 folds in here, and only here).
  const norm = normalizeJurisdictionFacts({ row: lookup.row, outcomes, priorTenant, now });
  const usable = lookup.row.adapters.filter((a) => a.type !== 'none').length;
  const fallbackReason =
    norm.jurisdiction_coverage === 0
      ? usable === 0
        ? `no_adapters: ${lookup.row.name} 已登记但未声明可用端点${lookup.row.notes ? `（${lookup.row.notes}）` : ''}`
        : `adapters_unavailable: ${lookup.row.name} 的声明端点本次均未返回可用结果`
      : null;

  return buildPack({
    address,
    lang,
    jurisdictionId: lookup.jurisdiction_id,
    jurisdictionName: lookup.row.name,
    county,
    place,
    facts: norm.property_facts,
    coverage: norm.jurisdiction_coverage,
    outcomes,
    gaps: norm.gap_reasons,
    fallbackReason,
    priorTenant,
    now,
  });
}

/**
 * Attach `market_data.jurisdiction`. Idempotent; never throws — a failure here
 * degrades the wording (§4.8.6), it does not fail the report.
 */
export async function enrichMarketDataWithJurisdiction(
  base: Record<string, unknown>,
  opts: { address: string; lang?: Locale },
  deps: ResolveJurisdictionDeps = {},
): Promise<Record<string, unknown>> {
  const existing = base.jurisdiction as JurisdictionReportPack | undefined;
  if (existing && typeof existing === 'object' && existing.source === 'jurisdiction') return base;

  const geo = base.geocode as { county_fips?: string; county?: string } | undefined;
  const countyFips =
    typeof geo?.county_fips === 'string' ? geo.county_fips : typeof geo?.county === 'string' ? geo.county : null;

  try {
    const pack = await resolveJurisdictionFacts(
      {
        address: opts.address,
        lang: opts.lang,
        countyFips,
        siteHistory: (base.site_history as SiteHistoryPack | undefined) ?? null,
      },
      deps,
    );
    console.log(
      `[jurisdiction] ${pack.jurisdiction_name ?? pack.jurisdiction_id ?? 'unregistered'} coverage=${pack.jurisdiction_coverage} case=${pack.conclusion.case} evidence=${pack.conclusion.evidence ?? 'none'}`,
    );
    return { ...base, jurisdiction: pack };
  } catch (err) {
    console.warn('[jurisdiction] resolve failed (non-fatal)', err instanceof Error ? err.message : err);
    return base;
  }
}
