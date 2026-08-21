#!/usr/bin/env node
/**
 * D-3 smoke test:
 *   1. Load .env.local
 *   2. Pull ACS pack for SF address (lat/lng we already know works)
 *   3. Print whether race/ethnicity/income-brackets/education came back
 *   4. (Optional) Call Claude narrative writer and print the first lines
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

// SF Excelsior district approx
const lat = 37.7361;
const lng = -122.4359;

const { buildAcsContextForLatLng } = await import('../lib/funnel/iq-acs-enrichment.ts');

console.log('[smoke-acs-d3] fetching ACS for', lat, lng);
const pack = await buildAcsContextForLatLng(lat, lng);
if (!pack) {
  console.log('NO PACK — bailing');
  process.exit(1);
}

console.log('acs_year:', pack.acs_year);
console.log('tract_data_available:', pack.tract_data_available);
console.log('tract name:', pack.tract.name);
console.log('county name:', pack.county.name);

const dump = (label, row) => {
  console.log(`\n--- ${label} ---`);
  console.log('population:', row.population);
  console.log('median HH income:', row.median_household_income_usd);
  console.log('per-capita income:', row.per_capita_income_usd);
  console.log('median age:', row.median_age);
  console.log('median home value:', row.median_home_value_usd);
  console.log('median gross rent:', row.median_gross_rent_usd);
  console.log('race White-NH %:', row.race_ethnicity?.white_nh?.pct);
  console.log('race Asian-NH %:', row.race_ethnicity?.asian_nh?.pct);
  console.log('race Black-NH %:', row.race_ethnicity?.black_nh?.pct);
  console.log('race Hispanic %:', row.race_ethnicity?.hispanic_any_race?.pct);
  console.log('HH >=$100k %:', row.income_brackets?.pct_100k_plus);
  console.log('HH >=$200k %:', row.income_brackets?.pct_200k_plus);
  console.log('Bachelor+ %:', row.education?.bachelors_plus_pct);
};
dump('TRACT', pack.tract);
dump('COUNTY', pack.county);

// Optional: try Claude narrative
const hasClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
if (hasClaude) {
  console.log('\n=== CLAUDE NARRATIVE TEST ===');
  const { enrichMarketDataWithDemographicNarrative } = await import('../lib/funnel/iq-demographic-narrative.ts');
  const marketData = {
    geocode: { lat, lng },
    acs_context: pack,
    summary: { competitor_count: 10, competitor_count_yelp: 20, competitor_count_foursquare: 20 },
  };
  const enriched = await enrichMarketDataWithDemographicNarrative(marketData, {
    cuisine: 'bubble tea',
    address: '5024 Mission St, San Francisco, CA',
  });
  const narr = enriched.demographic_narrative;
  if (narr) {
    console.log('provider:', narr.provider, '·', narr.model);
    console.log('zh wc:', narr.word_count.zh, '· en wc:', narr.word_count.en);
    console.log('\n--- ZH ---\n', narr.paragraph_zh.slice(0, 600));
    console.log('\n--- EN ---\n', narr.paragraph_en.slice(0, 600));
  } else {
    console.log('Claude narrative not produced (check ANTHROPIC_API_KEY + model name).');
  }
} else {
  console.log('\n[smoke-acs-d3] ANTHROPIC_API_KEY not set — skipping Claude narrative test');
}
