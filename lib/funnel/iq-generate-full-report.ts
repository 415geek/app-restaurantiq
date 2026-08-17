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
import { DUAL_VERIFY_MIN_BUDGET_MS, type IqDeadline } from '@/lib/funnel/iq-deadline';
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
  /** Full market enrich + single thorough LLM pass (use on force / professional regen). */
  qualityMode?: boolean;
  /** Hard budget for LLM generation, from the pipeline deadline. */
  timeoutMs?: number;
  /** Pipeline deadline — dual verify is skipped when too little time remains. */
  deadline?: IqDeadline;
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

  // Dual verification is an optional quality pass — never let it push the
  // request past the serverless limit and turn a finished report into a timeout.
  const skipVerify =
    input.skipDualVerify ||
    (input.deadline ? !input.deadline.hasBudget(DUAL_VERIFY_MIN_BUDGET_MS) : false);
  if (!input.skipDualVerify && skipVerify) {
    console.warn('[iq-generate-full-report] skipping dual verify: insufficient time budget');
  }

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
      const out = skipVerify
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
    timeoutMs: input.timeoutMs,
  });
  const withFinance = applyFinanceModelOverride(parsed, financeModel);
  logFullReportQuality(withFinance, `reportId=${input.reportId} llm`);
  const out = skipVerify
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
