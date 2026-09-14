import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCostLedger, createMemoryCache } from './context';
import { fetchWalkingDistances, MAX_DESTINATIONS_PER_CALL } from './distance-matrix';
import { getDefaults } from '@/lib/iq/params';
import type { FetchContext } from './types';

const origin = { lat: 37.7827, lng: -122.472 };
const PER_ELEMENT = getDefaults().data_budget.distance_matrix_cost_usd_per_element;

function ctxWith(opts: { key?: string | null; respond?: (url: URL, n: number) => Response }): FetchContext & { urls: URL[] } {
  const urls: URL[] = [];
  const stub: typeof fetch = async (input) => {
    const u = new URL(String(input));
    urls.push(u);
    if (opts.respond) return opts.respond(u, urls.length);
    const n = (u.searchParams.get('destinations') ?? '').split('|').length;
    const elements = Array.from({ length: n }, (_, i) => ({ status: 'OK', distance: { value: 500 + i * 10 }, duration: { value: 400 + i * 8 } }));
    return new Response(JSON.stringify({ status: 'OK', rows: [{ elements }] }), { status: 200 });
  };
  return {
    fetch: stub,
    cost: createCostLedger(),
    cache: createMemoryCache(),
    env: (n) => (n === 'GOOGLE_MAPS_API_KEY' ? (opts.key === undefined ? 'AIza-test' : opts.key) : n === 'GOOGLE_PLACES_BILLED' ? '1' : null),
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
    urls,
  };
}

const dest = (i: number) => ({ id: `d${i}`, lat: origin.lat + i * 0.001, lng: origin.lng - i * 0.001 });

test('Distance Matrix: walking mode, ≤ 25 destinations per call, per-element cost under D6, legs cached per destination', async () => {
  const ctx = ctxWith({});
  const r = await fetchWalkingDistances({ origin, destinations: Array.from({ length: 30 }, (_, i) => dest(i)) }, ctx);
  assert.equal(r.status, 'ok', r.note);
  assert.equal(r.calls_made, 2);
  assert.equal(ctx.urls.length, 2);
  assert.equal(ctx.urls[0].searchParams.get('mode'), 'walking');
  assert.equal(ctx.urls[0].searchParams.get('origins'), `${origin.lat},${origin.lng}`);
  assert.equal(ctx.urls[0].searchParams.get('destinations')!.split('|').length, MAX_DESTINATIONS_PER_CALL);
  assert.equal(ctx.urls[1].searchParams.get('destinations')!.split('|').length, 5);
  assert.equal(Object.keys(r.walk).length, 30);
  assert.deepEqual(r.walk.d0, { walk_m: 500, walk_min: 7 });
  assert.equal(r.cost_usd, Math.round(30 * PER_ELEMENT * 10_000) / 10_000);
  assert.equal(ctx.cost.bySource().D6, r.cost_usd);
  assert.ok(ctx.cost.entries().every((e) => e.note.startsWith('DistanceMatrix walking')));

  // A second run with two new destinations only asks for those two.
  const again = await fetchWalkingDistances({ origin, destinations: [dest(0), dest(3), dest(40), dest(41)] }, ctx);
  assert.equal(again.cache_hits, 2);
  assert.equal(again.calls_made, 1);
  assert.equal(ctx.urls[2].searchParams.get('destinations')!.split('|').length, 2);
  assert.equal(Object.keys(again.walk).length, 4);
});

test('Distance Matrix: budget cap leaves the rest straight-line; no key → no_key; API error → partial / failed, never throws', async () => {
  const capped = await fetchWalkingDistances({ origin, destinations: Array.from({ length: 60 }, (_, i) => dest(i)), maxCalls: 1 }, ctxWith({}));
  assert.equal(capped.status, 'partial');
  assert.equal(capped.calls_made, 1);
  assert.equal(Object.keys(capped.walk).length, 25);
  assert.equal(capped.missing.length, 35);
  assert.ok(capped.note.includes('超出预算'));

  const noKey = await fetchWalkingDistances({ origin, destinations: [dest(1)] }, ctxWith({ key: null }));
  assert.equal(noKey.status, 'no_key');
  assert.equal(noKey.calls_made, 0);

  const denied = await fetchWalkingDistances({ origin, destinations: [dest(1), dest(2)] }, ctxWith({ respond: () => new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'key invalid' }), { status: 200 }) }));
  assert.equal(denied.status, 'failed');
  assert.ok(denied.note.includes('key invalid'));
  assert.deepEqual(denied.missing, ['d1', 'd2']);

  const partial = await fetchWalkingDistances(
    { origin, destinations: [dest(1), dest(2)] },
    ctxWith({ respond: () => new Response(JSON.stringify({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 900 }, duration: { value: 660 } }, { status: 'ZERO_RESULTS' }] }] }), { status: 200 }) }),
  );
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.walk, { d1: { walk_m: 900, walk_min: 11 } });
  assert.deepEqual(partial.missing, ['d2']);

  const empty = await fetchWalkingDistances({ origin, destinations: [] }, ctxWith({}));
  assert.equal(empty.status, 'empty');
});
