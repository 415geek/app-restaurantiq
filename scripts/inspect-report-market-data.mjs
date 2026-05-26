#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const reportId = process.argv[2];
if (!reportId) {
  console.error('usage: inspect-report-market-data.mjs <reportId>');
  process.exit(2);
}

const url = `${process.env.SUPABASE_URL}/rest/v1/iq_location_reports?id=eq.${reportId}&select=id,market_data_json,full_report_json`;
const res = await fetch(url, {
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
});
const rows = await res.json();
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('no row', rows);
  process.exit(1);
}
const md = rows[0].market_data_json || {};
const acs = md.acs_context || {};
const tract = acs.tract || {};
const race = tract.race_ethnicity || {};
const inc = tract.income_brackets || {};
const edu = tract.education || {};
console.log('reportId:', rows[0].id);
console.log('acs_year:', acs.acs_year, '· tract_data_available:', acs.tract_data_available);
console.log('tract name:', tract.name);
console.log('tract pop B01003:', tract.population);
console.log('tract HH income B19013:', tract.median_household_income_usd);
console.log('tract median age:', tract.median_age);
console.log('tract median gross rent B25064:', tract.median_gross_rent_usd);
console.log('--- race B03002 ---');
console.log('  White-NH %:', (race.white_nh || {}).pct);
console.log('  Asian-NH %:', (race.asian_nh || {}).pct);
console.log('  Black-NH %:', (race.black_nh || {}).pct);
console.log('  Hispanic %:', (race.hispanic_any_race || {}).pct);
console.log('--- income brackets B19001 ---');
console.log('  HH>=$100k %:', inc.pct_100k_plus);
console.log('  HH>=$200k %:', inc.pct_200k_plus);
console.log('--- education B15003 ---');
console.log('  Bachelor+ %:', edu.bachelors_plus_pct);
console.log();
const narr = md.demographic_narrative;
if (narr) {
  console.log('demographic_narrative provider:', narr.provider, '·', narr.model);
  console.log('zh wc:', (narr.word_count || {}).zh, '· en wc:', (narr.word_count || {}).en);
  console.log('zh preview:', (narr.paragraph_zh || '').slice(0, 240));
} else {
  console.log('NO demographic_narrative (only generated on PAID flow)');
}
const sum = md.summary || {};
console.log('\ncompetitor counts:', {
  google: sum.competitor_count,
  yelp: sum.competitor_count_yelp,
  fsq: sum.competitor_count_foursquare,
});
