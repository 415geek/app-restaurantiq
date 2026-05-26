import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : RestaurantIQ - Analyze
// Nodes   : 6  |  Connections: 5
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Webhook                            webhook                    [creds]
// ValidatePrompt                     code
// Openai                             httpRequest
// Parsejson                          code
// Respond                            respondToWebhook
// Gathermarketdata                   code
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Webhook
//    → ValidatePrompt
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
    description: '',
    isArchived: false,
    projectId: 'TetxDJaGPpRJbFV3',
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
        id: 'a18a2a17-71fa-4593-947a-4635fcc2b661',
        webhookId: '2e47a031-2ff9-4d62-b3f8-02bccc87b785',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [272, 304],
        credentials: { httpHeaderAuth: { id: 'JI9XqrzAg4eF0ayn', name: 'RestaurantIQ IQ Webhook Bearer' } },
    })
    Webhook = {
        httpMethod: 'POST',
        path: 'iq-analyze',
        responseMode: 'responseNode',
        options: {
            rawBody: false,
        },
        authentication: 'headerAuth',
    };

    @node({
        id: 'ff7769d7-99cb-4129-9282-07f05579e039',
        name: 'Validate+Prompt',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [480, 304],
    })
    ValidatePrompt = {
        mode: 'runOnceForEachItem',
        jsCode: `let root = $json;
try {
  root = $('Webhook').first().json;
} catch {
  /* fallback when Webhook item shape differs */
}

const body = root.body || {};
const address = String(body.address || body.location || '').trim();
const industry = String(body.industry || 'restaurant').trim();
const cuisine_type = body.cuisine_type ? String(body.cuisine_type).trim() : '';
const language = String(body.language || 'en').toLowerCase() === 'zh' ? 'zh' : 'en';

if (!address) throw new Error('Missing address');

const userInputs = (body && body.market_data && body.market_data.user_inputs) || {};
const monthlyRentUsd = Number(userInputs.monthly_rent_usd);
const sqftValue = Number(userInputs.sqft);
const hasRent = Number.isFinite(monthlyRentUsd) && monthlyRentUsd > 0;
const hasSqft = Number.isFinite(sqftValue) && sqftValue > 0;
const rentLineZh = hasRent
  ? \`用户已提供月租金（USD）: \${monthlyRentUsd} — 视为已知，禁止在 missing_data 中标注 monthly_rent / rent\`
  : '用户未提供月租金 — 在 missing_data 中可标注 monthly_rent';
const sqftLineZh = hasSqft
  ? \`用户已提供面积（sqft）: \${sqftValue} — 视为已知，禁止在 missing_data 中标注 sqft\`
  : '用户未提供面积 — 在 missing_data 中可标注 sqft';
const rentLineEn = hasRent
  ? \`User-provided monthly rent (USD): \${monthlyRentUsd} — treat as known; do NOT list monthly_rent / rent in missing_data\`
  : 'Monthly rent not provided — you may list monthly_rent in missing_data';
const sqftLineEn = hasSqft
  ? \`User-provided size (sqft): \${sqftValue} — treat as known; do NOT list sqft in missing_data\`
  : 'Sqft not provided — you may list sqft in missing_data';

const system = language === 'zh'
  ? [
      '你是 LocationIQ 选址大师的分析引擎。角色：麦肯锡商业地产与餐饮选址合伙人，向华人餐饮老板做签租前汇报。',
      '脑中完成六层0–100与decision_tier，再压缩为免费JSON；综合分仅辅助，首句须回答签/有条件签/暂不签。',
      '数据：优先 market_data/锚点；无数据单点标[估算]，禁止三次重复「根据该区域典型水平估算」。',
      '免费版=30秒签租备忘录：结论+3条证据+1致命风险+「完整版才能拍板的3个问题」；勿交付三场景营收或完整竞对矩阵。',
      '禁止空话：机会大于风险、潜力巨大、交通便利、人流不错、建议加强营销。',
      'market_snapshot每条≤55字：【事实】→【对利润/现金流含义】→【完整版才解锁的数字或清单】；paywall_teaser用「完整版将回答你现在无法拍板的3个问题：①…②…③…」。',
      'verdict仅go|caution|no；decision_tier必填；risk_audit_preview.one_line_conclusion为决策句。',
      '严格输出 JSON，不要 Markdown、不要额外说明文字。',
    ].join(' ')
  : [
      'You are LocationIQ: a McKinsey-style restaurant real-estate partner writing a pre-lease memo.',
      'Score six layers 0–100 and set decision_tier; lead with sign/conditional/do not sign—not score alone.',
      'Prioritize market_data anchors; label gaps [estimate]; never repeat the same generic estimate phrase three times.',
      'Free tier = 30s memo: verdict + 3 evidence bullets + 1 costly risk + 3 questions only the paid report answers; no three revenue scenarios or full competitor matrix.',
      'Ban fluff: opportunity outweighs risk, huge potential, convenient location, good foot traffic, improve marketing.',
      'market_snapshot ≤~35 words each: [fact] → [P&L meaning] → [paid-only tease]; paywall_teaser: "The full report answers 3 decisions you cannot make today: ①…②…③…".',
      'verdict go|caution|no; decision_tier required; risk_audit_preview.one_line_conclusion must be a decision sentence.',
      'Output STRICT JSON only, no markdown, no prose outside JSON.',
    ].join(' ');

const user = language === 'zh'
  ? [
      '请基于以下输入生成「免费版选址速评」（LocationIQ V2.0）。',
      \`地址: \${address}\`,
      \`业态: \${industry}\${cuisine_type ? '（' + cuisine_type + '）' : ''}\`,
      rentLineZh,
      sqftLineZh,
      '',
      '先在脑中完成六层评分与 decision_tier，再压缩进下列 JSON（不要单独输出 Markdown 表格）：',
      '',
      'headline：优先「{签租判断}｜{一句赌注}」；可含「综合约XX/100」；须含至少一处锚点（店名/N/距离/路段）；禁止「机会大于风险」。',
      'subheadline：一句「若现在签 lease，你赌的是___」。',
      'market_snapshot：恰好3条，每条≤55字；【事实】→【利润/现金流含义】→【完整版才给的数字或清单】；分别覆盖竞争、客流、经济钩子。',
      'hidden_risk：「若忽视，可能导致___」并尽量量化；勿与 paywall_teaser 重复。',
      'paywall_teaser：「完整版将回答你现在无法拍板的 3 个问题：①…②…③…」（从保本额、三场景营收、竞对威胁、签租清单、替代走廊、失败对照中选3）。',
      'verdict：go | caution | no；信息不足且下行风险显著时用 caution。',
      '',
      '严格输出 JSON：',
      '{',
      '  "verdict": "go|caution|no",',
      '  "headline": "...",',
      '  "subheadline": "...",',
      '  "market_snapshot": ["...", "...", "..."],',
      '  "hidden_risk": "...",',
      '  "paywall_teaser": "...",',
      '  "decision_tier": "strong_go|go_with_conditions|need_more_data|high_risk|no_go",',
      '  "risk_audit_preview": {',
      '    "overall_score": 0,',
      '    "one_line_conclusion": "...",',
      '    "layers": [{"id":"location_base","score":0},{"id":"cuisine_fit","score":0},{"id":"competition_pressure","score":0},{"id":"revenue_potential","score":0}],',
      '    "radar": {},',
      '    "data_confidence_pct": 0,',
      '    "missing_data": [],',
      '    "acquired_data": []',
      '  }',
      '}',
      '',
      'decision_tier 与 verdict 一致：strong_go→go；go_with_conditions/need_more_data→caution；high_risk/no_go→no。',
      '不要输出 reason 字段；控制篇幅；不提供完整解决方案。',
    ].filter(Boolean).join('\\n')
  : [
      'Generate the FREE LocationIQ V2.0 site quick assessment from the inputs below.',
      \`Address: \${address}\`,
      \`Business type: \${industry}\${cuisine_type ? ' (' + cuisine_type + ')' : ''}\`,
      rentLineEn,
      sqftLineEn,
      '',
      'After six-layer scoring and decision_tier, compress into JSON (no separate markdown tables):',
      '',
      'headline: prefer "{lease call} | {one bet}"; score optional; include ≥1 anchor; ban "opportunity outweighs risk".',
      'subheadline: one line "If you sign today, you are betting on ___".',
      'market_snapshot: exactly 3 strings, ≤~35 words each: [fact] → [P&L meaning] → [paid-only tease]; cover competition, traffic, economics hook.',
      'hidden_risk: "If ignored, likely ___" with quantified downside when possible; do not repeat paywall_teaser.',
      'paywall_teaser: "The full report answers 3 decisions you cannot make today: ①…②…③…" (pick 3 specific paid deliverables).',
      'verdict: go | caution | no; use caution when uncertainty with meaningful downside.',
      '',
      'Return STRICT JSON:',
      '{',
      '  "verdict": "go|caution|no",',
      '  "headline": "...",',
      '  "subheadline": "...",',
      '  "market_snapshot": ["...", "...", "..."],',
      '  "hidden_risk": "...",',
      '  "paywall_teaser": "...",',
      '  "decision_tier": "strong_go|go_with_conditions|need_more_data|high_risk|no_go",',
      '  "risk_audit_preview": {',
      '    "overall_score": 0,',
      '    "one_line_conclusion": "...",',
      '    "layers": [{"id":"location_base","score":0},{"id":"cuisine_fit","score":0},{"id":"competition_pressure","score":0},{"id":"revenue_potential","score":0}],',
      '    "radar": {},',
      '    "data_confidence_pct": 0,',
      '    "missing_data": [],',
      '    "acquired_data": []',
      '  }',
      '}',
      '',
      'Align decision_tier with verdict: strong_go→go; go_with_conditions/need_more_data→caution; high_risk/no_go→no.',
      'Do not output a reason field; stay concise; do not provide the full solution.',
    ].filter(Boolean).join('\\n');

return { json: {
    system,
    user,
    address,
    industry,
    cuisine_type,
    language
  }
};`,
    };

    @node({
        id: '855d5449-eb7b-4189-870c-cbbe26b63189',
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
        id: 'c6b53b13-6f3d-472b-9c29-9b59c769d1cc',
        name: 'ParseJSON',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [960, 304],
    })
    Parsejson = {
        mode: 'runOnceForEachItem',
        jsCode: `const raw = $json;
const choice = raw.choices && raw.choices[0];
const content = choice && choice.message && choice.message.content ? String(choice.message.content) : '';

let parsed;
try {
  parsed = JSON.parse(content);
} catch {
  throw new Error('Model did not return valid JSON');
}

const verdict = String(parsed.verdict || '').trim();
const headline = String(parsed.headline || '').trim();
const subheadline = String(parsed.subheadline || '').trim();
const marketSnapshot = Array.isArray(parsed.market_snapshot)
  ? parsed.market_snapshot.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
  : [];
const hiddenRisk = String(parsed.hidden_risk || '').trim();
const paywallTeaser = String(parsed.paywall_teaser || '').trim();
const decisionTier = String(parsed.decision_tier || '').trim();
const riskAuditPreview = parsed.risk_audit_preview && typeof parsed.risk_audit_preview === 'object' ? parsed.risk_audit_preview : null;

if (!verdict || !headline) throw new Error('Missing required fields in model JSON');

let market_data = null;
try {
  const gm = $('GatherMarketData').first().json;
  if (gm && gm.external_data) market_data = gm.external_data;
} catch (e) {
  market_data = null;
}

return { json: {
    analysis_id: $execution.id,
    verdict,
    headline,
    subheadline,
    market_snapshot: marketSnapshot,
    hidden_risk: hiddenRisk,
    paywall_teaser: paywallTeaser,
    decision_tier: decisionTier || undefined,
    risk_audit_preview: riskAuditPreview,
    market_data,
  }
};`,
    };

    @node({
        id: '419ca262-afba-493f-968d-e45529082794',
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1,
        position: [1200, 304],
    })
    Respond = {
        respondWith: 'json',
        responseBody:
            '={{ { "analysis_id": $json.analysis_id, "verdict": $json.verdict, "headline": $json.headline, "subheadline": $json.subheadline, "market_snapshot": $json.market_snapshot, "hidden_risk": $json.hidden_risk, "paywall_teaser": $json.paywall_teaser, "decision_tier": $json.decision_tier, "risk_audit_preview": $json.risk_audit_preview, "market_data": $json.market_data } }}',
        options: {
            responseCode: 200,
        },
    };

    @node({
        id: 'fa6d71f6-2399-4410-815a-cca112cf7aee',
        name: 'GatherMarketData',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [640, 464],
    })
    Gathermarketdata = {
        mode: 'runOnceForEachItem',
        jsCode: `const input = $json;
const address = String(input.address || '').trim();
const cuisine = String(input.cuisine_type || '').trim();
const industry = String(input.industry || 'restaurant').trim();

const googleKey = String($env.GOOGLE_MAPS_API_KEY || '').trim();
const yelpKey = String($env.YELP_API_KEY || $env.YELP_FUSION_API_KEY || '').trim();

async function getJson(url, options = {}, timeoutMs = 12000) {
  try {
    const res = await fetch(url, { ...options });
    const text = await res.text();
    if (!res.ok) return { _error: \`HTTP \${res.status}\`, _text: text.slice(0, 500) };
    try { return JSON.parse(text); } catch { return { _error: 'NON_JSON', _text: text.slice(0, 500) }; }
  } catch (e) {
    return { _error: String(e && e.message ? e.message : e) };
  }
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function avg(arr) {
  if (!arr.length) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function dist(arr) {
  const m = {};
  for (const v of arr) {
    const k = String(v ?? 'unknown');
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

const google = {
  enabled: Boolean(googleKey),
  textsearch: null,
  details: [],
};

if (googleKey) {
  const q = encodeURIComponent(cuisine ? \`\${cuisine} \${industry} near \${address}\` : \`\${industry} near \${address}\`);
  const textUrl = \`https://maps.googleapis.com/maps/api/place/textsearch/json?query=\${q}&type=restaurant&key=\${googleKey}\`;
  const text = await getJson(textUrl);
  google.textsearch = text;

  const results = Array.isArray(text.results) ? text.results.slice(0, 12) : [];
  for (const r of results) {
    const pid = r.place_id;
    if (!pid) continue;
    const fields = [
      'place_id','name','formatted_address','geometry','business_status','types','rating','user_ratings_total','price_level',
      'opening_hours','current_opening_hours','website','formatted_phone_number','international_phone_number','reviews',
      'delivery','dine_in','takeout','serves_beer','serves_wine','serves_breakfast','serves_lunch','serves_dinner','serves_vegetarian_food','wheelchair_accessible_entrance'
    ].join(',');
    const dUrl = \`https://maps.googleapis.com/maps/api/place/details/json?place_id=\${encodeURIComponent(pid)}&fields=\${encodeURIComponent(fields)}&reviews_no_translations=true&reviews_sort=newest&key=\${googleKey}\`;
    const d = await getJson(dUrl);
    google.details.push(d);
  }
}

const yelp = {
  enabled: Boolean(yelpKey),
  search: null,
  details: [],
  reviews: [],
};

if (yelpKey) {
  const term = encodeURIComponent(cuisine ? \`\${cuisine} \${industry}\` : industry);
  const loc = encodeURIComponent(address);
  const sUrl = \`https://api.yelp.com/v3/businesses/search?term=\${term}&location=\${loc}&categories=restaurants&limit=20&sort_by=best_match\`;
  const headers = { Authorization: \`Bearer \${yelpKey}\` };
  const s = await getJson(sUrl, { headers });
  yelp.search = s;

  const businesses = Array.isArray(s.businesses) ? s.businesses.slice(0, 10) : [];
  for (const b of businesses) {
    if (!b.id) continue;
    const d = await getJson(\`https://api.yelp.com/v3/businesses/\${encodeURIComponent(b.id)}\`, { headers });
    yelp.details.push(d);
    const rv = await getJson(\`https://api.yelp.com/v3/businesses/\${encodeURIComponent(b.id)}/reviews?limit=3&sort_by=yelp_sort\`, { headers });
    yelp.reviews.push({ id: b.id, reviews: rv.reviews || [], total: rv.total || null });
  }
}

const gRows = Array.isArray(google.textsearch && google.textsearch.results) ? google.textsearch.results : [];
const yRows = Array.isArray(yelp.search && yelp.search.businesses) ? yelp.search.businesses : [];

const summary = {
  competitor_count_google: gRows.length,
  competitor_count_yelp: yRows.length,
  avg_rating_google: avg(gRows.map((x) => num(x.rating, NaN)).filter((x) => Number.isFinite(x))),
  avg_rating_yelp: avg(yRows.map((x) => num(x.rating, NaN)).filter((x) => Number.isFinite(x))),
  avg_review_count_google: avg(gRows.map((x) => num(x.user_ratings_total, NaN)).filter((x) => Number.isFinite(x))),
  avg_review_count_yelp: avg(yRows.map((x) => num(x.review_count, NaN)).filter((x) => Number.isFinite(x))),
  google_price_level_dist: dist(gRows.map((x) => x.price_level ?? 'unknown')),
  yelp_price_dist: dist(yRows.map((x) => x.price ?? 'unknown')),
  top_google_types: Object.entries(dist(gRows.flatMap((x) => Array.isArray(x.types) ? x.types.slice(0, 3) : []))).sort((a,b)=>b[1]-a[1]).slice(0,8),
  top_yelp_categories: Object.entries(dist(yRows.flatMap((x) => Array.isArray(x.categories) ? x.categories.map((c)=>c.title || c.alias).filter(Boolean) : []))).sort((a,b)=>b[1]-a[1]).slice(0,8),
  sample_competitors_google: gRows.slice(0, 8).map((x) => ({ name: x.name, rating: x.rating, reviews: x.user_ratings_total, price_level: x.price_level, address: x.formatted_address, lat: x.geometry && x.geometry.location ? x.geometry.location.lat : null, lng: x.geometry && x.geometry.location ? x.geometry.location.lng : null })),
  sample_competitors_yelp: yRows.slice(0, 8).map((x) => ({ name: x.name, rating: x.rating, reviews: x.review_count, price: x.price, is_closed: x.is_closed, categories: x.categories })),
};

const dataPack = {
  source: 'google_places + yelp_fusion',
  fetched_at: new Date().toISOString(),
  address,
  cuisine,
  summary,
  google_raw: {
    textsearch: google.textsearch,
    details: google.details,
  },
  yelp_raw: {
    search: yelp.search,
    details: yelp.details,
    reviews: yelp.reviews,
  },
};

const summaryText = [
  \`Google competitors: \${summary.competitor_count_google}\`,
  \`Yelp competitors: \${summary.competitor_count_yelp}\`,
  \`Google avg rating: \${summary.avg_rating_google ?? 'n/a'} | Yelp avg rating: \${summary.avg_rating_yelp ?? 'n/a'}\`,
  \`Google avg reviews: \${summary.avg_review_count_google ?? 'n/a'} | Yelp avg reviews: \${summary.avg_review_count_yelp ?? 'n/a'}\`,
  \`Google price dist: \${JSON.stringify(summary.google_price_level_dist)}\`,
  \`Yelp price dist: \${JSON.stringify(summary.yelp_price_dist)}\`,
].join('\\n');

const raw = JSON.stringify(dataPack);
const clipped = raw.length > 22000 ? raw.slice(0, 22000) + ' ...[truncated]' : raw;

const augmentedUser = \`\${input.user}\\n\\nExternal multi-source data (Google Places + Yelp) is attached below. Use it as primary evidence and avoid vague statements.\\n\\nMarket data summary:\\n\${summaryText}\\n\\nRaw external data JSON:\\n\${clipped}\`;

return { json: {
    ...input,
    user: augmentedUser,
    external_data: dataPack,
  }
};`,
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.ValidatePrompt.in(0));
        this.ValidatePrompt.out(0).to(this.Gathermarketdata.in(0));
        this.Openai.out(0).to(this.Parsejson.in(0));
        this.Parsejson.out(0).to(this.Respond.in(0));
        this.Gathermarketdata.out(0).to(this.Openai.in(0));
    }
}
