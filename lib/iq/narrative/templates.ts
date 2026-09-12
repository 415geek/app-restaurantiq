/**
 * Deterministic fallback narratives (研发提示词 Phase 6 门槛 5: "再失败 → 用模板句替代").
 * Every sentence is built only from report_model numbers and carries [src:path]
 * citations, so it passes NumberGuard by construction. Also defines the 14-page
 * structure (§5.2) shared by the LLM narrative generator and the /print renderer.
 */
import type { ReportModel } from '../model/schema';

export type PageId = `page_${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14}`;

export const PAGES: Array<{ id: PageId; n: number; zh: string; en: string; fragment: string[] }> = [
  { id: 'page_1', n: 1, zh: '封面', en: 'Cover', fragment: ['meta', 'input', 'score.total', 'score.verdict', 'confidence.total'] },
  { id: 'page_2', n: 2, zh: '执行摘要', en: 'Executive Summary', fragment: ['score', 'demand', 'finance.breakeven_monthly', 'finance.safety_monthly', 'risks', 'competitors.l1', 'competitors.l2_count', 'trade_area.primary_ring'] },
  { id: 'page_3', n: 3, zh: '商圈地图', en: 'Trade Area Map', fragment: ['trade_area.primary_ring', 'trade_area.rings', 'competitors.l1', 'competitors.l2_count', 'competitors.l4', 'access.transit'] },
  { id: 'page_4', n: 4, zh: '商圈需求', en: 'Demand Coverage', fragment: ['trade_area', 'demand.cuisine_share'] },
  { id: 'page_5', n: 5, zh: '客群画像', en: 'Audience', fragment: ['audience', 'trade_area.rings', 'demand.lunch_usd', 'demand.dinner_usd'] },
  { id: 'page_6', n: 6, zh: '竞争格局', en: 'Competitive Landscape', fragment: ['competitors'] },
  { id: 'page_7', n: 7, zh: '直接竞品对标', en: 'Direct Competitors', fragment: ['competitors.l1', 'competitors.benchmark_revenue_band', 'finance.breakeven_monthly'] },
  { id: 'page_8', n: 8, zh: '品类缺口与替代菜系', en: 'Category Gap & Alternatives', fragment: ['competitors.void', 'competitors.density_per_10k_chinese', 'score.alternatives', 'score.user_cuisine_rank'] },
  { id: 'page_9', n: 9, zh: '需求捕获模型', en: 'Demand Capture', fragment: ['demand', 'finance.breakeven_monthly'] },
  { id: 'page_10', n: 10, zh: '财务模型', en: 'Financial Model', fragment: ['finance', 'input.rent_usd', 'input.seats'] },
  { id: 'page_11', n: 11, zh: '菜系匹配评分', en: 'Cuisine Fit Score', fragment: ['score.total', 'score.verdict', 'score.dimensions', 'score.conditions'] },
  { id: 'page_12', n: 12, zh: '风险登记', en: 'Risk Register', fragment: ['risks', 'finance.occupancy_cost_ratio', 'demand.coverage_ratio'] },
  { id: 'page_13', n: 13, zh: '签约核查与 90 天计划', en: 'Pre-lease Checklist & 90-day Plan', fragment: ['score.conditions', 'finance.inputs_missing', 'input'] },
  { id: 'page_14', n: 14, zh: '方法与数据来源', en: 'Method & Sources', fragment: ['sources', 'meta', 'confidence', 'demand.cuisine_share_method', 'finance.method'] },
];

const fmtUsd = (v: number | null | undefined) => (v == null ? '未获取' : `$${Math.round(v).toLocaleString('en-US')}`);
const fmtPct = (v: number | null | undefined, digits = 0) => (v == null ? '未获取' : `${(v * 100).toFixed(digits)}%`);
const fmtInt = (v: number | null | undefined) => (v == null ? '未获取' : Math.round(v).toLocaleString('en-US'));

export function ringIndex(m: ReportModel, id: string): number {
  return m.trade_area.rings.findIndex((r) => r.id === id);
}

export function templateNarrative(m: ReportModel, page: PageId): { title: string; body: string; refs: string[] } {
  const pr = m.trade_area.primary_ring;
  const pi = ringIndex(m, pr);
  const p = m.trade_area.rings[pi];
  const d10i = ringIndex(m, 'drive10');
  const d10 = m.trade_area.rings[d10i];
  const cov = m.demand.coverage_ratio;
  const verdictZh = m.score.verdict === 'GO' ? '可做' : m.score.verdict === 'CONDITIONAL_GO' ? '有条件可做' : '不建议';
  switch (page) {
    case 'page_1':
      return { title: `${m.input.cuisine_label_zh}：${verdictZh}`, body: `综合 ${m.score.total} 分 [src:score.total]，置信度 ${m.confidence.total} [src:confidence.total]。`, refs: ['score.total', 'confidence.total'] };
    case 'page_2': {
      const covTxt = cov == null ? '需求覆盖比未获取 [src:demand.coverage_ratio]' : `捕获需求覆盖保本线 ${fmtPct(cov)} [src:demand.coverage_ratio]`;
      const title = cov == null ? `${verdictZh}：需求覆盖比未获取` : cov >= 1 ? `捕获需求覆盖保本线 ${cov.toFixed(2)} 倍，${verdictZh}` : `捕获需求仅覆盖保本线 ${fmtPct(cov)}，${verdictZh}`;
      return {
        title,
        body: `${covTxt}：模型捕获月需求 ${fmtUsd(m.demand.captured_monthly_usd)} [src:demand.captured_monthly_usd]，保本线 ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]。综合 ${m.score.total} 分 [src:score.total]；签约前条件：${m.score.conditions.map((c) => c.text_zh).join('；') || '无'}。`,
        refs: ['demand.coverage_ratio', 'demand.captured_monthly_usd', 'finance.breakeven_monthly', 'score.total', 'score.conditions'],
      };
    }
    case 'page_3':
      return {
        title: `主商圈为${pr === 'walk10' ? '步行 10 分钟' : `车程 ${p?.minutes} 分钟`}，覆盖 ${fmtInt(p?.pop)} 居民`,
        body: `主商圈 ${pr} [src:trade_area.primary_ring] 人口 ${fmtInt(p?.pop)} [src:trade_area.rings.${pi}.pop]，直接竞品 ${m.competitors.l1.length} 家 [src:competitors.l1]，其他中餐 ${m.competitors.l2_count} 家 [src:competitors.l2_count]，锚点 ${m.competitors.l4.length} 处 [src:competitors.l4]。${m.trade_area.isochrone_method === 'radius' ? '圈层为直线半径近似 [src:trade_area.isochrone_method]。' : ''}`,
        refs: ['trade_area.primary_ring', `trade_area.rings.${pi}.pop`, 'competitors.l1', 'competitors.l2_count', 'competitors.l4'],
      };
    case 'page_4': {
      const cb = m.trade_area.county_benchmark.chinese_hh_share;
      const ratio = d10?.chinese_hh_share != null && cb ? (d10.chinese_hh_share / cb).toFixed(1) : null;
      return {
        title: d10 ? `车程 10 分钟内 ${fmtInt(d10.hh)} 户，中文家庭占比 ${fmtPct(d10.chinese_hh_share)}${ratio ? `，是全县的 ${ratio} 倍` : ''}` : '圈层数据未获取',
        body: d10 ? `drive10 户数 ${fmtInt(d10.hh)} [src:trade_area.rings.${d10i}.hh]，收入中位 ${fmtUsd(d10.median_income)} [src:trade_area.rings.${d10i}.median_income]，中文家庭占比 ${fmtPct(d10.chinese_hh_share, 1)} [src:trade_area.rings.${d10i}.chinese_hh_share]，日间岗位 ${fmtInt(d10.jobs)} [src:trade_area.rings.${d10i}.jobs]，年餐饮支出 ${fmtUsd(d10.restaurant_spend_usd)} [src:trade_area.rings.${d10i}.restaurant_spend_usd]。` : '未获取 [src:trade_area.rings]',
        refs: [`trade_area.rings.${d10i}.hh`, `trade_area.rings.${d10i}.median_income`, `trade_area.rings.${d10i}.chinese_hh_share`],
      };
    }
    case 'page_5': {
      const seg = [...m.audience.segments].sort((a, b) => b.share - a.share)[0];
      const label: Record<string, string> = { chinese_family: '华人家庭', commuter_professional: '通勤白领', young_chinese: '年轻华人', non_chinese_explorer: '非华裔尝鲜' };
      return {
        title: `${label[seg.id]}占 ${fmtPct(seg.share)}，午市占比 ${fmtPct(m.audience.lunch_dinner_split[0])}`,
        body: `${label[seg.id]} ${fmtPct(seg.share)} [src:audience.segments.0.share]；午市 / 晚市 = ${fmtPct(m.audience.lunch_dinner_split[0])} / ${fmtPct(m.audience.lunch_dinner_split[1])} [src:audience.lunch_dinner_split]；午市依赖 walk10 内 ${fmtInt(m.trade_area.rings[0]?.jobs)} 个岗位 [src:trade_area.rings.0.jobs]。`,
        refs: ['audience.segments', 'audience.lunch_dinner_split', 'trade_area.rings.0.jobs'],
      };
    }
    case 'page_6': {
      const c = m.competitors;
      const band = c.walk10_l1_l2_count === 0 ? '冷启动区间' : c.walk10_l1_l2_count <= 3 ? '低集聚区间' : c.walk10_l1_l2_count <= 8 ? '集聚红利区间' : c.walk10_l1_l2_count <= 15 ? '偏饱和区间' : '饱和区间';
      return {
        title: `${m.input.cuisine_label_zh}直接竞品 ${c.l1.length} 家、中餐 ${c.l1.length + c.l2_count} 家，处于${band}`,
        body: `walk10 内中餐 ${c.walk10_l1_l2_count} 家 [src:competitors.walk10_l1_l2_count]，集聚分 ${c.cluster_score} [src:competitors.cluster_score]；L1 均分 ${c.avg_rating_l1 ?? '未获取'} [src:competitors.avg_rating_l1]；关店率 ${fmtPct(c.closure_rate)} [src:competitors.closure_rate]。`,
        refs: ['competitors.walk10_l1_l2_count', 'competitors.cluster_score', 'competitors.avg_rating_l1', 'competitors.closure_rate'],
      };
    }
    case 'page_7': {
      const b = m.competitors.benchmark_revenue_band;
      const be = m.finance.breakeven_monthly;
      const title = b.median != null && be != null ? `同品类中位月营收 ${fmtUsd(b.median)}，${b.median < be ? '低于' : '高于'}保本线` : '同品类营收带缺历史快照，仅给相对客流等级';
      return {
        title,
        body: `${b.median != null ? `标杆营收带 P25 ${fmtUsd(b.p25)} / 中位 ${fmtUsd(b.median)} / P75 ${fmtUsd(b.p75)} [src:competitors.benchmark_revenue_band]` : '营收带未获取 [src:competitors.benchmark_revenue_band.method]'}；保本线 ${fmtUsd(be)} [src:finance.breakeven_monthly]。`,
        refs: ['competitors.benchmark_revenue_band', 'finance.breakeven_monthly'],
      };
    }
    case 'page_8': {
      const top = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
      return {
        title: top.length ? `本址更适合${top[0].label_zh}（${top[0].total} 分），${m.input.cuisine_label_zh}排第 ${m.score.user_cuisine_rank} 位` : `${m.input.cuisine_label_zh}排第 ${m.score.user_cuisine_rank} 位`,
        body: `${m.competitors.void.is_void ? '该品类为空白 [src:competitors.void.is_void]' : '该品类供给较少但未满足缺口三条件 [src:competitors.void.is_void]'}；替代菜系 Top 3：${top.map((a) => `${a.label_zh} ${a.total} 分`).join('、')} [src:score.alternatives]；用户菜系名次 ${m.score.user_cuisine_rank} [src:score.user_cuisine_rank]。`,
        refs: ['competitors.void.is_void', 'score.alternatives', 'score.user_cuisine_rank'],
      };
    }
    case 'page_9':
      return {
        title: cov == null ? '需求捕获模型缺输入' : `模型捕获月需求 ${fmtUsd(m.demand.captured_monthly_usd)}，覆盖保本线 ${fmtPct(cov)}`,
        body: `捕获月需求 ${fmtUsd(m.demand.captured_monthly_usd)} [src:demand.captured_monthly_usd]（午市 ${fmtUsd(m.demand.lunch_usd)} [src:demand.lunch_usd]，晚市 ${fmtUsd(m.demand.dinner_usd)} [src:demand.dinner_usd]），日均 ${fmtInt(m.demand.captured_covers_day)} 单 [src:demand.captured_covers_day]；β = ${m.demand.huff.beta} [src:demand.huff.beta]，竞品集合 ${m.demand.huff.competitor_set} 家 [src:demand.huff.competitor_set]。`,
        refs: ['demand.captured_monthly_usd', 'demand.lunch_usd', 'demand.dinner_usd', 'demand.captured_covers_day', 'demand.huff.beta'],
      };
    case 'page_10': {
      const s = m.finance.sensitivity.find((x) => x.breaks_breakeven);
      const base = m.finance.scenarios.find((x) => x.id === 'base');
      return {
        title: s ? `${s.label_zh}即击穿保本线` : `基准情景月营收 ${fmtUsd(base?.monthly_revenue)}，高于保本线`,
        body: `保本 ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]、安全线 ${fmtUsd(m.finance.safety_monthly)} [src:finance.safety_monthly]；基准情景 ${base?.seats} 座 × ${base?.turns_per_day} 翻台 = ${base?.dine_in_covers_day} 堂食覆盖/天 [src:finance.scenarios.1]，月营收 ${fmtUsd(base?.monthly_revenue)} [src:finance.scenarios.1.monthly_revenue]。${m.finance.payback_months == null ? '未提供 CapEx，回收期不显示 [src:finance.payback_months]。' : `回收期 ${m.finance.payback_months} 个月 [src:finance.payback_months]。`}`,
        refs: ['finance.breakeven_monthly', 'finance.safety_monthly', 'finance.scenarios.1', 'finance.payback_months'],
      };
    }
    case 'page_11': {
      const weakest = [...m.score.dimensions].sort((a, b) => a.score - b.score)[0];
      return {
        title: `${m.score.total} 分 · ${verdictZh}：${weakest.label_zh}最弱（${weakest.score} 分）`,
        body: m.score.dimensions.map((d, i) => `${d.label_zh} ${d.score} × ${d.weight}% [src:score.dimensions.${i}]`).join('；') + `。条件：${m.score.conditions.map((c) => c.text_zh).join('；') || '无'} [src:score.conditions]。`,
        refs: ['score.dimensions', 'score.conditions', 'score.total'],
      };
    }
    case 'page_12': {
      const high = m.risks.filter((r) => r.prob === 'high');
      return {
        title: high.length ? `${high.length} 项高概率风险：${high.map((r) => r.risk_zh.split('，')[0]).slice(0, 2).join('；')}` : `${m.risks.length} 项风险均可运营对冲`,
        body: m.risks.slice(0, 5).map((r, i) => `${r.risk_zh}（${r.prob === 'high' ? '高' : r.prob === 'medium' ? '中' : '低'}） [src:risks.${i}]`).join('；') + '。',
        refs: m.risks.slice(0, 5).map((_, i) => `risks.${i}`),
      };
    }
    case 'page_13': {
      // Counts of conditions / missing inputs are not values in the fragment, so the
      // title names the lists instead of counting them (NumberGuard-safe).
      const parts = [m.score.conditions.length ? '签约条件' : null, m.finance.inputs_missing.length ? '缺失输入' : null].filter((x): x is string => x != null);
      return {
        title: parts.length ? `签约前必须先落实${parts.join('与')}，再谈租约` : '签约前无额外条件与缺失输入',
        body: `条件：${m.score.conditions.map((c) => c.text_zh).join('；') || '无'} [src:score.conditions]；补充：${m.finance.inputs_missing.join('、') || '无'} [src:finance.inputs_missing]。`,
        refs: ['score.conditions', 'finance.inputs_missing'],
      };
    }
    case 'page_14': {
      const ok = m.sources.filter((s) => s.status === 'ok').length;
      return {
        title: `${m.sources.length} 个数据源中 ${ok} 个完整，置信度 ${m.confidence.total}`,
        body: `数据源状态：${m.sources.map((s) => `${s.id} ${s.status}`).join('、')} [src:sources]；置信度 ${m.confidence.total} [src:confidence.total]；报告成本 $${m.meta.cost_usd.toFixed(3)} [src:meta.cost_usd]。`,
        refs: ['sources', 'confidence.total', 'meta.cost_usd'],
      };
    }
  }
}

/** Pick the JSON fragment a page's narrative may cite (dot paths, arrays allowed). */
export function pageFragment(m: ReportModel, page: PageId): Record<string, unknown> {
  const spec = PAGES.find((p) => p.id === page)!;
  const out: Record<string, unknown> = {};
  for (const path of spec.fragment) {
    const parts = path.split('.');
    let cur: unknown = m;
    for (const part of parts) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
      else {
        cur = undefined;
        break;
      }
    }
    // strip heavy geometry from ring fragments
    if (path === 'trade_area' || path === 'trade_area.rings') {
      const ta = (path === 'trade_area' ? (cur as ReportModel['trade_area']).rings : (cur as ReportModel['trade_area']['rings'])) ?? [];
      const rings = ta.map((r) => ({ ...r, geometry: undefined }));
      out[path] = path === 'trade_area' ? { ...(cur as object), rings } : rings;
    } else out[path] = cur;
  }
  return out;
}
