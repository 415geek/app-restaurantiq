/**
 * RiskEngine — risk register (report page 12), probability × impact with a
 * trigger signal and a hedge. Every row is a template filled ONLY from model
 * numbers; rows whose facts are missing are not emitted.
 */
import type { ReportModel } from '../model/schema';

type Model = Pick<ReportModel, 'finance' | 'competitors' | 'demand' | 'trade_area' | 'access' | 'input'> & {
  dev_projects?: number;
};

export function computeRisks(m: Model): ReportModel['risks'] {
  const risks: ReportModel['risks'] = [];
  const f = m.finance;
  const c = m.competitors;
  const d = m.demand;
  let id = 1;
  const push = (r: Omit<ReportModel['risks'][number], 'id'>) => risks.push({ id: id++, ...r });

  if (f.occupancy_cost_ratio != null && f.occupancy_cost_ratio > 0.1) {
    const excess = f.fixed_cost.rent != null && d.captured_monthly_usd != null ? Math.round(f.fixed_cost.rent - d.captured_monthly_usd * 0.1) : null;
    push({
      risk_zh: `租金占捕获营收 ${(f.occupancy_cost_ratio * 100).toFixed(1)}%，高于 10% 警戒线`,
      risk_en: `Rent is ${(f.occupancy_cost_ratio * 100).toFixed(1)}% of captured revenue, above the 10% line`,
      prob: f.occupancy_cost_ratio > 0.12 ? 'high' : 'medium',
      impact_usd: excess,
      trigger: '签约租金高于本报告条件页给出的上限',
      hedge: '争取免租期 / 阶梯租金 / 百分比租金条款',
    });
  }
  const base = f.scenarios.find((s) => s.id === 'base');
  const tick = f.sensitivity.find((s) => s.id === 'ticket_minus_125');
  if (tick?.breaks_breakeven && base) {
    push({
      risk_zh: `客单价下滑 12.5% 即击穿保本线（基准客单 $${base.ticket_in}）`,
      risk_en: `A 12.5% ticket drop breaks even (base ticket $${base.ticket_in})`,
      prob: 'medium',
      impact_usd: Math.abs(tick.monthly_revenue_delta),
      trigger: '开业 3 个月后实际客单价 < 基准 × 0.9',
      hedge: '设计套餐锚定客单价；控制折扣渠道占比',
    });
  }
  if (c.closure_rate != null && c.closure_rate > 0.2) {
    push({
      risk_zh: `drive10 内中餐关店率 ${(c.closure_rate * 100).toFixed(0)}%`,
      risk_en: `${(c.closure_rate * 100).toFixed(0)}% of Chinese restaurants within drive10 have closed`,
      prob: 'high',
      impact_usd: null,
      trigger: '同商圈 12 个月内再有 2 家以上关店',
      hedge: '核查关店原因（租金 / 人力 / 客流）后再签',
    });
  }
  if (c.walk10_l1_l2_count === 0) {
    push({
      risk_zh: '步行 10 分钟内没有其他中餐：无华人餐饮流量，冷启动',
      risk_en: 'No other Chinese restaurant within a 10-minute walk: cold start',
      prob: 'high',
      impact_usd: null,
      trigger: '开业首月客流 < 基准情景 40%',
      hedge: '预留 ≥ 3 个月营销预算；与 L4 锚点（亚超 / 奶茶）联合推广',
    });
  } else if (c.walk10_l1_l2_count > 15) {
    push({
      risk_zh: `步行 10 分钟内中餐 ${c.walk10_l1_l2_count} 家：饱和区间`,
      risk_en: `${c.walk10_l1_l2_count} Chinese restaurants within a 10-minute walk: saturated`,
      prob: 'medium',
      impact_usd: null,
      trigger: '同品类新店开业 / 价格战',
      hedge: '差异化定位于 L1 平均价位之外',
    });
  }
  if (c.avg_rating_l1 != null && c.avg_rating_l1 > 4.4) {
    push({
      risk_zh: `直接竞品均分 ${c.avg_rating_l1}，品质门槛高`,
      risk_en: `Direct competitors average ${c.avg_rating_l1}★ — high quality bar`,
      prob: 'medium',
      impact_usd: null,
      trigger: '开业 90 天 Google 评分 < 4.2',
      hedge: '试营业期打磨出品与服务，控制首批评论',
    });
  }
  if (d.coverage_ratio != null && d.coverage_ratio < 1) {
    push({
      risk_zh: `捕获需求仅覆盖保本线 ${(d.coverage_ratio * 100).toFixed(0)}%`,
      risk_en: `Captured demand covers only ${(d.coverage_ratio * 100).toFixed(0)}% of break-even`,
      prob: d.coverage_ratio < 0.8 ? 'high' : 'medium',
      impact_usd: f.breakeven_monthly != null && d.captured_monthly_usd != null ? Math.round(f.breakeven_monthly - d.captured_monthly_usd) : null,
      trigger: '开业 6 个月月营收 < 保本线',
      hedge: '压缩座位 / 面积以降低固定成本；先做外卖验证需求',
    });
  }
  if (m.trade_area.isochrone_method === 'radius') {
    push({
      risk_zh: '商圈为直线半径近似（等时圈未获取），人口与需求可能高估',
      risk_en: 'Trade area uses straight-line radii (isochrones unavailable); demand may be overstated',
      prob: 'medium',
      impact_usd: null,
      trigger: '—',
      hedge: '正式签约前用等时圈复核',
    });
  }
  if ((m.dev_projects ?? 0) > 0) {
    push({
      risk_zh: `周边有 ${m.dev_projects} 个在建 / 已批项目：施工期客流受影响，交付后需求上行（未计入当前需求）`,
      risk_en: `${m.dev_projects} nearby projects under construction / approved: construction-period disruption, upside on delivery (excluded from current demand)`,
      prob: 'medium',
      impact_usd: null,
      trigger: '施工围挡影响门面 / 停车',
      hedge: '租约加入施工期租金减免条款',
    });
  }
  if (m.input.capex_usd == null) {
    push({
      risk_zh: '未提供 CapEx：回收期无法评估',
      risk_en: 'CapEx not provided: payback cannot be assessed',
      prob: 'medium',
      impact_usd: null,
      trigger: '—',
      hedge: '取得装修 / 设备报价后重跑报告',
    });
  }
  return risks;
}
