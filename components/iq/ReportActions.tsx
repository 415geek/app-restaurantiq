'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type Props = {
  reportId: string;
  isLinkedToUser: boolean;
  lang?: 'en' | 'zh';
  isPaid?: boolean;
};

const translations = {
  en: {
    downloadTitle: 'Download Formal Report',
    downloadDesc:
      'Server-generated PDF (A4) with tables and branding — best for sharing, printing, and archives.',
    downloadBtn: 'Download PDF',
    downloadingBtn: 'Generating PDF…',
    downloadTip:
      'If nothing downloads after ~60s or you see an error, use Print below and choose “Save as PDF”.',
    printFallbackTitle: 'Print this page',
    printFallbackDesc: 'Use your browser’s print dialog and choose “Save as PDF”.',
    printFallbackBtn: 'Print / Save as PDF',
    pdfError: 'Could not generate PDF. Try Print / Save as PDF instead.',
    regenTitle: 'Professional depth version',
    regenDesc:
      'Re-run with full market enrichment and McKinsey partner evidence rules (3–5 min). Use after a fast first pass.',
    regenBtn: 'Regenerate professional report',
    regenBusy: 'Regenerating…',
    regenFailed: 'Regeneration failed. Please retry in a moment.',
    savedTitle: 'Report Saved',
    savedDesc: 'This report has been saved to your account.',
    goToDashboard: 'Go to Dashboard',
    saveTitle: 'Save This Report',
    saveDesc: 'Create an account to save reports and access them anytime.',
    createAccount: 'Create Free Account',
    signIn: 'Sign In',
  },
  zh: {
    downloadTitle: '下载正式报告',
    downloadDesc: '由服务器生成 A4 PDF（含表格与品牌样式），便于分享、打印与存档。',
    downloadBtn: '下载 PDF',
    downloadingBtn: '正在生成 PDF…',
    downloadTip: '若约 60 秒内未开始下载或提示错误，请使用下方「打印 / 另存为 PDF」。',
    printFallbackTitle: '打印本页',
    printFallbackDesc: '使用浏览器打印，并选择「另存为 PDF」。',
    printFallbackBtn: '打印 / 另存为 PDF',
    pdfError: '无法生成 PDF，请改用打印并另存为 PDF。',
    regenTitle: '升级为专业深度版',
    regenDesc:
      '将重新拉取完整市场数据并按麦肯锡合伙人证据标准生成（约 3–5 分钟）。适合在快速版生成后升级。',
    regenBtn: '重新生成专业深度报告',
    regenBusy: '正在重新生成…',
    regenFailed: '重新生成失败，请稍后重试。',
    savedTitle: '报告已保存',
    savedDesc: '此报告已保存到您的账户中。',
    goToDashboard: '前往控制台',
    saveTitle: '保存此报告',
    saveDesc: '创建账户以保存报告，随时查看历史分析。',
    createAccount: '免费注册',
    signIn: '登录',
  },
};

async function parsePdfErrorResponse(
  res: Response,
  lang: 'en' | 'zh',
  fallback: string,
): Promise<string> {
  if (res.status === 422) {
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) return j.error;
    } catch {
      /* ignore */
    }
    return lang === 'zh'
      ? '完整报告尚未就绪，请等待生成完成。'
      : 'Full report is not ready yet.';
  }
  if (res.status === 504) {
    return lang === 'zh'
      ? 'PDF 生成超时，请重试或使用打印另存为 PDF。'
      : 'PDF generation timed out. Retry or use Print / Save as PDF.';
  }
  try {
    const j = (await res.json()) as { error?: string; detail?: string; message?: string };
    const msg = j.detail || j.message || j.error;
    if (msg && typeof msg === 'string') return msg.slice(0, 320);
  } catch {
    /* ignore */
  }
  return fallback;
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

  const handleDownloadServerPdf = async () => {
    setPdfError(null);
    setIsDownloading(true);
    try {
      const url = `/api/iq/report/${encodeURIComponent(reportId)}/pdf?lang=${lang}`;
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
      const ct = res.headers.get('content-type') || '';
      if (res.status === 403) {
        setPdfError(lang === 'zh' ? '需完成购买后才能下载正式 PDF。' : 'Purchase is required to download the PDF.');
        return;
      }
      if (res.status === 404) {
        setPdfError(lang === 'zh' ? '找不到该报告。' : 'Report not found.');
        return;
      }
      if (!res.ok) {
        setPdfError(await parsePdfErrorResponse(res, lang, t.pdfError));
        return;
      }
      if (!ct.includes('application/pdf')) {
        setPdfError(await parsePdfErrorResponse(res, lang, t.pdfError));
        return;
      }
      const blob = await res.blob();
      if (blob.size < 512) {
        setPdfError(t.pdfError);
        return;
      }
      const dispo = res.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(dispo);
      const filename = match?.[1] ?? `RestaurantIQ-Report-${reportId.slice(0, 8)}.pdf`;
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
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
        if (res.status === 504) {
          msg =
            lang === 'zh'
              ? '生成超时，请稍后重试。'
              : 'Generation timed out. Please try again later.';
        }
      }
      setRegenError(msg);
    } catch (e) {
      console.error('Professional regen error:', e);
      setRegenError(t.regenFailed);
    } finally {
      setRegenBusy(false);
    }
  };

  const handlePrintFallback = () => {
    try {
      window.print();
    } catch (err) {
      console.error('Print error:', err);
      alert(lang === 'zh' ? '无法打开打印对话框，请重试。' : 'Failed to open print dialog. Please try again.');
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
              onClick={handlePrintFallback}
              disabled={isDownloading || regenBusy}
              className="rounded-xl border border-zinc-600 bg-zinc-800/80 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {t.printFallbackBtn}
            </button>
          </div>
        </div>
      </div>

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
              href="/iq/dashboard"
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
                href={`/sign-up?redirect_url=/iq/report/${reportId}`}
                className="w-full rounded-xl bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500 sm:w-auto"
              >
                {t.createAccount}
              </Link>
              <Link
                href={`/sign-in?redirect_url=/iq/report/${reportId}`}
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
