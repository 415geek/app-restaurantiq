import Link from 'next/link';
import { notFound } from 'next/navigation';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import { buildCompetitorMapPins, buildGoogleStaticMapUrl } from '@/lib/funnel/iq-competitor-map';
import { ReportShareSection } from '@/components/share/ReportShareSection';
import { ReportContent } from '@/components/iq/ReportContent';
import { IqFullReportGenerating } from '@/components/iq/IqFullReportGenerating';
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { resolveServerLocale } from '@/lib/i18n/server-locale';

type FullShape = Record<string, unknown>;

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ lang?: string }>;
};

const LOCKED: Record<Locale, { title: string; body: string; back: string }> = {
  en: { title: 'Report locked', body: 'Payment is required to access the full report.', back: 'Back to the analyzer' },
  zh: { title: '报告已锁定', body: '需要完成付款才能查看完整报告。', back: '返回分析页' },
  es: { title: 'Informe bloqueado', body: 'Se requiere el pago para acceder al informe completo.', back: 'Volver al analizador' },
};

export default async function IqReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};

  let report;
  try {
    report = await iqGetReport(id);
  } catch (err) {
    console.error('[report page] iqGetReport error:', err);
    notFound();
  }
  if (!report) notFound();

  // ?lang > the language the report was generated in > iq_lang cookie > Accept-Language > en.
  const lang = await resolveServerLocale({ param: sp.lang, preferred: report.language });

  if (!report.paid) {
    const t = LOCKED[lang];
    return (
      <main lang={LOCALE_TAG[lang]} className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <h1 className="mb-4 text-3xl font-bold">{t.title}</h1>
          <p className="mb-6 text-white/70">{t.body}</p>
          <Link href={withLang('/iq', lang)} className="text-emerald-400 underline">
            {t.back}
          </Link>
        </div>
      </main>
    );
  }

  const full = report.full_report_json as FullShape | null;
  const needsClientGeneration = !full || Object.keys(full).length === 0;

  if (needsClientGeneration) {
    return (
      <IqFullReportGenerating
        reportId={id}
        location={report.location}
        headline={report.headline}
        lang={lang}
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
    <main lang={LOCALE_TAG[lang]} className="min-h-screen px-6 py-12">
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
          initialLang={lang}
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
            locale={lang}
          />
        </div>
      </div>
    </main>
  );
}
