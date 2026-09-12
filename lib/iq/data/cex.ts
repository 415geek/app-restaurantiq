/**
 * D10 · BLS Consumer Expenditure Survey — food away from home by income quintile.
 *
 * Static table: CEX 2023 quintile means, Table 1101 ("Quintiles of income before
 * taxes: annual expenditure means, shares, standard errors"); refresh via
 * scripts/refresh-cex.ts when BLS publishes the next vintage. Values are
 * rounded to the nearest dollar as published in the quintile columns.
 *
 * Caveat carried into coverage_note: the demand engine feeds *median household
 * income* (pre-tax, B19013) into `cexFafhForHousehold`, while the table's income
 * axis is after-tax mean income per quintile. No tax adjustment is applied here
 * (that would be an estimate); the mismatch biases FAFH upward for high-income
 * areas, which is why extrapolation above the top quintile is capped.
 */
import { DATA_SOURCE_NAMES, nowIso, type DataResult, type FetchContext } from './types';

export type CexQuintileId = 'lowest' | 'second' | 'third' | 'fourth' | 'highest';

export interface CexQuintile {
  quintile: CexQuintileId;
  /** Mean income after taxes, USD / consumer unit / year. */
  income_after_taxes: number;
  /** Mean "food away from home" spend, USD / consumer unit / year. */
  food_away_from_home_usd: number;
  /** food_away_from_home_usd / income_after_taxes. */
  share_of_after_tax_income: number;
}

export interface CexTable {
  vintage: 2023;
  table: 'Table 1101';
  unit: 'USD per consumer unit per year';
  quintiles: CexQuintile[]; // ascending
  note: string;
}

const RAW: Array<[CexQuintileId, number, number]> = [
  // quintile, income after taxes, food away from home
  ['lowest', 16_500, 1_668],
  ['second', 39_000, 2_441],
  ['third', 61_000, 3_286],
  ['fourth', 96_000, 4_383],
  ['highest', 210_000, 7_246],
];

export const CEX_2023_TABLE: CexTable = {
  vintage: 2023,
  table: 'Table 1101',
  unit: 'USD per consumer unit per year',
  quintiles: RAW.map(([quintile, income, fafh]) => ({
    quintile,
    income_after_taxes: income,
    food_away_from_home_usd: fafh,
    share_of_after_tax_income: Math.round((fafh / income) * 10_000) / 10_000,
  })),
  note: 'CEX 2023 quintile means; refresh via scripts/refresh-cex.ts',
};

/** Extrapolation above the top quintile is capped at this multiple of the top-quintile FAFH. */
export const CEX_EXTRAPOLATION_CAP = 1.2;

const SOURCE = 'U.S. BLS Consumer Expenditure Survey 2023, Table 1101 (quintiles of income before taxes)';
const LICENSE = 'Public domain (U.S. Bureau of Labor Statistics)';

/** Quintile whose after-tax mean income is nearest (boundaries = midpoints between adjacent means). */
export function pickQuintile(income: number, table: CexTable = CEX_2023_TABLE): CexQuintileId {
  const q = table.quintiles;
  if (!Number.isFinite(income)) return q[0].quintile;
  for (let i = 0; i < q.length - 1; i++) {
    const boundary = (q[i].income_after_taxes + q[i + 1].income_after_taxes) / 2;
    if (income < boundary) return q[i].quintile;
  }
  return q[q.length - 1].quintile;
}

export interface CexFafhResult {
  /** Annual food-away-from-home USD per household at this income. */
  usd: number;
  quintile: CexQuintileId;
  /** usd / income (null when income ≤ 0). */
  share: number | null;
  /** How the value was derived. */
  method: 'interpolated' | 'extrapolated_capped' | 'extrapolated' | 'below_lowest';
}

/**
 * Piecewise-linear interpolation of FAFH across the quintile income points.
 * Above the highest quintile: extrapolate with the highest quintile's share,
 * capped at CEX_EXTRAPOLATION_CAP × highest FAFH. Below the lowest: scale by the
 * lowest quintile's share (never negative).
 */
export function cexFafhForHousehold(medianIncome: number, table: CexTable = CEX_2023_TABLE): CexFafhResult {
  const q = table.quintiles;
  const income = Number.isFinite(medianIncome) ? Math.max(0, medianIncome) : 0;
  const quintile = pickQuintile(income, table);
  const lo = q[0];
  const hi = q[q.length - 1];
  const shareOf = (usd: number) => (income > 0 ? usd / income : null);

  if (income <= lo.income_after_taxes) {
    const usd = round2(income * lo.share_of_after_tax_income);
    return { usd, quintile, share: shareOf(usd), method: 'below_lowest' };
  }
  if (income >= hi.income_after_taxes) {
    const raw = income * hi.share_of_after_tax_income;
    const cap = hi.food_away_from_home_usd * CEX_EXTRAPOLATION_CAP;
    const usd = round2(Math.min(raw, cap));
    return { usd, quintile, share: shareOf(usd), method: raw > cap ? 'extrapolated_capped' : 'extrapolated' };
  }
  for (let i = 0; i < q.length - 1; i++) {
    const a = q[i];
    const b = q[i + 1];
    if (income >= a.income_after_taxes && income <= b.income_after_taxes) {
      const t = (income - a.income_after_taxes) / (b.income_after_taxes - a.income_after_taxes);
      const usd = round2(a.food_away_from_home_usd + t * (b.food_away_from_home_usd - a.food_away_from_home_usd));
      return { usd, quintile, share: shareOf(usd), method: 'interpolated' };
    }
  }
  // unreachable: covered by the range checks above
  const usd = hi.food_away_from_home_usd;
  return { usd, quintile, share: shareOf(usd), method: 'interpolated' };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** D10 is a static table: no network, no cost, no cache. */
export async function fetchCex(_input: unknown, ctx: FetchContext): Promise<DataResult<CexTable>> {
  return {
    id: 'D10',
    name: DATA_SOURCE_NAMES.D10,
    status: 'ok',
    data: CEX_2023_TABLE,
    source: SOURCE,
    fetched_at: nowIso(ctx),
    license: LICENSE,
    cost_usd: 0,
    coverage_note:
      'CEX 2023 五分位均值（静态表，scripts/refresh-cex.ts 刷新）；收入轴为税后均值，引擎输入 B19013 为税前中位数，未做税负换算；最高分位以上按最高分位占比外推，封顶 1.2× 最高分位',
    cache: 'none',
    elapsed_ms: 0,
  };
}
