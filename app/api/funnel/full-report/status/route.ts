import { NextResponse, type NextRequest } from 'next/server';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import { getReportGenerationStatus } from '@/lib/funnel/iq-report-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Polled by the generation page: `GET ?reportId=` → stage/progress/error. */
export async function GET(req: NextRequest) {
  const reportId = req.nextUrl.searchParams.get('reportId')?.trim();
  if (!reportId) return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });

  try {
    const status = await getReportGenerationStatus(reportId);
    if (!status) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    if ('legacy' in status && status.legacy) {
      return NextResponse.json({ legacy: true });
    }
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[full-report/status]', e);
    // Never strand the poller: report legacy so the client falls back.
    const row = await iqGetReport(reportId).catch(() => null);
    return NextResponse.json({ legacy: true, hasReport: Boolean(row?.full_report_json) });
  }
}
