/**
 * Marks an IQ report paid and ensures full_report_json exists.
 * Shared by Stripe webhook and /iq/success (return URL) so users are not stuck
 * when webhooks are delayed or misconfigured on Vercel.
 */

import { toLocale } from '@/lib/i18n/locale';
import { iqGetReport, iqMarkPaidAndReport, iqUpdateMarketDataJson } from '@/lib/funnel/iq-repository';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';
import { generateIqFullReportWithN8nFallback } from '@/lib/funnel/iq-generate-full-report';
import { startReportGeneration } from '@/lib/funnel/iq-report-job';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export type FulfillIqPurchaseInput = {
  reportId: string;
  stripeSessionId: string;
  customerEmail: string | null;
  /** When true, only mark paid; caller generates full_report_json later (faster access-code UX). */
  deferFullReportGeneration?: boolean;
};

export async function fulfillIqPaidPurchase(input: FulfillIqPurchaseInput): Promise<void> {
  await ensureRuntimeConfig();
  const existing = await iqGetReport(input.reportId);
  if (!existing) {
    console.warn('[fulfillIqPaidPurchase] report not found:', input.reportId);
    return;
  }

  let fullJson = existing.full_report_json as Record<string, unknown> | null;
  const needsGeneration = !fullJson || Object.keys(fullJson).length === 0;

  if (input.deferFullReportGeneration && needsGeneration) {
    await iqMarkPaidAndReport({
      reportId: input.reportId,
      stripeSessionId: input.stripeSessionId,
      customerEmail: input.customerEmail,
      fullReportJson: null,
    });
    // Start the background job right away so the report is often ready by
    // the time the user reaches the report page. Best-effort: the report page
    // starts (or resumes) the same job if this kick did not land.
    try {
      const started = await startReportGeneration({
        reportId: input.reportId,
        mode: 'standard',
        trigger: 'purchase',
      });
      console.log(`[fulfillIqPaidPurchase] background generation: ${started.kind}`);
    } catch (e) {
      console.warn('[fulfillIqPaidPurchase] could not start background generation:', e);
    }
    return;
  }

  if (needsGeneration) {
    try {
      const payLang = toLocale(existing.language);
      const enrichedMd = await resolveMarketDataForIqReport({
        existing: existing.market_data_json as Record<string, unknown> | null | undefined,
        location: existing.location,
        businessType: existing.business_type || 'restaurant',
        isPremium: true,
        lang: payLang,
      });
      const marketData =
        enrichedMd ?? (existing.market_data_json as Record<string, unknown> | null) ?? undefined;
      if (enrichedMd && Object.keys(enrichedMd).length > 0) {
        await iqUpdateMarketDataJson(input.reportId, enrichedMd);
      }

      fullJson = (await generateIqFullReportWithN8nFallback({
        reportId: existing.id,
        location: existing.location,
        businessType: existing.business_type,
        headline: existing.headline,
        reason: existing.reason,
        marketData,
        language: payLang,
      })) as Record<string, unknown>;
    } catch (genErr) {
      console.error('[fulfillIqPaidPurchase] full report generation failed', genErr);
      fullJson = null;
    }
  }

  await iqMarkPaidAndReport({
    reportId: input.reportId,
    stripeSessionId: input.stripeSessionId,
    customerEmail: input.customerEmail,
    fullReportJson: fullJson,
  });
}
