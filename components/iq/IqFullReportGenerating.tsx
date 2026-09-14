'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rememberPaidReport } from '@/components/iq/SupportBubble';
import { GenerationTicker } from '@/components/iq/GenerationTicker';
import Link from 'next/link';
import {
  FULL_REPORT_PHASES,
  getFullReportStages,
  IqAnalysisProgressBar,
  progressFromElapsed,
} from '@/components/iq/IqAnalysisProgress';
import type { Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';

type Props = {
  reportId: string;
  location: string;
  headline: string;
  lang: Locale;
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

const COPY: Record<
  Locale,
  {
    genericError: string;
    timeoutError: string;
    title: string;
    subtitleEmail: (headline: string) => string;
    subtitleWait: (headline: string) => string;
    willEmail: (email: string) => string;
    emailPrompt: string;
    emailPlaceholder: string;
    saving: string;
    emailMe: string;
    emailError: string;
    retry: string;
    retryNote: string;
    back: string;
  }
> = {
  en: {
    genericError: 'Full report generation failed. Tap Retry or refresh later.',
    timeoutError: 'Generation timed out. Tap Retry below to try again.',
    title: 'Generating your full risk audit…',
    subtitleEmail: (h) => `${h} · Usually 2–5 min. Don’t want to wait? Leave an email and we’ll send it over.`,
    subtitleWait: (h) => `${h} · Usually 2–5 min — keep this tab open`,
    willEmail: (e) => `✓ We’ll email ${e} when the report is ready — you can leave this page.`,
    emailPrompt: 'Rather not wait? Email me when it’s ready:',
    emailPlaceholder: 'you@example.com',
    saving: 'Saving…',
    emailMe: 'Email me',
    emailError: 'Could not save that email — check the format and try again.',
    retry: 'Retry generation',
    retryNote: 'Retry resumes from the last completed step.',
    back: '← Back to the analyzer',
  },
  zh: {
    genericError: '完整报告生成失败，请点击「重试生成」或稍后刷新。',
    timeoutError: '生成时间较长已超时，请点击下方「重试生成」再试一次。',
    title: '正在生成完整风险审计…',
    subtitleEmail: (h) => `${h} · 通常需 2–5 分钟。不想等？留下邮箱，生成后自动发送。`,
    subtitleWait: (h) => `${h} · 通常需 2–5 分钟，请勿关闭本页`,
    willEmail: (e) => `✓ 报告完成后会发送到 ${e}，您现在可以离开此页。`,
    emailPrompt: '不想等待？报告生成后发送到邮箱：',
    emailPlaceholder: 'you@example.com',
    saving: '保存中…',
    emailMe: '发送到邮箱',
    emailError: '邮箱保存失败，请检查格式后重试。',
    retry: '重试生成',
    retryNote: '重试会从上次中断的步骤继续，不会从头开始。',
    back: '← 返回分析页',
  },
  es: {
    genericError: 'No se pudo generar el informe completo. Toca Reintentar o actualiza la página más tarde.',
    timeoutError: 'La generación tardó demasiado. Toca Reintentar abajo para volver a intentarlo.',
    title: 'Generando tu auditoría de riesgo completa…',
    subtitleEmail: (h) => `${h} · Normalmente tarda de 2 a 5 min. ¿No quieres esperar? Déjanos tu correo y te lo enviamos.`,
    subtitleWait: (h) => `${h} · Normalmente tarda de 2 a 5 min; mantén esta pestaña abierta`,
    willEmail: (e) => `✓ Enviaremos el informe a ${e} cuando esté listo; puedes salir de esta página.`,
    emailPrompt: '¿Prefieres no esperar? Te avisamos por correo cuando esté listo:',
    emailPlaceholder: 'tu@correo.com',
    saving: 'Guardando…',
    emailMe: 'Enviarme por correo',
    emailError: 'No se pudo guardar ese correo. Revisa el formato e inténtalo de nuevo.',
    retry: 'Reintentar generación',
    retryNote: 'Al reintentar se retoma desde el último paso completado.',
    back: '← Volver al analizador',
  },
};

/**
 * Kick off generation. Returns:
 * - 'queued'  → background job accepted; poll /status
 * - 'done'    → report JSON came back synchronously (legacy path); reload
 * - error text otherwise
 */
async function startGeneration(
  reportId: string,
  lang: Locale,
): Promise<{ kind: 'queued' } | { kind: 'done' } | { kind: 'error'; message: string }> {
  const t = COPY[lang];
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
    return { kind: 'error', message: t.genericError };
  }
  if (res.status === 202) return { kind: 'queued' };
  if (res.ok) return { kind: 'done' };

  const raw = await res.text();
  let msg = t.genericError;
  try {
    const j = JSON.parse(raw) as { error?: string };
    if (j.error && !/openai|mimo|tavily|n8n|gpt-|anthropic|claude/i.test(j.error)) msg = j.error;
  } catch {
    if (res.status === 504) msg = t.timeoutError;
  }
  // Never show an English server message on a Chinese screen.
  if (lang === 'zh' && !/[一-鿿]/.test(msg)) msg = t.genericError;
  return { kind: 'error', message: msg };
}

export function IqFullReportGenerating({ reportId, location, headline, lang }: Props) {
  const t = COPY[lang];
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
          setError(s.error && /timeout|timed out/i.test(s.error) ? t.timeoutError : t.genericError);
          runningRef.current = false;
          return;
        }
        if (s.legacy) return; // synchronous path owns completion
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }, [reportId, t.timeoutError, t.genericError, finish]);

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
    rememberPaidReport(reportId, location);
  }, [reportId, location]);

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

  const subtitle = emailEnabled ? t.subtitleEmail(headline) : t.subtitleWait(headline);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8">
        <p className="text-center text-xs text-zinc-500">{location}</p>
        <IqAnalysisProgressBar
          lang={lang}
          title={t.title}
          subtitle={subtitle}
          stages={stages}
          percent={percent}
          elapsedSec={elapsedSec}
          activeIndex={serverStatus && !serverStatus.legacy ? serverStatus.activeIndex : undefined}
          statusLine={!error && !done ? <GenerationTicker lang={lang} location={location} elapsedSec={elapsedSec} percent={percent} /> : undefined}
        />

        {emailEnabled && !error ? (
          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            {savedEmail ? (
              <p className="text-sm text-emerald-400">{t.willEmail(savedEmail)}</p>
            ) : (
              <>
                <p className="text-sm text-zinc-300">{t.emailPrompt}</p>
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
                    placeholder={t.emailPlaceholder}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={emailState === 'saving'}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {emailState === 'saving' ? t.saving : t.emailMe}
                  </button>
                </form>
                {emailState === 'error' ? <p className="mt-2 text-xs text-rose-400">{t.emailError}</p> : null}
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
              {t.retry}
            </button>
            <p className="text-xs text-zinc-500">{t.retryNote}</p>
          </div>
        ) : null}

        <div className="mt-8 text-center">
          <Link href={withLang('/iq', lang)} className="text-sm text-emerald-500/90 hover:text-emerald-400 hover:underline">
            {t.back}
          </Link>
        </div>
      </div>
    </main>
  );
}
