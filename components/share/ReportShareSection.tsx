'use client';

import { ShareButton } from './ShareButton';

type ReportShareSectionProps = {
  reportId: string;
  headline: string;
  location: string;
  confidence?: string;
};

export function ReportShareSection({ reportId, headline, location, confidence }: ReportShareSectionProps) {
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/iq/report/${reportId}`
    : '';

  return (
    <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-sm text-zinc-400">
        Share this report with your team or partners
      </div>
      <ShareButton
        shareUrl={shareUrl}
        title={`RestaurantIQ Report: ${headline}`}
        description={`Location analysis for ${location}. Confidence: ${confidence || 'N/A'}`}
        reportId={reportId}
        variant="primary"
        size="sm"
      />
    </div>
  );
}
