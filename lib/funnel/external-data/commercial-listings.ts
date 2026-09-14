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
import { DEFAULT_LOCALE, type Locale, pick } from '@/lib/i18n/locale';

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
  lang: Locale = DEFAULT_LOCALE,
): string {
  const lines: string[] = [];

  if (result.status === 'no_api_key' || result.status === 'error') {
    if (result.searchInstructions) {
      lines.push(
        pick(lang, {
          en: '### Commercial Listings (Manual Search Required)',
          zh: '### 商业房源（需手动搜索）',
          es: '### Locales comerciales (requiere búsqueda manual)',
        }),
      );
      lines.push(result.searchInstructions);
    }
    return lines.join('\n');
  }

  if (!result.listings.length) {
    return pick(lang, {
      en: '### Commercial Listings\n> No matching listings found [LoopNet]',
      zh: '### 商业房源\n> 未找到符合条件的房源 [LoopNet]',
      es: '### Locales comerciales\n> No se encontraron locales que coincidan [LoopNet]',
    });
  }

  lines.push(pick(lang, { en: '### Commercial Listings [LoopNet]', zh: '### 商业房源 [LoopNet]', es: '### Locales comerciales [LoopNet]' }));
  lines.push(pick(lang, { en: '> Source: LoopNet API', zh: '> 数据来源: LoopNet API', es: '> Fuente: API de LoopNet' }));
  lines.push('');
  lines.push(
    pick(lang, {
      en: '| Address | Size | Monthly Rent | $/sqft |',
      zh: '| 地址 | 面积 | 月租 | 每平方英尺 |',
      es: '| Dirección | Superficie | Renta mensual | $/pie² |',
    }),
  );
  lines.push('|------|------|------|------------|');

  result.listings.slice(0, 8).forEach((l) => {
    const sqft = l.sqft ? `${l.sqft.toLocaleString()} sqft` : '-';
    const rent = l.monthlyRent ? `$${l.monthlyRent.toLocaleString()}/mo` : '-';
    const psf = l.pricePerSqft ? `$${l.pricePerSqft.toFixed(2)}/sqft` : '-';
    lines.push(`| ${l.address} | ${sqft} | ${rent} | ${psf} |`);
  });

  return lines.join('\n');
}
