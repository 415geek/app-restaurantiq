import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { buildCallPlan, fetchGooglePlaces } from './google-places';
import { getDefaults } from '@/lib/iq/params';
import type { FetchContext } from './types';

const FIX = join(process.cwd(), 'qa', 'fixtures');
const chinese = readFileSync(join(FIX, 'google_places_nearby_chinese_1mi.json'), 'utf8');
const restaurant = readFileSync(join(FIX, 'google_places_nearby_restaurant_1mi.json'), 'utf8');
const millbrae = { lat: 37.5985, lng: -122.3872 };
const COST = getDefaults().data_budget.google_places_cost_usd_per_call;

interface Req {
  url: string;
  headers: Record<string, string>;
  body: { includedTypes: string[]; maxResultCount: number; locationRestriction: { circle: { center: { latitude: number; longitude: number }; radius: number } } };
}

function ctxWith(opts: { key?: string | null; respond?: (req: Req, n: number) => Response }): FetchContext & { reqs: Req[] } {
  const reqs: Req[] = [];
  const stub: typeof fetch = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: Req = { url: String(input), headers, body: JSON.parse(String(init?.body)) };
    reqs.push(req);
    if (opts.respond) return opts.respond(req, reqs.length);
    const types = req.body.includedTypes.join(',');
    if (types === 'chinese_restaurant') return new Response(chinese, { status: 200 });
    if (types === 'restaurant') return new Response(restaurant, { status: 200 });
    return new Response('{}', { status: 200 });
  };
  return {
    fetch: stub,
    cost: createCostLedger(),
    cache: createMemoryCache(),
    // Tests exercise the billed path so cost accounting is verified end to end.
    env: (n) => (n === 'GOOGLE_MAPS_API_KEY' ? (opts.key === undefined ? 'AIza-test' : opts.key) : n === 'GOOGLE_PLACES_BILLED' ? '1' : null),
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
    reqs,
  };
}

test('D6 call plan: ≤ 6 calls, cuisine-specific type appended, cap respected', () => {
  const hunan = buildCallPlan('hunan');
  assert.equal(hunan.length, 6);
  assert.deepEqual(hunan[0], { includedTypes: ['chinese_restaurant'], radiusM: 1609, label: 'chinese_restaurant @1mi' });
  assert.equal(hunan[1].radiusM, 4828);
  assert.deepEqual(hunan[5].includedTypes, ['asian_restaurant']);
  assert.equal(hunan[5].radiusM, 4828);
  assert.deepEqual(hunan[4].includedTypes, ['tea_house', 'dessert_shop']);
  // Every cuisine uses the same six Table-A-valid calls (no per-cuisine Google types exist).
  assert.equal(buildCallPlan('other_chinese').length, 6);
  assert.equal(buildCallPlan('dongbei').length, 6);
  assert.equal(buildCallPlan('hunan', 3).length, 3);
  assert.equal(buildCallPlan('hunan', 99).length, 6);
});

test('D6 ok: 6 calls, Pro field mask, cost accounting, dedupe, price mapping, 30 d cache', async () => {
  const ctx = ctxWith({});
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'ok', r.coverage_note);
  assert.equal(ctx.reqs.length, 6);
  assert.equal(r.data!.calls_made, 6);
  assert.equal(r.data!.api_status, 'ok');
  for (const q of ctx.reqs) {
    assert.equal(q.url, 'https://places.googleapis.com/v1/places:searchNearby');
    assert.equal(q.headers['X-Goog-Api-Key'], 'AIza-test');
    assert.ok(!/reviews|atmosphere|editorial/i.test(q.headers['X-Goog-FieldMask']));
    assert.ok(q.headers['X-Goog-FieldMask'].includes('places.userRatingCount'));
    assert.equal(q.body.maxResultCount, 20);
    assert.equal(q.body.locationRestriction.circle.center.latitude, millbrae.lat);
  }
  assert.deepEqual(
    ctx.reqs.map((q) => `${q.body.includedTypes.join('+')}@${q.body.locationRestriction.circle.radius}`),
    ['chinese_restaurant@1609', 'chinese_restaurant@4828', 'restaurant@1609', 'asian_grocery_store+supermarket@1609', 'tea_house+dessert_shop@1609', 'asian_restaurant@4828'],
  );
  // Cost: 6 × per-call price, attributed to D6.
  assert.equal(r.cost_usd, Math.round(6 * COST * 10_000) / 10_000);
  assert.equal(ctx.cost.bySource().D6, r.cost_usd);
  assert.equal(ctx.cost.entries().length, 6);
  // Dedupe: chinese fixture (14) served twice + restaurant fixture (10, of which 4 overlap) → 20 unique.
  const places = r.data!.places;
  assert.equal(places.length, 20);
  assert.equal(new Set(places.map((p) => p.id)).size, 20);
  for (let i = 1; i < places.length; i++) assert.ok(places[i - 1].distance_m <= places[i].distance_m);
  const hunan = places.find((p) => p.name === 'Hunan Home Kitchen')!;
  assert.equal(hunan.price_level, 2);
  assert.equal(hunan.rating, 4.3);
  assert.equal(hunan.user_rating_count, 812);
  assert.equal(hunan.opening_hours_weekday?.length, 7);
  assert.ok(hunan.types.includes('meal_takeaway'), 'richer duplicate record wins');
  assert.equal(places.filter((p) => p.business_status === 'CLOSED_PERMANENTLY').length, 2);
  const closed = places.find((p) => p.business_status === 'CLOSED_PERMANENTLY')!;
  assert.equal(closed.price_level, null);
  assert.equal(closed.opening_hours_weekday, null);
  assert.ok(places.some((p) => p.price_level === 3));
  assert.ok(places.every((p) => p.distance_m < 1700));
  assert.ok(r.coverage_note.includes('永久关闭 2'));

  // Cached per call (lat/lng@4dp + types + radius): a nearby re-run makes no network calls and costs nothing.
  const again = await fetchGooglePlaces({ lat: 37.59851, lng: -122.38722, cuisineId: 'hunan' }, ctx);
  assert.equal(ctx.reqs.length, 6);
  assert.equal(again.cache, 'hit');
  assert.equal(again.data!.calls_made, 0);
  assert.equal(again.cost_usd, 0);
  assert.equal(again.data!.places.length, 20);
});

test('D6 maxCalls caps the plan', async () => {
  const ctx = ctxWith({});
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'sichuan', maxCalls: 2 }, ctx);
  assert.equal(ctx.reqs.length, 2);
  assert.equal(r.data!.calls_made, 2);
  assert.equal(r.cost_usd, Math.round(2 * COST * 10_000) / 10_000);
  assert.equal(r.data!.places.length, 14);
});

test('D6 no key → failed with the 未获取 note, no calls', async () => {
  const ctx = ctxWith({ key: null });
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(r.coverage_note, 'GOOGLE_MAPS_API_KEY 未设置：评分类指标标「未获取」');
  assert.equal(r.data, null);
  assert.equal(ctx.reqs.length, 0);
  assert.equal(r.cost_usd, 0);
});

test('D6 403 on first call → failed with API message and remaining calls aborted', async () => {
  const ctx = ctxWith({
    respond: () =>
      new Response(JSON.stringify({ error: { code: 403, message: 'Places API (New) has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }), { status: 403 }),
  });
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(ctx.reqs.length, 1, 'aborts after a fatal 403');
  assert.ok(r.error?.includes('PERMISSION_DENIED'));
  assert.ok(r.coverage_note.includes('has not been used in project 123'));
  assert.equal(r.data?.api_status, 'error');
  assert.equal(r.data?.calls_made, 1);
  assert.equal(r.cost_usd, COST);
});

test('D6 429 after two successes → partial, keeps places, notes the gap', async () => {
  const ctx = ctxWith({
    respond: (req, n) => {
      if (n <= 2) return new Response(chinese, { status: 200 });
      return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
    },
  });
  const r = await fetchGooglePlaces({ ...millbrae, cuisineId: 'hunan' }, ctx);
  assert.equal(r.status, 'partial');
  assert.equal(ctx.reqs.length, 3);
  assert.equal(r.data!.api_status, 'partial');
  assert.equal(r.data!.places.length, 14);
  assert.equal(r.data!.calls_made, 3);
  assert.ok(r.coverage_note.includes('RESOURCE_EXHAUSTED'));
  assert.ok(r.coverage_note.includes('不做补估'));
  assert.equal(r.data!.calls.filter((c) => c.error).length, 1);
});
