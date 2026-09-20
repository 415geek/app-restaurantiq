import { NextResponse } from 'next/server';
import { iqCountReports } from '@/lib/funnel/iq-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/iq/stats → `{ reports: number }`
 *
 * The "已生成 N 份分析" line (评审 Spec §4.7): `REPORTS_BASELINE` plus the live
 * `count(*)` of iq_location_reports, so the number keeps growing with every
 * analysis. The baseline is the analyses generated before this table started
 * counting (product owner's figure, 2026-09-20); the table alone only counts
 * rows written since the funnel moved to Supabase. Cached in memory for 10
 * minutes per instance; never fails the page — when the count is unavailable
 * the baseline is returned on its own.
 */
const REPORTS_BASELINE = 6547;
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
  const counted = await countReportsCached();
  const reports = REPORTS_BASELINE + Math.max(0, counted ?? 0);
  return NextResponse.json(
    { reports, counted },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=600, stale-while-revalidate=600' } },
  );
}
