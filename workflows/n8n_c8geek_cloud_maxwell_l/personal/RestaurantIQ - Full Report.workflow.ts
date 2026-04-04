import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : RestaurantIQ - Full Report
// Nodes   : 5  |  Connections: 4
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Webhook                            webhook
// ValidatePrompt                     code
// Openai                             httpRequest
// Parsejson                          code
// Respond                            respondToWebhook
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Webhook
//    → ValidatePrompt
//      → Openai
//        → Parsejson
//          → Respond
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: '0b4e252ef26f49c8',
    name: 'RestaurantIQ - Full Report',
    active: true,
    settings: {
        executionOrder: 'v1',
        binaryMode: 'separate',
        availableInMCP: false,
        callerPolicy: 'workflowsFromSameOwner',
    },
})
export class RestaurantiqFullReportWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: '88a10c85-7b9e-4564-ac0e-110483a9ae62',
        webhookId: 'c02166ae-1ade-4c33-867d-173a750802e9',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [260, 520],
    })
    Webhook = {
        path: 'iq-full-report',
        httpMethod: 'POST',
        responseMode: 'responseNode',
        options: {
            rawBody: false,
        },
    };

    @node({
        id: '88cd4f6e-f793-4a7b-a590-6f86fd6a6cba',
        name: 'Validate+Prompt',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [480, 520],
    })
    ValidatePrompt = {
        mode: 'runOnceForEachItem',
        language: 'javaScript',
        jsCode: `const expected = String($env.N8N_IQ_WEBHOOK_SECRET || $env.N8N_INTERNAL_AUTH_TOKEN || '').trim();
let root = $json;
try {
  root = $('Webhook').first().json;
} catch {}
const headers = root.headers || {};
const auth = String(headers.authorization || headers.Authorization || headers['x-authorization'] || '').trim();
const want = expected ? 'Bearer ' + expected : '';
if (expected && auth !== want) { throw new Error('Unauthorized'); }
const body = root.body || {};
const address = String(body.address || body.location || '').trim();
const industry = String(body.industry || body.businessType || 'restaurant').trim();
const cuisine_type = body.cuisine_type ? String(body.cuisine_type).trim() : '';
const language = String(body.language || 'en').toLowerCase() === 'zh' ? 'zh' : 'en';
const analysis_id = body.analysis_id ? String(body.analysis_id) : '';
const market_data = body.market_data || null;
const headline = String(body.headline || body.partialHeadline || '').trim();
const reason = String(body.reason || body.partialReason || '').trim();
if (!address) throw new Error('Missing address');

const system = language === 'zh'
  ? [
      '你是 LocationIQ 选址大师的高级分析引擎，兼具：结构化商业顾问（MECE、假设透明）、客流/贸易区建模视角、资深餐饮运营经验。',
      '用户为单笔约 $50k–$300k 量级的开店决策付费 $19；输出须像价值 $500+ 的迷你咨询：可执行、假设透明、结论前置。',
      '遵循 V2.0 付费版结构思想：贸易区分层、客流时段矩阵、人口与消费力、竞争清单与空白地图、三场景营收与敏感性、风险概率-影响与对冲、差异化与获客、90天作战图、可比案例、加权决策矩阵。',
      '禁止编造无法支撑的精确数字；关键假设须写明；竞争对手在可得情况下用真实店名（若仅有汇总数据须说明）。',
      '严禁「A外卖/B快餐/竞品C」等虚构代号；risks 与 opportunities 禁止内容雷同；公交与精确客流无来源须标 [待核实]。',
      '用户消息含【系统数据锚点】时须服从其中店名与美元营收锚点（±25% 须写理由）。',
      '风险须配对冲思路；行动计划须具体到人/预算/产出/完成标志，不写「做市场调研」类空话。',
      '全文中文；专有名词、地址、品牌可保留英文。',
      '严格输出 JSON，键名与前端约定一致。',
    ].join(' ')
  : [
      'You are the LocationIQ premium site-selection engine: structured consultant + trade-area analytics + restaurant operations depth.',
      'The customer paid $19 for a decision-grade mini report; deliver $500+ consulting density with transparent assumptions and lead-with-conclusion style.',
      'Follow V2.0 premium themes: layered trade area, daypart demand matrix, demographics & spending power, competitor tables & whitespace, three-scenario revenue + sensitivity, risk matrix with mitigations, differentiation & acquisition, 90-day plan, comparables, weighted decision matrix.',
      'No fabricated precision; label [estimate] when needed; use real competitor names when inferable from provided data.',
      'Never use A/B/C placeholder competitor labels; opportunities must not duplicate risks; transit/foot traffic without sources → [TBD].',
      'When [SYSTEM DATA ANCHORS] appears in user content, follow those names and USD revenue anchors (±25% ok with rationale).',
      'Risks must include mitigations; actions must be concrete (owner, budget band, deliverable, KPI), not generic "do research".',
      'Output strict JSON with the requested keys.',
    ].join(' ');

// Cuisine-specific knowledge block
const cuisineBlockZh = '\\n\\n【菜系专属分析视角】根据用户输入的 businessType，自动识别菜系类别并调整分析角度：\\n\\n■ 火锅类（火锅、串串、烤肉、烧烤等）\\n  - 典型客群：20-40岁，聚餐/社交场景为主，人均消费较高（$25-60）\\n  - 选址要点：停车便利 > 人流密度；夜间经营能力；排烟/消防合规；周边无投诉敏感住宅\\n  - 竞品识别：关注同类火锅品牌密度 + 其他聚餐业态（烧烤/农家菜/韩式烤肉）\\n  - 风险因素：夏季淡季效应（营收可降 30-40%）、原材料成本波动、油烟扰民投诉\\n  - 翻台基准：1.5-2.5 turns_per_day（晚餐为主，周末高峰可达 3）\\n\\n■ 奶茶/咖啡类（奶茶、咖啡、甜品、果汁等）\\n  - 典型客群：15-35岁，学生/白领，高频低客单（$5-12）\\n  - 选址要点：人流密度 > 停车；商圈/写字楼/学校附近优先；外卖半径重要\\n  - 竞品识别：关注 500 米内同类门店数量和品牌等级（头部品牌 vs 新品牌）\\n  - 风险因素：竞争激烈（红海市场）、品牌迭代快、季节性波动（冬季冰饮降）\\n  - 翻台基准：不适用传统翻台；关注日均杯数（200-500 杯/天为健康）\\n\\n■ 正餐类（川菜、湘菜、粤菜、日料、西餐等）\\n  - 典型客群：因菜系而异——川湘菜偏年轻/性价比；粤菜/日料偏商务/家庭\\n  - 选址要点：社区店看居民密度与收入结构；商圈店看消费力与停车\\n  - 竞品识别：同菜系直接竞争 + 同价格带跨菜系竞争\\n  - 风险因素：人工成本占比高（25-35%）、租金敏感、午市 vs 晚市结构\\n  - 翻台基准：2-3 turns_per_day（快餐化正餐可达 4）\\n\\n■ 快餐/简餐类（快餐、面馆、便当、轻食等）\\n  - 典型客群：白领/蓝领，午餐高峰为主，追求效率（$8-15）\\n  - 选址要点：写字楼/工业区/交通枢纽优先；出餐速度决定翻台\\n  - 竞品识别：价格带竞争 + 外卖渗透率（外卖占比常达 40-60%）\\n  - 风险因素：外卖平台抽成（15-30%）、人工效率要求高、客单价天花板\\n  - 翻台基准：4-8 turns_per_day（高效快餐可达 10+）\\n\\n若 businessType 不在上述类别，使用通用餐饮分析框架，并在报告中说明「未匹配特定菜系，采用通用分析」。分析时须将菜系特征融入：executive_summary、trade_area_analysis、competitors、revenue_model、risk_matrix、action_plan。';
const cuisineBlockEn = '\\n\\n[CUISINE-SPECIFIC ANALYSIS FRAMEWORK] Identify the cuisine category from businessType and adjust analysis accordingly:\\n\\n■ Hot Pot / BBQ (hotpot, Korean BBQ, yakiniku, grill)\\n  - Target: 20-40 y/o, social dining, higher spend ($25-60/person)\\n  - Site factors: Parking > foot traffic; evening hours; ventilation/fire code; noise complaints\\n  - Competitors: Same-category density + other social dining (steakhouse, Korean)\\n  - Risks: Summer slowdown (30-40% revenue drop), commodity cost swings, odor complaints\\n  - Turns benchmark: 1.5-2.5 turns_per_day (dinner focus; weekends up to 3)\\n\\n■ Bubble Tea / Coffee (boba, coffee, dessert, juice)\\n  - Target: 15-35 y/o students/office workers, high frequency, low ticket ($5-12)\\n  - Site factors: Foot traffic > parking; near malls/offices/schools; delivery radius matters\\n  - Competitors: Count stores within 500m; note brand tier (national chain vs indie)\\n  - Risks: Red ocean competition, brand churn, seasonal (winter ice drinks drop)\\n  - Turns benchmark: N/A (use daily cups: 200-500/day is healthy)\\n\\n■ Full-Service Dining (Chinese regional, Japanese, Western, etc.)\\n  - Target: Varies—Sichuan/Hunan skews younger/value; Cantonese/Japanese skews business/family\\n  - Site factors: Community stores → residential density & income; mall stores → spending power & parking\\n  - Competitors: Same-cuisine direct + same-price-tier cross-cuisine\\n  - Risks: Labor cost (25-35% of revenue), rent sensitivity, lunch vs dinner mix\\n  - Turns benchmark: 2-3 turns_per_day (fast-casual can reach 4)\\n\\n■ Fast Food / Quick Service (QSR, noodles, lunch boxes, salads)\\n  - Target: Office/blue-collar workers, lunch rush, speed-focused ($8-15)\\n  - Site factors: Office parks/industrial zones/transit hubs; ticket time drives turns\\n  - Competitors: Price-tier competition + delivery penetration (often 40-60% delivery mix)\\n  - Risks: Platform commission (15-30%), labor efficiency demands, ticket ceiling\\n  - Turns benchmark: 4-8 turns_per_day (high-efficiency QSR can exceed 10)\\n\\nIf businessType does not match above categories, use general restaurant framework and note "No specific cuisine match—using general analysis." Integrate cuisine insights into: executive_summary, trade_area_analysis, competitors, revenue_model, risk_matrix, action_plan.';
const systemWithCuisine = system + (language === 'zh' ? cuisineBlockZh : cuisineBlockEn);

function iqNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
let anchorsBlock='';
if (!market_data) {
  anchorsBlock = language === 'zh' ? '

【系统锚点】未提供 market_data：须声明无外部检索数据，禁止 A/B/C 代号店名。
' : '

[ANCHORS] No market_data; state explicitly.
';
} else if (typeof market_data === 'object') {
  const sum = market_data.summary || (market_data.external_data && market_data.external_data.summary) || null;
  if (!sum || typeof sum !== 'object') {
    anchorsBlock = language === 'zh' ? '

【系统锚点】market_data 缺少可解析的 summary：禁止 A/B/C 代号与套用固定营收区间。
' : '

[ANCHORS] market_data missing summary.
';
  } else {
    const ng = iqNum(sum.competitor_count_google);
    const ny = iqNum(sum.competitor_count_yelp);
    const n = Math.min(40, Math.max(0, Math.round(ng != null ? ng : (ny != null ? ny : 0))));
    const avgR = iqNum(sum.avg_rating_google) != null ? iqNum(sum.avg_rating_google) : (iqNum(sum.avg_rating_yelp) != null ? iqNum(sum.avg_rating_yelp) : 4);
    const avgV = iqNum(sum.avg_review_count_google) != null ? iqNum(sum.avg_review_count_google) : (iqNum(sum.avg_review_count_yelp) != null ? iqNum(sum.avg_review_count_yelp) : 200);
    const density = n * 2100 + avgR * 2800 + Math.min(avgV, 2000) * 8;
    const low = Math.round(9000 + density * 0.95);
    const mid = Math.round(low * 1.22);
    const high = Math.round(low * 1.48);
    const g = Array.isArray(sum.sample_competitors_google) ? sum.sample_competitors_google : [];
    const names = g.slice(0, 10).map(function (x) { return x && x.name ? String(x.name).trim() : ''; }).filter(Boolean);
    const y = Array.isArray(sum.sample_competitors_yelp) ? sum.sample_competitors_yelp : [];
    const ynames = y.slice(0, 10).map(function (x) { return x && x.name ? String(x.name).trim() : ''; }).filter(Boolean);
    if (language === 'zh') {
      anchorsBlock = '

【系统数据锚点——必须体现在 JSON 的叙述与结构化字段中】
' +
        '- 检索样本餐厅数 N=' + n + '。
' +
        (names.length ? ('- Google 样本店名（competitors 前 ' + Math.min(5, names.length) + ' 行须逐字使用，禁止 A/B/C）：' + names.join('、') + '
') : '- Google 无名样本，禁止虚构代号。
') +
        (ynames.length ? ('- Yelp 样本店名：' + ynames.join('、') + '
') : '- Yelp 样本为空须说明。
') +
        '- 三场景 monthly_revenue_usd 围绕约 $' + low + ' / $' + mid + ' / $' + high + '（±25%），须解释与 N 的关系。
' +
        '- opportunities 须含具体数据点，禁止与 risks 重复。
' +
        '- 公交/客流无来源标 [待核实]。
';
    } else {
      anchorsBlock = '

[SYSTEM DATA ANCHORS]
' +
        '- N=' + n + '.
' +
        (names.length ? ('- Google names (use first ' + Math.min(5, names.length) + ' verbatim): ' + names.join(', ') + '
') : '- No Google names.
') +
        (ynames.length ? ('- Yelp names: ' + ynames.join(', ') + '
') : '- No Yelp samples.
') +
        '- Revenue ~$' + low + '/$' + mid + '/$' + high + ' (±25%).
' +
        '- Opportunities: cite facts; no duplicate risks.
' +
        '- Transit/traffic: [TBD] without source.
';
    }
  }
}
let marketDataSection = '';
if (market_data) {
  marketDataSection = language === 'zh'
    ? '

【市场数据（来自 Google Places + Yelp）】' + anchorsBlock + '
' + JSON.stringify(market_data, null, 2)
    : '

MARKET DATA (from Google Places + Yelp):' + anchorsBlock + '
' + JSON.stringify(market_data, null, 2);
} else {
  marketDataSection = anchorsBlock;
}

const biz = cuisine_type ? industry + '（' + cuisine_type + '）' : industry;

const user = language === 'zh'
  ? [
      '为以下输入生成付费版「选址可行性深度分析」（LocationIQ V2.0），严格 JSON，键名如下。',
      '分析ID：' + analysis_id,
      '地址：' + address,
      '业态：' + biz,
      '免费版 headline：' + headline,
      '免费版要点/理由：' + reason,
      marketDataSection,
      '',
      '内容须体现：核心/次级/边缘贸易区与时段客流、人群与消费力、竞对表与威胁等级与空白地图、三场景营收+敏感性、风险（概率档+影响+触发+对冲）×5、机会×3、失败场景×3、差异化策略、8–12步行动计划（负责人/预算/产出/KPI）、置信度（高|中|低）+依据。',
      '营收模型口径：翻台必须写「翻台/天 turns_per_day」（或按餐段拆分），严禁「每月平均翻台X次」；租金+10% 属于成本敏感性，必须写对利润/现金流影响，不得写成影响营收；翻台-0.5 必须明确为 turns_per_day-0.5 并给出按公式推导的影响区间。',
      '',
      '禁止编造无法验证的精确数字；用[估算]标注假设。',
      '',
      '【JSON深度结构】必须返回单一JSON对象，包含并填充：report_title；dashboard{overall_score,foot_traffic_index,competition_intensity,payback_months,recommendation}；executive_summary；final_verdict；trade_area_analysis；demographic_profile；competition_landscape；revenue_estimate；competitors数组至少5项每项{name,distance_mi,category,rating,review_count,price_tier,threat_level,analysis}；risk_matrix恰好5项{risk,probability,financial_impact,trigger,mitigation}；revenue_model{methodology,scenarios三条,sensitivity,breakeven,monthly_costs_note}；risks字符串数组5条；opportunities3条；failure_scenarios3条；differentiation_strategy；acquisition_channels至少4项；action_plan；action_plan_structured 8-12项{task,owner,budget_band,deliverable,success_metric,timeframe}；comparables{success_cases,failure_cases}；decision_matrix 5行{dimension,score_100,weight_pct,weighted_score}；confidence仅填高或中或低；confidence_rationale；data_sources_and_disclaimer。优先引用market_data真名；无数据标[估算]。禁止省略上述键。',
    ].filter(Boolean).join('\\n')
  : [
      'Generate the PAID LocationIQ V2.0 deep-dive as STRICT JSON with these exact keys.',
      'analysis_id: ' + analysis_id,
      'ADDRESS: ' + address,
      'BUSINESS TYPE: ' + biz,
      'FREE TIER HEADLINE: ' + headline,
      'FREE TIER NOTES: ' + reason,
      marketDataSection,
      '',
      'Cover: layered trade areas + daypart traffic, demographics & spending power, competitor matrix + threat levels + whitespace, three-scenario revenue + sensitivity, five risks (probability, impact, trigger, mitigation), three opportunities, three failure scenarios, differentiation, 8–12 action steps (owner/budget/deliverable/KPI), confidence High|Medium|Low with rationale.',
      'Revenue model units: turns must be turns_per_day (or daypart split); never "turns per month". Rent +10% is a cost lever → impact profit/cashflow, not revenue. Turns -0.5 means turns_per_day - 0.5 with formula-based impact.',
      '',
      'Use [estimate] labels; no fabricated precision.',
      '',
      'Return ONE JSON object with ALL keys (arrays must exist, use [] if needed): report_title, dashboard{overall_score,foot_traffic_index,competition_intensity,payback_months,recommendation}, executive_summary, final_verdict, trade_area_analysis, demographic_profile, competition_landscape, revenue_estimate, competitors (>=5 objects with name,distance_mi,category,rating,review_count,price_tier,threat_level,analysis), risk_matrix (exactly 5 objects with risk,probability,financial_impact,trigger,mitigation), revenue_model{methodology,scenarios[3],sensitivity,breakeven,monthly_costs_note}, risks[5], opportunities[3], failure_scenarios[3], differentiation_strategy, acquisition_channels (>=4), action_plan, action_plan_structured (8-12 objects), comparables{success_cases,failure_cases}, decision_matrix (5 rows), confidence (High|Medium|Low only), confidence_rationale, data_sources_and_disclaimer. Prefer real competitor names from market_data.',
    ].filter(Boolean).join('\\n');

return [{ json: { system: systemWithCuisine, user } }];`,
    };

    @node({
        id: '796b64f6-d145-48ef-ad54-1ff58295e9b5',
        name: 'OpenAI',
        type: 'n8n-nodes-base.httpRequest',
        version: 4,
        position: [720, 520],
    })
    Openai = {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Authorization',
                    value: '=Bearer {{$env.OPENAI_API_KEY}}',
                },
                {
                    name: 'Content-Type',
                    value: 'application/json',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: $env.OPENAI_IQ_FULL_MODEL || 'gpt-4o', temperature: 0.4, max_completion_tokens: 16000, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: $json.system }, { role: 'user', content: $json.user } ] } }}",
    };

    @node({
        id: 'd1aceed9-8f8a-4d58-b419-fb02cfa05856',
        name: 'ParseJSON',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [960, 520],
    })
    Parsejson = {
        mode: 'runOnceForEachItem',
        language: 'javaScript',
        jsCode: `const raw = $json;
const choice = raw.choices && raw.choices[0];
const content = choice && choice.message && choice.message.content ? String(choice.message.content) : '';
let parsed; try { parsed = JSON.parse(content); } catch { throw new Error('Model did not return valid JSON'); }
return [{ json: parsed }];`,
    };

    @node({
        id: '7f105f2e-e389-441f-8022-08c6bcca1fc9',
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1,
        position: [1200, 520],
    })
    Respond = {
        responseBody: '={{$json}}',
        options: {
            responseCode: 200,
        },
        respondWith: 'json',
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.ValidatePrompt.in(0));
        this.ValidatePrompt.out(0).to(this.Openai.in(0));
        this.Openai.out(0).to(this.Parsejson.in(0));
        this.Parsejson.out(0).to(this.Respond.in(0));
    }
}
