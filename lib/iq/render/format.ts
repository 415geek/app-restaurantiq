/**
 * Formatting + palette helpers shared by the /print pages (研发提示词 Phase 5.1).
 *
 * Number formats are locale-neutral (US digits, USD) in all three report
 * languages; only the "not available" placeholder and the labels change.
 * Every value formatter maps null/undefined to the placeholder — the report
 * never shows a blank cell or a fabricated 0.
 */
import type { Locale } from '@/lib/i18n/locale';
import type { ReportModel, RingId, SourceRow } from '../model/schema';
import { plainText, plainZh } from '../narrative/plain';
import { fill, strings, type Verdict } from './i18n';

/** Re-exported so render code keeps one import site; the rule set lives with the wording (narrative/plain.ts). */
export { plainText, plainZh };

/** Chinese placeholder (legacy default); use `strings(lang).na` for a localized one. */
export const NA = '未获取';

/** Customer-facing glossary for the data-source rows (page 14 lineage table + chips), Chinese edition. */
export const SOURCE_ZH = strings('zh').source as Record<string, { short: string; content: string; org: string; license: string }>;

/** Short chip / table label for a source row: plain name in the report language, never the raw D-id. */
export function sourceShort(row: Pick<SourceRow, 'id' | 'name'>, lang: Locale): string {
  const g = strings(lang).source as Record<string, { short: string }>;
  return g[row.id]?.short ?? row.name.split(' (')[0].split(' · ')[0].trim();
}

export function sourceShortZh(row: Pick<SourceRow, 'id' | 'name'>): string {
  return sourceShort(row, 'zh');
}

/**
 * 「数据说明」footnote: one plain sentence per degraded / missing source, plus
 * the declared pipeline degradations. Returns [] when everything is complete.
 */
export function dataNotes(m: ReportModel, lang: Locale): string[] {
  const S = strings(lang);
  const D = S.dataNotes;
  const notes: string[] = [];
  const radiusRings = m.trade_area.rings.filter((r) => r.method === 'radius');
  for (const s of m.sources) {
    if (s.status === 'ok') continue;
    const partial = s.status === 'partial';
    switch (s.id) {
      case 'D1':
        notes.push(D.D1);
        break;
      case 'D2':
        notes.push(partial ? D.D2_partial : D.D2_failed);
        break;
      case 'D3':
        notes.push(D.D3);
        break;
      case 'D4': {
        const sep = lang === 'zh' ? '、' : ', ';
        const radii = radiusRings.map((r) => fill(D.D4_radius, { ring: S.ring[r.id].label, mi: r.radius_mi == null ? S.na : fill(D.mile, { n: r.radius_mi }) })).join(sep);
        notes.push(fill(D.D4, { radii: radii ? `${lang === 'zh' ? '：' : ': '}${radii}` : '' }));
        break;
      }
      case 'D5':
        notes.push(partial ? D.D5_partial : D.D5_failed);
        break;
      case 'D6':
        notes.push(partial ? D.D6_partial : D.D6_failed);
        break;
      case 'D7':
        notes.push(partial ? D.D7_partial : D.D7_failed);
        break;
      case 'D8':
        notes.push(partial ? D.D8_partial : D.D8_failed);
        break;
      case 'D9':
        notes.push(partial ? D.D9_partial : D.D9_failed);
        break;
      case 'D11':
        notes.push(partial ? D.D11_partial : D.D11_failed);
        break;
      case 'D12':
        notes.push(D.D12);
        break;
      default:
        notes.push(fill(D.generic, { short: sourceShort(s, lang), status: partial ? D.partial : D.failed }));
    }
  }
  if (m.trade_area.isochrone_method === 'radius' && !m.sources.some((s) => s.id === 'D4' && s.status !== 'ok')) {
    notes.push(D.radiusOnly);
  }
  for (const d of m.meta.degradations) {
    if (d.startsWith('overture_not_loaded_google_only')) {
      const n = d.split(':')[1];
      notes.push(fill(D.googleOnly, { n: n ?? '—' }));
    } else notes.push(plainText(d, lang));
  }
  return [...new Set(notes)];
}

/** @deprecated Chinese-only alias of dataNotes(m, 'zh'). */
export function dataNotesZh(m: ReportModel): string[] {
  return dataNotes(m, 'zh');
}

/** Precheck reasons in plain words; source-status reasons are already covered by dataNotes(). */
export function precheckReasons(m: ReportModel, lang: Locale): string[] {
  const S = strings(lang);
  const out: string[] = [];
  for (const r of m.meta.precheck_reasons) {
    const t = r.replace(/^\[\w+\]\s*/, '');
    if (/^D\d+\s*(状态|缺失)/.test(t)) continue;
    const conf = t.match(/^(?:数据完整度|置信度)\s*(\d+)\s*<\s*(\d+)/);
    if (conf) {
      out.push(fill(S.precheck.completeness, { score: conf[1], threshold: conf[2] }));
      continue;
    }
    out.push(plainText(t.replace(/^竞品守卫：/, '竞品数据异常：'), lang));
  }
  return [...new Set(out)];
}

/** @deprecated Chinese-only alias of precheckReasons(m, 'zh'). */
export function precheckReasonsZh(m: ReportModel): string[] {
  return precheckReasons(m, 'zh');
}

export const CONFIDENCE_COMPONENT_ZH: Record<string, string> = strings('zh').confidenceComponent;
export const BAND_METHOD_ZH: Record<string, string> = strings('zh').bandMethod;

/** "Hunan Home Kitchen" and "hunan home kitchen " → same key (presentation-level dedupe). */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

/** Light print-first palette (§5.1). Coral is reserved for the verdict badge + key numbers. */
/** Brand system: Midnight Navy ink, Signal Green accent (kept under the legacy `coral` key), Warm White panels. */
export const PALETTE = {
  bg: '#FFFFFF',
  panel: '#F7F8F4',
  navy: '#0B1220',
  coral: '#22C55E',
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#DC2626',
  rule: '#E2E8F0',
  /** Secondary text; ≥ 4.5:1 on both bg and panel. */
  muted: '#475569',
  /** Text-safe darkened tones of the semantic colors (the raw green/amber fall below 4.5:1 on white). */
  greenInk: '#15803D',
  amberInk: '#B45309',
} as const;

export function fmtUsd(v: number | null | undefined, opts: { compact?: boolean; na?: string } = {}): string {
  if (v == null || !Number.isFinite(v)) return opts.na ?? NA;
  if (opts.compact && Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (opts.compact && Math.abs(v) >= 10_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

export function fmtSignedUsd(v: number | null | undefined, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

export function fmtPct(v: number | null | undefined, digits = 0, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtInt(v: number | null | undefined, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
  return Math.round(v).toLocaleString('en-US');
}

export function fmtNum(v: number | null | undefined, digits = 1, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
  return v.toFixed(digits);
}

export function fmtMulti(v: number | null | undefined, digits = 2, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
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

export function fmtMiles(v: number | null | undefined, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
  return `${v.toFixed(2)} mi`;
}

export function fmtMinutes(v: number | null | undefined, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
  return `${Math.round(v)} min`;
}

export function priceLevelLabel(v: number | null | undefined, na = NA): string {
  if (v == null || !Number.isFinite(v)) return na;
  return '$'.repeat(Math.max(1, Math.min(4, Math.round(v))));
}

/** Formatters bound to one language's "not available" placeholder. Number formats never change. */
export function makeFormatters(lang: Locale) {
  const na = strings(lang).na;
  return {
    na,
    usd: (v: number | null | undefined, opts: { compact?: boolean } = {}) => fmtUsd(v, { ...opts, na }),
    signedUsd: (v: number | null | undefined) => fmtSignedUsd(v, na),
    pct: (v: number | null | undefined, digits = 0) => fmtPct(v, digits, na),
    int: (v: number | null | undefined) => fmtInt(v, na),
    num: (v: number | null | undefined, digits = 1) => fmtNum(v, digits, na),
    multi: (v: number | null | undefined, digits = 2) => fmtMulti(v, digits, na),
    miles: (v: number | null | undefined) => fmtMiles(v, na),
    minutes: (v: number | null | undefined) => fmtMinutes(v, na),
    price: (v: number | null | undefined) => priceLevelLabel(v, na),
    date: fmtDate,
  };
}
export type Formatters = ReturnType<typeof makeFormatters>;

export const RING_LABEL: Record<RingId, { zh: string; en: string }> = {
  walk10: { zh: '步行 10 分钟范围', en: '10-min walk' },
  drive5: { zh: '开车 5 分钟范围', en: '5-min drive' },
  drive10: { zh: '开车 10 分钟范围', en: '10-min drive' },
  drive15: { zh: '开车 15 分钟范围', en: '15-min drive' },
};

export const VERDICT_LABEL: Record<Verdict, { zh: string; en: string }> = {
  GO: { zh: '可做', en: 'GO' },
  CONDITIONAL_GO: { zh: '有条件可做', en: 'CONDITIONAL GO' },
  NO_GO: { zh: '不建议', en: 'NO GO' },
};

/** Verdict labels: `label` for tables, `badge` + `sub` for the verdict badge. Unknown verdicts pass through. */
export function verdictLabel(v: string, lang: Locale): { label: string; badge: string; sub: string } {
  return strings(lang).verdict[v as Verdict] ?? { label: v, badge: v, sub: v };
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
