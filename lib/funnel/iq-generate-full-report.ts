/**
 * Single entry for paid LocationIQ full reports: n8n (if configured) → OpenAI fallback.
 * Keeps webhook URL resolution, analysis_id, and parse/quality logging consistent across
 * Stripe webhook, /api/funnel/full-report, and /iq/report/[id].
 */

import { generateFullReportWithN8n, getFullReportWebhookUrl } from '@/lib/n8n';
import { parseIqFullReport, logFullReportQuality } from '@/lib/funnel/iq-full-report-schema';
import { runFullPremiumReportOpenAI } from '@/lib/funnel/iq-llm';

export type GenerateIqFullReportInput = {
  reportId: string;
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData: Record<string, unknown> | undefined;
  language: 'en' | 'zh';
};

export async function generateIqFullReportWithN8nFallback(
  input: GenerateIqFullReportInput,
): Promise<Record<string, unknown>> {
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

  if (getFullReportWebhookUrl()) {
    try {
      const raw = await generateFullReportWithN8n(payload);
      const parsed = parseIqFullReport(raw);
      logFullReportQuality(parsed, `reportId=${input.reportId}`);
      return parsed;
    } catch (e) {
      console.warn('[iq-generate-full-report] n8n failed, falling back to OpenAI:', e);
    }
  }

  const parsed = await runFullPremiumReportOpenAI({
    location: input.location,
    businessType: input.businessType,
    headline: input.headline,
    reason: input.reason,
    marketData: input.marketData,
    language: input.language,
  });
  logFullReportQuality(parsed, `reportId=${input.reportId} openai-fallback`);
  return parsed;
}
