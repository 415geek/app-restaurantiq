/**
 * Annual refresh of the BLS Consumer Expenditure Survey table used by D10
 * (lib/iq/data/cex.ts). The CEX quintile table is published as an Excel/CSV
 * ("Table 1101. Quintiles of income before taxes") at
 * https://www.bls.gov/cex/tables/calendar-year/mean-item-share-average-standard-error.htm
 * — BLS has no stable JSON API for it, so this script takes the five
 * food-away-from-home means and after-tax incomes as arguments and prints the
 * TypeScript constant to paste into CEX_2023_TABLE (or writes it with --write).
 *
 *   npx tsx scripts/refresh-cex.ts --year 2024 --fafh 1700,2500,3350,4450,7400 --income 17000,40000,62500,98000,215000 [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const get = (k: string) => args[args.indexOf(k) + 1];
const year = Number(get('--year'));
const fafh = (get('--fafh') ?? '').split(',').map(Number);
const income = (get('--income') ?? '').split(',').map(Number);
if (!year || fafh.length !== 5 || income.length !== 5 || fafh.some(Number.isNaN) || income.some(Number.isNaN)) {
  console.error('usage: --year YYYY --fafh a,b,c,d,e --income a,b,c,d,e [--write]');
  process.exit(2);
}
const ids = ['lowest', 'second', 'third', 'fourth', 'highest'];
const rows = ids.map((id, i) => `  ['${id}', ${income[i].toLocaleString('en-US').replace(/,/g, '_')}, ${fafh[i].toLocaleString('en-US').replace(/,/g, '_')}],`);
const block = `const RAW: Array<[CexQuintileId, number, number]> = [\n${rows.join('\n')}\n];`;
console.log(block);
if (args.includes('--write')) {
  const p = 'lib/iq/data/cex.ts';
  const src = readFileSync(p, 'utf8');
  const next = src
    .replace(/const RAW: Array<\[CexQuintileId, number, number\]> = \[[\s\S]*?\n\];/, block)
    .replace(/vintage: \d{4}/, `vintage: ${year}`)
    .replace(/CEX \d{4} quintile means/, `CEX ${year} quintile means`);
  if (next === src) {
    console.error('could not locate the RAW table; paste manually');
    process.exit(1);
  }
  writeFileSync(p, next);
  console.log(`[refresh-cex] wrote ${p}`);
}
