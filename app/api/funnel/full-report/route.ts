import { NextResponse } from 'next/server';
import { iqGetReport, iqSetFullReport } from '@/lib/funnel/iq-repository';
import { runFullReport } from '@/lib/funnel/iq-llm';
import { generateFullReportWithN8n } from '@/lib/n8n';

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

    const hasN8nWebhook = Boolean(
      process.env.N8N_FULL_REPORT_WEBHOOK_URL?.trim() || process.env.N8N_IQ_FULL_REPORT_WEBHOOK_URL?.trim()
    );

    const full = hasN8nWebhook
      ? await generateFullReportWithN8n({
          analysis_id: report.id,
          address: report.location,
          industry: 'restaurant',
          cuisine_type: report.business_type ?? undefined,
          market_data: (report.market_data_json as Record<string, unknown> | null) ?? undefined,
          headline: report.headline,
          reason: report.reason,
          language: report.language === 'zh' ? 'zh' : 'en',
        })
      : await runFullReport({
          location: report.location,
          businessType: report.business_type,
          headline: report.headline,
          reason: report.reason,
          marketData: (report.market_data_json as Record<string, unknown> | null) ?? undefined,
          language: report.language === 'zh' ? 'zh' : 'en',
        });

    const fullJson = full as Record<string, unknown>;
    await iqSetFullReport(reportId, fullJson);
    return NextResponse.json(fullJson);
  } catch (e) {
    console.error('[funnel/full-report]', e);
    return NextResponse.json({ error: 'Failed to generate full report' }, { status: 500 });
  }
}
