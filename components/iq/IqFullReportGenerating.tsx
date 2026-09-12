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

type StatusView = {
  legacy?: boolean;
  status?: 'idle' | 'running' | 'done' | 'failed';
  stage?: string | null;
  progress?: number;
  activeIndex?: number;
  error?: string | null;
  hasReport?: boolean;
  notifyEmail?: string | null;
  notified?: boolean;
  emailEnabled?: boolean;
};

const POLL_MS = 3_000;

function t(lang: 'en' | 'zh', zh: string, en: string): string {
  return lang === 'zh' ? zh : en;
}

function genericError(lang: 'en' | 'zh'): string {
  return t(
    lang,
    '完整报告生成失败，请点击「重试生成」或稍后刷新。',
    'Full report generation failed. Tap Retry or refresh later.',
  );
}

function timeoutError(lang: 'en' | 'zh'): string {
  return t(
    lang,
    '生成时间较长已超时，请点击下方「重试生成」再试一次。',
    'Generation timed out. Tap Retry below to try again.',
  );
}

/**
 * Kick off generation. Returns:
 * - 'queued'  → background job accepted; poll /status
 * - 'done'    → report JSON came back synchronously (legacy path); reload
 * - error text otherwise
 */
async function startGeneration(
  reportId: string,
  lang: 'en' | 'zh',
): Promise<{ kind: 'queued' } | { kind: 'done' } | { kind: 'error'; message: string }> {
  let res: Response;
  try {
    res = await fetch('/api/funnel/full-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No `force`: a failed job resumes from its last checkpoint instead of
      // restarting; the professional upgrade is a separate background pass.
      body: JSON.stringify({ reportId, quality: false }),
    });
  } catch {
    return { kind: 'error', message: genericError(lang) };
  }
  if (res.status === 202) return { kind: 'queued' };
  if (res.ok) return { kind: 'done' };

  const raw = await res.text();
  let msg = genericError(lang);
  try {
    const j = JSON.parse(raw) as { error?: string };
    if (j.error && !/openai|mimo|tavily|n8n|gpt-|anthropic|claude/i.test(j.error)) msg = j.error;
  } catch {
    if (res.status === 504) msg = timeoutError(lang);
  }
  if (lang === 'zh' && !/[一-鿿]/.test(msg)) msg = genericError(lang);
  return { kind: 'error', message: msg };
}

export function IqFullReportGenerating({ reportId, location, headline, lang }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [serverStatus, setServerStatus] = useState<StatusView | null>(null);
  const [serverProgress, setServerProgress] = useState(0);
  const [email, setEmail] = useState('');
  const [emailState, setEmailState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);

  const stages = useMemo(() => getFullReportStages(lang), [lang]);

  // Progress: the server's stage-based value when polling; the old time curve
  // on the legacy synchronous path (no status available there).
  const percent = useMemo(() => {
    if (done) return 100;
    const timeBased = progressFromElapsed(elapsedSec, FULL_REPORT_PHASES, { maxPctUntilDone: 92 });
    if (serverStatus && !serverStatus.legacy) return Math.min(98, Math.max(serverProgress, 2));
    return timeBased;
  }, [done, elapsedSec, serverStatus, serverProgress]);

  const finish = useCallback(async () => {
    setDone(true);
    await new Promise((r) => setTimeout(r, 450));
    window.location.reload();
  }, []);

  const poll = useCallback(async () => {
    while (!stoppedRef.current) {
      let s: StatusView | null = null;
      try {
        const res = await fetch(`/api/funnel/full-report/status?reportId=${encodeURIComponent(reportId)}`, {
          cache: 'no-store',
        });
        s = (await res.json()) as StatusView;
      } catch {
        /* transient — keep polling */
      }
      if (stoppedRef.current) return;
      if (s) {
        setServerStatus(s);
        if (typeof s.progress === 'number') setServerProgress((p) => Math.max(p, s!.progress!));
        if (s.hasReport || s.status === 'done') {
          await finish();
          return;
        }
        if (s.status === 'failed') {
          setError(
            s.error && /timeout|timed out/i.test(s.error) ? timeoutError(lang) : genericError(lang),
          );
          runningRef.current = false;
          return;
        }
        if (s.legacy) return; // synchronous path owns completion
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }, [reportId, lang, finish]);

  const runGeneration = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    stoppedRef.current = false;
    setError(null);
    setDone(false);
    setServerProgress(0);

    const result = await startGeneration(reportId, lang);
    if (stoppedRef.current) return;
    if (result.kind === 'done') {
      await finish();
      return;
    }
    if (result.kind === 'error') {
      runningRef.current = false;
      setError(result.message);
      return;
    }
    await poll();
  }, [reportId, lang, finish, poll]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (!runningRef.current && (error || done)) return;
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [error, done]);

  useEffect(() => {
    setElapsedSec(0);
    void runGeneration();
    return () => {
      stoppedRef.current = true;
      runningRef.current = false;
    };
  }, [reportId, lang, retryKey, runGeneration]);

  const submitEmail = useCallback(async () => {
    const addr = email.trim();
    if (!addr) return;
    setEmailState('saving');
    try {
      const res = await fetch('/api/funnel/full-report/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, email: addr }),
      });
      setEmailState(res.ok ? 'saved' : 'error');
    } catch {
      setEmailState('error');
    }
  }, [email, reportId]);

  const emailEnabled = Boolean(serverStatus?.emailEnabled) && !serverStatus?.legacy;
  const savedEmail =
    emailState === 'saved' ? email.trim() : serverStatus?.notifyEmail && !serverStatus.notified ? serverStatus.notifyEmail : null;

  const title = t(lang, '正在生成完整风险审计…', 'Generating your full risk audit…');
  const subtitle = emailEnabled
    ? t(
        lang,
        `${headline} · 通常需 2–5 分钟。不想等？留下邮箱，生成后自动发送。`,
        `${headline} · Usually 2–5 min. Don't want to wait? Leave an email and we'll send it.`,
      )
    : t(lang, `${headline} · 通常需 2–5 分钟，请勿关闭本页`, `${headline} · Usually 2–5 min — keep this tab open`);

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
          activeIndex={serverStatus && !serverStatus.legacy ? serverStatus.activeIndex : undefined}
        />

        {emailEnabled && !error ? (
          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            {savedEmail ? (
              <p className="text-sm text-emerald-400">
                {t(
                  lang,
                  `✓ 报告完成后会发送到 ${savedEmail}，您现在可以离开此页。`,
                  `✓ We'll email ${savedEmail} when the report is ready — you can leave this page.`,
                )}
              </p>
            ) : (
              <>
                <p className="text-sm text-zinc-300">
                  {t(lang, '不想等待？报告生成后发送到邮箱：', 'Rather not wait? Email me when it’s ready:')}
                </p>
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitEmail();
                  }}
                >
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t(lang, 'you@example.com', 'you@example.com')}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={emailState === 'saving'}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {emailState === 'saving'
                      ? t(lang, '保存中…', 'Saving…')
                      : t(lang, '发送到邮箱', 'Email me')}
                  </button>
                </form>
                {emailState === 'error' ? (
                  <p className="mt-2 text-xs text-rose-400">
                    {t(lang, '邮箱保存失败，请检查格式后重试。', 'Could not save that email — check the format and retry.')}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 space-y-3 text-center">
            <p className="text-sm text-rose-400">{error}</p>
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {t(lang, '重试生成', 'Retry generation')}
            </button>
            <p className="text-xs text-zinc-500">
              {t(lang, '重试会从上次中断的步骤继续，不会从头开始。', 'Retry resumes from the last completed step.')}
            </p>
          </div>
        ) : null}

        <div className="mt-8 text-center">
          <Link href="/iq" className="text-sm text-emerald-500/90 hover:text-emerald-400 hover:underline">
            {t(lang, '← 返回分析页', '← Back to analyzer')}
          </Link>
        </div>
      </div>
    </main>
  );
}
