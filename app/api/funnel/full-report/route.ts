import { NextResponse } from 'next/server';
import { iqGetReport, iqSetFullReport } from '@/lib/funnel/iq-repository';
import { runFullReport } from '@/lib/funnel/iq-llm';

export const runtime = 'nodejs';

/**
 * Regenerate or fetch stored full report. Only allowed after payment (webhook sets paid).
 */
export async function POST(req: Request) {
  try {
    const { reportId } = (await req.json()) as { reportId?: string };
    if (!reportId) {
      return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
    }

    const report = await iqGetReport(reportId);
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (!report.paid) {
      return NextResponse.json({ error: 'Payment required' }, { status: 402 });
    }

    if (report.full_report_json && Object.keys(report.full_report_json).length > 0) {
      return NextResponse.json(report.full_report_json);
    }

    const full = await runFullReport({
      location: report.location,
      businessType: report.business_type,
      headline: report.headline,
      reason: report.reason,
    });

    await iqSetFullReport(reportId, full);
    return NextResponse.json(full);
  } catch (e) {
    console.error('[funnel/full-report]', e);
    return NextResponse.json({ error: 'Failed to generate full report' }, { status: 500 });
  }
}
