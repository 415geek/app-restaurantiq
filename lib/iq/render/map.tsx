/**
 * Trade-area map for the /print report (研发提示词 Phase 5.4).
 *
 * `MapFigure` is the component the pages use: a Google Maps Static API raster
 * (resolved server-side in static-map.ts, delivered as a data URL so the key
 * never reaches the HTML) with our rings/markers drawn by Google on top, plus
 * a plain-Chinese legend. When the basemap is unavailable it falls back to
 * `SvgTradeAreaMap` — the pure-SVG equirectangular map (Overture / Mapbox
 * layers only, no Google imagery) — with a note.
 */
import type { CSSProperties } from 'react';
import { bboxOf, polygonsOf } from '../geo';
import type { Competitor, ReportModel, RingId } from '../model/schema';
import { PALETTE } from './format';
import { L1_MARKER_CAP, MARKER_COLOR, rankedL1, railStations, type ResolvedStaticMap, type StaticMapVariant } from './static-map';

export const MAP_W = 640;
export const MAP_H = 420;

const RING_STYLE: Record<RingId, { fill: string; stroke: string; label: string }> = {
  walk10: { fill: 'rgba(27,42,79,0.16)', stroke: '#1B2A4F', label: '步行 10 分钟' },
  drive5: { fill: 'rgba(27,42,79,0.11)', stroke: '#3D4E7A', label: '车程 5 分钟' },
  drive10: { fill: 'rgba(27,42,79,0.07)', stroke: '#6B7AA1', label: '车程 10 分钟' },
  drive15: { fill: 'rgba(27,42,79,0.04)', stroke: '#9AA6C4', label: '车程 15 分钟' },
};

/** CSS colours matching the Static Maps marker palette so one legend serves both renderers. */
const LAYER_COLOR = {
  site: `#${MARKER_COLOR.site.slice(2)}`,
  l1: `#${MARKER_COLOR.l1.slice(2)}`,
  l2: `#${MARKER_COLOR.l2.slice(2)}`,
  l4: `#${MARKER_COLOR.l4.slice(2)}`,
  rail: `#${MARKER_COLOR.rail.slice(2)}`,
} as const;

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

const FONT = "'Inter','Noto Sans SC','WenQuanYi Zen Hei',sans-serif";

/**
 * Pure-SVG fallback map (no Google imagery). L1 numbering follows page 7's
 * ranking so the numbers match the competitor cards.
 */
export function SvgTradeAreaMap({ model, compact = false }: { model: ReportModel; compact?: boolean }) {
  const p = makeProjection(model, { pad: compact ? 0.04 : 0.06 });
  const order: RingId[] = ['drive15', 'drive10', 'drive5', 'walk10'];
  const rings = order.map((id) => model.trade_area.rings.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const site = { x: p.x(model.input.lng), y: p.y(model.input.lat) };
  const visible = (c: Competitor) => inView(p.x(c.lng), p.y(c.lat));
  const l1 = rankedL1(model)
    .slice(0, L1_MARKER_CAP)
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => visible(c));
  const l2 = model.competitors.l2.filter(visible);
  const l4 = model.competitors.l4.filter(visible);
  const label = (c: Competitor) => c.name_zh ?? c.name;

  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width="100%" className="trade-map" role="img" aria-label="商圈示意图">
      <rect x={0} y={0} width={MAP_W} height={MAP_H} fill={PALETTE.panel} />
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
        <circle key={c.id} cx={p.x(c.lng)} cy={p.y(c.lat)} r={3.4} fill={LAYER_COLOR.l4} stroke="#FFFFFF" strokeWidth={0.8} />
      ))}
      {l2.map((c) => (
        <circle key={c.id} cx={p.x(c.lng)} cy={p.y(c.lat)} r={3.2} fill={LAYER_COLOR.l2} stroke="#FFFFFF" strokeWidth={0.8} />
      ))}
      {l1.map(({ c, n }) => (
        <g key={c.id}>
          <circle cx={p.x(c.lng)} cy={p.y(c.lat)} r={6.5} fill={LAYER_COLOR.l1} stroke="#FFFFFF" strokeWidth={1.2} />
          <text x={p.x(c.lng)} y={p.y(c.lat) + 2.6} fontSize={7.5} fontWeight={700} textAnchor="middle" fill="#FFFFFF" fontFamily={FONT}>
            {n}
          </text>
          {!compact ? (
            <text x={p.x(c.lng) + 9} y={p.y(c.lat) + 3.5} fontSize={9} fill={PALETTE.navy} fontFamily={FONT}>
              {label(c)}
            </text>
          ) : null}
        </g>
      ))}
      <g>
        <circle cx={site.x} cy={site.y} r={9} fill={LAYER_COLOR.site} stroke="#FFFFFF" strokeWidth={2} />
        {/* navy ink on coral: white fails 4.5:1 */}
        <text x={site.x} y={site.y + 3.4} fontSize={9} fontWeight={700} textAnchor="middle" fill={PALETTE.navy} fontFamily={FONT}>
          S
        </text>
      </g>
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

/** @deprecated alias kept for the existing pages.tsx import; use MapFigure / SvgTradeAreaMap. */
export const TradeAreaMap = SvgTradeAreaMap;

/* ------------------------------------------------------------------ */
/* Legend                                                                */
/* ------------------------------------------------------------------ */

type LegendItem = { kind: 'dot' | 'swatch'; color: string; fill?: string; size: number; text: string; glyph?: string; glyphColor?: string };

function legendItems(model: ReportModel): LegendItem[] {
  const l1n = Math.min(model.competitors.l1.length, L1_MARKER_CAP);
  const items: LegendItem[] = [
    { kind: 'dot', color: LAYER_COLOR.site, size: 12, text: '站点（拟选址）', glyph: 'S', glyphColor: PALETTE.navy }, // navy on coral ≥ 4.5:1
    { kind: 'dot', color: LAYER_COLOR.l1, size: 11, text: l1n > 0 ? `同菜系竞品 1–${l1n}（编号同第 7 页）` : '同菜系竞品', glyph: '1' },
    { kind: 'dot', color: LAYER_COLOR.l2, size: 8, text: `其他中餐（${model.competitors.l2_count}）` },
    { kind: 'dot', color: LAYER_COLOR.l4, size: 8, text: `华人锚点（${model.competitors.l4.length}）` },
    { kind: 'swatch', color: '#1B2A4F', fill: 'rgba(27,42,79,0.26)', size: 12, text: '步行 10 分钟' },
    { kind: 'swatch', color: '#4A5A85', fill: 'rgba(27,42,79,0.10)', size: 12, text: '车程 5·10·15 分钟' },
  ];
  if (railStations(model).length) items.push({ kind: 'dot', color: LAYER_COLOR.rail, size: 6, text: '轨道站' });
  return items;
}

function Swatch({ item }: { item: LegendItem }) {
  if (item.kind === 'swatch') {
    return <span aria-hidden style={{ display: 'inline-block', width: 16, height: item.size, background: item.fill, border: `1px solid ${item.color}`, flex: '0 0 auto' }} />;
  }
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: item.size,
        height: item.size,
        borderRadius: '50%',
        background: item.color,
        border: '1px solid #FFFFFF',
        boxShadow: '0 0 0 0.5px rgba(0,0,0,0.25)',
        color: item.glyphColor ?? '#FFFFFF',
        fontSize: item.size * 0.62,
        fontWeight: 700,
        lineHeight: 1,
        flex: '0 0 auto',
      }}
    >
      {item.glyph ?? ''}
    </span>
  );
}

/** Plain-Chinese legend for restaurant owners (no L1/L2 jargon). */
export function MapFigureLegend({ model, variant = 'hero' }: { model: ReportModel; variant?: StaticMapVariant }) {
  const compact = variant === 'thumb';
  const style: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: compact ? '3pt 10pt' : '4pt 14pt',
    fontSize: compact ? '7.5pt' : '8.5pt',
    color: PALETTE.navy,
    marginTop: compact ? '3pt' : '5pt',
    lineHeight: 1.4,
  };
  return (
    <div className={`map-figure-legend map-figure-legend-${variant}`} style={style}>
      {legendItems(model).map((it) => (
        <span key={it.text} style={{ display: 'inline-flex', alignItems: 'center', gap: '4pt' }}>
          <Swatch item={it} />
          <span>{it.text}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Figure                                                                */
/* ------------------------------------------------------------------ */

const IMG_STYLE: Record<StaticMapVariant, CSSProperties> = {
  hero: { display: 'block', width: '100%', height: 'auto', aspectRatio: '600 / 360', objectFit: 'cover', border: `1px solid ${PALETTE.rule}` },
  thumb: { display: 'block', width: '100%', height: 'auto', maxHeight: '118mm', aspectRatio: '640 / 360', objectFit: 'cover', border: `1px solid ${PALETTE.rule}` },
};

/**
 * Trade-area map figure: Google Static Maps raster with our layers + legend,
 * or the SVG fallback with a "底图暂不可用" note when `staticMap` is null.
 */
export function MapFigure({ model, staticMap, variant }: { model: ReportModel; staticMap: ResolvedStaticMap | null; variant: StaticMapVariant }) {
  const compact = variant === 'thumb';
  return (
    <figure className={`map-figure map-figure-${variant}`} style={{ margin: 0, width: '100%' }}>
      {staticMap ? (
        // eslint-disable-next-line @next/next/no-img-element -- server-rendered print page, data: URL, no next/image optimisation wanted
        <img src={staticMap.dataUrl} alt="商圈地图：等时圈、同菜系竞品、其他中餐、华人锚点" style={IMG_STYLE[variant]} />
      ) : (
        <div style={{ position: 'relative' }}>
          <SvgTradeAreaMap model={model} compact={compact} />
          <span
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              fontSize: compact ? '7.5pt' : '8.5pt',
              color: PALETTE.muted,
              background: 'rgba(255,255,255,0.9)',
              border: `1px solid ${PALETTE.rule}`,
              padding: '1pt 5pt',
              borderRadius: 2,
            }}
          >
            地图底图暂不可用 · 显示示意图
          </span>
        </div>
      )}
      <MapFigureLegend model={model} variant={variant} />
      {staticMap ? (
        <figcaption style={{ fontSize: '7pt', color: PALETTE.muted, marginTop: '2pt' }}>
          {staticMap.attribution} · 等时圈 Mapbox · POI Overture / Google
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Legacy legend (grid layout from print.css). Prefer MapFigure, which carries its own legend. */
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
          <span className="legend-dot" style={{ background: LAYER_COLOR.site, width: 12, height: 12 }} />
          <span>站点（拟选址）</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: LAYER_COLOR.l1 }} />
          <span>同菜系竞品（{model.competitors.l1.length}）</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: LAYER_COLOR.l2, width: 7, height: 7 }} />
          <span>其他中餐（{model.competitors.l2_count}）</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: LAYER_COLOR.l4, width: 7, height: 7 }} />
          <span>华人锚点（{model.competitors.l4.length}）</span>
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
