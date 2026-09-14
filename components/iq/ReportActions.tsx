'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Report360Panel } from '@/components/iq/Report360Panel';
import type { Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';

type Props = {
  reportId: string;
  isLinkedToUser: boolean;
  lang?: Locale;
  isPaid?: boolean;
};

type Copy = {
  downloadTitle: string;
  downloadDesc: string;
  downloadBtn: string;
  downloadingBtn: string;
  downloadTip: string;
  printFallbackTitle: string;
  printFallbackDesc: string;
  printFallbackBtn: string;
  pdfError: string;
  pdfNotReady: string;
  pdfTimeout: string;
  purchaseRequired: string;
  reportNotFound: string;
  regenTitle: string;
  regenDesc: string;
  regenBtn: string;
  regenBusy: string;
  regenFailed: string;
  regenTimeout: string;
  printDialogFailed: string;
  savedTitle: string;
  savedDesc: string;
  goToDashboard: string;
  saveTitle: string;
  saveDesc: string;
  createAccount: string;
  signIn: string;
};

const translations: Record<Locale, Copy> = {
  en: {
    downloadTitle: 'Download the formal report',
    downloadDesc: 'Server-generated PDF (A4) with tables and branding — best for sharing, printing, and your records.',
    downloadBtn: 'Download PDF',
    downloadingBtn: 'Generating PDF…',
    downloadTip: 'If nothing downloads after ~60s or you see an error, use Print below and choose “Save as PDF”.',
    printFallbackTitle: 'Print / preview',
    printFallbackDesc: 'Opens the light print edition (cover + 15 pages); use your browser’s print dialog and choose “Save as PDF”.',
    printFallbackBtn: 'Print / Save as PDF',
    pdfError: 'Could not generate the PDF. Try Print / Save as PDF instead.',
    pdfNotReady: 'The full report is not ready yet.',
    pdfTimeout: 'PDF generation timed out. Retry, or use Print / Save as PDF.',
    purchaseRequired: 'Purchase is required to download the PDF.',
    reportNotFound: 'Report not found.',
    regenTitle: 'Professional-depth edition',
    regenDesc: 'Re-run with full market enrichment and McKinsey partner-level evidence rules (3–5 min). Use it after a fast first pass.',
    regenBtn: 'Regenerate professional report',
    regenBusy: 'Regenerating…',
    regenFailed: 'Regeneration failed. Please try again in a moment.',
    regenTimeout: 'Generation timed out. Please try again later.',
    printDialogFailed: 'Could not open the print dialog. Please try again.',
    savedTitle: 'Report saved',
    savedDesc: 'This report is saved to your account.',
    goToDashboard: 'Go to dashboard',
    saveTitle: 'Save this report',
    saveDesc: 'Create an account to save your reports and come back to them anytime.',
    createAccount: 'Create a free account',
    signIn: 'Sign in',
  },
  zh: {
    downloadTitle: '下载正式报告',
    downloadDesc: '由服务器生成 A4 PDF（含表格与品牌样式），便于分享、打印与存档。',
    downloadBtn: '下载 PDF',
    downloadingBtn: '正在生成 PDF…',
    downloadTip: '若约 60 秒内未开始下载或提示错误，请使用下方「打印 / 另存为 PDF」。',
    printFallbackTitle: '打印 / 在线预览',
    printFallbackDesc: '打开浅色打印版（封面 + 15 页），再用浏览器打印并选择「另存为 PDF」。',
    printFallbackBtn: '打印 / 另存为 PDF',
    pdfError: '无法生成 PDF，请改用打印并另存为 PDF。',
    pdfNotReady: '完整报告尚未就绪，请等待生成完成。',
    pdfTimeout: 'PDF 生成超时，请重试或使用打印另存为 PDF。',
    purchaseRequired: '需完成购买后才能下载正式 PDF。',
    reportNotFound: '找不到该报告。',
    regenTitle: '升级为专业深度版',
    regenDesc: '将重新拉取完整市场数据并按麦肯锡合伙人证据标准生成（约 3–5 分钟）。适合在快速版生成后升级。',
    regenBtn: '重新生成专业深度报告',
    regenBusy: '正在重新生成…',
    regenFailed: '重新生成失败，请稍后重试。',
    regenTimeout: '生成超时，请稍后重试。',
    printDialogFailed: '无法打开打印对话框，请重试。',
    savedTitle: '报告已保存',
    savedDesc: '此报告已保存到您的账户中。',
    goToDashboard: '前往控制台',
    saveTitle: '保存此报告',
    saveDesc: '创建账户以保存报告，随时查看历史分析。',
    createAccount: '免费注册',
    signIn: '登录',
  },
  es: {
    downloadTitle: 'Descargar el informe formal',
    downloadDesc: 'PDF generado en el servidor (A4) con tablas y marca; ideal para compartir, imprimir y archivar.',
    downloadBtn: 'Descargar PDF',
    downloadingBtn: 'Generando PDF…',
    downloadTip: 'Si no se descarga nada después de ~60 s o ves un error, usa Imprimir abajo y elige “Guardar como PDF”.',
    printFallbackTitle: 'Imprimir / vista previa',
    printFallbackDesc: 'Abre la edición clara para impresión (portada + 15 páginas); usa el diálogo de impresión del navegador y elige “Guardar como PDF”.',
    printFallbackBtn: 'Imprimir / Guardar como PDF',
    pdfError: 'No se pudo generar el PDF. Prueba con Imprimir / Guardar como PDF.',
    pdfNotReady: 'El informe completo aún no está listo.',
    pdfTimeout: 'La generación del PDF tardó demasiado. Reintenta o usa Imprimir / Guardar como PDF.',
    purchaseRequired: 'Necesitas completar la compra para descargar el PDF.',
    reportNotFound: 'No se encontró el informe.',
    regenTitle: 'Edición profesional a fondo',
    regenDesc: 'Vuelve a ejecutar con enriquecimiento completo de mercado y reglas de evidencia de nivel socio de McKinsey (3–5 min). Úsala después de una primera pasada rápida.',
    regenBtn: 'Volver a generar el informe profesional',
    regenBusy: 'Generando de nuevo…',
    regenFailed: 'La regeneración falló. Inténtalo de nuevo en un momento.',
    regenTimeout: 'La generación tardó demasiado. Inténtalo de nuevo más tarde.',
    printDialogFailed: 'No se pudo abrir el diálogo de impresión. Inténtalo de nuevo.',
    savedTitle: 'Informe guardado',
    savedDesc: 'Este informe se guardó en tu cuenta.',
    goToDashboard: 'Ir al panel',
    saveTitle: 'Guarda este informe',
    saveDesc: 'Crea una cuenta para guardar tus informes y consultarlos cuando quieras.',
    createAccount: 'Crear cuenta gratis',
    signIn: 'Iniciar sesión',
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

export function ReportActions({ reportId, isLinkedToUser, lang = 'en', isPaid = false }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const t = translations[lang];

  const [linked, setLinked] = useState(isLinkedToUser);
  useEffect(() => {
    setLinked(isLinkedToUser);
  }, [isLinkedToUser]);

  const pdfUrl = `/api/iq/report/${encodeURIComponent(reportId)}/pdf?lang=${lang}`;
  const printUrl = `/print/${encodeURIComponent(reportId)}?lang=${lang}`;

  /**
   * Mobile-safe download.
   *
   * The previous implementation fetched the PDF into a Blob and clicked a
   * synthetic <a download> — iOS Safari / WeChat / many Android WebViews
   * ignore programmatic blob downloads (nothing happens, or a blank tab), which
   * is exactly the "PDF won't download" report from phone users. We now:
   *   1. Pre-flight the route with a HEAD-style probe (GET + Range) so we can
   *      show a readable error when the report is not paid / not ready / failed.
   *   2. Then hand the real download to the browser through a same-tab
   *      navigation to the PDF URL (server sends Content-Disposition:
   *      attachment) — desktop browsers save the file without leaving the
   *      page, iOS opens its native PDF viewer with the Share/Save sheet.
   */
  const handleDownloadServerPdf = async () => {
    setPdfError(null);
    setIsDownloading(true);
    try {
      const res = await fetch(pdfUrl, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'x-iq-pdf-probe': '1' },
      });
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
      // Probe OK (204 = report ready). Let the browser perform the download.
      window.location.assign(pdfUrl);
    } catch (e) {
      console.error('PDF download error:', e);
      setPdfError(t.pdfError);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleProfessionalRegen = async () => {
    setRegenError(null);
    setRegenBusy(true);
    try {
      const res = await fetch('/api/funnel/full-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, force: true, quality: true }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const raw = await res.text();
      let msg = t.regenFailed;
      try {
        const j = JSON.parse(raw) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        if (res.status === 504) msg = t.regenTimeout;
      }
      setRegenError(msg);
    } catch (e) {
      console.error('Professional regen error:', e);
      setRegenError(t.regenFailed);
    } finally {
      setRegenBusy(false);
    }
  };

  /**
   * Print fallback: reports with a 360° model open the light, paginated /print
   * page (cover + 15 pages, @page CSS) in a new tab, where the browser's
   * "Save as PDF" gives the same document the server renders. Only legacy
   * reports without a model print this (dark) page.
   */
  const handlePrintFallback = async () => {
    try {
      const res = await fetch(`/api/iq/report360/${encodeURIComponent(reportId)}`, { cache: 'no-store' });
      if (res.ok) {
        const j = (await res.json()) as { ready?: boolean };
        if (j.ready) {
          window.open(printUrl, '_blank', 'noopener');
          return;
        }
      }
    } catch {
      /* fall through to printing this page */
    }
    try {
      window.print();
    } catch (err) {
      console.error('Print error:', err);
      alert(t.printDialogFailed);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 text-4xl">📄</div>
          <h3 className="mb-2 text-lg font-semibold text-zinc-100">{t.downloadTitle}</h3>
          <p className="mb-4 text-sm text-zinc-400">{t.downloadDesc}</p>
          <button
            type="button"
            onClick={() => void handleDownloadServerPdf()}
            disabled={isDownloading || regenBusy}
            className="flex items-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-50"
          >
            {isDownloading ? (
              <>
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t.downloadingBtn}
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t.downloadBtn}
              </>
            )}
          </button>
          {pdfError ? (
            <p className="mt-3 text-xs text-amber-400/90" role="alert">
              {pdfError}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-zinc-500">{t.downloadTip}</p>
          <div className="mt-6 w-full border-t border-zinc-800 pt-6">
            <p className="mb-2 text-sm font-medium text-zinc-300">{t.printFallbackTitle}</p>
            <p className="mb-3 text-xs text-zinc-500">{t.printFallbackDesc}</p>
            <button
              type="button"
              onClick={() => void handlePrintFallback()}
              disabled={isDownloading || regenBusy}
              className="rounded-xl border border-zinc-600 bg-zinc-800/80 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {t.printFallbackBtn}
            </button>
          </div>
        </div>
      </div>

      {isPaid ? <Report360Panel reportId={reportId} lang={lang} /> : null}

      {isPaid ? (
        <div className="rounded-2xl border border-amber-900/40 bg-amber-950/20 p-6">
          <div className="text-center">
            <h3 className="mb-2 text-lg font-semibold text-amber-100">{t.regenTitle}</h3>
            <p className="mb-4 text-sm text-amber-200/70">{t.regenDesc}</p>
            <button
              type="button"
              onClick={() => void handleProfessionalRegen()}
              disabled={regenBusy || isDownloading}
              className="rounded-xl border border-amber-700/60 bg-amber-900/40 px-6 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-900/60 disabled:opacity-50"
            >
              {regenBusy ? t.regenBusy : t.regenBtn}
            </button>
            {regenError ? (
              <p className="mt-3 text-xs text-amber-400/90" role="alert">
                {regenError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {linked ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="text-center">
            <div className="mb-3 text-3xl">✅</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-100">{t.savedTitle}</h3>
            <p className="mb-4 text-sm text-zinc-400">{t.savedDesc}</p>
            <Link
              href={withLang('/iq/dashboard', lang)}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 px-5 py-2.5 font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              {t.goToDashboard}
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="text-center">
            <div className="mb-3 text-3xl">💾</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-100">{t.saveTitle}</h3>
            <p className="mb-4 text-sm text-zinc-400">{t.saveDesc}</p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href={`/sign-up?redirect_url=${encodeURIComponent(withLang(`/iq/report/${reportId}`, lang))}`}
                className="w-full rounded-xl bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500 sm:w-auto"
              >
                {t.createAccount}
              </Link>
              <Link
                href={`/sign-in?redirect_url=${encodeURIComponent(withLang(`/iq/report/${reportId}`, lang))}`}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/60 px-5 py-2.5 font-medium text-zinc-200 transition hover:bg-zinc-800 sm:w-auto"
              >
                {t.signIn}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
