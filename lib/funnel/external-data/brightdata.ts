/**
 * Bright Data MCP API Integration
 * 
 * Provides enhanced web scraping and structured data extraction for:
 * - Google search results (SERP)
 * - Zillow real estate listings
 * - Google Maps reviews
 * - LinkedIn company profiles
 * - Crunchbase company data
 * - General web scraping as markdown
 * 
 * @see https://docs.brightdata.com/mcp-server/tools
 */

const BRIGHTDATA_MCP_BASE = 'https://mcp.brightdata.com';

type BrightDataTool = 
  | 'search_engine'
  | 'scrape_as_markdown'
  | 'scrape_batch'
  | 'extract'
  | 'web_data_zillow_properties_listing'
  | 'web_data_google_maps_reviews'
  | 'web_data_linkedin_company_profile'
  | 'web_data_crunchbase_company'
  | 'web_data_yahoo_finance_business';

interface BrightDataResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function callBrightDataTool<T = unknown>(
  tool: BrightDataTool,
  params: Record<string, unknown>
): Promise<BrightDataResponse<T>> {
  const token = process.env.BRIGHTDATA_API_TOKEN?.trim();
  if (!token) {
    return { success: false, error: 'BRIGHTDATA_API_TOKEN not configured' };
  }

  try {
    const response = await fetch(`${BRIGHTDATA_MCP_BASE}/tool/${tool}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`[brightdata] ${tool} error:`, response.status, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as T;
    return { success: true, data };
  } catch (e) {
    console.warn(`[brightdata] ${tool} fetch error:`, e);
    return { success: false, error: String(e) };
  }
}

// ============ Google Search ============

export interface GoogleSearchResult {
  title: string;
  url: string;
  description: string;
  position: number;
}

export interface GoogleSearchResponse {
  results: GoogleSearchResult[];
  query: string;
  total_results?: number;
}

export async function searchGoogle(
  query: string,
  options?: { num_results?: number; country?: string }
): Promise<GoogleSearchResponse | null> {
  const res = await callBrightDataTool<{ organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    position?: number;
  }> }>('search_engine', {
    query,
    engine: 'google',
    num_results: options?.num_results || 10,
    country: options?.country || 'us',
  });

  if (!res.success || !res.data) return null;

  const organic = res.data.organic_results || [];
  return {
    query,
    results: organic.map((r, i) => ({
      title: r.title || '',
      url: r.link || '',
      description: r.snippet || '',
      position: r.position || i + 1,
    })),
  };
}

// ============ Web Scraping ============

export async function scrapeAsMarkdown(url: string): Promise<string | null> {
  const res = await callBrightDataTool<{ content?: string; markdown?: string }>('scrape_as_markdown', { url });
  if (!res.success || !res.data) return null;
  return res.data.markdown || res.data.content || null;
}

export async function scrapeBatch(urls: string[]): Promise<Array<{ url: string; content: string }>> {
  const res = await callBrightDataTool<Array<{ url?: string; content?: string }>>('scrape_batch', { 
    urls: urls.slice(0, 10) 
  });
  if (!res.success || !Array.isArray(res.data)) return [];
  return res.data.map((r) => ({
    url: r.url || '',
    content: r.content || '',
  }));
}

// ============ Zillow Real Estate ============

export interface ZillowListing {
  address: string;
  price: number | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  property_type: string;
  zestimate: number | null;
  url: string;
}

export async function fetchZillowListing(url: string): Promise<ZillowListing | null> {
  const res = await callBrightDataTool<{
    address?: string;
    price?: number;
    livingArea?: number;
    bedrooms?: number;
    bathrooms?: number;
    homeType?: string;
    zestimate?: number;
    url?: string;
  }>('web_data_zillow_properties_listing', { url });

  if (!res.success || !res.data) return null;
  const d = res.data;
  return {
    address: d.address || '',
    price: d.price || null,
    sqft: d.livingArea || null,
    bedrooms: d.bedrooms || null,
    bathrooms: d.bathrooms || null,
    property_type: d.homeType || 'unknown',
    zestimate: d.zestimate || null,
    url: d.url || url,
  };
}

// ============ Google Maps Reviews ============

export interface GoogleMapsReview {
  author: string;
  rating: number;
  text: string;
  date: string;
}

export interface GoogleMapsReviewsResponse {
  place_name: string;
  rating: number;
  review_count: number;
  reviews: GoogleMapsReview[];
}

export async function fetchGoogleMapsReviews(
  url: string,
  options?: { days_limit?: number }
): Promise<GoogleMapsReviewsResponse | null> {
  const res = await callBrightDataTool<{
    name?: string;
    rating?: number;
    reviewCount?: number;
    reviews?: Array<{
      author?: string;
      rating?: number;
      text?: string;
      date?: string;
    }>;
  }>('web_data_google_maps_reviews', {
    url,
    days_limit: options?.days_limit || 30,
  });

  if (!res.success || !res.data) return null;
  const d = res.data;
  return {
    place_name: d.name || '',
    rating: d.rating || 0,
    review_count: d.reviewCount || 0,
    reviews: (d.reviews || []).map((r) => ({
      author: r.author || 'Anonymous',
      rating: r.rating || 0,
      text: r.text || '',
      date: r.date || '',
    })),
  };
}

// ============ LinkedIn Company ============

export interface LinkedInCompany {
  name: string;
  industry: string;
  company_size: string;
  headquarters: string;
  founded: string;
  specialties: string[];
  description: string;
  url: string;
}

export async function fetchLinkedInCompany(url: string): Promise<LinkedInCompany | null> {
  const res = await callBrightDataTool<{
    name?: string;
    industry?: string;
    companySize?: string;
    headquarters?: string;
    founded?: string;
    specialties?: string[];
    description?: string;
    url?: string;
  }>('web_data_linkedin_company_profile', { url });

  if (!res.success || !res.data) return null;
  const d = res.data;
  return {
    name: d.name || '',
    industry: d.industry || '',
    company_size: d.companySize || '',
    headquarters: d.headquarters || '',
    founded: d.founded || '',
    specialties: d.specialties || [],
    description: d.description || '',
    url: d.url || url,
  };
}

// ============ Crunchbase Company ============

export interface CrunchbaseCompany {
  name: string;
  short_description: string;
  funding_total: string;
  funding_rounds: number;
  last_funding_date: string;
  employee_count: string;
  headquarters: string;
  industries: string[];
  url: string;
}

export async function fetchCrunchbaseCompany(url: string): Promise<CrunchbaseCompany | null> {
  const res = await callBrightDataTool<{
    name?: string;
    shortDescription?: string;
    fundingTotal?: string;
    fundingRounds?: number;
    lastFundingDate?: string;
    employeeCount?: string;
    headquarters?: string;
    industries?: string[];
    url?: string;
  }>('web_data_crunchbase_company', { url });

  if (!res.success || !res.data) return null;
  const d = res.data;
  return {
    name: d.name || '',
    short_description: d.shortDescription || '',
    funding_total: d.fundingTotal || '',
    funding_rounds: d.fundingRounds || 0,
    last_funding_date: d.lastFundingDate || '',
    employee_count: d.employeeCount || '',
    headquarters: d.headquarters || '',
    industries: d.industries || [],
    url: d.url || url,
  };
}

// ============ Yahoo Finance ============

export interface YahooFinanceCompany {
  name: string;
  symbol: string;
  market_cap: string;
  revenue: string;
  employees: number;
  industry: string;
  sector: string;
  description: string;
}

export async function fetchYahooFinance(url: string): Promise<YahooFinanceCompany | null> {
  const res = await callBrightDataTool<{
    name?: string;
    symbol?: string;
    marketCap?: string;
    revenue?: string;
    employees?: number;
    industry?: string;
    sector?: string;
    description?: string;
  }>('web_data_yahoo_finance_business', { url });

  if (!res.success || !res.data) return null;
  const d = res.data;
  return {
    name: d.name || '',
    symbol: d.symbol || '',
    market_cap: d.marketCap || '',
    revenue: d.revenue || '',
    employees: d.employees || 0,
    industry: d.industry || '',
    sector: d.sector || '',
    description: d.description || '',
  };
}

// ============ Structured Data Extraction ============

export async function extractStructuredData<T = Record<string, unknown>>(
  url: string,
  extractionPrompt: string
): Promise<T | null> {
  const res = await callBrightDataTool<T>('extract', {
    url,
    prompt: extractionPrompt,
  });
  return res.success ? res.data || null : null;
}

// ============ Enhanced Market Research ============

export interface MarketResearchResult {
  search_results: GoogleSearchResult[];
  competitor_reviews?: GoogleMapsReviewsResponse;
  real_estate_data?: ZillowListing[];
  web_content?: string;
}

/**
 * Comprehensive market research for a location using Bright Data
 */
export async function conductMarketResearch(input: {
  location: string;
  businessType: string;
  competitorUrls?: string[];
  zillowUrls?: string[];
}): Promise<MarketResearchResult> {
  const result: MarketResearchResult = { search_results: [] };

  // 1. Google search for market context
  const searchQuery = `${input.businessType} ${input.location} restaurant market analysis`;
  const searchRes = await searchGoogle(searchQuery, { num_results: 10 });
  if (searchRes) {
    result.search_results = searchRes.results;
  }

  // 2. Fetch competitor reviews if URLs provided
  if (input.competitorUrls?.length) {
    const firstUrl = input.competitorUrls[0];
    if (firstUrl.includes('google.com/maps')) {
      const reviews = await fetchGoogleMapsReviews(firstUrl);
      if (reviews) {
        result.competitor_reviews = reviews;
      }
    }
  }

  // 3. Fetch Zillow data if URLs provided
  if (input.zillowUrls?.length) {
    const listings: ZillowListing[] = [];
    for (const url of input.zillowUrls.slice(0, 3)) {
      const listing = await fetchZillowListing(url);
      if (listing) listings.push(listing);
    }
    if (listings.length) {
      result.real_estate_data = listings;
    }
  }

  return result;
}

/**
 * Format Bright Data results for inclusion in market data anchors
 */
export function formatBrightDataForAnchors(
  data: MarketResearchResult,
  lang: 'en' | 'zh' = 'en'
): string {
  const L = lang === 'zh';
  const lines: string[] = [];

  if (data.search_results.length > 0) {
    lines.push(L ? '### 网络搜索结果 [BrightData]' : '### Web Search Results [BrightData]');
    data.search_results.slice(0, 5).forEach((r, i) => {
      lines.push(`${i + 1}. **${r.title}**`);
      lines.push(`   ${r.description}`);
      lines.push(`   [${r.url}]`);
    });
    lines.push('');
  }

  if (data.competitor_reviews) {
    const cr = data.competitor_reviews;
    lines.push(L ? '### 竞品评价分析 [BrightData/Google Maps]' : '### Competitor Reviews [BrightData/Google Maps]');
    lines.push(`**${cr.place_name}**: ${cr.rating}⭐ (${cr.review_count} ${L ? '条评价' : 'reviews'})`);
    if (cr.reviews.length > 0) {
      lines.push(L ? '近期评价摘要:' : 'Recent review highlights:');
      cr.reviews.slice(0, 3).forEach((r) => {
        lines.push(`- "${r.text.slice(0, 100)}${r.text.length > 100 ? '...' : ''}" — ${r.author}, ${r.rating}⭐`);
      });
    }
    lines.push('');
  }

  if (data.real_estate_data?.length) {
    lines.push(L ? '### 房产数据 [BrightData/Zillow]' : '### Real Estate Data [BrightData/Zillow]');
    data.real_estate_data.forEach((l) => {
      const price = l.price ? `$${l.price.toLocaleString()}` : 'N/A';
      const sqft = l.sqft ? `${l.sqft.toLocaleString()} sqft` : 'N/A';
      lines.push(`- **${l.address}**: ${price}, ${sqft}, ${l.property_type}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
