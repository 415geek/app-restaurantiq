import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : RestaurantIQ - Full Report
// Nodes   : 5  |  Connections: 4
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Webhook                            webhook
// Validateprompt                     code
// Openai                             httpRequest
// Parsejson                          code
// Respond                            respondToWebhook
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Webhook
//    → Validateprompt
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
        name: 'Validate+Prompt',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [480, 520],
    })
    Validateprompt = {
        mode: 'runOnceForEachItem',
        language: 'javaScript',
        jsCode: "const expected = String($env.N8N_IQ_WEBHOOK_SECRET || $env.N8N_INTERNAL_AUTH_TOKEN || '').trim();\nlet root = $json;\ntry {\n  root = $('Webhook').first().json;\n} catch {}\nconst headers = root.headers || {};\nconst auth = String(headers.authorization || headers.Authorization || headers['x-authorization'] || '').trim();\nconst want = expected ? 'Bearer ' + expected : '';\nif (expected && auth !== want) { throw new Error('Unauthorized'); }\nconst body = root.body || {};\nconst address = String(body.address || body.location || '').trim();\nconst industry = String(body.industry || body.businessType || 'restaurant').trim();\nconst cuisine_type = body.cuisine_type ? String(body.cuisine_type).trim() : '';\nconst language = String(body.language || 'en').toLowerCase() === 'zh' ? 'zh' : 'en';\nconst analysis_id = body.analysis_id ? String(body.analysis_id) : '';\nconst market_data = body.market_data || null;\nconst headline = String(body.headline || body.partialHeadline || '').trim();\nconst reason = String(body.reason || body.partialReason || '').trim();\nif (!address) throw new Error('Missing address');\n\nconst system = language === 'zh'\n  ? [\n      '你是 LocationIQ 选址大师的高级分析引擎，兼具：结构化商业顾问（MECE、假设透明）、客流/贸易区建模视角、资深餐饮运营经验。',\n      '用户为单笔约 $50k–$300k 量级的开店决策付费 $19；输出须像价值 $500+ 的迷你咨询：可执行、假设透明、结论前置。',\n      '遵循 V2.0 付费版结构思想：贸易区分层、客流时段矩阵、人口与消费力、竞争清单与空白地图、三场景营收与敏感性、风险概率-影响与对冲、差异化与获客、90天作战图、可比案例、加权决策矩阵。',\n      '禁止编造无法支撑的精确数字；关键假设须写明；竞争对手在可得情况下用真实店名（若仅有汇总数据须说明）。',\n      '严禁「A外卖/B快餐/竞品C」等虚构代号；risks 与 opportunities 禁止内容雷同；公交与精确客流无来源须标 [待核实]。',\n      '用户消息含【系统数据锚点】时须服从其中店名与美元营收锚点（±25% 须写理由）。',\n      '风险须配对冲思路；行动计划须具体到人/预算/产出/完成标志，不写「做市场调研」类空话。',\n      '全文中文；专有名词、地址、品牌可保留英文。',\n      '严格输出 JSON，键名与前端约定一致。',\n    ].join(' ')\n  : [\n      'You are the LocationIQ premium site-selection engine: structured consultant + trade-area analytics + restaurant operations depth.',\n      'The customer paid $19 for a decision-grade mini report; deliver $500+ consulting density with transparent assumptions and lead-with-conclusion style.',\n      'Follow V2.0 premium themes: layered trade area, daypart demand matrix, demographics & spending power, competitor tables & whitespace, three-scenario revenue + sensitivity, risk matrix with mitigations, differentiation & acquisition, 90-day plan, comparables, weighted decision matrix.',\n      'No fabricated precision; label [estimate] when needed; use real competitor names when inferable from provided data.',\n      'Never use A/B/C placeholder competitor labels; opportunities must not duplicate risks; transit/foot traffic without sources → [TBD].',\n      'When [SYSTEM DATA ANCHORS] appears in user content, follow those names and USD revenue anchors (±25% ok with rationale).',\n      'Risks must include mitigations; actions must be concrete (owner, budget band, deliverable, KPI), not generic \"do research\".',\n      'Output strict JSON with the requested keys.',\n    ].join(' ');\n\nfunction iqNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }\nlet anchorsBlock='';\nif (!market_data) {\n  anchorsBlock = language === 'zh' ? '\n\n【系统锚点】未提供 market_data：须声明无外部检索数据，禁止 A/B/C 代号店名。\n' : '\n\n[ANCHORS] No market_data; state explicitly.\n';\n} else if (typeof market_data === 'object') {\n  const sum = market_data.summary || (market_data.external_data && market_data.external_data.summary) || null;\n  if (!sum || typeof sum !== 'object') {\n    anchorsBlock = language === 'zh' ? '\n\n【系统锚点】market_data 缺少可解析的 summary：禁止 A/B/C 代号与套用固定营收区间。\n' : '\n\n[ANCHORS] market_data missing summary.\n';\n  } else {\n    const ng = iqNum(sum.competitor_count_google);\n    const ny = iqNum(sum.competitor_count_yelp);\n    const n = Math.min(40, Math.max(0, Math.round(ng != null ? ng : (ny != null ? ny : 0))));\n    const avgR = iqNum(sum.avg_rating_google) != null ? iqNum(sum.avg_rating_google) : (iqNum(sum.avg_rating_yelp) != null ? iqNum(sum.avg_rating_yelp) : 4);\n    const avgV = iqNum(sum.avg_review_count_google) != null ? iqNum(sum.avg_review_count_google) : (iqNum(sum.avg_review_count_yelp) != null ? iqNum(sum.avg_review_count_yelp) : 200);\n    const density = n * 2100 + avgR * 2800 + Math.min(avgV, 2000) * 8;\n    const low = Math.round(9000 + density * 0.95);\n    const mid = Math.round(low * 1.22);\n    const high = Math.round(low * 1.48);\n    const g = Array.isArray(sum.sample_competitors_google) ? sum.sample_competitors_google : [];\n    const names = g.slice(0, 10).map(function (x) { return x && x.name ? String(x.name).trim() : ''; }).filter(Boolean);\n    const y = Array.isArray(sum.sample_competitors_yelp) ? sum.sample_competitors_yelp : [];\n    const ynames = y.slice(0, 10).map(function (x) { return x && x.name ? String(x.name).trim() : ''; }).filter(Boolean);\n    if (language === 'zh') {\n      anchorsBlock = '\n\n【系统数据锚点——必须体现在 JSON 的叙述与结构化字段中】\n' +\n        '- 检索样本餐厅数 N=' + n + '。\n' +\n        (names.length ? ('- Google 样本店名（competitors 前 ' + Math.min(5, names.length) + ' 行须逐字使用，禁止 A/B/C）：' + names.join('、') + '\n') : '- Google 无名样本，禁止虚构代号。\n') +\n        (ynames.length ? ('- Yelp 样本店名：' + ynames.join('、') + '\n') : '- Yelp 样本为空须说明。\n') +\n        '- 三场景 monthly_revenue_usd 围绕约 $' + low + ' / $' + mid + ' / $' + high + '（±25%），须解释与 N 的关系。\n' +\n        '- opportunities 须含具体数据点，禁止与 risks 重复。\n' +\n        '- 公交/客流无来源标 [待核实]。\n';\n    } else {\n      anchorsBlock = '\n\n[SYSTEM DATA ANCHORS]\n' +\n        '- N=' + n + '.\n' +\n        (names.length ? ('- Google names (use first ' + Math.min(5, names.length) + ' verbatim): ' + names.join(', ') + '\n') : '- No Google names.\n') +\n        (ynames.length ? ('- Yelp names: ' + ynames.join(', ') + '\n') : '- No Yelp samples.\n') +\n        '- Revenue ~$' + low + '/$' + mid + '/$' + high + ' (±25%).\n' +\n        '- Opportunities: cite facts; no duplicate risks.\n' +\n        '- Transit/traffic: [TBD] without source.\n';\n    }\n  }\n}\nlet marketDataSection = '';\nif (market_data) {\n  marketDataSection = language === 'zh'\n    ? '\n\n【市场数据（来自 Google Places + Yelp）】' + anchorsBlock + '\n' + JSON.stringify(market_data, null, 2)\n    : '\n\nMARKET DATA (from Google Places + Yelp):' + anchorsBlock + '\n' + JSON.stringify(market_data, null, 2);\n} else {\n  marketDataSection = anchorsBlock;\n}\n\nconst biz = cuisine_type ? industry + '（' + cuisine_type + '）' : industry;\n\nconst user = language === 'zh'\n  ? [\n      '为以下输入生成付费版「选址可行性深度分析」（LocationIQ V2.0），严格 JSON，键名如下。',\n      '分析ID：' + analysis_id,\n      '地址：' + address,\n      '业态：' + biz,\n      '免费版 headline：' + headline,\n      '免费版要点/理由：' + reason,\n      marketDataSection,\n      '',\n      '内容须体现：核心/次级/边缘贸易区与时段客流、人群与消费力、竞对表与威胁等级与空白地图、三场景营收+敏感性、风险（概率档+影响+触发+对冲）×5、机会×3、失败场景×3、差异化策略、8–12步行动计划（负责人/预算/产出/KPI）、置信度（高|中|低）+依据。',\n      '',\n      '禁止编造无法验证的精确数字；用[估算]标注假设。',\n      '',\n      '【JSON深度结构】必须返回单一JSON对象，包含并填充：report_title；dashboard{overall_score,foot_traffic_index,competition_intensity,payback_months,recommendation}；executive_summary；final_verdict；trade_area_analysis；demographic_profile；competition_landscape；revenue_estimate；competitors数组至少5项每项{name,distance_mi,category,rating,review_count,price_tier,threat_level,analysis}；risk_matrix恰好5项{risk,probability,financial_impact,trigger,mitigation}；revenue_model{methodology,scenarios三条,sensitivity,breakeven,monthly_costs_note}；risks字符串数组5条；opportunities3条；failure_scenarios3条；differentiation_strategy；acquisition_channels至少4项；action_plan；action_plan_structured 8-12项{task,owner,budget_band,deliverable,success_metric,timeframe}；comparables{success_cases,failure_cases}；decision_matrix 5行{dimension,score_100,weight_pct,weighted_score}；confidence仅填高或中或低；confidence_rationale；data_sources_and_disclaimer。优先引用market_data真名；无数据标[估算]。禁止省略上述键。',\n    ].filter(Boolean).join('\\n')\n  : [\n      'Generate the PAID LocationIQ V2.0 deep-dive as STRICT JSON with these exact keys.',\n      'analysis_id: ' + analysis_id,\n      'ADDRESS: ' + address,\n      'BUSINESS TYPE: ' + biz,\n      'FREE TIER HEADLINE: ' + headline,\n      'FREE TIER NOTES: ' + reason,\n      marketDataSection,\n      '',\n      'Cover: layered trade areas + daypart traffic, demographics & spending power, competitor matrix + threat levels + whitespace, three-scenario revenue + sensitivity, five risks (probability, impact, trigger, mitigation), three opportunities, three failure scenarios, differentiation, 8–12 action steps (owner/budget/deliverable/KPI), confidence High|Medium|Low with rationale.',\n      '',\n      'Use [estimate] labels; no fabricated precision.',\n      '',\n      'Return ONE JSON object with ALL keys (arrays must exist, use [] if needed): report_title, dashboard{overall_score,foot_traffic_index,competition_intensity,payback_months,recommendation}, executive_summary, final_verdict, trade_area_analysis, demographic_profile, competition_landscape, revenue_estimate, competitors (>=5 objects with name,distance_mi,category,rating,review_count,price_tier,threat_level,analysis), risk_matrix (exactly 5 objects with risk,probability,financial_impact,trigger,mitigation), revenue_model{methodology,scenarios[3],sensitivity,breakeven,monthly_costs_note}, risks[5], opportunities[3], failure_scenarios[3], differentiation_strategy, acquisition_channels (>=4), action_plan, action_plan_structured (8-12 objects), comparables{success_cases,failure_cases}, decision_matrix (5 rows), confidence (High|Medium|Low only), confidence_rationale, data_sources_and_disclaimer. Prefer real competitor names from market_data.',\n    ].filter(Boolean).join('\\n');\n\nreturn [{ json: { system, user } }];",
    };

    @node({
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
        name: 'ParseJSON',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [960, 520],
    })
    Parsejson = {
        mode: 'runOnceForEachItem',
        language: 'javaScript',
        jsCode: "const raw = $json;\nconst choice = raw.choices && raw.choices[0];\nconst content = choice && choice.message && choice.message.content ? String(choice.message.content) : '';\nlet parsed; try { parsed = JSON.parse(content); } catch { throw new Error('Model did not return valid JSON'); }\nreturn [{ json: parsed }];",
    };

    @node({
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
        this.Webhook.out(0).to(this.Validateprompt.in(0));
        this.Validateprompt.out(0).to(this.Openai.in(0));
        this.Openai.out(0).to(this.Parsejson.in(0));
        this.Parsejson.out(0).to(this.Respond.in(0));
    }
}
