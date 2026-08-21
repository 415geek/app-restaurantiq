#!/usr/bin/env node
/**
 * D-1 smoke: hit Yelp + Foursquare for a known address (Outer Sunset, SF — bubble tea)
 * and print the merged whitelist exactly the way the LLM prompt will see it.
 *
 * Run with: npx tsx scripts/smoke-multi-source-competitors.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

// Load .env.local manually so the script picks up the keys without a separate dependency.
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const envLocal = path.join(root, '.env.local');
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const yelp = await import(pathToFileURL(path.join(root, 'lib/funnel/external-data/yelp-competitors.ts')).href);
const fsq = await import(pathToFileURL(path.join(root, 'lib/funnel/external-data/foursquare-places.ts')).href);
const sigs = await import(pathToFileURL(path.join(root, 'lib/funnel/iq-market-signals.ts')).href);

const TEST_LAT = 37.7361;
const TEST_LNG = -122.4756;
const TEST_TERM = 'bubble tea';

console.log(`\n[smoke] 2406 19th Ave area (${TEST_LAT}, ${TEST_LNG}) — term="${TEST_TERM}"\n`);

const [yelpR, fsqR] = await Promise.all([
  yelp.isYelpCompetitorSearchConfigured()
    ? yelp.searchYelpCompetitors({ lat: TEST_LAT, lng: TEST_LNG, term: TEST_TERM, limit: 20 })
    : Promise.resolve(null),
  fsq.isFoursquareConfigured()
    ? fsq.searchFoursquareCompetitors({ lat: TEST_LAT, lng: TEST_LNG, term: TEST_TERM, limit: 20 })
    : Promise.resolve(null),
]);

console.log('[yelp]  status=', yelpR?.api_status, 'count=', yelpR?.count);
if (yelpR?.competitors?.length) {
  for (const c of yelpR.competitors.slice(0, 8)) {
    console.log(`        • ${c.name}  rating=${c.rating}  reviews=${c.review_count}  price=${c.price_level ?? '—'}  ${c.distance_m ?? 0}m`);
  }
}

console.log('[fsq ]  status=', fsqR?.api_status, 'count=', fsqR?.count);
if (fsqR?.competitors?.length) {
  for (const c of fsqR.competitors.slice(0, 8)) {
    console.log(`        • ${c.name}  cats=[${c.categories.slice(0,2).join(',')}]  price=${c.price_tier ?? '—'}  ${c.distance_m ?? 0}m`);
  }
}

// Build the synthetic market_data shape the whitelist extractor will see.
const synth = {
  geocode: { lat: TEST_LAT, lng: TEST_LNG },
  summary: {
    sample_competitors_google: [], // (skip Google for this smoke; we just need to prove yelp+fsq paths)
    sample_competitors_yelp: yelpR?.competitors?.slice(0, 12) ?? [],
    sample_competitors_foursquare: fsqR?.competitors?.slice(0, 12) ?? [],
  },
};

const wl = sigs.extractCompetitorWhitelist(synth);
console.log(`\n[whitelist] total=${wl.total}  google=${wl.countsBySource.google}  yelp=${wl.countsBySource.yelp}  fsq=${wl.countsBySource.foursquare}`);
console.log('\n[prompt-block preview]\n');
console.log(sigs.buildCompetitorWhitelistPromptBlock(wl, 'en'));
