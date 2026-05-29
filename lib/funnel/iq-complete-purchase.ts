/**
 * Marks an IQ report paid and ensures full_report_json exists.
 * Shared by Stripe webhook and /iq/success (return URL) so users are not stuck
 * when webhooks are delayed or misconfigured on Vercel.
 */

import { iqGetReport, iqMarkPaidAndReport, iqUpdateMarketDataJson } from '@/lib/funnel/iq-repository';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';
import { generateIqFullReportWithN8nFallback } from '@/lib/funnel/iq-generate-full-report';

export type FulfillIqPurchaseInput = {
  reportId: string;
  stripeSessionId: string;
  customerEmail: string | null;
  /** When true, only mark paid; caller generates full_report_json later (faster access-code UX). */
  deferFullReportGeneration?: boolean;
};

export async function fulfillIqPaidPurchase(input: FulfillIqPurchaseInput): Promise<void> {
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
    return;
  }

  if (needsGeneration) {
    try {
      const payLang = existing.language === 'zh' ? 'zh' : 'en';
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
