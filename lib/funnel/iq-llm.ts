import OpenAI from 'openai';
import { z } from 'zod';

const partialSchema = z.object({
  verdict: z.string(),
  headline: z.string(),
  subheadline: z.string().optional(),
  market_snapshot: z.array(z.string()).optional(),
  hidden_risk: z.string().optional(),
  paywall_teaser: z.string().optional(),
  reason: z.string().optional(),
});

const fullSchema = z.object({
  executive_summary: z.string().optional(),
  final_verdict: z.string().optional(),
  trade_area_analysis: z.string().optional(),
  demographic_profile: z.string().optional(),
  competition_landscape: z.string().optional(),
  revenue_estimate: z.string().optional(),
  risks: z.array(z.string()).optional(),
  opportunities: z.array(z.string()).optional(),
  failure_scenarios: z.array(z.string()).optional(),
  differentiation_strategy: z.string().optional(),
  action_plan: z.array(z.string()).optional(),
  confidence: z.string().optional(),
});

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function model() {
  return process.env.OPENAI_IQ_MODEL?.trim() || 'gpt-4o-mini';
}

async function postN8nJson<T>(url: string, body: unknown): Promise<T> {
  const secret = process.env.N8N_IQ_WEBHOOK_SECRET?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`n8n webhook failed: ${res.status} ${t.slice(0, 500)}`);
  }

  return (await res.json()) as T;
}

export async function runPartialAnalysis(input: {
  location: string;
  businessType: string;
  language?: 'en' | 'zh';
}): Promise<{
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
  reason?: string;
}> {
  const language = input.language === 'zh' ? 'zh' : 'en';
  const n8nUrl = process.env.N8N_IQ_ANALYZE_WEBHOOK_URL?.trim();
  if (n8nUrl) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      location: input.location,
      businessType: input.businessType || null,
      language,
    });
    return partialSchema.parse(raw);
  }

  const client = getOpenAI();
  if (!client) {
    throw new Error('Neither N8N_IQ_ANALYZE_WEBHOOK_URL nor OPENAI_API_KEY is configured');
  }

  const systemPrompt = language === 'zh'
    ? [
        '你是一名顶级餐饮投资分析师，同时也是一个极强转化能力的商业顾问。',
        '你的目标不是给出完整分析，而是让用户意识到：如果不看完整报告就做决策，可能会犯代价高昂的错误。',
        '你必须制造"表面机会 + 隐藏风险"的张力。',
        '你的语气必须专业、克制、像真正做过选址和投资判断的人。',
        '禁止空泛表达，例如："客流量大"、"前景不错"、"需求旺盛"、"很有潜力"。',
        '禁止写成营销文案，禁止写成自嗨式夸赞，禁止写成泛泛而谈的AI总结。',
        '免费版内容不能把价值讲完，必须保留关键判断给付费版。',
        '严格输出 JSON，不允许输出任何额外文字、解释或 Markdown。'
      ].join(' ')
    : [
        'You are a top-tier restaurant investment analyst and a conversion-focused business advisor.',
        'Your goal is NOT to provide a full analysis.',
        'Your goal is to make the user feel that making a decision without the full report is financially risky.',
        'You must create tension between visible opportunity and hidden downside.',
        'Your tone must sound like a real investor/operator, not a generic AI assistant.',
        'Do NOT use fluffy phrases such as "great location", "strong demand", "good potential", or "high foot traffic" without context.',
        'Do NOT write marketing copy.',
        'The free output must not give away the full value. It must preserve the most decision-critical insight for the paid report.',
        'Output STRICT JSON only. No extra text, no markdown.'
      ].join(' ');

  const userPrompt = language === 'zh'
    ? [
        '请基于以下输入，生成"高转化免费版初判"。',
        `地址: ${input.location}`,
        `业态: ${input.businessType || '餐饮'}`,
        '',
        '输出目标：',
        '1) 让用户觉得这个位置不是一眼能判断的。',
        '2) 让用户感到：如果不看完整版就贸然决策，会有代价。',
        '3) 让用户愿意花 $19 解锁完整报告。',
        '',
        '严格输出以下 JSON 结构：',
        '{',
        '  "verdict": "go|caution|no",',
        '  "headline": "必须体现机会 vs 风险的张力",',
        '  "subheadline": "1句话，解释为什么这个位置乍看有吸引力",',
        '  "market_snapshot": ["竞争/需求/价格相关的专业短句1", "短句2", "短句3"],',
        '  "hidden_risk": "只写一个最关键风险，必须让人感觉忽略它会很贵",',
        '  "paywall_teaser": "暗示真正决定能不能开的是更深层的结构性问题"',
        '}'
      ].join('\n')
    : [
        'Based on the input below, generate a high-conversion free preliminary decision.',
        `Address: ${input.location}`,
        `Business type: ${input.businessType || 'Restaurant'}`,
        '',
        'Output goals:',
        '1) Make the user feel this is NOT obvious.',
        '2) Create decision tension: visible opportunity vs hidden downside.',
        '3) Make the user willing to pay $19 for the full report.',
        '',
        'Return STRICT JSON only in this exact shape:',
        '{',
        '  "verdict": "go|caution|no",',
        '  "headline": "Must contain tension between opportunity and risk",',
        '  "subheadline": "One sentence explaining why location looks attractive at first glance",',
        '  "market_snapshot": ["Professional bullet about competition/demand/price 1", "bullet 2", "bullet 3"],',
        '  "hidden_risk": "One key risk that feels costly if ignored",',
        '  "paywall_teaser": "Imply the real decision depends on a deeper structural issue"',
        '}'
      ].join('\n');

  const completion = await client.chat.completions.create({
    model: model(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty OpenAI response');
  return partialSchema.parse(JSON.parse(text));
}

export async function runFullReport(input: {
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData?: Record<string, unknown>;
  language?: 'en' | 'zh';
}): Promise<Record<string, unknown>> {
  const language = input.language === 'zh' ? 'zh' : 'en';
  const n8nUrl = process.env.N8N_IQ_FULL_REPORT_WEBHOOK_URL?.trim();
  if (n8nUrl) {
    const raw = await postN8nJson<unknown>(n8nUrl, {
      location: input.location,
      businessType: input.businessType,
      partialHeadline: input.headline,
      partialReason: input.reason,
      market_data: input.marketData,
      language,
    });
    return fullSchema.parse(raw) as Record<string, unknown>;
  }

  const client = getOpenAI();
  if (!client) {
    throw new Error('Neither N8N_IQ_FULL_REPORT_WEBHOOK_URL nor OPENAI_API_KEY is configured');
  }

  const marketDataSection = input.marketData
    ? `\n\n市场数据 (来自 Google Places + Yelp):\n${JSON.stringify(input.marketData, null, 2)}`
    : '';

  const systemPrompt = language === 'zh'
    ? [
        '你是一名顶级餐饮投资分析师，正在生成一份高级决策报告。',
        '这是一份付费报告 - 用户支付了 $19 来获取可执行的、具体的洞察。',
        '你的工作是提供清晰的方向和判断，而不是泛泛而谈的建议。',
        '必须具体，包含数字、策略和行动项。',
        '语气要像一个做过 100+ 选址分析的真正顾问。',
        '禁止使用空洞的语言。每一句话都必须有价值。',
        '所有内容必须用中文输出。',
        '严格输出 JSON 格式。',
      ].join(' ')
    : [
        'You are a top-tier restaurant investment analyst generating a PREMIUM decision report.',
        'This is a PAID report - users paid $19 for actionable, specific insights.',
        'Your job is to provide CLARITY and DIRECTION, not generic advice.',
        'Be specific with numbers, strategies, and action items.',
        'Sound like a real consultant who has done 100+ location analyses.',
        'Do NOT use fluffy language. Every sentence must add value.',
        'Output strict JSON only.',
      ].join(' ');

  const userPrompt = language === 'zh'
    ? `为这个餐厅选址生成一份全面的决策报告。

地址: ${input.location}
业态: ${input.businessType || '餐厅'}
初步判定: ${input.headline}
初步评估: ${input.reason}
${marketDataSection}

生成一份高级报告，包含以下部分（所有内容必须用中文）：

1. 执行摘要 (executive_summary): 2-3 句话。以"建议开/谨慎/不建议开"开头。总结关键决策因素。直接明了。

2. 最终判定 (final_verdict): 一句话回答"应该在这里开店吗？"，并给出主要原因。

3. 商圈分析 (trade_area_analysis): 描述 1 英里半径范围。客流模式、周边商业、交通便利性、停车、可见性。要具体。

4. 人口画像 (demographic_profile): 周边居住/工作的人群？收入水平、年龄结构、用餐习惯。与业态关联分析。

5. 竞争格局 (competition_landscape): 0.5 英里内的直接竞争对手。他们的优势、劣势、价格定位。你可以利用的市场空白在哪里？

6. 营收预估 (revenue_estimate): 月收入范围及假设条件。要具体："预估月营收 $4.5-6.5 万，基于 X 座位、Y 翻台率、Z 平均客单价。"

7. 五大风险 (risks): 5 个具体风险的数组。每个风险包含：是什么、为什么重要、潜在财务影响。

8. 三大机会 (opportunities): 3 个差异化机会的数组。每个都应该是可执行的，且针对这个具体位置。

9. 失败场景 (failure_scenarios): 3 个会导致这家店失败的场景数组。要直言不讳。

10. 差异化策略 (differentiation_strategy): 这家餐厅应该如何差异化才能生存？2-3 个具体策略。

11. 90 天行动计划 (action_plan): 6-8 个具体步骤的数组。每个步骤都应该具体且有时间节点。

12. 置信度 (confidence): "高" / "中" / "低"，基于数据质量和市场清晰度。

严格返回以下 JSON 结构：
{
  "executive_summary": "...",
  "final_verdict": "...",
  "trade_area_analysis": "...",
  "demographic_profile": "...",
  "competition_landscape": "...",
  "revenue_estimate": "...",
  "risks": ["风险1", "风险2", "风险3", "风险4", "风险5"],
  "opportunities": ["机会1", "机会2", "机会3"],
  "failure_scenarios": ["场景1", "场景2", "场景3"],
  "differentiation_strategy": "...",
  "action_plan": ["步骤1", "步骤2", ...],
  "confidence": "高|中|低"
}`
    : `Generate a comprehensive decision report for this restaurant location.

LOCATION: ${input.location}
BUSINESS TYPE: ${input.businessType || 'Restaurant'}
PRELIMINARY VERDICT: ${input.headline}
INITIAL ASSESSMENT: ${input.reason}
${marketDataSection}

Generate a PREMIUM report with these sections:

1. EXECUTIVE SUMMARY (executive_summary): 2-3 sentences. Start with GO/CAUTION/NO-GO. Summarize the key decision factors. Be direct.

2. FINAL VERDICT (final_verdict): One clear sentence answering "Should I open here?" with the main reason.

3. TRADE AREA ANALYSIS (trade_area_analysis): Describe the 1-mile radius. Foot traffic patterns, nearby anchors, accessibility, parking, visibility. Be specific.

4. DEMOGRAPHIC PROFILE (demographic_profile): Who lives/works nearby? Income levels, age groups, dining habits. Connect to the business type.

5. COMPETITION LANDSCAPE (competition_landscape): Direct competitors within 0.5 miles. Their strengths, weaknesses, price points. Where is the gap you can exploit?

6. REVENUE ESTIMATE (revenue_estimate): Monthly revenue range with assumptions. Be specific: "Estimated $45K-65K/month based on X seats, Y turnover, Z average ticket."

7. TOP 5 RISKS (risks): Array of 5 specific risks. Each risk should include: what it is, why it matters, and the potential financial impact.

8. TOP 3 OPPORTUNITIES (opportunities): Array of 3 differentiation opportunities. Each should be actionable and specific to this location.

9. FAILURE SCENARIOS (failure_scenarios): Array of 3 scenarios that would cause this business to fail. Be brutally honest.

10. DIFFERENTIATION STRATEGY (differentiation_strategy): How should this restaurant differentiate to survive? 2-3 specific tactics.

11. 90-DAY ACTION PLAN (action_plan): Array of 6-8 concrete steps. Each step should be specific and time-bound.

12. CONFIDENCE LEVEL (confidence): "High" / "Medium" / "Low" based on data quality and market clarity.

Return STRICT JSON with these exact keys:
{
  "executive_summary": "...",
  "final_verdict": "...",
  "trade_area_analysis": "...",
  "demographic_profile": "...",
  "competition_landscape": "...",
  "revenue_estimate": "...",
  "risks": ["risk1", "risk2", "risk3", "risk4", "risk5"],
  "opportunities": ["opp1", "opp2", "opp3"],
  "failure_scenarios": ["scenario1", "scenario2", "scenario3"],
  "differentiation_strategy": "...",
  "action_plan": ["step1", "step2", ...],
  "confidence": "High|Medium|Low"
}`;

  const completion = await client.chat.completions.create({
    model: model(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty OpenAI response');
  return fullSchema.parse(JSON.parse(text)) as Record<string, unknown>;
}
