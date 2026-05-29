import { NextResponse } from 'next/server';
import { iqGetReport, iqSetFullReport, iqUpdateMarketDataJson } from '@/lib/funnel/iq-repository';
import { generateIqFullReportWithN8nFallback } from '@/lib/funnel/iq-generate-full-report';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';

export const runtime = 'nodejs';
/** Paid report pipeline (Tavily deep research + MiMo + dual-verify) can exceed default 10s. */
export const maxDuration = 300;

/**
 * Regenerate or fetch stored full report. Only allowed after payment (webhook sets paid).
 * Body `{ reportId, force: true }` skips cache and regenerates (e.g. after prompt/market_data upgrades).
 * Optional:
 * - `language`: 'en' | 'zh' — overrides stored report.language for generation
 * - `persist`: boolean — when false, does NOT write full_report_json (preview mode for language toggles)
 */
export async function POST(req: Request) {
  try {
    const { reportId, force, language, persist } = (await req.json()) as {
      reportId?: string;
      force?: boolean;
      language?: 'en' | 'zh';
      persist?: boolean;
    };
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

    const hasCached =
      report.full_report_json && Object.keys(report.full_report_json as object).length > 0;
    const isPreview = persist === false;
    if (hasCached && !force && !isPreview) {
      return NextResponse.json(report.full_report_json);
    }

    const targetLang: 'en' | 'zh' =
      language === 'zh' || language === 'en' ? language : report.language === 'zh' ? 'zh' : 'en';

    const enrichedMd = await resolveMarketDataForIqReport({
      existing: report.market_data_json as Record<string, unknown> | null | undefined,
      location: report.location,
      businessType: report.business_type || 'restaurant',
      isPremium: true,
      lang: targetLang,
    });
    const marketForLlm = enrichedMd ?? (report.market_data_json as Record<string, unknown> | null) ?? undefined;
    if (enrichedMd && Object.keys(enrichedMd).length > 0) {
      await iqUpdateMarketDataJson(reportId, enrichedMd);
    }

    const full = await generateIqFullReportWithN8nFallback({
      reportId: report.id,
      location: report.location,
      businessType: report.business_type,
      headline: report.headline,
      reason: report.reason,
      marketData: marketForLlm,
      language: targetLang,
    });

    const fullJson = full;
    if (!isPreview) {
      await iqSetFullReport(reportId, fullJson);
    }
    return NextResponse.json(fullJson);
  } catch (e) {
    console.error('[funnel/full-report]', e);
    return NextResponse.json({ error: 'Failed to generate full report' }, { status: 500 });
  }
}
