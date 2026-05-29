import { NextResponse } from 'next/server';
import { iqGetReport, iqSetFullReport, iqUpdateMarketDataJson } from '@/lib/funnel/iq-repository';
import { generateIqFullReportWithN8nFallback } from '@/lib/funnel/iq-generate-full-report';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';

export const runtime = 'nodejs';
/** Paid report pipeline can exceed default 10s — allow up to 5 minutes. */
export const maxDuration = 300;

/**
 * Regenerate or fetch stored full report. Only allowed after payment (webhook sets paid).
 * Body `{ reportId, force: true }` skips cache and regenerates (e.g. after prompt/market_data upgrades).
 * Optional:
 * - `language`: 'en' | 'zh' — overrides stored report.language for generation
 * - `persist`: boolean — when false, does NOT write full_report_json (preview mode for language toggles)
 */
function fullReportErrorMessage(lang: 'en' | 'zh', code: string): string {
  if (code === 'FULL_REPORT_GENERATION_FAILED') {
    return lang === 'zh'
      ? '完整报告生成失败，请稍后刷新重试。'
      : 'Full report generation failed. Please refresh and try again.';
  }
  return lang === 'zh'
    ? '完整报告生成失败，请稍后刷新重试。'
    : 'Full report generation failed. Please refresh and try again.';
}

export async function POST(req: Request) {
  let targetLang: 'en' | 'zh' = 'en';
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

    targetLang =
      language === 'zh' || language === 'en' ? language : report.language === 'zh' ? 'zh' : 'en';

    let enrichedMd: Record<string, unknown> | null = null;
    try {
      enrichedMd = await resolveMarketDataForIqReport({
        existing: report.market_data_json as Record<string, unknown> | null | undefined,
        location: report.location,
        businessType: report.business_type || 'restaurant',
        isPremium: true,
        lang: targetLang,
        /** Client-triggered generation: do not block on a fresh Tavily deep-research run. */
        skipDeepResearchFetch: true,
      });
    } catch (enrichErr) {
      console.warn('[funnel/full-report] market enrich failed, using stored market_data', enrichErr);
      enrichedMd =
        report.market_data_json && typeof report.market_data_json === 'object'
          ? (report.market_data_json as Record<string, unknown>)
          : null;
    }
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
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: fullReportErrorMessage(targetLang, msg),
        ...(process.env.NODE_ENV === 'development' ? { detail: msg.slice(0, 300) } : {}),
      },
      { status: 500 },
    );
  }
}
