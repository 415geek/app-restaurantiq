import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { iqGetUserPaidReports } from '@/lib/funnel/iq-repository';

export default async function IqDashboardPage() {
  const { userId } = await auth();
  
  if (!userId) {
    redirect('/sign-in?redirect_url=/iq/dashboard');
  }

  const reports = await iqGetUserPaidReports(userId);

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">My Reports</h1>
            <p className="mt-1 text-white/60">View and manage your location analysis reports</p>
          </div>
          <Link
            href="/iq"
            className="rounded-xl bg-emerald-500 px-5 py-2.5 font-medium text-black transition hover:bg-emerald-400"
          >
            + New Analysis
          </Link>
        </div>

        {reports.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
            <div className="mb-4 text-5xl">📊</div>
            <h2 className="mb-2 text-xl font-semibold text-white">No Reports Yet</h2>
            <p className="mb-6 text-white/60">
              Start analyzing restaurant locations to build your report library.
            </p>
            <Link
              href="/iq"
              className="inline-block rounded-xl bg-emerald-500 px-6 py-3 font-medium text-black transition hover:bg-emerald-400"
            >
              Analyze Your First Location
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <QuickActionCard
            emoji="📍"
            title="New Analysis"
            description="Analyze a new location"
            href="/iq"
          />
          <QuickActionCard
            emoji="📄"
            title="Download Reports"
            description="Get PDF versions"
            href="#"
            disabled
          />
          <QuickActionCard
            emoji="⚙️"
            title="Account Settings"
            description="Manage your account"
            href="/settings"
          />
        </div>
      </div>
    </main>
  );
}

function ReportCard({ report }: { report: { id: string; location: string; business_type: string | null; headline: string; verdict: string; created_at?: string } }) {
  const verdictColors: Record<string, string> = {
    go: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    caution: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    no: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  };
  
  const verdictColor = verdictColors[report.verdict?.toLowerCase()] || 'bg-white/10 text-white/60 border-white/20';
  const date = report.created_at ? new Date(report.created_at).toLocaleDateString() : '';

  return (
    <Link
      href={`/iq/report/${report.id}`}
      className="block rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-emerald-500/30 hover:bg-white/10"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-3">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${verdictColor}`}>
              {report.verdict}
            </span>
            {report.business_type && (
              <span className="text-xs text-white/40">{report.business_type}</span>
            )}
          </div>
          <h3 className="mb-1 text-lg font-semibold text-white line-clamp-1">
            {report.headline}
          </h3>
          <p className="text-sm text-white/60 line-clamp-1">
            📍 {report.location}
          </p>
        </div>
        <div className="ml-4 flex flex-col items-end gap-2">
          {date && <span className="text-xs text-white/40">{date}</span>}
          <svg className="h-5 w-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <div className={`rounded-xl border border-white/10 bg-white/5 p-5 text-center transition ${disabled ? 'opacity-50' : 'hover:border-white/20 hover:bg-white/10'}`}>
      <div className="mb-2 text-2xl">{emoji}</div>
      <h3 className="font-medium text-white">{title}</h3>
      <p className="mt-1 text-xs text-white/50">{description}</p>
    </div>
  );

  if (disabled) {
    return content;
  }

  return <Link href={href}>{content}</Link>;
}
