import { NextResponse } from 'next/server';
import { iqGetReport, iqSetFullReport, iqUpdateMarketDataJson } from '@/lib/funnel/iq-repository';
import { generateIqFullReportWithN8nFallback } from '@/lib/funnel/iq-generate-full-report';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';
import {
  createIqDeadline,
  DEEP_RESEARCH_MIN_BUDGET_MS,
  GENERATION_MIN_BUDGET_MS,
} from '@/lib/funnel/iq-deadline';
import { startReportGeneration } from '@/lib/funnel/iq-report-job';
import { kickReport360 } from '@/lib/iq/kick';

export const runtime = 'nodejs';
/** Legacy synchronous path (language preview / un-migrated DB) can run minutes. */
export const maxDuration = 300;

/**
 * Paid full report entry point.
 *
 * Default: enqueue the background job and return 202 — the browser polls
 * `/api/funnel/full-report/status`. Each stage runs in its own invocation, so
 * the 300s wall no longer applies to the whole pipeline and a retry resumes
 * from the failed stage.
 *
 * Synchronous generation remains for two cases and returns the report JSON:
 * - `persist: false` language previews (lean, in-memory only)
 * - databases where migration 0008 has not been applied yet
 *
 * Body: `{ reportId, force?, language?, persist?, quality? }`.
 */
function fullReportErrorMessage(lang: 'en' | 'zh', code: string): string {
  if (code === 'FULL_REPORT_TIMEOUT') {
    return lang === 'zh'
      ? '生成时间较长已超时，请点击下方「重试生成」再试一次。'
      : 'Generation timed out. Tap Retry below to try again.';
  }
  return lang === 'zh'
    ? '完整报告生成失败，请点击「重试生成」或稍后刷新。'
    : 'Full report generation failed. Tap Retry or refresh later.';
}

/** Must match the route's maxDuration so stages can budget against it. */
const ROUTE_BUDGET_MS = 300_000;

type Body = {
  reportId?: string;
  force?: boolean;
  language?: 'en' | 'zh';
  persist?: boolean;
  /** Professional McKinsey-depth regen: fuller market context + no lean LLM shortcuts. */
  quality?: boolean;
};

export async function POST(req: Request) {
  let targetLang: 'en' | 'zh' = 'en';
  const deadline = createIqDeadline(ROUTE_BUDGET_MS);
  try {
    const { reportId, force, language, persist, quality } = (await req.json()) as Body;
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
    const qualityMode = quality === true && !isPreview;

    // ── Background job (default for real generation) ─────────────────────────
    if (!isPreview) {
      const started = await startReportGeneration({
        reportId,
        mode: qualityMode ? 'professional' : 'standard',
        language: targetLang,
        force: Boolean(force) || qualityMode,
        trigger: qualityMode ? 'upgrade' : 'report-page',
      });
      if (started.kind === 'running') {
        return NextResponse.json(
          { status: 'running', stage: started.stage, resumed: started.resumed },
          { status: 202 },
        );
      }
      if (started.kind === 'already_done') {
        const fresh = await iqGetReport(reportId);
        return NextResponse.json(fresh?.full_report_json ?? report.full_report_json);
      }
      if (started.kind !== 'legacy') {
        return NextResponse.json({ error: started.kind }, { status: 500 });
      }
      // legacy: fall through to synchronous generation below
    }

    // ── Legacy synchronous path ──────────────────────────────────────────────
    const leanLangPreview = isPreview;

    let enrichedMd: Record<string, unknown> | null = null;
    try {
      enrichedMd = await resolveMarketDataForIqReport({
        existing: report.market_data_json as Record<string, unknown> | null | undefined,
        location: report.location,
        businessType: report.business_type || 'restaurant',
        isPremium: true,
        lang: targetLang,
        skipDeepResearchFetch:
          leanLangPreview ||
          !qualityMode ||
          !deadline.hasBudget(DEEP_RESEARCH_MIN_BUDGET_MS),
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

    console.log(
      `[funnel/full-report] (sync) market data resolved in ${Math.round(deadline.elapsedMs() / 1000)}s; ` +
        `${Math.round(deadline.remainingMs() / 1000)}s left for generation`,
    );

    if (!deadline.hasBudget(GENERATION_MIN_BUDGET_MS)) {
      throw new Error('FULL_REPORT_TIMEOUT');
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
      timeoutMs: deadline.remainingMs(),
      deadline,
    });

    const fullJson = full as Record<string, unknown>;
    fullJson.generation_tier = qualityMode ? 'professional' : 'standard';
    if (!isPreview) {
      await iqSetFullReport(reportId, fullJson);
      await kickReport360(reportId);
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
        detail: msg.slice(0, 400),
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
