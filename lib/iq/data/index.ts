/**
 * Phase 1 orchestrator: run D1 → (D2 ∥ D4 ∥ D5 ∥ D6 ∥ D8 ∥ D9 ∥ D10 ∥ D11) → D3, D7
 * with a wall-clock target < 40 s, and turn every DataResult into a
 * `sources[]` row for the report appendix. Fetchers are injectable so the
 * pipeline can be tested end-to-end offline.
 */
import { getDefaults } from '../params';
import { bboxAround } from '../geo';
import { fetchAcs, type AcsData } from './acs';
import { fetchCex, type CexTable } from './cex';
import { fetchDevPipeline, type DevPipelineData } from './dev-pipeline';
import { fetchGeocode, type GeocodeData } from './geocode';
import { buildCallPlan, fetchGooglePlaces, type GooglePlacesData, type GooglePlacesInput, type PlaceCall } from './google-places';
import { fetchIsochrones, type IsochroneData } from './isochrone';
import { fetchLodes, type LodesData } from './lodes';
import { fetchOverturePois, type OverturePoiData } from './overture';
import { fetchRentComps, type RentCompsData } from './rent-comps';
import { fetchTrafficProxy, type TrafficProxyData } from './traffic-proxy';
import { fetchTransit, type TransitData } from './transit';
import type { DataResult, DataSourceId, FetchContext, SiteInput } from './types';
import type { SourceRow } from '../model/schema';

export interface DataBundle {
  site: SiteInput;
  geocode: DataResult<GeocodeData>;
  acs: DataResult<AcsData> | null;
  lodes: DataResult<LodesData> | null;
  isochrones: DataResult<IsochroneData> | null;
  overture: DataResult<OverturePoiData> | null;
  google: DataResult<GooglePlacesData> | null;
  traffic: DataResult<TrafficProxyData> | null;
  rent: DataResult<RentCompsData> | null;
  transit: DataResult<TransitData> | null;
  cex: DataResult<CexTable> | null;
  dev: DataResult<DevPipelineData> | null;
  user: DataResult<SiteInput>;
  results: DataResult<unknown>[];
  elapsed_ms: number;
  /** Set when D1 failed — the report cannot be generated. */
  fatal: string | null;
}

export type Fetchers = {
  geocode: typeof fetchGeocode;
  acs: typeof fetchAcs;
  lodes: typeof fetchLodes;
  isochrones: typeof fetchIsochrones;
  overture: typeof fetchOverturePois;
  google: typeof fetchGooglePlaces;
  traffic: typeof fetchTrafficProxy;
  rent: typeof fetchRentComps;
  transit: typeof fetchTransit;
  cex: typeof fetchCex;
  dev: typeof fetchDevPipeline;
};

export const defaultFetchers: Fetchers = {
  geocode: fetchGeocode,
  acs: fetchAcs,
  lodes: fetchLodes,
  isochrones: fetchIsochrones,
  overture: fetchOverturePois,
  google: fetchGooglePlaces,
  traffic: fetchTrafficProxy,
  rent: fetchRentComps,
  transit: fetchTransit,
  cex: fetchCex,
  dev: fetchDevPipeline,
};

/** "1711 El Camino Real, Millbrae, CA 94030" → "Millbrae". */
export function cityFromAddress(address: string, fallback: string | null): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2].replace(/\s+\d{5}(-\d{4})?$/, '');
  if (parts.length === 2) return parts[0].replace(/^\d+\s+/, '');
  return fallback ?? address;
}

const RADIUS_DRIVE15_M = 5 * 1_609.344;

/** User-named competitors add at most this many Text Search calls on top of the default D6 plan. */
export const KNOWN_COMPETITOR_MAX_CALLS = 3;
const KNOWN_COMPETITOR_RADIUS_M = 8047; // 5 mi, same bias circle as the cuisine Text Search

/**
 * D6 request for a site: the default plan, plus one Text Search per user-named
 * competitor (≤ 3) with the cap raised accordingly. Without known competitors
 * the request is exactly the historical one (no explicit plan, yaml cap).
 */
export function buildGooglePlacesRequest(site: Pick<SiteInput, 'cuisine' | 'known_competitors'>, lat: number, lng: number): GooglePlacesInput {
  const defaultsCap = getDefaults().data_budget.google_places_max_calls;
  const known = site.known_competitors.slice(0, KNOWN_COMPETITOR_MAX_CALLS);
  if (!known.length) return { lat, lng, cuisineId: site.cuisine, maxCalls: defaultsCap };
  const extra: PlaceCall[] = known.map((name) => ({
    includedTypes: ['restaurant'],
    radiusM: KNOWN_COMPETITOR_RADIUS_M,
    label: `text:user:${name}`,
    textQuery: name,
  }));
  return { lat, lng, cuisineId: site.cuisine, maxCalls: defaultsCap + extra.length, plan: [...buildCallPlan(site.cuisine, defaultsCap), ...extra] };
}

async function settle<T>(p: Promise<DataResult<T>>, id: DataSourceId, name: string, ctx: FetchContext): Promise<DataResult<T>> {
  try {
    return await p;
  } catch (e) {
    return {
      id,
      name,
      status: 'failed',
      data: null,
      source: name,
      fetched_at: ctx.now().toISOString(),
      license: '',
      cost_usd: 0,
      coverage_note: `模块异常：${e instanceof Error ? e.message : String(e)}`,
      cache: 'none',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function fetchAllData(
  site: SiteInput,
  userResult: DataResult<SiteInput>,
  ctx: FetchContext,
  fetchers: Partial<Fetchers> = {},
): Promise<DataBundle> {
  const F = { ...defaultFetchers, ...fetchers };
  const t0 = Date.now();
  const geocode = await settle(F.geocode({ address: site.address }, ctx), 'D1', 'Geocode', ctx);
  const base: DataBundle = {
    site,
    geocode,
    acs: null,
    lodes: null,
    isochrones: null,
    overture: null,
    google: null,
    traffic: null,
    rent: null,
    transit: null,
    cex: null,
    dev: null,
    user: userResult,
    results: [userResult, geocode],
    elapsed_ms: 0,
    fatal: null,
  };
  if (geocode.status === 'failed' || !geocode.data) {
    base.fatal = `D1 geocode failed: ${geocode.coverage_note}`;
    base.elapsed_ms = Date.now() - t0;
    return base;
  }
  const g = geocode.data;
  const metro = g.metro ?? 'sf-bay';
  const state = g.geography.state_abbr;
  const city = cityFromAddress(site.address, g.geography.county_name);
  const walkRadius = 800;
  void bboxAround; // geometry envelope is computed inside D2 from radiusM

  const [acs, isochrones, overture, google, rent, transit, cex, dev] = await Promise.all([
    settle(F.acs({ geography: g.geography, lat: g.lat, lng: g.lng, radiusM: RADIUS_DRIVE15_M * 1.2 }, ctx), 'D2', 'ACS', ctx),
    settle(F.isochrones({ lat: g.lat, lng: g.lng }, ctx), 'D4', 'Isochrones', ctx),
    settle(F.overture({ lat: g.lat, lng: g.lng, radiusM: Math.max(3 * 1_609.344, RADIUS_DRIVE15_M), metro }, ctx), 'D5', 'Overture', ctx),
    settle(F.google(buildGooglePlacesRequest(site, g.lat, g.lng), ctx), 'D6', 'Google Places', ctx),
    settle(
      F.rent({ address: site.address, city, state: state ?? '', lat: g.lat, lng: g.lng, userRentUsd: site.rent_usd, userSqft: site.sqft, listingUrls: site.listing_urls }, ctx),
      'D8',
      'Rent comps',
      ctx,
    ),
    settle(F.transit({ lat: g.lat, lng: g.lng, stateAbbr: state, walkRadiusM: walkRadius }, ctx), 'D9', 'Transit', ctx),
    settle(F.cex(undefined, ctx), 'D10', 'CEX', ctx),
    settle(F.dev({ city, state: state ?? '', address: site.address }, ctx), 'D11', 'Dev pipeline', ctx),
  ]);

  // D3 needs the tracts in the trade area (from D2); D7 needs Google place ids (from D6).
  const tractGeoids = acs.data ? [...new Set(acs.data.block_groups.filter((b) => b.geometry).map((b) => b.tract))] : [g.geography.tract];
  const placeIds = google.data?.places.map((p) => p.id) ?? [];
  const currentCounts: Record<string, number> = {};
  for (const p of google.data?.places ?? []) if (p.user_rating_count != null) currentCounts[p.id] = p.user_rating_count;
  const [lodes, traffic] = await Promise.all([
    settle(F.lodes({ geography: g.geography, tractGeoids }, ctx), 'D3', 'LODES', ctx),
    settle(F.traffic({ placeIds, metro, currentCounts }, ctx), 'D7', 'Traffic proxy', ctx),
  ]);

  const results: DataResult<unknown>[] = [userResult, geocode, acs, lodes, isochrones, overture, google, traffic, rent, transit, cex, dev];
  return { ...base, acs, lodes, isochrones, overture, google, traffic, rent, transit, cex, dev, results, elapsed_ms: Date.now() - t0 };
}

export function sourcesFromResults(results: DataResult<unknown>[]): SourceRow[] {
  const order: DataSourceId[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'];
  return order
    .map((id) => results.find((r) => r.id === id))
    .filter((r): r is DataResult<unknown> => Boolean(r))
    .map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      fetched_at: r.fetched_at,
      coverage_note: r.coverage_note,
      license: r.license,
      cost_usd: r.cost_usd,
      source: r.source,
      ...(r.degraded_from ? { degraded_from: r.degraded_from } : {}),
    }));
}
