/**
 * /iq/report/[id] — the paid report.
 *
 * When the 360° model exists (`report_model_json`) the page renders the very
 * same document the PDF is made of (`ReportDocument` + app/print/print.css:
 * cover + 15 white `.page` boxes) on the navy /iq shell, scaled to the viewport
 * on phones, with the download / share / language / regenerate actions under
 * the last page (Report360Footer). While the model is still generating the
 * legacy LLM report is shown with Report360Panel, which reloads into the
 * document once the model lands.
 *
 * Non-production only: `?fixture=millbrae` renders qa/fixtures without a DB
 * row (any id), mirroring /print — used by the screenshot smoke.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import { buildCompetitorMapPins, buildGoogleStaticMapUrl } from '@/lib/funnel/iq-competitor-map';
import { ReportShareSection } from '@/components/share/ReportShareSection';
import { ReportContent } from '@/components/iq/ReportContent';
import { IqFullReportGenerating } from '@/components/iq/IqFullReportGenerating';
import { Report360Document } from '@/components/iq/Report360Document';
import { Report360Footer } from '@/components/iq/Report360Footer';
import { ReportAccountBlock } from '@/components/iq/ReportAccountBlock';
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { resolveServerLocale } from '@/lib/i18n/server-locale';
import { ReportDocument } from '@/lib/iq/render/pages';
import { fixtureAllowed, loadPrintModel } from '@/lib/iq/render/load';
import { resolveStaticMaps, type StaticMaps } from '@/lib/iq/render/static-map';
import type { ReportModel } from '@/lib/iq/model/schema';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';
import '@/app/print/print.css';

type FullShape = Record<string, unknown>;

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ lang?: string; fixture?: string }>;
};

const LOCKED: Record<Locale, { title: string; body: string; back: string }> = {
  en: { title: 'Report locked', body: 'Payment is required to access the full report.', back: 'Back to the analyzer' },
  zh: { title: '报告已锁定', body: '需要完成付款才能查看完整报告。', back: '返回分析页' },
  es: { title: 'Informe bloqueado', body: 'Se requiere el pago para acceder al informe completo.', back: 'Volver al analizador' },
};

/** Same font set as app/print/layout.tsx (Noto Serif SC titles, Noto Sans SC body, Inter numerals). */
const PRINT_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@600;700;900&display=swap';

function Report360View({
  reportId,
  model,
  staticMaps,
  lang,
  location,
  pageHref,
  userId,
  previewOnly,
}: {
  reportId: string;
  model: ReportModel;
  staticMaps: StaticMaps;
  lang: Locale;
  location: string;
  pageHref: string;
  userId: string | null;
  previewOnly: boolean;
}) {
  return (
    <div lang={LOCALE_TAG[lang]} className="report-viewer min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={PRINT_FONTS_HREF} />
      <Report360Document>
        <div className="print-root" data-print-root="">
          <ReportDocument model={model} staticMaps={staticMaps} lang={lang} />
        </div>
      </Report360Document>
      <Report360Footer reportId={reportId} lang={lang} location={location} pageHref={pageHref} isLinkedToUser={Boolean(userId)} previewOnly={previewOnly} />
      {!previewOnly ? (
        <div className="report-viewer-chrome mx-auto mt-6 w-full max-w-[203.9mm]">
          <ReportAccountBlock reportId={reportId} serverUserId={userId} lang={lang} hideWhenLinked />
        </div>
      ) : null}
    </div>
  );
}

export default async function IqReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};

  // Non-production preview without a DB row (same guard as /print).
  const fixture = fixtureAllowed() ? sp.fixture?.trim() || null : null;
  if (fixture) {
    await ensureRuntimeConfig();
    const loaded = await loadPrintModel({ reportId: id, fixture });
    if (!loaded) notFound();
    const lang = await resolveServerLocale({ param: sp.lang, preferred: loaded.model.meta.language });
    const staticMaps = await resolveStaticMaps(loaded.model, { lang });
    return (
      <Report360View
        reportId={id}
        model={loaded.model}
        staticMaps={staticMaps}
        lang={lang}
        location={loaded.model.input.address}
        pageHref={`/iq/report/${encodeURIComponent(id)}?fixture=${encodeURIComponent(fixture)}`}
        userId={null}
        previewOnly
      />
    );
  }

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

  // 360° model → render the PDF's document itself.
  if (report.report_model_json) {
    let loaded: Awaited<ReturnType<typeof loadPrintModel>> = null;
    try {
      await ensureRuntimeConfig();
      loaded = await loadPrintModel({ reportId: id });
    } catch (err) {
      console.error('[report page] loadPrintModel failed:', err instanceof Error ? err.message : err);
    }
    if (loaded) {
      const staticMaps = await resolveStaticMaps(loaded.model, { lang });
      return (
        <Report360View
          reportId={id}
          model={loaded.model}
          staticMaps={staticMaps}
          lang={lang}
          location={report.location}
          pageHref={`/iq/report/${encodeURIComponent(id)}`}
          userId={report.user_id}
          previewOnly={false}
        />
      );
    }
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
