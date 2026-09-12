/**
 * Formatting + palette helpers shared by the /print pages (研发提示词 Phase 5.1).
 *
 * Every value formatter maps null/undefined to 「未获取」 — the report never
 * shows a blank cell or a fabricated 0.
 */
import type { ReportModel, RingId, SourceRow } from '../model/schema';
import { plainZh } from '../narrative/templates';

/** Re-exported so render code keeps one import site; the rule set lives with the wording (narrative/templates.ts). */
export { plainZh };

export const NA = '未获取';

/** Customer-facing glossary for the data-source rows (page 14 lineage table + chips). */
export const SOURCE_ZH: Record<string, { short: string; content: string; org: string; license: string }> = {
  D1: { short: '地址定位', content: '地址核对与所在的人口普查小区', org: '美国人口普查局（Census Geocoder）', license: '公共领域，可自由使用' },
  D2: { short: '人口普查', content: '常住人口、户数、收入、华裔与中文家庭占比、年龄、家庭结构', org: '美国人口普查局 ACS 2023 五年数据', license: '公共领域，可自由使用' },
  D3: { short: '就业点数据', content: '各地块的日间工作岗位数（午市客源）', org: '美国人口普查局 LEHD LODES', license: '公共领域，可自由使用' },
  D4: { short: '可达范围', content: '步行 10 分钟、开车 5 / 10 / 15 分钟可达范围（等时圈）', org: 'Mapbox 路网', license: 'Mapbox 服务条款' },
  D5: { short: '餐饮门店底图', content: '周边餐饮门店名单与菜系（竞品底图）', org: 'Overture Maps 开放地图数据', license: 'CDLA-Permissive-2.0 开放许可' },
  D6: { short: 'Google 地图', content: '门店评分、评论数、价位、营业状态、营业时间', org: 'Google 地图平台（Places API）', license: 'Google 地图平台服务条款' },
  D7: { short: '客流代理', content: '按评论数增长推算的相对客流等级', org: 'RestaurantIQ 每月快照（基于 Google 评论数）', license: '内部数据，仅作相对等级' },
  D8: { short: '租金对标', content: '周边商铺挂牌租金样本', org: '网络公开挂牌信息与用户提供的链接', license: '公开信息，合理引用' },
  D9: { short: '交通与车流量', content: '附近轨道车站、出站客流与道路日车流量', org: 'BART / Caltrain 开放数据 · 加州交通局', license: '公开数据' },
  D10: { short: '居民餐饮支出', content: '不同收入家庭的年餐饮支出', org: '美国劳工统计局消费支出调查（CEX 2023）', license: '公共领域，可自由使用' },
  D11: { short: '周边在建项目', content: '周边在建 / 已批准的开发项目', org: '网络公开新闻与规划公告', license: '公开信息，合理引用' },
  D12: { short: '您的输入', content: '租金、面积、座位、客单价、外卖占比等', org: '报告申请表', license: '用户提供' },
};

/** Short chip / table label for a source row: plain Chinese name, never the raw D-id. */
export function sourceShortZh(row: Pick<SourceRow, 'id' | 'name'>): string {
  return SOURCE_ZH[row.id]?.short ?? row.name.split(' (')[0].split(' · ')[0].trim();
}

/**
 * 「数据说明」footnote: one plain sentence per degraded / missing source, plus
 * the declared pipeline degradations. Returns [] when everything is complete.
 */
export function dataNotesZh(m: ReportModel): string[] {
  const notes: string[] = [];
  const radiusRings = m.trade_area.rings.filter((r) => r.method === 'radius');
  for (const s of m.sources) {
    if (s.status === 'ok') continue;
    const partial = s.status === 'partial';
    const short = sourceShortZh(s);
    switch (s.id) {
      case 'D1':
        notes.push('地址定位未完全命中，所在人口普查小区可能有偏差');
        break;
      case 'D2':
        notes.push(partial ? '人口普查数据部分缺失，对应指标显示「未获取」' : '人口普查数据未获取');
        break;
      case 'D3':
        notes.push('日间岗位数由通勤普查数据反推（就业点数据未加载），精度较低');
        break;
      case 'D4': {
        const radii = radiusRings.map((r) => `${RING_LABEL[r.id].zh}≈直线 ${r.radius_mi == null ? NA : `${r.radius_mi} 英里`}`).join('、');
        notes.push(`可达范围以直线半径近似（未接入路网等时圈）${radii ? `：${radii}` : ''}；圈内人口与竞品按圆形估算，可能偏高`);
        break;
      }
      case 'D5':
        notes.push(partial ? '餐饮门店底图部分缺失，竞品名单以 Google 地图补充' : '餐饮门店底图未加载，竞品名单仅来自 Google 地图');
        break;
      case 'D6':
        notes.push(partial ? 'Google 地图部分类型查询未完成，个别门店可能缺失，未做补估' : 'Google 地图数据未获取：评分、评论数与营业状态缺失');
        break;
      case 'D7':
        notes.push(partial ? '客流等级按当前评论数排位得出，为相对值，不代表实际客流' : '客流等级未获取');
        break;
      case 'D8':
        notes.push(partial ? '租金对标样本不足，溢价判断仅供参考' : '租金对标未获取');
        break;
      case 'D9':
        notes.push(partial ? '部分车站无客流数据，或道路车流量未获取' : '交通与车流量数据未获取');
        break;
      case 'D11':
        notes.push(partial ? '周边在建项目信息不完整，需人工核对' : '周边在建项目信息未获取');
        break;
      case 'D12':
        notes.push('部分输入未提供，已按默认值或面积估算（见第 13 页「补充输入」）');
        break;
      default:
        notes.push(`${short}：数据${partial ? '部分缺失' : '未获取'}`);
    }
  }
  if (m.trade_area.isochrone_method === 'radius' && !m.sources.some((s) => s.id === 'D4' && s.status !== 'ok')) {
    notes.push('可达范围以直线半径近似（未接入路网等时圈）');
  }
  for (const d of m.meta.degradations) {
    if (d.startsWith('overture_not_loaded_google_only')) {
      const n = d.split(':')[1];
      notes.push(`餐饮门店底图未加载，本报告以 Google 地图返回的 ${n ?? '—'} 家餐饮门店作为竞品池`);
    } else notes.push(plainZh(d));
  }
  return [...new Set(notes)];
}

/** Precheck reasons in plain words; source-status reasons are already covered by dataNotesZh(). */
export function precheckReasonsZh(m: ReportModel): string[] {
  const out: string[] = [];
  for (const r of m.meta.precheck_reasons) {
    const t = r.replace(/^\[\w+\]\s*/, '');
    if (/^D\d+\s*(状态|缺失)/.test(t)) continue;
    const conf = t.match(/^(?:数据完整度|置信度)\s*(\d+)\s*<\s*(\d+)/);
    if (conf) {
      out.push(`数据完整度 ${conf[1]} 分，低于 ${conf[2]} 分门槛`);
      continue;
    }
    out.push(plainZh(t.replace(/^竞品守卫：/, '竞品数据异常：')));
  }
  return [...new Set(out)];
}

export const CONFIDENCE_COMPONENT_ZH: Record<string, string> = {
  acs: '人口普查',
  competitors: '竞品数据',
  traffic_proxy: '客流代理',
  rent_comps: '租金对标',
  daytime_pop: '日间人口',
  transit: '交通',
  dev_pipeline: '在建项目',
  user_inputs: '您的输入',
};

export const BAND_METHOD_ZH: Record<string, string> = {
  insufficient_history: '无历史快照，只能给相对客流等级',
  relative_tier_only: '无历史快照，只能给相对客流等级',
  snapshot_growth: '按每月新增评论数推算',
};

/** "Hunan Home Kitchen" and "hunan home kitchen " → same key (presentation-level dedupe). */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

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
  walk10: { zh: '步行 10 分钟范围', en: 'walk 10' },
  drive5: { zh: '开车 5 分钟范围', en: 'drive 5' },
  drive10: { zh: '开车 10 分钟范围', en: 'drive 10' },
  drive15: { zh: '开车 15 分钟范围', en: 'drive 15' },
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
