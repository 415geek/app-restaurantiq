import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : My workflow 4
// Nodes   : 6  |  Connections: 2
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// OnFormSubmission                   formTrigger
// Summarize                          summarize
// AiAgent                            agent                      [AI]
// StructuredOutputParser             outputParserStructured     [AI]
// GoogleGeminiChatModel              lmChatGoogleGemini         [creds]
// EditFields                         set
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// OnFormSubmission
//    → Summarize
//      → AiAgent
//
// AI CONNECTIONS
// StructuredOutputParser.uses({ ai_outputParser: AiAgent })
// GoogleGeminiChatModel.uses({ ai_languageModel: AiAgent, ai_languageModel: StructuredOutputParser })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'ffZDvOJQQ5tQGDM6',
    name: 'My workflow 4',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
})
export class MyWorkflow4Workflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        version: 2.5,
        position: [-592, -48],
    })
    OnFormSubmission = {
        formTitle: 'Address',
        formFields: {
            values: [
                {
                    fieldLabel: 'Address',
                },
                {
                    fieldLabel: 'Business Type ',
                },
            ],
        },
        options: {},
    };

    @node({
        name: 'Summarize',
        type: 'n8n-nodes-base.summarize',
        version: 1.1,
        position: [-384, -48],
    })
    Summarize = {
        fieldsToSummarize: {
            values: [
                {
                    aggregation: 'append',
                    field: 'Address',
                },
                {
                    aggregation: 'append',
                    field: 'Business Type ',
                },
            ],
        },
        options: {
            outputFormat: 'separateItems',
        },
    };

    @node({
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [-176, -48],
    })
    AiAgent = {
        hasOutputParser: true,
        options: {
            systemMessage:
                '你是一个北美本地商业选址与竞争分析顾问，专长是基于“地址”评估一个地点适合开什么类型的生意，尤其擅长餐饮、咖啡店、茶饮店、零售和服务型门店。\n\n你的任务是：\n根据用户提供的地址，对该地址周边商业环境进行系统化分析，并输出一份专业、详细、可执行的商业分析报告。\n\n你的工作目标不是泛泛而谈，而是帮助用户判断：\n1. 这个地址适合做什么类型的生意\n2. 周边有哪些主要竞争者\n3. 这个地点的潜在客群是谁\n4. 该地址的机会点、风险点是什么\n5. 如果现在开店，未来90天应该怎么做\n\n请严格遵守以下规则：\n\n【输入理解规则】\n- 用户核心输入通常是一个具体地址\n- 如果用户没有说明行业，默认优先从“餐饮、咖啡/茶饮、零售、服务型门店”四类方向评估\n- 如果用户明确指定行业，则围绕该行业深度分析\n- 如果地址信息不完整，要指出地址完整度可能影响判断准确性\n\n【分析方法规则】\n你必须按以下逻辑分析：\n1. 地址定位与商圈属性\n2. 周边商业密度与业态结构\n3. 目标客群画像\n4. 竞品扫描与对比\n5. 流量与需求线索\n6. 机会点\n7. 风险点\n8. 最适合进入的 business type 排序\n9. 落地建议与未来90天行动计划\n\n【事实约束规则】\n- 不要把无法确认的信息说成事实\n- 对于无法直接确认的数据，必须用“推测”“可能”“需要进一步验证”这类表述\n- 将内容分为三类：\n  A. 明确观察/公共信息\n  B. 合理推断\n  C. 信息缺口/待验证点\n- 不要捏造具体营收、租金、客流数字，除非用户提供或工具返回\n- 如果缺少数据，明确告诉用户下一步应该补什么数据\n\n【输出要求】\n输出必须结构化、专业、具体，避免空洞套话。\n必须包含以下模块，并使用清晰标题：\n\n1. 执行摘要\n2. 地址与商圈定位\n3. 周边业态扫描\n4. 目标客群判断\n5. 竞品分析\n6. 需求与流量信号\n7. 最适合的商业类型排名（Top 3）\n8. 机会点\n9. 风险点\n10. 建议进入策略\n11. 未来90天行动计划\n12. 信息缺口与建议补充数据\n\n【竞品分析要求】\n竞品分析至少包含：\n- 店铺类型\n- 定位\n- 价格带（如无法确认，用大致区间或“待验证”）\n- 用户感知优势\n- 用户抱怨点\n- 对新进入者的威胁等级（高/中/低）\n\n【商业类型推荐要求】\n对每个推荐方向，说明：\n- 为什么适合这个地址\n- 核心成功要素\n- 最需要规避的错误\n- 适合的客单价区间\n- 推荐程度（高/中/低）\n\n【90天行动计划要求】\n分为：\n- 0–30天：验证阶段\n- 31–60天：打磨阶段\n- 61–90天：放大阶段\n\n【风格要求】\n- 专业、直接、像顾问报告\n- 少说废话\n- 用结论先行\n- 不要只讲优点，必须讲风险\n- 对不确定内容要诚实\n\n如果数据不足，请在结尾明确说明：\n“以下结论基于地址周边公开信息与商业逻辑推断，最终决策仍建议结合实地踩点、租金条件、人口结构、交通流量和竞品实地调研进一步验证。”',
        },
    };

    @node({
        name: 'Structured Output Parser',
        type: '@n8n/n8n-nodes-langchain.outputParserStructured',
        version: 1.3,
        position: [-16, 176],
    })
    StructuredOutputParser = {
        schemaType: 'manual',
        autoFix: true,
    };

    @node({
        name: 'Google Gemini Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1,
        position: [-352, 176],
        credentials: { googlePalmApi: { id: 'pIcYRDDJGUZzgKhi', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModel = {
        modelName: 'models/gemini-3-pro-preview',
        options: {
            maxOutputTokens: 8192,
            temperature: 0.3,
            topK: 40,
            topP: 0.9,
        },
    };

    @node({
        name: 'Edit Fields',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [416, 16],
    })
    EditFields = {
        assignments: {
            assignments: [
                {
                    id: 'b8806a6f-e6ff-45aa-bed9-76dcc447a688',
                    name: 'Report',
                    value: '=商业选址分析报告  📍 Summary: {{$json.executive_summary}}  🏆 推荐业务: {{$json.recommended_business_types}}  📈 机会: {{$json.opportunities}}  ⚠️ 风险: {{$json.risks}}  📅 90天计划: 0-30天: {{$json.next_90_days_plan.days_0_30}}  31-60天: {{$json.next_90_days_plan.days_31_60}}  61-90天: {{$json.next_90_days_plan.days_61_90}}',
                    type: 'string',
                },
            ],
        },
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.OnFormSubmission.out(0).to(this.Summarize.in(0));
        this.Summarize.out(0).to(this.AiAgent.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.GoogleGeminiChatModel.output,
            ai_outputParser: this.StructuredOutputParser.output,
        });
        this.StructuredOutputParser.uses({
            ai_languageModel: this.GoogleGeminiChatModel.output,
        });
    }
}
