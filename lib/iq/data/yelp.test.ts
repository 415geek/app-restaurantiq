/**
 * D13 · Yelp Fusion — the §3.2 second retrieval source.
 *
 * Measured live at 900 Grant Ave, San Francisco: Google's `"egg tart"` Text
 * Search returns 0 because it matches business names, while Yelp's returns 241
 * because it matches what a shop sells. Wiring Yelp in took the competitor set
 * from 138 to 156 and the same-category layer from 125 to 143.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchYelpCompetitors, mapYelpCategories, toYelpPlace, YELP_PER_CALL_CAP, YELP_RADIUS_M } from './yelp';
import type { CostEntry, FetchContext } from './types';

function ctxWith(opts: { key?: string | null; respond?: (url: string) => Response }): FetchContext & { reqs: string[] } {
  const reqs: string[] = [];
  const entries: CostEntry[] = [];
  const mem = new Map<string, unknown>();
  return {
    reqs,
    fetch: (async (input: string | URL) => {
      reqs.push(String(input));
      return opts.respond ? opts.respond(String(input)) : new Response(JSON.stringify({ businesses: [] }), { status: 200 });
    }) as unknown as typeof fetch,
    cost: { add: (s, u, n) => { entries.push({ source: s, usd: u, note: n } as CostEntry); }, total: () => 0, entries: () => entries, bySource: () => ({}) },
    cache: { get: async <T,>(s: string, k: string) => (mem.get(`${s}:${k}`) as T) ?? null, set: async (s, k, p) => { mem.set(`${s}:${k}`, p); } },
    env: (n) => (n === 'YELP_API_KEY' ? (opts.key === undefined ? 'yelp-test' : opts.key) : null),
    now: () => new Date('2026-09-18T00:00:00Z'),
    log: () => {},
    budgetMs: 30_000,
  };
}

const BUSINESS = {
  id: 'ggb', name: 'Golden Gate Bakery',
  coordinates: { latitude: 37.7962, longitude: -122.4068 },
  categories: [{ alias: 'bakeries' }], rating: 4.3, review_count: 3656, price: '$', distance: 196, is_closed: false,
};

test('§3.2 Yelp aliases are mapped into Google type vocabulary', () => {
  // The layer rules speak Google's Table A. An unmapped "bakeries" merging onto
  // a Google record overwrote its "bakery" type and dropped the shop out of
  // Layer 1 — adding a source made the competitor count go DOWN.
  const mapped = mapYelpCategories(['bakeries', 'dimsum', 'cantonese']);
  assert.ok(mapped.includes('bakery'), mapped.join(','));
  assert.ok(mapped.includes('chinese_restaurant'));
  // The originals survive alongside, so Yelp-native rules still see them.
  assert.ok(mapped.includes('bakeries') && mapped.includes('dimsum'));
  // An alias with no Table A equivalent passes through untouched.
  assert.deepEqual(mapYelpCategories(['speakeasies']), ['speakeasies']);
});

test('§3.2 a Yelp business becomes a candidate with its own provenance', () => {
  const p = toYelpPlace(BUSINESS, { lat: 37.79466, lng: -122.40686 }, '蛋挞');
  assert.ok(p);
  assert.equal(p.id, 'ggb');
  assert.equal(p.distance_m, 196);
  assert.equal(p.review_count, 3656, 'Yelp counts stay Yelp counts — Google has 1,256 for the same shop');
  assert.equal(p.price_level, 1, '"$" → 1, the same scale Google uses');
  assert.equal(p.matched_query, '蛋挞');
  assert.ok(p.categories.includes('bakery'));
});

test('§3.2 no key degrades the source and says why, rather than failing silently', async () => {
  const ctx = ctxWith({ key: null });
  const r = await fetchYelpCompetitors({ lat: 37.79466, lng: -122.40686, cuisineId: 'egg_tart' }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(ctx.reqs.length, 0, 'no key means no call');
  assert.match(r.coverage_note ?? '', /单一来源/, 'the note must say a negative claim now rests on one engine');
});

test('§3.2 one search per alias, deduped, with the §3.1 truncation contract', async () => {
  const ctx = ctxWith({ respond: () => new Response(JSON.stringify({ businesses: [BUSINESS] }), { status: 200 }) });
  const r = await fetchYelpCompetitors({ lat: 37.79466, lng: -122.40686, cuisineId: 'egg_tart' }, ctx);
  assert.equal(r.status, 'ok');
  assert.equal(ctx.reqs.length, 3, 'egg tart / 蛋挞 / pastel de nata');
  assert.equal(r.data!.places.length, 1, 'the same shop from three aliases is one competitor');
  assert.equal(r.data!.pool_truncated, false);
  for (const u of ctx.reqs) assert.ok(u.includes(`radius=${YELP_RADIUS_M}`) && u.includes(`limit=${YELP_PER_CALL_CAP}`), u);
});

test('§3.1 a Yelp search at its per-call cap marks the pool unexhausted', async () => {
  const many = Array.from({ length: YELP_PER_CALL_CAP }, (_, i) => ({ ...BUSINESS, id: `b${i}` }));
  const ctx = ctxWith({ respond: () => new Response(JSON.stringify({ businesses: many }), { status: 200 }) });
  const r = await fetchYelpCompetitors({ lat: 37.79466, lng: -122.40686, cuisineId: 'egg_tart' }, ctx);
  assert.equal(r.data!.pool_truncated, true);
  assert.equal(r.data!.truncated_queries.length, 3);
  assert.match(r.coverage_note ?? '', /未穷尽/);
});

test('§3.2 a closed business is not a competitor', async () => {
  const ctx = ctxWith({ respond: () => new Response(JSON.stringify({ businesses: [{ ...BUSINESS, is_closed: true }] }), { status: 200 }) });
  const r = await fetchYelpCompetitors({ lat: 37.79466, lng: -122.40686, cuisineId: 'egg_tart' }, ctx);
  assert.equal(r.data!.places.length, 0);
});
