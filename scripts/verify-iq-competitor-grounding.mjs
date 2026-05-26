#!/usr/bin/env node
/**
 * B-1.6: Verification script for the LocationIQ competitor-grounding layer.
 *
 * Project has no Jest/Vitest, so this script exercises the pure functions in
 * lib/funnel/iq-market-signals.ts and lib/funnel/iq-full-report-schema.ts
 * against representative market_data shapes and prints PASS/FAIL.
 *
 * Run with: node --experimental-strip-types scripts/verify-iq-competitor-grounding.mjs
 * (Node ≥ 22.6 strips TS imports at runtime; project ships Node 20+ in CI so we
 *  use the strip-types flag via Node CLI when available, else node + tsx fallback.)
 *
 * If strip-types is not available, run via:
 *   npx tsx scripts/verify-iq-competitor-grounding.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve TS modules via tsx if available; fall back to require flag.
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const signalsUrl = pathToFileURL(path.join(root, 'lib/funnel/iq-market-signals.ts')).href;
const schemaUrl = pathToFileURL(path.join(root, 'lib/funnel/iq-full-report-schema.ts')).href;

let signals;
let schema;
try {
  signals = await import(signalsUrl);
  schema = await import(schemaUrl);
} catch (e) {
  console.error('[verify] failed to import TS modules directly. Re-run via: npx tsx', import.meta.filename ?? '');
  console.error(e?.message ?? e);
  process.exit(2);
}

const {
  extractCompetitorWhitelist,
  isCompetitorWhitelisted,
  normalizeCompetitorName,
  buildCompetitorWhitelistPromptBlock,
  MIN_WHITELIST_FOR_GROUNDED_REPORT,
} = signals;
const { applyCompetitorWhitelist, shouldRetryForCompetitorGrounding } = schema;

let pass = 0;
let fail = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function header(title) {
  console.log(`\n[${title}]`);
}

// ---------- Fixtures ----------

const richMarketData = {
  google_raw: {
    textsearch: {
      results: [
        {
          name: 'San Tung',
          formatted_address: '1031 Irving St, San Francisco, CA',
          rating: 4.5,
          user_ratings_total: 1820,
          price_level: 2,
          geometry: { location: { lat: 37.7637, lng: -122.4661 } },
        },
        {
          name: 'Kingdom of Dumpling',
          formatted_address: '1713 Taraval St, San Francisco, CA',
          rating: 4.3,
          user_ratings_total: 980,
          geometry: { location: { lat: 37.7424, lng: -122.4869 } },
        },
      ],
    },
  },
  summary: {
    sample_competitors_yelp: [
      { name: 'San Tung', rating: 4.4, review_count: 2300 },
      { name: 'Marnee Thai', rating: 4.2, review_count: 700, address: 'Irving St' },
    ],
  },
  brightdata_research: {
    search_results: [
      { title: 'Hong Kong Lounge II', domain: 'tripadvisor.com' },
      { title: 'Top 10 dim sum spots in SF — Eater', domain: 'eater.com' }, // > 80 chars only if too long; skip via filter
    ],
  },
};

const emptyMarketData = {
  google_raw: { textsearch: { results: [] } },
  summary: {},
  brightdata_research: {},
};

const thinMarketData = {
  google_raw: {
    textsearch: {
      results: [{ name: 'Lonely Boba', geometry: { location: { lat: 37.7, lng: -122.4 } } }],
    },
  },
};

// ---------- 1. normalizeCompetitorName ----------
header('normalizeCompetitorName');
assert("lowercases", normalizeCompetitorName('San Tung') === 'san tung');
assert(
  "strips smart quotes and punctuation",
  normalizeCompetitorName("O'Hagan's — Café") === 'o hagan s   café'.replace(/\s+/g, ' ').trim(),
  `got "${normalizeCompetitorName("O'Hagan's — Café")}"`,
);
assert("returns empty for non-string", normalizeCompetitorName(undefined) === '' && normalizeCompetitorName(123) === '');

// ---------- 2. extractCompetitorWhitelist ----------
header('extractCompetitorWhitelist (rich)');
const rich = extractCompetitorWhitelist(richMarketData);
assert(`merges google + yelp + brightdata (got total=${rich.total})`, rich.total >= 4 && rich.total <= 6);
assert('san tung dedupes across google + yelp', rich.byKey.has('san tung'));
assert(
  'san tung sources include google AND yelp',
  rich.byKey.get('san tung')?.sources?.includes('google') && rich.byKey.get('san tung')?.sources?.includes('yelp'),
);
assert('kingdom of dumpling has geometry', rich.byKey.get('kingdom of dumpling')?.lat != null);
assert('countsBySource.google >= 2', rich.countsBySource.google >= 2);
assert('countsBySource.yelp >= 1', rich.countsBySource.yelp >= 1);

header('extractCompetitorWhitelist (empty)');
const empty = extractCompetitorWhitelist(emptyMarketData);
assert('empty market_data → total 0', empty.total === 0);
assert('empty displayNames', empty.displayNames.length === 0);

// ---------- 3. isCompetitorWhitelisted ----------
header('isCompetitorWhitelisted');
assert('exact match', isCompetitorWhitelisted('San Tung', rich));
assert('case-insensitive', isCompetitorWhitelisted('san tung', rich));
assert(
  'contained-token match',
  isCompetitorWhitelisted('San Tung — Outer Sunset Location', rich),
  'expected loose match to find "san tung" as token',
);
assert('rejects hallucination', !isCompetitorWhitelisted('Boba Express', rich));
assert('rejects A/B/C placeholders', !isCompetitorWhitelisted('Competitor A', rich));
assert('empty whitelist rejects everything', !isCompetitorWhitelisted('Anything', empty));

// ---------- 4. applyCompetitorWhitelist ----------
header('applyCompetitorWhitelist — drops hallucinations');
const reportWithMix = {
  executive_summary: 'Test summary',
  competitors: [
    { name: 'San Tung', threat_level: 'High' },
    { name: 'Boba Express', threat_level: 'Medium' }, // hallucinated
    { name: 'Kingdom of Dumpling', threat_level: 'Medium' },
    { name: 'Competitor B', threat_level: 'Low' }, // hallucinated
  ],
};
const grounded = applyCompetitorWhitelist(reportWithMix, rich);
assert(
  `kept 2 real competitors (got ${grounded.competitors.length})`,
  grounded.competitors.length === 2,
);
assert(
  `dropped 2 hallucinations (got ${grounded._dropped_competitor_names?.length})`,
  grounded._dropped_competitor_names?.length === 2,
);
assert(
  'warnings include the dropped names',
  Array.isArray(grounded._warnings) && grounded._warnings.some((w) => w.includes('Boba Express') && w.includes('Competitor B')),
);
assert('_whitelist_total stamped', grounded._whitelist_total === rich.total);

header('applyCompetitorWhitelist — empty whitelist degrades gracefully');
const reportAllFake = {
  competitors: [
    { name: 'Boba Express' },
    { name: 'Tasty Pot' },
  ],
};
const groundedFromEmpty = applyCompetitorWhitelist(reportAllFake, empty);
assert('empty whitelist drops everything', groundedFromEmpty.competitors.length === 0);
assert(
  'insufficient flag set when whitelist below threshold',
  groundedFromEmpty._insufficient_competitor_data === true,
);

// ---------- 5. shouldRetryForCompetitorGrounding ----------
header('shouldRetryForCompetitorGrounding');
assert('retries when ≥ 2 names dropped', shouldRetryForCompetitorGrounding(grounded, rich));

const lightlyDropped = applyCompetitorWhitelist(
  {
    competitors: [
      { name: 'San Tung' },
      { name: 'Kingdom of Dumpling' },
      { name: 'Boba Express' }, // single drop
      { name: 'Marnee Thai' },
    ],
  },
  rich,
);
assert(
  'no retry when only 1 hallucination AND grounded count ≥ threshold',
  !shouldRetryForCompetitorGrounding(lightlyDropped, rich),
);

const groundedThin = applyCompetitorWhitelist(
  { competitors: [{ name: 'Lonely Boba' }] },
  extractCompetitorWhitelist(thinMarketData),
);
assert(
  'no retry when whitelist itself was below threshold (no point asking again)',
  !shouldRetryForCompetitorGrounding(groundedThin, extractCompetitorWhitelist(thinMarketData)),
);

// ---------- 6. buildCompetitorWhitelistPromptBlock ----------
header('buildCompetitorWhitelistPromptBlock');
const blockEnRich = buildCompetitorWhitelistPromptBlock(rich, 'en');
assert('rich EN block contains "WHITELIST"', /WHITELIST/.test(blockEnRich));
assert('rich EN block lists San Tung', /San Tung/.test(blockEnRich));
assert('rich EN block includes per-source counts', /Google=\d+/.test(blockEnRich));

const blockZhEmpty = buildCompetitorWhitelistPromptBlock(empty, 'zh');
assert('empty ZH block tells model to return empty array', /必须为空数组/.test(blockZhEmpty));
assert('empty block does NOT leak fake placeholders', !/A\/B\/C/.test(blockZhEmpty) || /禁止编造/.test(blockZhEmpty));

// ---------- 7. MIN_WHITELIST_FOR_GROUNDED_REPORT exists & sensible ----------
header('MIN_WHITELIST_FOR_GROUNDED_REPORT');
assert('exported number ≥ 2', typeof MIN_WHITELIST_FOR_GROUNDED_REPORT === 'number' && MIN_WHITELIST_FOR_GROUNDED_REPORT >= 2);

// ---------- Summary ----------
console.log(`\n[result] ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailing assertions:');
  for (const f of failures) console.log('  -', f.name, f.detail ?? '');
  process.exit(1);
}
process.exit(0);
