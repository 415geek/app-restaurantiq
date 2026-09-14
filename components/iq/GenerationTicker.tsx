'use client';

/**
 * Live "what we are doing right now" line under the paid-report progress bar,
 * replacing the bare elapsed counter.
 *
 *  - The message follows the real progress (percent) and is phrased around the
 *    customer's own address / city, alternating between two wordings per phase
 *    every few seconds so the line keeps moving even when the bar does not.
 *  - After a short grace period a countdown appears ("About 2:30 to go"),
 *    anchored on the typical 3-minute run; it stretches instead of hitting
 *    zero (5 min, then "finishing up") so it never promises what it cannot keep.
 */
import { useEffect, useMemo, useState } from 'react';
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

/** Two wordings per phase; index = phase from percent, alternate = slow tick. */
export function tickerMessages(lang: Locale, location: string): string[][] {
  const city = cityOf(location);
  const addr = shortAddr(location);
  if (lang === 'zh') {
    return [
      [`正在核对「${addr}」的地址与人口普查小区…`, `正在定位 ${city} 这个铺位所在的街区…`],
      [`正在获取该地址过往商家的经营情况…`, `正在查看这个铺位之前开过什么店、评价如何…`],
      [`正在分析 ${city} 周边的人口结构与华人家庭数量…`, `正在统计步行 10 分钟与开车 15 分钟范围内的居民和收入…`],
      [`正在清点周边的餐饮门店和同菜系竞品…`, `正在逐家对标竞品：距离、评分、客流…`],
      [`正在测算这个商圈每月能拿到的需求…`, `正在计算保本线与租金压力…`],
      [`正在核算三档营收情景与回本周期…`, `正在检查外卖信号与午市 / 晚市客流…`],
      [`正在整理风险清单与签约前必须谈的条件…`, `正在给这个铺位打六维评分…`],
      [`正在复核每个数字的数据来源…`, `正在排版报告（封面 + 15 页）…`],
    ];
  }
  if (lang === 'es') {
    return [
      [`Ubicando "${addr}" y su grupo de bloques censales…`, `Localizando la cuadra en ${city}…`],
      [`Consultando el historial de negocios en esta dirección…`, `Revisando qué operó aquí antes y cómo lo calificaban…`],
      [`Analizando la población y los hogares chinos alrededor de ${city}…`, `Contando residentes e ingresos a 10 min a pie y 15 min en auto…`],
      [`Contando restaurantes cercanos y competidores del mismo tipo de cocina…`, `Comparando cada competidor: distancia, calificación, tráfico…`],
      [`Modelando la demanda mensual que este local puede captar…`, `Calculando el punto de equilibrio y la presión de la renta…`],
      [`Corriendo tres escenarios de ingresos y el retorno de la inversión…`, `Revisando señales de delivery y tráfico de almuerzo / cena…`],
      [`Armando el registro de riesgos y las condiciones previas al contrato…`, `Calificando el local en seis dimensiones…`],
      [`Verificando la fuente de cada cifra…`, `Maquetando el informe (portada + 15 páginas)…`],
    ];
  }
  return [
    [`Locating "${addr}" and its census block group…`, `Pinning down the block in ${city}…`],
    [`Pulling the history of businesses at this address…`, `Checking what operated here before and how it was rated…`],
    [`Analyzing population and Chinese households around ${city}…`, `Counting residents and income within a 10-min walk and 15-min drive…`],
    [`Counting nearby restaurants and same-cuisine competitors…`, `Benchmarking each competitor: distance, rating, traffic…`],
    [`Modeling the monthly demand this site can capture…`, `Computing the break-even line and rent pressure…`],
    [`Running three revenue scenarios and payback…`, `Checking delivery signals and lunch / dinner traffic…`],
    [`Assembling the risk register and pre-lease conditions…`, `Scoring the site on six dimensions…`],
    [`Verifying the source of every number…`, `Laying out the report (cover + 15 pages)…`],
  ];
}

const TYPICAL_SEC = 180;
const STRETCH_SEC = 300;
const COUNTDOWN_AFTER_SEC = 15;
const ALTERNATE_EVERY_SEC = 5;

function fmtRemaining(lang: Locale, sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (lang === 'zh') {
    if (sec < 60) return '不到 1 分钟';
    return s === 0 ? `约 ${m} 分钟` : `约 ${m} 分 ${String(s).padStart(2, '0')} 秒`;
  }
  if (sec < 60) return lang === 'es' ? 'menos de un minuto' : 'under a minute';
  return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Countdown copy for the current second, or null while still in the grace period. */
export function etaLabel(lang: Locale, elapsedSec: number, percent: number): string | null {
  if (elapsedSec < COUNTDOWN_AFTER_SEC) return null;
  if (percent >= 90) {
    if (lang === 'zh') return '正在收尾，马上就好';
    if (lang === 'es') return 'Terminando; ya casi está';
    return 'Finishing up — almost there';
  }
  const target = elapsedSec < TYPICAL_SEC - 20 ? TYPICAL_SEC : STRETCH_SEC;
  const remaining = target - elapsedSec;
  if (remaining <= 0) {
    if (lang === 'zh') return '比平时慢一些，正在收尾…';
    if (lang === 'es') return 'Está tardando un poco más de lo normal; terminando…';
    return 'Taking a little longer than usual — finishing…';
  }
  if (lang === 'zh') return `预计还需${fmtRemaining(lang, remaining)}`;
  if (lang === 'es') return remaining < 60 ? 'Falta menos de un minuto' : `Faltan unos ${fmtRemaining(lang, remaining)}`;
  return remaining < 60 ? 'Under a minute to go' : `About ${fmtRemaining(lang, remaining)} to go`;
}

export function GenerationTicker({ lang, location, elapsedSec, percent }: { lang: Locale; location: string; elapsedSec: number; percent: number }) {
  const groups = useMemo(() => tickerMessages(lang, location), [lang, location]);
  const [alt, setAlt] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setAlt((a) => a + 1), ALTERNATE_EVERY_SEC * 1000);
    return () => window.clearInterval(t);
  }, []);
  const phase = Math.min(groups.length - 1, Math.floor((Math.max(0, Math.min(99, percent)) / 100) * groups.length));
  const message = groups[phase][alt % groups[phase].length];
  const eta = etaLabel(lang, elapsedSec, percent);
  return (
    <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
      <span className="inline-flex min-w-0 items-center gap-2 text-zinc-300">
        <span className="relative flex h-2 w-2 flex-none">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span key={message} className="truncate animate-[fadeIn_.4s_ease-out]">{message}</span>
      </span>
      {eta ? <span className="flex-none tabular-nums text-zinc-500">{eta}</span> : null}
    </div>
  );
}
