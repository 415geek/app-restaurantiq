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
        jsCode: "const expected = String($env.N8N_IQ_WEBHOOK_SECRET || $env.N8N_INTERNAL_AUTH_TOKEN || '').trim();\nlet root = $json;\ntry {\n  root = $('Webhook').first().json;\n} catch {}\nconst headers = root.headers || {};\nconst auth = String(headers.authorization || headers.Authorization || headers['x-authorization'] || '').trim();\nconst want = expected ? 'Bearer ' + expected : '';\nif (expected && auth !== want) { throw new Error('Unauthorized'); }\nconst body = root.body || {};\nconst address = String(body.address || body.location || '').trim();\nconst industry = String(body.industry || body.businessType || 'restaurant').trim();\nconst cuisine_type = body.cuisine_type ? String(body.cuisine_type).trim() : '';\nconst language = String(body.language || 'en').toLowerCase() === 'zh' ? 'zh' : 'en';\nconst analysis_id = body.analysis_id ? String(body.analysis_id) : '';\nconst market_data = body.market_data || null;\nconst headline = String(body.headline || body.partialHeadline || '').trim();\nconst reason = String(body.reason || body.partialReason || '').trim();\nif (!address) throw new Error('Missing address');\n\nconst system = language === 'zh'\n  ? [\n      '你是 LocationIQ 选址大师的高级分析引擎，兼具：结构化商业顾问（MECE、假设透明）、客流/贸易区建模视角、资深餐饮运营经验。',\n      '用户为单笔约 $50k–$300k 量级的开店决策付费 $19；输出须像价值 $500+ 的迷你咨询：可执行、假设透明、结论前置。',\n      '遵循 V2.0 付费版结构思想：贸易区分层、客流时段矩阵、人口与消费力、竞争清单与空白地图、三场景营收与敏感性、风险概率-影响与对冲、差异化与获客、90天作战图、可比案例、加权决策矩阵。',\n      '禁止编造无法支撑的精确数字；关键假设须写明；竞争对手在可得情况下用真实店名（若仅有汇总数据须说明）。',\n      '风险须配对冲思路；行动计划须具体到人/预算/产出/完成标志，不写「做市场调研」类空话。',\n      '全文中文；专有名词、地址、品牌可保留英文。',\n      '严格输出 JSON，键名与前端约定一致。',\n    ].join(' ')\n  : [\n      'You are the LocationIQ premium site-selection engine: structured consultant + trade-area analytics + restaurant operations depth.',\n      'The customer paid $19 for a decision-grade mini report; deliver $500+ consulting density with transparent assumptions and lead-with-conclusion style.',\n      'Follow V2.0 premium themes: layered trade area, daypart demand matrix, demographics & spending power, competitor tables & whitespace, three-scenario revenue + sensitivity, risk matrix with mitigations, differentiation & acquisition, 90-day plan, comparables, weighted decision matrix.',\n      'No fabricated precision; label [estimate] when needed; use real competitor names when inferable from provided data.',\n      'Risks must include mitigations; actions must be concrete (owner, budget band, deliverable, KPI), not generic \"do research\".',\n      'Output strict JSON with the requested keys.',\n    ].join(' ');\n\nlet marketDataSection = '';\nif (market_data) {\n  marketDataSection = language === 'zh'\n    ? '\\n\\n【市场数据（来自 Google Places + Yelp）】\\n' + JSON.stringify(market_data, null, 2)\n    : '\\n\\nMARKET DATA (from Google Places + Yelp):\\n' + JSON.stringify(market_data, null, 2);\n}\n\nconst biz = cuisine_type ? industry + '（' + cuisine_type + '）' : industry;\n\nconst user = language === 'zh'\n  ? [\n      '为以下输入生成付费版「选址可行性深度分析」（LocationIQ V2.0），严格 JSON，键名如下。',\n      '分析ID：' + analysis_id,\n      '地址：' + address,\n      '业态：' + biz,\n      '免费版 headline：' + headline,\n      '免费版要点/理由：' + reason,\n      marketDataSection,\n      '',\n      '内容须体现：核心/次级/边缘贸易区与时段客流、人群与消费力、竞对表与威胁等级与空白地图、三场景营收+敏感性、风险（概率档+影响+触发+对冲）×5、机会×3、失败场景×3、差异化策略、8–12步行动计划（负责人/预算/产出/KPI）、置信度（高|中|低）+依据。',\n      '',\n      '禁止编造无法验证的精确数字；用[估算]标注假设。',\n      '',\n      '返回 JSON：',\n      '{',\n      '  \"executive_summary\": \"3–4句，首句 GO/CAUTION/NO-GO；末含数据来源与免责声明要点\",',\n      '  \"final_verdict\": \"一句结论\",',\n      '  \"trade_area_analysis\": \"贸易区与客流，可含 Markdown 表\",',\n      '  \"demographic_profile\": \"人群与消费力\",',\n      '  \"competition_landscape\": \"竞对表与空白地图\",',\n      '  \"revenue_estimate\": \"三场景营收逻辑与敏感性\",',\n      '  \"risks\": [\"5条\"],',\n      '  \"opportunities\": [\"3条\"],',\n      '  \"failure_scenarios\": [\"3条\"],',\n      '  \"differentiation_strategy\": \"定位与差异化\",',\n      '  \"action_plan\": [\"8–12步\"],',\n      '  \"confidence\": \"高|中|低\"',\n      '}',\n    ].filter(Boolean).join('\\n')\n  : [\n      'Generate the PAID LocationIQ V2.0 deep-dive as STRICT JSON with these exact keys.',\n      'analysis_id: ' + analysis_id,\n      'ADDRESS: ' + address,\n      'BUSINESS TYPE: ' + biz,\n      'FREE TIER HEADLINE: ' + headline,\n      'FREE TIER NOTES: ' + reason,\n      marketDataSection,\n      '',\n      'Cover: layered trade areas + daypart traffic, demographics & spending power, competitor matrix + threat levels + whitespace, three-scenario revenue + sensitivity, five risks (probability, impact, trigger, mitigation), three opportunities, three failure scenarios, differentiation, 8–12 action steps (owner/budget/deliverable/KPI), confidence High|Medium|Low with rationale.',\n      '',\n      'Use [estimate] labels; no fabricated precision.',\n      '',\n      'Return JSON keys: executive_summary, final_verdict, trade_area_analysis, demographic_profile, competition_landscape, revenue_estimate (string, markdown tables allowed inside), risks[5], opportunities[3], failure_scenarios[3], differentiation_strategy, action_plan[], confidence.',\n    ].filter(Boolean).join('\\n');\n\nreturn [{ json: { system, user } }];",
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
            "={{ { model: 'gpt-4o-mini', temperature: 0.5, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: $json.system }, { role: 'user', content: $json.user } ] } }}",
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
