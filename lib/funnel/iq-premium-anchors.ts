/**
 * Injects hard anchors into the paid-report LLM prompt so outputs vary by address
 * and cannot ignore retrieved competitor names / counts (reduces A/B/C placeholders
 * and identical revenue bands).
 */

type Lang = 'en' | 'zh';

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Accepts DB `market_data_json` or n8n `external_data`-shaped objects. */
export function extractMarketSummary(marketData: Record<string, unknown> | null | undefined): Record<
  string,
  unknown
> | null {
  if (!marketData || typeof marketData !== 'object') return null;
  const s = marketData.summary;
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  const ext = marketData.external_data;
  if (ext && typeof ext === 'object') {
    const inner = (ext as Record<string, unknown>).summary;
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
  }
  return null;
}

/** Heuristic USD anchors from Places summary — not financial advice; forces model to vary by N/R/V. */
export function computeRevenueAnchorsUsd(summary: Record<string, unknown> | null): {
  n: number;
  avgRating: number;
  avgReviews: number;
  low: number;
  mid: number;
  high: number;
} | null {
  if (!summary) return null;
  const ng = num(summary.competitor_count_google);
  const ny = num(summary.competitor_count_yelp);
  const n = Math.max(0, Math.min(40, Math.round(ng ?? ny ?? 0)));
  const avgRating = num(summary.avg_rating_google) ?? num(summary.avg_rating_yelp) ?? 4;
  const avgReviews =
    num(summary.avg_review_count_google) ?? num(summary.avg_review_count_yelp) ?? 200;
  const density = n * 2100 + avgRating * 2800 + Math.min(avgReviews, 2000) * 8;
  const low = Math.round(9000 + density * 0.95);
  const mid = Math.round(low * 1.22);
  const high = Math.round(low * 1.48);
  return { n, avgRating, avgReviews, low, mid, high };
}

export function buildPremiumMarketAnchorsBlock(
  marketData: Record<string, unknown> | null | undefined,
  lang: Lang,
): string {
  if (!marketData || typeof marketData !== 'object') {
    return lang === 'zh'
      ? '\n\n【系统锚点】未提供 market_data：须在 JSON 中明确写「无外部检索数据」，competitors 用 [估算] 距离与类别，禁止编造 A/B/C 代号店名；三场景营收须根据地址与业态单独推导并写清假设，禁止复用固定区间套话。\n'
      : '\n\n[SYSTEM ANCHORS] No market_data: state explicitly in JSON; use [estimate] for competitors; no A/B/C names; derive three revenue scenarios from address + concept—do not reuse a canned band.\n';
  }

  const summary = extractMarketSummary(marketData);
  if (!summary) {
    return lang === 'zh'
      ? '\n\n【系统锚点】已提供 market_data 但缺少可解析的 summary：须从原始 JSON 提炼竞对数量/店名（若有），禁止 A/B/C 代号；三场景营收须与本地址绑定推导。\n'
      : '\n\n[SYSTEM ANCHORS] market_data present but no parsable summary: infer competitor signals from raw JSON if any; no A/B/C names; revenue scenarios must be address-specific.\n';
  }

  const gSamples = Array.isArray(summary.sample_competitors_google)
    ? (summary.sample_competitors_google as unknown[])
    : [];
  const ySamples = Array.isArray(summary.sample_competitors_yelp)
    ? (summary.sample_competitors_yelp as unknown[])
    : [];

  const googleNames = gSamples
    .slice(0, 10)
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const name = String((row as Record<string, unknown>).name ?? '').trim();
      return name || null;
    })
    .filter((x): x is string => Boolean(x));

  const yelpNames = ySamples
    .slice(0, 10)
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const name = String((row as Record<string, unknown>).name ?? '').trim();
      return name || null;
    })
    .filter((x): x is string => Boolean(x));

  const anchors = computeRevenueAnchorsUsd(summary);
  const n = anchors?.n ?? 0;
  const low = anchors?.low ?? 0;
  const mid = anchors?.mid ?? 0;
  const high = anchors?.high ?? 0;

  if (lang === 'zh') {
    const lines = [
      '\n\n【系统数据锚点——必须体现在 JSON 的叙述与结构化字段中，禁止用泛泛模板覆盖】',
      `- 检索样本餐厅数 N=${n}（须在 competition_landscape、revenue_estimate、risk/opportunity 中至少一处显式引用）。`,
      googleNames.length
        ? `- Google 样本店名（须优先用于 competitors 前 ${Math.min(5, googleNames.length)} 行，店名一字不改；禁止改为「A外卖/B快餐/竞品C」等代号）：${googleNames.join('、')}`
        : '- Google 样本店名为空：须在 prose 说明检索未返回具名结果，距离用 [估算]，仍禁止虚构 A/B/C 代号。',
      yelpNames.length
        ? `- Yelp 样本店名（须在 competition_landscape 或 competitors 中引用至少 2 家真实名称，并简述评分/评论量若 JSON 中有）：${yelpNames.join('、')}`
        : '- Yelp 样本为空：须说明 Yelp 侧未返回或未接入，不得编造评论数据。',
      `- 三场景 monthly_revenue_usd 须分别围绕约 $${low} / $${mid} / $${high}（允许 ±25% 调整），且 key_assumptions 必须解释与 N、样本热度（评分/评论量）的关系；禁止对不同地址输出相同营收区间而不改数字。`,
      '- opportunities 共 3 条：每条必须包含本商圈具体事实（上述 N、某样本店名、或 geocode 地址要素之一）；禁止与 risks 五条逐条重复或仅换同义词。',
      '- 公交路线编号、精确客流量若无数据来源，必须标注 [待核实] 并说明验证方式；禁止编造线路号或普查级客流。',
    ];
    return lines.join('\n');
  }

  const lines = [
    '\n\n[SYSTEM DATA ANCHORS — must appear in JSON prose AND structured fields]',
    `- Retrieved sample restaurant count N=${n} (cite N in competition_landscape, revenue narrative, and/or risks/opportunities).`,
    googleNames.length
      ? `- Google sample names (use verbatim for the first ${Math.min(5, googleNames.length)} competitors rows; NO A/B/C placeholders): ${googleNames.join(', ')}`
      : '- No Google names: explain in prose; use [estimate] distances; still NO A/B/C placeholders.',
    yelpNames.length
      ? `- Yelp sample names (reference ≥2 real names with rating/review context when present): ${yelpNames.join(', ')}`
      : '- No Yelp samples: state Yelp missing/not wired; do not invent review stats.',
    `- Three scenarios monthly_revenue_usd should center ~$${low} / $${mid} / $${high} (±25% ok); key_assumptions MUST tie to N and review/rating signals; do NOT output identical revenue bands for different addresses.`,
    '- Each of 3 opportunities MUST cite a concrete fact from this market_data (N, a sample name, or geocode text); MUST NOT duplicate the 5 risk bullets.',
    '- Transit route numbers / precise foot traffic without sources → label [TBD] + how to verify; do not invent.',
  ];
  return lines.join('\n');
}

export function buildPremiumMarketDataSection(
  marketData: Record<string, unknown> | null | undefined,
  lang: Lang,
): string {
  const anchors = buildPremiumMarketAnchorsBlock(marketData, lang);
  if (!marketData || typeof marketData !== 'object') {
    return anchors;
  }
  const jsonBlock =
    lang === 'zh'
      ? `\n\n【市场数据原始 JSON（Google Places / Yelp 等）】\n${JSON.stringify(marketData, null, 2)}`
      : `\n\nRAW MARKET DATA JSON (Google Places / Yelp):\n${JSON.stringify(marketData, null, 2)}`;
  return `${anchors}${jsonBlock}`;
}
