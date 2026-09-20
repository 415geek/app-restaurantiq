'use client';

/**
 * Actions under the last page of the 360° document (/iq/report/[id]):
 * download the PDF, share, open the print edition, switch language, add
 * details & regenerate, analyze another address. Dark-styled: it sits on the
 * navy /iq ground below the white pages.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PaidIntakeForm } from '@/components/iq/PaidIntakeForm';
import { rememberPaidReport } from '@/components/iq/SupportBubble';
import { useReport360Generation } from '@/components/iq/useReport360Generation';
import { ShareButton } from '@/components/share/ShareButton';
import { LOCALES, LOCALE_LABEL, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { persistLocale } from '@/lib/i18n/use-locale';
import { ui } from '@/components/iq/ui';

type Copy = {
  kicker: string;
  title: string;
  desc: string;
  download: string;
  downloading: string;
  preview: string;
  language: string;
  addDetails: string;
  addDetailsDesc: string;
  regenerating: string;
  analyzeAnother: string;
  dashboard: string;
  shareTitle: (location: string) => string;
  shareDesc: string;
  pdfError: string;
  pdfNotReady: string;
  pdfTimeout: string;
  purchaseRequired: string;
  reportNotFound: string;
  regenFailed: string;
  regenTimeout: string;
  reportId: string;
};

const T: Record<Locale, Copy> = {
  en: {
    kicker: '360° REPORT',
    title: 'Download or share this report',
    desc: 'The PDF is the same 16-page document you just read — cover + 15 pages, US Letter, ready to print or forward.',
    download: 'Download the 360° PDF',
    downloading: 'Preparing the PDF…',
    preview: 'Print edition',
    language: 'Language',
    addDetails: 'Add details & regenerate',
    addDetailsDesc: 'Seats, ticket sizes, competitors you know of — sharper competitor and finance sections. Regenerating takes 1–3 minutes; this page reloads when the new report is ready.',
    regenerating: 'Regenerating the 360° report (1–3 min)… this page reloads automatically.',
    analyzeAnother: 'Analyze another address',
    dashboard: 'My reports',
    shareTitle: (l) => `RestaurantIQ 360° report: ${l}`,
    shareDesc: 'Trade area, competition, finance model and verdict for this address.',
    pdfError: 'Could not generate the PDF. Please try again, or open the print edition and choose "Save as PDF".',
    pdfNotReady: 'The 360° report is not ready yet.',
    pdfTimeout: 'PDF generation timed out. Please try again.',
    purchaseRequired: 'Purchase is required to download the PDF.',
    reportNotFound: 'Report not found.',
    regenFailed: 'Regeneration failed. Please try again in a moment.',
    regenTimeout: 'Regeneration timed out. Refresh the page later to check.',
    reportId: 'Report ID',
  },
  zh: {
    kicker: '360° 报告',
    title: '下载或分享这份报告',
    desc: 'PDF 与你刚读完的 16 页文档完全一致——封面 + 15 页，US Letter 尺寸，可直接打印或转发。',
    download: '下载 360° PDF',
    downloading: '正在准备 PDF…',
    preview: '打印版',
    language: '语言',
    addDetails: '补充信息并重新生成',
    addDetailsDesc: '补充座位、客单价、你知道的竞品等，竞对与财务会更准。重新生成约 1–3 分钟，完成后本页自动刷新。',
    regenerating: '正在重新生成 360° 报告（约 1–3 分钟）…完成后本页自动刷新。',
    analyzeAnother: '再分析一个地址',
    dashboard: '我的报告',
    shareTitle: (l) => `RestaurantIQ 360° 选址报告：${l}`,
    shareDesc: '该地址的商圈、竞争、财务模型与结论。',
    pdfError: '无法生成 PDF，请重试，或打开打印版后选择「另存为 PDF」。',
    pdfNotReady: '360° 报告尚未就绪。',
    pdfTimeout: 'PDF 生成超时，请重试。',
    purchaseRequired: '需完成购买后才能下载 PDF。',
    reportNotFound: '找不到该报告。',
    regenFailed: '重新生成失败，请稍后重试。',
    regenTimeout: '重新生成超时，请稍后刷新页面查看。',
    reportId: '报告编号',
  },
  es: {
    kicker: 'INFORME 360°',
    title: 'Descarga o comparte este informe',
    desc: 'El PDF es el mismo documento de 16 páginas que acabas de leer: portada + 15 páginas, tamaño carta, listo para imprimir o reenviar.',
    download: 'Descargar PDF 360°',
    downloading: 'Preparando el PDF…',
    preview: 'Edición para imprimir',
    language: 'Idioma',
    addDetails: 'Agregar datos y volver a generar',
    addDetailsDesc: 'Asientos, ticket promedio, competidores que conozcas: secciones de competencia y finanzas más precisas. Volver a generar tarda 1–3 minutos; esta página se recarga cuando el nuevo informe esté listo.',
    regenerating: 'Generando de nuevo el informe 360° (1–3 min)… esta página se recarga automáticamente.',
    analyzeAnother: 'Analizar otra dirección',
    dashboard: 'Mis informes',
    shareTitle: (l) => `Informe 360° de RestaurantIQ: ${l}`,
    shareDesc: 'Área comercial, competencia, modelo financiero y veredicto para esta dirección.',
    pdfError: 'No se pudo generar el PDF. Inténtalo de nuevo o abre la edición para imprimir y elige "Guardar como PDF".',
    pdfNotReady: 'El informe 360° aún no está listo.',
    pdfTimeout: 'La generación del PDF tardó demasiado. Inténtalo de nuevo.',
    purchaseRequired: 'Necesitas completar la compra para descargar el PDF.',
    reportNotFound: 'No se encontró el informe.',
    regenFailed: 'La regeneración falló. Inténtalo de nuevo en un momento.',
    regenTimeout: 'La regeneración tardó demasiado. Actualiza la página más tarde para comprobar.',
    reportId: 'ID del informe',
  },
};

async function parsePdfErrorResponse(res: Response, t: Copy): Promise<string> {
  if (res.status === 422) {
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) return j.error;
    } catch {
      /* ignore */
    }
    return t.pdfNotReady;
  }
  if (res.status === 504) return t.pdfTimeout;
  try {
    const j = (await res.json()) as { error?: string; detail?: string; message?: string };
    const msg = j.detail || j.message || j.error;
    if (msg && typeof msg === 'string') return msg.slice(0, 320);
  } catch {
    /* ignore */
  }
  return t.pdfError;
}

type Props = {
  reportId: string;
  lang: Locale;
  location: string;
  /** Path (+ query) of this page without `lang`, e.g. `/iq/report/<id>`; language pills append `?lang=`. */
  pageHref: string;
  /** Report belongs to an account → show "My reports" instead of the sign-up card (rendered by the page). */
  isLinkedToUser: boolean;
  /** Fixture preview (non-production): the row does not exist, so regeneration is hidden. */
  previewOnly?: boolean;
};

export function Report360Footer({ reportId, lang, location, pageHref, isLinkedToUser, previewOnly = false }: Props) {
  const t = T[lang];
  const [isDownloading, setIsDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState(() => withLang(`/iq/report/${reportId}`, lang));

  useEffect(() => {
    rememberPaidReport(reportId, location);
    setShareUrl(withLang(`${window.location.origin}/iq/report/${reportId}`, lang));
  }, [reportId, location, lang]);

  const { busy, generating, error: regenError, regenerate } = useReport360Generation({
    reportId,
    onReady: () => window.location.reload(),
    failedMessage: t.regenFailed,
    timeoutMessage: t.regenTimeout,
  });

  const pdfUrl = `/api/iq/report/${encodeURIComponent(reportId)}/pdf?lang=${lang}`;
  const printUrl = withLang(`/print/${encodeURIComponent(reportId)}`, lang);

  /**
   * Mobile-safe download: probe the route first (readable error when the
   * report is unpaid / not ready / failed), then hand the real download to the
   * browser through a same-tab navigation — iOS Safari / WeChat / Android
   * WebViews ignore programmatic blob downloads, a plain navigation works.
   */
  const handleDownloadPdf = async () => {
    setPdfError(null);
    setIsDownloading(true);
    try {
      const res = await fetch(pdfUrl, { method: 'GET', credentials: 'same-origin', headers: { 'x-iq-pdf-probe': '1' } });
      if (res.status === 403) {
        setPdfError(t.purchaseRequired);
        return;
      }
      if (res.status === 404) {
        setPdfError(t.reportNotFound);
        return;
      }
      if (!res.ok) {
        setPdfError(await parsePdfErrorResponse(res, t));
        return;
      }
      window.location.assign(pdfUrl);
    } catch (e) {
      console.error('PDF download error:', e);
      setPdfError(t.pdfError);
    } finally {
      setIsDownloading(false);
    }
  };

  const disabled = isDownloading || busy || generating;

  return (
    <footer className="report-viewer-footer mx-auto mt-8 w-full max-w-[203.9mm]" data-report-footer="">
      <div className={`${ui.card} p-5 sm:p-6`}>
        <div className={ui.kicker}>{t.kicker}</div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-brand-navy">{t.title}</h2>
        <p className="mt-1 text-sm text-zinc-600">{t.desc}</p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={disabled}
            className={`${ui.btnPrimary} px-6 text-base`}
          >
            {isDownloading ? (
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            {isDownloading ? t.downloading : t.download}
          </button>
          <ShareButton
            shareUrl={shareUrl}
            title={t.shareTitle(location)}
            description={t.shareDesc}
            reportId={reportId}
            locale={lang}
            variant="secondary"
            size="lg"
            className="justify-center"
          />
          <a
            href={printUrl}
            target="_blank"
            rel="noopener"
            className={`${ui.btnSecondary} px-6 text-base`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            {t.preview}
          </a>
        </div>
        {pdfError ? (
          <p className="mt-3 text-xs text-rose-700" role="alert">
            {pdfError}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-zinc-200 pt-5">
          <div className="inline-flex items-center gap-2" role="group" aria-label={t.language}>
            <span className="text-xs text-zinc-500">{t.language}</span>
            <div className={ui.segment}>
              {LOCALES.map((l) => (
                <Link
                  key={l}
                  href={withLang(pageHref, l)}
                  onClick={() => persistLocale(l)}
                  aria-current={lang === l ? 'page' : undefined}
                  data-lang-pill={l}
                  className={lang === l ? ui.segmentOn : ui.segmentOff}
                >
                  {LOCALE_LABEL[l]}
                </Link>
              ))}
            </div>
          </div>
          {!previewOnly ? (
            <button
              type="button"
              onClick={() => setFormOpen((o) => !o)}
              disabled={disabled}
              aria-expanded={formOpen}
              className={ui.btnLink}
            >
              {t.addDetails}
            </button>
          ) : null}
        </div>

        {formOpen && !generating ? (
          <div className={`mt-4 ${ui.inset} p-4`}>
            <p className="mb-3 text-xs text-zinc-600">{t.addDetailsDesc}</p>
            <PaidIntakeForm
              lang={lang}
              reportId={reportId}
              mode="standalone"
              onCancel={() => setFormOpen(false)}
              onSaved={async () => {
                setFormOpen(false);
                await regenerate();
              }}
            />
          </div>
        ) : null}
        {generating ? (
          <div className={`mt-4 flex items-center gap-3 ${ui.inset} px-4 py-3 text-sm text-zinc-700`} role="status">
            <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t.regenerating}
          </div>
        ) : null}
        {regenError ? (
          <p className="mt-3 text-xs text-rose-700" role="alert">
            {regenError}
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 text-center text-sm sm:flex-row sm:justify-between">
        <Link href={withLang('/iq', lang)} className={ui.btnLink}>
          ← {t.analyzeAnother}
        </Link>
        <span className="text-xs text-zinc-500">
          {t.reportId}: {reportId.slice(0, 8)}
        </span>
        {isLinkedToUser ? (
          <Link href={withLang('/iq/dashboard', lang)} className={ui.btnLink}>
            {t.dashboard} →
          </Link>
        ) : null}
      </div>
    </footer>
  );
}
