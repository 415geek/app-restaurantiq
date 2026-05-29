'use client';

import { useEffect, useMemo, useState } from 'react';

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

export function getFullReportStages(lang: 'en' | 'zh'): AnalysisProgressStage[] {
  if (lang === 'zh') {
    return [
      { id: 'market', label: '拉取竞品、地图与人口数据' },
      { id: 'research', label: '深度市场研究（Tavily / ACS）' },
      { id: 'finance', label: '计算盈亏与安全营收模型' },
      { id: 'llm', label: 'MiMo / OpenAI 撰写完整报告' },
      { id: 'verify', label: '双模型交叉校验决策结论' },
      { id: 'finalize', label: '整理报告与竞品白名单' },
    ];
  }
  return [
    { id: 'market', label: 'Fetching competitors, maps & demographics' },
    { id: 'research', label: 'Deep market research (Tavily / ACS)' },
    { id: 'finance', label: 'Computing break-even & safe revenue' },
    { id: 'llm', label: 'Drafting full report (MiMo / OpenAI)' },
    { id: 'verify', label: 'Dual-model verification of verdict' },
    { id: 'finalize', label: 'Finalizing report & competitor grounding' },
  ];
}

export function getFreeAnalyzeStages(lang: 'en' | 'zh'): AnalysisProgressStage[] {
  if (lang === 'zh') {
    return [
      { id: 'scan', label: '扫描市场与商圈数据' },
      { id: 'compete', label: '分析竞争格局' },
      { id: 'risk', label: '识别隐藏风险与评分' },
    ];
  }
  return [
    { id: 'scan', label: 'Scanning market data' },
    { id: 'compete', label: 'Analyzing competition' },
    { id: 'risk', label: 'Detecting hidden risks' },
  ];
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
  lang: 'en' | 'zh';
  title?: string;
  subtitle?: string;
};

export function IqAnalysisProgressBar({
  stages,
  percent,
  elapsedSec,
  lang,
  title,
  subtitle,
}: BarProps) {
  const pct = Math.round(Math.min(100, Math.max(0, percent)));
  const activeIdx = stageActiveIndex(pct, stages.length);

  const elapsedLabel = useMemo(() => {
    if (elapsedSec == null) return null;
    return lang === 'zh' ? `已用时 ${elapsedSec} 秒` : `${elapsedSec}s elapsed`;
  }, [elapsedSec, lang]);

  return (
    <div className="w-full text-left">
      {title ? <h2 className="text-center text-xl font-semibold text-zinc-100">{title}</h2> : null}
      {subtitle ? (
        <p className="mt-2 text-center text-sm leading-relaxed text-zinc-400">{subtitle}</p>
      ) : null}

      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
          <span>{lang === 'zh' ? '分析进度' : 'Analysis progress'}</span>
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
        {elapsedLabel ? <p className="mt-2 text-xs text-zinc-600">{elapsedLabel}</p> : null}
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
