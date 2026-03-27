import Link from 'next/link';
import { notFound } from 'next/navigation';
import { iqGetReport, iqSetFullReport } from '@/lib/funnel/iq-repository';
import { runFullReport } from '@/lib/funnel/iq-llm';
import { ReportShareSection } from '@/components/share/ReportShareSection';
import { ReportActions } from '@/components/iq/ReportActions';
import { auth } from '@clerk/nextjs/server';

type FullShape = {
  executive_summary?: string;
  final_verdict?: string;
  trade_area_analysis?: string;
  demographic_profile?: string;
  competition_landscape?: string;
  revenue_estimate?: string;
  risks?: string[];
  opportunities?: string[];
  failure_scenarios?: string[];
  differentiation_strategy?: string;
  action_plan?: string[];
  confidence?: string;
};

type Props = {
  params: Promise<{ id: string }>;
};

function ConfidenceBadge({ level }: { level?: string }) {
  const colors: Record<string, string> = {
    High: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    Medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    Low: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  };
  const color = colors[level ?? ''] || 'bg-white/10 text-white/60 border-white/20';
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-sm font-medium ${color}`}>
      {level ?? 'Unknown'} Confidence
    </span>
  );
}

export default async function IqReportPage({ params }: Props) {
  const { id } = await params;
  
  let report;
  try {
    report = await iqGetReport(id);
  } catch (err) {
    console.error('[report page] iqGetReport error:', err);
    notFound();
  }
  if (!report) notFound();

  if (!report.paid) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <h1 className="mb-4 text-3xl font-bold">Report locked</h1>
          <p className="mb-6 text-white/70">Payment is required to access the full report.</p>
          <Link href="/iq" className="text-emerald-400 underline">
            Back to analyzer
          </Link>
        </div>
      </main>
    );
  }

  let full = report.full_report_json as FullShape | null;
  if (!full || Object.keys(full).length === 0) {
    try {
      console.log('[report page] Generating full report for:', id);
      const marketData = report.market_data_json as Record<string, unknown> | null;
      const generated = await runFullReport({
        location: report.location,
        businessType: report.business_type,
        headline: report.headline,
        reason: report.reason,
        marketData: marketData ?? undefined,
      });
      await iqSetFullReport(id, generated);
      full = generated as FullShape;
      console.log('[report page] Full report generated successfully');
    } catch (err) {
      console.error('[report page] runFullReport error:', err);
      full = {};
    }
  }

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-900/20 to-emerald-800/10 p-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.25em] text-emerald-300/70">
              RestaurantIQ Full Report
            </div>
            <ConfidenceBadge level={full?.confidence} />
          </div>
          <h1 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            {report.headline}
          </h1>
          <p className="text-lg text-white/70">{report.location}</p>
          {report.business_type && (
            <p className="mt-1 text-sm text-white/50">Business Type: {report.business_type}</p>
          )}
        </div>

        {/* Executive Summary */}
        {full?.executive_summary && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
              <span>📋</span> Executive Summary
            </h2>
            <p className="text-base leading-relaxed text-white/80">{full.executive_summary}</p>
          </div>
        )}

        {/* Final Verdict */}
        {full?.final_verdict && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-emerald-300">
              <span>✅</span> Final Verdict
            </h2>
            <p className="text-lg font-medium text-white">{full.final_verdict}</p>
          </div>
        )}

        {/* Share Section */}
        <ReportShareSection
          reportId={id}
          headline={report.headline}
          location={report.location}
          confidence={full?.confidence}
        />

        {/* Trade Area & Demographics */}
        <div className="grid gap-6 md:grid-cols-2">
          {full?.trade_area_analysis && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                <span>📍</span> Trade Area Analysis
              </h2>
              <p className="text-sm leading-relaxed text-white/70">{full.trade_area_analysis}</p>
            </div>
          )}
          {full?.demographic_profile && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                <span>👥</span> Demographic Profile
              </h2>
              <p className="text-sm leading-relaxed text-white/70">{full.demographic_profile}</p>
            </div>
          )}
        </div>

        {/* Competition & Revenue */}
        <div className="grid gap-6 md:grid-cols-2">
          {full?.competition_landscape && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                <span>🏪</span> Competition Landscape
              </h2>
              <p className="text-sm leading-relaxed text-white/70">{full.competition_landscape}</p>
            </div>
          )}
          {full?.revenue_estimate && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-emerald-300">
                <span>💰</span> Revenue Estimate
              </h2>
              <p className="text-base font-medium text-white">{full.revenue_estimate}</p>
            </div>
          )}
        </div>

        {/* Risks */}
        {full?.risks && full.risks.length > 0 && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-rose-300">
              <span>⚠️</span> Top Risks
            </h2>
            <ol className="space-y-3">
              {full.risks.map((risk, i) => (
                <li key={i} className="flex gap-3 text-sm text-white/80">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-xs font-bold text-rose-300">
                    {i + 1}
                  </span>
                  <span>{risk}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Opportunities */}
        {full?.opportunities && full.opportunities.length > 0 && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-emerald-300">
              <span>💡</span> Opportunities
            </h2>
            <ol className="space-y-3">
              {full.opportunities.map((opp, i) => (
                <li key={i} className="flex gap-3 text-sm text-white/80">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300">
                    {i + 1}
                  </span>
                  <span>{opp}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Failure Scenarios */}
        {full?.failure_scenarios && full.failure_scenarios.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-amber-300">
              <span>🚨</span> Failure Scenarios
            </h2>
            <ul className="space-y-3">
              {full.failure_scenarios.map((scenario, i) => (
                <li key={i} className="flex gap-3 text-sm text-white/80">
                  <span className="text-amber-400">•</span>
                  <span>{scenario}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Differentiation Strategy */}
        {full?.differentiation_strategy && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
              <span>🎯</span> Differentiation Strategy
            </h2>
            <p className="text-sm leading-relaxed text-white/70">{full.differentiation_strategy}</p>
          </div>
        )}

        {/* Action Plan */}
        {full?.action_plan && full.action_plan.length > 0 && (
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-blue-300">
              <span>📝</span> 90-Day Action Plan
            </h2>
            <ol className="space-y-3">
              {full.action_plan.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-white/80">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-300">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* PDF Download & Account Actions */}
        <ReportActions reportId={id} isLinkedToUser={!!report.user_id} />

        {/* Footer */}
        <div className="text-center">
          <p className="text-sm text-white/30">
            Generated by RestaurantIQ.ai • Report ID: {id.slice(0, 8)}
          </p>
          <Link href="/iq" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
            ← Analyze another location
          </Link>
        </div>
      </div>
    </main>
  );
}
