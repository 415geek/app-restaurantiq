import { NextResponse } from 'next/server';
import { iqCountReports } from '@/lib/funnel/iq-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/iq/stats → `{ reports: number | null }`
 *
 * Real `count(*)` of iq_location_reports for the "已生成 N 份分析" line
 * (评审 Spec §4.7). Cached in memory for 10 minutes per instance; never fails
 * the page — any error yields `reports: null` and the UI hides the number.
 */
const TTL_MS = 10 * 60_000;
let cache: { at: number; reports: number } | null = null;
let inflight: Promise<number> | null = null;

async function countReportsCached(): Promise<number | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.reports;
  try {
    if (!inflight) {
      inflight = iqCountReports().finally(() => {
        inflight = null;
      });
    }
    const reports = await inflight;
    cache = { at: Date.now(), reports };
    return reports;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.includes('Supabase admin env is not configured')) {
      console.warn('[iq/stats] count failed:', message);
    }
    return cache?.reports ?? null;
  }
}

export async function GET() {
  const reports = await countReportsCached();
  return NextResponse.json(
    { reports },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=600, stale-while-revalidate=600' } },
  );
}
