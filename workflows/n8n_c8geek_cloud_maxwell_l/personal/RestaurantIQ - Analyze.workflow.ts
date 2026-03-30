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
    settings: {
        executionOrder: 'v1',
        binaryMode: 'separate',
        availableInMCP: false,
        callerPolicy: 'workflowsFromSameOwner',
    },
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
        jsCode: "const expected = String($env.N8N_IQ_WEBHOOK_SECRET || $env.N8N_INTERNAL_AUTH_TOKEN || '').trim();\nlet root = $json;\ntry {\n  root = $('Webhook').first().json;\n} catch {\n  /* fallback when Webhook item shape differs */\n}\nconst headers = root.headers || {};\nconst auth = String(\n  headers.authorization || headers.Authorization || headers['x-authorization'] || ''\n).trim();\nconst want = expected ? 'Bearer ' + expected : '';\nif (expected && auth !== want) {\n  throw new Error('Unauthorized');\n}\n\nconst body = root.body || {};\nconst address = String(body.address || body.location || '').trim();\nconst industry = String(body.industry || 'restaurant').trim();\nconst cuisine_type = body.cuisine_type ? String(body.cuisine_type).trim() : '';\nconst language = String(body.language || 'en').toLowerCase() === 'zh' ? 'zh' : 'en';\n\nif (!address) throw new Error('Missing address');\n\nconst system = language === 'zh'\n  ? [\n      '你是 LocationIQ 选址大师的分析引擎。角色：拥有约15年经验的商业地产与餐饮选址顾问。',\n      '你必须按 V2.0 框架在脑中完成「5维加权评分卡」再输出：客流潜力25%、人群匹配20%、竞争压力20%、可达性20%、租金性价比15%；综合分0–100。',\n      '等级：80–100🟢强烈推荐；60–79🟡值得考虑；40–59🟠谨慎评估；0–39🔴不建议。',\n      '数据意识：可依据 Google Maps/Places、Census/ACS、Yelp、Walk Score、Google Trends 等公开数据类型表述；若无可靠数据，禁止编造精确数字，须写「根据该区域典型水平估算」并标注[估算]。',\n      '每条判断须可追溯：先事实或[估算]→再对开店的影响→再给一条可执行建议（在 market_snapshot 三句中体现）。',\n      '语气：资深顾问向老板汇报，专业、克制，不要论文腔与营销空话。',\n      '免费版目标：约30秒内呈现冲击力结论 + 3条关键洞察 + 强付费升级钩子；勿把付费版深度一次性讲完。',\n      'verdict 仅允许小写：go | caution | no（对应 GO / CAUTION / NO-GO）。',\n      '严格输出 JSON，不要 Markdown、不要额外说明文字。',\n    ].join(' ')\n  : [\n      'You are the LocationIQ site-selection analysis engine: a senior commercial real estate advisor for restaurant operators.',\n      'Internally apply the V2.0 weighted scorecard (0–100 each, then composite): foot traffic potential 25%, demographic fit 20%, competitive pressure 20%, accessibility 20%, rent value 15%.',\n      'Tiers: 80–100 strong green; 60–79 yellow proceed-with-eyes-open; 40–59 orange high caution; 0–39 red avoid unless special advantage.',\n      'Data hygiene: you may reference typical public data sources (Google Places, Census/ACS, Yelp, Walk Score, Google Trends). Never invent exact figures; use directional language or label assumptions [estimate].',\n      'Each insight should flow: fact or [estimate] → impact on opening decision → one actionable suggestion.',\n      'Tone: partner-level memo, not marketing fluff or academic essay.',\n      'Free tier: punchy conclusion + three insights + strong upgrade hook; do not deliver the full paid report.',\n      'verdict must be lowercase only: go | caution | no.',\n      'Output STRICT JSON only, no markdown, no prose outside JSON.',\n    ].join(' ');\n\nconst user = language === 'zh'\n  ? [\n      '请基于以下输入生成「免费版选址速评」（LocationIQ V2.0）。',\n      `地址: ${address}`,\n      `业态: ${industry}${cuisine_type ? '（' + cuisine_type + '）' : ''}`,\n      '',\n      '先在脑中完成5维0–100评分与综合分，再压缩进下列 JSON 字段（不要单独输出 Markdown 表格）：',\n      '',\n      'headline：一行内包含「综合约XX/100 + 等级emoji（🟢/🟡/🟠/🔴）+ 机会vs风险张力」，像投资判断标题。',\n      'subheadline：一句话概括评分卡最关键依据，勿泄露付费版才应给的细节。',\n      'market_snapshot：恰好3条字符串；每条对应「关键发现」：以可核查事实或[估算]起句 → 对投资决策的影响 → 一句可执行建议；禁止空洞套话。',\n      'hidden_risk：一条最高优先级风险，须关联利润/复购/生存/差异化/价格战等，并让人感知忽略成本。',\n      'paywall_teaser：一句强钩子，指向付费版：完整竞对清单与威胁矩阵、三场景营收模型、风险概率-影响矩阵与对冲、90天路线图含KPI与预算、可比成功/失败案例等；勿重复 hidden_risk。',\n      'verdict：go | caution | no；信息不足且下行风险显著时用 caution。',\n      '',\n      '严格输出 JSON：',\n      '{',\n      '  \"verdict\": \"go|caution|no\",',\n      '  \"headline\": \"...\",',\n      '  \"subheadline\": \"...\",',\n      '  \"market_snapshot\": [\"...\", \"...\", \"...\"],',\n      '  \"hidden_risk\": \"...\",',\n      '  \"paywall_teaser\": \"...\"',\n      '}',\n      '',\n      '不要输出 reason 字段；控制篇幅；不提供完整解决方案。',\n    ].filter(Boolean).join('\\n')\n  : [\n      'Generate the FREE LocationIQ V2.0 site quick assessment from the inputs below.',\n      `Address: ${address}`,\n      `Business type: ${industry}${cuisine_type ? ' (' + cuisine_type + ')' : ''}`,\n      '',\n      'After scoring internally, compress into JSON fields (no separate markdown tables):',\n      '',\n      'headline: one line with approximate composite score /100, tier label, and opportunity-vs-risk tension.',\n      'subheadline: one sentence with the strongest evidence summary; withhold paid-only depth.',\n      'market_snapshot: exactly 3 strings; each is a key finding: lead with fact or [estimate] → impact → one actionable suggestion.',\n      'hidden_risk: single top risk tied to margins, repeat visits, survival, differentiation, or discount wars; must feel costly to ignore.',\n      'paywall_teaser: one line teasing paid report: competitor matrix, three-scenario revenue model, risk probability-impact matrix with mitigations, 90-day plan with KPIs/budget, comparable success/failure cases; do not repeat hidden_risk.',\n      'verdict: go | caution | no; use caution when uncertainty with meaningful downside.',\n      '',\n      'Return STRICT JSON:',\n      '{',\n      '  \"verdict\": \"go|caution|no\",',\n      '  \"headline\": \"...\",',\n      '  \"subheadline\": \"...\",',\n      '  \"market_snapshot\": [\"...\", \"...\", \"...\"],',\n      '  \"hidden_risk\": \"...\",',\n      '  \"paywall_teaser\": \"...\"',\n      '}',\n      '',\n      'Do not output a reason field; stay concise; do not provide the full solution.',\n    ].filter(Boolean).join('\\n');\n\nreturn [{\n  json: {\n    system,\n    user,\n    address,\n    industry,\n    cuisine_type,\n    language\n  }\n}];",
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
            "={{ { model: 'gpt-4o-mini', temperature: 0.4, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: $json.system }, { role: 'user', content: $json.user } ] } }}",
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
        jsCode: "const raw = $json;\nconst choice = raw.choices && raw.choices[0];\nconst content = choice && choice.message && choice.message.content ? String(choice.message.content) : '';\n\nlet parsed;\ntry {\n  parsed = JSON.parse(content);\n} catch {\n  throw new Error('Model did not return valid JSON');\n}\n\nconst verdict = String(parsed.verdict || '').trim();\nconst headline = String(parsed.headline || '').trim();\nconst subheadline = String(parsed.subheadline || '').trim();\nconst marketSnapshot = Array.isArray(parsed.market_snapshot)\n  ? parsed.market_snapshot.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)\n  : [];\nconst hiddenRisk = String(parsed.hidden_risk || '').trim();\nconst paywallTeaser = String(parsed.paywall_teaser || '').trim();\n\nif (!verdict || !headline) throw new Error('Missing required fields in model JSON');\n\nlet market_data = null;\ntry {\n  const gm = $('GatherMarketData').first().json;\n  if (gm && gm.external_data) market_data = gm.external_data;\n} catch (e) {\n  market_data = null;\n}\n\nreturn [{\n  json: {\n    analysis_id: $execution.id,\n    verdict,\n    headline,\n    subheadline,\n    market_snapshot: marketSnapshot,\n    hidden_risk: hiddenRisk,\n    paywall_teaser: paywallTeaser,\n    market_data,\n  }\n}];",
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
            '={{ { "analysis_id": $json.analysis_id, "verdict": $json.verdict, "headline": $json.headline, "subheadline": $json.subheadline, "market_snapshot": $json.market_snapshot, "hidden_risk": $json.hidden_risk, "paywall_teaser": $json.paywall_teaser, "market_data": $json.market_data } }}',
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
