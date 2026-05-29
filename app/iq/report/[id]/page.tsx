import Link from 'next/link';
import { notFound } from 'next/navigation';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import { buildCompetitorMapPins, buildGoogleStaticMapUrl } from '@/lib/funnel/iq-competitor-map';
import { ReportShareSection } from '@/components/share/ReportShareSection';
import { ReportContent } from '@/components/iq/ReportContent';
import { IqFullReportGenerating } from '@/components/iq/IqFullReportGenerating';

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
  const needsClientGeneration = !full || Object.keys(full).length === 0;

  if (needsClientGeneration) {
    return (
      <IqFullReportGenerating
        reportId={id}
        location={report.location}
        headline={report.headline}
        lang={reportLanguage}
      />
    );
  }

  const marketData = (report.market_data_json as Record<string, unknown> | null) ?? null;
  const mapPins = buildCompetitorMapPins({
    marketData,
    reportCompetitors: Array.isArray(full?.competitors) ? full.competitors : [],
  });
  const staticMapUrl =
    mapPins.center && mapPins.pins.length > 0
      ? buildGoogleStaticMapUrl({ center: mapPins.center, pins: mapPins.pins })
      : null;

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
          marketData={marketData}
          staticMapUrl={staticMapUrl}
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
