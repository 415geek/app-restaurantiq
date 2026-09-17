'use client';

/**
 * Wait screen for the paid report (评审 Spec §4.6).
 *
 *  - The five checklist rows and the percentage come from the status endpoint
 *    (`stages` / `progress`): a row is ticked only when that work actually
 *    finished; nothing is time-eased. A row that has been current past the
 *    stall threshold says it is being retried (§4.7).
 *  - A tier-specific ETA ("About 4 minutes" standard, "About 12 minutes" for the
 *    360° pass — the P50 of recent runs once there is enough history, §4.7
 *    分档 ETA) + a live elapsed clock.
 *  - The "email me when it's done" form is always offered; past 5 minutes the
 *    copy switches to an active prompt. The address is stored whether or not
 *    sending is configured, and the copy says whether a mail will go out.
 *  - After 10 minutes a support link is added. (A stored standard-tier body
 *    reloads into the report page as soon as it exists — the in-depth edition
 *    then replaces it automatically, see ReportContent.)
 */
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
import type { UiStage } from '@/lib/funnel/iq-generation-stages';
import { ETA_DEFAULT_MINUTES, etaSubtitle, monotonicRemainingSec } from '@/lib/funnel/iq-eta';
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
  stages?: UiStage[];
  standardReady?: boolean;
  startedAt?: string | null;
  error?: string | null;
  hasReport?: boolean;
  notifyEmail?: string | null;
  notified?: boolean;
  emailEnabled?: boolean;
  emailWillSend?: boolean;
  etaSeconds?: number;
};

const POLL_MS = 3_000;
/** Past this wait the email prompt stops being an aside and asks for the address (§4.7 P1-f). */
const EMAIL_AFTER_SEC = 5 * 60;
/** Add the support handoff after this long (§4.6 c). */
const SUPPORT_AFTER_SEC = 10 * 60;

const COPY: Record<
  Locale,
  {
    genericError: string;
    timeoutError: string;
    title: string;
    elapsed: (mmss: string) => string;
    willEmail: (email: string) => string;
    savedNoSend: (email: string) => string;
    emailPrompt: string;
    emailPromptLate: string;
    emailPlaceholder: string;
    saving: string;
    emailMe: string;
    emailError: string;
    lateNote: string;
    support: string;
    supportFallback: string;
    retry: string;
    retryNote: string;
    back: string;
  }
> = {
  en: {
    genericError: 'Full report generation failed. Tap Retry or refresh later.',
    timeoutError: 'Generation timed out. Tap Retry below to try again.',
    title: 'Generating your full risk audit…',
    elapsed: (m) => `${m} elapsed`,
    willEmail: (e) => `✓ We’ll email ${e} when the report is ready — you can leave this page.`,
    savedNoSend: (e) => `✓ ${e} is saved with this report. Email sending is not switched on yet, so the link will go out once it is — keep this page or come back to it later.`,
    emailPrompt: 'Rather not wait? Email me when it’s ready:',
    emailPromptLate: 'Leave your email and we’ll send the PDF when it’s ready — you don’t have to wait on this page:',
    emailPlaceholder: 'you@example.com',
    saving: 'Saving…',
    emailMe: 'Email me',
    emailError: 'Could not save that email — check the format and try again.',
    lateNote: 'Over 10 minutes — the job is still running and will resume on its own if a step fails. If you would rather talk to a person:',
    support: 'Contact support',
    supportFallback: 'use the support bubble at the bottom right.',
    retry: 'Retry generation',
    retryNote: 'Retry resumes from the last completed step.',
    back: '← Back to the analyzer',
  },
  zh: {
    genericError: '完整报告生成失败，请点击「重试生成」或稍后刷新。',
    timeoutError: '生成时间较长已超时，请点击下方「重试生成」再试一次。',
    title: '正在生成完整风险审计…',
    elapsed: (m) => `已用时 ${m}`,
    willEmail: (e) => `✓ 报告完成后会发送到 ${e}，您现在可以离开此页。`,
    savedNoSend: (e) => `✓ ${e} 已保存到这份报告。邮件发送功能尚未开通，开通后会自动发出链接——请保留本页或稍后回来查看。`,
    emailPrompt: '不想等待？报告生成后发送到邮箱：',
    emailPromptLate: '留个邮箱，完成后把 PDF 发给你——不用守在这个页面：',
    emailPlaceholder: 'you@example.com',
    saving: '保存中…',
    emailMe: '发送到邮箱',
    emailError: '邮箱保存失败，请检查格式后重试。',
    lateNote: '已超过 10 分钟——任务仍在后台运行，某一步失败会自动续跑。如果想直接找人：',
    support: '联系客服',
    supportFallback: '点击右下角的在线客服。',
    retry: '重试生成',
    retryNote: '重试会从上次中断的步骤继续，不会从头开始。',
    back: '← 返回分析页',
  },
  es: {
    genericError: 'No se pudo generar el informe completo. Toca Reintentar o actualiza la página más tarde.',
    timeoutError: 'La generación tardó demasiado. Toca Reintentar abajo para volver a intentarlo.',
    title: 'Generando tu auditoría de riesgo completa…',
    elapsed: (m) => `${m} transcurridos`,
    willEmail: (e) => `✓ Enviaremos el informe a ${e} cuando esté listo; puedes salir de esta página.`,
    savedNoSend: (e) => `✓ ${e} quedó guardado con este informe. El envío de correos aún no está activado; el enlace saldrá cuando lo esté. Conserva esta página o vuelve más tarde.`,
    emailPrompt: '¿Prefieres no esperar? Te avisamos por correo cuando esté listo:',
    emailPromptLate: 'Déjanos tu correo y te enviamos el PDF cuando esté listo; no hace falta que esperes en esta página:',
    emailPlaceholder: 'tu@correo.com',
    saving: 'Guardando…',
    emailMe: 'Enviarme por correo',
    emailError: 'No se pudo guardar ese correo. Revisa el formato e inténtalo de nuevo.',
    lateNote: 'Más de 10 minutos: el proceso sigue en marcha y se reanuda solo si un paso falla. Si prefieres hablar con una persona:',
    support: 'Contactar soporte',
    supportFallback: 'usa la burbuja de soporte abajo a la derecha.',
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
      // restarting; the professional upgrade is scheduled by the server.
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
    if (j.error && !/openai|mimo|tavily|n8n|gpt-|anthropic|claude|gemini|deepseek/i.test(j.error)) msg = j.error;
  } catch {
    if (res.status === 504) msg = t.timeoutError;
  }
  // Never show an English server message on a Chinese screen.
  if (lang === 'zh' && !/[一-鿿]/.test(msg)) msg = t.genericError;
  return { kind: 'error', message: msg };
}

/** Remembered start of the current generation run (ms epoch), per report; stale after 30 min. */
const START_TTL_MS = 30 * 60 * 1000;
function generationStart(reportId: string, reset: boolean): number {
  const key = `iq:gen_start:${reportId}`;
  const now = Date.now();
  try {
    if (!reset) {
      const raw = window.localStorage.getItem(key);
      const ts = raw ? Number(raw) : NaN;
      if (Number.isFinite(ts) && ts <= now && now - ts < START_TTL_MS) return ts;
    }
    window.localStorage.setItem(key, String(now));
  } catch {
    /* storage unavailable — fall back to an in-memory clock */
  }
  return now;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function SupportLink({ lang, reportId, location }: { lang: Locale; reportId: string; location: string }) {
  const t = COPY[lang];
  const [cfg, setCfg] = useState<{ whatsapp: string | null; email: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/iq/support/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setCfg(j as { whatsapp: string | null; email: string | null });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const text = encodeURIComponent(`Report ${reportId} · ${location} · still generating after 10 min`);
  const href = cfg?.whatsapp ? `https://wa.me/${cfg.whatsapp}?text=${text}` : cfg?.email ? `mailto:${cfg.email}?subject=${text}` : null;
  return (
    <p className="text-xs text-zinc-400" data-testid="late-support">
      {t.lateNote}{' '}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-emerald-400 underline underline-offset-4">
          {t.support}
        </a>
      ) : (
        <span>{t.supportFallback}</span>
      )}
    </p>
  );
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
  const [emailWillSend, setEmailWillSend] = useState<boolean | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);

  // §4.7 分档 ETA: the server's tier figure once the first poll lands; the
  // standard-tier default until then (every run starts on the standard pass).
  const etaSeconds =
    typeof serverStatus?.etaSeconds === 'number' && serverStatus.etaSeconds > 0
      ? serverStatus.etaSeconds
      : ETA_DEFAULT_MINUTES.standard * 60;

  const live = Boolean(serverStatus && !serverStatus.legacy);
  const stages = useMemo(() => getFullReportStages(lang, live ? serverStatus?.stages : null), [lang, live, serverStatus?.stages]);
  const activeIndex = live && typeof serverStatus?.activeIndex === 'number' ? serverStatus.activeIndex : null;

  // Progress: the server's stage-based value when polling; the old time curve
  // only on the legacy synchronous path (no status available there).
  const percent = useMemo(() => {
    if (done) return 100;
    if (live) return Math.min(98, Math.max(serverProgress, 2));
    return progressFromElapsed(elapsedSec, FULL_REPORT_PHASES, { maxPctUntilDone: 92 });
  }, [done, elapsedSec, live, serverProgress]);

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
    setRemainingSec(null); // a retry restarts the clock, so it restarts the countdown's ceiling too

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

  // Elapsed time is measured from a start timestamp remembered per report, so a
  // refresh, a language switch or a re-run of this effect continues the same
  // clock instead of restarting it. Only an explicit retry starts a new clock.
  const startRef = useRef<number>(0);
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (!startRef.current || (!runningRef.current && (error || done))) return;
      const sec = Math.max(0, Math.floor((Date.now() - startRef.current) / 1000));
      setElapsedSec(sec);
      // §4.7 monotonic countdown: the last value shown is the ceiling for the
      // next one, so a longer tier ETA arriving mid-run can only pull the
      // remaining time down — it can never climb back up.
      setRemainingSec((prev) => monotonicRemainingSec({ totalSec: etaSeconds, elapsedSec: sec, previous: prev }));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [error, done, etaSeconds]);

  // The server's own start time wins when it is earlier (another tab / a reload after the local clock expired).
  useEffect(() => {
    const started = serverStatus?.startedAt ? Date.parse(serverStatus.startedAt) : NaN;
    if (Number.isFinite(started) && started < startRef.current && Date.now() - started < 4 * 60 * 60_000) {
      startRef.current = started;
    }
  }, [serverStatus?.startedAt]);

  useEffect(() => {
    rememberPaidReport(reportId, location);
  }, [reportId, location]);

  useEffect(() => {
    startRef.current = generationStart(reportId, retryKey > 0);
    setElapsedSec(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000))); // eslint-disable-line react-hooks/set-state-in-effect
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
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; willSend?: boolean };
      if (res.ok && j.ok) {
        setEmailWillSend(j.willSend !== false);
        setEmailState('saved');
      } else {
        setEmailState('error');
      }
    } catch {
      setEmailState('error');
    }
  }, [email, reportId]);

  const emailEnabled = Boolean(serverStatus?.emailEnabled) && !serverStatus?.legacy;
  const late = elapsedSec >= EMAIL_AFTER_SEC;
  const veryLate = elapsedSec >= SUPPORT_AFTER_SEC;
  const showEmailForm = !error && (emailEnabled || late);
  const savedEmail =
    emailState === 'saved' ? email.trim() : serverStatus?.notifyEmail && !serverStatus.notified ? serverStatus.notifyEmail : null;
  const savedWillSend = emailState === 'saved' ? emailWillSend !== false : Boolean(serverStatus?.emailWillSend);

  const subtitle = `${headline} · ${etaSubtitle(lang, etaSeconds / 60)} · ${t.elapsed(mmss(elapsedSec))}`;

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
          activeIndex={activeIndex ?? undefined}
          statusLine={
            !error && !done ? (
              <GenerationTicker
                lang={lang}
                location={location}
                elapsedSec={elapsedSec}
                percent={percent}
                stageIndex={activeIndex}
                etaSeconds={etaSeconds}
                remainingSec={remainingSec}
              />
            ) : undefined
          }
        />

        {showEmailForm ? (
          <div
            // §4.7: past five minutes the capture stops being an aside and asks.
            className={`mt-6 rounded-xl border p-4 ${late && !savedEmail ? 'border-emerald-700/70 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-950/60'}`}
            data-testid="notify-form"
            data-prompt={late ? 'active' : 'passive'}
          >
            {savedEmail ? (
              <p className={`text-sm ${savedWillSend ? 'text-emerald-400' : 'text-amber-300'}`}>
                {savedWillSend ? t.willEmail(savedEmail) : t.savedNoSend(savedEmail)}
              </p>
            ) : (
              <>
                <p className="text-sm text-zinc-300">{late ? t.emailPromptLate : t.emailPrompt}</p>
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
            {veryLate ? (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <SupportLink lang={lang} reportId={reportId} location={location} />
              </div>
            ) : null}
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
