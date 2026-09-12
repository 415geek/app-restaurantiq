/**
 * Formatting + palette helpers shared by the /print pages (研发提示词 Phase 5.1).
 *
 * Every value formatter maps null/undefined to 「未获取」 — the report never
 * shows a blank cell or a fabricated 0.
 */
import type { ReportModel, RingId } from '../model/schema';

export const NA = '未获取';

/** Light print-first palette (§5.1). Coral is reserved for the verdict badge + key numbers. */
export const PALETTE = {
  bg: '#FFFFFF',
  panel: '#F6F7F9',
  navy: '#1B2A4F',
  coral: '#FF6B35',
  green: '#1F8A5B',
  amber: '#C98A00',
  red: '#C63D2F',
  rule: '#E2E5EA',
  /** Secondary text; ≥ 4.5:1 on both bg and panel. */
  muted: '#566175',
  /** Text-safe darkened tones of the semantic colors (the raw green/amber fall below 4.5:1 on white). */
  greenInk: '#17714B',
  amberInk: '#7D5600',
} as const;

export function fmtUsd(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return NA;
  if (opts.compact && Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (opts.compact && Math.abs(v) >= 10_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

export function fmtSignedUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return Math.round(v).toLocaleString('en-US');
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return v.toFixed(digits);
}

export function fmtMulti(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${v.toFixed(digits)}×`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtMiles(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${v.toFixed(2)} mi`;
}

export function fmtMinutes(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return `${Math.round(v)} min`;
}

export function priceLevelLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NA;
  return '$'.repeat(Math.max(1, Math.min(4, Math.round(v))));
}

export const RING_LABEL: Record<RingId, { zh: string; en: string }> = {
  walk10: { zh: '步行 10 分钟', en: 'walk 10' },
  drive5: { zh: '车程 5 分钟', en: 'drive 5' },
  drive10: { zh: '车程 10 分钟', en: 'drive 10' },
  drive15: { zh: '车程 15 分钟', en: 'drive 15' },
};

export const VERDICT_LABEL: Record<ReportModel['score']['verdict'], { zh: string; en: string }> = {
  GO: { zh: '可做', en: 'GO' },
  CONDITIONAL_GO: { zh: '有条件可做', en: 'CONDITIONAL GO' },
  NO_GO: { zh: '不建议', en: 'NO GO' },
};

export function verdictLabel(v: string): { zh: string; en: string } {
  return VERDICT_LABEL[v as ReportModel['score']['verdict']] ?? { zh: v, en: v };
}

export const PROB_LABEL: Record<'low' | 'medium' | 'high', string> = { low: '低', medium: '中', high: '高' };
export const LEVEL_LABEL: Record<'low' | 'medium' | 'high', string> = { low: '低', medium: '中', high: '高' };

export const SEGMENT_LABEL: Record<string, { zh: string; en: string }> = {
  chinese_family: { zh: '华人家庭', en: 'Chinese families' },
  commuter_professional: { zh: '通勤白领', en: 'Commuters' },
  young_chinese: { zh: '年轻华人', en: 'Young Chinese' },
  non_chinese_explorer: { zh: '非华裔尝鲜', en: 'Non-Chinese explorers' },
};

export const SCENARIO_LABEL: Record<'pessimistic' | 'base' | 'optimistic', { zh: string; en: string }> = {
  pessimistic: { zh: '悲观', en: 'Pessimistic' },
  base: { zh: '基准', en: 'Base' },
  optimistic: { zh: '乐观', en: 'Optimistic' },
};

/** Score (0–100) → semantic fill color for meters. */
export function scoreColor(score: number): string {
  if (score >= 70) return PALETTE.green;
  if (score >= 45) return PALETTE.amber;
  return PALETTE.red;
}

/** Score (0–100) → text-safe semantic tone. */
export function scoreInk(score: number): string {
  if (score >= 70) return PALETTE.greenInk;
  if (score >= 45) return PALETTE.amberInk;
  return PALETTE.red;
}

export function probColor(p: 'low' | 'medium' | 'high'): string {
  return p === 'high' ? PALETTE.red : p === 'medium' ? PALETTE.amber : PALETTE.green;
}

/** Strip the `[src:path]` citation tags the narrative generator emits; chips carry provenance on the page. */
export function stripCitations(text: string): string {
  return text
    .replace(/\s*\[src:[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function ring(m: ReportModel, id: RingId) {
  return m.trade_area.rings.find((r) => r.id === id) ?? null;
}
