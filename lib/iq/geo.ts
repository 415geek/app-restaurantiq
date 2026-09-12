/**
 * Geometry helpers (no external deps). Accuracy targets are trade-area scale
 * (≤ 10 mi): a local equirectangular projection is used for areas/lengths.
 */
import type { Geometry, LatLng, MultiPolygon, Polygon, Position } from './data/types';

export const EARTH_RADIUS_M = 6_371_008.8;
export const METERS_PER_MILE = 1_609.344;

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function milesBetween(a: LatLng, b: LatLng): number {
  return haversineM(a, b) / METERS_PER_MILE;
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(start: LatLng, bearingDeg: number, distM: number): LatLng {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const br = toRad(bearingDeg);
  const la1 = toRad(start.lat);
  const lo1 = toRad(start.lng);
  const ad = distM / EARTH_RADIUS_M;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(br));
  const lo2 =
    lo1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lng: ((toDeg(lo2) + 540) % 360) - 180 };
}

/** Circle as a GeoJSON polygon (n vertices). */
export function circlePolygon(center: LatLng, radiusM: number, n = 64): Polygon {
  const ring: Position[] = [];
  for (let i = 0; i < n; i++) {
    const p = destination(center, (360 * i) / n, radiusM);
    ring.push([p.lng, p.lat]);
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function bboxOf(geom: Geometry): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of ringsOf(geom)) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function bboxAround(center: LatLng, radiusM: number): BBox {
  const n = destination(center, 0, radiusM);
  const e = destination(center, 90, radiusM);
  const s = destination(center, 180, radiusM);
  const w = destination(center, 270, radiusM);
  return { minLng: w.lng, minLat: s.lat, maxLng: e.lng, maxLat: n.lat };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minLng <= b.maxLng && a.maxLng >= b.minLng && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

/** Outer rings + holes flattened: [outer, hole, hole, outer, ...] with polygon boundaries preserved via polygonsOf. */
function ringsOf(geom: Geometry): Position[][] {
  if (geom.type === 'Polygon') return geom.coordinates;
  return geom.coordinates.flat();
}

export function polygonsOf(geom: Geometry): Position[][][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

function pointInRing(pt: Position, ring: Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(pt: LatLng, geom: Geometry): boolean {
  const p: Position = [pt.lng, pt.lat];
  for (const poly of polygonsOf(geom)) {
    if (poly.length === 0) continue;
    if (!pointInRing(p, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(p, poly[h])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Planar area (m²) via local equirectangular projection + shoelace. Holes subtracted. */
export function areaM2(geom: Geometry): number {
  let total = 0;
  for (const poly of polygonsOf(geom)) {
    for (let r = 0; r < poly.length; r++) {
      const a = ringAreaM2(poly[r]);
      total += r === 0 ? a : -a;
    }
  }
  return Math.max(0, total);
}

function ringAreaM2(ring: Position[]): number {
  if (ring.length < 3) return 0;
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const kx = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(lat0);
  const ky = (Math.PI / 180) * EARTH_RADIUS_M;
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    s += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(s) / 2;
}

/**
 * Share (0–1) of `subject`'s area that lies inside `clip`, estimated by sampling a
 * regular grid over the subject's bbox. Replaces ST_Intersection for the
 * block-group ⟂ isochrone weighting (§2.1) without a geometry library.
 * `grid` = points per axis (default 24 → ≤ 576 tests per block group).
 */
export function areaShareInside(subject: Geometry, clip: Geometry, grid = 24): number {
  const sb = bboxOf(subject);
  const cb = bboxOf(clip);
  if (!bboxIntersects(sb, cb)) return 0;
  let inSubject = 0;
  let inBoth = 0;
  const dx = (sb.maxLng - sb.minLng) / grid;
  const dy = (sb.maxLat - sb.minLat) / grid;
  if (dx === 0 || dy === 0) return 0;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const pt = { lng: sb.minLng + dx * (i + 0.5), lat: sb.minLat + dy * (j + 0.5) };
      if (!pointInGeometry(pt, subject)) continue;
      inSubject++;
      if (pointInGeometry(pt, clip)) inBoth++;
    }
  }
  if (inSubject === 0) {
    // Tiny polygon vs grid: fall back to centroid test.
    return pointInGeometry(centroid(subject), clip) ? 1 : 0;
  }
  return inBoth / inSubject;
}

export function centroid(geom: Geometry): LatLng {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const poly of polygonsOf(geom)) {
    for (const [lng, lat] of poly[0] ?? []) {
      sx += lng;
      sy += lat;
      n++;
    }
  }
  return n ? { lat: sy / n, lng: sx / n } : { lat: 0, lng: 0 };
}

/** 100 m grid key for caching isochrones by site coordinate (§Phase 1 D4). */
export function gridKey100m(p: LatLng): string {
  const latStep = 100 / 111_320;
  const lngStep = 100 / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return `${Math.round(p.lat / latStep)}:${Math.round(p.lng / lngStep)}`;
}

export function toMultiPolygon(geom: Geometry): MultiPolygon {
  return geom.type === 'MultiPolygon' ? geom : { type: 'MultiPolygon', coordinates: [geom.coordinates] };
}
