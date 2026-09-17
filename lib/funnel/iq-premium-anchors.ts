/**
 * Injects hard anchors into the paid-report LLM prompt so outputs vary by address
 * and cannot ignore retrieved competitor names / counts (reduces A/B/C placeholders
 * and identical revenue bands).
 */

import { type Locale, pick } from '@/lib/i18n/locale';
import { buildSiteHistoryBlock, type SiteHistoryPack } from '@/lib/funnel/external-data/site-history';
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
import { formatConclusionForAnchors, parseConclusion } from '@/lib/iq/conclusion/conclusion';
import {
  competitorClusterSummary,
  competitorGapsAndOpenings,
  competitorTakeaway,
  type CompetitorInsights,
} from '@/lib/funnel/iq-deepseek-competitor-insights';

type Lang = Locale;

const FREE_BRIEF_MAX_CHARS = 2_800;

const MISSING = { en: '(suppressed or missing)', zh: '（数据抑制或缺失）', es: '(suprimido o faltante)' };

function fmtQty(v: unknown, lang: Lang): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v.toLocaleString(pick(lang, { en: 'en-US', zh: 'zh-CN', es: 'en-US' }));
  }
  return pick(lang, MISSING);
}

function fmtUsd(v: unknown, lang: Lang): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = v.toLocaleString('en-US');
    return pick(lang, { en: `~$${n}`, zh: `约 $${n}`, es: `~$${n}` });
  }
  return pick(lang, MISSING);
}

function fmtPct(v: unknown, lang: Lang): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `${Math.round(v)}%`;
  return pick(lang, MISSING);
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
    return pick(lang, {
      en: '\n\n[DEMOGRAPHICS ANCHORS] No ACS tract/county pack (non-US or geocode failure). Open demographic_profile by stating no tract-level Census stats; then [estimate]/[search] only with sources—never fake Census precision.\n',
      zh: '\n\n【人口统计锚点】无 ACS 片区数据（常见于非美国地址或地理解析失败）。demographic_profile 首段须明确写「无普查片区级官方统计」，后续仅允许 [估算]/[检索] 并说明依据；禁止编造普查级精确数字。\n',
      es: '\n\n[ANCLAJES DEMOGRÁFICOS] No hay paquete ACS de tramo censal/condado (dirección fuera de EE. UU. o falla de geocodificación). Abre demographic_profile indicando que no hay estadísticas censales a nivel de tramo; después solo [estimación]/[búsqueda] con fuentes; nunca finjas precisión censal.\n',
    });
  }
  const a = acs as Record<string, unknown>;
  const tractAvail = a.tract_data_available === true;
  const tract = (a.tract as Record<string, unknown> | undefined) ?? {};
  const county = (a.county as Record<string, unknown> | undefined) ?? {};
  const cite = String(
    pick(lang, {
      en: a.citation_en,
      zh: a.citation_zh,
      es: typeof a.citation_es === 'string' && a.citation_es ? a.citation_es : a.citation_en,
    }),
  );

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

  if (lang === 'es') {
    const lines = [
      '\n\n[DEMOGRAFÍA — ANCLAJES OFICIALES (demographic_profile DEBE comenzar con una tabla Markdown O una lista numerada que cite CADA línea de abajo; no entierres las cifras en prosa vaga)]',
      cite,
      tractAvail
        ? `- Nombre del tramo censal: ${tractName || '(ACS NAME)'}`
        : '- Métricas a nivel de tramo no disponibles: explica por qué y usa las métricas del CONDADO de abajo como fuente principal.',
      tractAvail ? `- Población del tramo B01003: ${fmtQty(tract.population, 'es')}` : '',
      tractAvail ? `- Ingreso familiar mediano del tramo B19013 (USD): ${fmtUsd(tract.median_household_income_usd, 'es')}` : '',
      tractAvail ? `- Ingreso per cápita del tramo B19301 (USD): ${fmtUsd(tract.per_capita_income_usd, 'es')}` : '',
      tractAvail ? `- Edad mediana del tramo B01002: ${fmtQty(tract.median_age, 'es')}` : '',
      tractAvail ? `- Valor mediano de vivienda propia del tramo B25077 (USD): ${fmtUsd(tract.median_home_value_usd, 'es')}` : '',
      tractAvail ? `- Renta bruta mediana del tramo B25064 (USD/mes): ${fmtUsd(tract.median_gross_rent_usd, 'es')}` : '',
      tractAvail ? `- Raza e hispanos del tramo B03002 (participación): Blanca(NH) ${fmtPct(pickPct(tractRace.white_nh as _AcsShareLike), 'es')}; Asiática(NH) ${fmtPct(pickPct(tractRace.asian_nh as _AcsShareLike), 'es')}; Negra(NH) ${fmtPct(pickPct(tractRace.black_nh as _AcsShareLike), 'es')}; Hispana(cualquier raza) ${fmtPct(pickPct(tractRace.hispanic_any_race as _AcsShareLike), 'es')}` : '',
      tractAvail ? `- Rangos de ingreso familiar del tramo B19001: participación ≥ $100k ${fmtPct(tractInc.pct_100k_plus, 'es')}; participación ≥ $200k ${fmtPct(tractInc.pct_200k_plus, 'es')}` : '',
      tractAvail ? `- Educación del tramo B15003: participación con licenciatura o más (25+ años) ${fmtPct(tractEdu.bachelors_plus_pct, 'es')}` : '',
      `- Nombre del condado: ${countyName || '(ACS NAME)'}`,
      `- Población del condado B01003: ${fmtQty(county.population, 'es')}`,
      `- Ingreso familiar mediano del condado B19013 (USD): ${fmtUsd(county.median_household_income_usd, 'es')}`,
      `- Ingreso per cápita del condado B19301 (USD): ${fmtUsd(county.per_capita_income_usd, 'es')}`,
      `- Edad mediana del condado B01002: ${fmtQty(county.median_age, 'es')}`,
      `- Valor mediano de vivienda propia del condado B25077 (USD): ${fmtUsd(county.median_home_value_usd, 'es')}`,
      `- Renta bruta mediana del condado B25064 (USD/mes): ${fmtUsd(county.median_gross_rent_usd, 'es')}`,
      `- Raza e hispanos del condado B03002 (participación): Blanca(NH) ${fmtPct(pickPct(countyRace.white_nh as _AcsShareLike), 'es')}; Asiática(NH) ${fmtPct(pickPct(countyRace.asian_nh as _AcsShareLike), 'es')}; Negra(NH) ${fmtPct(pickPct(countyRace.black_nh as _AcsShareLike), 'es')}; Hispana(cualquier raza) ${fmtPct(pickPct(countyRace.hispanic_any_race as _AcsShareLike), 'es')}`,
      `- Rangos de ingreso familiar del condado B19001: participación ≥ $100k ${fmtPct(countyInc.pct_100k_plus, 'es')}; participación ≥ $200k ${fmtPct(countyInc.pct_200k_plus, 'es')}`,
      `- Educación del condado B15003: participación con licenciatura o más (25+ años) ${fmtPct(countyEdu.bachelors_plus_pct, 'es')}`,
      '',
      '[REGLAS DE NARRATIVA DEMOGRÁFICA — D-3]',
      '- Cualquier afirmación cuantitativa sobre participación asiática / hispana / de altos ingresos / con licenciatura DEBE citar el porcentaje de arriba; si un campo muestra "suprimido o faltante", dilo explícitamente y recurre a datos del condado o de un tramo cercano. NO fabriques precisión censal ni escribas "suprimido" como conclusión.',
      '- demographic_profile DEBE incluir un párrafo de "cliente objetivo y poder adquisitivo" que conecte las participaciones ≥ $100k / ≥ $200k + la participación con licenciatura + la cocina con una banda de ticket defendible (USD) para almuerzo entre semana y cena de fin de semana, citando los campos ACS exactos usados.',
      '- Si existe marketData.demographic_narrative (párrafo estilo McKinsey generado por Claude), úsalo como referencia de estructura y tono, pero NO copies más de ~20 palabras seguidas; debes reescribirlo y vincularlo a esta cocina específica.',
      '',
      '[ÁREA DE INFLUENCIA — REGLAS CUANTITATIVAS]',
      '- trade_area_analysis DEBE incluir una tabla Markdown con **≥5 filas** (columnas sugeridas: radio/rango, horario, supuesto de demanda/tráfico peatonal, evidencia).',
      '- La columna de evidencia debe citar **[ACS]** al menos una vez (vincula población/ingresos con la capacidad de pago del ticket) y **[Places]** al menos una vez (usa el conteo de muestra N de Google o la densidad de competidores con nombre de market_data). Otras filas pueden usar [búsqueda]/[estimación] pero deben mostrar un razonamiento de un paso.',
      '- No uses un genérico "tráfico alto/medio/bajo" sin radio, horario y comparación numérica contra ACS/Places.',
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

/**
 * Short factual block for FREE partial analysis prompts (Places + ACS only).
 * Keeps gpt-4o-mini / n8n grounded without shipping full premium JSON into the user message.
 */
export function buildFreeTierMarketBrief(
  marketData: Record<string, unknown> | null | undefined,
  lang: Lang,
): string {
  if (!marketData || typeof marketData !== 'object' || Object.keys(marketData).length === 0) {
    return pick(lang, {
      en: '[Pre-fetch] No structured market data. Each market_snapshot line must label [estimate] + how to verify (e.g. Maps field count, trade-area report).',
      zh: '【预检索】暂无结构化市场数据。三条 market_snapshot 须用 [估算] 标明假设，并写清如何核实（如 Google Maps 现场计数、商圈报告等）。',
      es: '[Precarga] No hay datos de mercado estructurados. Cada línea de market_snapshot debe marcar [estimación] + cómo verificar (p. ej., conteo en Maps, informe del área de influencia).',
    });
  }

  const lines: string[] = [];
  const geo = marketData.geocode as Record<string, unknown> | undefined;
  const formatted =
    geo && typeof geo.formatted_address === 'string' ? String(geo.formatted_address).trim() : '';
  if (formatted) {
    lines.push(
      pick(lang, {
        en: `Geocoded: ${formatted}`,
        zh: `地理编码地址：${formatted}`,
        es: `Geocodificado: ${formatted}`,
      }),
    );
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
    const avg = num(summary.avg_rating_google) ?? num(summary.avg_rating_yelp);
    lines.push(
      pick(lang, {
        en: `Sample restaurant count N≈${n} (max of Google/Yelp); avg rating ~ ${avg ?? 'n/a'}`,
        zh: `检索样本餐厅数 N≈${n}（Google/Yelp 较大值）；avg 评分约 ${avg ?? '—'}`,
        es: `Conteo de restaurantes de muestra N≈${n} (máximo entre Google/Yelp); calificación promedio ~ ${avg ?? 'n/d'}`,
      }),
    );
    if (names.length) {
      lines.push(
        pick(lang, {
          en: `Google sample names (cite ≥1 verbatim in market_snapshot): ${names.join(', ')}`,
          zh: `Google 样本店名（market_snapshot 至少引用 1 个真名，勿改字）：${names.join('、')}`,
          es: `Nombres de la muestra de Google (cita ≥1 textualmente en market_snapshot): ${names.join(', ')}`,
        }),
      );
    }
  } else {
    lines.push(
      pick(lang, {
        en: 'No Places summary: state gap; use [estimate] + verification path for competition.',
        zh: 'summary 缺失：说明未拿到 Places 摘要，竞对用 [估算] + 核实方式。',
        es: 'Sin resumen de Places: declara el vacío; usa [estimación] + ruta de verificación para la competencia.',
      }),
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
    const na = pick(lang, { en: 'n/a', zh: '—', es: 'n/d' });
    if (tractAvail && (mhiT || popT)) {
      lines.push(
        pick(lang, {
          en: `ACS tract: population ~${popT ?? na}, median household income ~$${mhiT ?? na} (tie to ticket affordability in ≥1 insight).`,
          zh: `ACS：片区人口约 ${popT ?? na}，家庭收入中位数约 $${mhiT ?? na}（须在至少一条洞察中体现消费力含义）。`,
          es: `Tramo ACS: población ~${popT ?? na}, ingreso familiar mediano ~$${mhiT ?? na} (vincúlalo con la capacidad de pago del ticket en ≥1 hallazgo).`,
        }),
      );
    } else if (mhiC || popC) {
      lines.push(
        pick(lang, {
          en: `ACS county: population ~${popC ?? na}, median household income ~$${mhiC ?? na} (cite county granularity).`,
          zh: `ACS（县级）：人口约 ${popC ?? na}，家庭收入中位数约 $${mhiC ?? na}（引用时标注县级粒度）。`,
          es: `Condado ACS: población ~${popC ?? na}, ingreso familiar mediano ~$${mhiC ?? na} (indica que es granularidad de condado).`,
        }),
      );
    }
  }

  const body = lines.join('\n');
  if (body.length <= FREE_BRIEF_MAX_CHARS) return body;
  return `${body.slice(0, FREE_BRIEF_MAX_CHARS)}…`;
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
    return pick(lang, {
      en: '\n\n[SYSTEM ANCHORS] No market_data: state explicitly in JSON; use [estimate] for competitors; no A/B/C names; derive three revenue scenarios from address + concept—do not reuse a canned band.\n',
      zh: '\n\n【系统锚点】未提供 market_data：须在 JSON 中明确写「无外部检索数据」，competitors 用 [估算] 距离与类别，禁止编造 A/B/C 代号店名；三场景营收须根据地址与业态单独推导并写清假设，禁止复用固定区间套话。\n',
      es: '\n\n[ANCLAJES DEL SISTEMA] Sin market_data: indícalo explícitamente en el JSON; usa [estimación] para los competidores; sin nombres A/B/C; deriva los tres escenarios de ingresos de la dirección + el concepto; no reutilices una banda genérica.\n',
    });
  }

  const summary = extractMarketSummary(marketData);
  if (!summary) {
    return pick(lang, {
      en: '\n\n[SYSTEM ANCHORS] market_data present but no parsable summary: infer competitor signals from raw JSON if any; no A/B/C names; revenue scenarios must be address-specific.\n',
      zh: '\n\n【系统锚点】已提供 market_data 但缺少可解析的 summary：须从原始 JSON 提炼竞对数量/店名（若有），禁止 A/B/C 代号；三场景营收须与本地址绑定推导。\n',
      es: '\n\n[ANCLAJES DEL SISTEMA] Hay market_data pero sin un summary analizable: infiere señales de competidores del JSON crudo si las hay; sin nombres A/B/C; los escenarios de ingresos deben ser específicos de la dirección.\n',
    });
  }

  const gSamples = Array.isArray(summary.sample_competitors_google)
    ? (summary.sample_competitors_google as unknown[])
    : [];
  const ySamples = Array.isArray(summary.sample_competitors_yelp)
    ? (summary.sample_competitors_yelp as unknown[])
    : [];

  const toNames = (rows: unknown[]) =>
    rows
      .slice(0, 10)
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const name = String((row as Record<string, unknown>).name ?? '').trim();
        return name || null;
      })
      .filter((x): x is string => Boolean(x));
  const googleNames = toNames(gSamples);
  const yelpNames = toNames(ySamples);

  const anchors = computeRevenueAnchorsUsd(summary);
  const n = anchors?.n ?? 0;
  const low = anchors?.low ?? 0;
  const mid = anchors?.mid ?? 0;
  const high = anchors?.high ?? 0;
  const firstRows = Math.min(5, googleNames.length);

  if (lang === 'zh') {
    const lines = [
      '\n\n【系统数据锚点——必须体现在 JSON 的叙述与结构化字段中，禁止用泛泛模板覆盖】',
      `- 检索样本餐厅数 N=${n}（须在 competition_landscape、revenue_estimate、risk/opportunity 中至少一处显式引用）。`,
      googleNames.length
        ? `- Google 样本店名（须优先用于 competitors 前 ${firstRows} 行，店名一字不改；禁止改为「A外卖/B快餐/竞品C」等代号）：${googleNames.join('、')}`
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

  if (lang === 'es') {
    const lines = [
      '\n\n[ANCLAJES DE DATOS DEL SISTEMA — deben aparecer en la prosa Y en los campos estructurados del JSON]',
      `- Conteo de restaurantes de muestra recuperados N=${n} (cita N en competition_landscape, en la narrativa de ingresos y/o en risks/opportunities).`,
      googleNames.length
        ? `- Nombres de la muestra de Google (úsalos textualmente en las primeras ${firstRows} filas de competitors; SIN marcadores A/B/C): ${googleNames.join(', ')}`
        : '- Sin nombres de Google: explícalo en la prosa; usa distancias [estimación]; sigue sin usar marcadores A/B/C.',
      yelpNames.length
        ? `- Nombres de la muestra de Yelp (cita ≥2 nombres reales con contexto de calificación/reseñas cuando exista): ${yelpNames.join(', ')}`
        : '- Sin muestra de Yelp: indica que Yelp no devolvió datos o no está conectado; no inventes estadísticas de reseñas.',
      `- Los tres escenarios de monthly_revenue_usd deben centrarse en ~$${low} / $${mid} / $${high} (±25% aceptable); key_assumptions DEBE vincularse con N y con las señales de reseñas/calificación; NO devuelvas bandas de ingresos idénticas para direcciones distintas.`,
      '- Cada una de las 3 opportunities DEBE citar un hecho concreto de este market_data (N, un nombre de la muestra o el texto de geocode); NO deben duplicar las 5 viñetas de riesgo.',
      '- Números de rutas de transporte / tráfico peatonal preciso sin fuentes → etiqueta [por verificar] + cómo verificarlo; no inventes.',
    ];
    return lines.join('\n');
  }

  const lines = [
    '\n\n[SYSTEM DATA ANCHORS — must appear in JSON prose AND structured fields]',
    `- Retrieved sample restaurant count N=${n} (cite N in competition_landscape, revenue narrative, and/or risks/opportunities).`,
    googleNames.length
      ? `- Google sample names (use verbatim for the first ${firstRows} competitors rows; NO A/B/C placeholders): ${googleNames.join(', ')}`
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

  const lines: string[] = [];
  const rf = insights.reviews_fetched;

  lines.push(
    pick(lang, {
      en: '\n\n[COMPETITOR INSIGHTS — DeepSeek-V3 grounded summary of Google + Yelp reviews — MUST appear in competition_landscape / competitors / opportunities; do NOT discard]',
      zh: '\n\n【竞品深度洞察（DeepSeek-V3 基于 Google + Yelp 真实评论摘要——必须在 competition_landscape / competitors / opportunities 中引用，禁止抛弃）】',
      es: '\n\n[HALLAZGOS SOBRE COMPETIDORES — resumen de DeepSeek-V3 basado en reseñas reales de Google + Yelp — DEBE aparecer en competition_landscape / competitors / opportunities; NO lo descartes]',
    }),
  );
  lines.push(
    pick(lang, {
      en: `- Review coverage: ${rf.google_competitors} Google + ${rf.yelp_competitors} Yelp, ${rf.total_review_excerpts} review excerpts total.`,
      zh: `- 评论摘要覆盖：Google ${rf.google_competitors} 家、Yelp ${rf.yelp_competitors} 家、共 ${rf.total_review_excerpts} 条评论片段。`,
      es: `- Cobertura de reseñas: ${rf.google_competitors} de Google + ${rf.yelp_competitors} de Yelp, ${rf.total_review_excerpts} extractos de reseñas en total.`,
    }),
  );

  const threatLabels: Record<'high' | 'medium' | 'low', Record<Locale, string>> = {
    high: { en: 'high threat', zh: '高威胁', es: 'amenaza alta' },
    medium: { en: 'medium threat', zh: '中等威胁', es: 'amenaza media' },
    low: { en: 'low threat', zh: '低威胁', es: 'amenaza baja' },
  };
  const labels = {
    reviews: pick(lang, { en: 'reviews', zh: '条评论', es: 'reseñas' }),
    positioning: pick(lang, { en: 'positioning', zh: '定位', es: 'posicionamiento' }),
    signature: pick(lang, {
      en: 'signature items (from reviews/editorial)',
      zh: '代表产品（来自评论/简介）',
      es: 'productos emblemáticos (según reseñas/editorial)',
    }),
    complaints: pick(lang, { en: 'top complaints', zh: '高频差评', es: 'quejas principales' }),
    praise: pick(lang, { en: 'top praise', zh: '高频好评', es: 'elogios principales' }),
    pricing: pick(lang, { en: 'pricing perception', zh: '价格感知', es: 'percepción de precio' }),
    takeaway: pick(lang, { en: 'takeaway', zh: '判断', es: 'conclusión' }),
  };

  insights.per_competitor.forEach((row, i) => {
    const threatLabel = pick(lang, threatLabels[row.threat_level] ?? threatLabels.medium);
    const ratingPart =
      row.rating != null && row.review_count != null
        ? ` ${row.rating}/5 · ${row.review_count} ${labels.reviews}`
        : '';
    lines.push('');
    lines.push(
      `[#${i + 1}] ${row.name}${ratingPart}${row.price_tier ? ` · ${row.price_tier}` : ''} — ${threatLabel}`,
    );
    if (row.positioning) lines.push(`  ${labels.positioning}: ${row.positioning}`);
    if (row.signature_items.length) lines.push(`  ${labels.signature}: ${row.signature_items.join(', ')}`);
    if (row.top_complaints.length) lines.push(`  ${labels.complaints}: ${row.top_complaints.join('; ')}`);
    if (row.top_praise.length) lines.push(`  ${labels.praise}: ${row.top_praise.join('; ')}`);
    if (row.pricing_perception) lines.push(`  ${labels.pricing}: ${row.pricing_perception}`);
    const takeaway = competitorTakeaway(row, lang);
    if (takeaway) lines.push(`  ${labels.takeaway}: ${takeaway}`);
  });

  const cluster = competitorClusterSummary(insights, lang);
  if (cluster) {
    lines.push('');
    lines.push(
      pick(lang, {
        en: `[CLUSTER SUMMARY] ${cluster}`,
        zh: `【竞品集群总结】${cluster}`,
        es: `[RESUMEN DEL CLÚSTER] ${cluster}`,
      }),
    );
  }
  const gaps = competitorGapsAndOpenings(insights, lang);
  if (gaps) {
    lines.push(
      pick(lang, {
        en: `[GAPS & OPENINGS — must surface in at least 1 opportunity bullet, expanded with cuisine fit] ${gaps}`,
        zh: `【市场缺口（必须在 opportunities 至少 1 条引用并扩写）】${gaps}`,
        es: `[BRECHAS Y OPORTUNIDADES — deben aparecer en al menos 1 viñeta de opportunities, ampliada con el encaje de la cocina] ${gaps}`,
      }),
    );
  }

  lines.push('');
  lines.push(
    pick(lang, {
      en: '[WRITING RULES] (a) The first 3 competitors[] rows MUST quote names verbatim from [#1]/[#2]/[#3] above; (b) Use top_complaints / top_praise / signature_items as evidence in differentiators + opportunities; (c) Do NOT copy more than ~20 contiguous words from cluster_summary or gaps — rewrite and tie to this cuisine.',
      zh: '【硬性写作要求】(a) competitors 字段前 3 行必须从上方 [#1]/[#2]/[#3] 取真名，店名一字不改；(b) 「top_complaints / top_praise / signature_items」可作为 differentiators 与 opportunities 的事实依据；(c) cluster_summary 与 gaps 不得复制超过 30 个连续字符，须改写后融入对应段落。',
      es: '[REGLAS DE REDACCIÓN] (a) Las primeras 3 filas de competitors[] DEBEN citar los nombres textualmente de [#1]/[#2]/[#3] arriba; (b) Usa top_complaints / top_praise / signature_items como evidencia en diferenciadores + opportunities; (c) NO copies más de ~20 palabras seguidas de cluster_summary o gaps; reescribe y vincula con esta cocina.',
    }),
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
      deepResearchBlock = pick(lang, {
        en: `\n\n[DEEP MARKET RESEARCH REPORT — integrate findings throughout report; cite with [DeepRes]]\n${digest}`,
        zh: `\n\n【深度市场研究报告 — 必须参考并整合到报告各个部分；引用具体数据时标注 [DeepRes]】\n${digest}`,
        es: `\n\n[INFORME DE INVESTIGACIÓN PROFUNDA DE MERCADO — integra los hallazgos en todo el informe; cita con [DeepRes]]\n${digest}`,
      });
    }
  }

  let webBlock = '';
  const wr = marketData?.web_research;
  if (wr && typeof wr === 'object') {
    const digest = summarizeWebResearchForAnchors(wr as WebResearchPack);
    if (digest) {
      webBlock = pick(lang, {
        en: `\n\n[WEB RESEARCH DIGEST — fold into key_evidence_points and narrative; cite domain or [search]; no copy-paste]\n${digest}`,
        zh: `\n\n【联网检索摘要（提炼进 key_evidence_points 与相关段落；每条注明来源域名或 [检索]；禁止大段抄袭）】\n${digest}`,
        es: `\n\n[RESUMEN DE INVESTIGACIÓN WEB — intégralo en key_evidence_points y en la narrativa; cita el dominio o [búsqueda]; sin copiar y pegar]\n${digest}`,
      });
    }
  }

  let caltransBlock = '';
  const ct = marketData?.caltrans_traffic;
  if (ct && Array.isArray(ct) && ct.length > 0) {
    const digest = formatCaltransForAnchors(ct as CaltransAADTResult[], lang);
    if (digest) caltransBlock = `\n\n${digest}`;
  }

  let listingsBlock = '';
  const cl = marketData?.commercial_listings;
  if (cl && typeof cl === 'object') {
    const digest = formatListingsForAnchors(cl as CommercialListingsResult, lang);
    if (digest) listingsBlock = `\n\n${digest}`;
  }

  let brightdataBlock = '';
  const bd = marketData?.brightdata_research;
  if (bd && typeof bd === 'object') {
    const digest = formatBrightDataForAnchors(bd as MarketResearchResult, lang);
    if (digest) brightdataBlock = `\n\n${digest}`;
  }

  let userInputsBlock = '';
  const ui = marketData?.user_inputs;
  if (ui && typeof ui === 'object') {
    const u = ui as Record<string, unknown>;
    const rent = u.monthly_rent_usd;
    const sq = u.sqft;
    if (rent != null || sq != null) {
      userInputsBlock = pick(lang, {
        en: `\n\n[USER INPUTS — MUST use in cost_pressure, break_even, rent sensitivity]\nMonthly rent USD: ${rent ?? 'not provided'}\nSqft: ${sq ?? 'not provided'}`,
        zh: `\n\n【用户补充输入（必须用于 cost_pressure、break_even、rent 敏感性；勿忽略）】\n月租金 USD: ${rent ?? '未提供'}\n面积 sqft: ${sq ?? '未提供'}`,
        es: `\n\n[DATOS DEL USUARIO — DEBEN usarse en cost_pressure, break_even y la sensibilidad a la renta]\nRenta mensual USD: ${rent ?? 'no proporcionada'}\nPies cuadrados: ${sq ?? 'no proporcionados'}`,
      });
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

  // §4.1 单一结论源 (P0-A): when the deterministic core has already run (it now runs
  // BEFORE the draft), its conclusion is the last and strongest anchor block — the
  // prose must not contradict the score, verdict, break-even or scenarios the page
  // and the PDF will print. It deliberately comes after the finance model block.
  const conclusion = parseConclusion(marketData?.conclusion);
  const conclusionBlock = conclusion ? formatConclusionForAnchors(conclusion, lang) : '';

  // D-5: DeepSeek competitor insights block (per-comp + cluster + gaps).
  let competitorInsightsBlock = '';
  const ci = marketData?.competitor_insights as CompetitorInsights | undefined;
  if (ci && typeof ci === 'object' && Array.isArray(ci.per_competitor) && ci.per_competitor.length) {
    competitorInsightsBlock = buildCompetitorInsightsBlock(ci, lang);
  }

  // Businesses at the exact address + reviews — grounds `site_history`.
  const siteHistoryBlock = buildSiteHistoryBlock(
    marketData?.site_history as SiteHistoryPack | undefined,
    lang,
  );

  if (!marketData || typeof marketData !== 'object') {
    return `${anchors}${acsAnchors}${deepResearchBlock}${webBlock}${caltransBlock}${listingsBlock}${brightdataBlock}${userInputsBlock}${financeModelBlock}${conclusionBlock}${competitorInsightsBlock}${siteHistoryBlock}`;
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
    if (mdForJson.site_history) {
      // The anchor block above already carries the reviews; keep the JSON slim.
      const sh = mdForJson.site_history as SiteHistoryPack;
      mdForJson.site_history = {
        businesses: Array.isArray(sh.businesses)
          ? sh.businesses.map((b) => ({ name: b.name, source: b.source, status: b.status, rating: b.rating, review_count: b.review_count }))
          : [],
        closed_count: sh.closed_count,
        total_reviews_sampled: sh.total_reviews_sampled,
      } as unknown as SiteHistoryPack;
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
    ? pick(lang, {
        en: '\n\n[FULL EVIDENCE BLOCK] JSON below includes full ACS, named competitors, Yelp/Google review excerpts, listings, Caltrans, competitor_insights. Every key number/name MUST come from this block or anchors above; else tag [estimate] or data not retrieved. Cite as [Source · YYYY-MM-DD].\n',
        zh: '\n\n【全量证据块】以下 JSON 含 ACS 全表、具名竞品、Yelp/Google 评论摘录、商业租盘、Caltrans 车流、竞品洞察全文。每个关键数字/店名必须来自本块或上方锚点；否则标 [估算] 或 data not retrieved。引用格式：[来源 · YYYY-MM-DD]。\n',
        es: '\n\n[BLOQUE DE EVIDENCIA COMPLETO] El JSON siguiente incluye el ACS completo, competidores con nombre, extractos de reseñas de Yelp/Google, locales en renta, Caltrans y competitor_insights. Cada cifra/nombre clave DEBE provenir de este bloque o de los anclajes anteriores; de lo contrario etiqueta [estimación] o "dato no recuperado". Cita como [Fuente · AAAA-MM-DD].\n',
      })
    : '';

  let jsonPayload = JSON.stringify(mdForJson, null, 2);
  const maxJsonChars = fullContext ? 380_000 : 120_000;
  if (jsonPayload.length > maxJsonChars) {
    jsonPayload = `${jsonPayload.slice(0, maxJsonChars)}\n…(truncated)`;
  }

  const jsonBlock = pick(lang, {
    en: `${evidencePreamble}\n\nMARKET DATA JSON${fullContext ? ' (full)' : ''}:\n${jsonPayload}`,
    zh: `${evidencePreamble}\n\n【市场数据 JSON${fullContext ? '（全文）' : ''}】\n${jsonPayload}`,
    es: `${evidencePreamble}\n\nJSON DE DATOS DE MERCADO${fullContext ? ' (completo)' : ''}:\n${jsonPayload}`,
  });
  return `${anchors}${acsAnchors}${deepResearchBlock}${webBlock}${caltransBlock}${listingsBlock}${brightdataBlock}${userInputsBlock}${financeModelBlock}${conclusionBlock}${competitorInsightsBlock}${siteHistoryBlock}${jsonBlock}`;
}
