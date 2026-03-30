'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type Props = {
  reportId: string;
  isLinkedToUser: boolean;
  lang?: 'en' | 'zh';
};

const translations = {
  en: {
    downloadTitle: 'Download Formal Report',
    downloadDesc: 'Get a professionally formatted PDF — ready for investors, partners, or your records.',
    downloadBtn: 'Download PDF Report',
    downloadingBtn: 'Opening Print Dialog...',
    downloadTip: 'Tip: Select "Save as PDF" in the print dialog',
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
    downloadDesc: '获取专业格式的 PDF 报告，可用于投资人、合作伙伴展示或个人存档。',
    downloadBtn: '下载 PDF 报告',
    downloadingBtn: '正在打开打印对话框...',
    downloadTip: '提示：在打印对话框中选择"另存为 PDF"',
    savedTitle: '报告已保存',
    savedDesc: '此报告已保存到您的账户中。',
    goToDashboard: '前往控制台',
    saveTitle: '保存此报告',
    saveDesc: '创建账户以保存报告，随时查看历史分析。',
    createAccount: '免费注册',
    signIn: '登录',
  },
};

export function ReportActions({ reportId, isLinkedToUser, lang = 'en' }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);
  const t = translations[lang];

  // Props update after router.refresh() (e.g. post sign-in link); keep UI in sync.
  const [linked, setLinked] = useState(isLinkedToUser);
  useEffect(() => {
    setLinked(isLinkedToUser);
  }, [isLinkedToUser]);

  const handleDownloadPdf = () => {
    setIsDownloading(true);
    try {
      window.print();
    } catch (err) {
      console.error('Print error:', err);
      alert(lang === 'zh' ? '无法打开打印对话框，请重试。' : 'Failed to open print dialog. Please try again.');
    } finally {
      setTimeout(() => setIsDownloading(false), 500);
    }
  };

  return (
    <div className="space-y-6">
      {/* PDF Download Section */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 text-4xl">📄</div>
          <h3 className="mb-2 text-lg font-semibold text-zinc-100">
            {t.downloadTitle}
          </h3>
          <p className="mb-4 text-sm text-zinc-400">
            {t.downloadDesc}
          </p>
          <button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
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
          <p className="mt-3 text-xs text-zinc-500">
            {t.downloadTip}
          </p>
        </div>
      </div>

      {/* Account Section */}
      {linked ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="text-center">
            <div className="mb-3 text-3xl">✅</div>
            <h3 className="mb-2 text-lg font-semibold text-zinc-100">
              {t.savedTitle}
            </h3>
            <p className="mb-4 text-sm text-zinc-400">
              {t.savedDesc}
            </p>
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
            <h3 className="mb-2 text-lg font-semibold text-zinc-100">
              {t.saveTitle}
            </h3>
            <p className="mb-4 text-sm text-zinc-400">
              {t.saveDesc}
            </p>
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
