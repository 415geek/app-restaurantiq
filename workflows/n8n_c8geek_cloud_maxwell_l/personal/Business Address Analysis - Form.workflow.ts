import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Business Address Analysis - Form
// Nodes   : 11  |  Connections: 6
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Addressformget                     webhook
// BuildFormHtml                      set
// RespondFormHtml                    respondToWebhook
// Addressformpost                    webhook
// PrepareAnalysisInput               set
// AiAgent                            agent                      [AI]
// GoogleGeminiChatModel              lmChatGoogleGemini         [creds]
// StructuredOutputParser             outputParserStructured
// BuildReadableReport                set
// RespondAnalysisJson                respondToWebhook
// GoogleGeminiChatModelFallback      lmChatGoogleGemini         [creds]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Addressformget
//    → BuildFormHtml
//      → RespondFormHtml
// Addressformpost
//    → PrepareAnalysisInput
//      → AiAgent
//        → BuildReadableReport
//          → RespondAnalysisJson
//
// AI CONNECTIONS
// GoogleGeminiChatModelFallback.uses({ ai_languageModel: AiAgent })
// StructuredOutputParser.uses({ ai_outputParser: AiAgent })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'cad4aee2-19b5-4bd0-934a-addrform01',
    name: 'Business Address Analysis - Form',
    active: true,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
})
export class BusinessAddressAnalysisFormWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'AddressFormGET',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [260, 180],
    })
    Addressformget = {
        multipleMethods: false,
        httpMethod: 'GET',
        path: 'business-address-analysis',
        authentication: 'none',
        responseMode: 'responseNode',
        webhookNotice: '',
        options: {
            rawBody: false,
        },
    };

    @node({
        name: 'Build Form HTML',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [520, 180],
    })
    BuildFormHtml = {
        mode: 'raw',
        duplicateItem: false,
        jsonOutput:
            '{\n  "html": "<!doctype html>\\n<html lang=\\"zh-CN\\">\\n<head>\\n  <meta charset=\\"utf-8\\" />\\n  <meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\" />\\n  <title>AI 商业地址分析</title>\\n  <style>\\n    :root {\\n      --bg-1: #f4f7fb;\\n      --bg-2: #e8f0ff;\\n      --card: #ffffff;\\n      --text: #10243d;\\n      --sub: #4f6278;\\n      --line: #d8e3f0;\\n      --accent: #1f5fff;\\n      --accent-2: #0f4de6;\\n    }\\n    * { box-sizing: border-box; }\\n    body {\\n      margin: 0;\\n      min-height: 100vh;\\n      font-family: -apple-system, BlinkMacSystemFont, \\"Segoe UI\\", Arial, sans-serif;\\n      color: var(--text);\\n      background: radial-gradient(circle at 10% 10%, var(--bg-2), var(--bg-1) 60%);\\n      display: grid;\\n      place-items: center;\\n      padding: 24px;\\n    }\\n    .wrap {\\n      width: 100%;\\n      max-width: 720px;\\n      background: var(--card);\\n      border: 1px solid var(--line);\\n      border-radius: 18px;\\n      box-shadow: 0 16px 36px rgba(16, 36, 61, 0.10);\\n      overflow: hidden;\\n    }\\n    .head {\\n      padding: 28px 28px 14px;\\n      background: linear-gradient(120deg, #f8fbff, #eef4ff);\\n      border-bottom: 1px solid var(--line);\\n    }\\n    .head h1 {\\n      margin: 0 0 8px;\\n      font-size: 26px;\\n      line-height: 1.2;\\n    }\\n    .head p {\\n      margin: 0;\\n      color: var(--sub);\\n      line-height: 1.5;\\n    }\\n    form {\\n      padding: 22px 28px 28px;\\n      display: grid;\\n      gap: 14px;\\n    }\\n    label {\\n      font-size: 14px;\\n      font-weight: 700;\\n      margin-bottom: 4px;\\n      display: inline-block;\\n    }\\n    input, select, button {\\n      width: 100%;\\n      border-radius: 12px;\\n      border: 1px solid var(--line);\\n      padding: 12px 14px;\\n      font-size: 15px;\\n    }\\n    input:focus, select:focus {\\n      outline: none;\\n      border-color: var(--accent);\\n      box-shadow: 0 0 0 3px rgba(31, 95, 255, 0.16);\\n    }\\n    .hint {\\n      color: var(--sub);\\n      font-size: 13px;\\n    }\\n    button {\\n      margin-top: 8px;\\n      background: linear-gradient(120deg, var(--accent), var(--accent-2));\\n      color: #fff;\\n      border: none;\\n      font-weight: 700;\\n      cursor: pointer;\\n    }\\n    button:hover { filter: brightness(1.03); }\\n  </style>\\n</head>\\n<body>\\n  <div class=\\"wrap\\">\\n    <div class=\\"head\\">\\n      <h1>AI 商业地址分析</h1>\\n      <p>输入一个地址，系统将返回结构化选址评估（JSON）与可读报告。</p>\\n    </div>\\n    <form method=\\"post\\" action=\\"/webhook/business-address-analysis\\">\\n      <div>\\n        <label for=\\"address\\">Business Address</label>\\n        <input id=\\"address\\" name=\\"address\\" placeholder=\\"2406 19th Ave, San Francisco, CA\\" required />\\n      </div>\\n      <div>\\n        <label for=\\"language\\">Report Language</label>\\n        <select id=\\"language\\" name=\\"language\\">\\n          <option value=\\"zh-CN\\" selected>zh-CN</option>\\n          <option value=\\"en-US\\">en-US</option>\\n        </select>\\n      </div>\\n      <div class=\\"hint\\">提交后将直接返回分析结果 JSON。</div>\\n      <button type=\\"submit\\">Generate Report</button>\\n    </form>\\n  </div>\\n</body>\\n</html>"\n}',
        includeOtherFields: false,
        options: {
            dotNotation: true,
        },
    };

    @node({
        name: 'Respond Form HTML',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1.5,
        position: [780, 180],
    })
    RespondFormHtml = {
        enableResponseOutput: false,
        generalNotice: '',
        respondWith: 'text',
        webhookNotice: '',
        responseBody: '={{ $json.html }}',
        contentTypeNotice: '',
        options: {
            responseCode: 200,
            responseHeaders: {
                entries: [
                    {
                        name: 'Content-Type',
                        value: 'text/html; charset=utf-8',
                    },
                ],
            },
            enableStreaming: false,
        },
    };

    @node({
        name: 'AddressFormPOST',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [260, 420],
    })
    Addressformpost = {
        multipleMethods: false,
        httpMethod: 'POST',
        path: 'business-address-analysis',
        authentication: 'none',
        responseMode: 'responseNode',
        webhookNotice: '',
        options: {
            rawBody: false,
        },
    };

    @node({
        name: 'Prepare Analysis Input',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [520, 420],
    })
    PrepareAnalysisInput = {
        mode: 'raw',
        duplicateItem: false,
        jsonOutput:
            "={{ (() => {\n  const rawInput = String($json.chatInput ?? $json.address ?? $json.body?.address ?? $json.location ?? '').trim();\n  const language = String($json.language ?? $json.body?.language ?? 'zh-CN').trim() || 'zh-CN';\n  return {\n    source: $json.chatInput ? 'chat' : 'form',\n    original_input: rawInput,\n    original_payload: $json,\n    address: rawInput,\n    language,\n    prompt_input: [\n      '请根据以下输入生成商业地址分析，并严格遵循已连接的 Structured Output Parser schema。',\n      '地址: ' + rawInput,\n      '输出语言: ' + language,\n      '当前阶段说明:',\n      '- 当前没有接入 Google Places / Maps / Census / 实地调研数据。',\n      '- 只能基于地址文本、区域常识和商业逻辑框架做保守分析。',\n      '- 已证实内容请放在“明确观察”。',\n      '- 推断性内容请放在“合理推断”。',\n      '- 任何需要后续核实的内容请放在“待验证信息”。',\n      '- 不要输出 Markdown。',\n      '- 只返回符合 schema 的 JSON。'\n    ].join('\\n')\n  };\n})() }}",
        includeOtherFields: false,
        options: {
            dotNotation: true,
        },
    };

    @node({
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [780, 420],
    })
    AiAgent = {
        aiAgentStarterCallout: '',
        promptType: 'define',
        text: '={{ $json.prompt_input }}',
        hasOutputParser: true,
        notice: '',
        needsFallback: true,
        options: {
            systemMessage:
                '你是一个资深商业选址顾问、商业地产分析师和市场进入策略顾问。\n\n你的任务是基于“单个地址输入”输出一份保守、专业、结构化、可执行的商业地址分析。\n\n硬性规则：\n1. 不要捏造明确事实。\n2. 不要虚构具体营收、租金、客流、人口数字，除非这些数字已经在输入里明确给出。\n3. 当前阶段没有接入 Google Places、Google Maps、Census、街景或现场调研数据。你只能基于地址文本、城市区域常识、常见商业逻辑做谨慎分析。\n4. 任何无法直接确认的信息，都必须明确标记为“合理推断”或“待验证信息”，不能伪装成已证实事实。\n5. 结论先行，避免空话，避免营销腔。\n6. 必须写风险，不能盲目乐观。\n7. 必须给出可执行建议，而不是泛泛而谈。\n8. 输出内容必须兼容结构化解析，只返回符合连接的 Structured Output Parser 的 JSON 数据，不要输出 Markdown，不要输出解释性前后缀，不要输出代码块。\n9. 如果信息不足，允许给出保守结论，但必须说明不确定性来源。\n10. 推荐业态必须是 Top 3，并说明为什么适配、为什么不是更泛的建议。\n\n分析框架：\n- 判断该地址所在商圈可能呈现的商业属性\n- 识别潜在适配的 business 类型\n- 分析潜在目标客群\n- 给出主要机会点\n- 给出主要风险点\n- 给出未来 90 天行动计划\n- 明确区分：明确观察、合理推断、待验证信息\n\n风格要求：\n- 专业\n- 直接\n- 像商业顾问备忘录\n- 有判断，但保持诚实和保守\n- 使用用户指定语言输出所有叙述字段',
            maxIterations: 6,
            returnIntermediateSteps: false,
            passthroughBinaryImages: false,
            enableStreaming: false,
        },
    };

    @node({
        name: 'Google Gemini Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1,
        position: [780, 210],
        credentials: { googlePalmApi: { id: 'pIcYRDDJGUZzgKhi', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModel = {
        notice: '',
        modelName: 'models/gemini-2.5-pro',
        options: {
            maxOutputTokens: 8192,
            temperature: 0.3,
            topK: 40,
            topP: 0.85,
            safetySettings: {
                values: [
                    {
                        category: 'HARM_CATEGORY_HARASSMENT',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                    {
                        category: 'HARM_CATEGORY_HATE_SPEECH',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                    {
                        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                    {
                        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                ],
            },
        },
    };

    @node({
        name: 'Structured Output Parser',
        type: '@n8n/n8n-nodes-langchain.outputParserStructured',
        version: 1.3,
        position: [1010, 210],
    })
    StructuredOutputParser = {
        notice: '',
        schemaType: 'manual',
        inputSchema:
            '{\n  "type": "object",\n  "additionalProperties": false,\n  "required": [\n    "executive_summary",\n    "address_overview",\n    "target_customers",\n    "recommended_business_types",\n    "opportunities",\n    "risks",\n    "next_90_days_plan",\n    "final_verdict"\n  ],\n  "properties": {\n    "executive_summary": {\n      "type": "string"\n    },\n    "address_overview": {\n      "type": "object",\n      "additionalProperties": true\n    },\n    "target_customers": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "recommended_business_types": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "opportunities": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "risks": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "next_90_days_plan": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "final_verdict": {\n      "type": "object",\n      "additionalProperties": true\n    }\n  }\n}',
        autoFix: false,
    };

    @node({
        name: 'Build Readable Report',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [1040, 420],
    })
    BuildReadableReport = {
        mode: 'raw',
        duplicateItem: false,
        jsonOutput:
            "={{ (() => {\n  const o = $json.output || {};\n\n  const pick = (obj, keys, fallback = '暂无') => {\n    if (!obj || typeof obj !== 'object') return fallback;\n    for (const key of keys) {\n      const value = obj[key];\n      if (value !== undefined && value !== null && value !== '') return value;\n    }\n    return fallback;\n  };\n\n  const toArray = (value) => (Array.isArray(value) ? value : []);\n\n  const numbered = (items, mapper) => {\n    if (!Array.isArray(items) || items.length === 0) return '暂无';\n    return items.map((item, idx) => `${idx + 1}. ${mapper(item, idx)}`).join('\\n');\n  };\n\n  const addressOverview = o.address_overview || {};\n  const finalVerdict = o.final_verdict || {};\n\n  const explicitObservations = toArray(addressOverview.explicit_observations).length\n    ? toArray(addressOverview.explicit_observations)\n    : toArray(addressOverview.key_features);\n\n  const reasonableInferences = toArray(addressOverview.reasonable_inferences).length\n    ? toArray(addressOverview.reasonable_inferences)\n    : toArray(addressOverview.inferences);\n\n  const itemsToVerify = toArray(addressOverview.items_to_verify).length\n    ? toArray(addressOverview.items_to_verify)\n    : toArray(addressOverview.to_verify);\n\n  const targetCustomers = toArray(o.target_customers);\n  const recommendedBusinessTypes = toArray(o.recommended_business_types);\n  const opportunities = toArray(o.opportunities);\n  const risks = toArray(o.risks);\n  const nextPlan = toArray(o.next_90_days_plan);\n\n  const report = [\n    '商业地址分析报告',\n    '地址：' + ($json.address || pick(addressOverview, ['submitted_address', 'address', 'location'], '暂无')),\n    '结论：' + pick(finalVerdict, ['recommendation', 'decision'], 'CAUTION'),\n    '',\n    '执行摘要',\n    o.executive_summary || '暂无',\n    '',\n    '一、地址与商圈概览',\n    '商业属性：' + pick(addressOverview, ['commercial_character', 'location_type', 'business_profile'], '暂无'),\n    '区域画像：' + pick(addressOverview, ['area_profile', 'area_summary', 'neighborhood_profile'], '暂无'),\n    '置信度：' + pick(addressOverview, ['confidence_level', 'confidence'], 'low'),\n    '',\n    '明确观察',\n    numbered(explicitObservations, (item) => item),\n    '',\n    '合理推断',\n    numbered(reasonableInferences, (item) => item),\n    '',\n    '待验证信息',\n    numbered(itemsToVerify, (item) => item),\n    '',\n    '二、潜在目标客群',\n    numbered(targetCustomers, (item) =>\n      `${pick(item, ['segment', 'name'], '客群')}｜匹配度：${pick(item, ['fit_level', 'match_level'], 'medium')}｜${pick(item, ['why_this_segment', 'description', 'reason'], '暂无')}`\n    ),\n    '',\n    '三、推荐业态 Top 3',\n    numbered(recommendedBusinessTypes, (item, idx) =>\n      `#${pick(item, ['rank'], idx + 1)} ${pick(item, ['business_type', 'type', 'name'], '未命名业态')}｜原因：${pick(item, ['fit_reason', 'reasoning', 'reason'], '暂无')}｜定位建议：${pick(item, ['positioning_hint', 'positioning'], '暂无')}｜关键要求：${toArray(item.key_requirements || item.requirements).join('；') || '暂无'}`\n    ),\n    '',\n    '四、主要机会',\n    numbered(opportunities, (item) =>\n      `[${pick(item, ['priority', 'level'], 'medium')}] ${pick(item, ['title', 'name'], '未命名机会')}｜${pick(item, ['detail', 'description'], '暂无')}`\n    ),\n    '',\n    '五、主要风险',\n    numbered(risks, (item) =>\n      `[${pick(item, ['severity', 'level'], 'medium')}] ${pick(item, ['title', 'name'], '未命名风险')}｜${pick(item, ['detail', 'description'], '暂无')}｜缓解建议：${pick(item, ['mitigation', 'mitigation_plan'], '暂无')}`\n    ),\n    '',\n    '六、未来90天行动计划',\n    numbered(nextPlan, (item) =>\n      `${pick(item, ['timeframe', 'phase', 'period'], '阶段')}｜目标：${pick(item, ['objective', 'goal'], '暂无')}｜动作：${toArray(item.actions || item.action_items || item.steps).join('；') || '暂无'}｜完成标志：${pick(item, ['success_marker', 'kpi', 'outcome'], '暂无')}`\n    ),\n    '',\n    '最终判断',\n    '推荐：' + pick(finalVerdict, ['recommendation', 'decision'], 'CAUTION'),\n    '原因：' + pick(finalVerdict, ['rationale', 'reasoning'], '暂无'),\n    '进入前提：' + pick(finalVerdict, ['success_condition', 'entry_condition'], '暂无'),\n    '放弃触发条件：',\n    numbered(toArray(finalVerdict.no_go_triggers || finalVerdict.stop_conditions), (item) => item),\n  ].join('\\n');\n\n  return {\n    source: $json.source,\n    address: $json.address,\n    language: $json.language,\n    analysis: o,\n    report,\n    formSubmittedText: report\n  };\n})() }}",
        includeOtherFields: false,
        options: {
            dotNotation: true,
        },
    };

    @node({
        name: 'Respond Analysis JSON',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1.5,
        position: [1280, 420],
    })
    RespondAnalysisJson = {
        enableResponseOutput: false,
        generalNotice: '',
        respondWith: 'json',
        webhookNotice: '',
        responseBody:
            '={{ { formSubmittedText: $json.formSubmittedText, report: $json.report, analysis: $json.analysis, address: ($json.address || (($json.analysis && $json.analysis.address_overview && $json.analysis.address_overview.address) || null)), language: ($json.language || null), source: ($json.source || null) } }}',
        options: {
            responseCode: 200,
            enableStreaming: false,
        },
    };

    @node({
        name: 'Google Gemini Chat Model Fallback',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1,
        position: [780, 40],
        credentials: { googlePalmApi: { id: 'pIcYRDDJGUZzgKhi', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModelFallback = {
        notice: '',
        modelName: 'models/gemini-2.5-flash',
        options: {
            maxOutputTokens: 8192,
            temperature: 0.3,
            topK: 40,
            topP: 0.85,
            safetySettings: {
                values: [
                    {
                        category: 'HARM_CATEGORY_HARASSMENT',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                    {
                        category: 'HARM_CATEGORY_HATE_SPEECH',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                    {
                        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                    {
                        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                        threshold: 'BLOCK_ONLY_HIGH',
                    },
                ],
            },
        },
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Addressformget.out(0).to(this.BuildFormHtml.in(0));
        this.BuildFormHtml.out(0).to(this.RespondFormHtml.in(0));
        this.Addressformpost.out(0).to(this.PrepareAnalysisInput.in(0));
        this.PrepareAnalysisInput.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.BuildReadableReport.in(0));
        this.BuildReadableReport.out(0).to(this.RespondAnalysisJson.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.GoogleGeminiChatModelFallback.output,
            ai_outputParser: this.StructuredOutputParser.output,
        });
    }
}
