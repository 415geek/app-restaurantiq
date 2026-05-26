/**
 * Ensures paid-report generation always receives rich market_data when keys exist:
 * - Google Places pack when summary/competitors are missing (common n8n-analyze gap)
 * - Optional Tavily web_research (TAVILY_API_KEY) once per row unless already present
 * - For premium reports: Tavily Deep Research for comprehensive McKinsey-style analysis
 * - Caltrans traffic data (California state highways only)
 * - Commercial real estate listings (requires LOOPNET_RAPIDAPI_KEY)
 * - Bright Data enhanced web scraping (requires BRIGHTDATA_API_TOKEN)
 */

import { enrichMarketDataWithAcs } from '@/lib/funnel/iq-acs-enrichment';
import { enrichMarketDataWithDemographicNarrative } from '@/lib/funnel/iq-demographic-narrative';
import { gatherIqMarketDataFromGoogle } from '@/lib/funnel/iq-market-data';
import { extractMarketSummary } from '@/lib/funnel/iq-premium-anchors';
import {
  fetchTavilyMarketResearch,
  fetchTavilyDeepResearch,
  type DeepResearchPack,
} from '@/lib/funnel/iq-web-research';
import { fetchCaltransTrafficByLocation, type CaltransAADTResult } from '@/lib/funnel/external-data/caltrans';
import { fetchCommercialListings, type CommercialListingsResult } from '@/lib/funnel/external-data/commercial-listings';
import { conductMarketResearch, type MarketResearchResult } from '@/lib/funnel/external-data/brightdata';

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractCityFromLocation(location: string): string | null {
  const parts = location.split(',').map((p) => p.trim());
  if (parts.length >= 2) {
    return parts[parts.length - 2] || parts[0];
  }
  const words = location.split(/\s+/);
  if (words.length >= 2) {
    const lastTwoWords = words.slice(-2).join(' ');
    if (/san\s+francisco|los\s+angeles|new\s+york/i.test(lastTwoWords)) {
      return lastTwoWords;
    }
  }
  return null;
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
    try {
      base = await enrichMarketDataWithDemographicNarrative(base, {
        cuisine: businessType,
        address: location,
      });
    } catch (err) {
      console.warn('[resolve-market-data] demographic narrative enrichment failed', err);
    }
  }

  if (isPremium) {
    const existingDeep = base.deep_research as DeepResearchPack | undefined;
    const hasCompletedDeepResearch =
      existingDeep &&
      typeof existingDeep === 'object' &&
      existingDeep.status === 'completed';
    
    const shouldRetryDeep = existingDeep?.status === 'timeout' || existingDeep?.status === 'failed';
    if (shouldRetryDeep) {
      console.log('[resolve-market-data] previous deep research failed, will retry');
    }

    if (!hasCompletedDeepResearch) {
      console.log('[resolve-market-data] fetching Tavily Deep Research (pro model) for premium report...');
      const deepRes = await fetchTavilyDeepResearch({
        location,
        businessType: businessType || 'restaurant',
        lang,
        model: 'pro', // Use pro model for higher quality analysis
      });
      if (deepRes) {
        base = { ...base, deep_research: deepRes };
        console.log('[resolve-market-data] deep research status:', deepRes.status, 'time:', deepRes.response_time_sec, 's');
        
        if (deepRes.status !== 'completed') {
          console.log('[resolve-market-data] deep research did not complete, ensuring web_research fallback...');
        }
      }
    } else {
      console.log('[resolve-market-data] deep_research already present, skipping');
    }

    // Fetch Caltrans traffic data if geocode available and in California
    const geo = base.geocode as { lat?: number; lng?: number; state?: string } | undefined;
    if (geo?.lat && geo?.lng && !base.caltrans_traffic) {
      const stateStr = String(geo.state || '').toLowerCase();
      if (stateStr.includes('california') || stateStr === 'ca') {
        console.log('[resolve-market-data] fetching Caltrans traffic data...');
        const caltransData = await fetchCaltransTrafficByLocation(geo.lat, geo.lng, 2);
        if (caltransData.length > 0) {
          base = { ...base, caltrans_traffic: caltransData };
          console.log('[resolve-market-data] caltrans data:', caltransData.length, 'highway segments found');
        }
      }
    }

    // Fetch commercial listings if not already present
    if (!base.commercial_listings) {
      const geoObj = base.geocode as { city?: string; state?: string } | undefined;
      const city = geoObj?.city || extractCityFromLocation(location);
      const state = geoObj?.state || 'CA';
      if (city) {
        console.log('[resolve-market-data] fetching commercial listings for', city, state);
        const listingsResult = await fetchCommercialListings({
          city,
          state,
          propertyType: 'retail restaurant',
          maxResults: 10,
        });
        base = { ...base, commercial_listings: listingsResult };
        console.log('[resolve-market-data] commercial listings status:', listingsResult.status);
      }
    }

    // Bright Data enhanced market research (if API token configured)
    if (!base.brightdata_research && process.env.BRIGHTDATA_API_TOKEN) {
      console.log('[resolve-market-data] fetching Bright Data enhanced research...');
      try {
        const bdResearch = await conductMarketResearch({
          location,
          businessType: businessType || 'restaurant',
        });
        if (bdResearch.search_results.length > 0 || bdResearch.competitor_reviews || bdResearch.real_estate_data) {
          base = { ...base, brightdata_research: bdResearch };
          console.log('[resolve-market-data] Bright Data research:', 
            bdResearch.search_results.length, 'search results,',
            bdResearch.competitor_reviews ? '1 competitor review set' : 'no reviews',
            bdResearch.real_estate_data?.length || 0, 'real estate listings'
          );
        }
      } catch (e) {
        console.warn('[resolve-market-data] Bright Data error:', e);
      }
    }
  }

  const deepStatus = (base.deep_research as DeepResearchPack | undefined)?.status;
  const needsWebFallback = isPremium && deepStatus !== 'completed';
  const hasWeb = base.web_research && typeof base.web_research === 'object';
  
  if (!hasWeb || needsWebFallback) {
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
