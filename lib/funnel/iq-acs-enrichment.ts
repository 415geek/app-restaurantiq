/**
 * US Census ACS 5-year (public API; CENSUS_API_KEY optional for higher rate limits)
 *   tract + county context for IQ paid prompts.
 *
 * As of D-3 (2026-05-26) this pulls a much wider variable set so paid reports never
 * need to write "亚裔比例: 数据抑制" — race/ethnicity, income brackets (purchasing
 * power), educational attainment, and median gross rent are all surfaced.
 *
 * Variable reference:
 *   B01003_001E  total population
 *   B01002_001E  median age
 *   B19013_001E  median household income (USD)
 *   B19301_001E  per-capita income (USD)
 *   B25077_001E  median owner-occupied home value (USD)
 *   B25064_001E  median gross rent (USD/mo)
 *   B03002_001E  total population in race+hispanic table (denominator)
 *   B03002_003E  White alone, not Hispanic or Latino
 *   B03002_004E  Black or African American alone, not Hispanic or Latino
 *   B03002_006E  Asian alone, not Hispanic or Latino
 *   B03002_012E  Hispanic or Latino (any race)
 *   B19001_001E  households (denominator for income brackets)
 *   B19001_014E  households $100k-$124,999
 *   B19001_015E  households $125k-$149,999
 *   B19001_016E  households $150k-$199,999
 *   B19001_017E  households $200k+
 *   B15003_001E  population 25y+ (denominator for education)
 *   B15003_022E  bachelor's degree
 *   B15003_023E  master's degree
 *   B15003_024E  professional school degree
 *   B15003_025E  doctorate degree
 *
 * Non-US / geocode failures → no-op.
 */

const ACS_CORE_VARS = [
  'NAME',
  'B01003_001E',
  'B19013_001E',
  'B19301_001E',
  'B01002_001E',
  'B25077_001E',
  'B25064_001E',
  'B03002_001E',
  'B03002_003E',
  'B03002_004E',
  'B03002_006E',
  'B03002_012E',
  'B19001_001E',
  'B19001_014E',
  'B19001_015E',
  'B19001_016E',
  'B19001_017E',
  'B15003_001E',
  'B15003_022E',
  'B15003_023E',
  'B15003_024E',
  'B15003_025E',
].join(',');

// Keep legacy name as alias so any external imports stay green.
const ACS_VARS = ACS_CORE_VARS;
void ACS_VARS;

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

type RaceEthnicityShare = {
  /** Whole-number percent (e.g. 23) of population. null if denominator missing. */
  pct: number | null;
  count: number | null;
};

type IncomeBrackets = {
  households_total: number | null;
  hh_100k_to_125k: number | null;
  hh_125k_to_150k: number | null;
  hh_150k_to_200k: number | null;
  hh_200k_plus: number | null;
  /** Whole-number percent of households >= $100k. */
  pct_100k_plus: number | null;
  /** Whole-number percent of households >= $200k. */
  pct_200k_plus: number | null;
};

type Education = {
  pop_25_plus: number | null;
  bachelors_plus_count: number | null;
  /** Whole-number percent (Bachelor's + grad+pro degrees) of pop 25+. */
  bachelors_plus_pct: number | null;
};

type AcsRow = {
  name: string | null;
  population: number | null;
  median_household_income_usd: number | null;
  per_capita_income_usd: number | null;
  median_age: number | null;
  median_home_value_usd: number | null;
  median_gross_rent_usd: number | null;
  race_ethnicity: {
    denominator: number | null;
    white_nh: RaceEthnicityShare;
    black_nh: RaceEthnicityShare;
    asian_nh: RaceEthnicityShare;
    hispanic_any_race: RaceEthnicityShare;
  };
  income_brackets: IncomeBrackets;
  education: Education;
};

function pctOf(num: number | null, denom: number | null): number | null {
  if (num == null || denom == null) return null;
  if (denom <= 0) return null;
  const p = (num / denom) * 100;
  if (!Number.isFinite(p)) return null;
  return Math.round(p);
}

function rowFromAcsResponse(data: unknown): AcsRow | null {
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[0]) || !Array.isArray(data[1])) {
    return null;
  }
  const headers = data[0] as string[];
  const cells = data[1] as string[];
  const idx = (k: string) => headers.indexOf(k);
  const cellNum = (key: string): number | null => {
    const i = idx(key);
    return i >= 0 ? parseAcsMetric(cells[i]) : null;
  };
  const nameI = idx('NAME');

  const denomRace = cellNum('B03002_001E');
  const whiteNh = cellNum('B03002_003E');
  const blackNh = cellNum('B03002_004E');
  const asianNh = cellNum('B03002_006E');
  const hispanic = cellNum('B03002_012E');

  const householdsTotal = cellNum('B19001_001E');
  const hh100 = cellNum('B19001_014E');
  const hh125 = cellNum('B19001_015E');
  const hh150 = cellNum('B19001_016E');
  const hh200 = cellNum('B19001_017E');
  const hh100plus =
    hh100 != null || hh125 != null || hh150 != null || hh200 != null
      ? (hh100 ?? 0) + (hh125 ?? 0) + (hh150 ?? 0) + (hh200 ?? 0)
      : null;

  const pop25 = cellNum('B15003_001E');
  const bach = cellNum('B15003_022E');
  const mast = cellNum('B15003_023E');
  const prof = cellNum('B15003_024E');
  const doc = cellNum('B15003_025E');
  const bachPlus =
    bach != null || mast != null || prof != null || doc != null
      ? (bach ?? 0) + (mast ?? 0) + (prof ?? 0) + (doc ?? 0)
      : null;

  return {
    name: nameI >= 0 ? String(cells[nameI] ?? '') || null : null,
    population: cellNum('B01003_001E'),
    median_household_income_usd: cellNum('B19013_001E'),
    per_capita_income_usd: cellNum('B19301_001E'),
    median_age: cellNum('B01002_001E'),
    median_home_value_usd: cellNum('B25077_001E'),
    median_gross_rent_usd: cellNum('B25064_001E'),
    race_ethnicity: {
      denominator: denomRace,
      white_nh: { count: whiteNh, pct: pctOf(whiteNh, denomRace) },
      black_nh: { count: blackNh, pct: pctOf(blackNh, denomRace) },
      asian_nh: { count: asianNh, pct: pctOf(asianNh, denomRace) },
      hispanic_any_race: { count: hispanic, pct: pctOf(hispanic, denomRace) },
    },
    income_brackets: {
      households_total: householdsTotal,
      hh_100k_to_125k: hh100,
      hh_125k_to_150k: hh125,
      hh_150k_to_200k: hh150,
      hh_200k_plus: hh200,
      pct_100k_plus: pctOf(hh100plus, householdsTotal),
      pct_200k_plus: pctOf(hh200, householdsTotal),
    },
    education: {
      pop_25_plus: pop25,
      bachelors_plus_count: bachPlus,
      bachelors_plus_pct: pctOf(bachPlus, pop25),
    },
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
  url.searchParams.set('get', ACS_CORE_VARS);
  if (kind === 'tract') {
    url.searchParams.set('for', `tract:${tract}`);
    url.searchParams.set('in', `state:${state} county:${county}`);
  } else {
    url.searchParams.set('for', `county:${county}`);
    url.searchParams.set('in', `state:${state}`);
  }
  const apiKey = process.env.CENSUS_API_KEY?.trim();
  if (apiKey) url.searchParams.set('key', apiKey);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(
        '[iq-acs] %s %s/%s/%s HTTP %d',
        kind,
        state,
        county,
        kind === 'tract' ? tract : '-',
        res.status,
      );
      return null;
    }
    const json = await res.json().catch(() => null);
    return rowFromAcsResponse(json);
  } catch (err) {
    console.warn('[iq-acs] fetch threw', err);
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
  median_gross_rent_usd: null,
  race_ethnicity: {
    denominator: null,
    white_nh: { count: null, pct: null },
    black_nh: { count: null, pct: null },
    asian_nh: { count: null, pct: null },
    hispanic_any_race: { count: null, pct: null },
  },
  income_brackets: {
    households_total: null,
    hh_100k_to_125k: null,
    hh_125k_to_150k: null,
    hh_150k_to_200k: null,
    hh_200k_plus: null,
    pct_100k_plus: null,
    pct_200k_plus: null,
  },
  education: {
    pop_25_plus: null,
    bachelors_plus_count: null,
    bachelors_plus_pct: null,
  },
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
      citation_en: `U.S. Census Bureau ACS ${year} 5-year (tract & county); variables B01003 population, B19013 median HH income, B19301 per-capita income, B01002 median age, B25077 median home value, B25064 median gross rent, B03002 race+Hispanic, B19001 HH income brackets, B15003 educational attainment.`,
      citation_zh: `美国人口普查局 ACS ${year} 年 5 年估计（普查片区 Tract 与县 County）；指标 B01003 人口、B19013 家庭收入中位数、B19301 人均收入、B01002 年龄中位数、B25077 自有住房价值中位数、B25064 租金中位数、B03002 种族与西班牙裔、B19001 家庭收入分布、B15003 学历分布。`,
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
