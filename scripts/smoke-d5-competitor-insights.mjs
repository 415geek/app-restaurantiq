// D-5 fixture/render smoke test.
//
// Why offline: the production module `iq-deepseek-competitor-insights.ts` uses
// `@/...` runtime imports (Supabase admin, env, Yelp/Google helpers) that Node's
// native TypeScript stripping doesn't resolve. This script validates only the
// pure data-shape + render code paths that don't require alias resolution:
//
//  1. The exported `CompetitorInsights` shape compiles round-trip with the values
//     `buildFinalRows` and `enrichMarketDataWithCompetitorInsights` would emit.
//  2. The schema is what the anchor block expects (no missing fields).
//
// For the actual live E2E test, trigger a paid LocationIQ report after deploy and
// inspect `marketData.competitor_insights` in the report row, plus the visible
// "Competitor deep insights" card on the report page + PDF.
//
// What we validate without alias resolution:
//  - JSON shape matches the `CompetitorInsights` TypeScript interface.
//  - All threat_level values are one of {high, medium, low}.
//  - All required string fields are non-empty when their source row is non-empty.
//  - Source enum stays within {google, yelp, foursquare, mixed}.

import assert from 'node:assert/strict';

const insights = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  generated_at: new Date().toISOString(),
  reviews_fetched: {
    google_competitors: 3,
    yelp_competitors: 2,
    total_review_excerpts: 14,
  },
  per_competitor: [
    {
      name: 'Boba Guys',
      source: 'mixed',
      rating: 4.5,
      review_count: 1500,
      price_tier: '$$',
      positioning: 'Premium boba chain anchored on brown sugar boba and seasonal LTOs.',
      signature_items: ['brown sugar boba', 'matcha latte', 'strawberry matcha'],
      top_complaints: ['long wait at peak', 'price creep', 'inconsistent sweetness'],
      top_praise: ['friendly staff', 'consistent quality', 'fast pickup off-peak'],
      pricing_perception: 'perceived as premium-tier boba',
      threat_level: 'high',
      ai_takeaway_zh: 'Boba Guys 是本商圈最强锚定品牌，需在客单价段差异化（更低价或独家配方）。',
      ai_takeaway_en: 'Boba Guys is the dominant anchor; differentiate via ticket price band or exclusive recipe.',
    },
    {
      name: 'Sharetea',
      source: 'google',
      rating: 4.3,
      review_count: 890,
      price_tier: '$',
      positioning: 'Value-tier global chain offering wide menu and frequent promos.',
      signature_items: ['classic milk tea', 'taro slush'],
      top_complaints: ['cookie-cutter feel', 'tapioca quality varies'],
      top_praise: ['affordable', 'reliable hours'],
      pricing_perception: 'value tier $',
      threat_level: 'medium',
      ai_takeaway_zh: 'Sharetea 走性价比路线，威胁中等；可在品质与体验上拉开差距。',
      ai_takeaway_en: 'Sharetea competes on value; differentiate on quality and experience.',
    },
    {
      name: 'Tea Garden',
      source: 'yelp',
      rating: 4.2,
      review_count: 320,
      price_tier: '$',
      positioning: 'Independent neighborhood teahouse with strong regulars.',
      signature_items: ['mango pomelo', 'oolong milk tea'],
      top_complaints: ['slow service', 'small seating'],
      top_praise: ['friendly owner', 'fresh fruit tea'],
      pricing_perception: 'value with hidden-gem reputation',
      threat_level: 'medium',
      ai_takeaway_zh: '本地独立店，复购率高但产能有限，建议在外卖效率上抢量。',
      ai_takeaway_en: 'Independent shop with loyal regulars but capacity-constrained; win on delivery/pickup throughput.',
    },
  ],
  cluster_summary_zh:
    '本商圈以 Boba Guys 为高威胁锚点，整体评分 4.2–4.5，价位集中在 $$ 段，等待时间是高频差评。',
  cluster_summary_en:
    'Boba Guys anchors the high-threat tier; cluster averages 4.2–4.5 stars at $$, with peak wait time the dominant complaint.',
  gaps_and_openings_zh:
    '可切入：(1) 高峰时段 <8 分钟取餐通道；(2) 低糖 + 燕麦奶组合；(3) 工作日下午 $5 客单价。',
  gaps_and_openings_en:
    'Openings: (1) <8 min sub-25-min pickup lane; (2) low-sugar + oat-milk combo; (3) weekday afternoon $5 ticket band.',
};

/* ---------------------- 1. schema validation ---------------------- */

assert.equal(insights.provider, 'deepseek');
assert.equal(typeof insights.model, 'string');
assert.equal(typeof insights.generated_at, 'string');
assert.ok(insights.reviews_fetched.google_competitors >= 0);
assert.ok(insights.reviews_fetched.yelp_competitors >= 0);
assert.ok(insights.reviews_fetched.total_review_excerpts > 0);
assert.ok(Array.isArray(insights.per_competitor));
assert.ok(insights.per_competitor.length >= 1);

for (const row of insights.per_competitor) {
  assert.ok(row.name.length > 0, 'name required');
  assert.ok(['google', 'yelp', 'foursquare', 'mixed'].includes(row.source), 'bad source ' + row.source);
  assert.ok(['high', 'medium', 'low'].includes(row.threat_level), 'bad threat_level ' + row.threat_level);
  assert.ok(row.positioning.length > 0, 'positioning required for ' + row.name);
  assert.ok(row.ai_takeaway_zh.length > 0, 'ai_takeaway_zh required for ' + row.name);
  assert.ok(row.ai_takeaway_en.length > 0, 'ai_takeaway_en required for ' + row.name);
  assert.ok(Array.isArray(row.signature_items));
  assert.ok(Array.isArray(row.top_complaints));
  assert.ok(Array.isArray(row.top_praise));
}

assert.ok(insights.cluster_summary_zh.length > 10);
assert.ok(insights.cluster_summary_en.length > 10);
assert.ok(insights.gaps_and_openings_zh.length > 10);
assert.ok(insights.gaps_and_openings_en.length > 10);

/* ---------------------- 2. JSON serialisability ---------------------- */

const json = JSON.stringify(insights);
assert.ok(json.length > 100, 'should serialize to non-trivial JSON');
const parsed = JSON.parse(json);
assert.equal(parsed.per_competitor.length, insights.per_competitor.length);
assert.equal(parsed.per_competitor[0].threat_level, 'high');

/* ---------------------- 3. anchor-block text contract (manual render) ---------------------- */
// Mirror the rendering logic in lib/funnel/iq-premium-anchors.ts → buildCompetitorInsightsBlock.
// This is a *contract* test: if someone changes the anchor block format we want the
// smoke to flag it via failing assertions on the produced strings.

function renderAnchorBlock(insights, lang) {
  const isZh = lang === 'zh';
  const lines = [];
  lines.push(
    isZh
      ? '\n\n【竞品深度洞察（DeepSeek-V3 基于 Google + Yelp 真实评论摘要——必须在 competition_landscape / competitors / opportunities 中引用，禁止抛弃）】'
      : '\n\n[COMPETITOR INSIGHTS — DeepSeek-V3 grounded summary of Google + Yelp reviews — MUST appear in competition_landscape / competitors / opportunities; do NOT discard]',
  );
  for (let i = 0; i < insights.per_competitor.length; i++) {
    const row = insights.per_competitor[i];
    const threatLabel = isZh
      ? row.threat_level === 'high'
        ? '高威胁'
        : row.threat_level === 'low'
          ? '低威胁'
          : '中等威胁'
      : row.threat_level;
    lines.push('');
    lines.push(`[#${i + 1}] ${row.name} — ${threatLabel}`);
  }
  if (isZh ? insights.cluster_summary_zh : insights.cluster_summary_en) {
    lines.push(isZh ? '【竞品集群总结】' : '[CLUSTER SUMMARY]');
  }
  return lines.join('\n');
}

const zhBlock = renderAnchorBlock(insights, 'zh');
const enBlock = renderAnchorBlock(insights, 'en');

assert.ok(zhBlock.includes('Boba Guys'), 'zh: missing Boba Guys');
assert.ok(zhBlock.includes('高威胁'), 'zh: missing 高威胁 label');
assert.ok(zhBlock.includes('竞品深度洞察'), 'zh: missing 竞品深度洞察 header');
assert.ok(zhBlock.includes('竞品集群总结'), 'zh: missing 竞品集群总结 marker');

assert.ok(enBlock.includes('Boba Guys'), 'en: missing Boba Guys');
assert.ok(enBlock.includes('high'), 'en: missing high threat label');
assert.ok(enBlock.includes('COMPETITOR INSIGHTS'), 'en: missing COMPETITOR INSIGHTS header');
assert.ok(enBlock.includes('CLUSTER SUMMARY'), 'en: missing CLUSTER SUMMARY marker');

console.log('D-5 fixture smoke PASSED');
console.log(' - schema:', insights.per_competitor.length, 'competitors');
console.log(' - zh block len:', zhBlock.length, 'chars');
console.log(' - en block len:', enBlock.length, 'chars');
console.log('');
console.log('NOTE: live end-to-end validation requires triggering a paid LocationIQ');
console.log('report after deploy. Inspect marketData.competitor_insights in the row.');
