/**
 * Audience segments (report page 5). Four segments derived from ring facts —
 * shares are an allocation of the primary ring's household demand, indices are
 * ring value ÷ county value × 100 (Esri-style index, 100 = county average).
 */
import type { ReportModel, Ring } from '../model/schema';

export function computeAudience(input: {
  primary: Ring;
  walk10: Ring | undefined;
  county: { chinese_hh_share: number | null; median_income: number | null };
  lunch_usd: number | null;
  dinner_usd: number | null;
}): ReportModel['audience'] {
  const p = input.primary;
  const cn = p.chinese_hh_share ?? 0;
  const fam = p.family_share ?? 0.3;
  const young = p.age_25_44_share ?? 0.3;
  const jobs = input.walk10?.jobs ?? 0;
  const pop = p.pop ?? 1;

  // Allocation weights (relative), then normalized to shares.
  const wChineseFamily = cn * fam * 3;
  const wYoungChinese = cn * young * 2;
  const wCommuter = Math.min(0.4, jobs / Math.max(pop, 1)) + 0.05;
  const wExplorer = (1 - cn) * 0.25;
  const sum = wChineseFamily + wYoungChinese + wCommuter + wExplorer || 1;
  const r = (x: number) => Math.round((x / sum) * 1000) / 1000;
  const idx = (ring: number | null, county: number | null) => (ring != null && county != null && county > 0 ? Math.round((ring / county) * 100) : null);

  const segments: ReportModel['audience']['segments'] = [
    { id: 'chinese_family', share: r(wChineseFamily), index: idx(p.chinese_hh_share, input.county.chinese_hh_share), basis: '中文家庭占比 × 有孩家庭占比（主商圈）' },
    { id: 'commuter_professional', share: r(wCommuter), index: idx(jobs, pop), basis: 'walk10 岗位数 ÷ 主商圈人口' },
    { id: 'young_chinese', share: r(wYoungChinese), index: idx(p.age_25_44_share, 0.28), basis: '中文家庭占比 × 25–44 岁占比（全国基准 28%）' },
    { id: 'non_chinese_explorer', share: r(wExplorer), index: idx(p.median_income, input.county.median_income), basis: '非华裔人口 × 收入指数' },
  ];
  // Fix rounding drift so shares sum to 1.
  const drift = Math.round((1 - segments.reduce((s, x) => s + x.share, 0)) * 1000) / 1000;
  segments[0].share = Math.round((segments[0].share + drift) * 1000) / 1000;

  const l = input.lunch_usd ?? 0;
  const d = input.dinner_usd ?? 0;
  const lunchShare = l + d > 0 ? Math.round((l / (l + d)) * 100) / 100 : 0.3;
  return { segments, lunch_dinner_split: [lunchShare, Math.round((1 - lunchShare) * 100) / 100] };
}
