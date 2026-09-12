/**
 * Pure inline-SVG chart primitives for the /print report (研发提示词 Phase 5).
 * Server-rendered, no libraries, no emoji, light palette only. Every chart
 * takes already-formatted numbers from report_model and never estimates.
 */
import { NA, PALETTE, fmtInt, fmtPct, fmtSignedUsd, fmtUsd } from './format';

const FONT = "'Inter','Noto Sans SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei','WenQuanYi Zen Hei',system-ui,sans-serif";

const text = (x: number, y: number, s: string, opts: { size?: number; anchor?: 'start' | 'middle' | 'end'; weight?: number; fill?: string; key?: string } = {}) => (
  <text
    key={opts.key}
    x={x}
    y={y}
    fontSize={opts.size ?? 9}
    textAnchor={opts.anchor ?? 'start'}
    fontWeight={opts.weight ?? 400}
    fill={opts.fill ?? PALETTE.navy}
    fontFamily={FONT}
    style={{ fontVariantNumeric: 'tabular-nums' }}
  >
    {s}
  </text>
);

/* ------------------------------------------------------------------ */
/* Twin bars: 保本线 vs 捕获需求 (page 2)                                 */
/* ------------------------------------------------------------------ */
export function TwinBars({ breakeven, captured, safety }: { breakeven: number | null; captured: number | null; safety: number | null }) {
  const W = 420;
  const H = 96;
  const max = Math.max(breakeven ?? 0, captured ?? 0, safety ?? 0, 1);
  const left = 92;
  const span = W - left - 84;
  const rows: Array<{ label: string; v: number | null; color: string }> = [
    { label: '保本线 / mo', v: breakeven, color: PALETTE.navy },
    { label: '捕获需求 / mo', v: captured, color: PALETTE.coral },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="保本线与捕获需求对比">
      {rows.map((r, i) => {
        const y = 14 + i * 36;
        const w = r.v == null ? 0 : Math.max(2, (r.v / max) * span);
        return (
          <g key={r.label}>
            {text(left - 8, y + 15, r.label, { anchor: 'end', size: 9.5 })}
            <rect x={left} y={y} width={span} height={22} fill={PALETTE.panel} />
            {r.v != null ? <rect x={left} y={y} width={w} height={22} fill={r.color} /> : null}
            {text(left + span + 6, y + 15, fmtUsd(r.v), { size: 10, weight: 600 })}
          </g>
        );
      })}
      {safety != null ? (
        <g>
          <line x1={left + (safety / max) * span} x2={left + (safety / max) * span} y1={8} y2={78} stroke={PALETTE.muted} strokeDasharray="3 2" />
          {text(left + (safety / max) * span, 90, `安全线 ${fmtUsd(safety)}`, { anchor: 'middle', size: 8, fill: PALETTE.muted })}
        </g>
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal bars (generic)                                             */
/* ------------------------------------------------------------------ */
export function HBars({ rows, valueLabel, max: maxIn, height = 22, gap = 8, labelWidth = 110, valueWidth = 80, width = 420 }: {
  rows: Array<{ label: string; value: number | null; color?: string; sub?: string }>;
  valueLabel: (v: number | null) => string;
  max?: number;
  height?: number;
  gap?: number;
  labelWidth?: number;
  valueWidth?: number;
  width?: number;
}) {
  const max = maxIn ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  const span = width - labelWidth - valueWidth;
  const H = rows.length * (height + gap) + 4;
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" role="img">
      {rows.map((r, i) => {
        const y = 2 + i * (height + gap);
        const w = r.value == null ? 0 : Math.max(2, (Math.max(0, r.value) / max) * span);
        return (
          <g key={`${r.label}-${i}`}>
            {text(labelWidth - 8, y + height / 2 + 3.5, r.label, { anchor: 'end', size: 9 })}
            <rect x={labelWidth} y={y} width={span} height={height} fill={PALETTE.panel} />
            {r.value != null ? <rect x={labelWidth} y={y} width={w} height={height} fill={r.color ?? PALETTE.navy} /> : null}
            {text(labelWidth + span + 6, y + height / 2 + 3.5, valueLabel(r.value), { size: 9.5, weight: 600 })}
            {r.sub ? text(labelWidth + 4, y + height / 2 + 3.5, r.sub, { size: 8, fill: '#FFFFFF' }) : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Segment share bars + index (page 5)                                  */
/* ------------------------------------------------------------------ */
export function SegmentBars({ rows }: { rows: Array<{ label: string; share: number; index: number | null }> }) {
  const W = 420;
  const rowH = 30;
  const H = rows.length * rowH + 22;
  const left = 96;
  const span = 200;
  const maxShare = Math.max(0.01, ...rows.map((r) => r.share));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="客群份额与指数">
      {text(left, 10, '份额 · Share', { size: 8, fill: PALETTE.muted })}
      {text(left + span + 12, 10, '指数 · Index (100 = 全国)', { size: 8, fill: PALETTE.muted })}
      {rows.map((r, i) => {
        const y = 18 + i * rowH;
        const w = Math.max(2, (r.share / maxShare) * span);
        const idxColor = r.index == null ? PALETTE.muted : r.index >= 120 ? PALETTE.green : r.index >= 80 ? PALETTE.amber : PALETTE.red;
        return (
          <g key={r.label}>
            {text(left - 8, y + 15, r.label, { anchor: 'end', size: 9.5 })}
            <rect x={left} y={y + 3} width={span} height={18} fill={PALETTE.panel} />
            <rect x={left} y={y + 3} width={w} height={18} fill={PALETTE.navy} />
            {w >= 34
              ? text(left + 4, y + 15.5, fmtPct(r.share), { size: 8.5, fill: '#FFFFFF', weight: 600 })
              : text(left + w + 4, y + 15.5, fmtPct(r.share), { size: 8.5, fill: PALETTE.navy, weight: 600 })}
            <circle cx={left + span + 18} cy={y + 12} r={4} fill={idxColor} />
            {text(left + span + 28, y + 15.5, r.index == null ? NA : String(Math.round(r.index)), { size: 10, weight: 600 })}
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Lunch / dinner split (pages 5, 9)                                    */
/* ------------------------------------------------------------------ */
export function SplitBar({ a, b, labelA, labelB, valueA, valueB }: { a: number; b: number; labelA: string; labelB: string; valueA?: string; valueB?: string }) {
  const W = 420;
  const H = 46;
  const total = a + b || 1;
  const wa = (a / total) * W;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${labelA} / ${labelB}`}>
      <rect x={0} y={4} width={wa} height={22} fill={PALETTE.navy} />
      <rect x={wa} y={4} width={W - wa} height={22} fill={PALETTE.rule} />
      {text(6, 19.5, `${labelA} ${fmtPct(a / total)}`, { size: 9.5, fill: '#FFFFFF', weight: 600 })}
      {text(W - 6, 19.5, `${labelB} ${fmtPct(b / total)}`, { anchor: 'end', size: 9.5, weight: 600 })}
      {valueA ? text(6, 40, valueA, { size: 8.5, fill: PALETTE.muted }) : null}
      {valueB ? text(W - 6, 40, valueB, { anchor: 'end', size: 8.5, fill: PALETTE.muted }) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Price ladder (page 6)                                                */
/* ------------------------------------------------------------------ */
export function PriceLadder({ ladder }: { ladder: Array<{ level: number; count: number }> }) {
  const rows = [1, 2, 3, 4].map((lv) => ({ label: '$'.repeat(lv), value: ladder.find((l) => l.level === lv)?.count ?? 0 }));
  return <HBars rows={rows} valueLabel={(v) => `${fmtInt(v)} 家`} labelWidth={60} valueWidth={60} height={16} gap={6} width={300} />;
}

/* ------------------------------------------------------------------ */
/* U-shaped cluster curve with the site's walk10 count marked (page 6)  */
/* ------------------------------------------------------------------ */
export function ClusterCurve({ walk10Count, clusterScore }: { walk10Count: number; clusterScore: number }) {
  const W = 420;
  const H = 150;
  const left = 34;
  const right = W - 12;
  const top = 14;
  const bottom = H - 30;
  const maxN = 20;
  // Piecewise band curve: 0 冷启动 → 1–3 低集聚 → 4–8 集聚红利 (peak) → 9–15 偏饱和 → 16+ 饱和.
  const score = (n: number) => (n <= 0 ? 20 : n <= 3 ? 20 + (n / 3) * 40 : n <= 8 ? 60 + ((n - 3) / 5) * 40 : n <= 15 ? 100 - ((n - 8) / 7) * 50 : Math.max(10, 50 - ((n - 15) / 5) * 30));
  const x = (n: number) => left + (Math.min(n, maxN) / maxN) * (right - left);
  const y = (s: number) => bottom - (s / 100) * (bottom - top);
  const pts: string[] = [];
  for (let n = 0; n <= maxN; n += 0.5) pts.push(`${x(n).toFixed(1)},${y(score(n)).toFixed(1)}`);
  const bands = [
    { from: 0, to: 0.5, label: '冷启动' },
    { from: 0.5, to: 3.5, label: '低集聚' },
    { from: 3.5, to: 8.5, label: '集聚红利' },
    { from: 8.5, to: 15.5, label: '偏饱和' },
    { from: 15.5, to: 20, label: '饱和' },
  ];
  const sx = x(walk10Count);
  const sy = y(clusterScore);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="集聚曲线">
      {bands.map((b, i) => (
        <g key={b.label}>
          <rect x={x(b.from)} y={top} width={x(b.to) - x(b.from)} height={bottom - top} fill={i % 2 ? PALETTE.panel : '#FFFFFF'} />
          {text((x(b.from) + x(b.to)) / 2, bottom + 12, b.label, { anchor: 'middle', size: 8, fill: PALETTE.muted })}
        </g>
      ))}
      <polyline points={pts.join(' ')} fill="none" stroke={PALETTE.navy} strokeWidth={1.6} />
      <line x1={left} x2={right} y1={bottom} y2={bottom} stroke={PALETTE.rule} />
      <line x1={left} x2={left} y1={top} y2={bottom} stroke={PALETTE.rule} />
      {text(left - 4, bottom + 3, '0', { anchor: 'end', size: 8, fill: PALETTE.muted })}
      {text(left - 4, top + 3, '100', { anchor: 'end', size: 8, fill: PALETTE.muted })}
      {[0, 5, 10, 15, 20].map((n) => text(x(n), bottom + 24, n === 20 ? '20+' : String(n), { anchor: 'middle', size: 8, fill: PALETTE.muted, key: `t${n}` }))}
      <line x1={sx} x2={sx} y1={top} y2={bottom} stroke={PALETTE.coral} strokeDasharray="3 2" />
      <circle cx={sx} cy={sy} r={5} fill={PALETTE.coral} stroke="#FFFFFF" strokeWidth={1.5} />
      {text(Math.min(sx + 8, right - 90), Math.max(sy - 6, top + 8), `本址 walk10 ${walk10Count} 家 · ${clusterScore} 分`, { size: 9, weight: 600 })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked bar by ring (page 9)                                          */
/* ------------------------------------------------------------------ */
export function StackedRingBar({ parts, total }: { parts: Array<{ label: string; value: number; share: number }>; total: number | null }) {
  const W = 420;
  const H = 64;
  const sum = parts.reduce((s, p) => s + p.value, 0) || 1;
  const shades = [PALETTE.navy, '#3D4E7A', '#6B7AA1', '#9AA6C4'];
  const offsets = parts.reduce<number[]>((acc, p, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (parts[i - 1].value / sum) * W);
    return acc;
  }, []);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="按圈层捕获需求">
      {parts.map((p, i) => {
        const w = (p.value / sum) * W;
        const x0 = offsets[i];
        return (
          <g key={p.label}>
            <rect x={x0} y={6} width={w} height={26} fill={shades[i % shades.length]} />
            {w > 60 ? text(x0 + 6, 23, `${p.label} ${fmtPct(p.share)}`, { size: 9, fill: '#FFFFFF', weight: 600 }) : null}
            {text(x0 + Math.min(6, w / 2), 48, fmtUsd(p.value), { size: 8.5, fill: PALETTE.navy })}
          </g>
        );
      })}
      {text(W, 60, `合计 ${fmtUsd(total)} / mo`, { anchor: 'end', size: 9, weight: 600 })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Coverage-ratio gauge (page 9)                                        */
/* ------------------------------------------------------------------ */
export function CoverageGauge({ ratio }: { ratio: number | null }) {
  const W = 220;
  const H = 130;
  const cx = W / 2;
  const cy = 108;
  const r = 84;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const clamp = ratio == null ? 0 : Math.max(0, Math.min(1, ratio / 1.5));
  const color = ratio == null ? PALETTE.muted : ratio >= 1.28 ? PALETTE.green : ratio >= 1 ? PALETTE.amber : PALETTE.red;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="需求覆盖比">
      <path d={arc(0, 1)} stroke={PALETTE.panel} strokeWidth={16} fill="none" />
      {clamp > 0 ? <path d={arc(0, clamp)} stroke={color} strokeWidth={16} fill="none" /> : null}
      <line x1={cx + r * Math.cos(Math.PI * (1 - 1 / 1.5))} y1={cy - r * Math.sin(Math.PI * (1 - 1 / 1.5)) - 12} x2={cx + r * Math.cos(Math.PI * (1 - 1 / 1.5))} y2={cy - r * Math.sin(Math.PI * (1 - 1 / 1.5)) + 12} stroke={PALETTE.navy} strokeWidth={1.5} />
      {text(cx, cy - 22, ratio == null ? NA : `${(ratio * 100).toFixed(0)}%`, { anchor: 'middle', size: 22, weight: 700 })}
      {text(cx, cy - 6, '捕获需求 ÷ 保本线', { anchor: 'middle', size: 8.5, fill: PALETTE.muted })}
      {text(cx - r - 2, cy + 12, '0', { anchor: 'start', size: 8, fill: PALETTE.muted })}
      {text(cx + r + 2, cy + 12, '150%', { anchor: 'end', size: 8, fill: PALETTE.muted })}
      {text(cx + r * Math.cos(Math.PI * (1 - 1 / 1.5)) + 4, cy - r * Math.sin(Math.PI * (1 - 1 / 1.5)) - 14, '100% 保本', { size: 8, fill: PALETTE.navy })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Sensitivity waterfall (page 10)                                      */
/* ------------------------------------------------------------------ */
export function SensitivityWaterfall({ base, breakeven, items }: { base: number | null; breakeven: number | null; items: Array<{ label: string; delta: number; breaks: boolean }> }) {
  const W = 420;
  const H = 150;
  const left = 40;
  const right = W - 12;
  const top = 14;
  const bottom = H - 28;
  const vals = [base ?? 0, breakeven ?? 0, ...items.map((i) => (base ?? 0) + i.delta)];
  const max = Math.max(1, ...vals) * 1.08;
  const min = Math.min(0, ...vals);
  const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const n = items.length + 1;
  const slot = (right - left) / n;
  const bw = Math.min(46, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="敏感性分析">
      <line x1={left} x2={right} y1={bottom} y2={bottom} stroke={PALETTE.rule} />
      {base != null ? (
        <g>
          <rect x={left + slot / 2 - bw / 2} y={y(base)} width={bw} height={bottom - y(base)} fill={PALETTE.navy} />
          {text(left + slot / 2, y(base) - 4, fmtUsd(base, { compact: true }), { anchor: 'middle', size: 8.5, weight: 600 })}
          {text(left + slot / 2, bottom + 12, '基准月营收', { anchor: 'middle', size: 8 })}
        </g>
      ) : (
        text(left + slot / 2, bottom - 6, NA, { anchor: 'middle', size: 9 })
      )}
      {items.map((it, i) => {
        const x0 = left + slot * (i + 1) + slot / 2 - bw / 2;
        const from = base ?? 0;
        const to = from + it.delta;
        const yTop = y(Math.max(from, to));
        const yBot = y(Math.min(from, to));
        const color = it.delta < 0 ? (it.breaks ? PALETTE.red : PALETTE.amber) : PALETTE.green;
        return (
          <g key={it.label}>
            <line x1={x0 - (slot - bw) / 2} x2={x0 + bw + (slot - bw) / 2} y1={y(from)} y2={y(from)} stroke={PALETTE.rule} strokeDasharray="2 2" />
            <rect x={x0} y={yTop} width={bw} height={Math.max(1.5, yBot - yTop)} fill={color} />
            {text(x0 + bw / 2, yTop - 4, fmtSignedUsd(it.delta), { anchor: 'middle', size: 8, weight: 600 })}
            {text(x0 + bw / 2, bottom + 12, it.label, { anchor: 'middle', size: 8 })}
            {it.breaks ? text(x0 + bw / 2, bottom + 22, '击穿保本', { anchor: 'middle', size: 7.5, fill: PALETTE.red }) : null}
          </g>
        );
      })}
      {breakeven != null ? (
        <g>
          <line x1={left} x2={right} y1={y(breakeven)} y2={y(breakeven)} stroke={PALETTE.coral} strokeWidth={1.2} strokeDasharray="4 2" />
          {/* label sits on its own white plate so it never lands on a bar */}
          <rect x={right - 92} y={y(breakeven) - 13} width={92} height={12} fill="#FFFFFF" stroke={PALETTE.rule} strokeWidth={0.6} />
          {text(right - 3, y(breakeven) - 4, `保本线 ${fmtUsd(breakeven, { compact: true })}`, { anchor: 'end', size: 8, weight: 600 })}
        </g>
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Score meter (page 11)                                                */
/* ------------------------------------------------------------------ */
export function ScoreMeter({ score, width = 90, height = 8 }: { score: number; width?: number; height?: number }) {
  const w = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 70 ? PALETTE.green : score >= 45 ? PALETTE.amber : PALETTE.red;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${score} 分`}>
      <rect x={0} y={0} width={width} height={height} rx={height / 2} fill={PALETTE.rule} />
      <rect x={0} y={0} width={width * w} height={height} rx={height / 2} fill={color} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Density vs hub median (page 8)                                       */
/* ------------------------------------------------------------------ */
export function DensityBar({ density, ratioVsHub }: { density: number | null; ratioVsHub: number | null }) {
  const hub = density != null && ratioVsHub != null && ratioVsHub > 0 ? density / ratioVsHub : null;
  const rows = [
    { label: '本址 / 万华裔', value: density, color: PALETTE.navy },
    { label: '华人枢纽中位', value: hub, color: PALETTE.rule },
  ];
  return <HBars rows={rows} valueLabel={(v) => (v == null ? NA : `${v.toFixed(1)} 家`)} labelWidth={84} valueWidth={56} width={300} height={18} gap={6} />;
}

/* ------------------------------------------------------------------ */
/* Risk matrix: probability × impact (page 12)                          */
/* ------------------------------------------------------------------ */
export function RiskMatrix({ risks }: { risks: Array<{ id: number; prob: 'low' | 'medium' | 'high'; impact_usd: number | null }> }) {
  const W = 420;
  const H = 180;
  const left = 56;
  const top = 10;
  const cellW = (W - left - 8) / 3;
  const cellH = (H - top - 26) / 3;
  const impacts = risks.map((r) => r.impact_usd).filter((v): v is number => v != null);
  const maxImpact = Math.max(1, ...impacts);
  const impactCol = (v: number | null) => (v == null ? 0 : v >= maxImpact * 0.5 ? 2 : v >= maxImpact * 0.15 ? 1 : 0);
  const probRow = (p: 'low' | 'medium' | 'high') => (p === 'high' ? 0 : p === 'medium' ? 1 : 2);
  const placed: Record<string, number> = {};
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="风险矩阵">
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => {
          const heat = (2 - r) + c; // 0..4
          const fill = heat >= 3 ? '#FBE3DC' : heat === 2 ? '#FBF0D3' : PALETTE.panel;
          return <rect key={`${r}${c}`} x={left + c * cellW} y={top + r * cellH} width={cellW - 2} height={cellH - 2} fill={fill} />;
        }),
      )}
      {['高', '中', '低'].map((l, i) => text(left - 8, top + i * cellH + cellH / 2 + 3, `概率 ${l}`, { anchor: 'end', size: 8.5, key: `p${i}` }))}
      {['影响 低 / 未获取', '影响 中', '影响 高'].map((l, i) => text(left + i * cellW + cellW / 2, H - 8, l, { anchor: 'middle', size: 8.5, key: `i${i}` }))}
      {risks.map((rk) => {
        const r = probRow(rk.prob);
        const c = impactCol(rk.impact_usd);
        const key = `${r}${c}`;
        const k = placed[key] ?? 0;
        placed[key] = k + 1;
        const cx = left + c * cellW + 16 + k * 26;
        const cy = top + r * cellH + cellH / 2;
        // marker fills keep ≥ 4.5:1 with their digit: red/white 5.1, amber/navy 4.8, green-ink/white 6.0
        const marker = rk.prob === 'high' ? { fill: PALETTE.red, ink: '#FFFFFF' } : rk.prob === 'medium' ? { fill: PALETTE.amber, ink: PALETTE.navy } : { fill: PALETTE.greenInk, ink: '#FFFFFF' };
        return (
          <g key={rk.id}>
            <circle cx={cx} cy={cy} r={10} fill={marker.fill} />
            {text(cx, cy + 3.5, String(rk.id), { anchor: 'middle', size: 9, weight: 700, fill: marker.ink })}
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 90-day timeline (page 13)                                            */
/* ------------------------------------------------------------------ */
export function Timeline({ steps }: { steps: Array<{ day: string; label: string }> }) {
  const W = 420;
  const H = 40 + steps.length * 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="90 天计划">
      <line x1={14} x2={14} y1={10} y2={H - 10} stroke={PALETTE.rule} strokeWidth={2} />
      {steps.map((s, i) => {
        const y = 16 + i * 22;
        return (
          <g key={`${s.day}-${i}`}>
            <circle cx={14} cy={y} r={5} fill={PALETTE.navy} />
            {text(14, y + 3.5, String(i + 1), { anchor: 'middle', size: 7, fill: '#FFFFFF', weight: 700 })}
            {text(28, y + 3.5, s.day, { size: 8.5, fill: PALETTE.muted, weight: 600 })}
            {text(84, y + 3.5, s.label, { size: 9 })}
          </g>
        );
      })}
    </svg>
  );
}
