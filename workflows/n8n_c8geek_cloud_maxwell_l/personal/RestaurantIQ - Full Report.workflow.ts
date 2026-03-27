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
        jsCode: "const expected = $env.N8N_IQ_WEBHOOK_SECRET || '';\nconst headers = $json.headers || {};\nconst auth = headers.authorization || headers.Authorization || '';\nif (expected && auth !== ('Bearer ' + expected)) { throw new Error('Unauthorized'); }\nconst body = $json.body || {};\nconst address = String(body.address || '').trim();\nconst industry = String(body.industry || 'restaurant').trim();\nconst cuisine_type = body.cuisine_type ? String(body.cuisine_type).trim() : '';\nconst language = String(body.language || 'en').toLowerCase() === 'zh' ? 'zh' : 'en';\nconst analysis_id = body.analysis_id ? String(body.analysis_id) : '';\nconst market_data = body.market_data || null;\nif (!address) throw new Error('Missing address');\n\nconst system = language === 'zh' \n  ? '你是资深餐饮选址与经营顾问。请严格输出 JSON，不要输出多余文本。使用提供的市场数据进行分析。' \n  : 'You are a senior restaurant location and operations analyst. Output STRICT JSON only. Use the provided market data for your analysis.';\n\nlet marketDataSection = '';\nif (market_data) {\n  marketDataSection = language === 'zh'\n    ? '\\n\\n【市场数据（来自 Google Places + Yelp）】\\n' + JSON.stringify(market_data, null, 2)\n    : '\\n\\nMARKET DATA (from Google Places + Yelp):\\n' + JSON.stringify(market_data, null, 2);\n}\n\nconst user = language === 'zh'\n  ? ('生成付费版完整报告（结构化 JSON）。\\n分析ID：' + analysis_id + '\\n地址：' + address + '\\n业态：' + industry + (cuisine_type ? ('\\n菜系/类型：' + cuisine_type) : '') + marketDataSection + '\\n\\n基于以上数据，生成 JSON 结构：{\\n  \"revenue_estimate\": {\"monthly_range\": \"\", \"assumptions\": []},\\n  \"top_3_risks\": [\"\"],\\n  \"top_3_opportunities\": [\"\"],\\n  \"action_plan\": [\"\"],\\n  \"confidence\": \"low|medium|high\",\\n  \"share_preview\": {\"headline\": \"\", \"bullets\": []}\\n}')\n  : ('Generate a paid full report as structured JSON.\\nanalysis_id: ' + analysis_id + '\\nAddress: ' + address + '\\nIndustry: ' + industry + (cuisine_type ? ('\\nCuisine/type: ' + cuisine_type) : '') + marketDataSection + '\\n\\nBased on the above data, return JSON: {\\n  \"revenue_estimate\": {\"monthly_range\": \"\", \"assumptions\": []},\\n  \"top_3_risks\": [\"\"],\\n  \"top_3_opportunities\": [\"\"],\\n  \"action_plan\": [\"\"],\\n  \"confidence\": \"low|medium|high\",\\n  \"share_preview\": {\"headline\": \"\", \"bullets\": []}\\n}');\nreturn [{ json: { system, user } }];",
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
            "={{ { model: 'gpt-4o-mini', temperature: 0.5, messages: [ { role: 'system', content: $json.system }, { role: 'user', content: $json.user } ] } }}",
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
