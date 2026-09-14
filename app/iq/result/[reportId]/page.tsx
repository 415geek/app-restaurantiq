/**
 * /iq/result/[reportId] — canonical free-result URL (评审 Spec §4.5).
 *
 * Loads the `iq_location_reports` row server-side and renders the same result
 * UI as the parameter route without ever calling analyze again. When the row
 * cannot be loaded (transient DB error, no DB in a preview) the client falls
 * back to the copy it cached in the tab right before the redirect.
 */
import { Suspense } from 'react';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import { readStoredFreeResult } from '@/lib/funnel/iq-analyze-cache';
import { toLocale } from '@/lib/i18n/locale';
import { RESULT_LOADING_COPY, ResultClient, type StoredResultPayload } from '../ResultClient';

type Props = {
  params: Promise<{ reportId: string }>;
};

export const dynamic = 'force-dynamic';

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function loadStoredResult(reportId: string): Promise<StoredResultPayload | null> {
  try {
    const row = await iqGetReport(reportId);
    if (!row) return null;
    const md = (row.market_data_json as Record<string, unknown> | null) ?? null;
    const stored = readStoredFreeResult(md);
    // Rows analysed before free_result was persisted still carry verdict / headline / reason.
    const result = stored ?? {
      verdict: row.verdict,
      headline: row.headline,
      subheadline: row.reason || undefined,
    };
    if (!result.verdict || !result.headline) return null;
    const ui = (md?.user_inputs as Record<string, unknown> | undefined) ?? {};
    return {
      reportId: row.id,
      location: row.location,
      businessType: row.business_type ?? '',
      language: toLocale(row.language),
      result,
      userInputs: { monthly_rent_usd: num(ui.monthly_rent_usd), sqft: num(ui.sqft) },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('Supabase admin env is not configured')) {
      console.error('[iq/result/[reportId]] load failed:', message);
    }
    return null;
  }
}

export default async function IqStoredResultPage({ params }: Props) {
  const { reportId } = await params;
  const id = decodeURIComponent(reportId).trim().slice(0, 80);
  const initial = id ? await loadStoredResult(id) : null;
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center px-6">
          <p className="text-lg">{RESULT_LOADING_COPY}</p>
        </main>
      }
    >
      <ResultClient mode="stored" reportId={id} initial={initial} />
    </Suspense>
  );
}
