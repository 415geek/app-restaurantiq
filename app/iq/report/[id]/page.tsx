import Link from 'next/link';
import { notFound } from 'next/navigation';
import { iqGetReport, iqSetFullReport, iqUpdateMarketDataJson } from '@/lib/funnel/iq-repository';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';
import { runFullReport } from '@/lib/funnel/iq-llm';
import { ReportShareSection } from '@/components/share/ReportShareSection';
import { ReportContent } from '@/components/iq/ReportContent';

type FullShape = Record<string, unknown>;

type Props = {
  params: Promise<{ id: string }>;
};

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

  const reportLanguage = (report.language === 'zh' ? 'zh' : 'en') as 'en' | 'zh';
  
  let full = report.full_report_json as FullShape | null;
  if (!full || Object.keys(full).length === 0) {
    try {
      console.log('[report page] Generating full report for:', id, 'language:', reportLanguage);
      const enrichedMd = await resolveMarketDataForIqReport({
        existing: report.market_data_json as Record<string, unknown> | null | undefined,
        location: report.location,
        businessType: report.business_type || 'restaurant',
      });
      const marketData =
        enrichedMd ?? (report.market_data_json as Record<string, unknown> | null) ?? undefined;
      if (enrichedMd && Object.keys(enrichedMd).length > 0) {
        await iqUpdateMarketDataJson(id, enrichedMd);
      }
      const generated = await runFullReport({
        location: report.location,
        businessType: report.business_type,
        headline: report.headline,
        reason: report.reason,
        marketData,
        language: reportLanguage,
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
        <ReportContent 
          report={{
            id: report.id,
            location: report.location,
            business_type: report.business_type,
            headline: report.headline,
            user_id: report.user_id,
          }}
          full={full ?? {}}
          initialLang={reportLanguage}
        />

        {/* Share Section - hidden during print */}
        <div className="no-print">
          <ReportShareSection
            reportId={id}
            headline={report.headline}
            location={report.location}
            confidence={typeof full?.confidence === 'string' ? full.confidence : undefined}
          />
        </div>
      </div>
    </main>
  );
}
