/**
 * Commercial Real Estate Listings Integration
 * 
 * Data sources:
 * - LoopNet via RapidAPI (requires LOOPNET_RAPIDAPI_KEY)
 * - Fallback: manual search instructions
 * 
 * Note: LoopNet does not offer a free public API. The RapidAPI integration
 * requires a paid subscription. Without the API key, this module provides
 * instructions for manual verification on LoopNet, CommercialCafe, and Crexi.
 */

const LOOPNET_RAPIDAPI_BASE = 'https://loopnet-api.p.rapidapi.com';

export interface CommercialListing {
  address: string;
  sqft: number | null;
  monthlyRent: number | null;
  pricePerSqft: number | null;
  propertyType: string;
  highlights: string[];
  sourceTag: string;
  listingUrl?: string;
}

export interface CommercialListingsResult {
  status: 'success' | 'no_api_key' | 'error';
  listings: CommercialListing[];
  searchInstructions?: string;
  apiSource?: string;
}

/**
 * Search for commercial listings near a location
 * Requires LOOPNET_RAPIDAPI_KEY environment variable
 */
export async function fetchCommercialListings(input: {
  city: string;
  state: string;
  propertyType?: string;
  maxResults?: number;
}): Promise<CommercialListingsResult> {
  const apiKey = process.env.LOOPNET_RAPIDAPI_KEY?.trim();
  
  if (!apiKey) {
    return {
      status: 'no_api_key',
      listings: [],
      searchInstructions: buildManualSearchInstructions(input.city, input.state, input.propertyType),
    };
  }

  try {
    const cityId = await findCityId(apiKey, input.city, input.state);
    if (!cityId) {
      return {
        status: 'error',
        listings: [],
        searchInstructions: buildManualSearchInstructions(input.city, input.state, input.propertyType),
      };
    }

    const listings = await searchListingsByCity(
      apiKey,
      cityId,
      input.propertyType || 'retail',
      input.maxResults || 10
    );

    return {
      status: 'success',
      listings,
      apiSource: 'LoopNet via RapidAPI',
    };
  } catch (e) {
    console.warn('[commercial-listings] API error:', e);
    return {
      status: 'error',
      listings: [],
      searchInstructions: buildManualSearchInstructions(input.city, input.state, input.propertyType),
    };
  }
}

async function findCityId(apiKey: string, city: string, state: string): Promise<string | null> {
  try {
    const response = await fetch(`${LOOPNET_RAPIDAPI_BASE}/findCity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'loopnet-api.p.rapidapi.com',
      },
      body: JSON.stringify({ city, state }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { cityId?: string };
    return data.cityId || null;
  } catch {
    return null;
  }
}

async function searchListingsByCity(
  apiKey: string,
  cityId: string,
  propertyType: string,
  maxResults: number
): Promise<CommercialListing[]> {
  try {
    const response = await fetch(`${LOOPNET_RAPIDAPI_BASE}/searchByCity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'loopnet-api.p.rapidapi.com',
      },
      body: JSON.stringify({
        cityId,
        propertyType,
        maxResults,
        status: 'forLease',
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return [];
    
    const data = (await response.json()) as {
      listings?: Array<{
        address?: string;
        size?: number;
        price?: number;
        pricePerSqft?: number;
        type?: string;
        features?: string[];
        url?: string;
      }>;
    };

    return (data.listings || []).map((l) => ({
      address: l.address || 'Unknown',
      sqft: l.size || null,
      monthlyRent: l.price || null,
      pricePerSqft: l.pricePerSqft || null,
      propertyType: l.type || propertyType,
      highlights: l.features || [],
      sourceTag: '[LoopNet]',
      listingUrl: l.url,
    }));
  } catch {
    return [];
  }
}

function buildManualSearchInstructions(city: string, state: string, propertyType?: string): string {
  const type = propertyType || 'retail restaurant';
  return `
**Manual Commercial Listing Search Required**

No LoopNet API key configured. Search these platforms manually:

1. **LoopNet** - https://www.loopnet.com/search/${type.replace(/\s+/g, '-')}-space/${city.toLowerCase()}-${state.toLowerCase()}/for-lease/
2. **CommercialCafe** - https://www.commercialcafe.com/${city.toLowerCase()}-${state.toLowerCase()}/${type.replace(/\s+/g, '-')}-for-lease/
3. **Crexi** - https://www.crexi.com/properties/lease/${state.toLowerCase()}/${city.toLowerCase().replace(/\s+/g, '-')}

Search filters:
- Property Type: ${type}
- Transaction: For Lease
- Size: 800-2,500 sqft (typical restaurant)

When adding listings to the report, use format:
- Address: [full address]
- Size: [X] sqft
- Monthly Rent: $[X]/month
- Source: [LoopNet]/[CommercialCafe]/[Crexi]/[needs site visit]
`.trim();
}

/**
 * Format commercial listings for inclusion in market data anchors
 */
export function formatListingsForAnchors(
  result: CommercialListingsResult,
  lang: 'en' | 'zh' = 'en'
): string {
  const L = lang === 'zh';
  const lines: string[] = [];

  if (result.status === 'no_api_key' || result.status === 'error') {
    if (result.searchInstructions) {
      lines.push(L ? '### 商业房源（需手动搜索）' : '### Commercial Listings (Manual Search Required)');
      lines.push(result.searchInstructions);
    }
    return lines.join('\n');
  }

  if (!result.listings.length) {
    return L
      ? '### 商业房源\n> 未找到符合条件的房源 [LoopNet]'
      : '### Commercial Listings\n> No matching listings found [LoopNet]';
  }

  lines.push(L ? '### 商业房源 [LoopNet]' : '### Commercial Listings [LoopNet]');
  lines.push(L ? '> 数据来源: LoopNet API' : '> Source: LoopNet API');
  lines.push('');
  lines.push(L ? '| 地址 | 面积 | 月租 | 每平方英尺 |' : '| Address | Size | Monthly Rent | $/sqft |');
  lines.push('|------|------|------|------------|');

  result.listings.slice(0, 8).forEach((l) => {
    const sqft = l.sqft ? `${l.sqft.toLocaleString()} sqft` : '-';
    const rent = l.monthlyRent ? `$${l.monthlyRent.toLocaleString()}/mo` : '-';
    const psf = l.pricePerSqft ? `$${l.pricePerSqft.toFixed(2)}/sqft` : '-';
    lines.push(`| ${l.address} | ${sqft} | ${rent} | ${psf} |`);
  });

  return lines.join('\n');
}
