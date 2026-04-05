import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Business Address Analysis - Chat
// Nodes   : 8  |  Connections: 4
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Chattrigger                        chatTrigger
// PrepareAnalysisInput               set
// AiAgent                            agent                      [AI]
// GoogleGeminiChatModel              lmChatGoogleGemini         [creds]
// StructuredOutputParser             outputParserStructured
// BuildReadableReport                set
// Chat                               chat
// GoogleGeminiChatModelFallback      lmChatGoogleGemini         [creds]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Chattrigger
//    → PrepareAnalysisInput
//      → AiAgent
//        → BuildReadableReport
//          → Chat
//
// AI CONNECTIONS
// GoogleGeminiChatModelFallback.uses({ ai_languageModel: AiAgent })
// StructuredOutputParser.uses({ ai_outputParser: AiAgent })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'cad4aee2-19b5-4bd0-934a-addrchat01',
    name: 'Business Address Analysis - Chat',
    active: true,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
})
export class BusinessAddressAnalysisChatWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'ChatTrigger',
        type: '@n8n/n8n-nodes-langchain.chatTrigger',
        version: 1.4,
        position: [260, 300],
    })
    Chattrigger = {
        public: true,
        mode: 'hostedChat',
        initialMessages: '请输入一个商业地址，例如：2406 19th Ave, San Francisco, CA',
        options: {
            title: 'AI 商业地址分析',
            subtitle: '发送一个地址，返回结构化商业选址分析。',
            inputPlaceholder: '2406 19th Ave, San Francisco, CA',
            responseMode: 'responseNodes',
            allowedOrigins: '*',
            loadPreviousSession: 'notSupported',
            showWelcomeScreen: false,
        },
    };

    @node({
        name: 'Prepare Analysis Input',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [520, 300],
    })
    PrepareAnalysisInput = {
        mode: 'raw',
        includeOtherFields: false,
        options: {
            dotNotation: true,
        },
        jsonOutput:
            "={{ (() => {\n  const rawInput = String(\n    $json.chatInput ??\n    $json.address ??\n    $json.body?.address ??\n    $json.location ??\n    $json.query?.address ??\n    ''\n  ).trim();\n\n  const language = String(\n    $json.language ??\n    $json.body?.language ??\n    $json.query?.language ??\n    'zh-CN'\n  ).trim() || 'zh-CN';\n\n  return {\n    source: $json.chatInput ? 'chat' : 'form',\n    original_input: rawInput,\n    original_payload: $json,\n    address: rawInput,\n    language,\n    prompt_input: [\n      '请根据以下输入生成商业地址分析，并严格遵循已连接的 Structured Output Parser schema。',\n      '地址: ' + rawInput,\n      '输出语言: ' + language,\n      '当前阶段说明:',\n      '- 当前没有接入 Google Places / Maps / Census / 实地调研数据。',\n      '- 只能基于地址文本、区域常识和商业逻辑框架做保守分析。',\n      '- 已证实内容请放在“明确观察”。',\n      '- 推断性内容请放在“合理推断”。',\n      '- 任何需要后续核实的内容请放在“待验证信息”。',\n      '- 不要输出 Markdown。',\n      '- 只返回符合 schema 的 JSON。'\n    ].join('\\n')\n  };\n})() }}",
    };

    @node({
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [780, 300],
    })
    AiAgent = {
        promptType: 'define',
        text: '={{ $json.prompt_input }}',
        hasOutputParser: true,
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
        position: [780, 80],
        credentials: { googlePalmApi: { id: 'pIcYRDDJGUZzgKhi', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModel = {
        modelName: 'models/gemini-2.0-flash',
        options: {
            maxOutputTokens: 8192,
            temperature: 0.3,
            topP: 0.85,
            topK: 40,
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
        position: [1010, 80],
    })
    StructuredOutputParser = {
        schemaType: 'manual',
        inputSchema:
            '{\n  "type": "object",\n  "additionalProperties": false,\n  "required": [\n    "executive_summary",\n    "address_overview",\n    "target_customers",\n    "recommended_business_types",\n    "opportunities",\n    "risks",\n    "next_90_days_plan",\n    "final_verdict"\n  ],\n  "properties": {\n    "executive_summary": {\n      "type": "string"\n    },\n    "address_overview": {\n      "type": "object",\n      "additionalProperties": true\n    },\n    "target_customers": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "recommended_business_types": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "opportunities": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "risks": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "next_90_days_plan": {\n      "type": "array",\n      "items": {\n        "type": "object",\n        "additionalProperties": true\n      }\n    },\n    "final_verdict": {\n      "type": "object",\n      "additionalProperties": true\n    }\n  }\n}',
        autoFix: false,
    };

    @node({
        name: 'Build Readable Report',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [1040, 300],
    })
    BuildReadableReport = {
        mode: 'raw',
        includeOtherFields: false,
        options: {
            dotNotation: true,
        },
        jsonOutput:
            "={{ (() => {\n  const o = $json.output || {};\n\n  const pick = (obj, keys, fallback = '暂无') => {\n    if (!obj || typeof obj !== 'object') return fallback;\n    for (const key of keys) {\n      const value = obj[key];\n      if (value !== undefined && value !== null && value !== '') return value;\n    }\n    return fallback;\n  };\n\n  const toArray = (value) => (Array.isArray(value) ? value : []);\n\n  const numbered = (items, mapper) => {\n    if (!Array.isArray(items) || items.length === 0) return '暂无';\n    return items.map((item, idx) => `${idx + 1}. ${mapper(item, idx)}`).join('\\n');\n  };\n\n  const addressOverview = o.address_overview || {};\n  const finalVerdict = o.final_verdict || {};\n\n  const explicitObservations = toArray(addressOverview.explicit_observations).length\n    ? toArray(addressOverview.explicit_observations)\n    : toArray(addressOverview.key_features);\n\n  const reasonableInferences = toArray(addressOverview.reasonable_inferences).length\n    ? toArray(addressOverview.reasonable_inferences)\n    : toArray(addressOverview.inferences);\n\n  const itemsToVerify = toArray(addressOverview.items_to_verify).length\n    ? toArray(addressOverview.items_to_verify)\n    : toArray(addressOverview.to_verify);\n\n  const targetCustomers = toArray(o.target_customers);\n  const recommendedBusinessTypes = toArray(o.recommended_business_types);\n  const opportunities = toArray(o.opportunities);\n  const risks = toArray(o.risks);\n  const nextPlan = toArray(o.next_90_days_plan);\n\n  const report = [\n    '商业地址分析报告',\n    '地址：' + ($json.address || pick(addressOverview, ['submitted_address', 'address', 'location'], '暂无')),\n    '结论：' + pick(finalVerdict, ['recommendation', 'decision'], 'CAUTION'),\n    '',\n    '执行摘要',\n    o.executive_summary || '暂无',\n    '',\n    '一、地址与商圈概览',\n    '商业属性：' + pick(addressOverview, ['commercial_character', 'location_type', 'business_profile'], '暂无'),\n    '区域画像：' + pick(addressOverview, ['area_profile', 'area_summary', 'neighborhood_profile'], '暂无'),\n    '置信度：' + pick(addressOverview, ['confidence_level', 'confidence'], 'low'),\n    '',\n    '明确观察',\n    numbered(explicitObservations, (item) => item),\n    '',\n    '合理推断',\n    numbered(reasonableInferences, (item) => item),\n    '',\n    '待验证信息',\n    numbered(itemsToVerify, (item) => item),\n    '',\n    '二、潜在目标客群',\n    numbered(targetCustomers, (item) =>\n      `${pick(item, ['segment', 'name'], '客群')}｜匹配度：${pick(item, ['fit_level', 'match_level'], 'medium')}｜${pick(item, ['why_this_segment', 'description', 'reason'], '暂无')}`\n    ),\n    '',\n    '三、推荐业态 Top 3',\n    numbered(recommendedBusinessTypes, (item, idx) =>\n      `#${pick(item, ['rank'], idx + 1)} ${pick(item, ['business_type', 'type', 'name'], '未命名业态')}｜原因：${pick(item, ['fit_reason', 'reasoning', 'reason'], '暂无')}｜定位建议：${pick(item, ['positioning_hint', 'positioning'], '暂无')}｜关键要求：${toArray(item.key_requirements || item.requirements).join('；') || '暂无'}`\n    ),\n    '',\n    '四、主要机会',\n    numbered(opportunities, (item) =>\n      `[${pick(item, ['priority', 'level'], 'medium')}] ${pick(item, ['title', 'name'], '未命名机会')}｜${pick(item, ['detail', 'description'], '暂无')}`\n    ),\n    '',\n    '五、主要风险',\n    numbered(risks, (item) =>\n      `[${pick(item, ['severity', 'level'], 'medium')}] ${pick(item, ['title', 'name'], '未命名风险')}｜${pick(item, ['detail', 'description'], '暂无')}｜缓解建议：${pick(item, ['mitigation', 'mitigation_plan'], '暂无')}`\n    ),\n    '',\n    '六、未来90天行动计划',\n    numbered(nextPlan, (item) =>\n      `${pick(item, ['timeframe', 'phase', 'period'], '阶段')}｜目标：${pick(item, ['objective', 'goal'], '暂无')}｜动作：${toArray(item.actions || item.action_items || item.steps).join('；') || '暂无'}｜完成标志：${pick(item, ['success_marker', 'kpi', 'outcome'], '暂无')}`\n    ),\n    '',\n    '最终判断',\n    '推荐：' + pick(finalVerdict, ['recommendation', 'decision'], 'CAUTION'),\n    '原因：' + pick(finalVerdict, ['rationale', 'reasoning'], '暂无'),\n    '进入前提：' + pick(finalVerdict, ['success_condition', 'entry_condition'], '暂无'),\n    '放弃触发条件：',\n    numbered(toArray(finalVerdict.no_go_triggers || finalVerdict.stop_conditions), (item) => item),\n  ].join('\\n');\n\n  return {\n    source: $json.source,\n    address: $json.address,\n    language: $json.language,\n    analysis: o,\n    report,\n    formSubmittedText: report\n  };\n})() }}",
    };

    @node({
        name: 'Chat',
        type: '@n8n/n8n-nodes-langchain.chat',
        version: 1.2,
        position: [1280, 300],
    })
    Chat = {
        operation: 'send',
        message: '={{ $json.report }}',
    };

    @node({
        name: 'Google Gemini Chat Model Fallback',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1,
        position: [780, -90],
        credentials: { googlePalmApi: { id: 'pIcYRDDJGUZzgKhi', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModelFallback = {
        modelName: 'models/gemini-2.5-flash',
        options: {
            maxOutputTokens: 8192,
            temperature: 0.3,
            topP: 0.85,
            topK: 40,
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
        this.Chattrigger.out(0).to(this.PrepareAnalysisInput.in(0));
        this.PrepareAnalysisInput.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.BuildReadableReport.in(0));
        this.BuildReadableReport.out(0).to(this.Chat.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.GoogleGeminiChatModelFallback.output,
            ai_outputParser: this.StructuredOutputParser.output,
        });
    }
}
