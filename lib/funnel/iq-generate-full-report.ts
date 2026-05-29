/**
 * Single entry for paid LocationIQ full reports: n8n (if configured) → OpenAI fallback.
 * Keeps webhook URL resolution, analysis_id, and parse/quality logging consistent across
 * Stripe webhook, /api/funnel/full-report, and /iq/report/[id].
 */

import { generateFullReportWithN8n, shouldUseN8nForIqFullReport } from '@/lib/n8n';
import { stripInternalIqReportFields } from '@/lib/funnel/iq-report-sanitize';
import {
  applyCompetitorWhitelist,
  applyFinanceModelOverride,
  logFullReportQuality,
  parseIqFullReport,
  type IqReportWithGrounding,
} from '@/lib/funnel/iq-full-report-schema';
import type { DeterministicFinanceModel } from '@/lib/funnel/iq-finance-model';
import { extractCompetitorWhitelist } from '@/lib/funnel/iq-market-signals';
import { applyDualModelVerification } from '@/lib/funnel/iq-dual-model-verify';
import { runFullPremiumReport } from '@/lib/funnel/iq-llm';

export type GenerateIqFullReportInput = {
  reportId: string;
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData: Record<string, unknown> | undefined;
  language: 'en' | 'zh';
  /** Skip C-5 cross-verify to finish within serverless time budget (browser-triggered path). */
  skipDualVerify?: boolean;
  /** Skip completeness/competitor regen retries (faster, single LLM pass). */
  leanGeneration?: boolean;
};

export async function generateIqFullReportWithN8nFallback(
  input: GenerateIqFullReportInput,
): Promise<IqReportWithGrounding> {
  const payload = {
    analysis_id: input.reportId,
    address: input.location,
    industry: 'restaurant',
    cuisine_type: input.businessType ?? undefined,
    market_data: input.marketData,
    headline: input.headline,
    reason: input.reason,
    language: input.language,
  };

  // Build the whitelist once — both branches need it for grounding.
  const whitelist = extractCompetitorWhitelist(input.marketData ?? null);

  // D-4: deterministic finance model was attached to market_data by
  // resolveMarketDataForIqReport. Use it to override LLM's break_even / safe_revenue.
  const financeModel = (input.marketData?.finance_model ?? null) as
    | DeterministicFinanceModel
    | null;

  if (shouldUseN8nForIqFullReport()) {
    try {
      const raw = await generateFullReportWithN8n(payload);
      const parsed = parseIqFullReport(raw);
      const grounded = applyCompetitorWhitelist(parsed, whitelist);
      const withFinance = applyFinanceModelOverride(grounded, financeModel);
      logFullReportQuality(withFinance, `reportId=${input.reportId} n8n`);
      const out = input.skipDualVerify
        ? withFinance
        : await applyDualModelVerification(withFinance, {
            language: input.language,
            location: input.location,
            businessType: input.businessType,
            primaryProvider: 'n8n',
            reportSource: 'n8n',
          });
      return stripInternalIqReportFields(out);
    } catch (e) {
      console.warn('[iq-generate-full-report] n8n failed, falling back to in-app LLM:', e);
    }
  }

  const parsed = await runFullPremiumReport({
    location: input.location,
    businessType: input.businessType,
    headline: input.headline,
    reason: input.reason,
    marketData: input.marketData,
    language: input.language,
    leanGeneration: input.leanGeneration,
  });
  const withFinance = applyFinanceModelOverride(parsed, financeModel);
  logFullReportQuality(withFinance, `reportId=${input.reportId} llm`);
  const out = input.skipDualVerify
    ? withFinance
    : await applyDualModelVerification(withFinance, {
        language: input.language,
        location: input.location,
        businessType: input.businessType,
        primaryProvider:
          typeof parsed._generation_provider === 'string'
            ? parsed._generation_provider
            : undefined,
        primaryModel:
          typeof parsed._generation_model === 'string' ? parsed._generation_model : undefined,
        reportSource: 'llm',
      });
  return stripInternalIqReportFields(out);
}
