import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createFetchContext, createMemoryCache } from '@/lib/iq/data/context';
import type { FetchContext } from '@/lib/iq/data/types';
import { priorTenantSignal, type SiteHistoryPack } from '@/lib/funnel/external-data/site-history';
import {
  createMemoryJurisdictionStore,
  jurisdictionConclusion,
  lookupJurisdiction,
  resolveJurisdictionFacts,
  seedRegistryRow,
  discoverJurisdiction,
  licensePermitsRedistribution,
  redistributablePropertyFacts,
  emptyPropertyFacts,
  parseUsAddress,
  buildSocrataUrl,
  P0_JURISDICTION_IDS,
  SEED_REGISTRY,
  type JurisdictionRegistryRow,
  type PropertyFacts,
} from './index';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const SF_ADDRESS = '2699 Mission St, San Francisco, CA 94110';
const OPEN_LICENSE = 'Public domain — county open data';

type FetchStub = (url: string) => { status?: number; body: unknown } | null;

function ctxWith(stub: FetchStub): FetchContext & { calls: string[] } {
  const calls: string[] = [];
  const ctx = createFetchContext({
    cache: createMemoryCache(),
    env: () => null,
    now: () => NOW,
    log: () => {},
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const hit = stub(url);
      if (!hit) throw new Error(`unexpected fetch: ${url}`);
      return new Response(JSON.stringify(hit.body), {
        status: hit.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });
  return Object.assign(ctx, { calls });
}

/** A hot-kitchen predecessor at the exact address (the Ah Ma's Kitchen case). */
function hotKitchenPack(): SiteHistoryPack {
  return {
    source: 'site_history',
    fetched_at: NOW.toISOString(),
    address: SF_ADDRESS,
    center: { lat: 37.75, lng: -122.42 },
    match_radius_m: 45,
    businesses: [
      {
        source: 'google',
        id: 'p1',
        name: "Ah Ma's Kitchen",
        status: 'operational',
        is_food: true,
        rating: 4.4,
        review_count: 380,
        price_level: 2,
        categories: ['restaurant', 'cafe', 'food'],
        address: SF_ADDRESS,
        distance_m: 5,
        url: null,
        reviews: [],
      },
    ],
    closed_count: 0,
    operational_count: 1,
    total_reviews_sampled: 0,
    api_status: { google: 'ok', yelp: 'ok' },
    analysis: null,
  };
}

function bobaOnlyPack(): SiteHistoryPack {
  const p = hotKitchenPack();
  p.businesses = [{ ...p.businesses[0], name: 'Sweet Boba Tea', categories: ['cafe', 'bubble tea'] }];
  return p;
}

function assertAllFactsNull(facts: PropertyFacts, label: string) {
  for (const key of Object.keys(facts) as Array<keyof PropertyFacts>) {
    assert.equal(facts[key], null, `${label}: ${key} must be null (未获取), never inferred`);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('§4.8.2 registry lookup by county FIPS, place GEOID precedence, and unknown handling', async () => {
  const placeRow: JurisdictionRegistryRow = {
    jurisdiction_id: '0667000',
    name: 'City of San Francisco (place)',
    adapters: [],
    coverage_score: 0.5,
    verified_at: NOW.toISOString(),
    verified_by: 'human',
  };
  const store = createMemoryJurisdictionStore([...SEED_REGISTRY, placeRow]);

  const sf = await lookupJurisdiction(store, { county: '06075' });
  assert.equal(sf.jurisdiction_id, '06075');
  assert.ok(sf.row);
  assert.match(sf.row!.name, /San Francisco/);
  assert.equal(sf.row!.adapters.filter((a) => a.evidence === 'E1').length, 1);

  const sm = await lookupJurisdiction(store, { county: '06081' });
  assert.equal(sm.row?.name, 'San Mateo County');

  // A registered place GEOID wins over the county row.
  const place = await lookupJurisdiction(store, { county: '06075', place: '0667000' });
  assert.equal(place.jurisdiction_id, '0667000');

  // An unregistered place falls back to the county row.
  const fallback = await lookupJurisdiction(store, { county: '06075', place: '0612345' });
  assert.equal(fallback.jurisdiction_id, '06075');

  const unknown = await lookupJurisdiction(store, { county: '48201' });
  assert.equal(unknown.row, null);
  assert.match(unknown.reason ?? '', /jurisdiction_not_registered/);

  const noFips = await lookupJurisdiction(store, { county: null });
  assert.equal(noFips.row, null);
  assert.match(noFips.reason ?? '', /no_fips/);
});

test('§4.8.7 cold start seeds P0 only (SF / San Mateo / Santa Clara / Alameda)', () => {
  assert.deepEqual([...P0_JURISDICTION_IDS].sort(), ['06001', '06075', '06081', '06085']);
  const sf = seedRegistryRow('06075');
  assert.ok(sf);
  assert.deepEqual(
    sf!.adapters.map((a) => a.evidence),
    ['E1', 'E2', 'E4'],
  );
  assert.ok(sf!.adapters.every((a) => a.endpoint.startsWith('https://')));
  // Counties whose endpoints are not confidently known declare no invented
  // dataset ids — they read as 未接入 until discovery or an operator fills them.
  for (const id of ['06081', '06085', '06001']) {
    const row = seedRegistryRow(id)!;
    assert.ok(row.adapters.every((a) => a.type === 'national_parcel'), `${id} must not invent open-data endpoints`);
    assert.equal(row.verified_by, 'auto');
    assert.ok((row.notes ?? '').length > 0, `${id} must state why it is unconnected`);
  }
  assert.equal(seedRegistryRow('48201'), null);
});

// ---------------------------------------------------------------------------
// E1 — Socrata
// ---------------------------------------------------------------------------

test('§4.8.3 mocked Socrata E1 response → prior_food_facility.value === true with evidence E1', async () => {
  const ctx = ctxWith((url) => {
    if (url.includes('pyih-qa8i')) {
      return {
        body: [
          {
            business_name: "Ah Ma's Kitchen",
            business_address: '2699 Mission St',
            inspection_date: '2024-06-11',
          },
        ],
      };
    }
    if (url.includes('i98e-djp9')) return { body: [] };
    if (url.includes('wv5m-vpq2')) return { body: [] };
    return null;
  });

  const pack = await resolveJurisdictionFacts(
    { address: SF_ADDRESS, countyFips: '06075', lang: 'zh' },
    { ctx, store: createMemoryJurisdictionStore() },
  );

  const fact = pack.property_facts.prior_food_facility;
  assert.ok(fact, 'prior_food_facility must be present');
  assert.equal(fact!.value, true);
  assert.equal(fact!.evidence, 'E1');
  assert.equal(fact!.confidence, 'high');
  assert.match(fact!.source, /San Francisco/);
  assert.equal(fact!.retrieved_at, NOW.toISOString());
  assert.ok(licensePermitsRedistribution(fact!.license), 'DataSF is redistributable');

  // E1 alone proves food use, not a hood: hood_permit_found stays 未获取.
  assert.equal(pack.property_facts.hood_permit_found, null);
  assert.ok(pack.jurisdiction_coverage > 0);
  assert.equal(pack.conclusion.case, 'permit_record');
  assert.ok(pack.data_confidence_input.confidence_delta_pct > 0);

  // The E2/E4 queries actually ran, in ladder order.
  assert.equal(ctx.calls.length, 3);
  assert.ok(ctx.calls[0].includes('pyih-qa8i'));
  assert.ok(ctx.calls[1].includes('i98e-djp9'));
  assert.ok(ctx.calls[2].includes('wv5m-vpq2'));
});

test('§4.8.3 Socrata E2 hood keyword hit sets hood_permit_found and swaps the checklist item', async () => {
  const ctx = ctxWith((url) => {
    if (url.includes('pyih-qa8i')) return { body: [] };
    if (url.includes('i98e-djp9')) {
      return {
        body: [
          {
            street_number: '2699',
            street_name: 'Mission',
            description: 'INSTALL TYPE I HOOD AND GREASE INTERCEPTOR FOR COMMERCIAL KITCHEN',
            permit_type_definition: 'additions alterations or repairs',
            permit_creation_date: '2016-04-02',
            status: 'complete',
          },
        ],
      };
    }
    if (url.includes('wv5m-vpq2')) return { body: [] };
    return null;
  });

  const pack = await resolveJurisdictionFacts(
    { address: SF_ADDRESS, countyFips: '06075', lang: 'zh' },
    { ctx, store: createMemoryJurisdictionStore() },
  );

  const hood = pack.property_facts.hood_permit_found;
  assert.ok(hood);
  assert.equal(hood!.value, true);
  assert.equal(hood!.evidence, 'E2');
  assert.match(hood!.detail ?? '', /type i hood/i);

  // A permitted hood is itself proof of prior commercial food use (medium).
  const prior = pack.property_facts.prior_food_facility;
  assert.equal(prior?.value, true);
  assert.equal(prior?.evidence, 'E2');
  assert.equal(prior?.confidence, 'medium');

  assert.equal(pack.conclusion.case, 'permit_record');
  assert.equal(pack.conclusion.checklist_item, '核验该许可对应的 hood 型号与现状是否仍在');
  assert.equal(jurisdictionConclusion(pack.property_facts, 'en').checklist_item.includes('hood model'), true);
});

// ---------------------------------------------------------------------------
// E4 — ArcGIS
// ---------------------------------------------------------------------------

test('§4.8.3 mocked ArcGIS E4 response → year_built with confidence "medium", and NO hood inference', async () => {
  const row: JurisdictionRegistryRow = {
    jurisdiction_id: '06081',
    name: 'San Mateo County (assessor GIS)',
    adapters: [
      {
        evidence: 'E4',
        type: 'arcgis_rest',
        endpoint: 'https://gis.example.gov/arcgis/rest/services/Parcels/FeatureServer/0',
        address_field: 'SITUS_ADDRESS',
        license: OPEN_LICENSE,
        fields: { year_built: 'YearBuilt', use_code: 'UseCode' },
      },
    ],
    coverage_score: 0.15,
    verified_at: NOW.toISOString(),
    verified_by: 'auto',
  };
  const ctx = ctxWith((url) =>
    url.includes('/FeatureServer/0/query')
      ? {
          body: {
            features: [
              { attributes: { SITUS_ADDRESS: '1711 EL CAMINO REAL', YearBuilt: 1912, UseCode: 'MULTI-FAMILY' } },
            ],
          },
        }
      : null,
  );

  const pack = await resolveJurisdictionFacts(
    { address: '1711 El Camino Real, Millbrae, CA 94030', countyFips: '06081', lang: 'zh' },
    { ctx, store: createMemoryJurisdictionStore([row]) },
  );

  const yb = pack.property_facts.year_built;
  assert.ok(yb);
  assert.equal(yb!.value, 1912);
  assert.equal(yb!.evidence, 'E4');
  assert.equal(yb!.confidence, 'medium');
  assert.equal(pack.property_facts.use_code?.value, 'MULTI-FAMILY');

  // THE §4.8.1 logic hole: a 1912 building and a residential use code must not
  // produce any statement about hoods or prior food use.
  assert.equal(pack.property_facts.hood_permit_found, null);
  assert.equal(pack.property_facts.prior_food_facility, null);
  assert.equal(pack.conclusion.case, 'not_connected');
  assert.doesNotMatch(pack.conclusion.text, /1912|年建|建筑年代/);
});

test('§4.8.5 commercial-API values inform reasoning but are not printable', () => {
  const facts = emptyPropertyFacts();
  facts.year_built = {
    value: 1988,
    evidence: 'E4',
    source: 'Regrid',
    license: 'Commercial API (Regrid national parcel) — internal reasoning only, not redistributable',
    retrieved_at: NOW.toISOString(),
    confidence: 'medium',
  };
  facts.use_code = {
    value: 'RETAIL',
    evidence: 'E4',
    source: 'County assessor',
    license: OPEN_LICENSE,
    retrieved_at: NOW.toISOString(),
    confidence: 'medium',
  };
  const printable = redistributablePropertyFacts(facts);
  assert.equal(printable.year_built, null, 'commercial-license value must not be printed');
  assert.equal(printable.use_code?.value, 'RETAIL');
  assert.equal(facts.year_built?.value, 1988, 'the value stays on the pack for internal reasoning');
  assert.equal(licensePermitsRedistribution(''), false);
  assert.equal(licensePermitsRedistribution('CC-BY 4.0'), true);
});

// ---------------------------------------------------------------------------
// Unknown jurisdiction (§4.8.4 + §4.8.6 third variant)
// ---------------------------------------------------------------------------

test('§4.8.4 unknown jurisdiction → all facts null, coverage 0, 未接入 wording with no building age, no fetching', async () => {
  const ctx = ctxWith(() => null); // any fetch throws
  const unknown: string[] = [];

  const pack = await resolveJurisdictionFacts(
    { address: '500 Main St, Houston, TX 77002', countyFips: '48201', lang: 'zh' },
    {
      ctx,
      store: createMemoryJurisdictionStore(),
      onUnknownJurisdiction: (x) => unknown.push(x.jurisdictionId ?? ''),
    },
  );

  assertAllFactsNull(pack.property_facts, 'unknown jurisdiction');
  assert.equal(pack.jurisdiction_coverage, 0);
  assert.equal(pack.adapter_results.length, 0);
  assert.equal(ctx.calls.length, 0, 'an unknown jurisdiction must not trigger any fetch during a report');
  assert.deepEqual(unknown, ['48201']);
  assert.match(pack.fallback_reason ?? '', /jurisdiction_not_registered/);

  assert.equal(pack.conclusion.case, 'not_connected');
  assert.equal(pack.conclusion.text, '本辖区许可数据未接入，排烟/电力条件无法远程判定，列为签约前必查项。');
  assert.equal(pack.conclusion.checklist_item, '索取 DBI 许可记录');
  assert.equal(pack.data_confidence_input.confidence_delta_pct, -8);
  assert.equal(pack.data_confidence_input.evidence_level, null);

  // The wording says nothing about the building's age, in any language.
  for (const lang of ['en', 'zh', 'es'] as const) {
    const text = pack.conclusion_i18n[lang].text;
    assert.doesNotMatch(text, /\d{4}/, `${lang}: no year in the 未接入 wording`);
    assert.doesNotMatch(text, /年建|建筑年代|year built|built in|año de construcción|antigüedad/i, `${lang}: no building age`);
  }
  // …and the guard states the rule explicitly.
  assert.match(pack.conclusion.guard, /建筑年代/);
  assert.match(pack.conclusion_i18n.en.guard, /year of construction/);
});

test('§4.8.6 a registered-but-unconnected jurisdiction still renders the section, coverage 0', async () => {
  const ctx = ctxWith(() => null);
  const pack = await resolveJurisdictionFacts(
    { address: '1711 El Camino Real, Millbrae, CA 94030', countyFips: '06081', lang: 'en' },
    { ctx, store: createMemoryJurisdictionStore() },
  );
  // The seed row only declares a not-implemented national_parcel stub.
  assert.equal(pack.adapter_results.length, 1);
  assert.equal(pack.adapter_results[0].status, 'not_implemented');
  assert.equal(ctx.calls.length, 0, 'stub adapters make no network calls');
  assert.equal(pack.jurisdiction_coverage, 0);
  assertAllFactsNull(pack.property_facts, 'unconnected jurisdiction');
  assert.equal(pack.conclusion.case, 'not_connected');
  assert.match(pack.fallback_reason ?? '', /adapters_unavailable|no_adapters/);
});

// ---------------------------------------------------------------------------
// E3 — the zero-cost fix (§4.8.1)
// ---------------------------------------------------------------------------

test('§4.8.1 E3 hot-kitchen prior tenant → prior_food_facility and the 「大概率已具备」 wording', async () => {
  const ctx = ctxWith(() => null);
  const pack = await resolveJurisdictionFacts(
    { address: SF_ADDRESS, countyFips: '06081', lang: 'zh', siteHistory: hotKitchenPack() },
    { ctx, store: createMemoryJurisdictionStore() },
  );

  const fact = pack.property_facts.prior_food_facility;
  assert.ok(fact, 'the prior tenant must drive prior_food_facility');
  assert.equal(fact!.value, true);
  assert.equal(fact!.evidence, 'E3');
  assert.equal(fact!.confidence, 'low');
  assert.match(fact!.detail ?? '', /Ah Ma's Kitchen/);

  // Still no hood claim — E3 cannot prove a Type I hood.
  assert.equal(pack.property_facts.hood_permit_found, null);
  assert.equal(pack.conclusion.case, 'prior_tenant');
  assert.equal(
    pack.conclusion.text,
    '前租户为热厨餐饮，该址大概率已具备商用厨房条件，但未经许可记录证实，请现场验房。',
  );
  assert.match(pack.conclusion.text, /大概率已具备/);
  assert.equal(pack.conclusion.checklist_item, '索取 DBI 许可记录');
  assert.match(pack.conclusion_i18n.en.text, /hot kitchen/i);
  assert.match(pack.conclusion_i18n.es.text, /cocina caliente/i);
  assert.equal(pack.data_confidence_input.evidence_level, 'E3');
});

test('§4.8.1 prior-tenant classification: hot kitchen vs beverage/prepackaged vs nothing', () => {
  const hot = priorTenantSignal(hotKitchenPack());
  assert.equal(hot?.concept, 'hot_kitchen');
  assert.equal(hot?.prior_business_name, "Ah Ma's Kitchen");
  assert.ok(hot!.matched_terms.length > 0, 'the classification must quote the terms it matched');

  const boba = priorTenantSignal(bobaOnlyPack());
  assert.equal(boba?.concept, 'limited_food');

  const empty = hotKitchenPack();
  empty.businesses = [];
  assert.equal(priorTenantSignal(empty), null, 'no prior tenant means no signal — never a default');
  assert.equal(priorTenantSignal(null), null);
});

test('§4.8.6 a beverage-only predecessor does NOT reach the 「大概率已具备」 wording', async () => {
  const ctx = ctxWith(() => null);
  const pack = await resolveJurisdictionFacts(
    { address: SF_ADDRESS, countyFips: '06081', lang: 'zh', siteHistory: bobaOnlyPack() },
    { ctx, store: createMemoryJurisdictionStore() },
  );
  assert.equal(pack.property_facts.prior_food_facility, null);
  assert.equal(pack.conclusion.case, 'not_connected');
  assert.match(pack.gap_reasons.prior_food_facility ?? '', /Sweet Boba Tea/);
});

// ---------------------------------------------------------------------------
// Discovery (§4.8.4)
// ---------------------------------------------------------------------------

test('§4.8.4 discovery is out of band: a total failure persists adapters: [] plus the reason', async () => {
  const store = createMemoryJurisdictionStore([]);
  const res = await discoverJurisdiction({ jurisdictionId: '48201', name: 'Harris County' }, { store, now: () => NOW });
  assert.deepEqual(res.row.adapters, []);
  assert.equal(res.row.coverage_score, 0);
  assert.equal(res.row.verified_by, 'auto');
  assert.match(res.row.notes ?? '', /discovery_failed/);
  assert.equal(res.persisted, true);

  // Persisted → the next report reads "nothing here" and does not retry.
  const again = await lookupJurisdiction(store, { county: '48201' });
  assert.ok(again.row);
  assert.deepEqual(again.row!.adapters, []);
});

test('§4.8.4 discovery writes a draft row with verified_by "auto" and a coverage_score', async () => {
  const store = createMemoryJurisdictionStore([]);
  const res = await discoverJurisdiction(
    { jurisdictionId: '06085', name: 'Santa Clara County' },
    {
      store,
      now: () => NOW,
      findCandidates: async () => [
        {
          evidence: 'E1',
          type: 'socrata',
          endpoint: 'https://data.example.gov/resource/aaaa-bbbb.json',
          address_field: 'facility_address',
          license: 'Public domain — county open data',
          confidence: 0.7,
        },
        {
          evidence: 'E4',
          type: 'arcgis_rest',
          endpoint: 'https://gis.example.gov/arcgis/rest/services/Parcels/FeatureServer/0',
          address_field: 'SITUS',
          license: 'Public domain — county open data',
          fields: { year_built: 'YEARBLT' },
          confidence: 0.6,
        },
      ],
      probe: async () => true,
    },
  );
  assert.equal(res.row.verified_by, 'auto');
  assert.equal(res.row.adapters.length, 2);
  assert.ok(res.row.coverage_score > 0 && res.row.coverage_score <= 1);
  assert.match(res.row.notes ?? '', /discovery_draft/);
  assert.equal(res.probed, 2);

  // Only a PERSISTED row is ever used by a report.
  const row = await store.get('06085');
  assert.equal(row?.adapters.length, 2);
});

// ---------------------------------------------------------------------------
// E5 — the residential listing blurb must never reach property_facts
// ---------------------------------------------------------------------------

test('§4.8.1 no module reads a residential listing blurb into property_facts', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const residentialMarkers =
    /zillow|zestimate|bedrooms|bathrooms|livingArea|homeType|multi[-_ ]?family|real_estate_data|commercial_listings|brightdata_research/i;

  const scan = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? scan(path.join(dir, e.name))
          : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
            ? [path.join(dir, e.name)]
            : [],
      );

  // Comments may (and do) explain the Zillow mistake; executable code may not.
  const codeOf = (file: string): string =>
    fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  // (a) nothing in the jurisdiction layer even names a residential-listing field.
  for (const file of scan(path.join(repoRoot, 'lib', 'iq', 'jurisdiction'))) {
    assert.doesNotMatch(
      codeOf(file),
      residentialMarkers,
      `${path.relative(repoRoot, file)} must not read listing fields into property_facts`,
    );
  }

  // (b) the Zillow fetcher is gone from the external-data layer entirely.
  for (const file of scan(path.join(repoRoot, 'lib', 'funnel', 'external-data'))) {
    assert.doesNotMatch(
      codeOf(file),
      /zillow|zestimate|livingArea|homeType/i,
      `${path.relative(repoRoot, file)} must not fetch residential listings`,
    );
  }

  // (c) behaviourally: a market_data blob stuffed with residential specs still
  //     yields nothing — every fact stays null (未获取).
  const ctx = ctxWith(() => null);
  const pack = await resolveJurisdictionFacts(
    {
      address: '1711 El Camino Real, Millbrae, CA 94030',
      countyFips: '48201',
      lang: 'zh',
      siteHistory: null,
    },
    { ctx, store: createMemoryJurisdictionStore() },
  );
  assertAllFactsNull(pack.property_facts, 'residential blurb');
  assert.equal(pack.jurisdiction_coverage, 0);
});

// ---------------------------------------------------------------------------
// Small units
// ---------------------------------------------------------------------------

test('address parsing and SoQL construction are injection-safe', () => {
  const p = parseUsAddress("1711 El Camino Real Ste 3, Millbrae, CA 94030");
  assert.equal(p.number, '1711');
  assert.equal(p.street, 'El Camino Real');
  assert.equal(p.city, 'Millbrae');
  assert.equal(p.state, 'CA');
  assert.equal(p.zip, '94030');

  const url = buildSocrataUrl(
    {
      evidence: 'E1',
      type: 'socrata',
      endpoint: 'https://data.example.gov/resource/aaaa-bbbb.json',
      address_field: 'addr',
      license: OPEN_LICENSE,
    },
    parseUsAddress("100 O'Farrell St'; DROP TABLE x;--, San Francisco, CA"),
  );
  assert.ok(url);
  const where = url!.searchParams.get('$where') ?? '';
  assert.doesNotMatch(where, /;/);
  assert.ok(where.includes("O''FARRELL"));
});

test('the three §4.8.6 variants are distinct in all three languages', () => {
  const none = emptyPropertyFacts();

  const e3: PropertyFacts = {
    ...emptyPropertyFacts(),
    prior_food_facility: {
      value: true,
      evidence: 'E3',
      source: 'site history',
      license: OPEN_LICENSE,
      retrieved_at: NOW.toISOString(),
      confidence: 'low',
    },
  };
  const e1: PropertyFacts = {
    ...emptyPropertyFacts(),
    prior_food_facility: {
      value: true,
      evidence: 'E1',
      source: 'health dept',
      license: OPEN_LICENSE,
      retrieved_at: NOW.toISOString(),
      confidence: 'high',
    },
  };

  for (const lang of ['en', 'zh', 'es'] as const) {
    const a = jurisdictionConclusion(e1, lang).text;
    const b = jurisdictionConclusion(e3, lang).text;
    const c = jurisdictionConclusion(none, lang).text;
    assert.notEqual(a, b);
    assert.notEqual(b, c);
    assert.notEqual(a, c);
    assert.ok(a.length > 10 && b.length > 10 && c.length > 10, lang);
  }
  assert.equal(jurisdictionConclusion(e1, 'zh').case, 'permit_record');
  assert.equal(jurisdictionConclusion(e3, 'zh').case, 'prior_tenant');
  assert.equal(jurisdictionConclusion(none, 'zh').case, 'not_connected');
});
