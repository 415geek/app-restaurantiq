/**
 * Deterministic fallback narratives (研发提示词 Phase 6 门槛 5: "再失败 → 用模板句替代").
 * Every sentence is built only from report_model numbers and carries [src:path]
 * citations, so it passes NumberGuard by construction. Also defines the 15-page
 * structure (§5.2 + 总结与建议) shared by the LLM narrative generator and the
 * /print renderer.
 *
 * Wording rule: written for a restaurant owner — plain Chinese, concrete
 * numbers, no ring ids / layer codes / field names / English abbreviations.
 */
import type { ReportModel } from '../model/schema';

export type PageId = `page_${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15}`;

export const PAGES: Array<{ id: PageId; n: number; zh: string; en: string; fragment: string[] }> = [
  { id: 'page_1', n: 1, zh: '报告概览', en: 'At a Glance', fragment: ['meta', 'input', 'score.total', 'score.verdict', 'confidence.total'] },
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
  { id: 'page_15', n: 15, zh: '总结与建议', en: 'Summary', fragment: ['score', 'demand.coverage_ratio', 'demand.captured_monthly_usd', 'finance.breakeven_monthly', 'finance.occupancy_cost_ratio', 'finance.inputs_missing', 'risks', 'input'] },
];

const fmtUsd = (v: number | null | undefined) => (v == null ? '未获取' : `$${Math.round(v).toLocaleString('en-US')}`);
const fmtPct = (v: number | null | undefined, digits = 0) => (v == null ? '未获取' : `${(v * 100).toFixed(digits)}%`);
const fmtInt = (v: number | null | undefined) => (v == null ? '未获取' : Math.round(v).toLocaleString('en-US'));

/**
 * Plain-Chinese rewrite of engine identifiers that leak into model strings
 * (score drivers, conditions, risk triggers, guard notes, inputs_missing…).
 * The report is read by restaurant owners: no ring ids, layer codes, field
 * names or English abbreviations in customer-facing text. Digits are never
 * touched, so NumberGuard results are unaffected.
 */
const PLAIN_ZH: Array<[RegExp, string]> = [
  [/\bwalk10\b/g, '步行 10 分钟范围'],
  [/\bdrive5\b/g, '开车 5 分钟范围'],
  [/\bdrive10\b/g, '开车 10 分钟范围'],
  [/\bdrive15\b/g, '开车 15 分钟范围'],
  [/\bcoverage_ratio\s*=\s*/g, '需求覆盖率 = '],
  [/\bcoverage_ratio\b/g, '需求覆盖率'],
  [/\boccupancy_cost_ratio\b/g, '占用成本比'],
  [/\bcluster_score\b/g, '集聚分'],
  [/\bL1\s*\+\s*L2\b/g, '同菜系竞品 + 其他中餐'],
  [/\bL1\b/g, '同菜系竞品'],
  [/\bL2\b/g, '其他中餐'],
  [/\bL3\b/g, '其他亚洲餐'],
  [/\bL4\b/g, '华人客流聚集点'],
  [/\bHHI\b/g, '集中度'],
  [/\bHuff\b/g, '需求分流模型'],
  [/\bP25\b/g, '低位'],
  [/\bP75\b/g, '高位'],
  [/\bAADT\b/g, '道路日车流量'],
  [/\bCapEx\b/gi, '开办投入'],
  [/β/g, '距离衰减参数'],
  [/α/g, '吸引力参数'],
  [/\bseats\s*×\s*turns\b/g, '座位数 × 翻台率'],
  [/\bseats\b/g, '座位数'],
  [/\bticket_in\b/g, '堂食客单价'],
  [/\bticket_delivery\b/g, '外卖客单价'],
  [/\bdelivery_ratio\b/g, '外卖占比'],
  [/\bparking_spaces\b/g, '车位数'],
  [/\brent_usd\b/g, '月租'],
  [/\bsqft\b/g, '面积'],
  [/[（(]destination[）)]/g, '（目的地型菜系）'],
  [/[（(]regular[）)]/g, '（常规型菜系）'],
  [/[（(]everyday[）)]/g, '（日常型菜系）'],
  [/[（(]none[）)]/g, '（未提供）'],
  [/[（(]D5\s*\+\s*D6[）)]/g, '（门店底图 + Google 地图）'],
  [/按评论数 log 权重/g, '按评论数取对数加权'],
  [/\blog 权重/g, '取对数加权'],
  [/Laplace 平滑/g, '小样本平滑'],
  [/（只可写[^）]*）/g, ''],
  [/置信度/g, '数据完整度'],
];

export function plainZh(text: string | null | undefined): string {
  if (!text) return '';
  let out = text;
  for (const [re, rep] of PLAIN_ZH) out = out.replace(re, rep);
  return out;
}

/** Ring id → plain Chinese ("步行 10 分钟范围"), using the ring's own minutes when present. */
export function ringZh(m: ReportModel, id: string): string {
  const r = m.trade_area.rings.find((x) => x.id === id);
  const minutes = r?.minutes ?? (id === 'walk10' ? 10 : Number(id.replace(/\D/g, '')) || 10);
  return id === 'walk10' ? `步行 ${minutes} 分钟范围` : `开车 ${minutes} 分钟范围`;
}

export const VERDICT_ZH: Record<ReportModel['score']['verdict'], string> = { GO: '可做', CONDITIONAL_GO: '有条件可做', NO_GO: '不建议' };

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
  const verdictZh = VERDICT_ZH[m.score.verdict] ?? m.score.verdict;
  const cuisine = m.input.cuisine_label_zh;
  const condsZh = m.score.conditions.map((c) => c.text_zh).join('；') || '无';
  switch (page) {
    case 'page_1':
      return { title: `${cuisine}：${verdictZh}`, body: `综合评分 ${m.score.total} 分 [src:score.total]，数据完整度 ${m.confidence.total} 分 [src:confidence.total]。`, refs: ['score.total', 'confidence.total'] };
    case 'page_2': {
      const title = cov == null ? `${verdictZh}：需求覆盖率未获取` : cov >= 1 ? `预计需求是保本线的 ${cov.toFixed(2)} 倍，${verdictZh}` : `预计需求只够保本线的 ${fmtPct(cov)}，${verdictZh}`;
      return {
        title,
        body: `模型预计本店每月能拿到的需求（捕获需求）${fmtUsd(m.demand.captured_monthly_usd)} [src:demand.captured_monthly_usd]，保本线（每月至少要做到的营收）${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]，需求覆盖率 ${fmtPct(cov)} [src:demand.coverage_ratio]。综合评分 ${m.score.total} 分 [src:score.total]；签约前条件：${condsZh}。`,
        refs: ['demand.coverage_ratio', 'demand.captured_monthly_usd', 'finance.breakeven_monthly', 'score.total', 'score.conditions'],
      };
    }
    case 'page_3':
      return {
        title: `主商圈为${ringZh(m, pr)}，覆盖 ${fmtInt(p?.pop)} 位居民`,
        body: `主商圈（客源主要来自的范围）为${ringZh(m, pr)} [src:trade_area.primary_ring]，常住人口 ${fmtInt(p?.pop)} [src:trade_area.rings.${pi}.pop]；同菜系竞品 ${m.competitors.l1.length} 家 [src:competitors.l1]，其他中餐 ${m.competitors.l2_count} 家 [src:competitors.l2_count]，华人客流聚集点（超市、银行、学校等）${m.competitors.l4.length} 处 [src:competitors.l4]。${m.trade_area.isochrone_method === 'radius' ? '可达范围以直线半径近似 [src:trade_area.isochrone_method]。' : ''}`,
        refs: ['trade_area.primary_ring', `trade_area.rings.${pi}.pop`, 'competitors.l1', 'competitors.l2_count', 'competitors.l4'],
      };
    case 'page_4': {
      const cb = m.trade_area.county_benchmark.chinese_hh_share;
      const ratio = d10?.chinese_hh_share != null && cb ? (d10.chinese_hh_share / cb).toFixed(1) : null;
      return {
        title: d10 ? `开车 10 分钟内 ${fmtInt(d10.hh)} 户，中文家庭占 ${fmtPct(d10.chinese_hh_share)}${ratio ? `，是全县的 ${ratio} 倍` : ''}` : '商圈人口数据未获取',
        body: d10 ? `${ringZh(m, 'drive10')}内 ${fmtInt(d10.hh)} 户 [src:trade_area.rings.${d10i}.hh]，家庭收入中位 ${fmtUsd(d10.median_income)} [src:trade_area.rings.${d10i}.median_income]，在家说中文的家庭占 ${fmtPct(d10.chinese_hh_share, 1)} [src:trade_area.rings.${d10i}.chinese_hh_share]，白天上班岗位 ${fmtInt(d10.jobs)} 个 [src:trade_area.rings.${d10i}.jobs]，居民每年外出就餐支出 ${fmtUsd(d10.restaurant_spend_usd)} [src:trade_area.rings.${d10i}.restaurant_spend_usd]。` : '未获取 [src:trade_area.rings]',
        refs: [`trade_area.rings.${d10i}.hh`, `trade_area.rings.${d10i}.median_income`, `trade_area.rings.${d10i}.chinese_hh_share`],
      };
    }
    case 'page_5': {
      const seg = [...m.audience.segments].sort((a, b) => b.share - a.share)[0];
      const label: Record<string, string> = { chinese_family: '华人家庭', commuter_professional: '通勤白领', young_chinese: '年轻华人', non_chinese_explorer: '非华裔尝鲜' };
      return {
        title: `${label[seg.id]}占 ${fmtPct(seg.share)}，午市占比 ${fmtPct(m.audience.lunch_dinner_split[0])}`,
        body: `主要客群是${label[seg.id]}，占 ${fmtPct(seg.share)} [src:audience.segments.0.share]；午市 / 晚市 = ${fmtPct(m.audience.lunch_dinner_split[0])} / ${fmtPct(m.audience.lunch_dinner_split[1])} [src:audience.lunch_dinner_split]；午市客源主要靠${ringZh(m, 'walk10')}内的 ${fmtInt(m.trade_area.rings[0]?.jobs)} 个上班岗位 [src:trade_area.rings.0.jobs]。`,
        refs: ['audience.segments', 'audience.lunch_dinner_split', 'trade_area.rings.0.jobs'],
      };
    }
    case 'page_6': {
      const c = m.competitors;
      const band = c.walk10_l1_l2_count === 0 ? '冷启动区间（周边几乎没有中餐）' : c.walk10_l1_l2_count <= 3 ? '低集聚区间' : c.walk10_l1_l2_count <= 8 ? '集聚红利区间（扎堆带客流）' : c.walk10_l1_l2_count <= 15 ? '偏饱和区间' : '饱和区间';
      return {
        title: `同菜系竞品 ${c.l1.length} 家、中餐共 ${c.l1.length + c.l2_count} 家，处于${band.split('（')[0]}`,
        body: `${ringZh(m, 'walk10')}内中餐 ${c.walk10_l1_l2_count} 家 [src:competitors.walk10_l1_l2_count]，集聚分（衡量周边中餐店多少是否合适）${c.cluster_score} [src:competitors.cluster_score]，处于${band}；同菜系竞品 Google 平均评分 ${c.avg_rating_l1 ?? '未获取'} [src:competitors.avg_rating_l1]；关店率 ${fmtPct(c.closure_rate)} [src:competitors.closure_rate]。`,
        refs: ['competitors.walk10_l1_l2_count', 'competitors.cluster_score', 'competitors.avg_rating_l1', 'competitors.closure_rate'],
      };
    }
    case 'page_7': {
      const b = m.competitors.benchmark_revenue_band;
      const be = m.finance.breakeven_monthly;
      const title = b.median != null && be != null ? `同类门店中位月营收 ${fmtUsd(b.median)}，${b.median < be ? '低于' : '高于'}本址保本线` : '同类门店营收缺历史数据，只能给相对客流等级';
      return {
        title,
        body: `${b.median != null ? `同类门店月营收：低位 ${fmtUsd(b.p25)} / 中位 ${fmtUsd(b.median)} / 高位 ${fmtUsd(b.p75)} [src:competitors.benchmark_revenue_band]` : '同类门店营收区间未获取 [src:competitors.benchmark_revenue_band.method]'}；本址保本线 ${fmtUsd(be)} [src:finance.breakeven_monthly]。`,
        refs: ['competitors.benchmark_revenue_band', 'finance.breakeven_monthly'],
      };
    }
    case 'page_8': {
      const top = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
      return {
        title: top.length ? `本址更适合${top[0].label_zh}（${top[0].total} 分），${cuisine}排第 ${m.score.user_cuisine_rank} 位` : `${cuisine}排第 ${m.score.user_cuisine_rank} 位`,
        body: `${m.competitors.void.is_void ? '该品类为空白 [src:competitors.void.is_void]' : '该品类供给较少，但未满足「品类缺口」的三个条件（华裔人口、门店密度、其他中餐数量） [src:competitors.void.is_void]'}；更适合的替代菜系前三：${top.map((a) => `${a.label_zh} ${a.total} 分`).join('、')} [src:score.alternatives]；您选的${cuisine}排第 ${m.score.user_cuisine_rank} 位 [src:score.user_cuisine_rank]。`,
        refs: ['competitors.void.is_void', 'score.alternatives', 'score.user_cuisine_rank'],
      };
    }
    case 'page_9':
      return {
        title: cov == null ? '需求测算缺少输入' : `预计每月能拿到 ${fmtUsd(m.demand.captured_monthly_usd)}，是保本线的 ${fmtPct(cov)}`,
        body: `预计捕获月需求 ${fmtUsd(m.demand.captured_monthly_usd)} [src:demand.captured_monthly_usd]（午市 ${fmtUsd(m.demand.lunch_usd)} [src:demand.lunch_usd]，晚市 ${fmtUsd(m.demand.dinner_usd)} [src:demand.dinner_usd]），每天 ${fmtInt(m.demand.captured_covers_day)} 单 [src:demand.captured_covers_day]；参与分流的竞品 ${m.demand.huff.competitor_set} 家 [src:demand.huff.competitor_set]。`,
        refs: ['demand.captured_monthly_usd', 'demand.lunch_usd', 'demand.dinner_usd', 'demand.captured_covers_day', 'demand.huff.competitor_set'],
      };
    case 'page_10': {
      const s = m.finance.sensitivity.find((x) => x.breaks_breakeven);
      const base = m.finance.scenarios.find((x) => x.id === 'base');
      return {
        title: s ? `${s.label_zh}就会跌破保本线` : `基准情景月营收 ${fmtUsd(base?.monthly_revenue)}，高于保本线`,
        body: `保本线 ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]、安全线（比保本线高出一截，留出缓冲）${fmtUsd(m.finance.safety_monthly)} [src:finance.safety_monthly]；基准情景 ${base?.seats} 座 × 每天翻台 ${base?.turns_per_day} 次 = 每天 ${base?.dine_in_covers_day} 位堂食客人 [src:finance.scenarios.1]，月营收 ${fmtUsd(base?.monthly_revenue)} [src:finance.scenarios.1.monthly_revenue]。${m.finance.payback_months == null ? '未提供开办投入（装修与设备），回收期不显示 [src:finance.payback_months]。' : `回收期 ${m.finance.payback_months} 个月 [src:finance.payback_months]。`}`,
        refs: ['finance.breakeven_monthly', 'finance.safety_monthly', 'finance.scenarios.1', 'finance.payback_months'],
      };
    }
    case 'page_11': {
      const weakest = [...m.score.dimensions].sort((a, b) => a.score - b.score)[0];
      return {
        title: `${m.score.total} 分 · ${verdictZh}：${weakest.label_zh}最弱（${weakest.score} 分）`,
        body: m.score.dimensions.map((d, i) => `${d.label_zh} ${d.score} 分 × 权重 ${d.weight}% [src:score.dimensions.${i}]`).join('；') + `。签约前条件：${condsZh} [src:score.conditions]。`,
        refs: ['score.dimensions', 'score.conditions', 'score.total'],
      };
    }
    case 'page_12': {
      const high = m.risks.filter((r) => r.prob === 'high');
      return {
        title: high.length ? `${high.length} 项高概率风险：${high.map((r) => plainZh(r.risk_zh).split('，')[0]).slice(0, 2).join('；')}` : `${m.risks.length} 项风险都能靠经营手段对冲`,
        body: m.risks.slice(0, 5).map((r, i) => `${plainZh(r.risk_zh)}（概率${r.prob === 'high' ? '高' : r.prob === 'medium' ? '中' : '低'}） [src:risks.${i}]`).join('；') + '。',
        refs: m.risks.slice(0, 5).map((_, i) => `risks.${i}`),
      };
    }
    case 'page_13': {
      // Counts of conditions / missing inputs are not values in the fragment, so the
      // title names the lists instead of counting them (NumberGuard-safe).
      const parts = [m.score.conditions.length ? '签约条件' : null, m.finance.inputs_missing.length ? '缺失输入' : null].filter((x): x is string => x != null);
      return {
        title: parts.length ? `签约前必须先落实${parts.join('与')}，再谈租约` : '签约前无额外条件与缺失输入',
        body: `条件：${condsZh} [src:score.conditions]；需要补充的输入：${m.finance.inputs_missing.map(plainZh).join('、') || '无'} [src:finance.inputs_missing]。`,
        refs: ['score.conditions', 'finance.inputs_missing'],
      };
    }
    case 'page_14': {
      const degraded = m.sources.filter((s) => s.status !== 'ok').length;
      return {
        title: '每个数字都可追溯到公开数据来源',
        body: `本报告共使用 ${m.sources.length} 个数据来源 [src:sources]，数据完整度 ${m.confidence.total} 分 [src:confidence.total]${degraded ? `；其中 ${degraded} 个来源部分缺失或未获取，已在「数据说明」中逐条写明 [src:sources]` : ''}。所有「未获取」的字段都没有做估计。`,
        refs: ['sources', 'confidence.total'],
      };
    }
    case 'page_15': {
      const top = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
      const title = cov == null ? `${cuisine}：${verdictZh}` : `${cuisine}：${verdictZh}，需求覆盖率 ${fmtPct(cov)}`;
      return {
        title,
        body:
          `结论：${cuisine}在本址${verdictZh}。三个决定性数字：需求覆盖率 ${fmtPct(cov)} [src:demand.coverage_ratio]，占用成本比（租金 ÷ 预计营收）${fmtPct(m.finance.occupancy_cost_ratio)} [src:finance.occupancy_cost_ratio]，综合评分 ${m.score.total} 分 [src:score.total]。` +
          `签约前必须做的事：${condsZh} [src:score.conditions]。` +
          (top.length ? `更适合的替代菜系：${top.map((a) => `${a.label_zh} ${a.total} 分`).join('、')} [src:score.alternatives]。` : '') +
          '下一步：先落实签约前条件并补齐缺失输入，重跑报告；租金谈判以本报告给出的租金上限为目标；实地踩点午市、晚市与周末客流。',
        refs: ['demand.coverage_ratio', 'finance.occupancy_cost_ratio', 'score.total', 'score.conditions', 'score.alternatives'],
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
  // Derived counts the prose naturally cites (totals, list lengths). NumberGuard only
  // accepts numbers present in the fragment, so expose them explicitly.
  out._derived = {
    l1_count: m.competitors.l1.length,
    l1_l2_total: m.competitors.l1.length + m.competitors.l2_count,
    l4_count: m.competitors.l4.length,
    alternatives_count: m.score.alternatives.length,
    conditions_count: m.score.conditions.length,
    risks_count: m.risks.length,
    sources_total: m.sources.length,
    sources_ok: m.sources.filter((s) => s.status === 'ok').length,
    sources_degraded: m.sources.filter((s) => s.status !== 'ok').length,
    rings_count: m.trade_area.rings.length,
    // "步行 10 分钟范围" / "开车 15 分钟范围" name the ring by its minutes on every page
    ring_minutes: Object.fromEntries(m.trade_area.rings.map((r) => [r.id, r.minutes])),
    inputs_missing_count: m.finance.inputs_missing.length,
    lunch_share_pct: m.demand.lunch_usd != null && m.demand.dinner_usd != null && m.demand.lunch_usd + m.demand.dinner_usd > 0 ? Math.round((m.demand.lunch_usd / (m.demand.lunch_usd + m.demand.dinner_usd)) * 100) : null,
  };
  return out;
}
