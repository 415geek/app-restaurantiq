/**
 * Trade-area map for the /print report (研发提示词 Phase 5.4).
 *
 * Pure SVG, equirectangular projection into a 640×420 viewBox. Only Overture /
 * computed layers are drawn (isochrone rings, L1/L2 competitors, L4 anchors,
 * rail stations, the site) — never Google-branded imagery.
 *
 * Optional raster basemap hook: when `IQ_MAP_TILES_URL` is set (an XYZ tile
 * template such as `https://tiles.example.com/{z}/{x}/{y}.png` you are
 * licensed to print), `basemapHref()` could return a pre-composited image URL
 * to place under the vector layers. It is intentionally left disabled: the
 * default report ships with the vector map only so no third-party tile ToS is
 * violated. See `IQ_MAP_TILES_URL` below.
 */
import { bboxOf, polygonsOf } from '../geo';
import type { Competitor, ReportModel, RingId } from '../model/schema';
import { PALETTE } from './format';

export const MAP_W = 640;
export const MAP_H = 420;

const RING_STYLE: Record<RingId, { fill: string; stroke: string; label: string }> = {
  walk10: { fill: 'rgba(27,42,79,0.16)', stroke: '#1B2A4F', label: '步行 10 min' },
  drive5: { fill: 'rgba(27,42,79,0.11)', stroke: '#3D4E7A', label: '车程 5 min' },
  drive10: { fill: 'rgba(27,42,79,0.07)', stroke: '#6B7AA1', label: '车程 10 min' },
  drive15: { fill: 'rgba(27,42,79,0.04)', stroke: '#9AA6C4', label: '车程 15 min' },
};

/** Documented hook only — returns null unless IQ_MAP_TILES_URL is configured (never enabled by default). */
export function basemapHref(): string | null {
  const tpl = process.env.IQ_MAP_TILES_URL?.trim();
  if (!tpl) return null;
  // A future implementation would composite XYZ tiles for the bbox into a single
  // raster (server-side) and return its data: URI here. Disabled on purpose.
  return null;
}

export interface Projection {
  x: (lng: number) => number;
  y: (lat: number) => number;
  scaleLabel: string;
  scalePx: number;
}

/** Equirectangular projection of a lon/lat bbox (padded) into the viewBox, aspect-preserving. */
export function makeProjection(model: ReportModel, opts: { pad?: number } = {}): Projection {
  const pad = opts.pad ?? 0.06;
  let minLng = model.input.lng;
  let maxLng = model.input.lng;
  let minLat = model.input.lat;
  let maxLat = model.input.lat;
  const rings = model.trade_area.rings.filter((r) => r.id !== 'drive15');
  for (const r of rings.length ? rings : model.trade_area.rings) {
    const b = bboxOf(r.geometry);
    minLng = Math.min(minLng, b.minLng);
    maxLng = Math.max(maxLng, b.maxLng);
    minLat = Math.min(minLat, b.minLat);
    maxLat = Math.max(maxLat, b.maxLat);
  }
  const cosLat = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const dLng = Math.max(1e-6, maxLng - minLng) * (1 + pad * 2);
  const dLat = Math.max(1e-6, maxLat - minLat) * (1 + pad * 2);
  // meters-ish extents to preserve aspect
  const wM = dLng * cosLat;
  const hM = dLat;
  const scale = Math.min(MAP_W / wM, MAP_H / hM);
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  const x = (lng: number) => MAP_W / 2 + (lng - cx) * cosLat * scale;
  const y = (lat: number) => MAP_H / 2 - (lat - cy) * scale;
  // scale bar: 1 mile in px
  const milePx = (1 / 69.172) * scale; // 1 mi ≈ 1/69.172 deg lat
  const useHalf = milePx > MAP_W * 0.35;
  return { x, y, scaleLabel: useHalf ? '0.5 mi' : '1 mi', scalePx: useHalf ? milePx / 2 : milePx };
}

function ringPath(geom: ReportModel['trade_area']['rings'][number]['geometry'], p: Projection): string {
  const parts: string[] = [];
  for (const poly of polygonsOf(geom)) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      parts.push(ring.map(([lng, lat], i) => `${i === 0 ? 'M' : 'L'}${p.x(lng).toFixed(1)},${p.y(lat).toFixed(1)}`).join(' ') + ' Z');
    }
  }
  return parts.join(' ');
}

function inView(x: number, y: number, margin = 6): boolean {
  return x >= -margin && x <= MAP_W + margin && y >= -margin && y <= MAP_H + margin;
}

/**
 * Rail stations: report_model.access.transit carries distance only (no
 * coordinates), so stations are listed in the legend with their distance
 * rather than drawn at a guessed position.
 */
export function TradeAreaMap({ model, compact = false }: { model: ReportModel; compact?: boolean }) {
  const p = makeProjection(model, { pad: compact ? 0.04 : 0.06 });
  const order: RingId[] = ['drive15', 'drive10', 'drive5', 'walk10'];
  const rings = order.map((id) => model.trade_area.rings.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const site = { x: p.x(model.input.lng), y: p.y(model.input.lat) };
  const l1 = model.competitors.l1.filter((c) => inView(p.x(c.lng), p.y(c.lat)));
  const l2 = model.competitors.l2.filter((c) => inView(p.x(c.lng), p.y(c.lat)));
  const l4 = model.competitors.l4.filter((c) => inView(p.x(c.lng), p.y(c.lat)));
  const basemap = basemapHref();
  const label = (c: Competitor) => c.name_zh ?? c.name;

  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width="100%" className="trade-map" role="img" aria-label="商圈地图">
      <rect x={0} y={0} width={MAP_W} height={MAP_H} fill={PALETTE.panel} />
      {basemap ? <image href={basemap} x={0} y={0} width={MAP_W} height={MAP_H} opacity={0.9} /> : null}
      {/* graticule-ish grid for orientation */}
      {[0.25, 0.5, 0.75].map((f) => (
        <g key={f}>
          <line x1={MAP_W * f} x2={MAP_W * f} y1={0} y2={MAP_H} stroke="#FFFFFF" strokeWidth={1} />
          <line x1={0} x2={MAP_W} y1={MAP_H * f} y2={MAP_H * f} stroke="#FFFFFF" strokeWidth={1} />
        </g>
      ))}
      {rings.map((r) => (
        <path key={r.id} d={ringPath(r.geometry, p)} fill={RING_STYLE[r.id].fill} stroke={RING_STYLE[r.id].stroke} strokeWidth={r.id === 'walk10' ? 1.6 : 1} strokeDasharray={r.method === 'radius' ? '4 3' : undefined} fillRule="evenodd" />
      ))}
      {l4.map((c) => (
        <g key={c.id}>
          <rect x={p.x(c.lng) - 4} y={p.y(c.lat) - 4} width={8} height={8} fill="#FFFFFF" stroke={PALETTE.navy} strokeWidth={1.2} />
        </g>
      ))}
      {l2.map((c) => (
        <circle key={c.id} cx={p.x(c.lng)} cy={p.y(c.lat)} r={3.2} fill={PALETTE.amber} stroke="#FFFFFF" strokeWidth={0.8} />
      ))}
      {l1.map((c, i) => (
        <g key={c.id}>
          <circle cx={p.x(c.lng)} cy={p.y(c.lat)} r={5.5} fill={PALETTE.red} stroke="#FFFFFF" strokeWidth={1.2} />
          {!compact ? (
            <text x={p.x(c.lng) + 8} y={p.y(c.lat) + 3.5} fontSize={9} fill={PALETTE.navy} fontFamily="'Inter','Noto Sans SC','WenQuanYi Zen Hei',sans-serif">
              {`${i + 1} ${label(c)}`}
            </text>
          ) : null}
        </g>
      ))}
      {/* site marker */}
      <g>
        <circle cx={site.x} cy={site.y} r={9} fill={PALETTE.coral} stroke="#FFFFFF" strokeWidth={2} />
        <circle cx={site.x} cy={site.y} r={2.4} fill={PALETTE.navy} />
      </g>
      {/* scale bar */}
      <g>
        <rect x={12} y={MAP_H - 22} width={p.scalePx} height={4} fill={PALETTE.navy} />
        <text x={12} y={MAP_H - 26} fontSize={9} fill={PALETTE.navy} fontFamily="'Inter',sans-serif">
          {p.scaleLabel}
        </text>
      </g>
      <text x={MAP_W - 8} y={MAP_H - 8} fontSize={8} textAnchor="end" fill={PALETTE.muted} fontFamily="'Inter',sans-serif">
        Overture Maps · Mapbox isochrone · equirectangular
      </text>
    </svg>
  );
}

export function MapLegend({ model }: { model: ReportModel }) {
  const rings = model.trade_area.rings;
  const rail = model.access.transit.filter((t) => !/bus|muni bus|shuttle/i.test(t.system));
  return (
    <div className="map-legend">
      <div className="legend-group">
        {rings.map((r) => (
          <div key={r.id} className="legend-row">
            <span className="legend-swatch" style={{ background: RING_STYLE[r.id].fill, borderColor: RING_STYLE[r.id].stroke, borderStyle: r.method === 'radius' ? 'dashed' : 'solid' }} />
            <span>
              {RING_STYLE[r.id].label}
              {r.method === 'radius' ? '（直线半径近似）' : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="legend-group">
        <div className="legend-row">
          <span className="legend-dot" style={{ background: PALETTE.coral, width: 12, height: 12 }} />
          <span>拟选址 · Site</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: PALETTE.red }} />
          <span>L1 直接竞品（{model.competitors.l1.length}）</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: PALETTE.amber, width: 7, height: 7 }} />
          <span>L2 其他中餐（{model.competitors.l2_count}）</span>
        </div>
        <div className="legend-row">
          <span className="legend-square" />
          <span>L4 华人锚点（{model.competitors.l4.length}）</span>
        </div>
      </div>
      <div className="legend-group">
        <div className="legend-title">轨道站 · Rail</div>
        {rail.length === 0 ? <div className="legend-row">未获取</div> : null}
        {rail.slice(0, 4).map((t) => (
          <div key={`${t.system}-${t.name}`} className="legend-row">
            <span className="legend-rail" />
            <span>
              {t.system} {t.name} · {Math.round(t.distance_m)} m
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
