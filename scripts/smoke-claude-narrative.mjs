#!/usr/bin/env node
/**
 * Direct smoke test for D-3 Claude narrative — supplies a hand-crafted ACS pack
 * so we exercise the Sonnet 4.5 call without needing a working Census key.
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split(/\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const { enrichMarketDataWithDemographicNarrative } = await import('../lib/funnel/iq-demographic-narrative.ts');

// Real-ish ACS pack for SF County (Excelsior, Census Tract 217)
const marketData = {
  geocode: { lat: 37.7361, lng: -122.4359 },
  acs_context: {
    source: 'us_census_acs5',
    acs_year: '2023',
    block_fips: '060750217002005',
    state_fips: '06',
    county_fips: '075',
    tract_code: '021700',
    tract_data_available: true,
    tract: {
      name: 'Census Tract 217, San Francisco County, California',
      population: 5640,
      median_household_income_usd: 112500,
      per_capita_income_usd: 48200,
      median_age: 41.2,
      median_home_value_usd: 1180000,
      median_gross_rent_usd: 2390,
      race_ethnicity: {
        denominator: 5640,
        white_nh: { count: 1410, pct: 25 },
        black_nh: { count: 220, pct: 4 },
        asian_nh: { count: 2360, pct: 42 },
        hispanic_any_race: { count: 1410, pct: 25 },
      },
      income_brackets: {
        households_total: 1820,
        hh_100k_to_125k: 220,
        hh_125k_to_150k: 165,
        hh_150k_to_200k: 230,
        hh_200k_plus: 360,
        pct_100k_plus: 54,
        pct_200k_plus: 20,
      },
      education: { pop_25_plus: 3950, bachelors_plus_count: 1660, bachelors_plus_pct: 42 },
    },
    county: {
      name: 'San Francisco County, California',
      population: 808400,
      median_household_income_usd: 141500,
      per_capita_income_usd: 82400,
      median_age: 39.1,
      median_home_value_usd: 1400000,
      median_gross_rent_usd: 2480,
      race_ethnicity: {
        denominator: 808400,
        white_nh: { count: null, pct: 38 },
        black_nh: { count: null, pct: 5 },
        asian_nh: { count: null, pct: 35 },
        hispanic_any_race: { count: null, pct: 15 },
      },
      income_brackets: {
        households_total: null,
        hh_100k_to_125k: null,
        hh_125k_to_150k: null,
        hh_150k_to_200k: null,
        hh_200k_plus: null,
        pct_100k_plus: 60,
        pct_200k_plus: 31,
      },
      education: { pop_25_plus: null, bachelors_plus_count: null, bachelors_plus_pct: 60 },
    },
    citation_zh: '美国人口普查局 ACS 2023 年 5 年估计',
    citation_en: 'U.S. Census Bureau ACS 2023 5-year',
  },
  summary: {
    competitor_count: 10,
    competitor_count_yelp: 20,
    competitor_count_foursquare: 20,
  },
};

console.log('[smoke-claude] calling Claude Sonnet 4.5 …');
const t0 = Date.now();
const out = await enrichMarketDataWithDemographicNarrative(marketData, {
  cuisine: 'bubble tea',
  address: '5024 Mission St, San Francisco, CA',
});
const ms = Date.now() - t0;

const narr = out.demographic_narrative;
if (!narr) {
  console.log('✗ NO NARRATIVE returned (check env / model / log warnings above)');
  process.exit(1);
}
console.log('✓ provider/model:', narr.provider, '·', narr.model);
console.log('elapsed:', ms, 'ms');
console.log('word counts → zh:', narr.word_count.zh, '· en:', narr.word_count.en);
console.log('\n──── PARAGRAPH (ZH) ────');
console.log(narr.paragraph_zh);
console.log('\n──── PARAGRAPH (EN) ────');
console.log(narr.paragraph_en);
