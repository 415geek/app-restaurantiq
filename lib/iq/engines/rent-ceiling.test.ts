/**
 * GF-007 rent ceiling (v4 §5). Every report must carry the three ceilings;
 * with an asking rent it must say the gap and the lease-term total.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportModelSchema, type ReportModel } from '../model/schema';
import { computeRentCeiling } from './rent-ceiling';
import { rentForOccupancyTarget } from './finance';

const FIXTURE = join(process.cwd(), 'qa', 'fixtures', 'report_model_millbrae.json');
const load = (): ReportModel => reportModelSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));

/** The fixture is the NO GO case (coverage 22%); a site that can carry rent has demand that covers the fixed cost several times over. */
function viable(m: ReportModel): { finance: ReportModel['finance']; captured: number } {
  const finance = structuredClone(m.finance);
  for (const s of finance.scenarios) s.monthly_revenue *= 5;
  return { finance, captured: m.demand.captured_monthly_usd! * 5 };
}
const DEMAND = (m: ReportModel) => m.demand.captured_monthly_usd!;

test('GF-007: three ceilings, safe below critical, stress below safe', () => {
  const m = load();
  const v = viable(m);
  const r = computeRentCeiling({ cuisine: m.input.cuisine, finance: v.finance, captured_monthly_usd: v.captured, asking_rent_usd: m.input.rent_usd });
  assert.ok(r, 'every report with a revenue scenario carries a rent ceiling');
  assert.equal(r.affordable, true);
  assert.ok(r.safe > 0);
  assert.ok(r.safe <= r.critical, 'an affordable site: the target rent sits below the break-even critical point');
  assert.ok(r.stress <= r.safe, 'a bad year can only lower the ceiling');
  assert.equal(r.basis, 'pessimistic', 'the ceiling rests on the conservative scenario');
  assert.ok(r.demand_lo <= v.captured, 'anchored on demand, never on capacity alone');
});

test('GF-007: a site whose conservative scenario cannot cover fixed cost says no rent is affordable — never three zeros presented as a ceiling', () => {
  const m = load();
  const r = computeRentCeiling({ cuisine: m.input.cuisine, finance: m.finance, captured_monthly_usd: DEMAND(m), asking_rent_usd: m.input.rent_usd })!;
  assert.equal(r.affordable, false, 'the Millbrae fixture is the NO GO case');
  assert.equal(r.critical, 0);
  assert.equal(r.safe, rentForOccupancyTarget(DEMAND(m)), 'the target rent is the same number the checklist condition quotes');
});

test('GF-007: with an asking rent the gap and the lease-term total are stated, with equivalents', () => {
  const m = load();
  const v = viable(m);
  const r = computeRentCeiling({ cuisine: m.input.cuisine, finance: v.finance, captured_monthly_usd: v.captured, asking_rent_usd: m.input.rent_usd })!;
  assert.ok(r.asking != null);
  assert.ok(r.gap_monthly != null && r.gap_lease != null);
  assert.equal(r.gap_lease, r.gap_monthly! * r.lease_months);
  if (r.gap_monthly! > 0) {
    const types = r.equivalents.map((e) => e.type);
    assert.deepEqual(types, ['free_rent_month', 'ti_allowance', 'percentage_rent_cap']);
    const free = r.equivalents[0];
    assert.equal(free.type === 'free_rent_month' ? free.value : -1, Math.round(r.asking! / 12), 'one free month ≈ asking ÷ 12 per month');
  }
});

test('GF-007: without an asking rent the ceiling is the negotiation target and nothing is invented', () => {
  const m = load();
  const v = viable(m);
  const r = computeRentCeiling({ cuisine: m.input.cuisine, finance: v.finance, captured_monthly_usd: v.captured, asking_rent_usd: null })!;
  assert.equal(r.asking, null);
  assert.equal(r.gap_monthly, null);
  assert.equal(r.equivalents.length, 0);
  assert.ok(r.safe > 0);
});
