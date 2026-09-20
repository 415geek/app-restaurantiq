import { redirect } from 'next/navigation';
import Link from 'next/link';
import { iqGetUserPaidReports } from '@/lib/funnel/iq-repository';
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { resolveServerLocale } from '@/lib/i18n/server-locale';
import { tierPill, ui } from '@/components/iq/ui';

const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

type Props = {
  searchParams?: Promise<{ lang?: string }>;
};

const COPY: Record<
  Locale,
  {
    title: string;
    sub: string;
    newAnalysis: string;
    emptyTitle: string;
    emptyBody: string;
    emptyCta: string;
    qaNewTitle: string;
    qaNewDesc: string;
    qaDownloadTitle: string;
    qaDownloadDesc: string;
    qaSettingsTitle: string;
    qaSettingsDesc: string;
    verdict: Record<'go' | 'caution' | 'no', string>;
  }
> = {
  en: {
    title: 'My reports',
    sub: 'View and manage your location analysis reports',
    newAnalysis: '+ New analysis',
    emptyTitle: 'No reports yet',
    emptyBody: 'Start analyzing restaurant locations to build your report library.',
    emptyCta: 'Analyze your first location',
    qaNewTitle: 'New analysis',
    qaNewDesc: 'Analyze a new location',
    qaDownloadTitle: 'Download reports',
    qaDownloadDesc: 'Get PDF versions',
    qaSettingsTitle: 'Account settings',
    qaSettingsDesc: 'Manage your account',
    verdict: { go: 'GO', caution: 'CAUTION', no: 'NO GO' },
  },
  zh: {
    title: '我的报告',
    sub: '查看和管理你的选址分析报告',
    newAnalysis: '+ 新建分析',
    emptyTitle: '还没有报告',
    emptyBody: '开始分析餐厅选址，建立你的报告库。',
    emptyCta: '分析第一个地址',
    qaNewTitle: '新建分析',
    qaNewDesc: '分析一个新地址',
    qaDownloadTitle: '下载报告',
    qaDownloadDesc: '获取 PDF 版本',
    qaSettingsTitle: '账户设置',
    qaSettingsDesc: '管理你的账户',
    verdict: { go: '可做', caution: '谨慎', no: '不建议' },
  },
  es: {
    title: 'Mis informes',
    sub: 'Consulta y administra tus informes de análisis de ubicación',
    newAnalysis: '+ Nuevo análisis',
    emptyTitle: 'Aún no hay informes',
    emptyBody: 'Empieza a analizar ubicaciones de restaurantes para armar tu biblioteca de informes.',
    emptyCta: 'Analizar tu primera ubicación',
    qaNewTitle: 'Nuevo análisis',
    qaNewDesc: 'Analizar una nueva ubicación',
    qaDownloadTitle: 'Descargar informes',
    qaDownloadDesc: 'Obtener versiones en PDF',
    qaSettingsTitle: 'Configuración de la cuenta',
    qaSettingsDesc: 'Administrar tu cuenta',
    verdict: { go: 'ADELANTE', caution: 'CAUTELA', no: 'NO RECOMENDADO' },
  },
};

export default async function IqDashboardPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const locale = await resolveServerLocale({ param: sp.lang });
  const t = COPY[locale];
  let userId: string | null = null;

  if (isClerkConfigured) {
    try {
      const { auth } = await import('@clerk/nextjs/server');
      const session = await auth();
      userId = session.userId;
    } catch (e) {
      console.error('[dashboard] auth error:', e);
    }
  }

  if (!userId) {
    redirect(withLang('/iq', locale));
  }

  const reports = await iqGetUserPaidReports(userId);
  const home = withLang('/iq', locale);

  return (
    <main lang={LOCALE_TAG[locale]} className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-brand-navy sm:text-3xl">{t.title}</h1>
            <p className="mt-1 text-sm text-zinc-600">{t.sub}</p>
          </div>
          <Link href={home} className={`${ui.btnPrimary} py-2.5`}>
            {t.newAnalysis}
          </Link>
        </div>

        {reports.length === 0 ? (
          <div className={`${ui.card} p-12 text-center`}>
            <h2 className="mb-2 text-xl font-semibold tracking-tight text-brand-navy">{t.emptyTitle}</h2>
            <p className="mb-6 text-sm text-zinc-600">{t.emptyBody}</p>
            <Link href={home} className={ui.btnPrimary}>
              {t.emptyCta}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => (
              <ReportCard key={report.id} report={report} locale={locale} />
            ))}
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <QuickActionCard
            emoji="📍"
            title={t.qaNewTitle}
            description={t.qaNewDesc}
            href={home}
          />
          <QuickActionCard
            emoji="📄"
            title={t.qaDownloadTitle}
            description={t.qaDownloadDesc}
            href="#"
            disabled
          />
          <QuickActionCard
            emoji="⚙️"
            title={t.qaSettingsTitle}
            description={t.qaSettingsDesc}
            href="/settings"
          />
        </div>
      </div>
    </main>
  );
}

function ReportCard({
  report,
  locale,
}: {
  report: { id: string; location: string; business_type: string | null; headline: string; verdict: string; created_at?: string };
  locale: Locale;
}) {
  const key = report.verdict?.toLowerCase();
  const verdictColor = tierPill[key] ?? ui.pill.neutral;
  const verdictLabel = (key === 'go' || key === 'caution' || key === 'no' ? COPY[locale].verdict[key] : null) || report.verdict;
  const date = report.created_at ? new Date(report.created_at).toLocaleDateString(LOCALE_TAG[locale]) : '';

  return (
    <Link href={withLang(`/iq/report/${report.id}`, locale)} className={`block ${ui.card} p-6 transition hover:border-zinc-400`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-3">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${verdictColor}`}>
              {verdictLabel}
            </span>
            {report.business_type && (
              <span className="text-xs text-zinc-500">{report.business_type}</span>
            )}
          </div>
          <h3 className="mb-1 text-lg font-semibold tracking-tight text-brand-navy line-clamp-1">
            {report.headline}
          </h3>
          <p className="text-sm text-zinc-600 line-clamp-1">
            {report.location}
          </p>
        </div>
        <div className="ml-4 flex flex-col items-end gap-2">
          {date && <span className="text-xs text-zinc-500">{date}</span>}
          <svg className="h-5 w-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

function QuickActionCard({
  emoji,
  title,
  description,
  href,
  disabled,
}: {
  emoji: string;
  title: string;
  description: string;
  href: string;
  disabled?: boolean;
}) {
  const content = (
    <div className={`${ui.card} p-5 text-center transition ${disabled ? 'opacity-50' : 'hover:border-zinc-400'}`}>
      <div className="mb-2 text-2xl" aria-hidden>{emoji}</div>
      <h3 className="font-semibold text-brand-navy">{title}</h3>
      <p className="mt-1 text-xs text-zinc-500">{description}</p>
    </div>
  );

  if (disabled) {
    return content;
  }

  return <Link href={href}>{content}</Link>;
}
