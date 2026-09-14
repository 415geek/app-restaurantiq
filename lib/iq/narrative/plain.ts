/**
 * Plain-language rewrites of the engine strings that reach customer-facing
 * text (score drivers, conditions, risk triggers / hedges, guard notes,
 * inputs_missing, method lines …).
 *
 * The engines emit Chinese template strings with engine identifiers (walk10,
 * L1, coverage_ratio …). The report is read by restaurant owners in one of
 * three languages, so:
 *   - plainZh(): Chinese text minus the identifiers (the historical rule set)
 *   - plainEn() / plainEs(): the same engine phrases translated, identifiers
 *     included, CJK punctuation normalised — so a report rendered in English or
 *     Spanish never shows Chinese.
 * Digits are never touched, so NumberGuard results are unaffected.
 */
import type { Locale } from '@/lib/i18n/locale';

const CJK_RE = /[　-〿㐀-䶿一-鿿＀-￯]/;

/** True when the text carries any CJK ideograph or CJK punctuation. */
export function hasCjk(text: string | null | undefined): boolean {
  return Boolean(text) && CJK_RE.test(text as string);
}

const PLAIN_ZH: Array<[RegExp, string]> = [
  [/\bwalk10\b/g, '步行 10 分钟范围'],
  [/\bdrive5\b/g, '开车 5 分钟范围'],
  [/\bdrive10\b/g, '开车 10 分钟范围'],
  [/\bdrive15\b/g, '开车 15 分钟范围'],
  [/\bcoverage_ratio\s*=\s*/g, '需求覆盖率 = '],
  [/\bcoverage_ratio\b/g, '需求覆盖率'],
  [/\boccupancy_cost_ratio\b/g, '占用成本比'],
  [/\bcluster_score\b/g, '集聚分'],
  [/\bL1\s*\+\s*L2\b/g, '同菜系竞品 + 其他中餐'],
  [/\bL1\b/g, '同菜系竞品'],
  [/\bL2\b/g, '其他中餐'],
  [/\bL3\b/g, '其他亚洲餐'],
  [/\bL4\b/g, '华人客流聚集点'],
  [/\bHHI\b/g, '集中度'],
  [/\bHuff\b/g, '需求分流模型'],
  [/\bP25\b/g, '低位'],
  [/\bP75\b/g, '高位'],
  [/\bAADT\b/g, '道路日车流量'],
  [/\bCapEx\b/gi, '开办投入'],
  [/β/g, '距离衰减参数'],
  [/α/g, '吸引力参数'],
  [/\bseats\s*×\s*turns\b/g, '座位数 × 翻台率'],
  [/\bseats\b/g, '座位数'],
  [/\bticket_in\b/g, '堂食客单价'],
  [/\bticket_delivery\b/g, '外卖客单价'],
  [/\bdelivery_ratio\b/g, '外卖占比'],
  [/\bparking_spaces\b/g, '车位数'],
  [/\brent_usd\b/g, '月租'],
  [/\brent\(/g, '月租('],
  [/\bpayback\(/g, '回收期('],
  [/\bsqft\b/g, '面积'],
  [/[（(]destination[）)]/g, '（目的地型菜系）'],
  [/[（(]regular[）)]/g, '（常规型菜系）'],
  [/[（(]everyday[）)]/g, '（日常型菜系）'],
  [/[（(]none[）)]/g, '（未提供）'],
  [/[（(]user_input[）)]/g, '（您的输入）'],
  [/[（(]overture_estimate[）)]/g, '（地图估算）'],
  [/[（(]D5\s*\+\s*D6[）)]/g, '（门店底图 + Google 地图）'],
  [/按评论数 log 权重/g, '按评论数取对数加权'],
  [/\blog 权重/g, '取对数加权'],
  [/Laplace 平滑/g, '小样本平滑'],
  [/（只可写[^）]*）/g, ''],
  [/置信度/g, '数据完整度'],
];

export function plainZh(text: string | null | undefined): string {
  if (!text) return '';
  let out = text;
  for (const [re, rep] of PLAIN_ZH) out = out.replace(re, rep);
  return out;
}

type Rep = string | ((...m: string[]) => string);
type Rule = { re: RegExp; en: Rep; es: Rep };

const yesNo = (v: string, lang: 'en' | 'es') => (v === '是' ? (lang === 'en' ? 'yes' : 'sí') : v === '否' ? 'no' : lang === 'en' ? 'n/a' : 'n/d');
const parkingSource = (v: string, lang: 'en' | 'es') =>
  v === 'user_input' ? (lang === 'en' ? 'your input' : 'su dato') : v === 'overture_estimate' ? (lang === 'en' ? 'map estimate' : 'estimación del mapa') : lang === 'en' ? 'not provided' : 'no indicado';

/**
 * Engine phrase → English / Spanish. Ordered: whole-sentence templates first,
 * then generic identifiers, then CJK punctuation. `$n` back-references are the
 * captured numbers, which are copied verbatim.
 */
const ENGINE_PHRASES: Rule[] = [
  // ---- score drivers (engines/cuisine-fit.ts)
  { re: /coverage_ratio 未知（需求或保本线缺失）→ 中性 50/g, en: 'Demand coverage unknown (demand or break-even missing) → neutral 50', es: 'Cobertura de demanda desconocida (falta demanda o punto de equilibrio) → neutral 50' },
  { re: /中文家庭占比 (\S+) vs 阈值 (\S+)/g, en: 'Chinese-speaking households $1 vs $2 threshold', es: 'Hogares de habla china $1 vs umbral $2' },
  { re: /收入中位 (\S+) vs 价位 (\S+) 理想 ≥ (\S+)/g, en: 'Median income $1 vs ideal ≥ $3 for a $2 price point', es: 'Ingreso mediano $1 vs ideal ≥ $3 para el nivel de precio $2' },
  { re: /walk10 岗位数 ÷ 主商圈人口/g, en: 'Jobs within a 10-minute walk ÷ primary-area population', es: 'Empleos a 10 minutos a pie ÷ población de la zona principal' },
  { re: /walk10 岗位 (\S+)/g, en: 'Jobs within a 10-minute walk: $1', es: 'Empleos a 10 minutos a pie: $1' },
  { re: /有孩家庭占比 (\S+)/g, en: 'Families with children $1', es: 'Familias con hijos $1' },
  { re: /集聚分 (\S+)（walk10 内 L1\+L2 (\d+) 家）/g, en: 'Cluster score $1 ($2 Chinese restaurants within a 10-minute walk)', es: 'Puntuación de aglomeración $1 ($2 restaurantes chinos a 10 minutos a pie)' },
  { re: /L1 均分 (\S+) < (\S+) → 品质机会 \+(\d+)/g, en: 'Direct competitors average $1 < $2 → quality opening +$3', es: 'Competidores directos promedian $1 < $2 → oportunidad de calidad +$3' },
  { re: /L1 均分 (\S+) > (\S+) → 高门槛 −(\d+)/g, en: 'Direct competitors average $1 > $2 → high quality bar −$3', es: 'Competidores directos promedian $1 > $2 → listón de calidad alto −$3' },
  { re: /关店率 (\S+) > (\S+) → −(\d+)/g, en: 'Closure rate $1 > $2 → −$3', es: 'Tasa de cierre $1 > $2 → −$3' },
  { re: /轨道站步行可达 (是|否|未获取)/g, en: (_m, v) => `Rail station within walking distance: ${yesNo(v, 'en')}`, es: (_m, v) => `Estación de tren a pie: ${yesNo(v, 'es')}` },
  { re: /AADT (\S+)/g, en: 'Road traffic $1 vehicles/day', es: 'Tráfico vial $1 vehículos/día' },
  { re: /停车 (\S+)（(none|user_input|overture_estimate)）/g, en: (_m, n, s) => `Parking ${n} (${parkingSource(s, 'en')})`, es: (_m, n, s) => `Estacionamiento ${n} (${parkingSource(s, 'es')})` },
  { re: /占用成本比 = 租金 ÷ 捕获营收：/g, en: 'Occupancy cost ratio = rent ÷ captured revenue: ', es: 'Ratio de costo de ocupación = alquiler ÷ ingresos captados: ' },
  { re: /占用成本比 = 租金 ÷ 基准情景营收（捕获需求缺失）：/g, en: 'Occupancy cost ratio = rent ÷ base-scenario revenue (captured demand missing): ', es: 'Ratio de costo de ocupación = alquiler ÷ ingresos del escenario base (falta demanda captada): ' },
  { re: /占用成本比未知/g, en: 'Occupancy cost ratio unknown', es: 'Ratio de costo de ocupación desconocido' },
  { re: /租金未提供，财务维度按中性 50 分/g, en: 'Rent not provided: the financial dimension scores a neutral 50', es: 'Alquiler no indicado: la dimensión financiera puntúa un 50 neutral' },
  { re: /捕获营收 ≥ 安全线 \+10/g, en: 'Captured revenue ≥ safety line +10', es: 'Ingresos captados ≥ línea de seguridad +10' },
  { re: /捕获营收 < 保本线 −10/g, en: 'Captured revenue < break-even −10', es: 'Ingresos captados < punto de equilibrio −10' },
  { re: /午市占比 (\S+)/g, en: 'Lunch share $1', es: 'Cuota de almuerzo $1' },
  { re: /drive5 户密度 (\S+) 户\/平方英里/g, en: '$1 households per sq mi within a 5-minute drive', es: '$1 hogares por milla² a 5 minutos en coche' },
  { re: /drive5 户密度 未获取/g, en: 'Household density within a 5-minute drive: n/a', es: 'Densidad de hogares a 5 minutos en coche: n/d' },
  { re: /L1 提供外卖比例 未获取（中性）/g, en: 'Share of direct competitors offering delivery: n/a (neutral)', es: 'Cuota de competidores directos con delivery: n/d (neutral)' },
  { re: /L1 提供外卖比例 (\S+)/g, en: 'Share of direct competitors offering delivery: $1', es: 'Cuota de competidores directos con delivery: $1' },
  // ---- risk rows (engines/risk.ts risk_zh; Spanish has no engine field of its own)
  { re: /租金占捕获营收 (\S+)，高于 10% 警戒线/g, en: 'Rent is $1 of captured revenue, above the 10% line', es: 'El alquiler es el $1 de los ingresos captados, por encima de la línea del 10%' },
  { re: /客单价下滑 12\.5% 即击穿保本线（不含租金；基准客单 \$(\S+)）/g, en: 'A 12.5% ticket drop breaks even (excluding rent; base ticket $$$1)', es: 'Una caída del ticket del 12.5% rompe el equilibrio (sin renta; ticket base $$$1)' },
  { re: /客单价下滑 12\.5% 即击穿保本线（基准客单 \$(\S+)）/g, en: 'A 12.5% ticket drop breaks even (base ticket $$$1)', es: 'Una caída del ticket del 12.5% rompe el equilibrio (ticket base $$$1)' },
  { re: /drive10 内中餐关店率 (\S+)/g, en: 'Chinese-restaurant closure rate within a 10-minute drive: $1', es: 'Tasa de cierre de restaurantes chinos a 10 minutos en coche: $1' },
  { re: /步行 10 分钟内没有其他中餐：无华人餐饮流量，冷启动/g, en: 'No other Chinese restaurant within a 10-minute walk: no Chinese dining traffic, cold start', es: 'Sin otros restaurantes chinos a 10 minutos a pie: sin tráfico chino, arranque en frío' },
  { re: /步行 10 分钟内中餐 (\d+) 家：饱和区间/g, en: '$1 Chinese restaurants within a 10-minute walk: saturated band', es: '$1 restaurantes chinos a 10 minutos a pie: franja saturada' },
  { re: /直接竞品均分 (\S+)，品质门槛高/g, en: 'Direct competitors average $1: high quality bar', es: 'Los competidores directos promedian $1: listón de calidad alto' },
  { re: /捕获需求仅覆盖保本线（不含租金）(\S+)/g, en: 'Captured demand covers only $1 of break-even (excluding rent)', es: 'La demanda captada cubre solo el $1 del punto de equilibrio (sin renta)' },
  { re: /捕获需求仅覆盖保本线 (\S+)/g, en: 'Captured demand covers only $1 of break-even', es: 'La demanda captada cubre solo el $1 del punto de equilibrio' },
  { re: /未提供月租：占用成本比无法评估，保本线不含租金/g, en: 'Monthly rent not provided: occupancy cost cannot be assessed; break-even excludes rent', es: 'Alquiler mensual no indicado: no se puede evaluar el costo de ocupación; el punto de equilibrio se calcula sin renta' },
  { re: /商圈为直线半径近似（等时圈未获取），人口与需求可能高估/g, en: 'Trade area approximated with straight-line radii (travel-time areas unavailable); population and demand may be overstated', es: 'Área aproximada con radios en línea recta (sin tiempos de viaje); población y demanda pueden estar sobrestimadas' },
  { re: /周边有 (\d+) 个在建 \/ 已批项目：施工期客流受影响，交付后需求上行（未计入当前需求）/g, en: '$1 nearby projects under construction / approved: traffic hit during construction, upside on delivery (not in current demand)', es: '$1 proyectos cercanos en obra / aprobados: menos tráfico durante las obras, más demanda al entregarse (no incluida en la demanda actual)' },
  { re: /未提供 CapEx：回收期无法评估/g, en: 'Start-up investment not provided: payback cannot be assessed', es: 'Sin inversión inicial indicada: no se puede evaluar la recuperación' },
  // ---- pre-lease conditions (engines/cuisine-fit.ts text_zh)
  {
    re: /补充实际月租后重新生成：本报告未假设任何租金，保本线不含租金(?:；按 10% 占用成本，月租上限约 \$(\S+))?/g,
    en: (_m, cap) => `Add the actual monthly rent and regenerate: this report assumes no rent, the break-even excludes rent${cap ? `; at 10% occupancy cost the rent ceiling is about $${cap}` : ''}`,
    es: (_m, cap) => `Añada el alquiler mensual real y vuelva a generar: este informe no asume alquiler y el equilibrio es sin renta${cap ? `; con un 10% de ocupación el tope de alquiler ronda los $${cap}` : ''}`,
  },
  { re: /租金需谈至 ≤ \$(\S+)\/月，使占用成本比 ≤ 10%/g, en: 'Negotiate rent to ≤ $$$1/mo so occupancy cost ≤ 10%', es: 'Negociar el alquiler a ≤ $$$1/mes para que el costo de ocupación sea ≤ 10%' },
  { re: /补充租金与面积后重新评估占用成本比/g, en: 'Provide rent and floor area to evaluate occupancy cost', es: 'Indique alquiler y superficie para evaluar el costo de ocupación' },
  { re: /模型捕获需求距保本线尚差 \$(\S+)\/月，需靠午市套餐 \/ 外卖 \/ 宴席补足/g, en: 'Captured demand is $$$1/mo short of break-even; close it with lunch sets / delivery / banquets', es: 'La demanda captada queda $$$1/mes por debajo del equilibrio; cúbralo con menús de almuerzo / delivery / banquetes' },
  { re: /需求覆盖比无法计算：补充竞品或人口数据/g, en: 'Coverage ratio unavailable: competitor or demographic data missing', es: 'Cobertura de demanda no calculable: faltan datos de competidores o población' },
  {
    re: /主商圈中文家庭占比 (\S+)，(destination|regular|everyday) 类菜系阈值 (\S+)：需面向非华裔客群设计菜单或改选替代菜系/g,
    en: (_m, share, cls, thr) => `Chinese-speaking share ${share} vs the ${thr} threshold for a ${cls} cuisine: design for non-Chinese guests or pick an alternative cuisine`,
    es: (_m, share, cls, thr) => `Hogares de habla china ${share} vs umbral ${thr} para una cocina ${cls === 'destination' ? 'de destino' : cls === 'regular' ? 'habitual' : 'cotidiana'}: diseñe para clientes no chinos o elija una cocina alternativa`,
  },
  {
    re: /步行 10 分钟内中餐 (\d+) 家：(冷启动，需自带流量（预算 ≥ 3 个月营销）|需明确价格 × 体验差异化，避免正面价格战)/g,
    en: (_m, n, tail) => `${n} Chinese restaurants within a 10-minute walk: ${tail.startsWith('冷启动') ? 'cold start — budget ≥ 3 months of marketing' : 'differentiate on price × experience, avoid a head-on price war'}`,
    es: (_m, n, tail) => `${n} restaurantes chinos a 10 minutos a pie: ${tail.startsWith('冷启动') ? 'arranque en frío — presupuesto de marketing ≥ 3 meses' : 'diferénciese en precio × experiencia, evite la guerra de precios'}`,
  },
  { re: /核实停车位数量与晚市可用性；无轨道站时以车流客为主设计动线/g, en: 'Verify parking count and evening availability; without a rail station, design for drive-in guests', es: 'Verifique las plazas de estacionamiento y su disponibilidad nocturna; sin tren cercano, diseñe para clientes en coche' },
  { re: /午市偏弱：设计 ≤ \$18 套餐并接入 2 个外卖平台补足场景/g, en: 'Weak lunch: add a ≤ $$18 set menu and two delivery platforms', es: 'Almuerzo flojo: cree un menú ≤ $$18 y súmese a 2 plataformas de delivery' },
  // ---- risk triggers / hedges (engines/risk.ts)
  { re: /签约租金高于本报告条件页给出的上限/g, en: 'Signed rent exceeds the cap on the conditions page', es: 'El alquiler firmado supera el tope de la página de condiciones' },
  { re: /争取免租期 \/ 阶梯租金 \/ 百分比租金条款/g, en: 'Negotiate free rent / stepped rent / percentage-rent clauses', es: 'Negociar meses de gracia / alquiler escalonado / alquiler porcentual' },
  { re: /开业 3 个月后实际客单价 < 基准 × 0\.9/g, en: 'Actual ticket 3 months after opening < base × 0.9', es: 'Ticket real 3 meses tras la apertura < base × 0.9' },
  { re: /设计套餐锚定客单价；控制折扣渠道占比/g, en: 'Anchor the ticket with set menus; cap the share of discount channels', es: 'Anclar el ticket con menús fijos; limitar la cuota de canales con descuento' },
  { re: /同商圈 12 个月内再有 2 家以上关店/g, en: '2 or more further closures in the trade area within 12 months', es: '2 o más cierres adicionales en la zona en 12 meses' },
  { re: /核查关店原因（租金 \/ 人力 \/ 客流）后再签/g, en: 'Check why they closed (rent / labor / traffic) before signing', es: 'Verificar por qué cerraron (alquiler / personal / tráfico) antes de firmar' },
  { re: /开业首月客流 < 基准情景 40%/g, en: 'First-month traffic < 40% of the base scenario', es: 'Tráfico del primer mes < 40% del escenario base' },
  { re: /预留 ≥ 3 个月营销预算；与 L4 锚点（亚超 \/ 奶茶）联合推广/g, en: 'Reserve ≥ 3 months of marketing budget; co-promote with Chinese-community anchors (Asian grocers / boba)', es: 'Reservar ≥ 3 meses de marketing; promoción conjunta con anclas chinas (supermercados asiáticos / boba)' },
  { re: /同品类新店开业 \/ 价格战/g, en: 'A new same-category opening / price war', es: 'Apertura de un nuevo local de la misma categoría / guerra de precios' },
  { re: /差异化定位于 L1 平均价位之外/g, en: "Position away from the direct competitors' average price point", es: 'Posicionarse fuera del precio medio de los competidores directos' },
  { re: /开业 90 天 Google 评分 < 4\.2/g, en: 'Google rating < 4.2 after 90 days', es: 'Calificación de Google < 4.2 tras 90 días' },
  { re: /试营业期打磨出品与服务，控制首批评论/g, en: 'Polish food and service in the soft launch; manage the first reviews', es: 'Pulir producto y servicio en la preapertura; cuidar las primeras reseñas' },
  { re: /开业 6 个月月营收 < 保本线/g, en: 'Monthly revenue 6 months after opening < break-even', es: 'Ingresos mensuales a los 6 meses < punto de equilibrio' },
  { re: /压缩座位 \/ 面积以降低固定成本；先做外卖验证需求/g, en: 'Cut seats / floor area to lower fixed cost; validate demand with delivery first', es: 'Reducir asientos / superficie (menos costo fijo); validar primero con delivery' },
  { re: /正式签约前用等时圈复核/g, en: 'Re-check with road-network travel times before signing', es: 'Volver a verificar con tiempos de viaje por carretera antes de firmar' },
  { re: /施工围挡影响门面 \/ 停车/g, en: 'Construction hoarding blocks the storefront / parking', es: 'Vallas de obra afectan la fachada / el estacionamiento' },
  { re: /租约加入施工期租金减免条款/g, en: 'Add a construction-period rent abatement clause to the lease', es: 'Incluir una cláusula de reducción de alquiler durante las obras' },
  { re: /取得装修 \/ 设备报价后重跑报告/g, en: 'Re-run the report once build-out / equipment quotes are in', es: 'Volver a generar el informe con presupuestos de obra / equipo' },
  { re: /在「补充信息」里填写月租后重新生成；租金以本报告给出的上限为目标/g, en: 'Add the monthly rent under "Add details" and regenerate; negotiate toward the rent ceiling this report gives', es: 'Indique el alquiler mensual en "Añadir datos" y vuelva a generar; negocie hacia el tope de alquiler que da este informe' },
  // ---- audience basis (engines/audience.ts)
  { re: /中文家庭占比 × 有孩家庭占比（主商圈）/g, en: 'Chinese-speaking household share × families with children (primary trade area)', es: 'Cuota de hogares de habla china × familias con hijos (zona principal)' },
  { re: /中文家庭占比 × 25–44 岁占比（全国基准 28%）/g, en: 'Chinese-speaking household share × age 25–44 share (national benchmark 28%)', es: 'Cuota de hogares de habla china × cuota de 25–44 años (referencia nacional 28%)' },
  { re: /非华裔人口 × 收入指数/g, en: 'Non-Chinese population × income index', es: 'Población no china × índice de ingresos' },
  // ---- finance / cuisine-share method lines
  { re: /seats×turns 单一口径；保本 = 固定成本 ÷ 边际贡献率；安全线 = 保本 × (\S+)/g, en: 'Single basis: seats × turns; break-even = fixed cost ÷ contribution margin; safety line = break-even × $1', es: 'Base única: asientos × rotaciones; punto de equilibrio = costo fijo ÷ margen de contribución; línea de seguridad = punto de equilibrio × $1' },
  { re: /无中餐供给样本 → 先验 8%/g, en: 'No Chinese-restaurant sample → prior 8%', es: 'Sin muestra de oferta china → prior 8%' },
  { re: /供给份额 ≈ 需求份额：按评论数 log 权重（D5\+D6），Laplace 平滑，\[3%,50%\] 截断/g, en: 'Supply share ≈ demand share, review-weighted (map base + Google), smoothed, capped to [3%, 50%]', es: 'Cuota de oferta ≈ cuota de demanda, ponderada por reseñas (mapa + Google), suavizada, acotada a [3%, 50%]' },
  { re: /供给份额 ≈ 需求份额：按门店数（无评论数），Laplace 平滑/g, en: 'Supply share ≈ demand share by store count (no reviews), smoothed', es: 'Cuota de oferta ≈ cuota de demanda por número de locales (sin reseñas), suavizada' },
  // ---- inputs_missing / rent_source (engines/finance.ts)
  { re: /seats\(按面积估算\)/g, en: 'seats (estimated from floor area)', es: 'asientos (estimados por superficie)' },
  { re: /seats\(按原型默认\)/g, en: 'seats (archetype default)', es: 'asientos (valor por defecto del arquetipo)' },
  { re: /ticket_in\(取菜系默认\)/g, en: 'dine-in ticket (cuisine default)', es: 'ticket en sala (valor por defecto de la cocina)' },
  { re: /ticket_delivery\(=堂食×1\.15\)/g, en: 'delivery ticket (= dine-in × 1.15)', es: 'ticket de delivery (= sala × 1.15)' },
  { re: /delivery_ratio\(默认 25%\)/g, en: 'delivery share (default 25%)', es: 'cuota de delivery (25% por defecto)' },
  { re: /rent\(未提供\)/g, en: 'rent (not provided)', es: 'alquiler (no indicado)' },
  // legacy models generated before rent estimation was removed
  { re: /rent\(按对标估算\)/g, en: 'rent (estimated from comps)', es: 'alquiler (estimado por comparables)' },
  { re: /rent\(按档位估算\)/g, en: 'rent (estimated from the market tier)', es: 'alquiler (estimado por nivel de mercado)' },
  { re: /payback\(租金未提供 → 回收期隐藏\)/g, en: 'payback (rent not provided → hidden)', es: 'recuperación (sin alquiler indicado → oculta)' },
  { re: /payback\(捕获营收未超过保本线\)/g, en: 'payback (captured revenue below break-even)', es: 'recuperación (ingresos captados por debajo del equilibrio)' },
  { re: /capex\(缺 → 回收期隐藏\)/g, en: 'start-up investment (missing → payback hidden)', es: 'inversión inicial (falta → recuperación oculta)' },
  { re: /sqft × 对标 \$\/sf\/月/g, en: 'floor area × comp $$/sf/mo', es: 'superficie × comparables $$/sf/mes' },
  { re: /sqft × (\S+) 档位 \$(\S+)\/sf\/月/g, en: 'floor area × $1-tier $$$2/sf/mo', es: 'superficie × nivel $1 $$$2/sf/mes' },
  // ---- void reason / guard notes (engines/competitor.ts, pipeline.ts)
  { re: /drive10 华裔居民 (\S+) ≥ (\S+)；密度为枢纽中位数的 (\S+)；L2 (\d+) 家/g, en: 'Chinese residents within a 10-minute drive $1 ≥ $2; density is $3 of the hub median; $4 other Chinese restaurants', es: 'Residentes chinos a 10 minutos en coche $1 ≥ $2; densidad del $3 de la mediana de los núcleos; $4 otros restaurantes chinos' },
  {
    re: /未满足品类缺口三条件（只可写「该品类供给较少」）：华裔人口(达标|不足)、密度对标(缺失|达标|未低于 50%)、L2 (\d+) 家(?:（< (\d+)）)?/g,
    en: (_m, pop, den, n, min) => `Fails the three category-gap conditions: Chinese population ${pop === '达标' ? 'meets the threshold' : 'below the threshold'}, density benchmark ${den === '缺失' ? 'missing' : den === '达标' ? 'met' : 'not below 50%'}, ${n} other Chinese restaurants${min ? ` (< ${min})` : ''}`,
    es: (_m, pop, den, n, min) => `No cumple las tres condiciones de hueco de categoría: población china ${pop === '达标' ? 'alcanza el umbral' : 'por debajo del umbral'}, densidad de referencia ${den === '缺失' ? 'sin dato' : den === '达标' ? 'cumplida' : 'no inferior al 50%'}, ${n} otros restaurantes chinos${min ? ` (< ${min})` : ''}`,
  },
  { re: /竞品抓取异常：metro 内该子菜系 POI (\d+) 家，但 drive10 内 L1\+L2 = 0/g, en: 'Competitor fetch anomaly: $1 same-cuisine places in the metro but 0 Chinese restaurants within a 10-minute drive', es: 'Anomalía en competidores: $1 locales de la misma cocina en el área metropolitana pero 0 restaurantes chinos a 10 minutos en coche' },
  { re: /POI 覆盖异常：drive10 内餐饮 POI (\d+) < (\d+)，而圈层人口 (\d+)/g, en: 'POI coverage anomaly: $1 food places within a 10-minute drive (< $2) for a population of $3', es: 'Anomalía de cobertura: $1 locales de comida a 10 minutos en coche (< $2) para una población de $3' },
  { re: /候选池为空：Overture 与 Google 均未返回记录/g, en: 'Empty candidate pool: neither Overture nor Google returned records', es: 'Sin candidatos: ni Overture ni Google devolvieron registros' },
  { re: /竞品源不可用：D5 (.*?)；D6 (.*)/g, en: 'Competitor sources unavailable: map base $1; Google $2', es: 'Fuentes de competidores no disponibles: base de mapa $1; Google $2' },
  { re: /竞品抓取异常：/g, en: 'Competitor fetch anomaly: ', es: 'Anomalía en competidores: ' },
  { re: /竞品守卫：/g, en: 'Competitor check: ', es: 'Control de competidores: ' },
  { re: /竞品数据异常：/g, en: 'Competitor data anomaly: ', es: 'Anomalía en datos de competidores: ' },
  // ---- precheck / gate reasons (qa/gates.ts, pipeline.ts)
  { re: /(?:置信度|数据完整度) (\d+) 分，低于 (\d+) 分门槛/g, en: 'data completeness $1, below the $2 threshold', es: 'integridad de datos $1, por debajo del umbral de $2' },
  { re: /(?:置信度|数据完整度) (\d+) < (\d+)/g, en: 'data completeness $1 < $2', es: 'integridad de datos $1 < $2' },
  { re: /(\S+) 无叙事/g, en: '$1 has no narrative', es: '$1 sin narrativa' },
  { re: /权重和 (\S+) ≠ 100/g, en: 'weights sum to $1 ≠ 100', es: 'los pesos suman $1 ≠ 100' },
  { re: /总分 (\S+) ≠ Σ 权重×分 (\S+)/g, en: 'total $1 ≠ Σ weight × score $2', es: 'total $1 ≠ Σ peso × puntuación $2' },
  { re: /无 CapEx 却显示回收期/g, en: 'payback shown without start-up investment', es: 'recuperación mostrada sin inversión inicial' },
  { re: /(\S+) 缺失/g, en: '$1 missing', es: '$1 ausente' },
  // ---- generic identifiers
  { re: /\bwalk10\b/g, en: '10-minute walk area', es: 'área a 10 minutos a pie' },
  { re: /\bdrive5\b/g, en: '5-minute drive area', es: 'área a 5 minutos en coche' },
  { re: /\bdrive10\b/g, en: '10-minute drive area', es: 'área a 10 minutos en coche' },
  { re: /\bdrive15\b/g, en: '15-minute drive area', es: 'área a 15 minutos en coche' },
  { re: /\bcoverage_ratio\s*=\s*/g, en: 'demand coverage ratio = ', es: 'cobertura de demanda = ' },
  { re: /\bcoverage_ratio\b/g, en: 'demand coverage ratio', es: 'cobertura de demanda' },
  { re: /\boccupancy_cost_ratio\b/g, en: 'occupancy cost ratio', es: 'ratio de costo de ocupación' },
  { re: /\bcluster_score\b/g, en: 'cluster score', es: 'puntuación de aglomeración' },
  { re: /\bL1\s*\+\s*L2\b/g, en: 'same-cuisine + other Chinese restaurants', es: 'misma cocina + otros restaurantes chinos' },
  { re: /\bL1\b/g, en: 'same-cuisine competitors', es: 'competidores de la misma cocina' },
  { re: /\bL2\b/g, en: 'other Chinese restaurants', es: 'otros restaurantes chinos' },
  { re: /\bL3\b/g, en: 'other Asian restaurants', es: 'otros restaurantes asiáticos' },
  { re: /\bL4\b/g, en: 'Chinese-community anchors', es: 'anclas de la comunidad china' },
  { re: /\bHHI\b/g, en: 'concentration', es: 'concentración' },
  { re: /\bHuff\b/g, en: 'demand-split model', es: 'modelo de reparto de demanda' },
  { re: /\bP25\b/g, en: 'low', es: 'bajo' },
  { re: /\bP75\b/g, en: 'high', es: 'alto' },
  { re: /\bAADT\b/g, en: 'daily road traffic', es: 'tráfico vial diario' },
  { re: /\bCapEx\b/gi, en: 'start-up investment', es: 'inversión inicial' },
  { re: /β/g, en: 'distance-decay parameter', es: 'parámetro de decaimiento por distancia' },
  { re: /α/g, en: 'attractiveness parameter', es: 'parámetro de atractivo' },
  { re: /\bseats\s*×\s*turns\b/g, en: 'seats × turns', es: 'asientos × rotaciones' },
  { re: /\bseats\b/g, en: 'seats', es: 'asientos' },
  { re: /\bticket_in\b/g, en: 'dine-in ticket', es: 'ticket en sala' },
  { re: /\bticket_delivery\b/g, en: 'delivery ticket', es: 'ticket de delivery' },
  { re: /\bdelivery_ratio\b/g, en: 'delivery share', es: 'cuota de delivery' },
  { re: /\bparking_spaces\b/g, en: 'parking spaces', es: 'plazas de estacionamiento' },
  { re: /\brent_usd\b/g, en: 'monthly rent', es: 'alquiler mensual' },
  { re: /\bsqft\b/g, en: 'floor area', es: 'superficie' },
  { re: /[（(]destination[）)]/g, en: '(destination-type cuisine)', es: '(cocina de destino)' },
  { re: /[（(]regular[）)]/g, en: '(regular cuisine)', es: '(cocina habitual)' },
  { re: /[（(]everyday[）)]/g, en: '(everyday cuisine)', es: '(cocina cotidiana)' },
  { re: /[（(]none[）)]/g, en: '(not provided)', es: '(no indicado)' },
  { re: /[（(]user_input[）)]/g, en: '(your input)', es: '(su dato)' },
  { re: /[（(]overture_estimate[）)]/g, en: '(map estimate)', es: '(estimación del mapa)' },
  { re: /[（(]D5\s*\+\s*D6[）)]/g, en: '(map base + Google)', es: '(base de mapa + Google)' },
  { re: /（只可写[^）]*）/g, en: '', es: '' },
  { re: /置信度/g, en: 'data completeness', es: 'integridad de datos' },
  { re: /未获取/g, en: 'n/a', es: 'n/d' },
  { re: /未提供/g, en: 'not provided', es: 'no indicado' },
  // ---- CJK punctuation → Latin
  { re: /，/g, en: ', ', es: ', ' },
  { re: /；/g, en: '; ', es: '; ' },
  { re: /：/g, en: ': ', es: ': ' },
  { re: /、/g, en: ', ', es: ', ' },
  { re: /。/g, en: '. ', es: '. ' },
  { re: /（/g, en: ' (', es: ' (' },
  { re: /）/g, en: ') ', es: ') ' },
  { re: /「|」/g, en: '"', es: '"' },
  { re: /　/g, en: ' ', es: ' ' },
];

function applyEngine(text: string, lang: 'en' | 'es'): string {
  let out = text;
  for (const rule of ENGINE_PHRASES) {
    const rep = rule[lang];
    out = typeof rep === 'string' ? out.replace(rule.re, rep) : out.replace(rule.re, rep as (...a: string[]) => string);
  }
  return out
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** English rendering of an engine string (identifiers spelled out, Chinese phrases translated). */
export function plainEn(text: string | null | undefined): string {
  return text ? applyEngine(text, 'en') : '';
}

/** Spanish rendering of an engine string. */
export function plainEs(text: string | null | undefined): string {
  return text ? applyEngine(text, 'es') : '';
}

export function plainText(text: string | null | undefined, lang: Locale): string {
  return lang === 'zh' ? plainZh(text) : lang === 'es' ? plainEs(text) : plainEn(text);
}

/**
 * Pick a bilingual engine field for the report language. Chinese → the zh
 * field; English → the engine's own English; Spanish → the zh field run
 * through the phrase table, or the English field when Chinese would remain.
 */
export function localizedField(zh: string | null | undefined, en: string | null | undefined, lang: Locale): string {
  if (lang === 'zh') return plainZh(zh ?? en);
  if (lang === 'en') return plainEn(en ?? zh);
  const es = plainEs(zh ?? en);
  return hasCjk(es) ? plainEn(en ?? zh) : es;
}
