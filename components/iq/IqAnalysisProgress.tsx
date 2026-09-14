'use client';

import type { ReactNode } from 'react';

import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';

export type AnalysisProgressStage = {
  id: string;
  label: string;
};

type PhaseTarget = { atSec: number; pct: number };

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Map elapsed seconds to a smooth 0–maxPct curve using phase keyframes. */
export function progressFromElapsed(
  elapsedSec: number,
  phases: PhaseTarget[],
  opts?: { maxPctUntilDone?: number; done?: boolean },
): number {
  if (opts?.done) return 100;
  const max = opts?.maxPctUntilDone ?? 92;
  if (phases.length === 0) return 0;

  const sorted = [...phases].sort((a, b) => a.atSec - b.atSec);
  if (elapsedSec <= sorted[0].atSec) {
    const t = sorted[0].atSec > 0 ? elapsedSec / sorted[0].atSec : 1;
    return easeOutCubic(t) * sorted[0].pct;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (elapsedSec >= cur.atSec && elapsedSec < next.atSec) {
      const span = next.atSec - cur.atSec || 1;
      const t = (elapsedSec - cur.atSec) / span;
      const pct = cur.pct + (next.pct - cur.pct) * easeOutCubic(t);
      return Math.min(max, pct);
    }
  }

  const last = sorted[sorted.length - 1];
  const tailSpan = 45;
  const t = Math.min(1, (elapsedSec - last.atSec) / tailSpan);
  return Math.min(max, last.pct + (max - last.pct) * easeOutCubic(t) * 0.35);
}

export function useAnalysisProgressTimer(active: boolean) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedSec(0);
      return;
    }
    const tick = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(tick);
  }, [active]);

  return elapsedSec;
}

const FULL_REPORT_PHASES: PhaseTarget[] = [
  { atSec: 0, pct: 4 },
  { atSec: 12, pct: 18 },
  { atSec: 45, pct: 32 },
  { atSec: 90, pct: 48 },
  { atSec: 140, pct: 65 },
  { atSec: 200, pct: 78 },
  { atSec: 260, pct: 88 },
];

const FREE_ANALYZE_PHASES: PhaseTarget[] = [
  { atSec: 0, pct: 8 },
  { atSec: 4, pct: 28 },
  { atSec: 10, pct: 52 },
  { atSec: 18, pct: 72 },
  { atSec: 28, pct: 85 },
];

const FULL_STAGE_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    market: 'Gathering competition and foot-traffic signals',
    research: 'Deepening the market analysis',
    finance: 'Modeling costs and revenue scenarios',
    llm: 'Drafting your full site report',
    verify: 'Reviewing the key conclusions',
    finalize: 'Assembling the final report',
  },
  zh: {
    market: '采集周边竞争与客流数据',
    research: '深化区域市场研究',
    finance: '核算成本与营收情景',
    llm: '撰写完整选址报告',
    verify: '复核关键决策结论',
    finalize: '汇总报告内容',
  },
  es: {
    market: 'Recopilando señales de competencia y tráfico peatonal',
    research: 'Profundizando el análisis de mercado',
    finance: 'Modelando costos y escenarios de ingresos',
    llm: 'Redactando tu informe completo de ubicación',
    verify: 'Revisando las conclusiones clave',
    finalize: 'Armando el informe final',
  },
};

const FREE_STAGE_LABELS: Record<Locale, Record<string, string>> = {
  en: { scan: 'Scanning market data', compete: 'Analyzing the competition', risk: 'Detecting hidden risks' },
  zh: { scan: '扫描市场与商圈数据', compete: '分析竞争格局', risk: '识别隐藏风险与评分' },
  es: { scan: 'Escaneando datos de mercado', compete: 'Analizando la competencia', risk: 'Detectando riesgos ocultos' },
};

const BAR_COPY: Record<Locale, { progress: string; elapsed: (sec: number) => string }> = {
  en: { progress: 'Analysis progress', elapsed: (s) => `${s}s elapsed` },
  zh: { progress: '分析进度', elapsed: (s) => `已用时 ${s} 秒` },
  es: { progress: 'Progreso del análisis', elapsed: (s) => `${s} s transcurridos` },
};

export function getFullReportStages(lang: Locale): AnalysisProgressStage[] {
  const l = FULL_STAGE_LABELS[lang];
  return ['market', 'research', 'finance', 'llm', 'verify', 'finalize'].map((id) => ({ id, label: l[id] }));
}

export function getFreeAnalyzeStages(lang: Locale): AnalysisProgressStage[] {
  const l = FREE_STAGE_LABELS[lang];
  return ['scan', 'compete', 'risk'].map((id) => ({ id, label: l[id] }));
}

function stageActiveIndex(percent: number, stageCount: number): number {
  if (stageCount <= 1) return percent >= 100 ? 0 : -1;
  const slice = 100 / stageCount;
  const idx = Math.floor(percent / slice);
  if (percent >= 100) return stageCount - 1;
  return Math.min(stageCount - 1, Math.max(0, idx));
}

type BarProps = {
  stages: AnalysisProgressStage[];
  percent: number;
  elapsedSec?: number;
  lang: Locale;
  title?: string;
  subtitle?: string;
  /** Server-reported checklist row; overrides the percent-derived guess. */
  activeIndex?: number;
  /** Replaces the plain elapsed label under the bar (e.g. live "what we are doing" ticker + ETA). */
  statusLine?: ReactNode;
};

export function IqAnalysisProgressBar({
  stages,
  percent,
  elapsedSec,
  lang,
  title,
  subtitle,
  activeIndex,
  statusLine,
}: BarProps) {
  const pct = Math.round(Math.min(100, Math.max(0, percent)));
  const activeIdx =
    typeof activeIndex === 'number' && pct < 100
      ? Math.min(stages.length - 1, Math.max(0, activeIndex))
      : stageActiveIndex(pct, stages.length);

  const elapsedLabel = useMemo(() => {
    if (elapsedSec == null) return null;
    return BAR_COPY[lang].elapsed(elapsedSec);
  }, [elapsedSec, lang]);

  return (
    <div className="w-full text-left">
      {title ? <h2 className="text-center text-xl font-semibold text-zinc-100">{title}</h2> : null}
      {subtitle ? (
        <p className="mt-2 text-center text-sm leading-relaxed text-zinc-400">{subtitle}</p>
      ) : null}

      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
          <span>{BAR_COPY[lang].progress}</span>
          <span className="tabular-nums font-medium text-emerald-400/90">{pct}%</span>
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-full bg-zinc-800/90 ring-1 ring-zinc-700/50"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-700 via-emerald-500 to-teal-400 transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        {statusLine ? <div className="mt-2.5">{statusLine}</div> : elapsedLabel ? <p className="mt-2 text-xs text-zinc-600">{elapsedLabel}</p> : null}
      </div>

      <ul className="mt-6 space-y-2.5">
        {stages.map((stage, i) => {
          const done = i < activeIdx || (i === activeIdx && pct >= 100);
          const current = i === activeIdx && pct < 100;
          return (
            <li
              key={stage.id}
              className={`flex items-start gap-2.5 text-sm transition-opacity duration-500 ${
                done || current ? 'opacity-100' : 'opacity-35'
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  done
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : current
                      ? 'animate-pulse bg-emerald-500/30 text-emerald-300'
                      : 'bg-zinc-800 text-zinc-600'
                }`}
                aria-hidden
              >
                {done ? '✓' : current ? '…' : i + 1}
              </span>
              <span className={current ? 'text-zinc-200' : 'text-zinc-400'}>{stage.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { FULL_REPORT_PHASES, FREE_ANALYZE_PHASES };
