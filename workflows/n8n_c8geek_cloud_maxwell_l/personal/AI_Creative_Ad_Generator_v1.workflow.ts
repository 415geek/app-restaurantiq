import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : AI_Creative_Ad_Generator_v1
// Nodes   : 18  |  Connections: 20
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// StartWebhook                       webhook
// GooglePlacesSearch                 httpRequest
// GooglePlacesDetails                httpRequest
// GoogleNearbyCompetitors            httpRequest
// FormatBusinessData                 code
// AgentAAnalysis                     httpRequest
// ReturnAnalysis                     respondToWebhook
// UserSelectionWebhook               webhook
// SwitchFormat                       switch
// SwitchTextType                     switch
// SwitchVideoType                    switch
// AnalyzeReferenceAssets             httpRequest
// GenerateCopyText                   httpRequest
// GeneratePlanText                   httpRequest
// GeneratePosterDesign               httpRequest
// GenerateCapcutScript               httpRequest
// GenerateCreativeScripts            httpRequest
// ReturnFinalContent                 respondToWebhook
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// StartWebhook
//    → GooglePlacesSearch
//      → GooglePlacesDetails
//        → GoogleNearbyCompetitors
//          → FormatBusinessData
//            → AgentAAnalysis
//              → ReturnAnalysis
// UserSelectionWebhook
//    → SwitchFormat
//      → SwitchTextType
//        → GenerateCopyText
//          → ReturnFinalContent
//       .out(1) → GeneratePlanText
//          → ReturnFinalContent (↩ loop)
//       .out(2) → GeneratePosterDesign
//          → ReturnFinalContent (↩ loop)
//     .out(1) → AnalyzeReferenceAssets
//        → SwitchVideoType
//          → GenerateCapcutScript
//            → ReturnFinalContent (↩ loop)
//         .out(1) → GenerateCreativeScripts
//            → ReturnFinalContent (↩ loop)
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'wYaHLcJBmCVjc686',
    name: 'AI_Creative_Ad_Generator_v1',
    active: true,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
})
export class AiCreativeAdGeneratorV1Workflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'Start_Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [256, 304],
    })
    StartWebhook = {
        httpMethod: 'POST',
        path: 'creative-ad/start',
        responseMode: 'responseNode',
        options: {
            rawBody: false,
        },
    };

    @node({
        name: 'Google_Places_Search',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [464, 304],
    })
    GooglePlacesSearch = {
        url: 'https://maps.googleapis.com/maps/api/place/textsearch/json',
        authentication: 'genericCredentialType',
        genericAuthType: 'oAuth2Api',
        sendQuery: true,
        queryParameters: {
            parameters: [
                {
                    name: 'query',
                    value: "={{ $('Start_Webhook').item.json.body.business_query || $('Start_Webhook').item.json.business_query }}",
                },
                {
                    name: 'key',
                    value: "={{ $('Start_Webhook').item.json.body.google_places_api_key || $('Start_Webhook').item.json.google_places_api_key }}",
                },
                {
                    name: 'language',
                    value: 'zh-CN',
                },
            ],
        },
        options: {},
    };

    @node({
        name: 'Google_Places_Details',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [656, 304],
    })
    GooglePlacesDetails = {
        url: 'https://maps.googleapis.com/maps/api/place/details/json',
        sendQuery: true,
        queryParameters: {
            parameters: [
                {
                    name: 'place_id',
                    value: '={{ $json.results[0].place_id }}',
                },
                {
                    name: 'fields',
                    value: 'name,formatted_address,types,rating,reviews,photos,opening_hours,website,price_level,user_ratings_total,editorial_summary',
                },
                {
                    name: 'key',
                    value: "={{ $('Start_Webhook').item.json.body.google_places_api_key || $('Start_Webhook').item.json.google_places_api_key }}",
                },
                {
                    name: 'language',
                    value: 'zh-CN',
                },
                {
                    name: 'reviews_sort',
                    value: 'newest',
                },
            ],
        },
        options: {},
    };

    @node({
        name: 'Google_Nearby_Competitors',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [864, 304],
    })
    GoogleNearbyCompetitors = {
        url: 'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        sendQuery: true,
        queryParameters: {
            parameters: [
                {
                    name: 'location',
                    value: "={{ $('Google_Places_Search').item.json.results[0].geometry.location.lat }},{{ $('Google_Places_Search').item.json.results[0].geometry.location.lng }}",
                },
                {
                    name: 'radius',
                    value: '2000',
                },
                {
                    name: 'type',
                    value: "={{ $('Google_Places_Search').item.json.results[0].types[0] }}",
                },
                {
                    name: 'key',
                    value: "={{ $('Start_Webhook').item.json.body.google_places_api_key || $('Start_Webhook').item.json.google_places_api_key }}",
                },
                {
                    name: 'language',
                    value: 'zh-CN',
                },
            ],
        },
        options: {},
    };

    @node({
        name: 'Format_Business_Data',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1056, 304],
    })
    FormatBusinessData = {
        jsCode: "const searchData = $('Google_Places_Search').first().json;\nconst detailsData = $('Google_Places_Details').first().json;\nconst nearbyData = $('Google_Nearby_Competitors').first().json;\nconst webhookInput = $('Start_Webhook').first().json;\nconst userInput = webhookInput.body || webhookInput;\n\nconst business = {\n  name: detailsData.result?.name || searchData.results?.[0]?.name,\n  address: detailsData.result?.formatted_address || searchData.results?.[0]?.formatted_address,\n  types: detailsData.result?.types || [],\n  rating: detailsData.result?.rating,\n  total_reviews: detailsData.result?.user_ratings_total,\n  price_level: detailsData.result?.price_level,\n  website: detailsData.result?.website,\n  opening_hours: detailsData.result?.opening_hours?.weekday_text,\n  summary: detailsData.result?.editorial_summary?.overview,\n};\n\nconst reviews = (detailsData.result?.reviews || []).slice(0, 5).map((r) => ({\n  rating: r.rating,\n  text: r.text,\n  time: r.relative_time_description,\n}));\n\nconst competitors = (nearbyData.results || [])\n  .filter((c) => c.place_id !== searchData.results?.[0]?.place_id)\n  .slice(0, 8)\n  .map((c) => ({\n    name: c.name,\n    rating: c.rating,\n    total_reviews: c.user_ratings_total,\n    price_level: c.price_level,\n    types: c.types,\n  }));\n\nreturn [\n  {\n    json: {\n      user_id: userInput.user_id,\n      business_query: userInput.business_query,\n      business,\n      reviews,\n      competitors,\n      location: {\n        lat: searchData.results?.[0]?.geometry?.location?.lat,\n        lng: searchData.results?.[0]?.geometry?.location?.lng,\n      },\n      timestamp: new Date().toISOString(),\n    },\n  },\n];",
    };

    @node({
        name: 'Agent_A_Analysis',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [1264, 304],
    })
    AgentAAnalysis = {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'x-api-key',
                    value: "={{ $('Start_Webhook').item.json.body.anthropic_api_key || $('Start_Webhook').item.json.anthropic_api_key }}",
                },
                {
                    name: 'anthropic-version',
                    value: '2023-06-01',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: 'claude-sonnet-4-5-20250929', max_tokens: 2200, temperature: 0.7, system: '你是由 Publicis Conseil、Hungry Man、Nexus Studios、Blink Productions 创意总监组成的智囊团。基于输入数据完成：1) 地区竞争分析 2) 行业洞察 3) 产品价值提炼 4) 创意策略总结。输出必须是可解析 JSON，字段严格包含 business_summary, competition_analysis, industry_insight, value_proposition, creative_brief。', messages: [{ role: 'user', content: `# 待分析商家信息\\n商家名称: ${$json.business.name}\\n地址: ${$json.business.address}\\n类别: ${$json.business.types}\\n评分: ${$json.business.rating} (${ $json.business.total_reviews }条评价)\\n价格等级: ${$json.business.price_level}\\n网站: ${$json.business.website}\\n营业时间: ${$json.business.opening_hours}\\n官方简介: ${$json.business.summary}\\n\\n最新评论: ${JSON.stringify($json.reviews)}\\n\\n竞争对手: ${JSON.stringify($json.competitors)}\\n\\n请按规定 JSON 结构输出，只输出 JSON。` }] } }}",
        options: {},
    };

    @node({
        name: 'Return_Analysis',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1.1,
        position: [1456, 304],
    })
    ReturnAnalysis = {
        respondWith: 'json',
        responseBody:
            "={{ (() => { const raw = $json.content?.[0]?.text || $json.message?.content || '{}'; const cleaned = typeof raw === 'string' ? raw.replace(/^```(?:json)?\\s*/i, '').replace(/\\s*```$/, '').trim() : raw; let parsed = null; if (typeof cleaned === 'string') { try { parsed = JSON.parse(cleaned); } catch (error) { const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start !== -1 && end > start) { try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch (error2) {} } } } else { parsed = cleaned; } if (!parsed) { parsed = { raw_text: raw }; } return { status: 'success', stage: 'analysis_complete', user_id: $('Format_Business_Data').item.json.user_id, business_name: $('Format_Business_Data').item.json.business.name, analysis: parsed, next_step: { webhook_url: '/webhook/creative-ad/generate', required_fields: ['platform', 'format', 'output_type'] } }; })() }}",
        options: {},
    };

    @node({
        name: 'User_Selection_Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [256, 560],
    })
    UserSelectionWebhook = {
        httpMethod: 'POST',
        path: 'creative-ad/generate',
        responseMode: 'responseNode',
        options: {},
    };

    @node({
        name: 'Switch_Format',
        type: 'n8n-nodes-base.switch',
        version: 3,
        position: [464, 560],
    })
    SwitchFormat = {
        rules: {
            values: [
                {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: '',
                            typeValidation: 'strict',
                        },
                        conditions: [
                            {
                                leftValue: '={{ $json.body?.format || $json.format }}',
                                rightValue: 'text',
                                operator: {
                                    type: 'string',
                                    operation: 'equals',
                                },
                            },
                        ],
                        combinator: 'and',
                    },
                    renameOutput: true,
                    outputKey: 'text',
                },
                {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: '',
                            typeValidation: 'strict',
                        },
                        conditions: [
                            {
                                leftValue: '={{ $json.body?.format || $json.format }}',
                                rightValue: 'video',
                                operator: {
                                    type: 'string',
                                    operation: 'equals',
                                },
                            },
                        ],
                        combinator: 'and',
                    },
                    renameOutput: true,
                    outputKey: 'video',
                },
            ],
        },
        options: {
            fallbackOutput: 'none',
        },
    };

    @node({
        name: 'Switch_Text_Type',
        type: 'n8n-nodes-base.switch',
        version: 3,
        position: [656, 464],
    })
    SwitchTextType = {
        rules: {
            values: [
                {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: '',
                            typeValidation: 'strict',
                        },
                        conditions: [
                            {
                                leftValue:
                                    "={{ $('User_Selection_Webhook').item.json.body?.output_type || $json.body?.output_type || $json.output_type }}",
                                rightValue: 'copy',
                                operator: {
                                    type: 'string',
                                    operation: 'equals',
                                },
                            },
                        ],
                        combinator: 'and',
                    },
                    renameOutput: true,
                    outputKey: 'copy',
                },
                {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: '',
                            typeValidation: 'strict',
                        },
                        conditions: [
                            {
                                leftValue:
                                    "={{ $('User_Selection_Webhook').item.json.body?.output_type || $json.body?.output_type || $json.output_type }}",
                                rightValue: 'plan',
                                operator: {
                                    type: 'string',
                                    operation: 'equals',
                                },
                            },
                        ],
                        combinator: 'and',
                    },
                    renameOutput: true,
                    outputKey: 'plan',
                },
                {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: '',
                            typeValidation: 'strict',
                        },
                        conditions: [
                            {
                                leftValue:
                                    "={{ $('User_Selection_Webhook').item.json.body?.output_type || $json.body?.output_type || $json.output_type }}",
                                rightValue: 'poster',
                                operator: {
                                    type: 'string',
                                    operation: 'equals',
                                },
                            },
                        ],
                        combinator: 'and',
                    },
                    renameOutput: true,
                    outputKey: 'poster',
                },
            ],
        },
        options: {
            fallbackOutput: 'none',
        },
    };

    @node({
        name: 'Switch_Video_Type',
        type: 'n8n-nodes-base.switch',
        version: 3,
        position: [656, 656],
    })
    SwitchVideoType = {
        rules: {
            values: [
                {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: '',
                            typeValidation: 'strict',
                        },
                        conditions: [
                            {
                                leftValue:
                                    "={{ $('User_Selection_Webhook').item.json.body?.output_type || $json.body?.output_type || $json.output_type }}",
                                rightValue: 'capcut',
                                operator: {
                                    type: 'string',
                                    operation: 'equals',
                                },
                            },
                        ],
                        combinator: 'and',
                    },
                    renameOutput: true,
                    outputKey: 'capcut',
                },
                {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: '',
                            typeValidation: 'strict',
                        },
                        conditions: [
                            {
                                leftValue:
                                    "={{ $('User_Selection_Webhook').item.json.body?.output_type || $json.body?.output_type || $json.output_type }}",
                                rightValue: 'script',
                                operator: {
                                    type: 'string',
                                    operation: 'equals',
                                },
                            },
                        ],
                        combinator: 'and',
                    },
                    renameOutput: true,
                    outputKey: 'script',
                },
            ],
        },
        options: {
            fallbackOutput: 'none',
        },
    };

    @node({
        name: 'Analyze_Reference_Assets',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [656, 560],
    })
    AnalyzeReferenceAssets = {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'x-api-key',
                    value: "={{ $('User_Selection_Webhook').item.json.body?.anthropic_api_key || $json.body?.anthropic_api_key || $json.anthropic_api_key }}",
                },
                {
                    name: 'anthropic-version',
                    value: '2023-06-01',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: 'claude-sonnet-4-5-20250929', max_tokens: 1400, temperature: 0.2, system: '你是视频素材解析 Agent。请先对上传素材做结构化拆解，再输出用于 CapCut 脚本生成的分析结果。输出必须是 JSON，字段包含 material_overview, per_asset_insights, editing_constraints, story_direction，且不要输出 markdown。', messages: [{ role: 'user', content: `平台: ${$('User_Selection_Webhook').item.json.body?.platform || $json.body?.platform || $json.platform}\\n分析数据: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.analysis_data || $json.body?.analysis_data || $json.analysis_data)}\\n参考素材: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.reference_assets || $json.body?.reference_assets || $json.reference_assets || [])}\\n请先解析素材，再给出可直接用于后续脚本生成的 JSON。` }] } }}",
        options: {},
    };

    @node({
        name: 'Generate_Copy_Text',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [912, 352],
    })
    GenerateCopyText = {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'x-api-key',
                    value: "={{ $('User_Selection_Webhook').item.json.body?.anthropic_api_key || $json.body?.anthropic_api_key || $json.anthropic_api_key }}",
                },
                {
                    name: 'anthropic-version',
                    value: '2023-06-01',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: 'claude-sonnet-4-5-20250929', max_tokens: 1200, temperature: 0.8, system: '你是多平台社媒运营文案专家。请按平台特性生成可直接发布文案。输出结构必须包括 版本A(情感共鸣) / 版本B(产品种草) / 版本C(话题互动) 与发布建议。你必须严格使用用户指定语言输出：output_language=en 时仅英文；output_language=zh 时仅中文。', messages: [{ role: 'user', content: `平台: ${$json.body?.platform || $json.platform}\\n输出语言: ${((($('User_Selection_Webhook').item.json.body?.output_language || $json.body?.output_language || $json.output_language || 'zh') + '').toLowerCase() === 'en') ? 'English' : '中文'}\\n分析数据: ${JSON.stringify($json.body?.analysis_data || $json.analysis_data)}\\n请生成3个版本的可复制文案。` }] } }}",
        options: {},
    };

    @node({
        name: 'Generate_Plan_Text',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [912, 464],
    })
    GeneratePlanText = {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'x-api-key',
                    value: "={{ $('User_Selection_Webhook').item.json.body?.anthropic_api_key || $json.body?.anthropic_api_key || $json.anthropic_api_key }}",
                },
                {
                    name: 'anthropic-version',
                    value: '2023-06-01',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: 'claude-sonnet-4-5-20250929', max_tokens: 9000, temperature: 0.55, system: '你是资深社交媒体营销策略师。你必须输出可直接交付客户的完整方案，且不得截断。输出必须是可解析 JSON，不要 markdown。字段必须包含 executive_summary, strategy_focus, day_plan, operations, budget_and_boost, kpi_dashboard, optimization_rhythm。day_plan 必须是长度=30 的数组，严格覆盖 Day 1 到 Day 30，每天必须包含 day, weekday, content_type, title, objective, format, cta, assets, publish_time, kpi。任何字段都不能省略。你必须严格使用用户指定语言输出字段值：output_language=en 时仅英文；output_language=zh 时仅中文。', messages: [{ role: 'user', content: `平台: ${$json.body?.platform || $json.platform}\\n输出语言: ${((($('User_Selection_Webhook').item.json.body?.output_language || $json.body?.output_language || $json.output_language || 'zh') + '').toLowerCase() === 'en') ? 'English' : '中文'}\\n完整创意策略: ${JSON.stringify($json.body?.analysis_data || $json.analysis_data)}\\n请输出完整30天精准营销方案(JSON)，要求 Day1-Day30 全部输出，不得省略或截断。` }] } }}",
        options: {},
    };

    @node({
        name: 'Generate_Poster_Design',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [912, 528],
    })
    GeneratePosterDesign = {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'x-api-key',
                    value: "={{ $('User_Selection_Webhook').item.json.body?.anthropic_api_key || $json.body?.anthropic_api_key || $json.anthropic_api_key }}",
                },
                {
                    name: 'anthropic-version',
                    value: '2023-06-01',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: 'claude-sonnet-4-5-20250929', max_tokens: 4200, temperature: 0.55, system: '你是麦肯锡市场营销专家和世界顶级营销海报设计专家。你擅长根据商家定位和所在区域真实市场情况设计高转化海报。设计底层必须面向 Google AI 图像生成执行，输出必须是可解析 JSON。若 design_requirements_only=true 且有 design_requirements，则仅根据用户设计要求+素材设计；若有 design_requirements 但 design_requirements_only=false，则结合 Stage1/2 创意策略 + 用户要求 + 素材设计；若无 design_requirements，则使用 Stage1/2 创意策略 + 素材设计。若 poster_refine_request 有值，必须把它作为本次迭代优化约束并体现到视觉方向、文案与CTA。输出字段必须包含: poster_title, strategy_summary, visual_direction, layout_plan, copy_plan, cta_plan, poster_prompt。', messages: [{ role: 'user', content: `平台: ${$('User_Selection_Webhook').item.json.body?.platform || $json.body?.platform || $json.platform}\\n是否只根据用户设计要求: ${$('User_Selection_Webhook').item.json.body?.design_requirements_only || $json.body?.design_requirements_only || $json.design_requirements_only || false}\\n用户设计要求: ${$('User_Selection_Webhook').item.json.body?.design_requirements || $json.body?.design_requirements || $json.design_requirements || '未提供'}\\n微调需求: ${$('User_Selection_Webhook').item.json.body?.poster_refine_request || $json.body?.poster_refine_request || $json.poster_refine_request || '未提供'}\\n创意策略: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.analysis_data || $json.body?.analysis_data || $json.analysis_data)}\\n素材列表: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.reference_assets || $json.body?.reference_assets || $json.reference_assets || [])}\\n请生成高质量营销海报设计方案，并给出可直接用于 Google AI 出图的 poster_prompt（1080x1350竖版）。` }] } }}",
        options: {},
    };

    @node({
        name: 'Generate_Capcut_Script',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [912, 608],
    })
    GenerateCapcutScript = {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'x-api-key',
                    value: "={{ $('User_Selection_Webhook').item.json.body?.anthropic_api_key || $json.body?.anthropic_api_key || $json.anthropic_api_key }}",
                },
                {
                    name: 'anthropic-version',
                    value: '2023-06-01',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: 'claude-sonnet-4-5-20250929', max_tokens: 3200, temperature: 0.65, system: '你是短视频导演和 CapCut 剪辑专家。你必须基于已上传素材输出脚本，不能虚构素材中不存在的镜头。如果收到自定义提示词(custom_prompt)，要优先按自定义提示词执行，并将其落实到镜头节奏、画面重点和字幕表达中。必须严格遵守用户指定的CapCut目标时长(仅15/20/30秒)，时间线总时长必须与目标时长完全一致。输出结构必须包含：1) 素材解析摘要 2) CapCut 时间线脚本(秒级) 3) 镜头与素材编号映射 4) 字幕/转场/BGM/音效 5) 最终导出设置 6) Seedance适配版(4/8/12秒分镜摘要，严格按镜头顺序，并说明从CapCut时长压缩映射方法)。', messages: [{ role: 'user', content: `平台: ${$('User_Selection_Webhook').item.json.body?.platform || $json.body?.platform || $json.platform}\\nCapCut目标时长(秒): ${$('User_Selection_Webhook').item.json.body?.capcut_target_duration_seconds || $json.body?.capcut_target_duration_seconds || $json.capcut_target_duration_seconds || 15}\\n是否启用自定义提示词: ${$('User_Selection_Webhook').item.json.body?.use_custom_prompt || $json.body?.use_custom_prompt || $json.use_custom_prompt || false}\\n自定义提示词: ${$('User_Selection_Webhook').item.json.body?.custom_prompt || $json.body?.custom_prompt || $json.custom_prompt || '未提供'}\\n创意策略: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.analysis_data || $json.body?.analysis_data || $json.analysis_data)}\\n素材列表: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.reference_assets || $json.body?.reference_assets || $json.reference_assets || [])}\\n素材解析结果: ${$('Analyze_Reference_Assets').item.json.content?.[0]?.text || ''}\\n请输出可直接在 CapCut 复制执行的高质量脚本。要求：1) 若启用自定义提示词且不为空，自定义提示词优先于创意策略；2) 时间线总时长必须严格等于目标时长(15/20/30之一)；3) 每个镜头给出起止时间与时长，所有镜头时长求和必须等于目标时长；4) 必须附上可直接用于自动视频生成的Seedance适配分镜摘要(4/8/12秒，保持镜头顺序)。` }] } }}",
        options: {},
    };

    @node({
        name: 'Generate_Creative_Scripts',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [912, 704],
    })
    GenerateCreativeScripts = {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'x-api-key',
                    value: "={{ $('User_Selection_Webhook').item.json.body?.anthropic_api_key || $json.body?.anthropic_api_key || $json.anthropic_api_key }}",
                },
                {
                    name: 'anthropic-version',
                    value: '2023-06-01',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ { model: 'claude-sonnet-4-5-20250929', max_tokens: 4200, temperature: 0.75, system: '你是视频创意导演。请基于素材解析结果输出可执行的短视频创意脚本，且每个镜头必须绑定素材编号。', messages: [{ role: 'user', content: `平台: ${$('User_Selection_Webhook').item.json.body?.platform || $json.body?.platform || $json.platform}\\n完整创意策略: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.analysis_data || $json.body?.analysis_data || $json.analysis_data)}\\n素材列表: ${JSON.stringify($('User_Selection_Webhook').item.json.body?.reference_assets || $json.body?.reference_assets || $json.reference_assets || [])}\\n素材解析结果: ${$('Analyze_Reference_Assets').item.json.content?.[0]?.text || ''}\\n请输出3个可执行短视频剧本。` }] } }}",
        options: {},
    };

    @node({
        name: 'Return_Final_Content',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1.1,
        position: [1152, 560],
    })
    ReturnFinalContent = {
        respondWith: 'json',
        responseBody:
            "={{ { status: 'success', stage: 'content_generated', user_id: ($json.user_id || $json.body?.user_id || $('User_Selection_Webhook').item.json.body?.user_id || $('User_Selection_Webhook').item.json.user_id), platform: ($json.platform || $json.body?.platform || $('User_Selection_Webhook').item.json.body?.platform || $('User_Selection_Webhook').item.json.platform), format: ($json.format || $json.body?.format || $('User_Selection_Webhook').item.json.body?.format || $('User_Selection_Webhook').item.json.format), output_type: ($json.output_type || $json.body?.output_type || $('User_Selection_Webhook').item.json.body?.output_type || $('User_Selection_Webhook').item.json.output_type), output_language: ($json.output_language || $json.body?.output_language || $('User_Selection_Webhook').item.json.body?.output_language || $('User_Selection_Webhook').item.json.output_language || 'zh'), content: ($json.content?.[0]?.text || $json.message?.content || $json.generated_content || $json.content), generated_at: new Date().toISOString() } }}",
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.StartWebhook.out(0).to(this.GooglePlacesSearch.in(0));
        this.GooglePlacesSearch.out(0).to(this.GooglePlacesDetails.in(0));
        this.GooglePlacesDetails.out(0).to(this.GoogleNearbyCompetitors.in(0));
        this.GoogleNearbyCompetitors.out(0).to(this.FormatBusinessData.in(0));
        this.FormatBusinessData.out(0).to(this.AgentAAnalysis.in(0));
        this.AgentAAnalysis.out(0).to(this.ReturnAnalysis.in(0));
        this.UserSelectionWebhook.out(0).to(this.SwitchFormat.in(0));
        this.SwitchFormat.out(0).to(this.SwitchTextType.in(0));
        this.SwitchFormat.out(1).to(this.AnalyzeReferenceAssets.in(0));
        this.AnalyzeReferenceAssets.out(0).to(this.SwitchVideoType.in(0));
        this.SwitchTextType.out(0).to(this.GenerateCopyText.in(0));
        this.SwitchTextType.out(1).to(this.GeneratePlanText.in(0));
        this.SwitchTextType.out(2).to(this.GeneratePosterDesign.in(0));
        this.SwitchVideoType.out(0).to(this.GenerateCapcutScript.in(0));
        this.SwitchVideoType.out(1).to(this.GenerateCreativeScripts.in(0));
        this.GenerateCopyText.out(0).to(this.ReturnFinalContent.in(0));
        this.GeneratePlanText.out(0).to(this.ReturnFinalContent.in(0));
        this.GeneratePosterDesign.out(0).to(this.ReturnFinalContent.in(0));
        this.GenerateCapcutScript.out(0).to(this.ReturnFinalContent.in(0));
        this.GenerateCreativeScripts.out(0).to(this.ReturnFinalContent.in(0));
    }
}
