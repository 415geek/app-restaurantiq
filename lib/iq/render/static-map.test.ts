import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportModel } from '../model/schema';
import {
  L1_MARKER_CAP,
  L2_MARKER_CAP,
  L4_MARKER_CAP,
  MARKER_COLOR,
  STATIC_MAP_MAX_RING_VERTICES,
  STATIC_MAP_PRESETS,
  buildStaticMapUrl,
  clampSize,
  clearStaticMapCache,
  decodePolyline,
  downsampleRing,
  encodePolyline,
  planStaticMap,
  rankedL1,
  resolveStaticMap,
  resolveStaticMaps,
} from './static-map';

const FIXTURE = join(process.cwd(), 'qa', 'fixtures', 'report_model_millbrae.json');
const loadModel = (): ReportModel => JSON.parse(readFileSync(FIXTURE, 'utf8')) as ReportModel;

const KEY = 'test-static-key';
const BASE = { width: 600, height: 360, scale: 2 as const, key: KEY, lang: 'zh' as const };

/** Decoded query params (repeated keys preserved, in order). */
function paramsOf(url: string): Array<[string, string]> {
  const u = new URL(url);
  return [...u.searchParams.entries()];
}
const valuesOf = (url: string, key: string) => paramsOf(url).filter(([k]) => k === key).map(([, v]) => v);
/** Coordinates are emitted at 5-decimal precision (≈1 m), trailing zeros trimmed. */
const coord = (n: number) => n.toFixed(5).replace(/\.?0+$/, '');

function competitor(id: string, lat: number, lng: number, layer: 'L1' | 'L2' | 'L4', extra: Partial<ReportModel['competitors']['l1'][number]> = {}): ReportModel['competitors']['l1'][number] {
  return {
    id,
    name: id,
    name_zh: null,
    lat,
    lng,
    distance_mi: 1,
    drive_min: null,
    rating: null,
    rating_count: null,
    price_level: null,
    sub_cuisine: 'x',
    layer,
    is_chain: false,
    traffic_tier: null,
    monthly_review_growth: null,
    huff_share: null,
    operating_status: 'OPERATIONAL',
    source: 'google',
    hours_per_week: null,
    offers_delivery: null,
    ...extra,
  };
}

/* ---------------- encoded polyline ---------------- */

test('encodePolyline matches Google\'s documented example vector', () => {
  const enc = encodePolyline([
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
  assert.equal(enc, '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});

test('encodePolyline single-point example and round-trip through decodePolyline', () => {
  assert.equal(encodePolyline([[-179.9832104, 0]]), '`~oia@?');
  const pts: Array<[number, number]> = [
    [37.59952, -122.38946],
    [37.60011, -122.39102],
    [37.58877, -122.37744],
  ];
  const back = decodePolyline(encodePolyline(pts));
  assert.equal(back.length, 3);
  for (let i = 0; i < pts.length; i++) {
    assert.ok(Math.abs(back[i][0] - pts[i][0]) < 1e-5);
    assert.ok(Math.abs(back[i][1] - pts[i][1]) < 1e-5);
  }
});

test('downsampleRing caps vertices at 40 (closing vertex included) and keeps the ring closed', () => {
  const big: Array<[number, number]> = [];
  for (let i = 0; i < 200; i++) big.push([-122 + Math.cos((i / 200) * 2 * Math.PI) * 0.01, 37 + Math.sin((i / 200) * 2 * Math.PI) * 0.01]);
  big.push(big[0]);
  const out = downsampleRing(big);
  assert.ok(out.length <= STATIC_MAP_MAX_RING_VERTICES, `got ${out.length}`);
  assert.ok(out.length >= 30);
  assert.deepEqual(out[0], out[out.length - 1]);
  assert.deepEqual(out[0], [37 + 0, -122 + 0.01]); // [lat, lng] of the first vertex
  // small rings pass through untouched (plus closure)
  const small: Array<[number, number]> = [
    [-122, 37],
    [-122.01, 37],
    [-122.01, 37.01],
    [-122, 37],
  ];
  assert.equal(downsampleRing(small).length, 4);
});

/* ---------------- URL ---------------- */

test('buildStaticMapUrl: endpoint, muted style, language, size/scale, auto-fit (no center/zoom)', () => {
  const m = loadModel();
  const url = buildStaticMapUrl(m, BASE);
  assert.ok(url.startsWith('https://maps.googleapis.com/maps/api/staticmap?'));
  const p = new URL(url).searchParams;
  assert.equal(p.get('size'), '600x360');
  assert.equal(p.get('scale'), '2');
  assert.equal(p.get('maptype'), 'roadmap');
  assert.equal(p.get('language'), 'zh-CN');
  assert.equal(p.get('key'), KEY);
  assert.equal(p.get('center'), null);
  assert.equal(p.get('zoom'), null);
  const styles = valuesOf(url, 'style');
  assert.ok(styles.includes('feature:poi|visibility:off'));
  assert.ok(styles.includes('feature:transit|visibility:simplified'));
  assert.ok(styles.some((s) => s.startsWith('feature:road|element:geometry.fill|color:')));
  assert.equal(new URL(buildStaticMapUrl(m, { ...BASE, lang: 'en' })).searchParams.get('language'), 'en');
  assert.ok(url.length < 8000, `url length ${url.length}`);
  assert.ok(!url.includes('|'), 'pipes must be percent-encoded');
});

test('buildStaticMapUrl: four ring paths drawn largest first as navy encoded polylines with ≤ 40 vertices', () => {
  const m = loadModel();
  const url = buildStaticMapUrl(m, BASE);
  const paths = valuesOf(url, 'path');
  assert.equal(paths.length, 4);
  const expectedOrder = ['drive15', 'drive10', 'drive5', 'walk10'];
  const plan = planStaticMap(m);
  assert.deepEqual(
    plan.rings.map((r) => r.id),
    expectedOrder,
  );
  paths.forEach((path, i) => {
    assert.match(path, /^fillcolor:0x0B1220[0-9A-F]{2}\|color:0x0B1220[0-9A-F]{2}\|weight:\d\|enc:/);
    const fillAlpha = parseInt(path.slice('fillcolor:0x0B1220'.length, 'fillcolor:0x0B1220'.length + 2), 16);
    assert.ok(fillAlpha >= 0x14 && fillAlpha <= 0x1f, `fill alpha ${fillAlpha} not within 8–12 %`);
    const enc = path.slice(path.indexOf('enc:') + 4);
    const pts = decodePolyline(enc);
    assert.ok(pts.length <= STATIC_MAP_MAX_RING_VERTICES && pts.length >= 4, `ring ${i} has ${pts.length} vertices`);
    assert.deepEqual(pts[0], pts[pts.length - 1]);
    // vertices sit near Millbrae
    for (const [lat, lng] of pts) {
      assert.ok(Math.abs(lat - m.input.lat) < 0.5 && Math.abs(lng - m.input.lng) < 0.5);
    }
  });
});

test('buildStaticMapUrl: markers — site S green, L1 numbered in page-7 order, L2 small grey, L4 small blue, no rail without coords', () => {
  const m = loadModel();
  const url = buildStaticMapUrl(m, BASE);
  const markers = valuesOf(url, 'markers');
  const site = markers.find((x) => x.startsWith(`color:${MARKER_COLOR.site}|label:S|`));
  assert.ok(site, 'site marker');
  assert.equal(site, `color:${MARKER_COLOR.site}|label:S|${coord(m.input.lat)},${coord(m.input.lng)}`);

  const l1 = markers.filter((x) => x.startsWith(`color:${MARKER_COLOR.l1}|label:`));
  const ranked = rankedL1(m).slice(0, L1_MARKER_CAP);
  assert.equal(l1.length, ranked.length);
  l1.forEach((mk, i) => {
    assert.equal(mk, `color:${MARKER_COLOR.l1}|label:${i + 1}|${coord(ranked[i].lat)},${coord(ranked[i].lng)}`);
  });

  const l2 = markers.filter((x) => x.startsWith(`size:small|color:${MARKER_COLOR.l2}|`));
  assert.equal(l2.length, 1);
  assert.equal(l2[0].split('|').length - 2, Math.min(m.competitors.l2.length, L2_MARKER_CAP));

  const l4 = markers.filter((x) => x.startsWith(`size:small|color:${MARKER_COLOR.l4}|`));
  assert.equal(l4.length, 1);
  assert.equal(l4[0].split('|').length - 2, Math.min(m.competitors.l4.length, L4_MARKER_CAP));

  assert.equal(markers.filter((x) => x.startsWith('size:tiny|')).length, 0, 'fixture transit has no coordinates → no rail markers');
  assert.equal(m.access.transit.length > 0, true);
});

test('buildStaticMapUrl: L1 capped at 8 in Huff-share order, L2 at 20, L4 at 8; rail drawn when coordinates exist', () => {
  const m = loadModel();
  m.competitors.l1 = Array.from({ length: 12 }, (_, i) => competitor(`l1-${i}`, 37.6 + i * 0.001, -122.39, 'L1', { huff_share: i / 100, distance_mi: 1 }));
  m.competitors.l2 = Array.from({ length: 30 }, (_, i) => competitor(`l2-${i}`, 37.6, -122.39 + i * 0.001, 'L2'));
  m.competitors.l4 = Array.from({ length: 11 }, (_, i) => competitor(`l4-${i}`, 37.59 - i * 0.001, -122.39, 'L4'));
  m.access.transit = [
    { system: 'BART', name: 'Millbrae', distance_m: 250, avg_weekday_exits: 2600, lat: 37.6003, lng: -122.3867 } as ReportModel['access']['transit'][number],
    { system: 'SamTrans bus', name: 'Stop', distance_m: 50, avg_weekday_exits: null, lat: 37.6, lng: -122.39 } as ReportModel['access']['transit'][number],
    { system: 'Caltrain', name: 'Millbrae', distance_m: 252, avg_weekday_exits: null },
  ];
  const url = buildStaticMapUrl(m, BASE);
  const markers = valuesOf(url, 'markers');
  const l1 = markers.filter((x) => x.startsWith(`color:${MARKER_COLOR.l1}|label:`));
  assert.equal(l1.length, 8);
  // highest huff_share (i = 11) gets label 1
  assert.equal(l1[0], `color:${MARKER_COLOR.l1}|label:1|${coord(37.6 + 11 * 0.001)},-122.39`);
  assert.deepEqual(
    l1.map((x) => x.split('|')[1]),
    ['label:1', 'label:2', 'label:3', 'label:4', 'label:5', 'label:6', 'label:7', 'label:8'],
  );
  const l2 = markers.find((x) => x.startsWith(`size:small|color:${MARKER_COLOR.l2}|`))!;
  assert.equal(l2.split('|').length - 2, 20);
  const l4 = markers.find((x) => x.startsWith(`size:small|color:${MARKER_COLOR.l4}|`))!;
  assert.equal(l4.split('|').length - 2, 8);
  const rail = markers.filter((x) => x.startsWith(`size:tiny|color:${MARKER_COLOR.rail}|`));
  assert.equal(rail.length, 1);
  assert.equal(rail[0], `size:tiny|color:${MARKER_COLOR.rail}|37.6003,-122.3867`); // bus stop excluded, Caltrain has no coords
});

test('buildStaticMapUrl: length cap drops L2 first, then rail/L4, keeping site + L1 + rings', () => {
  const m = loadModel();
  const full = buildStaticMapUrl(m, BASE);
  const withoutL2 = buildStaticMapUrl(m, { ...BASE, maxUrlLength: full.length - 1 });
  assert.ok(withoutL2.length < full.length);
  assert.equal(valuesOf(withoutL2, 'markers').filter((x) => x.includes(`color:${MARKER_COLOR.l2}|`)).length, 0, 'L2 dropped');
  assert.equal(valuesOf(withoutL2, 'markers').filter((x) => x.includes(`color:${MARKER_COLOR.l4}|`)).length, 1, 'L4 still present');
  assert.equal(valuesOf(withoutL2, 'path').length, 4);

  const tight = buildStaticMapUrl(m, { ...BASE, maxUrlLength: withoutL2.length - 1 });
  assert.equal(valuesOf(tight, 'markers').filter((x) => x.includes(`color:${MARKER_COLOR.l4}|`)).length, 0, 'L4 dropped next');
  assert.equal(valuesOf(tight, 'markers').filter((x) => x.startsWith(`color:${MARKER_COLOR.l1}|label:`)).length, Math.min(m.competitors.l1.length, L1_MARKER_CAP));
  assert.ok(valuesOf(tight, 'markers').some((x) => x.startsWith(`color:${MARKER_COLOR.site}|label:S|`)));

  // extreme budget: minimal layers still returned (never throws)
  const minimal = buildStaticMapUrl(m, { ...BASE, maxUrlLength: 10 });
  assert.ok(minimal.startsWith('https://maps.googleapis.com/'));
  assert.ok(valuesOf(minimal, 'markers').some((x) => x.startsWith(`color:${MARKER_COLOR.site}|label:S|`)));
  assert.ok(valuesOf(minimal, 'path').length >= 3);
});

test('buildStaticMapUrl: size clamped to Google\'s 640 px per side; presets stay within it', () => {
  assert.deepEqual(clampSize(1200, 720), { width: 640, height: 384 });
  assert.deepEqual(clampSize(600, 360), { width: 600, height: 360 });
  const m = loadModel();
  assert.equal(new URL(buildStaticMapUrl(m, { ...BASE, width: 1200, height: 720 })).searchParams.get('size'), '640x384');
  for (const preset of Object.values(STATIC_MAP_PRESETS)) {
    assert.ok(preset.width <= 640 && preset.height <= 640);
  }
  assert.deepEqual(STATIC_MAP_PRESETS.hero, { width: 600, height: 360, scale: 2 }); // 1200×720 delivered
  assert.deepEqual(STATIC_MAP_PRESETS.thumb, { width: 640, height: 360, scale: 2 });
});

/* ---------------- resolveStaticMap ---------------- */

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function stubFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url.toString());
    return handler(url);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const savedKey = process.env.GOOGLE_MAPS_API_KEY;
beforeEach(() => {
  clearStaticMapCache();
  process.env.GOOGLE_MAPS_API_KEY = KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = savedKey;
});

test('resolveStaticMap: 200 image/png → data URL + attribution; key never in the result; cached for 10 min', async () => {
  const { impl, calls } = stubFetch(() => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }));
  const m = loadModel();
  let t = Date.parse('2026-09-12T00:00:00Z');
  const opts = { ...STATIC_MAP_PRESETS.hero, lang: 'zh' as const, fetchImpl: impl, now: () => t };
  const r = await resolveStaticMap(m, opts);
  assert.ok(r);
  assert.equal(r.dataUrl, `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`);
  assert.equal(r.attribution, 'Map data ©2026 Google');
  assert.ok(!r.dataUrl.includes(KEY));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes(`key=${KEY}`), 'request carries the server-side key');

  const r2 = await resolveStaticMap(m, opts);
  assert.equal(r2, r);
  assert.equal(calls.length, 1, 'cache hit');

  t += 10 * 60_000 + 1;
  await resolveStaticMap(m, opts);
  assert.equal(calls.length, 2, 'expired after 10 min');
});

test('resolveStaticMap: 403 → null', async () => {
  const { impl } = stubFetch(() => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } }));
  assert.equal(await resolveStaticMap(loadModel(), { ...STATIC_MAP_PRESETS.hero, lang: 'zh', fetchImpl: impl }), null);
});

test('resolveStaticMap: 200 but non-image body → null; network error → null', async () => {
  const html = stubFetch(() => new Response('<html>err</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal(await resolveStaticMap(loadModel(), { ...STATIC_MAP_PRESETS.thumb, lang: 'en', fetchImpl: html.impl }), null);
  const boom = stubFetch(() => {
    throw new Error('ECONNRESET');
  });
  assert.equal(await resolveStaticMap(loadModel(), { ...STATIC_MAP_PRESETS.thumb, lang: 'en', fetchImpl: boom.impl }), null);
});

test('resolveStaticMap: missing key → null without fetching', async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  const { impl, calls } = stubFetch(() => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.equal(await resolveStaticMap(loadModel(), { ...STATIC_MAP_PRESETS.hero, lang: 'zh', fetchImpl: impl }), null);
  assert.equal(calls.length, 0);
});

test('resolveStaticMaps: hero + thumb resolved independently (thumb 403 → null, hero ok)', async () => {
  const { impl, calls } = stubFetch((u) =>
    u.searchParams.get('size') === '600x360'
      ? new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } })
      : new Response('nope', { status: 403 }),
  );
  const maps = await resolveStaticMaps(loadModel(), { fetchImpl: impl });
  assert.ok(maps.hero);
  assert.equal(maps.thumb, null);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.includes('language=zh-CN')), 'language follows model.meta.language');
});
