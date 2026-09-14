/**
 * Specialist analyst agents — each mirrors one role on a professional site-selection
 * engagement team and receives only its discipline's data slice plus the shared
 * deterministic metrics. All scores are 0–100 where higher = better for the operator.
 *
 * Dimension ownership (V2.0 weights used later by synthesis):
 * - market analyst      → demographic_fit (20%)
 * - competition analyst → competitive_position (20%)
 * - site analyst        → foot_traffic (25%) + accessibility (20%)
 * - financial analyst   → rent_value (15%)
 * - risk analyst        → no weight; produces the risk matrix + failure scenarios
 */

import { z } from 'zod';
import { pick } from '@/lib/i18n/locale';
import { LANGUAGE_INSTRUCTION } from '@/lib/funnel/iq-prompts-locationiq-v2';
import type { Lang, SiteMetrics, SpecialistFinding } from './types';
import { formatMetricsDigest } from './metrics';
import { completeJson } from './llm';

const findingSchema = z.object({
  score_100: z.number().min(0).max(100),
  score_rationale: z.string(),
  narrative: z.string(),
  key_findings: z.array(z.string()).min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type SpecialistInput = {
  location: string;
  businessType: string;
  language: Lang;
  metrics: SiteMetrics;
  marketData: Record<string, unknown>;
};

/** Shared grounding rules injected into every specialist system prompt. */
function groundingRules(lang: Lang): string {
  return pick(lang, {
    en: [
      'DATA DISCIPLINE (mandatory):',
      '1. Numbers in the [COMPUTED METRICS] block are formula-derived — quote them verbatim; never round them into "nicer" numbers.',
      '2. Do not invent precise figures beyond computed metrics and raw data; inferred values must be tagged [estimate] with one-step reasoning.',
      '3. Every claim follows: fact or [estimate] → impact on the opening decision → one actionable suggestion.',
      '4. State data gaps explicitly; never paper over them with vague phrases ("high foot traffic" without radius/daypart/number is banned).',
      '5. Output strict JSON (no markdown fences); fields are specified in the user message. Markdown tables ARE allowed inside narrative strings.',
      `6. ${LANGUAGE_INSTRUCTION.en} Every JSON string value must be in English; keys stay as specified.`,
    ].join('\n'),
    zh: [
      '数据纪律（必须遵守）：',
      '1. 【计算指标】块中的数字来自公式计算，必须原样引用，禁止改写或"取整成更好看的数"。',
      '2. 除计算指标与原始数据中出现的数字外，禁止编造精确数值；推断值必须标注[估算]并给出一步推导。',
      '3. 每条判断遵循：事实或[估算] → 对开店决策的影响 → 可执行建议。',
      '4. 数据缺口须明说，不许用套话掩盖（禁止"人流较大"这类无半径、无时段、无数字的表述）。',
      '5. 输出严格 JSON（无 Markdown 代码块包裹），字段见用户消息。narrative 内部允许 Markdown 表格。',
      `6. ${LANGUAGE_INSTRUCTION.zh} 所有 JSON 字符串值使用简体中文；键名保持不变。`,
    ].join('\n'),
    es: [
      'DISCIPLINA DE DATOS (obligatoria):',
      '1. Las cifras del bloque [MÉTRICAS CALCULADAS] provienen de fórmulas: cítalas textualmente; nunca las redondees a números "más bonitos".',
      '2. No inventes cifras precisas más allá de las métricas calculadas y los datos crudos; los valores inferidos deben llevar la etiqueta [estimación] con un razonamiento de un paso.',
      '3. Cada afirmación sigue: hecho o [estimación] → impacto en la decisión de apertura → una sugerencia accionable.',
      '4. Declara los vacíos de datos explícitamente; nunca los ocultes con frases vagas ("alto tráfico peatonal" sin radio/horario/cifra está prohibido).',
      '5. Devuelve JSON estricto (sin bloques markdown); los campos se especifican en el mensaje del usuario. SÍ se permiten tablas Markdown dentro de las cadenas narrative.',
      `6. ${LANGUAGE_INSTRUCTION.es} Todos los valores de texto del JSON deben estar en español; las claves se conservan tal como se especifican.`,
    ].join('\n'),
  });
}

function outputSpec(lang: Lang, payloadHint: string): string {
  return pick(lang, {
    en: [
      'Output JSON fields:',
      '{',
      '  "score_100": number 0-100 (higher = better for the operator),',
      '  "score_rationale": "scoring basis, citing specific numbers",',
      '  "narrative": "full section body (Markdown, include at least one table)",',
      '  "key_findings": ["3-6 hard conclusions the synthesis writer must not drop"],',
      `  "payload": ${payloadHint},`,
      '  "confidence": "high|medium|low (based on data coverage)"',
      '}',
    ].join('\n'),
    zh: [
      '输出 JSON 字段：',
      '{',
      '  "score_100": 0-100 数值（越高对经营者越有利）,',
      '  "score_rationale": "评分依据，引用具体数字",',
      '  "narrative": "该章节完整分析正文（Markdown，含至少一个表格）",',
      '  "key_findings": ["3-6 条硬结论，综合撰写人不得丢弃"],',
      `  "payload": ${payloadHint},`,
      '  "confidence": "high|medium|low（依据数据覆盖度）"',
      '}',
    ].join('\n'),
    es: [
      'Campos JSON de salida:',
      '{',
      '  "score_100": número 0-100 (más alto = mejor para el operador),',
      '  "score_rationale": "base de la puntuación, citando cifras concretas",',
      '  "narrative": "cuerpo completo de la sección (Markdown, incluye al menos una tabla)",',
      '  "key_findings": ["3-6 conclusiones firmes que el redactor de síntesis no debe omitir"],',
      `  "payload": ${payloadHint},`,
      '  "confidence": "high|medium|low (según la cobertura de datos)"',
      '}',
    ].join('\n'),
  });
}

type SpecialistDef = {
  discipline: SpecialistFinding['discipline'];
  system: (lang: Lang) => string;
  user: (input: SpecialistInput) => string;
};

function jsonSlice(obj: unknown, maxChars = 6_000): string {
  try {
    const s = JSON.stringify(obj ?? null, null, 1);
    return s.length > maxChars ? s.slice(0, maxChars) + '…(truncated)' : s;
  } catch {
    return 'null';
  }
}

/** Common header lines shared by every specialist user prompt. */
function headerLines(i: SpecialistInput): string[] {
  return [
    pick(i.language, {
      en: `Address: ${i.location}`,
      zh: `地址：${i.location}`,
      es: `Dirección: ${i.location}`,
    }),
    pick(i.language, {
      en: `Concept: ${i.businessType}`,
      zh: `业态：${i.businessType}`,
      es: `Concepto: ${i.businessType}`,
    }),
  ];
}

function cuisineNotes(i: SpecialistInput): string {
  return pick(i.language, {
    en: i.metrics.cuisine.notes_en,
    zh: i.metrics.cuisine.notes_zh,
    es: i.metrics.cuisine.notes_es,
  });
}

const WEB_DIGEST_LABEL = { en: '[WEB RESEARCH DIGEST]', zh: '【联网检索摘要】', es: '[RESUMEN DE INVESTIGACIÓN WEB]' };

const marketAnalyst: SpecialistDef = {
  discipline: 'market',
  system: (lang) =>
    pick(lang, {
      en: 'You are the market & demographics analyst on a site-selection engagement team (15 yrs experience). Scope: trade-area definition, demographic & spending-power profile, demand-pool sizing, daytime vs residential population by daypart. Methodology: primary trade area = 50–80% of customers (5–10 min drive); secondary = 15–30%; lunch concepts key on daytime workers, dinner concepts on rooftops × income.',
      zh: '你是选址咨询团队的市场与人口分析师（15年经验）。职责：贸易区定义、人口与消费力画像、需求池测算、日间人口 vs 居住人口的时段结构。方法论：主贸易区=50-80%客源（车程5-10分钟），次级=15-30%；午市业态看日间上班人口，晚市业态看居住人口×收入。',
      es: 'Eres el analista de mercado y demografía de un equipo de selección de ubicaciones (15 años de experiencia). Alcance: definición del área de influencia, perfil demográfico y de poder adquisitivo, dimensionamiento del pool de demanda, población diurna vs. residencial por horario. Metodología: área de influencia primaria = 50–80% de los clientes (5–10 min en auto); secundaria = 15–30%; los conceptos de almuerzo dependen de los trabajadores diurnos, los de cena de los hogares × ingreso.',
    }) +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      ...headerLines(i),
      pick(i.language, {
        en: `Format trade-area benchmark: ~${i.metrics.cuisine.tradeAreaRadiusMi} mi radius. ${cuisineNotes(i)}`,
        zh: `业态贸易区基准：半径约 ${i.metrics.cuisine.tradeAreaRadiusMi} 英里。${cuisineNotes(i)}`,
        es: `Referencia de área de influencia del formato: radio de ~${i.metrics.cuisine.tradeAreaRadiusMi} mi. ${cuisineNotes(i)}`,
      }),
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      pick(i.language, { en: '[ACS CENSUS DATA]', zh: '【ACS 人口普查数据】', es: '[DATOS DEL CENSO ACS]' }),
      jsonSlice(i.marketData.acs_context),
      '',
      pick(i.language, WEB_DIGEST_LABEL),
      jsonSlice(i.marketData.web_research, 3_000),
      '',
      pick(i.language, {
        en: 'Produce the "Trade Area & Demand" section. narrative MUST include a ≥5-row trade-area table (range / daypart / demand basis / evidence tag [ACS][Places][estimate]). Score dimension = demographic fit: how well area population, income, and spending power match this concept\'s target customer.',
        zh: '产出「贸易区与需求分析」章节。narrative 必须含 ≥5 行贸易区表格（范围/时段/需求依据/证据标签[ACS][Places][估算]）。评分维度=人群匹配度：该区域人口结构、收入、消费力与本业态目标客群的匹配程度。',
        es: 'Produce la sección "Área de influencia y demanda". narrative DEBE incluir una tabla de área de influencia de ≥5 filas (rango / horario / base de la demanda / etiqueta de evidencia [ACS][Places][estimación]). Dimensión puntuada = encaje demográfico: qué tan bien la población, el ingreso y el poder adquisitivo de la zona coinciden con el cliente objetivo de este concepto.',
      }),
      '',
      outputSpec(i.language, '{"trade_area_rows": [...], "daypart_mix": {...}}'),
    ].join('\n'),
};

const competitionAnalyst: SpecialistDef = {
  discipline: 'competition',
  system: (lang) =>
    pick(lang, {
      en: 'You are the competitive-intelligence analyst. Scope: competitor inventory (direct = same cuisine/price/daypart; indirect = same occasion), threat tiers, positioning-gap analysis (white space on the price × experience matrix), void analysis, saturation assessment.',
      zh: '你是竞争情报分析师。职责：竞对盘点（直接=同菜系同价位同时段；间接=同场景异业态）、威胁分级、定位缺口（价格×体验矩阵中的空白）、市场空白分析（void analysis）、饱和度判断。',
      es: 'Eres el analista de inteligencia competitiva. Alcance: inventario de competidores (directos = misma cocina/precio/horario; indirectos = misma ocasión), niveles de amenaza, análisis de brechas de posicionamiento (espacio en blanco en la matriz precio × experiencia), análisis de vacíos, evaluación de saturación.',
    }) +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      ...headerLines(i),
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      pick(i.language, {
        en: '[COMPETITOR SAMPLE (Google Places, sorted by attractiveness = rating × ln(1+reviews))]',
        zh: '【竞对样本（Google Places，按吸引力=评分×ln(1+评论数)排序）】',
        es: '[MUESTRA DE COMPETIDORES (Google Places, ordenada por atractivo = calificación × ln(1+reseñas))]',
      }),
      jsonSlice(i.metrics.competition.top_competitors),
      '',
      pick(i.language, { en: '[PRICE TIER DISTRIBUTION]', zh: '【价格带分布】', es: '[DISTRIBUCIÓN POR NIVEL DE PRECIO]' }),
      jsonSlice(i.metrics.competition.price_tier_distribution),
      '',
      pick(i.language, {
        en: '[PRIOR-BUSINESS REVIEW THEMES AT THIS ADDRESS (retrieved)]',
        zh: '【该地址过往商家评论主题（实测）】',
        es: '[TEMAS DE RESEÑAS DE NEGOCIOS ANTERIORES EN ESTA DIRECCIÓN (recuperados)]',
      }),
      jsonSlice((i.marketData.site_history as { analysis?: unknown } | undefined)?.analysis ?? null, 2_000),
      '',
      pick(i.language, WEB_DIGEST_LABEL),
      jsonSlice(i.marketData.web_research, 3_000),
      '',
      pick(i.language, {
        en: 'payload.competitors MUST be structured rows: {name, category, rating, review_count, price_tier, threat_level(High/Medium/Low), analysis} using real names; threat ranking: same-cuisine > same-price > same-occasion, higher attractiveness = higher threat. narrative must state the positioning gap: which price × experience cell is white space. Score dimension = competitive position: low saturation + clear gap → high; red ocean with dominant incumbents → low.',
        zh: 'payload.competitors 必须输出结构化竞对行：{name, category, rating, review_count, price_tier, threat_level(高/中/低), analysis}，用真实店名；threat_level 依据：同菜系>同价位>同场景，吸引力分越高威胁越大。narrative 含定位缺口结论：哪个价格带×体验组合是空白。评分维度=竞争位势：饱和指数低、存在明确定位缺口→高分；红海且头部强势→低分。',
        es: 'payload.competitors DEBE contener filas estructuradas: {name, category, rating, review_count, price_tier, threat_level(Alta/Media/Baja), analysis} con nombres reales; orden de amenaza: misma cocina > mismo precio > misma ocasión; a mayor atractivo, mayor amenaza. narrative debe indicar la brecha de posicionamiento: qué celda precio × experiencia está vacía. Dimensión puntuada = posición competitiva: baja saturación + brecha clara → alto; océano rojo con incumbentes dominantes → bajo.',
      }),
      '',
      outputSpec(i.language, '{"competitors": [...], "positioning_gap": "..."}'),
    ].join('\n'),
};

const siteAnalyst: SpecialistDef = {
  discipline: 'site',
  system: (lang) =>
    pick(lang, {
      en: 'You are the real-estate & site analyst. Scope: traffic-count interpretation (high AADT ≠ good: freeway pass-through can\'t stop; slower signalized corridors + going-home side win), visibility & ingress/egress, parking ratios (~10 spaces/1,000 sqft full-service), co-tenancy effects (grocery anchors help QSR; gym/medical help healthy concepts), zoning & licensing risk.',
      zh: '你是不动产与现场评估分析师。职责：车流量解读（AADT 高≠好：高速过境流停不下来，慢速信号灯走廊+回家侧更有价值）、可视性与进出动线、停车配比（全服务约10车位/1000平方英尺）、联动业态（co-tenancy：超市锚店利好快餐、健身/医疗利好轻食）、分区与证照风险。',
      es: 'Eres el analista inmobiliario y de sitio. Alcance: interpretación de conteos de tráfico (un AADT alto ≠ bueno: el tráfico de paso de autopista no puede detenerse; ganan los corredores más lentos con semáforos y el lado de regreso a casa), visibilidad y accesos de entrada/salida, proporción de estacionamiento (~10 cajones/1,000 pies² en servicio completo), efectos de co-arrendamiento (los supermercados ancla ayudan al QSR; gimnasios y clínicas ayudan a conceptos saludables), riesgo de zonificación y licencias.',
    }) +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      pick(i.language, {
        en: `Address: ${i.location}`,
        zh: `地址：${i.location}`,
        es: `Dirección: ${i.location}`,
      }),
      pick(i.language, {
        en: `Concept: ${i.businessType} (${i.metrics.cuisine.category})`,
        zh: `业态：${i.businessType}（${i.metrics.cuisine.category}）`,
        es: `Concepto: ${i.businessType} (${i.metrics.cuisine.category})`,
      }),
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      pick(i.language, { en: '[GEOCODE]', zh: '【地理编码】', es: '[GEOCODIFICACIÓN]' }),
      jsonSlice(i.marketData.geocode, 1_000),
      '',
      pick(i.language, {
        en: '[BUSINESSES AT THIS EXACT ADDRESS + REVIEWS (retrieved)]',
        zh: '【该地址过往/现有商家与评论（实测）】',
        es: '[NEGOCIOS EN ESTA DIRECCIÓN EXACTA + RESEÑAS (recuperados)]',
      }),
      jsonSlice(i.marketData.site_history, 5_000),
      '',
      pick(i.language, { en: '[TRAFFIC (Caltrans AADT)]', zh: '【车流数据（Caltrans AADT）】', es: '[TRÁFICO (Caltrans AADT)]' }),
      jsonSlice(i.metrics.traffic),
      '',
      pick(i.language, { en: '[COMMERCIAL LISTINGS]', zh: '【商业地产挂牌】', es: '[LOCALES COMERCIALES EN RENTA]' }),
      jsonSlice(i.marketData.commercial_listings, 3_000),
      '',
      pick(i.language, WEB_DIGEST_LABEL),
      jsonSlice(i.marketData.web_research, 2_000),
      '',
      pick(i.language, {
        en: 'Produce the "Site & Access Assessment" section. Where field data is missing, provide a field due-diligence checklist (count times/dayparts, ingress-egress checks, peak parking observation). payload MUST contain two scores: foot_traffic_score_100 (traffic potential, highest weight) and accessibility_score_100 (parking/circulation/transit). Set score_100 = foot_traffic_score_100.',
        zh: '产出「场址与可达性评估」章节。无实地数据处必须给出「实地尽调清单」（蹲点计数时段、进出动线检查项、停车高峰观察）。payload 输出两个分数：foot_traffic_score_100（客流潜力，权重最高）与 accessibility_score_100（可达性：停车/动线/公交）。score_100 填 foot_traffic_score_100。',
        es: 'Produce la sección "Evaluación del sitio y accesos". Donde falten datos de campo, entrega una lista de diligencia debida en sitio (horarios de conteo, verificación de entradas/salidas, observación de estacionamiento en hora pico). payload DEBE contener dos puntajes: foot_traffic_score_100 (potencial de tráfico, mayor peso) y accessibility_score_100 (estacionamiento/circulación/transporte). Establece score_100 = foot_traffic_score_100.',
      }),
      '',
      outputSpec(
        i.language,
        '{"foot_traffic_score_100": n, "accessibility_score_100": n, "due_diligence_checklist": [...]}',
      ),
    ].join('\n'),
};

const financialAnalyst: SpecialistDef = {
  discipline: 'financial',
  system: (lang) =>
    pick(lang, {
      en: 'You are the restaurant financial modeler. Benchmarks: occupancy 6–10% of sales (>10% red flag); prime cost (COGS+labor): QSR 55–60%, casual FSR 60–65%, fine ≤68%; net margin 5–10% healthy. Three-scenario method: pessimistic = revenue −20% & costs +5% (must still survive), base, optimistic = +15%. Ramp: month 1 at 40–50% of target, month 2 at 60–70%, steady by months 3–6. Triangulate revenue: bottom-up (seats × turns × ticket), fair-share model (pool ÷ trade-area restaurant count × attractiveness multiplier), analog comparables — report the spread, not one number.',
      zh: '你是餐饮财务模型分析师。基准：租金占营收 6-10%（>10% 红旗）；Prime Cost（食材+人工）：快餐55-60%、休闲正餐60-65%、高端≤68%；净利率5-10%为健康。三场景法：悲观=营收-20%且成本+5%（必须仍能存活）、基准、乐观=营收+15%。爬坡：首月40-50%目标、次月60-70%、第3-6月达稳态。营收三角验证：自下而上（座位×翻台×客单）、公平份额模型（需求池÷贸易区餐厅数×吸引力乘数）、可比店类推——报告区间而非单点。',
      es: 'Eres el modelador financiero de restaurantes. Referencias: ocupación 6–10% de las ventas (>10% bandera roja); costo primo (COGS + mano de obra): QSR 55–60%, servicio completo casual 60–65%, alta cocina ≤68%; margen neto saludable 5–10%. Método de tres escenarios: pesimista = ingresos −20% y costos +5% (debe seguir siendo viable), base, optimista = +15%. Curva de arranque: mes 1 al 40–50% del objetivo, mes 2 al 60–70%, estable entre los meses 3–6. Triangula los ingresos: de abajo hacia arriba (asientos × rotaciones × ticket), modelo de participación justa (pool ÷ número de restaurantes del área × multiplicador de atractivo), comparables análogos; reporta el rango, no un solo número.',
    }) +
    '\n\n' +
    groundingRules(lang),
  user: (i) => {
    const c = i.metrics.cuisine;
    const turns = c.turnsPerDay;
    return [
      ...headerLines(i),
      pick(i.language, {
        en: `Format benchmarks: ticket $${c.avgTicketUsd[0]}-${c.avgTicketUsd[1]}; ${turns ? `${turns[0]}-${turns[1]} turns/day` : 'cup-count model 200-500/day'}; seats ${c.typicalSeats[0]}-${c.typicalSeats[1]}`,
        zh: `业态基准：客单 $${c.avgTicketUsd[0]}-${c.avgTicketUsd[1]}；${turns ? `翻台 ${turns[0]}-${turns[1]} 次/天` : '按日均杯数200-500计'}；座位 ${c.typicalSeats[0]}-${c.typicalSeats[1]}`,
        es: `Referencias del formato: ticket $${c.avgTicketUsd[0]}-${c.avgTicketUsd[1]}; ${turns ? `${turns[0]}-${turns[1]} rotaciones/día` : 'modelo de vasos 200-500/día'}; asientos ${c.typicalSeats[0]}-${c.typicalSeats[1]}`,
      }),
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      pick(i.language, { en: '[ECONOMICS DETAIL]', zh: '【经济指标明细】', es: '[DETALLE ECONÓMICO]' }),
      jsonSlice({ economics: i.metrics.economics, market_share: i.metrics.market_share, demand: i.metrics.demand }),
      '',
      pick(i.language, {
        en: 'payload.scenarios MUST have exactly 3: {name, monthly_revenue_usd(number), key_assumptions(incl. ramp note)} — base scenario must cross-check fair-share implied revenue vs bottom-up band (explain any conflict); pessimistic = base×0.8 with costs +5%, optimistic = base×1.15. payload.breakeven gives monthly break-even revenue and covers/day. narrative includes a monthly cost-structure table (rent from computed metrics, labor, COGS, other) and sensitivity (ticket −10%, turns −0.5). Score dimension = rent value.',
        zh: 'payload.scenarios 输出恰好3个场景：{name, monthly_revenue_usd(数值), key_assumptions(含爬坡说明)}——基准场景须与公平份额隐含营收和自下而上区间交叉校验（若两者矛盾须解释取舍）；悲观=基准×0.8且成本+5%，乐观=基准×1.15。payload.breakeven 给出月营收盈亏平衡点与日均单数。narrative 含月度成本结构表（租金按计算指标、人工、食材、其他）与敏感性分析（客单-10%、翻台-0.5的影响）。评分维度=租金性价比。',
        es: 'payload.scenarios DEBE tener exactamente 3: {name (Conservador/Base/Optimista), monthly_revenue_usd(número), key_assumptions(incluye nota de arranque)}; el escenario base debe contrastar el ingreso implícito de participación justa con la banda de abajo hacia arriba (explica cualquier conflicto); pesimista = base×0.8 con costos +5%, optimista = base×1.15. payload.breakeven indica el ingreso mensual de equilibrio y los cubiertos/día. narrative incluye una tabla de estructura de costos mensual (renta según métricas calculadas, mano de obra, COGS, otros) y sensibilidad (ticket −10%, rotaciones −0.5). Dimensión puntuada = valor de la renta.',
      }),
      '',
      outputSpec(i.language, '{"scenarios": [...], "breakeven": "...", "sensitivity": [...]}'),
    ].join('\n');
  },
};

const riskAnalyst: SpecialistDef = {
  discipline: 'risk',
  system: (lang) =>
    pick(lang, {
      en: 'You are the risk officer. Scope: probability × impact matrix, trigger signals, mitigations, failure-scenario simulation. Tie every risk to the P&L (rent escalation, labor squeeze, seasonality, price wars, platform commissions, licensing delays, buildout overruns, cuisine-specific risks); each row needs a monitorable trigger and a quantified impact band.',
      zh: '你是风控官。职责：风险概率×影响矩阵、触发信号、对冲手段、失败场景推演。风险须与利润结构挂钩（租金失控、人工挤压、淡旺季、价格战、平台抽成、证照延误、施工超期、菜系特有风险），每条给出可监测的触发指标与量化影响区间。',
      es: 'Eres el responsable de riesgos. Alcance: matriz probabilidad × impacto, señales detonantes, mitigaciones, simulación de escenarios de fracaso. Vincula cada riesgo al P&L (escalamiento de renta, presión laboral, estacionalidad, guerras de precios, comisiones de plataformas, retrasos de licencias, sobrecostos de obra, riesgos propios de la cocina); cada fila necesita un detonante monitoreable y una banda de impacto cuantificada.',
    }) +
    '\n\n' +
    groundingRules(lang),
  user: (i) =>
    [
      ...headerLines(i),
      pick(i.language, {
        en: `Format risk notes: ${cuisineNotes(i)}`,
        zh: `菜系风险提示：${cuisineNotes(i)}`,
        es: `Notas de riesgo del formato: ${cuisineNotes(i)}`,
      }),
      '',
      formatMetricsDigest(i.metrics, i.language),
      '',
      pick(i.language, {
        en: '[TOP COMPETITORS (threat reference)]',
        zh: '【竞对头部（威胁参照）】',
        es: '[PRINCIPALES COMPETIDORES (referencia de amenaza)]',
      }),
      jsonSlice(i.metrics.competition.top_competitors.slice(0, 5), 2_000),
      '',
      pick(i.language, {
        en: 'payload.risk_matrix MUST have 5-8 rows: {risk, probability(H/M/L + % band), financial_impact($ band or % of revenue), trigger(monitorable signal), mitigation(concrete action + cost order)}. payload.failure_scenarios: 2-3 concrete "how this store dies" causal chains. score_100 = risk controllability (higher = more controllable); it is excluded from the weighted composite.',
        zh: 'payload.risk_matrix 输出 5-8 行：{risk, probability(高/中/低+百分比区间), financial_impact(美元区间或营收百分比), trigger(可监测信号), mitigation(具体动作+成本量级)}。payload.failure_scenarios 输出 2-3 条「这家店怎么死」的具体推演链。score_100 表示风险可控度（越高越可控），不参与加权评分。',
        es: 'payload.risk_matrix DEBE tener 5-8 filas: {risk, probability(Alta/Media/Baja + banda %), financial_impact(banda en $ o % de ingresos), trigger(señal monitoreable), mitigation(acción concreta + orden de costo)}. payload.failure_scenarios: 2-3 cadenas causales concretas de "cómo muere este local". score_100 = controlabilidad del riesgo (más alto = más controlable); se excluye del compuesto ponderado.',
      }),
      '',
      outputSpec(i.language, '{"risk_matrix": [...], "failure_scenarios": [...]}'),
    ].join('\n'),
};

export const SPECIALISTS: SpecialistDef[] = [
  marketAnalyst,
  competitionAnalyst,
  siteAnalyst,
  financialAnalyst,
  riskAnalyst,
];

export async function runSpecialist(
  def: SpecialistDef,
  input: SpecialistInput,
): Promise<SpecialistFinding> {
  const raw = await completeJson({
    system: def.system(input.language),
    user: def.user(input),
    tier: 'agent',
  });
  const parsed = findingSchema.parse(raw);
  return { discipline: def.discipline, ...parsed };
}
