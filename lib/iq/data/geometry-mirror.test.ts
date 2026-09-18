/**
 * Boundary mirror (D2). TIGERweb is a per-report dependency on a service we do
 * not control; when it is unreachable the ACS rows still arrive but cannot be
 * allocated to a ring, so the trade area has no population and demand coverage
 * and audience fit silently fall back to a neutral 50.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchMirrorGeometry, mirrorFileUrl, parseMirrorFile } from './geometry-mirror';
import type { CostEntry, FetchContext } from './types';

const FEATURE = { geoid: '060750611022', geometry: { type: 'Polygon' as const, coordinates: [[[-122.41, 37.79], [-122.4, 37.79], [-122.4, 37.8], [-122.41, 37.8], [-122.41, 37.79]]] } };
const FILE = { year: 2023, layer: 'bg' as const, county: '06075', features: [FEATURE] };

function ctxWith(opts: { base?: string | null; respond?: (url: string) => Response }): FetchContext & { reqs: string[] } {
  const reqs: string[] = [];
  const entries: CostEntry[] = [];
  const mem = new Map<string, unknown>();
  return {
    reqs,
    fetch: (async (input: string | URL) => {
      reqs.push(String(input));
      return opts.respond ? opts.respond(String(input)) : new Response(JSON.stringify(FILE), { status: 200 });
    }) as unknown as typeof fetch,
    cost: { add: (s, u, n) => { entries.push({ source: s, usd: u, note: n } as CostEntry); }, total: () => 0, entries: () => entries, bySource: () => ({}) },
    cache: { get: async <T,>(s: string, k: string) => (mem.get(`${s}:${k}`) as T) ?? null, set: async (s, k, p) => { mem.set(`${s}:${k}`, p); } },
    env: (n) => (n === 'IQ_GEOMETRY_MIRROR_URL' ? (opts.base === undefined ? 'https://mirror.example/geo' : opts.base) : null),
    now: () => new Date(),
    log: () => {},
    budgetMs: 30_000,
  };
}

test('no mirror configured leaves the TIGERweb path exactly as it was', async () => {
  const ctx = ctxWith({ base: null });
  const r = await fetchMirrorGeometry(ctx, 'bg', '06075');
  assert.equal(r.file, null);
  assert.equal(r.cache, 'off');
  assert.equal(r.error, null, 'an unconfigured mirror is not a fault');
  assert.equal(ctx.reqs.length, 0);
});

test('one file per county per layer, fetched once and then cached', async () => {
  const ctx = ctxWith({});
  const first = await fetchMirrorGeometry(ctx, 'bg', '06075');
  assert.equal(first.file?.features.length, 1);
  assert.equal(first.cache, 'miss');
  assert.deepEqual(ctx.reqs, ['https://mirror.example/geo/bg/06075.json']);

  // Every later report in the same county must be a cache hit, or the mirror
  // just moves the per-report fetch to a different host.
  const second = await fetchMirrorGeometry(ctx, 'bg', '06075');
  assert.equal(second.cache, 'hit');
  assert.equal(ctx.reqs.length, 1);
});

test('a county that is not mirrored yet falls through quietly', async () => {
  const ctx = ctxWith({ respond: () => new Response('not found', { status: 404 }) });
  const r = await fetchMirrorGeometry(ctx, 'bg', '48201');
  assert.equal(r.file, null);
  assert.equal(r.error, null, '404 is "not mirrored yet", not a failure to report');
});

test('a corrupt or truncated file degrades instead of throwing', async () => {
  for (const body of ['{"features":[]}', '{"features":"nope"}', 'not json at all']) {
    const ctx = ctxWith({ respond: () => new Response(body, { status: 200 }) });
    const r = await fetchMirrorGeometry(ctx, 'bg', '06075');
    assert.equal(r.file, null, body);
  }
  const ctx = ctxWith({ respond: () => new Response('x', { status: 500 }) });
  assert.equal((await fetchMirrorGeometry(ctx, 'bg', '06075')).error, 'HTTP 500');
});

test('a bad county code never becomes a request', async () => {
  const ctx = ctxWith({});
  for (const bad of ['6075', 'abcde', '', '06075/../secret']) {
    assert.equal((await fetchMirrorGeometry(ctx, 'bg', bad)).file, null, bad);
  }
  assert.equal(ctx.reqs.length, 0);
});

test('parse keeps only well-formed features', () => {
  const parsed = parseMirrorFile({ year: 2023, layer: 'bg', county: '06075', features: [FEATURE, { geoid: 7 }, { geometry: FEATURE.geometry }, { geoid: 'x', geometry: { type: 'Point', coordinates: [] } }] }, 'bg', '06075');
  assert.equal(parsed?.features.length, 1);
  assert.equal(parsed?.features[0].geoid, '060750611022');
});

test('the URL shape is the one the build script writes', () => {
  assert.equal(mirrorFileUrl('https://mirror.example/geo', 'tract', '06075'), 'https://mirror.example/geo/tract/06075.json');
});
