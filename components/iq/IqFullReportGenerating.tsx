'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FULL_REPORT_PHASES,
  getFullReportStages,
  IqAnalysisProgressBar,
  progressFromElapsed,
  useAnalysisProgressTimer,
} from '@/components/iq/IqAnalysisProgress';

type Props = {
  reportId: string;
  location: string;
  headline: string;
  lang: 'en' | 'zh';
};

export function IqFullReportGenerating({ reportId, location, headline, lang }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const elapsedSec = useAnalysisProgressTimer(!error && !done);

  const percent = useMemo(
    () => progressFromElapsed(elapsedSec, FULL_REPORT_PHASES, { done, maxPctUntilDone: 92 }),
    [elapsedSec, done],
  );

  const stages = useMemo(() => getFullReportStages(lang), [lang]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch('/api/funnel/full-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId, force: false }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const raw = await res.text();
          let msg =
            lang === 'zh'
              ? '完整报告生成失败，请稍后刷新重试。'
              : 'Full report generation failed. Please refresh and try again.';
          try {
            const j = JSON.parse(raw) as { error?: string };
            if (j.error && !/openai|mimo|tavily|n8n|gpt-/i.test(j.error)) {
              msg = j.error;
            }
          } catch {
            /* ignore */
          }
          setError(msg);
          return;
        }
        setDone(true);
        await new Promise((r) => setTimeout(r, 450));
        window.location.reload();
      } catch {
        if (!cancelled) {
          setError(
            lang === 'zh'
              ? '网络异常，请检查连接后刷新页面。'
              : 'Network error. Check your connection and refresh.',
          );
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [reportId, lang]);

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
          <p className="mt-6 text-center text-sm text-rose-400">{error}</p>
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
