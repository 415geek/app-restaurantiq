import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaM2, areaShareInside, circlePolygon, haversineM, milesBetween, pointInGeometry } from './geo';

const millbrae = { lat: 37.5985, lng: -122.3872 };
const burlingame = { lat: 37.5896, lng: -122.3607 };

test('haversine distance Millbrae → Burlingame ≈ 2.5 km', () => {
  const d = haversineM(millbrae, burlingame);
  assert.ok(d > 2_300 && d < 2_700, String(d));
  assert.ok(milesBetween(millbrae, burlingame) < 1.7);
});

test('circle polygon area ≈ πr²', () => {
  const c = circlePolygon(millbrae, 1_000, 96);
  const a = areaM2(c);
  assert.ok(Math.abs(a - Math.PI * 1e6) / (Math.PI * 1e6) < 0.02, String(a));
  assert.ok(pointInGeometry(millbrae, c));
  assert.ok(!pointInGeometry(burlingame, c));
});

test('areaShareInside: concentric circles give area ratio', () => {
  const big = circlePolygon(millbrae, 2_000, 96);
  const small = circlePolygon(millbrae, 1_000, 96);
  assert.ok(Math.abs(areaShareInside(small, big) - 1) < 0.01);
  const share = areaShareInside(big, small);
  assert.ok(Math.abs(share - 0.25) < 0.04, String(share));
  const far = circlePolygon(burlingame, 500, 32);
  assert.equal(areaShareInside(far, small), 0);
});
