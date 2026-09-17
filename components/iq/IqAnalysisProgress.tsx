'use client';

import type { ReactNode } from 'react';

import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';
import { UI_STAGE_IDS, type UiStage, type UiStageId } from '@/lib/funnel/iq-generation-stages';

export type AnalysisProgressStage = {
  id: string;
  label: string;
  /** Live state from the server (评审 Spec §4.6); when present it wins over the percent-derived guess. */
  state?: 'done' | 'active' | 'pending';
  /** §4.7: current past the stall threshold — the row says it is being retried instead of spinning. */
  stalled?: boolean;
};

type PhaseTarget = { atSec: number; pct: number };

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Map elapsed seconds to a smooth 0–maxPct curve using phase keyframes (legacy synchronous path only). */
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

/** The five real stages of the paid job (order = execution order: competitors are pulled before Census). */
const FULL_STAGE_LABELS: Record<Locale, Record<UiStageId, string>> = {
  en: {
    competitors: 'Pulling nearby competitors (Google Places · Yelp)',
    demographics: 'Pulling population and income (U.S. Census ACS)',
    finance: 'Computing the break-even model',
    write: 'Writing and reviewing the report',
    layout: 'Laying out the pages',
  },
  zh: {
    competitors: '竞品检索（Google Places · Yelp）',
    demographics: '拉取人口与收入（美国人口普查 ACS）',
    finance: '财务模型（保本线）',
    write: '撰写并复核报告',
    layout: '排版',
  },
  es: {
    competitors: 'Buscando competidores cercanos (Google Places · Yelp)',
    demographics: 'Obteniendo población e ingresos (Censo de EE. UU., ACS)',
    finance: 'Calculando el modelo de punto de equilibrio',
    write: 'Redactando y revisando el informe',
    layout: 'Maquetando las páginas',
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

/** §4.7 stage-stall: what a row says once it has been current for more than five minutes. */
export const STAGE_RETRY_COPY: Record<Locale, string> = {
  en: 'This step stalled — retrying it automatically',
  zh: '这一步超时，正在自动重试',
  es: 'Este paso se atascó; lo estamos reintentando automáticamente',
};

/**
 * Five-row checklist for the paid report. With the server's live `stages`
 * the rows carry their real state; without it (legacy synchronous path) they
 * are the static list and the bar derives the active row from the percent.
 */
export function getFullReportStages(lang: Locale, serverStages?: UiStage[] | null): AnalysisProgressStage[] {
  const l = FULL_STAGE_LABELS[lang];
  if (serverStages && serverStages.length > 0) {
    return serverStages.map((s) => ({
      id: s.id,
      label: l[(s.label_key as UiStageId) in l ? (s.label_key as UiStageId) : s.id] ?? s.id,
      state: s.state,
      stalled: s.stalled,
    }));
  }
  return UI_STAGE_IDS.map((id) => ({ id, label: l[id] }));
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
  /** Server-reported checklist row; overrides the percent-derived guess (ignored when rows carry `state`). */
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
  const hasLiveStates = stages.some((s) => s.state);
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

      <ul className="mt-6 space-y-2.5" data-testid="stage-list">
        {stages.map((stage, i) => {
          const done = hasLiveStates
            ? stage.state === 'done' || pct >= 100
            : i < activeIdx || (i === activeIdx && pct >= 100);
          const current = hasLiveStates ? stage.state === 'active' && pct < 100 : i === activeIdx && pct < 100;
          const stalled = Boolean(stage.stalled) && current;
          return (
            <li
              key={stage.id}
              data-stage={stage.id}
              data-state={done ? 'done' : current ? 'active' : 'pending'}
              data-stalled={stalled ? 'true' : undefined}
              className={`flex items-start gap-2.5 text-sm transition-opacity duration-500 ${
                done || current ? 'opacity-100' : 'opacity-35'
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  done
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : stalled
                      ? 'animate-pulse bg-amber-500/25 text-amber-300'
                      : current
                        ? 'animate-pulse bg-emerald-500/30 text-emerald-300'
                        : 'bg-zinc-800 text-zinc-600'
                }`}
                aria-hidden
              >
                {done ? '✓' : stalled ? '↻' : current ? '…' : i + 1}
              </span>
              <span className={current ? 'text-zinc-200' : 'text-zinc-400'}>
                {stage.label}
                {stalled ? (
                  <span className="mt-0.5 block text-xs text-amber-300" data-testid="stage-retrying">
                    {STAGE_RETRY_COPY[lang]}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { FULL_REPORT_PHASES, FREE_ANALYZE_PHASES };
