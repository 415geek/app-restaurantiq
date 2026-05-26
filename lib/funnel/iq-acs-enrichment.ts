/**
 * US Census ACS 5-year (public API, no key) — tract + county context for IQ paid prompts.
 * Non-US / geocode failures → no-op.
 */

const ACS_VARS = 'NAME,B01003_001E,B19013_001E,B19301_001E,B01002_001E,B25077_001E';
const ACS_YEARS = ['2023', '2022'] as const;

function parseAcsMetric(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

function isProbablyUs(lat: number, lng: number): boolean {
  return lat >= 24 && lat <= 50 && lng >= -125 && lng <= -65;
}

async function fccBlockFips(lat: number, lng: number): Promise<string | null> {
  try {
    const fccUrl = new URL('https://geo.fcc.gov/api/census/area');
    fccUrl.searchParams.set('lat', String(lat));
    fccUrl.searchParams.set('lon', String(lng));
    fccUrl.searchParams.set('format', 'json');
    const fccRes = await fetch(fccUrl, { cache: 'no-store' });
    const fccData = (await fccRes.json().catch(() => ({}))) as {
      results?: Array<{ block_fips?: string }>;
    };
    const blockFips = Array.isArray(fccData?.results) ? fccData.results[0]?.block_fips : undefined;
    return typeof blockFips === 'string' && blockFips.length >= 11 ? blockFips : null;
  } catch {
    return null;
  }
}

type AcsRow = {
  name: string | null;
  population: number | null;
  median_household_income_usd: number | null;
  per_capita_income_usd: number | null;
  median_age: number | null;
  median_home_value_usd: number | null;
};

function rowFromAcsResponse(data: unknown): AcsRow | null {
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[0]) || !Array.isArray(data[1])) {
    return null;
  }
  const headers = data[0] as string[];
  const cells = data[1] as string[];
  const idx = (k: string) => headers.indexOf(k);
  const nameI = idx('NAME');
  const popI = idx('B01003_001E');
  const mhiI = idx('B19013_001E');
  const pciI = idx('B19301_001E');
  const ageI = idx('B01002_001E');
  const mhvI = idx('B25077_001E');
  return {
    name: nameI >= 0 ? String(cells[nameI] ?? '') || null : null,
    population: popI >= 0 ? parseAcsMetric(cells[popI]) : null,
    median_household_income_usd: mhiI >= 0 ? parseAcsMetric(cells[mhiI]) : null,
    per_capita_income_usd: pciI >= 0 ? parseAcsMetric(cells[pciI]) : null,
    median_age: ageI >= 0 ? parseAcsMetric(cells[ageI]) : null,
    median_home_value_usd: mhvI >= 0 ? parseAcsMetric(cells[mhvI]) : null,
  };
}

async function fetchAcsYear(
  year: string,
  kind: 'tract' | 'county',
  state: string,
  county: string,
  tract: string,
): Promise<AcsRow | null> {
  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set('get', ACS_VARS);
  if (kind === 'tract') {
    url.searchParams.set('for', `tract:${tract}`);
    url.searchParams.set('in', `state:${state} county:${county}`);
  } else {
    url.searchParams.set('for', `county:${county}`);
    url.searchParams.set('in', `state:${state}`);
  }
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    return rowFromAcsResponse(json);
  } catch {
    return null;
  }
}

export type AcsContextShape = {
  source: 'us_census_acs5';
  acs_year: string;
  block_fips: string;
  state_fips: string;
  county_fips: string;
  tract_code: string;
  tract_data_available: boolean;
  tract: AcsRow;
  county: AcsRow;
  citation_en: string;
  citation_zh: string;
};

const emptyAcsRow: AcsRow = {
  name: null,
  population: null,
  median_household_income_usd: null,
  per_capita_income_usd: null,
  median_age: null,
  median_home_value_usd: null,
};

export async function buildAcsContextForLatLng(lat: number, lng: number): Promise<AcsContextShape | null> {
  if (!isProbablyUs(lat, lng)) return null;
  const blockFips = await fccBlockFips(lat, lng);
  if (!blockFips) return null;
  const state = blockFips.slice(0, 2);
  const county = blockFips.slice(2, 5);
  const tract = blockFips.slice(5, 11);

  for (const year of ACS_YEARS) {
    const [tractRow, countyRow] = await Promise.all([
      fetchAcsYear(year, 'tract', state, county, tract),
      fetchAcsYear(year, 'county', state, county, tract),
    ]);
    if (!countyRow) continue;
    const tractOk = Boolean(
      tractRow &&
        (tractRow.population != null ||
          tractRow.median_household_income_usd != null ||
          tractRow.per_capita_income_usd != null),
    );
    return {
      source: 'us_census_acs5',
      acs_year: year,
      block_fips: blockFips,
      state_fips: state,
      county_fips: county,
      tract_code: tract,
      tract_data_available: tractOk,
      tract: tractOk && tractRow ? tractRow : { ...emptyAcsRow },
      county: countyRow,
      citation_en: `U.S. Census Bureau ACS ${year} 5-year (tract & county); variables B01003, B19013, B19301, B01002, B25077.`,
      citation_zh: `美国人口普查局 ACS ${year} 年 5 年估计（普查片区 Tract 与县 County）；指标 B01003 人口、B19013 家庭收入中位数、B19301 人均收入、B01002 年龄中位数、B25077 自有住房价值中位数。`,
    };
  }
  return null;
}

/**
 * Attach `acs_context` when `geocode.lat` / `geocode.lng` exist (e.g. after Google pack).
 */
export async function enrichMarketDataWithAcs(
  marketData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const geo = marketData.geocode;
  if (!geo || typeof geo !== 'object') return marketData;
  const o = geo as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return marketData;
  if (marketData.acs_context && typeof marketData.acs_context === 'object') return marketData;

  const acs = await buildAcsContextForLatLng(lat, lng);
  if (!acs) return marketData;
  return { ...marketData, acs_context: acs };
}
