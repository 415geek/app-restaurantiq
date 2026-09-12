import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { fetchIsochrones, normalizeGeometry, RING_IDS } from './isochrone';
import { getDefaults } from '@/lib/iq/params';
import { areaM2, pointInGeometry } from '@/lib/iq/geo';
import type { FetchContext } from './types';

const FIX = join(process.cwd(), 'qa', 'fixtures');
const walk = readFileSync(join(FIX, 'mapbox_isochrone_walk.json'), 'utf8');
const drive = readFileSync(join(FIX, 'mapbox_isochrone_drive.json'), 'utf8');
const millbrae = { lat: 37.5985, lng: -122.3872 };

function ctxWith(opts: { token?: string | null; onFetch?: (url: string) => Response | Promise<Response> }): FetchContext & { calls: string[] } {
  const calls: string[] = [];
  const stub: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (opts.onFetch) return opts.onFetch(url);
    if (url.includes('/walking/')) return new Response(walk, { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/driving/')) return new Response(drive, { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{"message":"Not Found"}', { status: 404 });
  };
  return {
    fetch: stub,
    cost: createCostLedger(),
    cache: createMemoryCache(),
    env: (n) => (n === 'MAPBOX_TOKEN' ? (opts.token === undefined ? 'pk.test' : opts.token) : null),
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
    calls,
  };
}

function isClosed(geom: { type: string; coordinates: unknown }): boolean {
  const polys = geom.type === 'Polygon' ? [geom.coordinates as number[][][]] : (geom.coordinates as number[][][][]);
  return polys.every((poly) => poly.every((ring) => ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]));
}

test('D4 mapbox ok: two calls, four rings, cached by 100 m grid', async () => {
  const ctx = ctxWith({});
  const r = await fetchIsochrones(millbrae, ctx);
  assert.equal(r.status, 'ok');
  assert.equal(r.cache, 'miss');
  assert.equal(r.degraded_from, undefined);
  assert.equal(ctx.calls.length, 2);
  assert.ok(ctx.calls.some((u) => u.includes('/mapbox/walking/-122.387200,37.598500?contours_minutes=10&polygons=true&access_token=pk.test')));
  assert.ok(ctx.calls.some((u) => u.includes('/mapbox/driving/-122.387200,37.598500?contours_minutes=5,10,15&polygons=true')));
  const d = r.data!;
  assert.equal(d.provider, 'mapbox');
  const defs = getDefaults().rings;
  for (const id of RING_IDS) {
    assert.equal(d.rings[id].method, 'mapbox');
    assert.equal(d.rings[id].minutes, defs[id].minutes);
    assert.ok(isClosed(d.rings[id].geometry), `${id} ring closed`);
    assert.ok(pointInGeometry(millbrae, d.rings[id].geometry), `${id} contains site`);
  }
  assert.ok(areaM2(d.rings.walk10.geometry) < areaM2(d.rings.drive5.geometry));
  assert.ok(areaM2(d.rings.drive10.geometry) < areaM2(d.rings.drive15.geometry));
  // Free tier: $0 recorded with a note.
  assert.equal(r.cost_usd, 0);
  assert.equal(ctx.cost.entries().length, 1);
  assert.equal(ctx.cost.entries()[0].usd, 0);

  const again = await fetchIsochrones({ lat: 37.59852, lng: -122.38721 }, ctx); // same 100 m cell
  assert.equal(again.cache, 'hit');
  assert.equal(ctx.calls.length, 2);
  assert.deepEqual(again.data, d);
});

test('D4 missing token → straight-line radius fallback, partial', async () => {
  const ctx = ctxWith({ token: null });
  const r = await fetchIsochrones(millbrae, ctx);
  assert.equal(r.status, 'partial');
  assert.equal(r.degraded_from, 'mapbox');
  assert.equal(ctx.calls.length, 0, 'no network without a token');
  assert.ok(r.coverage_note.startsWith('[直线半径]'), r.coverage_note);
  assert.ok(r.coverage_note.includes('MAPBOX_TOKEN'));
  const d = r.data!;
  assert.equal(d.provider, 'radius');
  const defs = getDefaults().rings;
  for (const id of RING_IDS) {
    assert.equal(d.rings[id].method, 'radius');
    assert.equal(d.rings[id].radius_mi, defs[id].fallback_radius_mi);
    assert.ok(isClosed(d.rings[id].geometry));
  }
  const a = areaM2(d.rings.drive10.geometry);
  const expected = Math.PI * (3 * 1609.344) ** 2;
  assert.ok(Math.abs(a - expected) / expected < 0.03, String(a));
  // Fallback results are not cached.
  assert.equal(r.cache, 'none');
  const again = await fetchIsochrones(millbrae, ctx);
  assert.equal(again.cache, 'none');
});

test('D4 driving HTTP error → mixed: walk from mapbox, drive rings from radius', async () => {
  const ctx = ctxWith({
    onFetch: (url) =>
      url.includes('/walking/')
        ? new Response(walk, { status: 200 })
        : new Response(JSON.stringify({ message: 'Rate limit exceeded' }), { status: 429 }),
  });
  const r = await fetchIsochrones(millbrae, ctx);
  assert.equal(r.status, 'partial');
  assert.equal(r.degraded_from, 'mapbox');
  assert.equal(r.data!.provider, 'mixed');
  assert.equal(r.data!.rings.walk10.method, 'mapbox');
  assert.equal(r.data!.rings.drive5.method, 'radius');
  assert.equal(r.data!.rings.drive15.method, 'radius');
  assert.ok(r.coverage_note.includes('3/4'));
  assert.ok(r.coverage_note.includes('429'));
});

test('normalizeGeometry closes open rings and rejects junk', () => {
  const open = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] };
  const g = normalizeGeometry(open)!;
  assert.equal(g.type, 'Polygon');
  assert.equal(g.coordinates[0].length, 4);
  assert.deepEqual(g.coordinates[0][3], [0, 0]);
  assert.equal(normalizeGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), null);
  assert.equal(normalizeGeometry({ type: 'Point', coordinates: [0, 0] }), null);
});
