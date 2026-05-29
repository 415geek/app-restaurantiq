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
  if (code === 'FULL_REPORT_TIMEOUT') {
    return lang === 'zh'
      ? '生成时间较长已超时，请点击下方「重试生成」再试一次。'
      : 'Generation timed out. Tap Retry below to try again.';
  }
  if (code === 'FULL_REPORT_GENERATION_FAILED') {
    return lang === 'zh'
      ? '完整报告生成失败，请点击「重试生成」或稍后刷新。'
      : 'Full report generation failed. Tap Retry or refresh later.';
  }
  return lang === 'zh'
    ? '完整报告生成失败，请点击「重试生成」或稍后刷新。'
    : 'Full report generation failed. Tap Retry or refresh later.';
}

export async function POST(req: Request) {
  let targetLang: 'en' | 'zh' = 'en';
  try {
    const { reportId, force, language, persist, quality } = (await req.json()) as {
      reportId?: string;
      force?: boolean;
      language?: 'en' | 'zh';
      persist?: boolean;
      /** Professional McKinsey-depth regen: fuller market context + no lean LLM shortcuts. */
      quality?: boolean;
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

    // Language preview (persist: false) must stay lean — not a full quality regen.
    const qualityMode = quality === true || (force === true && !isPreview);
    const leanLangPreview = isPreview;

    let enrichedMd: Record<string, unknown> | null = null;
    try {
      enrichedMd = await resolveMarketDataForIqReport({
        existing: report.market_data_json as Record<string, unknown> | null | undefined,
        location: report.location,
        businessType: report.business_type || 'restaurant',
        isPremium: true,
        lang: targetLang,
        skipDeepResearchFetch: leanLangPreview || !qualityMode,
        leanResolve: leanLangPreview || !qualityMode,
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
      skipDualVerify: leanLangPreview || !qualityMode,
      leanGeneration: leanLangPreview || !qualityMode,
      qualityMode,
    });

    const fullJson = full;
    if (!isPreview) {
      await iqSetFullReport(reportId, fullJson);
    }
    return NextResponse.json(fullJson);
  } catch (e) {
    console.error('[funnel/full-report]', e);
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout =
      /timeout|timed out|504|FUNCTION_INVOCATION_TIMEOUT|deadline/i.test(msg) ||
      (e instanceof Error && e.name === 'AbortError');
    const code = isTimeout ? 'FULL_REPORT_TIMEOUT' : msg;
    return NextResponse.json(
      {
        error: fullReportErrorMessage(targetLang, code),
        retryable: true,
        ...(process.env.NODE_ENV === 'development' ? { detail: msg.slice(0, 300) } : {}),
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
