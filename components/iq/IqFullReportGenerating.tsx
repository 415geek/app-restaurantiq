'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  FULL_REPORT_PHASES,
  getFullReportStages,
  IqAnalysisProgressBar,
  progressFromElapsed,
} from '@/components/iq/IqAnalysisProgress';

type Props = {
  reportId: string;
  location: string;
  headline: string;
  lang: 'en' | 'zh';
};

async function requestFullReport(
  reportId: string,
  force: boolean,
  lang: 'en' | 'zh',
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch('/api/funnel/full-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, force }),
  });
  if (res.ok) return { ok: true };

  const raw = await res.text();
  let msg =
    lang === 'zh'
      ? '完整报告生成失败，请点击「重试生成」或稍后刷新。'
      : 'Full report generation failed. Tap Retry or refresh later.';
  try {
    const j = JSON.parse(raw) as { error?: string };
    if (j.error && !/openai|mimo|tavily|n8n|gpt-/i.test(j.error)) {
      msg = j.error;
    }
  } catch {
    if (res.status === 504) {
      msg =
        lang === 'zh'
          ? '生成时间较长已超时，请点击下方「重试生成」再试一次。'
          : 'Generation timed out. Tap Retry below to try again.';
    }
  }
  return { ok: false, message: msg };
}

export function IqFullReportGenerating({ reportId, location, headline, lang }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const runningRef = useRef(false);

  const percent = useMemo(
    () => progressFromElapsed(elapsedSec, FULL_REPORT_PHASES, { done, maxPctUntilDone: 92 }),
    [elapsedSec, done],
  );

  const stages = useMemo(() => getFullReportStages(lang), [lang]);

  const runGeneration = useCallback(
    async (force: boolean) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setError(null);
      setDone(false);

      const result = await requestFullReport(reportId, force, lang);
      runningRef.current = false;

      if (result.ok) {
        setDone(true);
        await new Promise((r) => setTimeout(r, 450));
        window.location.reload();
        return;
      }

      setError(
        lang === 'zh' && !/[\u4e00-\u9fff]/.test(result.message)
          ? '完整报告生成失败，请点击「重试生成」或稍后刷新。'
          : result.message,
      );
    },
    [reportId, lang],
  );

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (!runningRef.current && (error || done)) return;
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [error, done]);

  useEffect(() => {
    setElapsedSec(0);
    void runGeneration(retryKey > 0);
  }, [reportId, lang, retryKey, runGeneration]);

  const title =
    lang === 'zh' ? '正在生成完整风险审计…' : 'Generating your full risk audit…';
  const subtitle =
    lang === 'zh'
      ? `${headline} · 通常需 1–5 分钟，请勿关闭本页`
      : `${headline} · Usually 1–5 min — keep this tab open`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8">
        <p className="text-center text-xs text-zinc-500">{location}</p>
        <IqAnalysisProgressBar
          lang={lang}
          title={title}
          subtitle={subtitle}
          stages={stages}
          percent={percent}
          elapsedSec={elapsedSec}
        />
        {error ? (
          <div className="mt-6 space-y-3 text-center">
            <p className="text-sm text-rose-400">{error}</p>
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {lang === 'zh' ? '重试生成' : 'Retry generation'}
            </button>
          </div>
        ) : null}
        <div className="mt-8 text-center">
          <Link
            href="/iq"
            className="text-sm text-emerald-500/90 hover:text-emerald-400 hover:underline"
          >
            {lang === 'zh' ? '← 返回分析页' : '← Back to analyzer'}
          </Link>
        </div>
      </div>
    </main>
  );
}
