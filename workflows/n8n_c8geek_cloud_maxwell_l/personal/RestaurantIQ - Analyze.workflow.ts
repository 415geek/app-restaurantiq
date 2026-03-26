import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : RestaurantIQ - Analyze
// Nodes   : 6  |  Connections: 5
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Webhook                            webhook
// Validateprompt                     code
// Openai                             httpRequest
// Parsejson                          code
// Respond                            respondToWebhook
// Gathermarketdata                   code
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Webhook
//    → Validateprompt
//      → Gathermarketdata
//        → Openai
//          → Parsejson
//            → Respond
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'a8d59350c9884d63',
    name: 'RestaurantIQ - Analyze',
    active: true,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
})
export class RestaurantiqAnalyzeWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [272, 304],
    })
    Webhook = {
        httpMethod: 'POST',
        path: 'iq-analyze',
        responseMode: 'responseNode',
        options: {
            rawBody: false,
        },
    };

    @node({
        name: 'Validate+Prompt',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [480, 304],
    })
    Validateprompt = {
        mode: 'runOnceForEachItem',
        jsCode: "const expected = $env.N8N_IQ_WEBHOOK_SECRET || '';\nconst headers = $json.headers || {};\nconst auth = headers.authorization || headers.Authorization || '';\n\nif (expected && auth !== ('Bearer ' + expected)) {\n  throw new Error('Unauthorized');\n}\n\nconst body = $json.body || {};\nconst address = String(body.address || '').trim();\nconst industry = String(body.industry || 'restaurant').trim();\nconst cuisine_type = body.cuisine_type ? String(body.cuisine_type).trim() : '';\nconst language = String(body.language || 'en').toLowerCase() === 'zh' ? 'zh' : 'en';\n\nif (!address) throw new Error('Missing address');\n\nconst system = language === 'zh'\n  ? [\n      '你是一名顶级餐饮投资分析师，同时也是一个极强转化能力的商业顾问。',\n      '你的目标不是给出完整分析，而是让用户意识到：如果不看完整报告就做决策，可能会犯代价高昂的错误。',\n      '你必须制造“表面机会 + 隐藏风险”的张力。',\n      '你的语气必须专业、克制、像真正做过选址和投资判断的人。',\n      '禁止空泛表达，例如：“客流量大”、“前景不错”、“需求旺盛”、“很有潜力”。',\n      '禁止写成营销文案，禁止写成自嗨式夸赞，禁止写成泛泛而谈的AI总结。',\n      '不要编造不可验证的精确数字；可以使用定性或半结构化表述，例如：High / Medium / Low，或“竞争密度偏高”。',\n      '免费版内容不能把价值讲完，必须保留关键判断给付费版。',\n      '严格输出 JSON，不允许输出任何额外文字、解释或 Markdown。'\n    ].join(' ')\n  : [\n      'You are a top-tier restaurant investment analyst and a conversion-focused business advisor.',\n      'Your goal is NOT to provide a full analysis.',\n      'Your goal is to make the user feel that making a decision without the full report is financially risky.',\n      'You must create tension between visible opportunity and hidden downside.',\n      'Your tone must sound like a real investor/operator, not a generic AI assistant.',\n      'Do NOT use fluffy phrases such as \"great location\", \"strong demand\", \"good potential\", or \"high foot traffic\" without context.',\n      'Do NOT write marketing copy.',\n      'Do NOT invent unverifiable exact figures.',\n      'You may use directional language such as High / Medium / Low or phrases like \"competition density is elevated\".',\n      'The free output must not give away the full value. It must preserve the most decision-critical insight for the paid report.',\n      'Output STRICT JSON only. No extra text, no markdown.'\n    ].join(' ');\n\nconst user = language === 'zh'\n  ? [\n      '请基于以下输入，生成“高转化免费版初判”。',\n      `地址: ${address}`,\n      `业态: ${industry}`,\n      cuisine_type ? `菜系/类型: ${cuisine_type}` : '',\n      '',\n      '你的任务不是把市场讲清楚，而是让用户意识到：这个点位“看起来可能有机会”，但如果忽略隐藏风险，可能会亏钱。',\n      '',\n      '输出目标：',\n      '1) 让用户觉得这个位置不是一眼能判断的。',\n      '2) 让用户感到：如果不看完整版就贸然决策，会有代价。',\n      '3) 让用户愿意花 $19 解锁完整报告。',\n      '',\n      '字段要求：',\n      'headline:',\n      '- 必须体现“机会 vs 风险”的张力',\n      '- 必须像投资判断，而不是广告标题',\n      '- 不能只是正面夸赞',\n      '',\n      'subheadline:',\n      '- 1句话',\n      '- 解释为什么这个位置乍看有吸引力',\n      '- 但不能把核心结论讲完',\n      '',\n      'market_snapshot:',\n      '- 3条短句',\n      '- 每条都要有“专业判断感”',\n      '- 优先覆盖：竞争密度、需求时段、顾客预期/价格带/饱和度',\n      '- 可以使用 High / Medium / Low',\n      '- 禁止空话',\n      '',\n      'hidden_risk:',\n      '- 只写一个最关键风险',\n      '- 必须与利润、复购、生存空间、差异化或折扣战有关',\n      '- 必须让人感觉“忽略它会很贵”',\n      '',\n      'paywall_teaser:',\n      '- 这是最重要的一句',\n      '- 必须把用户往付费版推',\n      '- 不能直接重复风险',\n      '- 要暗示：真正决定能不能开的，不是表面需求，而是更深层的结构性问题',\n      '',\n      'verdict:',\n      '- 只能是 \"go\" | \"caution\" | \"no\"',\n      '- 如果信息不足但存在明显不确定性，优先用 \"caution\"',\n      '',\n      '严格输出以下 JSON 结构：',\n      '{',\n      '  \"verdict\": \"go|caution|no\",',\n      '  \"headline\": \"...\",',\n      '  \"subheadline\": \"...\",',\n      '  \"market_snapshot\": [\"...\", \"...\", \"...\"],',\n      '  \"hidden_risk\": \"...\",',\n      '  \"paywall_teaser\": \"...\"',\n      '}',\n      '',\n      '额外要求：',\n      '- 不要输出 reason 字段',\n      '- 不要写得太长',\n      '- 不要给完整解决方案',\n      '- 免费版的作用是制造高质量的不确定性，而不是完成分析'\n    ].filter(Boolean).join('\\n')\n  : [\n      'Based on the input below, generate a high-conversion free preliminary decision.',\n      `Address: ${address}`,\n      `Industry: ${industry}`,\n      cuisine_type ? `Cuisine/type: ${cuisine_type}` : '',\n      '',\n      'Your job is NOT to fully explain the market.',\n      'Your job is to make the user feel that this location may have upside at first glance, but making a decision without the full report could be expensive.',\n      '',\n      'Output goals:',\n      '1) Make the user feel this is NOT obvious.',\n      '2) Create decision tension: visible opportunity vs hidden downside.',\n      '3) Make the user willing to pay $19 for the full report.',\n      '',\n      'Field requirements:',\n      'headline:',\n      '- Must contain tension between opportunity and risk',\n      '- Must sound like an investor/operator judgment',\n      '- Must NOT be generic praise',\n      '',\n      'subheadline:',\n      '- One sentence only',\n      '- Explain why the location looks attractive at first glance',\n      '- Do NOT reveal the full conclusion',\n      '',\n      'market_snapshot:',\n      '- Exactly 3 concise bullets',\n      '- Must sound specific and professional',\n      '- Prefer: competition density, demand timing, customer expectations / price band / saturation',\n      '- High / Medium / Low is acceptable',\n      '- No fluff',\n      '',\n      'hidden_risk:',\n      '- One key risk only',\n      '- Must relate to margins, repeat business, survival odds, differentiation, or discount pressure',\n      '- Must feel costly if ignored',\n      '',\n      'paywall_teaser:',\n      '- Most important line',\n      '- Must increase curiosity and payment intent',\n      '- Do NOT simply repeat the risk',\n      '- Must imply that the real decision depends on a deeper structural issue not yet revealed',\n      '',\n      'verdict:',\n      '- Must be one of \"go\" | \"caution\" | \"no\"',\n      '- If there is uncertainty with meaningful downside, prefer \"caution\"',\n      '',\n      'Return STRICT JSON only in this exact shape:',\n      '{',\n      '  \"verdict\": \"go|caution|no\",',\n      '  \"headline\": \"...\",',\n      '  \"subheadline\": \"...\",',\n      '  \"market_snapshot\": [\"...\", \"...\", \"...\"],',\n      '  \"hidden_risk\": \"...\",',\n      '  \"paywall_teaser\": \"...\"',\n      '}',\n      '',\n      'Additional rules:',\n      '- Do not output a \"reason\" field',\n      '- Keep it concise',\n      '- Do not provide the full solution',\n      '- The free version should create high-quality uncertainty, not complete the analysis'\n    ].filter(Boolean).join('\\n');\n\nreturn [{\n  json: {\n    system,\n    user,\n    address,\n    industry,\n    cuisine_type,\n    language\n  }\n}];",
    };

    @node({
        name: 'OpenAI',
        type: 'n8n-nodes-base.httpRequest',
        version: 4,
        position: [720, 304],
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
            "={{ { model: 'gpt-4o-mini', temperature: 0.4, messages: [ { role: 'system', content: $json.system }, { role: 'user', content: $json.user } ] } }}",
        options: {},
    };

    @node({
        name: 'ParseJSON',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [960, 304],
    })
    Parsejson = {
        mode: 'runOnceForEachItem',
        jsCode: "const raw = $json;\nconst choice = raw.choices && raw.choices[0];\nconst content = choice && choice.message && choice.message.content ? String(choice.message.content) : '';\n\nlet parsed;\ntry {\n  parsed = JSON.parse(content);\n} catch {\n  throw new Error('Model did not return valid JSON');\n}\n\nconst verdict = String(parsed.verdict || '').trim();\nconst headline = String(parsed.headline || '').trim();\nconst marketSnapshot = Array.isArray(parsed.market_snapshot)\n  ? parsed.market_snapshot.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)\n  : [];\nconst risk = String(parsed.risk || '').trim();\nlet reason = String(parsed.reason || '').trim();\n\nif (!reason) {\n  const pieces = [];\n  if (marketSnapshot.length) pieces.push(marketSnapshot.slice(0, 2).join(' '));\n  if (risk) pieces.push('Biggest risk: ' + risk);\n  reason = pieces.join(' ');\n}\n\nif (!verdict || !headline || !reason) throw new Error('Missing fields in model JSON');\n\nreturn [{\n  json: {\n    analysis_id: $execution.id,\n    verdict,\n    headline,\n    reason,\n    market_snapshot: marketSnapshot,\n    risk,\n  }\n}];",
    };

    @node({
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1,
        position: [1200, 304],
    })
    Respond = {
        respondWith: 'json',
        responseBody:
            '={{ { "analysis_id": $json.analysis_id, "verdict": $json.verdict, "headline": $json.headline, "reason": $json.reason, "market_snapshot": $json.market_snapshot, "risk": $json.risk } }}',
        options: {
            responseCode: 200,
        },
    };

    @node({
        name: 'GatherMarketData',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [640, 464],
    })
    Gathermarketdata = {
        mode: 'runOnceForEachItem',
        jsCode: "const input = $json;\nconst address = String(input.address || '').trim();\nconst cuisine = String(input.cuisine_type || '').trim();\nconst industry = String(input.industry || 'restaurant').trim();\n\nconst googleKey = String($env.GOOGLE_MAPS_API_KEY || '').trim();\nconst yelpKey = String($env.YELP_API_KEY || $env.YELP_FUSION_API_KEY || '').trim();\n\nasync function getJson(url, options = {}, timeoutMs = 12000) {\n  try {\n    const res = await fetch(url, { ...options });\n    const text = await res.text();\n    if (!res.ok) return { _error: `HTTP ${res.status}`, _text: text.slice(0, 500) };\n    try { return JSON.parse(text); } catch { return { _error: 'NON_JSON', _text: text.slice(0, 500) }; }\n  } catch (e) {\n    return { _error: String(e && e.message ? e.message : e) };\n  }\n}\n\nfunction num(v, d = 0) {\n  const n = Number(v);\n  return Number.isFinite(n) ? n : d;\n}\n\nfunction avg(arr) {\n  if (!arr.length) return null;\n  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;\n}\n\nfunction dist(arr) {\n  const m = {};\n  for (const v of arr) {\n    const k = String(v ?? 'unknown');\n    m[k] = (m[k] || 0) + 1;\n  }\n  return m;\n}\n\nconst google = {\n  enabled: Boolean(googleKey),\n  textsearch: null,\n  details: [],\n};\n\nif (googleKey) {\n  const q = encodeURIComponent(cuisine ? `${cuisine} ${industry} near ${address}` : `${industry} near ${address}`);\n  const textUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&type=restaurant&key=${googleKey}`;\n  const text = await getJson(textUrl);\n  google.textsearch = text;\n\n  const results = Array.isArray(text.results) ? text.results.slice(0, 12) : [];\n  for (const r of results) {\n    const pid = r.place_id;\n    if (!pid) continue;\n    const fields = [\n      'place_id','name','formatted_address','geometry','business_status','types','rating','user_ratings_total','price_level',\n      'opening_hours','current_opening_hours','website','formatted_phone_number','international_phone_number','reviews',\n      'delivery','dine_in','takeout','serves_beer','serves_wine','serves_breakfast','serves_lunch','serves_dinner','serves_vegetarian_food','wheelchair_accessible_entrance'\n    ].join(',');\n    const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(pid)}&fields=${encodeURIComponent(fields)}&reviews_no_translations=true&reviews_sort=newest&key=${googleKey}`;\n    const d = await getJson(dUrl);\n    google.details.push(d);\n  }\n}\n\nconst yelp = {\n  enabled: Boolean(yelpKey),\n  search: null,\n  details: [],\n  reviews: [],\n};\n\nif (yelpKey) {\n  const term = encodeURIComponent(cuisine ? `${cuisine} ${industry}` : industry);\n  const loc = encodeURIComponent(address);\n  const sUrl = `https://api.yelp.com/v3/businesses/search?term=${term}&location=${loc}&categories=restaurants&limit=20&sort_by=best_match`;\n  const headers = { Authorization: `Bearer ${yelpKey}` };\n  const s = await getJson(sUrl, { headers });\n  yelp.search = s;\n\n  const businesses = Array.isArray(s.businesses) ? s.businesses.slice(0, 10) : [];\n  for (const b of businesses) {\n    if (!b.id) continue;\n    const d = await getJson(`https://api.yelp.com/v3/businesses/${encodeURIComponent(b.id)}`, { headers });\n    yelp.details.push(d);\n    const rv = await getJson(`https://api.yelp.com/v3/businesses/${encodeURIComponent(b.id)}/reviews?limit=3&sort_by=yelp_sort`, { headers });\n    yelp.reviews.push({ id: b.id, reviews: rv.reviews || [], total: rv.total || null });\n  }\n}\n\nconst gRows = Array.isArray(google.textsearch && google.textsearch.results) ? google.textsearch.results : [];\nconst yRows = Array.isArray(yelp.search && yelp.search.businesses) ? yelp.search.businesses : [];\n\nconst summary = {\n  competitor_count_google: gRows.length,\n  competitor_count_yelp: yRows.length,\n  avg_rating_google: avg(gRows.map((x) => num(x.rating, NaN)).filter((x) => Number.isFinite(x))),\n  avg_rating_yelp: avg(yRows.map((x) => num(x.rating, NaN)).filter((x) => Number.isFinite(x))),\n  avg_review_count_google: avg(gRows.map((x) => num(x.user_ratings_total, NaN)).filter((x) => Number.isFinite(x))),\n  avg_review_count_yelp: avg(yRows.map((x) => num(x.review_count, NaN)).filter((x) => Number.isFinite(x))),\n  google_price_level_dist: dist(gRows.map((x) => x.price_level ?? 'unknown')),\n  yelp_price_dist: dist(yRows.map((x) => x.price ?? 'unknown')),\n  top_google_types: Object.entries(dist(gRows.flatMap((x) => Array.isArray(x.types) ? x.types.slice(0, 3) : []))).sort((a,b)=>b[1]-a[1]).slice(0,8),\n  top_yelp_categories: Object.entries(dist(yRows.flatMap((x) => Array.isArray(x.categories) ? x.categories.map((c)=>c.title || c.alias).filter(Boolean) : []))).sort((a,b)=>b[1]-a[1]).slice(0,8),\n  sample_competitors_google: gRows.slice(0, 8).map((x) => ({ name: x.name, rating: x.rating, reviews: x.user_ratings_total, price_level: x.price_level, address: x.formatted_address })),\n  sample_competitors_yelp: yRows.slice(0, 8).map((x) => ({ name: x.name, rating: x.rating, reviews: x.review_count, price: x.price, is_closed: x.is_closed, categories: x.categories })),\n};\n\nconst dataPack = {\n  source: 'google_places + yelp_fusion',\n  fetched_at: new Date().toISOString(),\n  address,\n  cuisine,\n  summary,\n  google_raw: {\n    textsearch: google.textsearch,\n    details: google.details,\n  },\n  yelp_raw: {\n    search: yelp.search,\n    details: yelp.details,\n    reviews: yelp.reviews,\n  },\n};\n\nconst summaryText = [\n  `Google competitors: ${summary.competitor_count_google}`,\n  `Yelp competitors: ${summary.competitor_count_yelp}`,\n  `Google avg rating: ${summary.avg_rating_google ?? 'n/a'} | Yelp avg rating: ${summary.avg_rating_yelp ?? 'n/a'}`,\n  `Google avg reviews: ${summary.avg_review_count_google ?? 'n/a'} | Yelp avg reviews: ${summary.avg_review_count_yelp ?? 'n/a'}`,\n  `Google price dist: ${JSON.stringify(summary.google_price_level_dist)}`,\n  `Yelp price dist: ${JSON.stringify(summary.yelp_price_dist)}`,\n].join('\\n');\n\nconst raw = JSON.stringify(dataPack);\nconst clipped = raw.length > 22000 ? raw.slice(0, 22000) + ' ...[truncated]' : raw;\n\nconst augmentedUser = `${input.user}\\n\\nExternal multi-source data (Google Places + Yelp) is attached below. Use it as primary evidence and avoid vague statements.\\n\\nMarket data summary:\\n${summaryText}\\n\\nRaw external data JSON:\\n${clipped}`;\n\nreturn [{\n  json: {\n    ...input,\n    user: augmentedUser,\n    external_data: dataPack,\n  }\n}];",
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.Validateprompt.in(0));
        this.Validateprompt.out(0).to(this.Gathermarketdata.in(0));
        this.Openai.out(0).to(this.Parsejson.in(0));
        this.Parsejson.out(0).to(this.Respond.in(0));
        this.Gathermarketdata.out(0).to(this.Openai.in(0));
    }
}
