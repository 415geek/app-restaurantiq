'use client';

import { useState } from 'react';
import Link from 'next/link';

type Props = {
  reportId: string;
  isLinkedToUser: boolean;
};

export function ReportActions({ reportId, isLinkedToUser }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [linked, setLinked] = useState(isLinkedToUser);

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/iq/report/${reportId}/pdf`);
      if (!res.ok) throw new Error('Download failed');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RestaurantIQ-Report-${reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleLinkToAccount = async () => {
    setIsLinking(true);
    try {
      const res = await fetch('/api/iq/link-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      });
      if (res.ok) {
        setLinked(true);
      }
    } catch (err) {
      console.error('Link error:', err);
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* PDF Download Section */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/50 to-slate-900/50 p-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 text-4xl">📄</div>
          <h3 className="mb-2 text-lg font-semibold text-white">
            Download Formal Report
          </h3>
          <p className="mb-4 text-sm text-white/60">
            Get a professionally formatted PDF — ready for investors, partners, or your records.
          </p>
          <button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {isDownloading ? (
              <>
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Generating PDF...
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download PDF Report
              </>
            )}
          </button>
        </div>
      </div>

      {/* Account Section - simplified without Clerk dependency */}
      {linked ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <div className="text-center">
            <div className="mb-3 text-3xl">✅</div>
            <h3 className="mb-2 text-lg font-semibold text-emerald-300">
              Report Saved
            </h3>
            <p className="mb-4 text-sm text-white/60">
              This report has been saved to your account.
            </p>
            <Link
              href="/iq/dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 font-medium text-emerald-300 transition hover:bg-emerald-500/20"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Go to Dashboard
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <div className="text-center">
            <div className="mb-3 text-3xl">💾</div>
            <h3 className="mb-2 text-lg font-semibold text-white">
              Save This Report
            </h3>
            <p className="mb-4 text-sm text-white/60">
              Link this report to your account for easy access later.
            </p>
            <button
              onClick={handleLinkToAccount}
              disabled={isLinking}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 font-medium text-black transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {isLinking ? 'Saving...' : 'Save to My Account'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
