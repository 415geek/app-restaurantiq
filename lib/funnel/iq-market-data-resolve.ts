/**
 * Ensures paid-report generation always receives rich market_data when keys exist:
 * - Google Places pack when summary/competitors are missing (common n8n-analyze gap)
 * - Optional Tavily web_research (TAVILY_API_KEY) once per row unless already present
 * - For premium reports: Tavily Deep Research for comprehensive McKinsey-style analysis
 */

import { enrichMarketDataWithAcs } from '@/lib/funnel/iq-acs-enrichment';
import { gatherIqMarketDataFromGoogle } from '@/lib/funnel/iq-market-data';
import { extractMarketSummary } from '@/lib/funnel/iq-premium-anchors';
import {
  fetchTavilyMarketResearch,
  fetchTavilyDeepResearch,
  type DeepResearchPack,
} from '@/lib/funnel/iq-web-research';

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function needsGooglePlacesEnrichment(marketData: Record<string, unknown> | null | undefined): boolean {
  if (!marketData || Object.keys(marketData).length === 0) return true;
  const s = extractMarketSummary(marketData);
  if (!s) return true;
  const ng = num(s.competitor_count_google);
  const ny = num(s.competitor_count_yelp);
  const g = Array.isArray(s.sample_competitors_google) ? s.sample_competitors_google : [];
  const named = g.some(
    (row) =>
      row &&
      typeof row === 'object' &&
      String((row as Record<string, unknown>).name ?? '').trim().length > 0,
  );
  const n = Math.max(ng ?? 0, ny ?? 0);
  if (n <= 0 && !named) return true;
  return false;
}

function mergeGoogleOntoExisting(
  existing: Record<string, unknown>,
  google: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existing,
    ...google,
    summary: google.summary ?? existing.summary,
    geocode: google.geocode ?? existing.geocode,
    google_raw: google.google_raw,
    yelp_raw: existing.yelp_raw ?? google.yelp_raw,
    external_data: existing.external_data,
    web_research: existing.web_research,
    deep_research: existing.deep_research,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Returns enriched market_data (may be null if nothing could be gathered).
 * Persists are done by callers via iqUpdateMarketDataJson when desired.
 *
 * @param isPremium - If true, triggers Tavily Deep Research for comprehensive analysis
 * @param lang - Language preference for deep research prompts ('en' or 'zh')
 */
export async function resolveMarketDataForIqReport(input: {
  existing: Record<string, unknown> | null | undefined;
  location: string;
  businessType: string;
  isPremium?: boolean;
  lang?: 'en' | 'zh';
}): Promise<Record<string, unknown> | null> {
  const { location, businessType, isPremium = false, lang = 'en' } = input;
  let base: Record<string, unknown> =
    input.existing && typeof input.existing === 'object' && !Array.isArray(input.existing)
      ? { ...input.existing }
      : {};

  if (needsGooglePlacesEnrichment(base)) {
    const google = await gatherIqMarketDataFromGoogle({
      location,
      businessType: businessType || 'restaurant',
    });
    if (google && Object.keys(google).length > 0) {
      base = Object.keys(base).length === 0 ? { ...google } : mergeGoogleOntoExisting(base, google);
    }
  }

  base = await enrichMarketDataWithAcs(base);

  if (isPremium) {
    const hasDeepResearch =
      base.deep_research &&
      typeof base.deep_research === 'object' &&
      (base.deep_research as DeepResearchPack).status === 'completed';

    if (!hasDeepResearch) {
      console.log('[resolve-market-data] fetching Tavily Deep Research for premium report...');
      const deepRes = await fetchTavilyDeepResearch({
        location,
        businessType: businessType || 'restaurant',
        lang,
        model: 'mini',
      });
      if (deepRes) {
        base = { ...base, deep_research: deepRes };
        console.log('[resolve-market-data] deep research status:', deepRes.status, 'time:', deepRes.response_time_sec, 's');
      }
    } else {
      console.log('[resolve-market-data] deep_research already present, skipping');
    }
  }

  const hasWeb = base.web_research && typeof base.web_research === 'object';
  if (!hasWeb) {
    const tavily = await fetchTavilyMarketResearch({
      location,
      businessType: businessType || 'restaurant',
    });
    if (tavily) {
      base = { ...base, web_research: tavily };
    }
  }

  if (!base || Object.keys(base).length === 0) return null;
  return base;
}
