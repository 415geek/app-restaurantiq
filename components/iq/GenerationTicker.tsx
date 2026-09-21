'use client';

/**
 * Live "what we are doing right now" line under the paid-report progress bar,
 * replacing the bare elapsed counter.
 *
 *  - The message follows the real progress (percent) and is phrased around the
 *    customer's own address / city. Each phase has several wordings that rotate
 *    every few seconds, and once a phase has been on screen for a while the
 *    line borrows from the neighbouring phases so a long stage never loops the
 *    same two sentences.
 *  - After a short grace period a countdown appears ("About 3:30 to go"),
 *    anchored on the tier's ETA (评审 Spec §4.7 分档 ETA: ~4 min standard,
 *    ~12 min professional, refined by the P50 of recent runs). It only ever
 *    goes down — the remaining seconds are clamped monotonically, so a longer
 *    ETA arriving mid-run can pull the number down but never back up — under a
 *    minute it switches to a coarse "under a minute", and past the anchor it
 *    says "taking a little longer" instead of restarting.
 *  - When the server reports the real stage (评审 Spec §4.6) the wording
 *    follows that stage instead of guessing a phase from the percentage.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';

/** "1115 Clement St, San Francisco, CA 94118" → "San Francisco"; falls back to the address. */
export function cityOf(location: string): string {
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2].replace(/\s+\d{5}(-\d{4})?$/, '');
  if (parts.length === 2) return parts[1].replace(/\s+[A-Z]{2}\s*\d{5}.*$/, '').replace(/\s+\d{5}(-\d{4})?$/, '');
  return location;
}

function shortAddr(location: string): string {
  const s = location.split(',')[0]?.trim() || location;
  return s.length > 36 ? `${s.slice(0, 34)}…` : s;
}

/** Wordings per phase (index = phase from percent); the component rotates through them. */
export function tickerMessages(lang: Locale, location: string): string[][] {
  const city = cityOf(location);
  const addr = shortAddr(location);
  if (lang === 'zh') {
    return [
      [
        `正在核对「${addr}」的地址与人口普查小区…`,
        `正在定位 ${city} 这个铺位所在的街区…`,
        `正在确认这条街的车流方向与停车条件…`,
        `正在拉取这个街区的地块与商业用途信息…`,
        `正在标记步行 10 分钟与开车 5 / 10 / 15 分钟的范围…`,
      ],
      [
        `正在获取该地址过往商家的经营情况…`,
        `正在查看这个铺位之前开过什么店、评价如何…`,
        `正在核对这个地址的换手记录与空置时间…`,
        `正在检索 ${city} 本地新闻里提到过这个铺位的信息…`,
        `正在比对同一条街上最近关门与新开的店…`,
      ],
      [
        `正在分析 ${city} 周边的人口结构与华人家庭数量…`,
        `正在统计步行 10 分钟与开车 15 分钟范围内的居民和收入…`,
        `正在查看这个商圈的家庭收入分布与消费力…`,
        `正在估算白天上班人口与夜间常住人口的差别…`,
        `正在核对周边学校、写字楼、超市等客流锚点…`,
      ],
      [
        `正在清点周边的餐饮门店和同菜系竞品…`,
        `正在逐家对标竞品：距离、评分、客流…`,
        `正在读取竞品的评价关键词：好评在哪、差评在哪…`,
        `正在查看竞品的价位带与人均消费…`,
        `正在把竞品分成四层：直接、同菜系、同价位、替代选择…`,
      ],
      [
        `正在测算这个商圈每月能拿到的需求…`,
        `正在计算保本线与租金压力…`,
        `正在按午市 / 晚市 / 周末拆分客流…`,
        `正在推算合理的客单价与翻台率区间…`,
        `正在把租金占营收的比例与行业警戒线对比…`,
      ],
      [
        `正在核算三档营收情景与回本周期…`,
        `正在检查外卖信号与午市 / 晚市客流…`,
        `正在测算保守 / 基准 / 乐观三种情况下的月利润…`,
        `正在估算前期投入与回收周期…`,
        `正在测试租金、客单价、客流变化对利润的敏感度…`,
      ],
      [
        `正在整理风险清单与签约前必须谈的条件…`,
        `正在给这个铺位打六维评分…`,
        `正在列出签 lease 前必须问房东的问题…`,
        `正在标记哪些风险可以谈、哪些是硬伤…`,
        `正在把结论压缩成一句话判定…`,
      ],
      [
        `正在复核每个数字的数据来源…`,
        `正在排版报告（封面 + 15 页）…`,
        `正在生成地图与图表…`,
        `正在检查报告里的数字是否前后一致…`,
        `正在做最后一遍通读与校对…`,
      ],
    ];
  }
  if (lang === 'es') {
    return [
      [
        `Ubicando "${addr}" y su grupo de bloques censales…`,
        `Localizando la cuadra en ${city}…`,
        `Confirmando el sentido del tráfico y el estacionamiento en esta calle…`,
        `Consultando el uso comercial y la parcela de este bloque…`,
        `Trazando los radios de 10 min a pie y 5 / 10 / 15 min en auto…`,
      ],
      [
        `Consultando el historial de negocios en esta dirección…`,
        `Revisando qué operó aquí antes y cómo lo calificaban…`,
        `Verificando cambios de operador y periodos vacíos en esta dirección…`,
        `Buscando menciones de este local en noticias locales de ${city}…`,
        `Comparando cierres y aperturas recientes en la misma calle…`,
      ],
      [
        `Analizando la población y los hogares chinos alrededor de ${city}…`,
        `Contando residentes e ingresos a 10 min a pie y 15 min en auto…`,
        `Revisando la distribución de ingresos y el poder de compra de la zona…`,
        `Estimando la diferencia entre población diurna y residente…`,
        `Identificando anclas de tráfico: escuelas, oficinas, supermercados…`,
      ],
      [
        `Contando restaurantes cercanos y competidores del mismo tipo de cocina…`,
        `Comparando cada competidor: distancia, calificación, tráfico…`,
        `Leyendo las reseñas de la competencia: qué elogian y qué critican…`,
        `Revisando el rango de precios y el ticket promedio de los competidores…`,
        `Clasificando la competencia en cuatro capas: directa, misma cocina, mismo precio, sustitutos…`,
      ],
      [
        `Modelando la demanda mensual que este local puede captar…`,
        `Calculando el punto de equilibrio y la presión de la renta…`,
        `Separando el tráfico de almuerzo, cena y fin de semana…`,
        `Estimando el ticket promedio y la rotación de mesas razonables…`,
        `Comparando la renta como porcentaje de ventas con el umbral del sector…`,
      ],
      [
        `Corriendo tres escenarios de ingresos y el retorno de la inversión…`,
        `Revisando señales de delivery y tráfico de almuerzo / cena…`,
        `Calculando la utilidad mensual en los casos conservador, base y optimista…`,
        `Estimando la inversión inicial y el periodo de recuperación…`,
        `Probando la sensibilidad de la utilidad a la renta, el ticket y el tráfico…`,
      ],
      [
        `Armando el registro de riesgos y las condiciones previas al contrato…`,
        `Calificando el local en seis dimensiones…`,
        `Listando las preguntas que hay que hacerle al arrendador antes de firmar…`,
        `Marcando qué riesgos se pueden negociar y cuáles son eliminatorios…`,
        `Resumiendo la conclusión en un veredicto de una línea…`,
      ],
      [
        `Verificando la fuente de cada cifra…`,
        `Maquetando el informe (portada + 15 páginas)…`,
        `Generando el mapa y las gráficas…`,
        `Comprobando que las cifras del informe sean consistentes…`,
        `Haciendo la última lectura y corrección…`,
      ],
    ];
  }
  return [
    [
      `Locating "${addr}" and its census block group…`,
      `Pinning down the block in ${city}…`,
      `Confirming traffic direction and parking on this street…`,
      `Pulling the parcel and commercial-use record for this block…`,
      `Drawing the 10-min walk and 5 / 10 / 15-min drive rings…`,
    ],
    [
      `Pulling the history of businesses at this address…`,
      `Checking what operated here before and how it was rated…`,
      `Checking operator turnover and vacancy gaps at this address…`,
      `Searching ${city} local news for mentions of this storefront…`,
      `Comparing recent closures and openings on the same street…`,
    ],
    [
      `Analyzing population and Chinese households around ${city}…`,
      `Counting residents and income within a 10-min walk and 15-min drive…`,
      `Reviewing household income distribution and spending power in the area…`,
      `Estimating the gap between daytime workers and residents…`,
      `Mapping traffic anchors: schools, offices, supermarkets…`,
    ],
    [
      `Counting nearby restaurants and same-cuisine competitors…`,
      `Benchmarking each competitor: distance, rating, traffic…`,
      `Reading competitor reviews: what gets praised, what gets panned…`,
      `Checking competitor price bands and average ticket…`,
      `Sorting competitors into four layers: direct, same cuisine, same price, substitutes…`,
    ],
    [
      `Modeling the monthly demand this site can capture…`,
      `Computing the break-even line and rent pressure…`,
      `Splitting traffic across lunch, dinner and weekends…`,
      `Estimating a realistic ticket size and table-turn range…`,
      `Comparing rent as a share of sales against the industry warning line…`,
    ],
    [
      `Running three revenue scenarios and payback…`,
      `Checking delivery signals and lunch / dinner traffic…`,
      `Computing monthly profit under conservative, base and upside cases…`,
      `Estimating upfront investment and the payback period…`,
      `Stress-testing profit against rent, ticket size and traffic swings…`,
    ],
    [
      `Assembling the risk register and pre-lease conditions…`,
      `Scoring the site on six dimensions…`,
      `Listing the questions to put to the landlord before signing…`,
      `Flagging which risks are negotiable and which are deal-breakers…`,
      `Condensing the findings into a one-line verdict…`,
    ],
    [
      `Verifying the source of every number…`,
      `Laying out the report (cover + 15 pages)…`,
      `Rendering the map and charts…`,
      `Checking that every figure in the report agrees with the others…`,
      `Doing a final read-through and proof…`,
    ],
  ];
}

/** Anchor when the server has not reported a tier ETA yet (the standard tier's ~4 min). */
const TYPICAL_SEC = 240;
const COUNTDOWN_AFTER_SEC = 15;
const ROTATE_EVERY_SEC = 5;
/** Borrow from neighbouring phases until the rotation has at least this many wordings. */
const MIN_POOL = 12;

function fmtRemaining(lang: Locale, sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (lang === 'zh') return s === 0 ? `约 ${m} 分钟` : `约 ${m} 分 ${String(s).padStart(2, '0')} 秒`;
  return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Countdown copy for the current second, or null while still in the grace period.
 *
 * The remaining time is `totalSec - elapsed` (the tier ETA, §4.7) unless the
 * caller passes an already-clamped `remainingSec`. Either way it only falls:
 * under a minute it becomes a coarse label, past the anchor it becomes "taking
 * a little longer" instead of resetting to a bigger number.
 */
export function etaLabel(
  lang: Locale,
  elapsedSec: number,
  percent: number,
  opts?: { totalSec?: number; remainingSec?: number },
): string | null {
  if (elapsedSec < COUNTDOWN_AFTER_SEC) return null;
  if (percent >= 90) {
    if (lang === 'zh') return '正在收尾，马上就好';
    if (lang === 'es') return 'Terminando; ya casi está';
    return 'Finishing up — almost there';
  }
  const remaining = opts?.remainingSec ?? (opts?.totalSec ?? TYPICAL_SEC) - elapsedSec;
  if (remaining <= 0) {
    if (lang === 'zh') return '比平时慢一些，正在收尾…';
    if (lang === 'es') return 'Está tardando un poco más de lo normal; terminando…';
    return 'Taking a little longer than usual — finishing…';
  }
  if (remaining < 60) {
    if (lang === 'zh') return '预计还需不到 1 分钟';
    if (lang === 'es') return 'Falta menos de un minuto';
    return 'Under a minute to go';
  }
  if (lang === 'zh') return `预计还需${fmtRemaining(lang, remaining)}`;
  if (lang === 'es') return `Faltan unos ${fmtRemaining(lang, remaining)}`;
  return `About ${fmtRemaining(lang, remaining)} to go`;
}

/** Phase index for a progress percentage. */
export function phaseOf(percent: number, phases: number): number {
  return Math.min(phases - 1, Math.floor((Math.max(0, Math.min(99, percent)) / 100) * phases));
}

/**
 * Message group for a real server stage (index into the five-row checklist:
 * competitors → demographics → finance → write → layout). Each stage starts on
 * the wording group that describes it and borrows from the following ones.
 */
export function tickerPhaseForStage(stageIndex: number, phases: number): number {
  const map = [0, 2, 4, 5, 7];
  const idx = Math.max(0, Math.min(map.length - 1, Math.floor(stageIndex)));
  return Math.min(phases - 1, map[idx]);
}

/**
 * Message to show at rotation tick `tick` while in `phase`. Runs through the
 * phase's own wordings first, then borrows from the next phases and — for the
 * late phases, which have nothing after them — from the earlier ones, until the
 * pool holds at least `MIN_POOL` lines (§4.7: a stage that stalls for minutes
 * must never visibly cycle between two sentences). Never repeats twice in a row.
 */
export function pickMessage(groups: string[][], phase: number, tick: number): string {
  const pool = [...(groups[phase] ?? [])];
  for (let i = 1; i <= 2 && phase + i < groups.length; i++) pool.push(...groups[phase + i]);
  for (let i = 1; pool.length < MIN_POOL && phase - i >= 0; i++) pool.push(...groups[phase - i]);
  if (pool.length === 0) return '';
  return pool[tick % pool.length];
}

export function GenerationTicker({
  lang,
  location,
  elapsedSec,
  percent,
  stageIndex,
  etaSeconds,
  remainingSec,
}: {
  lang: Locale;
  location: string;
  elapsedSec: number;
  percent: number;
  /** Real active stage from the status endpoint; when absent the phase is guessed from `percent`. */
  stageIndex?: number | null;
  /** Tier ETA from the status endpoint (§4.7); the standard-tier anchor until it arrives. */
  etaSeconds?: number | null;
  /** Already clamped by the wait screen (§4.7 monotonic); unset before the first tick. */
  remainingSec?: number | null;
}) {
  const groups = useMemo(() => tickerMessages(lang, location), [lang, location]);
  const phase =
    typeof stageIndex === 'number' && stageIndex >= 0 ? tickerPhaseForStage(stageIndex, groups.length) : phaseOf(percent, groups.length);
  // Rotation tick counts from the moment the current phase started, so each
  // phase begins with its own first wording before borrowing from the next ones.
  const [tick, setTick] = useState(0);
  const phaseRef = useRef(phase);
  useEffect(() => {
    if (phaseRef.current !== phase) {
      phaseRef.current = phase;
      setTick(0);
    }
  }, [phase]);
  useEffect(() => {
    const t = window.setInterval(() => setTick((a) => a + 1), ROTATE_EVERY_SEC * 1000);
    return () => window.clearInterval(t);
  }, []);
  const message = pickMessage(groups, phase, tick);
  // §4.7 monotonic countdown: the wait screen owns the clamp (it also owns the
  // clock); until its first tick the tier anchor alone drives the number.
  const total = typeof etaSeconds === 'number' && etaSeconds > 0 ? etaSeconds : TYPICAL_SEC;
  const eta = etaLabel(lang, elapsedSec, percent, {
    totalSec: total,
    remainingSec: typeof remainingSec === 'number' ? remainingSec : undefined,
  });
  return (
    <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
      <span className="inline-flex min-w-0 items-center gap-2 text-zinc-700">
        <span className="relative flex h-2 w-2 flex-none">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-pine opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-pine" />
        </span>
        <span key={message} className="truncate animate-[fadeIn_.4s_ease-out]">{message}</span>
      </span>
      {eta ? <span className="flex-none tabular-nums text-zinc-500">{eta}</span> : null}
    </div>
  );
}
