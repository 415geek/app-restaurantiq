'use client';

/**
 * "Save this report" card under a paid report.
 *
 * After Google OAuth the Clerk session exists but `iq_location_reports.user_id`
 * is still null (only /iq/success auto-linked on checkout), so this block also
 * links the report to the signed-in user (POST /api/iq/link-report) and then
 * either shows the saved state or, with `hideWhenLinked`, disappears.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';

type Copy = {
  savedTitle: string;
  savedDesc: string;
  goToDashboard: string;
  saveTitle: string;
  saveDesc: string;
  createAccount: string;
  signIn: string;
};

const T: Record<Locale, Copy> = {
  en: {
    savedTitle: 'Report saved',
    savedDesc: 'This report is saved to your account.',
    goToDashboard: 'Go to dashboard',
    saveTitle: 'Save this report',
    saveDesc: 'Create an account to save your reports and come back to them anytime.',
    createAccount: 'Create a free account',
    signIn: 'Sign in',
  },
  zh: {
    savedTitle: '报告已保存',
    savedDesc: '此报告已保存到您的账户中。',
    goToDashboard: '前往控制台',
    saveTitle: '保存此报告',
    saveDesc: '创建账户以保存报告，随时查看历史分析。',
    createAccount: '免费注册',
    signIn: '登录',
  },
  es: {
    savedTitle: 'Informe guardado',
    savedDesc: 'Este informe se guardó en tu cuenta.',
    goToDashboard: 'Ir al panel',
    saveTitle: 'Guarda este informe',
    saveDesc: 'Crea una cuenta para guardar tus informes y consultarlos cuando quieras.',
    createAccount: 'Crear cuenta gratis',
    signIn: 'Iniciar sesión',
  },
};

function clerkLinkEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_DATA !== 'true' && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

function IqReportAutoLink({ reportId, serverUserId, onLinked }: { reportId: string; serverUserId: string | null; onLinked: () => void }) {
  const { isSignedIn, userId, isLoaded } = useAuth();
  const router = useRouter();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    if (serverUserId === userId) return;
    if (serverUserId && serverUserId !== userId) return;
    if (inFlight.current) return;
    inFlight.current = true;

    void (async () => {
      try {
        const res = await fetch('/api/iq/link-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId }),
        });
        if (res.ok) {
          onLinked();
          router.refresh();
        } else {
          inFlight.current = false;
        }
      } catch {
        inFlight.current = false;
      }
    })();
  }, [isLoaded, isSignedIn, userId, serverUserId, reportId, onLinked, router]);

  return null;
}

type Props = {
  reportId: string;
  /** `iq_location_reports.user_id` as rendered on the server. */
  serverUserId: string | null;
  lang: Locale;
  /** Render nothing once the report belongs to an account (the 360° footer already links to the dashboard). */
  hideWhenLinked?: boolean;
  className?: string;
};

export function ReportAccountBlock({ reportId, serverUserId, lang, hideWhenLinked = false, className = '' }: Props) {
  const t = T[lang];
  const [linkedLocally, setLinkedLocally] = useState(false);
  const linked = Boolean(serverUserId) || linkedLocally;
  const autoLink = clerkLinkEnabled() ? (
    <IqReportAutoLink reportId={reportId} serverUserId={serverUserId} onLinked={() => setLinkedLocally(true)} />
  ) : null;
  const redirect = encodeURIComponent(withLang(`/iq/report/${reportId}`, lang));

  if (linked && hideWhenLinked) return autoLink;

  return (
    <>
      {autoLink}
      <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 ${className}`}>
        {linked ? (
          <div className="text-center">
            <div className="mb-3 text-3xl">✅</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-100">{t.savedTitle}</h3>
            <p className="mb-4 text-sm text-zinc-400">{t.savedDesc}</p>
            <Link
              href={withLang('/iq/dashboard', lang)}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 px-5 py-2.5 font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              {t.goToDashboard}
            </Link>
          </div>
        ) : (
          <div className="text-center">
            <div className="mb-3 text-3xl">💾</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-100">{t.saveTitle}</h3>
            <p className="mb-4 text-sm text-zinc-400">{t.saveDesc}</p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href={`/sign-up?redirect_url=${redirect}`}
                className="w-full rounded-xl bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500 sm:w-auto"
              >
                {t.createAccount}
              </Link>
              <Link
                href={`/sign-in?redirect_url=${redirect}`}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/60 px-5 py-2.5 font-medium text-zinc-200 transition hover:bg-zinc-800 sm:w-auto"
              >
                {t.signIn}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
