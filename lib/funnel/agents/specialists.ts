/**
 * Specialist analyst agents — each mirrors one role on a professional site-selection
 * engagement team and receives only its discipline's data slice plus the shared
 * deterministic metrics. All scores are 0–100 where higher = better for the operator.
 *
 * Dimension ownership (V2.0 weights used later by synthesis):
 * - market analyst      → demographic_fit (20%)
 * - competition analyst → competitive_position (20%)
 * - site analyst        → foot_traffic (25%) + accessibility (20%)
 * - financial analyst   → rent_value (15%)
 * - risk analyst        → no weight; produces the risk matrix + failure scenarios
 */

import { z } from 'zod';
import type { Lang, SiteMetrics, SpecialistFinding } from './types';
import { formatMetricsDigest } from './metrics';
import { completeJson } from './llm';

const findingSchema = z.object({
  score_100: z.number().min(0).max(100),
  score_rationale: z.string(),
  narrative: z.string(),
  key_findings: z.array(z.string()).min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type SpecialistInput = {
  location: string;
  businessType: string;
  language: Lang;
  metrics: SiteMetrics;
  marketData: Record<string, unknown>;
};

/** Shared grounding rules injected into every specialist system prompt. */
function groundingRules(lang: Lang): string {
  return lang === 'zh'
    ? [
        '数据纪律（必须遵守）：',
        '1. 【计算指标】块中的数字来自公式计算，必须原样引用，禁止改写或"取整成更好看的数"。',
        '2. 除计算指标与原始数据中出现的数字外，禁止编造精确数值；推断值必须标注[估算]并给出一步推导。',
        '3. 每条判断遵循：事实或[估算] → 对开店决策的影响 → 可执行建议。',
        '4. 数据缺口须明说，不许用套话掩盖（禁止"人流较大"这类无半径、无时段、无数字的表述）。',
        '5. 输出严格 JSON（无 Markdown 代码块包裹），字段见用户消息。narrative 内部允许 Markdown 表格。',
      ].join('\n')
    : [
        'DATA DISCIPLINE (mandatory):',
        '1. Numbers in the [COMPUTED METRICS] block are formula-derived — quote them verbatim; never round them into "nicer" numbers.',
        '2. Do not invent precise figures beyond computed metrics and raw data; inferred values must be tagged [estimate] with one-step reasoning.',
        '3. Every claim follows: fact or [estimate] → impact on the opening decision → one actionable suggestion.',
        '4. State data gaps explicitly; never paper over them with vague phrases ("high foot traffic" without radius/daypart/number is banned).',
        '5. Output strict JSON (no markdown fences); fields are specified in the user message. Markdown tables ARE allowed inside narrative strings.',
      ].join('\n');
}

function outputSpec(lang: Lang, payloadHint: string): string {
  return lang === 'zh'
    ? [
        '输出 JSON 字段：',
        '{',
        '  "score_100": 0-100 数值（越高对经营者越有利）,',
        '  "score_rationale": "评分依据，引用具体数字",',
        '  "narrative": "该章节完整分析正文（Markdown，含至少一个表格）",',
        '  "key_findings": ["3-6 条硬结论，综合撰写人不得丢弃"],',
        `  "payload": ${payloadHint},`,
        '  "confidence": "high|medium|low（依据数据覆盖度）"',
        '}',
      ].join('\n')
    : [
        'Output JSON fields:',
        '{',
        '  "score_100": number 0-100 (higher = better for the operator),',
        '  "score_rationale": "scoring basis, citing specific numbers",',
        '  "narrative": "full section body (Markdown, include at least one table)",',
        '  "key_findings": ["3-6 hard conclusions the synthesis writer must not drop"],',
        `  "payload": ${payloadHint},`,
        '  "confidence": "high|medium|low (based on data coverage)"',
        '}',
      ].join('\n');
}

type SpecialistDef = {
  discipline: SpecialistFinding['discipline'];
  system: (lang: Lang) => string;
  user: (input: SpecialistInput) => string;
};

function jsonSlice(obj: unknown, maxChars = 6_000): string {
  try {
    const s = JSON.stringify(obj ?? null, null, 1);
    return s.length > maxChars ? s.slice(0, maxChars) + '…(truncated)' : s;
  } catch {
    return 'null';
  }
}

const marketAnalyst: SpecialistDef = {
  discipline: 'market',
  system: (lang) =>
    (lang === 'zh'
      ? '你是选址咨询团队的市场与人口分析师（15年经验）。职责：贸易区定义、人口与消费力画像、需求池测算、日间人口 vs 居住人口的时段结构。方法论：主贸易区=50-80%客源（车程5-10分钟），次级=15-30%；午市业态看日间上班人口，晚市业态看居住人口×收入。'
      : 'You are the market & demographics analyst on a site-selection engagement team (15 yrs experience). Scope: trade-area definition, demographic & spending-power profile, demand-pool sizing, daytime vs residential population by daypart. Methodology: primary trade area = 50–80% of customers (5–10 min drive); secondary = 15–30%; lunch concepts key on daytime workers, dinner concepts on rooftops × income.') +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      i.language === 'zh' ? `地址：${i.location}` : `Address: ${i.location}`,
      i.language === 'zh' ? `业态：${i.businessType}` : `Concept: ${i.businessType}`,
      i.language === 'zh'
        ? `业态贸易区基准：半径约 ${i.metrics.cuisine.tradeAreaRadiusMi} 英里。${i.metrics.cuisine.notes_zh}`
        : `Format trade-area benchmark: ~${i.metrics.cuisine.tradeAreaRadiusMi} mi radius. ${i.metrics.cuisine.notes_en}`,
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      i.language === 'zh' ? '【ACS 人口普查数据】' : '[ACS CENSUS DATA]',
      jsonSlice(i.marketData.acs_context),
      '',
      i.language === 'zh' ? '【联网检索摘要】' : '[WEB RESEARCH DIGEST]',
      jsonSlice(i.marketData.web_research, 3_000),
      '',
      i.language === 'zh'
        ? '产出「贸易区与需求分析」章节。narrative 必须含 ≥5 行贸易区表格（范围/时段/需求依据/证据标签[ACS][Places][估算]）。评分维度=人群匹配度：该区域人口结构、收入、消费力与本业态目标客群的匹配程度。'
        : 'Produce the "Trade Area & Demand" section. narrative MUST include a ≥5-row trade-area table (range / daypart / demand basis / evidence tag [ACS][Places][estimate]). Score dimension = demographic fit: how well area population, income, and spending power match this concept\'s target customer.',
      '',
      outputSpec(
        i.language,
        '{"trade_area_rows": [...], "daypart_mix": {...}}',
      ),
    ].join('\n'),
};

const competitionAnalyst: SpecialistDef = {
  discipline: 'competition',
  system: (lang) =>
    (lang === 'zh'
      ? '你是竞争情报分析师。职责：竞对盘点（直接=同菜系同价位同时段；间接=同场景异业态）、威胁分级、定位缺口（价格×体验矩阵中的空白）、市场空白分析（void analysis）、饱和度判断。'
      : 'You are the competitive-intelligence analyst. Scope: competitor inventory (direct = same cuisine/price/daypart; indirect = same occasion), threat tiers, positioning-gap analysis (white space on the price × experience matrix), void analysis, saturation assessment.') +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      i.language === 'zh' ? `地址：${i.location}` : `Address: ${i.location}`,
      i.language === 'zh' ? `业态：${i.businessType}` : `Concept: ${i.businessType}`,
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      i.language === 'zh' ? '【竞对样本（Google Places，按吸引力=评分×ln(1+评论数)排序）】' : '[COMPETITOR SAMPLE (Google Places, sorted by attractiveness = rating × ln(1+reviews))]',
      jsonSlice(i.metrics.competition.top_competitors),
      '',
      i.language === 'zh' ? '【价格带分布】' : '[PRICE TIER DISTRIBUTION]',
      jsonSlice(i.metrics.competition.price_tier_distribution),
      '',
      i.language === 'zh' ? '【联网检索摘要】' : '[WEB RESEARCH DIGEST]',
      jsonSlice(i.marketData.web_research, 3_000),
      '',
      i.language === 'zh'
        ? 'payload.competitors 必须输出结构化竞对行：{name, category, rating, review_count, price_tier, threat_level(高/中/低), analysis}，用真实店名；threat_level 依据：同菜系>同价位>同场景，吸引力分越高威胁越大。narrative 含定位缺口结论：哪个价格带×体验组合是空白。评分维度=竞争位势：饱和指数低、存在明确定位缺口→高分；红海且头部强势→低分。'
        : 'payload.competitors MUST be structured rows: {name, category, rating, review_count, price_tier, threat_level(High/Med/Low), analysis} using real names; threat ranking: same-cuisine > same-price > same-occasion, higher attractiveness = higher threat. narrative must state the positioning gap: which price × experience cell is white space. Score dimension = competitive position: low saturation + clear gap → high; red ocean with dominant incumbents → low.',
      '',
      outputSpec(i.language, '{"competitors": [...], "positioning_gap": "..."}'),
    ].join('\n'),
};

const siteAnalyst: SpecialistDef = {
  discipline: 'site',
  system: (lang) =>
    (lang === 'zh'
      ? '你是不动产与现场评估分析师。职责：车流量解读（AADT 高≠好：高速过境流停不下来，慢速信号灯走廊+回家侧更有价值）、可视性与进出动线、停车配比（全服务约10车位/1000平方英尺）、联动业态（co-tenancy：超市锚店利好快餐、健身/医疗利好轻食）、分区与证照风险。'
      : 'You are the real-estate & site analyst. Scope: traffic-count interpretation (high AADT ≠ good: freeway pass-through can\'t stop; slower signalized corridors + going-home side win), visibility & ingress/egress, parking ratios (~10 spaces/1,000 sqft full-service), co-tenancy effects (grocery anchors help QSR; gym/medical help healthy concepts), zoning & licensing risk.') +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      i.language === 'zh' ? `地址：${i.location}` : `Address: ${i.location}`,
      i.language === 'zh' ? `业态：${i.businessType}（${i.metrics.cuisine.category}）` : `Concept: ${i.businessType} (${i.metrics.cuisine.category})`,
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      i.language === 'zh' ? '【地理编码】' : '[GEOCODE]',
      jsonSlice(i.marketData.geocode, 1_000),
      '',
      i.language === 'zh' ? '【车流数据（Caltrans AADT）】' : '[TRAFFIC (Caltrans AADT)]',
      jsonSlice(i.metrics.traffic),
      '',
      i.language === 'zh' ? '【商业地产挂牌】' : '[COMMERCIAL LISTINGS]',
      jsonSlice(i.marketData.commercial_listings, 3_000),
      '',
      i.language === 'zh' ? '【联网检索摘要】' : '[WEB RESEARCH DIGEST]',
      jsonSlice(i.marketData.web_research, 2_000),
      '',
      i.language === 'zh'
        ? '产出「场址与可达性评估」章节。无实地数据处必须给出「实地尽调清单」（蹲点计数时段、进出动线检查项、停车高峰观察）。payload 输出两个分数：foot_traffic_score_100（客流潜力，权重最高）与 accessibility_score_100（可达性：停车/动线/公交）。score_100 填 foot_traffic_score_100。'
        : 'Produce the "Site & Access Assessment" section. Where field data is missing, provide a field due-diligence checklist (count times/dayparts, ingress-egress checks, peak parking observation). payload MUST contain two scores: foot_traffic_score_100 (traffic potential, highest weight) and accessibility_score_100 (parking/circulation/transit). Set score_100 = foot_traffic_score_100.',
      '',
      outputSpec(
        i.language,
        '{"foot_traffic_score_100": n, "accessibility_score_100": n, "due_diligence_checklist": [...]}',
      ),
    ].join('\n'),
};

const financialAnalyst: SpecialistDef = {
  discipline: 'financial',
  system: (lang) =>
    (lang === 'zh'
      ? '你是餐饮财务模型分析师。基准：租金占营收 6-10%（>10% 红旗）；Prime Cost（食材+人工）：快餐55-60%、休闲正餐60-65%、高端≤68%；净利率5-10%为健康。三场景法：悲观=营收-20%且成本+5%（必须仍能存活）、基准、乐观=营收+15%。爬坡：首月40-50%目标、次月60-70%、第3-6月达稳态。营收三角验证：自下而上（座位×翻台×客单）、公平份额模型（需求池÷贸易区餐厅数×吸引力乘数）、可比店类推——报告区间而非单点。'
      : 'You are the restaurant financial modeler. Benchmarks: occupancy 6–10% of sales (>10% red flag); prime cost (COGS+labor): QSR 55–60%, casual FSR 60–65%, fine ≤68%; net margin 5–10% healthy. Three-scenario method: pessimistic = revenue −20% & costs +5% (must still survive), base, optimistic = +15%. Ramp: month 1 at 40–50% of target, month 2 at 60–70%, steady by months 3–6. Triangulate revenue: bottom-up (seats × turns × ticket), fair-share model (pool ÷ trade-area restaurant count × attractiveness multiplier), analog comparables — report the spread, not one number.') +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      i.language === 'zh' ? `地址：${i.location}` : `Address: ${i.location}`,
      i.language === 'zh' ? `业态：${i.businessType}` : `Concept: ${i.businessType}`,
      i.language === 'zh'
        ? `业态基准：客单 $${i.metrics.cuisine.avgTicketUsd[0]}-${i.metrics.cuisine.avgTicketUsd[1]}；${i.metrics.cuisine.turnsPerDay ? `翻台 ${i.metrics.cuisine.turnsPerDay[0]}-${i.metrics.cuisine.turnsPerDay[1]} 次/天` : '按日均杯数200-500计'}；座位 ${i.metrics.cuisine.typicalSeats[0]}-${i.metrics.cuisine.typicalSeats[1]}`
        : `Format benchmarks: ticket $${i.metrics.cuisine.avgTicketUsd[0]}-${i.metrics.cuisine.avgTicketUsd[1]}; ${i.metrics.cuisine.turnsPerDay ? `${i.metrics.cuisine.turnsPerDay[0]}-${i.metrics.cuisine.turnsPerDay[1]} turns/day` : 'cup-count model 200-500/day'}; seats ${i.metrics.cuisine.typicalSeats[0]}-${i.metrics.cuisine.typicalSeats[1]}`,
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      i.language === 'zh' ? '【经济指标明细】' : '[ECONOMICS DETAIL]',
      jsonSlice({ economics: i.metrics.economics, market_share: i.metrics.market_share, demand: i.metrics.demand }),
      '',
      i.language === 'zh'
        ? 'payload.scenarios 输出恰好3个场景：{name, monthly_revenue_usd(数值), key_assumptions(含爬坡说明)}——基准场景须与公平份额隐含营收和自下而上区间交叉校验（若两者矛盾须解释取舍）；悲观=基准×0.8且成本+5%，乐观=基准×1.15。payload.breakeven 给出月营收盈亏平衡点与日均单数。narrative 含月度成本结构表（租金按计算指标、人工、食材、其他）与敏感性分析（客单-10%、翻台-0.5的影响）。评分维度=租金性价比。'
        : 'payload.scenarios MUST have exactly 3: {name, monthly_revenue_usd(number), key_assumptions(incl. ramp note)} — base scenario must cross-check fair-share implied revenue vs bottom-up band (explain any conflict); pessimistic = base×0.8 with costs +5%, optimistic = base×1.15. payload.breakeven gives monthly break-even revenue and covers/day. narrative includes a monthly cost-structure table (rent from computed metrics, labor, COGS, other) and sensitivity (ticket −10%, turns −0.5). Score dimension = rent value.',
      '',
      outputSpec(i.language, '{"scenarios": [...], "breakeven": "...", "sensitivity": [...]}'),
    ].join('\n'),
};

const riskAnalyst: SpecialistDef = {
  discipline: 'risk',
  system: (lang) =>
    (lang === 'zh'
      ? '你是风控官。职责：风险概率×影响矩阵、触发信号、对冲手段、失败场景推演。风险须与利润结构挂钩（租金失控、人工挤压、淡旺季、价格战、平台抽成、证照延误、施工超期、菜系特有风险），每条给出可监测的触发指标与量化影响区间。'
      : 'You are the risk officer. Scope: probability × impact matrix, trigger signals, mitigations, failure-scenario simulation. Tie every risk to the P&L (rent escalation, labor squeeze, seasonality, price wars, platform commissions, licensing delays, buildout overruns, cuisine-specific risks); each row needs a monitorable trigger and a quantified impact band.') +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      i.language === 'zh' ? `地址：${i.location}` : `Address: ${i.location}`,
      i.language === 'zh' ? `业态：${i.businessType}` : `Concept: ${i.businessType}`,
      i.language === 'zh' ? `菜系风险提示：${i.metrics.cuisine.notes_zh}` : `Format risk notes: ${i.metrics.cuisine.notes_en}`,
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      i.language === 'zh' ? '【竞对头部（威胁参照）】' : '[TOP COMPETITORS (threat reference)]',
      jsonSlice(i.metrics.competition.top_competitors.slice(0, 5), 2_000),
      '',
      i.language === 'zh'
        ? 'payload.risk_matrix 输出 5-8 行：{risk, probability(高/中/低+百分比区间), financial_impact(美元区间或营收百分比), trigger(可监测信号), mitigation(具体动作+成本量级)}。payload.failure_scenarios 输出 2-3 条「这家店怎么死」的具体推演链。score_100 表示风险可控度（越高越可控），不参与加权评分。'
        : 'payload.risk_matrix MUST have 5-8 rows: {risk, probability(H/M/L + % band), financial_impact($ band or % of revenue), trigger(monitorable signal), mitigation(concrete action + cost order)}. payload.failure_scenarios: 2-3 concrete "how this store dies" causal chains. score_100 = risk controllability (higher = more controllable); it is excluded from the weighted composite.',
      '',
      outputSpec(i.language, '{"risk_matrix": [...], "failure_scenarios": [...]}'),
    ].join('\n'),
};

export const SPECIALISTS: SpecialistDef[] = [
  marketAnalyst,
  competitionAnalyst,
  siteAnalyst,
  financialAnalyst,
  riskAnalyst,
];

export async function runSpecialist(
  def: SpecialistDef,
  input: SpecialistInput,
): Promise<SpecialistFinding> {
  const raw = await completeJson({
    system: def.system(input.language),
    user: def.user(input),
    tier: 'agent',
  });
  const parsed = findingSchema.parse(raw);
  return { discipline: def.discipline, ...parsed };
}
