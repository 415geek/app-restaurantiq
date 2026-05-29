/**
 * Injects hard anchors into the paid-report LLM prompt so outputs vary by address
 * and cannot ignore retrieved competitor names / counts (reduces A/B/C placeholders
 * and identical revenue bands).
 */

import {
  summarizeWebResearchForAnchors,
  summarizeDeepResearchForAnchors,
  type WebResearchPack,
  type DeepResearchPack,
} from '@/lib/funnel/iq-web-research';
import { formatCaltransForAnchors, type CaltransAADTResult } from '@/lib/funnel/external-data/caltrans';
import { formatListingsForAnchors, type CommercialListingsResult } from '@/lib/funnel/external-data/commercial-listings';
import { formatBrightDataForAnchors, type MarketResearchResult } from '@/lib/funnel/external-data/brightdata';
import {
  formatFinanceModelForAnchors,
  type DeterministicFinanceModel,
} from '@/lib/funnel/iq-finance-model';
import type { CompetitorInsights } from '@/lib/funnel/iq-deepseek-competitor-insights';

type Lang = 'en' | 'zh';

const FREE_BRIEF_MAX_CHARS = 2_800;

function fmtQty(v: unknown, lang: Lang): string {
  if (typeof v === 'number' && Number.isFinite(v)) return lang === 'zh' ? `${v.toLocaleString('zh-CN')}` : `${v.toLocaleString('en-US')}`;
  return lang === 'zh' ? '（数据抑制或缺失）' : '(suppressed or missing)';
}

function fmtUsd(v: unknown, lang: Lang): string {
  if (typeof v === 'number' && Number.isFinite(v)) return lang === 'zh' ? `约 $${v.toLocaleString('en-US')}` : `~$${v.toLocaleString('en-US')}`;
  return lang === 'zh' ? '（数据抑制或缺失）' : '(suppressed or missing)';
}

function fmtPct(v: unknown, lang: Lang): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `${Math.round(v)}%`;
  return lang === 'zh' ? '（数据抑制或缺失）' : '(suppressed or missing)';
}

type _AcsShareLike = { pct?: unknown; count?: unknown } | undefined | null;
function pickPct(v: _AcsShareLike): unknown {
  if (!v || typeof v !== 'object') return null;
  return (v as Record<string, unknown>).pct;
}

/** Census ACS pack → prompt block forcing quantitative demographic + trade-area prose. */
export function buildAcsQuantAnchorsBlock(
  marketData: Record<string, unknown> | null | undefined,
  lang: Lang,
): string {
  const acs = marketData?.acs_context;
  if (!acs || typeof acs !== 'object') {
    return lang === 'zh'
      ? '\n\n【人口统计锚点】无 ACS 片区数据（常见于非美国地址或地理解析失败）。demographic_profile 首段须明确写「无普查片区级官方统计」，后续仅允许 [估算]/[检索] 并说明依据；禁止编造普查级精确数字。\n'
      : '\n\n[DEMOGRAPHICS ANCHORS] No ACS tract/county pack (non-US or geocode failure). Open demographic_profile by stating no tract-level Census stats; then [estimate]/[search] only with sources—never fake Census precision.\n';
  }
  const a = acs as Record<string, unknown>;
  const year = String(a.acs_year ?? '');
  const tractAvail = a.tract_data_available === true;
  const tract = (a.tract as Record<string, unknown> | undefined) ?? {};
  const county = (a.county as Record<string, unknown> | undefined) ?? {};
  const cite = String(lang === 'zh' ? a.citation_zh : a.citation_en);

  const tractName = typeof tract.name === 'string' ? tract.name : '';
  const countyName = typeof county.name === 'string' ? county.name : '';

  const tractRace = (tract.race_ethnicity as Record<string, unknown> | undefined) ?? {};
  const tractInc = (tract.income_brackets as Record<string, unknown> | undefined) ?? {};
  const tractEdu = (tract.education as Record<string, unknown> | undefined) ?? {};
  const countyRace = (county.race_ethnicity as Record<string, unknown> | undefined) ?? {};
  const countyInc = (county.income_brackets as Record<string, unknown> | undefined) ?? {};
  const countyEdu = (county.education as Record<string, unknown> | undefined) ?? {};

  if (lang === 'zh') {
    const lines = [
      '\n\n【人口与消费力——官方统计锚点（必须在 demographic_profile 最前面用 Markdown 表格或有序列表逐行引用；禁止用散文吞掉数字）】',
      cite,
      tractAvail
        ? `- 普查片区（Tract）名称：${tractName || '（见 ACS NAME 字段）'}`
        : '- 片区级 Tract 指标不可用：须说明原因，并**改用下方县级 County 指标**作为主要人口/收入依据。',
      tractAvail ? `- 片区总人口 B01003：${fmtQty(tract.population, 'zh')}` : '- 片区总人口：见县级',
      tractAvail ? `- 片区家庭收入中位数 B19013（USD）：${fmtUsd(tract.median_household_income_usd, 'zh')}` : '',
      tractAvail ? `- 片区人均收入 B19301（USD）：${fmtUsd(tract.per_capita_income_usd, 'zh')}` : '',
      tractAvail ? `- 片区年龄中位数 B01002：${fmtQty(tract.median_age, 'zh')}` : '',
      tractAvail ? `- 片区自有住房价值中位数 B25077（USD）：${fmtUsd(tract.median_home_value_usd, 'zh')}` : '',
      tractAvail ? `- 片区租金中位数 B25064（USD/月）：${fmtUsd(tract.median_gross_rent_usd, 'zh')}` : '',
      tractAvail ? `- 片区种族与西班牙裔 B03002（占比）：白人(NH) ${fmtPct(pickPct(tractRace.white_nh as _AcsShareLike), 'zh')}；亚裔(NH) ${fmtPct(pickPct(tractRace.asian_nh as _AcsShareLike), 'zh')}；黑人(NH) ${fmtPct(pickPct(tractRace.black_nh as _AcsShareLike), 'zh')}；西班牙裔(任何种族) ${fmtPct(pickPct(tractRace.hispanic_any_race as _AcsShareLike), 'zh')}` : '',
      tractAvail ? `- 片区家庭收入分布 B19001：≥$100k 占比 ${fmtPct(tractInc.pct_100k_plus, 'zh')}；≥$200k 占比 ${fmtPct(tractInc.pct_200k_plus, 'zh')}` : '',
      tractAvail ? `- 片区学历 B15003：本科及以上(25 岁+) 占比 ${fmtPct(tractEdu.bachelors_plus_pct, 'zh')}` : '',
      `- 所在县名称：${countyName || '（见 ACS NAME 字段）'}`,
      `- 县总人口 B01003：${fmtQty(county.population, 'zh')}`,
      `- 县家庭收入中位数 B19013（USD）：${fmtUsd(county.median_household_income_usd, 'zh')}`,
      `- 县人均收入 B19301（USD）：${fmtUsd(county.per_capita_income_usd, 'zh')}`,
      `- 县年龄中位数 B01002：${fmtQty(county.median_age, 'zh')}`,
      `- 县自有住房价值中位数 B25077（USD）：${fmtUsd(county.median_home_value_usd, 'zh')}`,
      `- 县租金中位数 B25064（USD/月）：${fmtUsd(county.median_gross_rent_usd, 'zh')}`,
      `- 县种族与西班牙裔 B03002（占比）：白人(NH) ${fmtPct(pickPct(countyRace.white_nh as _AcsShareLike), 'zh')}；亚裔(NH) ${fmtPct(pickPct(countyRace.asian_nh as _AcsShareLike), 'zh')}；黑人(NH) ${fmtPct(pickPct(countyRace.black_nh as _AcsShareLike), 'zh')}；西班牙裔(任何种族) ${fmtPct(pickPct(countyRace.hispanic_any_race as _AcsShareLike), 'zh')}`,
      `- 县家庭收入分布 B19001：≥$100k 占比 ${fmtPct(countyInc.pct_100k_plus, 'zh')}；≥$200k 占比 ${fmtPct(countyInc.pct_200k_plus, 'zh')}`,
      `- 县学历 B15003：本科及以上(25 岁+) 占比 ${fmtPct(countyEdu.bachelors_plus_pct, 'zh')}`,
      '',
      '【人口叙事写作铁律——D-3】',
      '- 任何「亚裔比例 / 西班牙裔比例 / 高收入家庭占比 / 本科及以上比例」等定量结论，**必须**直接引用上表中的具体百分比；若该数字为「数据抑制或缺失」，须明文写「ACS 该字段不可获取」并改用县级或附近片区数据替代，**禁止编造或写"数据抑制"作为结论**。',
      '- demographic_profile 必须新增 1 段「目标客群与消费力推演」：基于 ≥$100k / ≥$200k 家庭占比 + 本科以上学历占比 + 该业态(cuisine)的人均客单价区间，给出周中午餐 / 周末晚餐两个时段的可承受客单价区间（USD），并写明所引用的具体 ACS 字段。',
      '- 若 marketData.demographic_narrative 存在（Claude 预先生成的 McKinsey 风格段落），可作为参考结构与措辞，但不得复制超过 30 个连续汉字；最终段落须由你重新组织语言并补充与本店 cuisine 的关联。',
      '',
      '【贸易区与客流——量化要求】',
      '- trade_area_analysis 必须包含 **至少 5 行** 的 Markdown 表格，建议列：「范围/半径」「时段/日型（工作日午/工作日晚/周末）」「客流或需求假设」「依据」。',
      '- 「依据」列必须出现至少一次 **[ACS]**（引用上表人口或收入与餐饮客单价承受力）、至少一次 **[Places]**（引用 market_data 中 Google 检索样本数 N 或具体店名密度），其余可用 [检索]/[估算] 但必须写清推导一步。',
      '- 禁止仅用「人流较大/一般/较少」等无半径、无时段、无数字对照的套话；若缺硬客流数据，用表格行写 [估算] + 验证方式（计数器、门店蹲点、商圈报告等）。',
      '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  const lines = [
    '\n\n[DEMOGRAPHICS — OFFICIAL ANCHORS (demographic_profile MUST start with a Markdown table OR numbered list quoting EVERY line below; no burying numbers in vague prose)]',
    cite,
    tractAvail
      ? `- Census tract NAME: ${tractName || '(ACS NAME)'}`
      : '- Tract-level metrics unavailable: say why and use COUNTY metrics below as primary.',
    tractAvail ? `- Tract population B01003: ${fmtQty(tract.population, 'en')}` : '',
    tractAvail ? `- Tract median household income B19013 (USD): ${fmtUsd(tract.median_household_income_usd, 'en')}` : '',
    tractAvail ? `- Tract per capita income B19301 (USD): ${fmtUsd(tract.per_capita_income_usd, 'en')}` : '',
    tractAvail ? `- Tract median age B01002: ${fmtQty(tract.median_age, 'en')}` : '',
    tractAvail ? `- Tract median owner home value B25077 (USD): ${fmtUsd(tract.median_home_value_usd, 'en')}` : '',
    tractAvail ? `- Tract median gross rent B25064 (USD/mo): ${fmtUsd(tract.median_gross_rent_usd, 'en')}` : '',
    tractAvail ? `- Tract race & Hispanic B03002 (share): White(NH) ${fmtPct(pickPct(tractRace.white_nh as _AcsShareLike), 'en')}; Asian(NH) ${fmtPct(pickPct(tractRace.asian_nh as _AcsShareLike), 'en')}; Black(NH) ${fmtPct(pickPct(tractRace.black_nh as _AcsShareLike), 'en')}; Hispanic(any race) ${fmtPct(pickPct(tractRace.hispanic_any_race as _AcsShareLike), 'en')}` : '',
    tractAvail ? `- Tract HH income brackets B19001: share >= $100k ${fmtPct(tractInc.pct_100k_plus, 'en')}; share >= $200k ${fmtPct(tractInc.pct_200k_plus, 'en')}` : '',
    tractAvail ? `- Tract education B15003: bachelor's+ share of pop 25+ ${fmtPct(tractEdu.bachelors_plus_pct, 'en')}` : '',
    `- County NAME: ${countyName || '(ACS NAME)'}`,
    `- County population B01003: ${fmtQty(county.population, 'en')}`,
    `- County median household income B19013 (USD): ${fmtUsd(county.median_household_income_usd, 'en')}`,
    `- County per capita income B19301 (USD): ${fmtUsd(county.per_capita_income_usd, 'en')}`,
    `- County median age B01002: ${fmtQty(county.median_age, 'en')}`,
    `- County median owner home value B25077 (USD): ${fmtUsd(county.median_home_value_usd, 'en')}`,
    `- County median gross rent B25064 (USD/mo): ${fmtUsd(county.median_gross_rent_usd, 'en')}`,
    `- County race & Hispanic B03002 (share): White(NH) ${fmtPct(pickPct(countyRace.white_nh as _AcsShareLike), 'en')}; Asian(NH) ${fmtPct(pickPct(countyRace.asian_nh as _AcsShareLike), 'en')}; Black(NH) ${fmtPct(pickPct(countyRace.black_nh as _AcsShareLike), 'en')}; Hispanic(any race) ${fmtPct(pickPct(countyRace.hispanic_any_race as _AcsShareLike), 'en')}`,
    `- County HH income brackets B19001: share >= $100k ${fmtPct(countyInc.pct_100k_plus, 'en')}; share >= $200k ${fmtPct(countyInc.pct_200k_plus, 'en')}`,
    `- County education B15003: bachelor's+ share of pop 25+ ${fmtPct(countyEdu.bachelors_plus_pct, 'en')}`,
    '',
    '[DEMOGRAPHIC NARRATIVE RULES — D-3]',
    '- Any quantitative claim about Asian / Hispanic / high-income / bachelor\'s+ share MUST cite the percentage above; if a field shows "suppressed or missing", explicitly say so and fall back to county or nearby-tract data. Do NOT fabricate Census-style precision or just write "suppressed" as a conclusion.',
    '- demographic_profile MUST include a "target customer & purchasing power" paragraph that ties the >= $100k / >= $200k HH shares + bachelor\'s+ share + cuisine to a defensible weekday-lunch and weekend-dinner ticket band (USD), citing the exact ACS fields used.',
    '- If marketData.demographic_narrative exists (Claude-generated McKinsey-style paragraph), use it as a reference for structure/tone but do NOT copy more than ~20 contiguous words; you must rewrite and tie it to this specific cuisine.',
    '',
    '[TRADE AREA — QUANT RULES]',
    '- trade_area_analysis MUST include a Markdown table with **≥5 rows** (suggested columns: radius/range, daypart, demand/foot-traffic assumption, evidence).',
    '- Evidence column must cite **[ACS]** at least once (tie population/income to ticket affordability) and **[Places]** at least once (use Google sample count N or named competitor density from market_data). Other rows may use [search]/[estimate] but must show one-step reasoning.',
    '- Do not use generic “high/medium/low traffic” without radius, daypart, and numeric comparison vs ACS/Places.',
    '',
  ];
  return lines.filter(Boolean).join('\n');
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Accepts DB `market_data_json` or n8n `external_data`-shaped objects. */
/**
 * Short factual block for FREE partial analysis prompts (Places + ACS only).
 * Keeps gpt-4o-mini / n8n grounded without shipping full premium JSON into the user message.
 */
export function buildFreeTierMarketBrief(
  marketData: Record<string, unknown> | null | undefined,
  lang: Lang,
): string {
  if (!marketData || typeof marketData !== 'object' || Object.keys(marketData).length === 0) {
    return lang === 'zh'
      ? '【预检索】暂无结构化市场数据。三条 market_snapshot 须用 [估算] 标明假设，并写清如何核实（如 Google Maps 现场计数、商圈报告等）。'
      : '[Pre-fetch] No structured market data. Each market_snapshot line must label [estimate] + how to verify (e.g. Maps field count, trade-area report).';
  }

  const lines: string[] = [];
  const geo = marketData.geocode as Record<string, unknown> | undefined;
  const formatted =
    geo && typeof geo.formatted_address === 'string' ? String(geo.formatted_address).trim() : '';
  if (formatted) {
    lines.push(lang === 'zh' ? `地理编码地址：${formatted}` : `Geocoded: ${formatted}`);
  }

  const summary = extractMarketSummary(marketData);
  if (summary) {
    const ng = num(summary.competitor_count_google);
    const ny = num(summary.competitor_count_yelp);
    const n = Math.max(ng ?? 0, ny ?? 0);
    const gSamples = Array.isArray(summary.sample_competitors_google)
      ? (summary.sample_competitors_google as unknown[])
      : [];
    const names = gSamples
      .slice(0, 6)
      .map((row) => {
        if (!row || typeof row !== 'object') return '';
        return String((row as Record<string, unknown>).name ?? '').trim();
      })
      .filter(Boolean);
    if (lang === 'zh') {
      lines.push(
        `检索样本餐厅数 N≈${n}（Google/Yelp 较大值）；avg 评分约 ${num(summary.avg_rating_google) ?? num(summary.avg_rating_yelp) ?? '—'}`,
      );
      if (names.length) {
        lines.push(`Google 样本店名（market_snapshot 至少引用 1 个真名，勿改字）：${names.join('、')}`);
      }
    } else {
      lines.push(
        `Sample restaurant count N≈${n} (max of Google/Yelp); avg rating ~ ${num(summary.avg_rating_google) ?? num(summary.avg_rating_yelp) ?? 'n/a'}`,
      );
      if (names.length) {
        lines.push(`Google sample names (cite ≥1 verbatim in market_snapshot): ${names.join(', ')}`);
      }
    }
  } else {
    lines.push(
      lang === 'zh'
        ? 'summary 缺失：说明未拿到 Places 摘要，竞对用 [估算] + 核实方式。'
        : 'No Places summary: state gap; use [estimate] + verification path for competition.',
    );
  }

  const acs = marketData.acs_context;
  if (acs && typeof acs === 'object') {
    const a = acs as Record<string, unknown>;
    const tract = (a.tract as Record<string, unknown> | undefined) ?? {};
    const county = (a.county as Record<string, unknown> | undefined) ?? {};
    const tractAvail = a.tract_data_available === true;
    const mhiT = num(tract.median_household_income_usd);
    const mhiC = num(county.median_household_income_usd);
    const popT = num(tract.population);
    const popC = num(county.population);
    if (lang === 'zh') {
      if (tractAvail && (mhiT || popT)) {
        lines.push(
          `ACS：片区人口约 ${popT ?? '—'}，家庭收入中位数约 $${mhiT ?? '—'}（须在至少一条洞察中体现消费力含义）。`,
        );
      } else if (mhiC || popC) {
        lines.push(
          `ACS（县级）：人口约 ${popC ?? '—'}，家庭收入中位数约 $${mhiC ?? '—'}（引用时标注县级粒度）。`,
        );
      }
    } else {
      if (tractAvail && (mhiT || popT)) {
        lines.push(
          `ACS tract: population ~${popT ?? 'n/a'}, median household income ~$${mhiT ?? 'n/a'} (tie to ticket affordability in ≥1 insight).`,
        );
      } else if (mhiC || popC) {
        lines.push(
          `ACS county: population ~${popC ?? 'n/a'}, median household income ~$${mhiC ?? 'n/a'} (cite county granularity).`,
        );
      }
    }
  }

  const body = lines.join('\n');
  if (body.length <= FREE_BRIEF_MAX_CHARS) return body;
  return `${body.slice(0, FREE_BRIEF_MAX_CHARS)}…`;
}

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

/**
 * D-5: formats DeepSeek competitor insights into a prompt anchor block.
 * Forces the paid-report LLM to cite per-competitor positioning, complaints, and
 * gaps that DeepSeek already grounded in real review excerpts.
 */
export function buildCompetitorInsightsBlock(
  insights: CompetitorInsights | null | undefined,
  lang: Lang,
): string {
  if (
    !insights ||
    !Array.isArray(insights.per_competitor) ||
    insights.per_competitor.length === 0
  ) {
    return '';
  }

  const isZh = lang === 'zh';
  const lines: string[] = [];

  lines.push(
    isZh
      ? '\n\n【竞品深度洞察（DeepSeek-V3 基于 Google + Yelp 真实评论摘要——必须在 competition_landscape / competitors / opportunities 中引用，禁止抛弃）】'
      : '\n\n[COMPETITOR INSIGHTS — DeepSeek-V3 grounded summary of Google + Yelp reviews — MUST appear in competition_landscape / competitors / opportunities; do NOT discard]',
  );
  lines.push(
    isZh
      ? `- 评论摘要覆盖：Google ${insights.reviews_fetched.google_competitors} 家、Yelp ${insights.reviews_fetched.yelp_competitors} 家、共 ${insights.reviews_fetched.total_review_excerpts} 条评论片段。`
      : `- Review coverage: ${insights.reviews_fetched.google_competitors} Google + ${insights.reviews_fetched.yelp_competitors} Yelp, ${insights.reviews_fetched.total_review_excerpts} review excerpts total.`,
  );

  insights.per_competitor.forEach((row, i) => {
    const threatLabel = isZh
      ? row.threat_level === 'high'
        ? '高威胁'
        : row.threat_level === 'low'
          ? '低威胁'
          : '中等威胁'
      : row.threat_level;
    const ratingPart =
      row.rating != null && row.review_count != null
        ? ` ${row.rating}/5 · ${row.review_count} ${isZh ? '条评论' : 'reviews'}`
        : '';
    lines.push('');
    lines.push(
      `[#${i + 1}] ${row.name}${ratingPart}${row.price_tier ? ` · ${row.price_tier}` : ''} — ${threatLabel}`,
    );
    if (row.positioning) {
      lines.push(`  ${isZh ? '定位' : 'positioning'}: ${row.positioning}`);
    }
    if (row.signature_items.length) {
      lines.push(
        `  ${isZh ? '代表产品（来自评论/简介）' : 'signature items (from reviews/editorial)'}: ${row.signature_items.join(', ')}`,
      );
    }
    if (row.top_complaints.length) {
      lines.push(
        `  ${isZh ? '高频差评' : 'top complaints'}: ${row.top_complaints.join('; ')}`,
      );
    }
    if (row.top_praise.length) {
      lines.push(
        `  ${isZh ? '高频好评' : 'top praise'}: ${row.top_praise.join('; ')}`,
      );
    }
    if (row.pricing_perception) {
      lines.push(
        `  ${isZh ? '价格感知' : 'pricing perception'}: ${row.pricing_perception}`,
      );
    }
    const takeaway = isZh ? row.ai_takeaway_zh : row.ai_takeaway_en;
    if (takeaway) {
      lines.push(`  ${isZh ? '判断' : 'takeaway'}: ${takeaway}`);
    }
  });

  const cluster = isZh ? insights.cluster_summary_zh : insights.cluster_summary_en;
  if (cluster) {
    lines.push('');
    lines.push(isZh ? `【竞品集群总结】${cluster}` : `[CLUSTER SUMMARY] ${cluster}`);
  }
  const gaps = isZh ? insights.gaps_and_openings_zh : insights.gaps_and_openings_en;
  if (gaps) {
    lines.push(
      isZh
        ? `【市场缺口（必须在 opportunities 至少 1 条引用并扩写）】${gaps}`
        : `[GAPS & OPENINGS — must surface in at least 1 opportunity bullet, expanded with cuisine fit] ${gaps}`,
    );
  }

  lines.push('');
  lines.push(
    isZh
      ? '【硬性写作要求】(a) competitors 字段前 3 行必须从上方 [#1]/[#2]/[#3] 取真名，店名一字不改；(b) 「top_complaints / top_praise / signature_items」可作为 differentiators 与 opportunities 的事实依据；(c) cluster_summary 与 gaps 不得复制超过 30 个连续字符，须改写后融入对应段落。'
      : '[WRITING RULES] (a) The first 3 competitors[] rows MUST quote names verbatim from [#1]/[#2]/[#3] above; (b) Use top_complaints / top_praise / signature_items as evidence in differentiators + opportunities; (c) Do NOT copy more than ~20 contiguous words from cluster_summary or gaps — rewrite and tie to this cuisine.',
  );

  return lines.join('\n');
}

export function buildPremiumMarketDataSection(
  marketData: Record<string, unknown> | null | undefined,
  lang: Lang,
  opts?: { fullContext?: boolean },
): string {
  const fullContext = opts?.fullContext === true;
  const anchors = buildPremiumMarketAnchorsBlock(marketData, lang);
  const acsAnchors = buildAcsQuantAnchorsBlock(marketData, lang);
  
  let deepResearchBlock = '';
  const dr = marketData?.deep_research;
  if (dr && typeof dr === 'object') {
    const digest = summarizeDeepResearchForAnchors(dr as DeepResearchPack, lang);
    if (digest) {
      deepResearchBlock =
        lang === 'zh'
          ? `\n\n【Tavily 深度研究报告（麦肯锡级选址分析 — 必须参考并整合到报告各个部分；引用具体数据时标注 [DeepRes]）】\n${digest}`
          : `\n\n[TAVILY DEEP RESEARCH REPORT — McKinsey-level site analysis — integrate findings throughout report; cite with [DeepRes]]\n${digest}`;
    }
  }
  
  let webBlock = '';
  const wr = marketData?.web_research;
  if (wr && typeof wr === 'object') {
    const digest = summarizeWebResearchForAnchors(wr as WebResearchPack);
    if (digest) {
      webBlock =
        lang === 'zh'
          ? `\n\n【联网检索摘要（提炼进 key_evidence_points 与相关段落；每条注明来源域名或 [检索]；禁止大段抄袭）】\n${digest}`
          : `\n\n[WEB RESEARCH DIGEST — fold into key_evidence_points and narrative; cite domain or [search]; no copy-paste]\n${digest}`;
    }
  }

  let caltransBlock = '';
  const ct = marketData?.caltrans_traffic;
  if (ct && Array.isArray(ct) && ct.length > 0) {
    const digest = formatCaltransForAnchors(ct as CaltransAADTResult[], lang);
    if (digest) {
      caltransBlock =
        lang === 'zh'
          ? `\n\n${digest}`
          : `\n\n${digest}`;
    }
  }

  let listingsBlock = '';
  const cl = marketData?.commercial_listings;
  if (cl && typeof cl === 'object') {
    const digest = formatListingsForAnchors(cl as CommercialListingsResult, lang);
    if (digest) {
      listingsBlock =
        lang === 'zh'
          ? `\n\n${digest}`
          : `\n\n${digest}`;
    }
  }

  let brightdataBlock = '';
  const bd = marketData?.brightdata_research;
  if (bd && typeof bd === 'object') {
    const digest = formatBrightDataForAnchors(bd as MarketResearchResult, lang);
    if (digest) {
      brightdataBlock =
        lang === 'zh'
          ? `\n\n${digest}`
          : `\n\n${digest}`;
    }
  }

  let userInputsBlock = '';
  const ui = marketData?.user_inputs;
  if (ui && typeof ui === 'object') {
    const u = ui as Record<string, unknown>;
    const rent = u.monthly_rent_usd;
    const sq = u.sqft;
    if (rent != null || sq != null) {
      userInputsBlock =
        lang === 'zh'
          ? `\n\n【用户补充输入（必须用于 cost_pressure、break_even、rent 敏感性；勿忽略）】\n月租金 USD: ${rent ?? '未提供'}\n面积 sqft: ${sq ?? '未提供'}`
          : `\n\n[USER INPUTS — MUST use in cost_pressure, break_even, rent sensitivity]\nMonthly rent USD: ${rent ?? 'not provided'}\nSqft: ${sq ?? 'not provided'}`;
    }
  }

  // D-4: deterministic break-even / safe-revenue anchors. Must appear AFTER user
  // inputs so the LLM sees the resolved numbers (which already factor in those
  // inputs) and is forbidden to deviate.
  let financeModelBlock = '';
  const fm = marketData?.finance_model as DeterministicFinanceModel | undefined;
  if (fm && typeof fm === 'object' && typeof fm.break_even_revenue_monthly_usd === 'number') {
    financeModelBlock = formatFinanceModelForAnchors(fm, lang);
  }

  // D-5: DeepSeek competitor insights block (per-comp + cluster + gaps).
  let competitorInsightsBlock = '';
  const ci = marketData?.competitor_insights as CompetitorInsights | undefined;
  if (ci && typeof ci === 'object' && Array.isArray(ci.per_competitor) && ci.per_competitor.length) {
    competitorInsightsBlock = buildCompetitorInsightsBlock(ci, lang);
  }

  if (!marketData || typeof marketData !== 'object') {
    return `${anchors}${acsAnchors}${deepResearchBlock}${webBlock}${caltransBlock}${listingsBlock}${brightdataBlock}${userInputsBlock}${financeModelBlock}${competitorInsightsBlock}`;
  }

  const mdForJson = { ...marketData };
  if (!fullContext) {
    if (mdForJson.deep_research) {
      const drObj = mdForJson.deep_research as Record<string, unknown>;
      mdForJson.deep_research = {
        status: drObj.status,
        model: drObj.model,
        response_time_sec: drObj.response_time_sec,
        has_structured_report: Boolean(drObj.report),
        sources_count: Array.isArray(drObj.sources) ? drObj.sources.length : 0,
      };
    }
    if (mdForJson.competitor_insights) {
      const ciObj = mdForJson.competitor_insights as CompetitorInsights;
      mdForJson.competitor_insights = {
        provider: ciObj.provider,
        model: ciObj.model,
        per_competitor_count: ciObj.per_competitor?.length ?? 0,
        total_review_excerpts: ciObj.reviews_fetched?.total_review_excerpts ?? 0,
      } as unknown as CompetitorInsights;
    }
  }

  const evidencePreamble = fullContext
    ? lang === 'zh'
      ? '\n\n【全量证据块 — MiMo 1M 上下文】以下 JSON 含 ACS 全表、具名竞品、Yelp/Google 评论摘录、商业租盘、Caltrans 车流、竞品洞察全文。每个关键数字/店名必须来自本块或上方锚点；否则标 [估算] 或 data not retrieved。引用格式：[来源 · YYYY-MM-DD]。\n'
      : '\n\n[FULL EVIDENCE BLOCK — MiMo 1M context] JSON below includes full ACS, named competitors, Yelp/Google review excerpts, listings, Caltrans, competitor_insights. Every key number/name MUST come from this block or anchors above; else tag [estimate] or data not retrieved. Cite as [Source · YYYY-MM-DD].\n'
    : '';

  const jsonBlock =
    lang === 'zh'
      ? `${evidencePreamble}\n\n【市场数据原始 JSON（Google Places / Yelp / ACS / Caltrans / 商业房源 / BrightData / 深度研究${fullContext ? ' 全文' : ' meta'}）】\n${JSON.stringify(mdForJson, null, 2)}`
      : `${evidencePreamble}\n\nRAW MARKET DATA JSON (Google Places / Yelp / ACS / Caltrans / commercial listings / BrightData / deep research${fullContext ? ' full' : ' meta'}):\n${JSON.stringify(mdForJson, null, 2)}`;
  return `${anchors}${acsAnchors}${deepResearchBlock}${webBlock}${caltransBlock}${listingsBlock}${brightdataBlock}${userInputsBlock}${financeModelBlock}${competitorInsightsBlock}${jsonBlock}`;
}
