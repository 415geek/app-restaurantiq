/**
 * CuisineFitEngine — THE scoring function (研发提示词 Phase 4.1 / 4.2).
 * Every score displayed anywhere in the report is produced here; there is no
 * second dimension set (intercepts R5).
 */
import { cuisineById, getDefaults, type RangeClass } from '../params';
import type { ReportModel } from '../model/schema';
import { rentForOccupancyTarget } from './finance';

export type ScoreDimensionId = ReportModel['score']['dimensions'][number]['id'];

export interface ScoreInput {
  cuisine: string;
  range_class: RangeClass;
  coverage_ratio: number | null;
  primary_ring: {
    chinese_hh_share: number | null;
    median_income: number | null;
    family_share: number | null;
    hh: number | null;
    area_sq_mi: number | null;
  };
  drive5: { hh: number | null; area_sq_mi: number | null };
  jobs_walk10: number | null;
  competitors: {
    cluster_score: number;
    walk10_l1_l2_count: number;
    avg_rating_l1: number | null;
    closure_rate: number | null;
    l1_delivery_share: number | null;
  };
  access: {
    walkable_rail: boolean | null;
    nearest_rail_m: number | null;
    max_aadt: number | null;
    parking: { spaces: number | null; source: 'user_input' | 'overture_estimate' | 'none' };
    transit_commute_share: number | null;
  };
  finance: {
    occupancy_cost_ratio: number | null;
    rent: number | null;
    breakeven_monthly: number | null;
    safety_monthly: number | null;
    base_revenue: number | null;
  };
  demand: { captured_monthly_usd: number | null; lunch_usd: number | null; dinner_usd: number | null };
}

const LABELS: Record<ScoreDimensionId, { zh: string; en: string }> = {
  demand_coverage: { zh: '需求覆盖', en: 'Demand Coverage' },
  audience_fit: { zh: '客群匹配', en: 'Audience Fit' },
  competitive_position: { zh: '竞争态势', en: 'Competitive Position' },
  access_traffic: { zh: '可达与流量', en: 'Access & Traffic' },
  financial_viability: { zh: '财务可行', en: 'Financial Viability' },
  occasion_delivery: { zh: '场景与外卖', en: 'Occasion & Delivery' },
};

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const lin = (x: number, x0: number, x1: number) => clamp(((x - x0) / (x1 - x0)) * 100);
function bandScore(bands: Array<[number, number, number]>, x: number): number {
  for (const [lo, hi, s] of bands) if (x >= lo && x < hi) return s;
  return bands[bands.length - 1][2];
}
function avg(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const PRICE_TIER_INCOME: Record<string, number> = { $: 60_000, $$: 90_000, $$$: 120_000, $$$$: 160_000 };

/** One dimension row with the weight from params and the rounded weighted score. */
export function dimensionRow(id: ScoreDimensionId, score: number, drivers: string[]): ReportModel['score']['dimensions'][number] {
  const weight = getDefaults().score.weights[id];
  const s = Math.round(clamp(score) * 10) / 10;
  return { id, label_zh: LABELS[id].zh, label_en: LABELS[id].en, score: s, weight, weighted: Math.round(((s * weight) / 100) * 100) / 100, drivers };
}

/** 1 需求覆盖 — banded on coverage_ratio; neutral 50 when it cannot be computed. */
export function scoreDemandCoverage(coverage_ratio: number | null): { score: number; drivers: string[] } {
  if (coverage_ratio == null) return { score: 50, drivers: ['coverage_ratio 未知（需求或保本线缺失）→ 中性 50'] };
  return { score: bandScore(getDefaults().score.coverage_bands as Array<[number, number, number]>, coverage_ratio), drivers: [`coverage_ratio=${coverage_ratio.toFixed(2)}`] };
}

/**
 * 5 财务可行 — occupancy-cost bands ± the captured-vs-safety adjustment. With no
 * rent provided there is nothing to band and the ex-rent break-even must not
 * earn or lose points, so the dimension is a flat neutral 50 that says why.
 */
export function scoreFinancialViability(f: ScoreInput['finance'], captured_monthly_usd: number | null): { score: number; drivers: string[] } {
  if (f.rent == null) return { score: 50, drivers: ['租金未提供，财务维度按中性 50 分'] };
  let occ = f.occupancy_cost_ratio;
  let occNote = '占用成本比 = 租金 ÷ 捕获营收';
  if (occ == null && f.base_revenue) {
    occ = f.rent / f.base_revenue;
    occNote = '占用成本比 = 租金 ÷ 基准情景营收（捕获需求缺失）';
  }
  let fin = occ == null ? 50 : bandScore(getDefaults().finance.occupancy_cost_bands as Array<[number, number, number]>, occ);
  const drivers = [occ == null ? '占用成本比未知' : `${occNote}：${(occ * 100).toFixed(1)}%`];
  const cap = captured_monthly_usd;
  if (cap != null && f.safety_monthly != null && cap >= f.safety_monthly) {
    fin += 10;
    drivers.push('捕获营收 ≥ 安全线 +10');
  } else if (cap != null && f.breakeven_monthly != null && cap < f.breakeven_monthly) {
    fin -= 10;
    drivers.push('捕获营收 < 保本线 −10');
  }
  return { score: fin, drivers };
}

export function scoreDimensions(input: ScoreInput): ReportModel['score']['dimensions'] {
  const d = getDefaults().score;
  const cu = cuisineById(input.cuisine);
  const dims: ReportModel['score']['dimensions'] = [];
  const push = (id: ScoreDimensionId, score: number, drivers: string[]) => dims.push(dimensionRow(id, score, drivers));

  // 1 需求覆盖
  const cov = scoreDemandCoverage(input.coverage_ratio);
  push('demand_coverage', cov.score, cov.drivers);

  // 2 客群匹配
  const thr = d.audience_thresholds[input.range_class];
  const share = input.primary_ring.chinese_hh_share;
  const sShare = share == null ? null : clamp((share / thr / 1.5) * 100);
  const ideal = PRICE_TIER_INCOME[cu.price_tier] ?? 90_000;
  const inc = input.primary_ring.median_income;
  const sIncome = inc == null ? null : clamp((inc / ideal / 1.3) * 100);
  const sStructure =
    input.range_class === 'everyday'
      ? input.jobs_walk10 == null
        ? null
        : lin(input.jobs_walk10, 0, 6_000)
      : input.primary_ring.family_share == null
        ? null
        : lin(input.primary_ring.family_share, 0.1, 0.35);
  push('audience_fit', avg([sShare, sIncome, sStructure]) ?? 50, [
    `中文家庭占比 ${share == null ? '未获取' : (share * 100).toFixed(1) + '%'} vs 阈值 ${(thr * 100).toFixed(0)}%（${input.range_class}）`,
    `收入中位 ${inc == null ? '未获取' : '$' + Math.round(inc).toLocaleString()} vs 价位 ${cu.price_tier} 理想 ≥ $${ideal.toLocaleString()}`,
    input.range_class === 'everyday' ? `walk10 岗位 ${input.jobs_walk10 ?? '未获取'}` : `有孩家庭占比 ${input.primary_ring.family_share == null ? '未获取' : (input.primary_ring.family_share * 100).toFixed(0) + '%'}`,
  ]);

  // 3 竞争态势
  let comp = input.competitors.cluster_score;
  const drivers3 = [`集聚分 ${comp}（walk10 内 L1+L2 ${input.competitors.walk10_l1_l2_count} 家）`];
  const r = input.competitors.avg_rating_l1;
  if (r != null && r < d.quality_gap.low_rating) {
    comp += d.quality_gap.bonus;
    drivers3.push(`L1 均分 ${r} < ${d.quality_gap.low_rating} → 品质机会 +${d.quality_gap.bonus}`);
  } else if (r != null && r > d.quality_gap.high_rating) {
    comp -= d.quality_gap.bonus;
    drivers3.push(`L1 均分 ${r} > ${d.quality_gap.high_rating} → 高门槛 −${d.quality_gap.bonus}`);
  }
  if (input.competitors.closure_rate != null && input.competitors.closure_rate > d.closure_penalty.threshold) {
    comp -= d.closure_penalty.penalty;
    drivers3.push(`关店率 ${(input.competitors.closure_rate * 100).toFixed(0)}% > ${d.closure_penalty.threshold * 100}% → −${d.closure_penalty.penalty}`);
  }
  push('competitive_position', comp, drivers3);

  // 4 可达与流量
  const a = input.access;
  const sJobs = input.jobs_walk10 == null ? null : lin(input.jobs_walk10, 0, 8_000);
  const sRail = a.walkable_rail == null ? null : a.walkable_rail ? 100 : a.nearest_rail_m != null && a.nearest_rail_m <= 1_500 ? 60 : 20;
  const sAadt = a.max_aadt == null ? null : lin(a.max_aadt, 5_000, 30_000);
  const sPark = a.parking.source === 'user_input' ? (a.parking.spaces ?? 0) >= 20 ? 100 : lin(a.parking.spaces ?? 0, 0, 20) : a.parking.source === 'overture_estimate' ? 60 : 40;
  const sTransit = a.transit_commute_share == null ? null : lin(a.transit_commute_share, 0, 0.3);
  push('access_traffic', avg([sJobs, sRail, sAadt, sPark, sTransit]) ?? 50, [
    `walk10 岗位 ${input.jobs_walk10 ?? '未获取'}`,
    `轨道站步行可达 ${a.walkable_rail == null ? '未获取' : a.walkable_rail ? '是' : '否'}`,
    `AADT ${a.max_aadt ?? '未获取'}`,
    `停车 ${a.parking.spaces ?? '—'}（${a.parking.source}）`,
  ]);

  // 5 财务可行
  const fin = scoreFinancialViability(input.finance, input.demand.captured_monthly_usd);
  push('financial_viability', fin.score, fin.drivers);

  // 6 场景与外卖
  const lunch = input.demand.lunch_usd;
  const dinner = input.demand.dinner_usd;
  const lunchShare = lunch != null && dinner != null && lunch + dinner > 0 ? lunch / (lunch + dinner) : null;
  const sBalance = lunchShare == null ? null : lunchShare >= 0.25 && lunchShare <= 0.5 ? 100 : lunchShare < 0.25 ? lin(lunchShare, 0, 0.25) : lin(1 - lunchShare, 0.3, 0.5);
  const hhDensity = input.drive5.hh != null && input.drive5.area_sq_mi ? input.drive5.hh / input.drive5.area_sq_mi : null;
  const sDensity = hhDensity == null ? null : lin(hhDensity, 500, 3_000);
  const sDelivery = input.competitors.l1_delivery_share == null ? 60 : lin(input.competitors.l1_delivery_share, 0, 0.8);
  push('occasion_delivery', avg([sBalance, sDensity, sDelivery]) ?? 50, [
    `午市占比 ${lunchShare == null ? '未获取' : (lunchShare * 100).toFixed(0) + '%'}`,
    `drive5 户密度 ${hhDensity == null ? '未获取' : Math.round(hhDensity) + ' 户/平方英里'}`,
    `L1 提供外卖比例 ${input.competitors.l1_delivery_share == null ? '未获取（中性）' : (input.competitors.l1_delivery_share * 100).toFixed(0) + '%'}`,
  ]);

  return dims;
}

/**
 * Verdict from the total score. With no rent provided the verdict is capped at
 * CONDITIONAL_GO — a GO that never saw the largest fixed cost is indefensible.
 */
export function verdictFor(total: number, rentMissing = false): ReportModel['score']['verdict'] {
  const v = getDefaults().verdict;
  const verdict = total >= v.go ? 'GO' : total >= v.conditional ? 'CONDITIONAL_GO' : 'NO_GO';
  return rentMissing && verdict === 'GO' ? 'CONDITIONAL_GO' : verdict;
}

/** The condition every no-rent report carries first: add the rent, regenerate, and here is the ceiling. */
export function rentNotProvidedCondition(captured_monthly_usd: number | null): ReportModel['score']['conditions'][number] {
  const cap = rentForOccupancyTarget(captured_monthly_usd);
  const usd = cap == null ? null : `$${cap.toLocaleString()}`;
  return {
    dimension: 'financial_viability',
    value: cap,
    text_zh: `补充实际月租后重新生成：本报告未假设任何租金，保本线不含租金${usd ? `；按 10% 占用成本，月租上限约 ${usd}` : ''}`,
    text_en: `Add the actual monthly rent and regenerate: this report assumes no rent, the break-even excludes rent${usd ? `; at 10% occupancy cost the rent ceiling is about ${usd}` : ''}`,
  };
}

export function totalScore(dims: ReportModel['score']['dimensions']): number {
  const weightSum = dims.reduce((s, d) => s + d.weight, 0);
  if (Math.round(weightSum) !== 100) throw new Error(`score weights must sum to 100, got ${weightSum}`);
  return Math.round(dims.reduce((s, d) => s + (d.score * d.weight) / 100, 0) * 10) / 10;
}

/**
 * Two conditions, from the two weakest dimensions, with numbers back-solved from
 * the model. When no rent was provided the rent condition always takes the first
 * slot (the neutral, uninformative financial dimension is never picked as
 * "weakest") and the weakest remaining dimension takes the second.
 */
export function buildConditions(dims: ReportModel['score']['dimensions'], input: ScoreInput): ReportModel['score']['conditions'] {
  const rentMissing = input.finance.rent == null;
  const pool = rentMissing ? dims.filter((d) => d.id !== 'financial_viability') : dims;
  const weakest = [...pool].sort((a, b) => a.score - b.score).slice(0, rentMissing ? 1 : 2);
  const out: ReportModel['score']['conditions'] = [];
  const cap = input.demand.captured_monthly_usd;
  if (rentMissing) out.push(rentNotProvidedCondition(cap));
  for (const w of weakest) {
    switch (w.id) {
      case 'financial_viability': {
        const target = cap != null ? Math.round(cap * 0.1) : input.finance.base_revenue != null ? Math.round(input.finance.base_revenue * 0.1) : null;
        out.push({ dimension: w.id, value: target, text_zh: target != null ? `租金需谈至 ≤ $${target.toLocaleString()}/月，使占用成本比 ≤ 10%` : '补充租金与面积后重新评估占用成本比', text_en: target != null ? `Negotiate rent to ≤ $${target.toLocaleString()}/mo so occupancy cost ≤ 10%` : 'Provide rent and sqft to evaluate occupancy cost' });
        break;
      }
      case 'demand_coverage': {
        const gap = cap != null && input.finance.breakeven_monthly != null ? Math.max(0, Math.round(input.finance.breakeven_monthly - cap)) : null;
        out.push({ dimension: w.id, value: gap, text_zh: gap != null ? `模型捕获需求距保本线尚差 $${gap.toLocaleString()}/月，需靠午市套餐 / 外卖 / 宴席补足` : '需求覆盖比无法计算：补充竞品或人口数据', text_en: gap != null ? `Captured demand is $${gap.toLocaleString()}/mo short of break-even; close it with lunch sets / delivery / banquets` : 'Coverage ratio unavailable: competitor or demographic data missing' });
        break;
      }
      case 'audience_fit': {
        const thr = getDefaults().score.audience_thresholds[input.range_class];
        const share = input.primary_ring.chinese_hh_share;
        out.push({ dimension: w.id, value: thr, text_zh: `主商圈中文家庭占比 ${share == null ? '未获取' : (share * 100).toFixed(1) + '%'}，${input.range_class} 类菜系阈值 ${(thr * 100).toFixed(0)}%：需面向非华裔客群设计菜单或改选替代菜系`, text_en: `Chinese-speaking share ${share == null ? 'n/a' : (share * 100).toFixed(1) + '%'} vs ${(thr * 100).toFixed(0)}% threshold for a ${input.range_class} cuisine: design for non-Chinese guests or pick an alternative cuisine` });
        break;
      }
      case 'competitive_position':
        out.push({ dimension: w.id, value: input.competitors.walk10_l1_l2_count, text_zh: `步行 10 分钟内中餐 ${input.competitors.walk10_l1_l2_count} 家：${input.competitors.walk10_l1_l2_count === 0 ? '冷启动，需自带流量（预算 ≥ 3 个月营销）' : '需明确价格 × 体验差异化，避免正面价格战'}`, text_en: `${input.competitors.walk10_l1_l2_count} Chinese restaurants within a 10-min walk: ${input.competitors.walk10_l1_l2_count === 0 ? 'cold start — budget ≥ 3 months of marketing' : 'differentiate on price × experience'}` });
        break;
      case 'access_traffic':
        out.push({ dimension: w.id, value: input.access.parking.spaces, text_zh: '核实停车位数量与晚市可用性；无轨道站时以车流客为主设计动线', text_en: 'Verify parking count and evening availability; design for drive-in guests when no rail is walkable' });
        break;
      case 'occasion_delivery':
        out.push({ dimension: w.id, value: null, text_zh: '午市偏弱：设计 ≤ $18 套餐并接入 2 个外卖平台补足场景', text_en: 'Weak lunch: add a ≤ $18 set menu and two delivery platforms' });
        break;
    }
  }
  return out;
}
