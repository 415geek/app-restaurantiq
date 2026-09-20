'use client';

/**
 * IQ funnel landing (app.restaurantiq.ai/).
 *
 * Light, product-led layout in the Owner.com / DoorDash idiom: a white canvas,
 * one bold headline, an address "search" card as the single hero action, then
 * how-it-works → what's inside → sample numbers → pricing → audiences → FAQ →
 * account footer. All copy is trilingual (English default, 中文, Español); the
 * sample block uses the golden Millbrae fixture (synthetic inputs, real public
 * data) — never a customer's report.
 *
 * The server page resolves the initial locale (?lang > iq_lang cookie >
 * Accept-Language > en) so there is no flash; the switcher here persists the
 * choice and keeps `?lang=` on the URL and on every outgoing link.
 */
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { useLocale } from '@/lib/i18n/use-locale';

const PRICE_USD = process.env.NEXT_PUBLIC_STRIPE_PRICE_USD?.trim() || '19';

type Copy = {
  nav: { features: string; sample: string; pricing: string; faq: string; signIn: string; cta: string };
  hero: { eyebrow: string; title: string; headlines: string[]; subtitle: string; address: string; cuisine: string; rent: string; sqft: string; more: string; less: string; cta: string; trust: string[] };
  how: { title: string; steps: Array<{ n: string; title: string; body: string }> };
  inside: { title: string; sub: string; items: Array<{ title: string; body: string }> };
  sample: { eyebrow: string; title: string; body: string; verdict: string; rows: Array<{ label: string; value: string; note?: string }>; foot: string };
  pricing: { title: string; sub: string; free: { name: string; price: string; items: string[]; cta: string }; pro: { name: string; price: string; unit: string; items: string[]; cta: string; badge: string } };
  audiences: { title: string; items: Array<{ title: string; body: string }> };
  faq: { title: string; items: Array<{ q: string; a: string }> };
  account: { title: string; body: string; signIn: string; register: string };
  footer: { disclaimer: string };
  langSwitcher: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    nav: { features: "What's inside", sample: 'Sample report', pricing: 'Pricing', faq: 'FAQ', signIn: 'Sign in', cta: 'Check a location' },
    hero: {
      eyebrow: 'Restaurant site-selection risk audit · U.S. Chinese restaurants',
      title: 'Before you sign the lease, let the data tell you if this trade area fits',
      headlines: [
        'Before you sign the lease, let the data tell you if this trade area fits',
        'Know whether this trade area can support a restaurant before you open',
        'Don’t sign on gut feel. Run the numbers on this location first',
        'Chinese households nearby, same-cuisine rivals, break-even: in 1–2 minutes',
        'How much does this spot need to make each month? Find out before you sign',
        'Good locations backed by data. Bad ones flagged before you commit',
      ],
      subtitle: 'Type an address and a cuisine. In one to two minutes: Chinese households nearby, same-cuisine competitors, and the monthly revenue you need just to break even. Built on official statistics and licensed map data — every number is traceable.',
      address: 'Restaurant address, e.g. 123 Main St, San Francisco, CA 94105',
      cuisine: 'Cuisine or concept, e.g. Hunan, HK café, hot pot, boba',
      rent: 'Monthly rent (USD)',
      sqft: 'Size (sq ft)',
      more: 'Add rent and size — optional, makes the finance pages sharper',
      less: 'Hide rent and size',
      cta: 'Get my free risk score',
      trust: ['Verdict in 1–2 minutes', 'Free tier — no sign-up; leave an email to save your result'],
    },
    how: {
      title: 'Three steps from address to verdict',
      steps: [
        { n: '1', title: 'Enter an address and cuisine', body: 'Rent, size, and seats are optional; adding them sharpens the finance pages.' },
        { n: '2', title: 'Read the free summary', body: 'Overall score, verdict (GO / conditional / NO GO), and the three insights that matter — in one to two minutes.' },
        { n: '3', title: 'Unlock the full report when you need it', body: '16-page professional edition: trade area, competitors, demand, break-even, risks, and the pre-lease checklist — as a printable PDF.' },
      ],
    },
    inside: {
      title: "What's inside",
      sub: 'Each page answers one question an owner actually asks, in plain language, with sourced numbers.',
      items: [
        { title: 'Real-map trade area', body: '10-minute walk and 5 · 10 · 15-minute drive rings on a real map, with population, households, and Chinese share per ring.' },
        { title: 'Competitors, one by one', body: 'A card for every same-cuisine rival: distance, Google rating and reviews, price level, traffic tier, and how much of your demand it takes.' },
        { title: 'Demand vs. break-even', body: 'Modeled monthly demand against this site’s break-even line: the gap, and what could close it.' },
        { title: 'Six-dimension score', body: 'Demand, competition, rent, audience, access, clustering — one total, one clear verdict.' },
        { title: 'Risks and pre-lease checklist', body: 'Probability × impact risk register, conditions to negotiate before signing, and a 90-day opening plan.' },
        { title: 'Every number traceable', body: 'A sources page lists the agency, update date, and license for each dataset; anything unavailable says so — nothing is made up.' },
      ],
    },
    sample: {
      eyebrow: 'Sample · Hunan restaurant in Millbrae, CA',
      title: 'This one, we advised against',
      body: 'The same address as Cantonese / BBQ scores 79 (GO). The report doesn’t just say yes or no — it tells you what fits better.',
      verdict: 'NO GO',
      rows: [
        { label: 'Overall score', value: '43.3 / 100', note: '≥ 70 GO, 55–69 conditional' },
        { label: 'Demand coverage', value: '22%', note: 'Modeled demand ÷ break-even; needs ≥ 100%' },
        { label: 'Rent as % of revenue', value: '55%', note: 'Warning line: 10%' },
        { label: 'Break-even', value: '$139,280 / mo', note: 'Fixed costs ÷ contribution margin' },
        { label: 'Same cuisine · other Chinese', value: '4 · 25', note: 'Within a 10-minute drive' },
        { label: 'Data completeness', value: '85 / 100' },
      ],
      foot: 'The sample uses public data and assumed inputs (rent $17,000/mo, 2,500 sq ft); it is not a customer report.',
    },
    pricing: {
      title: 'Look for free. Pay only if it’s worth it.',
      sub: 'The price of one dinner, against a wrong lease.',
      free: { name: 'Free', price: '$0', items: ['Overall score and verdict', 'Three key insights', 'No sign-up — an email only if you want to save the result'], cta: 'Start free' },
      pro: {
        name: 'Professional report',
        price: `$${PRICE_USD}`,
        unit: '/ report',
        badge: 'Most popular',
        items: ['Cover + 15 light pages, printable PDF', 'Four-ring trade area on a real map', 'Same-cuisine competitors, one by one', 'Demand model + break-even + three revenue scenarios', 'Risk register + pre-lease checklist + 90-day plan', 'Free re-run after you add seats, tickets, or known competitors'],
        cta: 'Check my location first',
      },
    },
    audiences: {
      title: 'Built for',
      items: [
        { title: 'First-time owners', body: 'Turn “feels right” into numbers you can read before you sign.' },
        { title: 'Expanding chains', body: 'One standard for every candidate site; screen ten addresses in a day.' },
        { title: 'CRE brokers and landlords', body: 'Hand restaurant tenants a third-party data report; close faster.' },
        { title: 'POS / payments / delivery sales', body: 'Use the audit as a door-opener: help the owner run the numbers first.' },
      ],
    },
    faq: {
      title: 'FAQ',
      items: [
        { q: 'Where does the data come from, and can I trust it?', a: 'Every report is built from official public statistics and licensed commercial map and business datasets, pulled for the exact address you enter rather than a city-wide average. The last page shows the update date and license behind each figure, and anything we could not obtain is marked unavailable — nothing is estimated to fill a gap.' },
        { q: 'What if data is missing?', a: 'It says “unavailable.” Nothing is estimated or invented; when the gaps are too large, the report is marked pre-check and explains what is missing.' },
        { q: 'How long does it take?', a: 'The free verdict takes one to two minutes; the professional report usually 1–3 minutes — you can leave the page and come back.' },
        { q: 'Is this investment advice?', a: 'No. It is a site-selection reference built on public data — it helps you ask the right questions and run the numbers. Verify on site and consult professionals before signing.' },
      ],
    },
    account: { title: 'Already bought a report?', body: 'Sign in to view and download every report you’ve paid for.', signIn: 'Sign in', register: 'Create account' },
    footer: { disclaimer: '© RestaurantIQ · For site-selection reference only; not investment, legal, or leasing advice.' },
    langSwitcher: 'Language',
  },
  zh: {
    nav: { features: '报告里有什么', sample: '报告样例', pricing: '价格', faq: '常见问题', signIn: '登录', cta: '免费测算' },
    hero: {
      eyebrow: '餐饮选址风险审计 · 面向美国中餐老板',
      title: '签 lease 前，先通过数据了解该商圈是否适合',
      headlines: [
        '签 lease 前，先通过数据了解该商圈是否适合',
        '开店之前，先看清这个商圈能不能养活一家店',
        '别凭感觉签租约，用数据算清这个铺位的胜算',
        '附近多少华人家庭、几家同行，1–2 分钟看清',
        '这个铺位每月要做多少才保本？签约前先算',
        '好位置用数据说话，坏位置提前劝退',
      ],
      subtitle: '输入地址和菜系，1–2 分钟看到：附近有多少华人家庭、同菜系竞品几家、每月要做到多少营收才保本。基于官方统计数据与授权地图数据，每个数字都能溯源。',
      address: '餐厅地址，例如 123 Main St, San Francisco, CA 94105',
      cuisine: '菜系或业态，例如：湘菜、港式茶餐厅、火锅、奶茶',
      rent: '预计月租金 USD',
      sqft: '面积 sqft',
      more: '补充租金和面积 — 选填，填了财务页更准',
      less: '收起租金和面积',
      cta: '免费生成风险评分',
      trust: ['1–2 分钟出结论', '免费版无需注册，留邮箱可保存结果'],
    },
    how: {
      title: '三步，从地址到结论',
      steps: [
        { n: '1', title: '输入地址和菜系', body: '租金、面积、座位数可以先不填；填了财务部分会更准。' },
        { n: '2', title: '免费看结论摘要', body: '综合评分、判定（可做 / 有条件 / 不建议）和最要紧的三条洞察，1–2 分钟内给出。' },
        { n: '3', title: '需要时解锁完整报告', body: '16 页专业版：商圈、竞品、需求、保本线、风险与签约清单，PDF 可下载可打印。' },
      ],
    },
    inside: {
      title: '报告里有什么',
      sub: '每一页只回答老板会问的一个问题，白话写，数字有出处。',
      items: [
        { title: '真实地图商圈', body: '步行 10 分钟、开车 5 / 10 / 15 分钟四个范围画在真实地图上，人口、家庭、华人占比逐层给出。' },
        { title: '竞品逐家对标', body: '同菜系竞品一家一张卡：距离、Google 评分与评论数、价位、客流等级、会分走你多少客流。' },
        { title: '需求与保本线', body: '模型预计每月能拿到的需求，对比这个铺位的保本线，告诉你差多少、靠什么补。' },
        { title: '六维评分与判定', body: '需求、竞争、租金、客群、可达、集聚六项打分，一个总分，一个明确的判定。' },
        { title: '风险与签约清单', body: '概率 × 影响的风险登记，签约前必须谈下来的条件，90 天开业计划。' },
        { title: '每个数字可溯源', body: '数据来源页列出每项数据的机构、更新日期和许可；拿不到的数据写「未获取」，不编。' },
      ],
    },
    sample: {
      eyebrow: '报告样例 · 湘菜 @ Millbrae, CA',
      title: '这家店，我们劝退了',
      body: '同样的地址，换成粤菜 / 烧腊评分 79 分「可做」。报告不只说能不能做，还告诉你更适合做什么。',
      verdict: '不建议 · NO GO',
      rows: [
        { label: '综合评分', value: '43.3 / 100', note: '≥ 70 可做，55–69 有条件可做' },
        { label: '需求覆盖率', value: '22%', note: '预计月需求 ÷ 保本线，≥ 100% 才够保本' },
        { label: '租金占预计营收', value: '55%', note: '警戒线 10%' },
        { label: '保本线', value: '$139,280 / 月', note: '固定成本 ÷ 边际贡献率' },
        { label: '同菜系竞品 · 其他中餐', value: '4 家 · 25 家', note: '开车 10 分钟范围内' },
        { label: '数据完整度', value: '85 / 100' },
      ],
      foot: '样例使用公开数据与假设输入（月租 $17,000、2,500 sqft），不代表任何客户报告。',
    },
    pricing: {
      title: '先免费看，值得再付',
      sub: '一顿饭的钱，避免一个错误的租约。',
      free: { name: '免费版', price: '$0', items: ['综合评分与判定', '3 条最要紧的洞察', '无需注册，留邮箱可保存结果'], cta: '免费开始' },
      pro: {
        name: '专业版报告',
        price: `$${PRICE_USD}`,
        unit: '/ 份',
        badge: '最常选',
        items: ['封面 + 15 页浅色 PDF，可打印', '真实地图四圈层商圈', '同菜系竞品逐家对标', '需求分流模型 + 保本线 + 三档营收', '风险登记 + 签约前清单 + 90 天计划', '补充座位、客单价、你知道的竞品后可免费重算'],
        cta: '先免费测算，再决定',
      },
    },
    audiences: {
      title: '为谁做的',
      items: [
        { title: '第一次开店的老板', body: '把「感觉不错」变成看得懂的数字，再决定签不签。' },
        { title: '拓店中的连锁品牌', body: '同一套标准评估每个候选铺位，一天看十个地址。' },
        { title: '商业地产经纪与房东', body: '给餐饮租客一份第三方数据报告，成交更快。' },
        { title: 'POS / 支付 / 外卖 BD', body: '用选址报告作为拓客工具，先帮老板算账。' },
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        { q: '数据从哪来？可信吗？', a: '每份报告都基于官方公开统计数据与授权的商业地图和门店数据，按你输入的具体地址拉取，不是全市平均。报告最后一页标注每个数字背后的更新日期和数据许可；拿不到的数据写「未获取」，不用估算来补空。' },
        { q: '拿不到的数据怎么办？', a: '写「未获取」，不估算、不编造。数据缺口太大时报告会标为预检版，并说明缺什么。' },
        { q: '要多久？', a: '免费结论 1–2 分钟；专业版报告通常 1–3 分钟生成，可以离开页面稍后回来。' },
        { q: '报告能当投资建议吗？', a: '不能。它是基于公开数据的选址参考，帮你把问题问对、把账算清；签约前请实地核查并咨询专业顾问。' },
      ],
    },
    account: { title: '已经买过报告？', body: '登录后可以查看和下载所有已付费的报告。', signIn: '登录', register: '注册账号' },
    footer: { disclaimer: '© RestaurantIQ · 报告仅供选址参考，不构成投资、法律或租赁建议。' },
    langSwitcher: '语言',
  },
  es: {
    nav: { features: 'Qué incluye', sample: 'Informe de muestra', pricing: 'Precios', faq: 'Preguntas frecuentes', signIn: 'Iniciar sesión', cta: 'Evaluar una ubicación' },
    hero: {
      eyebrow: 'Auditoría de riesgo para ubicar restaurantes · Restaurantes chinos en EE. UU.',
      title: 'Antes de firmar el contrato, deja que los datos te digan si esta área comercial funciona',
      headlines: [
        'Antes de firmar el contrato, deja que los datos te digan si esta área comercial funciona',
        'Sabe si esta área comercial puede sostener un restaurante, antes de abrir',
        'No firmes por intuición. Haz los números de este local primero',
        'Hogares chinos cercanos, competidores del mismo tipo de cocina, punto de equilibrio: en 1–2 minutos',
        '¿Cuánto tiene que vender este local cada mes? Descúbrelo antes de firmar',
        'Buenas ubicaciones respaldadas por datos. Malas ubicaciones, señaladas antes de comprometerte',
      ],
      subtitle: 'Escribe una dirección y un tipo de cocina. En uno o dos minutos: hogares chinos cercanos, competidores del mismo tipo de cocina y los ingresos mensuales que necesitas solo para llegar al punto de equilibrio. Basado en estadísticas oficiales y datos de mapas con licencia; cada cifra es rastreable.',
      address: 'Dirección del restaurante, p. ej., 123 Main St, San Francisco, CA 94105',
      cuisine: 'Tipo de cocina o concepto, p. ej., Hunan, cafetería HK, hot pot, boba',
      rent: 'Renta mensual (USD)',
      sqft: 'Tamaño (pies cuadrados)',
      more: 'Agregar renta y tamaño — opcional, afina las páginas financieras',
      less: 'Ocultar renta y tamaño',
      cta: 'Obtener mi puntuación de riesgo gratis',
      trust: ['Veredicto en 1–2 minutos', 'Plan gratuito sin registro; deja tu correo para guardar el resultado'],
    },
    how: {
      title: 'Tres pasos: de la dirección al veredicto',
      steps: [
        { n: '1', title: 'Ingresa la dirección y el tipo de cocina', body: 'La renta, el tamaño y los asientos son opcionales; agregarlos afina las páginas financieras.' },
        { n: '2', title: 'Lee el resumen gratuito', body: 'Puntuación general, veredicto (ADELANTE / condicional / NO RECOMENDADO) y las tres observaciones que importan, en uno o dos minutos.' },
        { n: '3', title: 'Desbloquea el informe completo cuando lo necesites', body: 'Edición profesional de 16 páginas: área comercial, competidores, demanda, punto de equilibrio, riesgos y la lista previa al contrato, en PDF imprimible.' },
      ],
    },
    inside: {
      title: 'Qué incluye',
      sub: 'Cada página responde una pregunta que un dueño realmente se hace, en lenguaje claro y con cifras con fuente.',
      items: [
        { title: 'Área comercial en un mapa real', body: 'Anillos de 10 min a pie y 5 · 10 · 15 min en auto sobre un mapa real, con población, hogares y proporción de población china por anillo.' },
        { title: 'Competidores, uno por uno', body: 'Una tarjeta por cada competidor del mismo tipo de cocina: distancia, calificación y reseñas en Google, nivel de precio, nivel de tráfico y cuánta de tu demanda se lleva.' },
        { title: 'Demanda vs. punto de equilibrio', body: 'Demanda mensual modelada frente a la línea de punto de equilibrio de este local: la brecha y qué podría cerrarla.' },
        { title: 'Puntuación en seis dimensiones', body: 'Demanda, competencia, renta, público, acceso, aglomeración: un total y un veredicto claro.' },
        { title: 'Riesgos y lista previa al contrato', body: 'Registro de riesgos por probabilidad × impacto, condiciones a negociar antes de firmar y un plan de apertura de 90 días.' },
        { title: 'Cada cifra es rastreable', body: 'Una página de fuentes enumera la agencia, la fecha de actualización y la licencia de cada conjunto de datos; lo que no está disponible se indica; nada se inventa.' },
      ],
    },
    sample: {
      eyebrow: 'Muestra · Restaurante Hunan en Millbrae, CA',
      title: 'A este le recomendamos no firmar',
      body: 'La misma dirección como cantonés / BBQ obtiene 79 (ADELANTE). El informe no solo dice sí o no: te dice qué encaja mejor.',
      verdict: 'NO RECOMENDADO',
      rows: [
        { label: 'Puntuación general', value: '43.3 / 100', note: '≥ 70 adelante, 55–69 condicional' },
        { label: 'Cobertura de la demanda', value: '22%', note: 'Demanda modelada ÷ punto de equilibrio; necesita ≥ 100%' },
        { label: 'Renta como % de ingresos', value: '55%', note: 'Línea de alerta: 10%' },
        { label: 'Punto de equilibrio', value: '$139,280 / mes', note: 'Costos fijos ÷ margen de contribución' },
        { label: 'Mismo tipo de cocina · otros chinos', value: '4 · 25', note: 'A 10 minutos en auto' },
        { label: 'Integridad de los datos', value: '85 / 100' },
      ],
      foot: 'La muestra usa datos públicos y supuestos (renta $17,000/mes, 2,500 pies cuadrados); no es el informe de un cliente.',
    },
    pricing: {
      title: 'Míralo gratis. Paga solo si vale la pena.',
      sub: 'El precio de una cena, frente a un contrato equivocado.',
      free: { name: 'Gratis', price: '$0', items: ['Puntuación general y veredicto', 'Tres observaciones clave', 'Sin registro; correo solo si quieres guardar el resultado'], cta: 'Empezar gratis' },
      pro: {
        name: 'Informe profesional',
        price: `$${PRICE_USD}`,
        unit: '/ informe',
        badge: 'El más elegido',
        items: ['Portada + 15 páginas claras, PDF imprimible', 'Área comercial de cuatro anillos en un mapa real', 'Competidores del mismo tipo de cocina, uno por uno', 'Modelo de demanda + punto de equilibrio + tres escenarios de ingresos', 'Registro de riesgos + lista previa al contrato + plan de 90 días', 'Nueva ejecución gratis después de agregar asientos, tickets o competidores conocidos'],
        cta: 'Primero evaluar mi ubicación',
      },
    },
    audiences: {
      title: 'Hecho para',
      items: [
        { title: 'Dueños primerizos', body: 'Convierte el “se siente bien” en números que puedas leer antes de firmar.' },
        { title: 'Cadenas en expansión', body: 'Un mismo estándar para cada local candidato; evalúa diez direcciones en un día.' },
        { title: 'Corredores inmobiliarios y arrendadores', body: 'Entrega a los inquilinos gastronómicos un informe de datos independiente; cierra más rápido.' },
        { title: 'Ventas de POS / pagos / delivery', body: 'Usa la auditoría para abrir puertas: ayuda al dueño a hacer los números primero.' },
      ],
    },
    faq: {
      title: 'Preguntas frecuentes',
      items: [
        { q: '¿De dónde salen los datos y son confiables?', a: 'Cada informe se construye con estadísticas oficiales públicas y datos comerciales de mapas y negocios con licencia, consultados para la dirección exacta que ingresas y no para un promedio de la ciudad. La última página muestra la fecha de actualización y la licencia detrás de cada cifra; lo que no pudimos obtener se marca como no disponible, nada se estima para rellenar huecos.' },
        { q: '¿Qué pasa si faltan datos?', a: 'Se indica “no disponible”. Nada se estima ni se inventa; cuando las lagunas son demasiado grandes, el informe se marca como preliminar y explica qué falta.' },
        { q: '¿Cuánto tarda?', a: 'El veredicto gratuito, de uno a dos minutos; el informe profesional, normalmente de 1 a 3 minutos. Puedes salir de la página y volver.' },
        { q: '¿Es asesoría de inversión?', a: 'No. Es una referencia para elegir ubicación, construida con datos públicos: te ayuda a hacer las preguntas correctas y a hacer los números. Verifica en el sitio y consulta a profesionales antes de firmar.' },
      ],
    },
    account: { title: '¿Ya compraste un informe?', body: 'Inicia sesión para ver y descargar todos los informes que has pagado.', signIn: 'Iniciar sesión', register: 'Crear cuenta' },
    footer: { disclaimer: '© RestaurantIQ · Solo como referencia para elegir ubicación; no es asesoría de inversión, legal ni de arrendamiento.' },
    langSwitcher: 'Idioma',
  },
};

const SHORT_LABEL: Record<Locale, string> = { en: 'EN', zh: '中文', es: 'ES' };

/**
 * Typewriter for the hero headline: types the first phrase on mount, holds,
 * deletes, types the next. Honours prefers-reduced-motion by never animating.
 */
function useTypewriter(phrases: string[], opts: { type?: number; erase?: number; hold?: number } = {}): { text: string; done: boolean } {
  const { type = 70, erase = 32, hold = 1900 } = opts;
  // Starts empty and types the first headline character by character on mount (the
  // caret blinks while the sentence holds); SEO / no-JS readers get the full text
  // from the sr-only copy rendered next to it.
  const [state, setState] = useState<{ i: number; n: number; dir: 'type' | 'hold' | 'erase' }>({ i: 0, n: 0, dir: 'type' });
  const key = phrases.join(' ');
  useEffect(() => {
    setState({ i: 0, n: 0, dir: 'type' });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof window === 'undefined' || phrases.length === 0) return;
    const cur = phrases[state.i] ?? '';
    let delay = type;
    let next = state;
    if (state.dir === 'hold') {
      if (phrases.length < 2) return; // a single headline stays put once typed
      delay = hold;
      next = { ...state, dir: 'erase' };
    } else if (state.dir === 'erase') {
      if (state.n > 0) next = { ...state, n: state.n - 1 };
      else next = { i: (state.i + 1) % phrases.length, n: 0, dir: 'type' };
      delay = erase;
    } else if (state.n < cur.length) {
      next = { ...state, n: state.n + 1 };
      delay = type + (Math.random() * 40 - 20);
    } else {
      next = { ...state, dir: 'hold' };
      delay = 0;
    }
    const t = setTimeout(() => setState(next), Math.max(0, delay));
    return () => clearTimeout(t);
  }, [state, phrases, type, erase, hold]);
  const cur = phrases[state.i] ?? '';
  return { text: cur.slice(0, state.n), done: state.dir === 'hold' };
}

/** Fisher–Yates shuffle of everything after the first (primary) headline, so each visit sees a different order. */
function shuffleAfterFirst(list: string[]): string[] {
  const rest = list.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [list[0], ...rest];
}

function HeroTitle({ headlines }: { headlines: string[] }) {
  const [order, setOrder] = useState<string[]>(headlines);
  useEffect(() => {
    setOrder(shuffleAfterFirst(headlines));
  }, [headlines]); // eslint-disable-line react-hooks/set-state-in-effect
  const { text, done } = useTypewriter(order, { type: 62, erase: 22, hold: 2600 });
  const longest = headlines.reduce((a, b) => (b.length > a.length ? b : a), '');
  return (
    <h1 className="font-cjk-serif text-[clamp(1.6rem,4.6vw,3.15rem)] font-black leading-[1.25] text-white">
      <span className="sr-only">{headlines[0]}</span>
      {/* No whitespace-nowrap: long EN headlines must wrap. Parent section is
          overflow-hidden (glow clip), so nowrap was cutting "Know whether…" on both sides. */}
      <span className="grid text-center" aria-hidden>
        <span className="invisible col-start-1 row-start-1" aria-hidden>
          {longest}
        </span>
        <span className="col-start-1 row-start-1">
          {text}
          <span className={`ml-0.5 inline-block w-[0.06em] translate-y-[0.1em] bg-brand-green align-baseline ${done ? 'animate-pulse' : ''}`} style={{ height: '0.95em' }} aria-hidden />
        </span>
      </span>
    </h1>
  );
}

function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <Image src="/restaurant-iq-logo-mark.svg" alt="" width={32} height={32} className="h-8 w-8" priority />
      <span className="text-[17px] font-extrabold tracking-tight text-white">RestaurantIQ</span>
    </span>
  );
}

const CheckIcon = () => (
  <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 flex-none text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5l4 4 8-9" />
  </svg>
);

export function IqLanding({ initialLocale }: { initialLocale: Locale }) {
  const [location, setLocation] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [sqft, setSqft] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const { locale, setLocale } = useLocale({ initial: initialLocale, syncUrl: true });
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const router = useRouter();
  const t = COPY[locale];

  function handleSubmit() {
    if (!location.trim()) return;
    const params = new URLSearchParams({ location: location.trim(), businessType: businessType.trim(), lang: locale });
    if (monthlyRent.trim()) params.set('monthlyRentUsd', monthlyRent.trim());
    if (sqft.trim()) params.set('sqft', sqft.trim());
    router.push(`/iq/result?${params.toString()}`);
  }

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const loginHref = withLang('/iq/login', locale);
  const signUpHref = `/sign-up?redirect_url=${encodeURIComponent(withLang('/iq/dashboard', locale))}`;

  return (
    <main lang={LOCALE_TAG[locale]} className="font-cjk-sans min-h-screen bg-white text-brand-navy antialiased">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-brand-navy/95 text-white backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-5">
          <Link href={withLang('/iq', locale)} aria-label="RestaurantIQ">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-300 md:flex" aria-label="Sections">
            <button type="button" onClick={() => scrollTo('inside')} className="hover:text-white">{t.nav.features}</button>
            <button type="button" onClick={() => scrollTo('pricing')} className="hover:text-white">{t.nav.pricing}</button>
            <button type="button" onClick={() => scrollTo('faq')} className="hover:text-white">{t.nav.faq}</button>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="inline-flex rounded-full border border-white/20 p-0.5" role="group" aria-label={t.langSwitcher}>
              {LOCALES.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  aria-pressed={l === locale}
                  lang={LOCALE_TAG[l]}
                  className={`rounded-full px-2 py-1 text-xs font-semibold transition ${l === locale ? 'bg-white/15 text-white' : 'text-zinc-300 hover:bg-white/10'}`}
                >
                  {SHORT_LABEL[l]}
                </button>
              ))}
            </div>
            <Link href={loginHref} className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-white/10 sm:inline-flex">
              {t.nav.signIn}
            </Link>
            <button type="button" onClick={() => scrollTo('top')} className="hidden rounded-full bg-brand-green px-4 py-2 text-sm font-bold text-brand-navy hover:bg-emerald-400 sm:inline-flex">
              {t.nav.cta}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section id="top" className="relative overflow-hidden bg-brand-navy text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-green/15 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 md:pb-24 md:pt-20">
          <div className="mx-auto max-w-5xl text-center">
            <p className="mb-5 inline-flex rounded-full bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-brand-green ring-1 ring-brand-green/30">{t.hero.eyebrow}</p>
            <div className="mx-auto flex justify-center">
              <HeroTitle headlines={t.hero.headlines} />
            </div>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-300 md:text-lg">{t.hero.subtitle}</p>
          </div>

          {/* address search card */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="mx-auto mt-9 max-w-3xl rounded-3xl bg-white p-3 text-brand-navy shadow-[0_30px_80px_-30px_rgba(34,197,94,0.35)] ring-1 ring-white/10 sm:p-4"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 ring-1 ring-inset ring-zinc-200 focus-within:ring-2 focus-within:ring-brand-green">
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <input
                  type="text"
                  name="location"
                  autoComplete="street-address"
                  placeholder={t.hero.address}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  required
                  className="h-14 w-full bg-transparent text-[15px] text-brand-navy outline-none placeholder:text-zinc-400"
                />
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-4 ring-1 ring-inset ring-zinc-200 focus-within:ring-2 focus-within:ring-brand-green">
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v16m0-7h4a3 3 0 003-3V4M16 4h4v6a3 3 0 01-3 3h-1zm3 9v7" />
                </svg>
                <input
                  type="text"
                  name="businessType"
                  placeholder={t.hero.cuisine}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="h-14 w-full bg-transparent text-[15px] text-brand-navy outline-none placeholder:text-zinc-400"
                />
              </label>
            </div>
            {moreOpen ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="text" inputMode="decimal" placeholder={t.hero.rent} value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} className="h-12 rounded-2xl bg-zinc-50 px-4 text-[15px] text-brand-navy outline-none ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-green" />
                <input type="text" inputMode="decimal" placeholder={t.hero.sqft} value={sqft} onChange={(e) => setSqft(e.target.value)} className="h-12 rounded-2xl bg-zinc-50 px-4 text-[15px] text-brand-navy outline-none ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-green" />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={!location.trim()}
              className="mt-2 h-14 w-full rounded-2xl bg-brand-green px-6 text-[15px] font-bold text-brand-navy transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.hero.cta}
            </button>
            {/* Optional rent / size: a full-width control, not a footnote link — users
                were not seeing the grey underlined text under the CTA at all. */}
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              className={`mt-2 flex h-12 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left text-sm font-semibold transition ${
                moreOpen
                  ? 'border-zinc-300 bg-zinc-50 text-brand-navy hover:bg-zinc-100'
                  : 'border-dashed border-emerald-500/70 bg-emerald-50 text-brand-navy hover:border-emerald-600 hover:bg-emerald-100'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <span className={`inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-base font-bold leading-none ${moreOpen ? 'bg-zinc-200 text-zinc-700' : 'bg-brand-green text-brand-navy'}`} aria-hidden>
                  {moreOpen ? '−' : '+'}
                </span>
                {moreOpen ? t.hero.less : t.hero.more}
              </span>
              <svg viewBox="0 0 20 20" className={`h-4 w-4 flex-none text-zinc-500 transition ${moreOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
              </svg>
            </button>
          </form>

          <ul className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-zinc-400">
            {t.hero.trust.map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-green" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section className="bg-brand-navy text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.how.title}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {t.how.steps.map((s) => (
              <li key={s.n} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green text-base font-extrabold text-brand-navy">{s.n}</div>
                <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── What's inside ──────────────────────────────────────────────── */}
      <section id="inside" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="max-w-2xl">
          <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.inside.title}</h2>
          <p className="mt-3 text-zinc-600">{t.inside.sub}</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.inside.items.map((f, i) => (
            <div key={f.title} className="rounded-2xl border border-zinc-200 p-6 transition hover:border-brand-green/50 hover:shadow-md">
              <div className="text-xs font-bold text-emerald-600">{String(i + 1).padStart(2, '0')}</div>
              <h3 className="mt-2 text-lg font-bold text-brand-navy">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sample numbers ─────────────────────────────────────────────── */}
      <section id="sample" className="bg-brand-canvas">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">{t.sample.eyebrow}</p>
            <h2 className="font-cjk-serif mt-3 text-2xl font-black md:text-4xl">{t.sample.title}</h2>
            <p className="mt-4 text-zinc-600">{t.sample.body}</p>
            <div className="mt-6 inline-flex items-center gap-3 rounded-2xl bg-brand-navy px-5 py-3 text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-red" aria-hidden />
              <span className="text-lg font-extrabold tracking-tight">{t.sample.verdict}</span>
            </div>
            <p className="mt-6 text-xs text-zinc-500">{t.sample.foot}</p>
          </div>
          <div className="rounded-3xl bg-white p-2 shadow-[0_20px_60px_-24px_rgba(20,20,19,0.3)] ring-1 ring-zinc-200">
            <dl className="divide-y divide-zinc-100">
              {t.sample.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-3.5">
                  <div>
                    <dt className="text-sm font-medium text-zinc-700">{r.label}</dt>
                    {r.note ? <dd className="text-xs text-zinc-400">{r.note}</dd> : null}
                  </div>
                  <dd className="text-right text-lg font-extrabold tabular-nums tracking-tight text-brand-navy">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.pricing.title}</h2>
          <p className="mt-3 text-zinc-600">{t.pricing.sub}</p>
        </div>
        <div className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-zinc-200 p-7">
            <div className="text-sm font-bold text-zinc-500">{t.pricing.free.name}</div>
            <div className="mt-2 text-4xl font-extrabold tracking-tight">{t.pricing.free.price}</div>
            <ul className="mt-6 space-y-3 text-sm text-zinc-700">
              {t.pricing.free.items.map((i) => (
                <li key={i} className="flex gap-2"><CheckIcon />{i}</li>
              ))}
            </ul>
            <button type="button" onClick={() => scrollTo('top')} className="mt-8 w-full rounded-2xl border border-zinc-300 px-5 py-3 text-sm font-bold text-brand-navy hover:bg-zinc-50">{t.pricing.free.cta}</button>
          </div>
          <div className="relative rounded-3xl bg-brand-navy p-7 text-white ring-4 ring-brand-green/25">
            <span className="absolute -top-3 left-6 rounded-full bg-brand-green px-3 py-1 text-xs font-bold text-brand-navy">{t.pricing.pro.badge}</span>
            <div className="text-sm font-bold text-zinc-400">{t.pricing.pro.name}</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight">{t.pricing.pro.price}</span>
              <span className="text-sm text-zinc-400">{t.pricing.pro.unit}</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm text-zinc-200">
              {t.pricing.pro.items.map((i) => (
                <li key={i} className="flex gap-2"><CheckIcon />{i}</li>
              ))}
            </ul>
            <button type="button" onClick={() => scrollTo('top')} className="mt-8 w-full rounded-2xl bg-brand-green px-5 py-3 text-sm font-bold text-brand-navy hover:bg-emerald-400">{t.pricing.pro.cta}</button>
          </div>
        </div>
      </section>

      {/* ── Audiences ──────────────────────────────────────────────────── */}
      <section className="border-y border-zinc-100 bg-brand-canvas">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <h2 className="font-cjk-serif text-2xl font-black md:text-3xl">{t.audiences.title}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.audiences.items.map((a) => (
              <div key={a.title} className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200">
                <h3 className="font-bold text-brand-navy">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.faq.title}</h2>
        <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200">
          {t.faq.items.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={f.q}>
                <button type="button" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-bold text-brand-navy">
                  {f.q}
                  <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border border-zinc-300 text-lg leading-none transition ${open ? 'rotate-45' : ''}`} aria-hidden>+</span>
                </button>
                {open ? <p className="pb-5 text-sm leading-relaxed text-zinc-600">{f.a}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Final CTA + account ─────────────────────────────────────────── */}
      <section className="bg-brand-navy text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="font-cjk-serif text-2xl font-black md:text-4xl">{t.hero.title}</h2>
              <button type="button" onClick={() => scrollTo('top')} className="mt-6 rounded-2xl bg-brand-green px-6 py-3.5 text-sm font-bold text-brand-navy hover:bg-emerald-400">{t.hero.cta}</button>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-lg font-bold">{t.account.title}</h3>
              <p className="mt-2 text-sm text-zinc-300">{t.account.body}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href={loginHref} className="rounded-2xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">{t.account.signIn}</Link>
                <Link href={signUpHref} className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-navy hover:bg-zinc-200">{t.account.register}</Link>
              </div>
            </div>
          </div>
          <footer className="mt-12 border-t border-white/10 pt-6 text-xs text-zinc-400">
            <span>{t.footer.disclaimer}</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
