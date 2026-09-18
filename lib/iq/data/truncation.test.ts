/**
 * 底层重构 §3.1 竞品池完整性契约 + INV-1 / INV-2.
 *
 * The defect these cover: Places (New) returns at most 20 records per call, so in
 * Chinatown, the San Gabriel Valley, Flushing or the Sunset — the markets this
 * product exists for — a search is truncated by default. The pool was then used
 * as if it were the full set, which is how a report claimed "0 egg tart shops
 * within a mile" 130 m from the most famous egg tart shop in San Francisco.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import { buildCallPlan, buildCallPlanForProfile, PLACES_PER_CALL_CAP, subdivideCall, type PlaceCall } from './google-places';
import { assessCategoryGap } from '../engines/competitor';
import { computeConfidence, TRUNCATION_DISCOUNT } from '../engines/confidence';
import { conceptSearchProfile, L1_QUERY_ALIASES } from './search-profile';
import { verdictCap, verdictFromScore } from '../conclusion/conclusion';
import { haversineM } from '../geo';
import { getDefaults } from '../params';

const CENTRE = { lat: 37.7946, lng: -122.4069 }; // 900 Grant Ave, San Francisco
const call: PlaceCall = { includedTypes: ['bakery', 'cafe'], radiusM: 800, label: 'direct@800', textQuery: 'egg tart', layer: 'direct', restrict: true };

test('§3.1 the four sub-cells together cover the parent circle', () => {
  const cells = subdivideCall(call, CENTRE);
  assert.equal(cells.length, 4);
  for (const c of cells) assert.equal(c.call.radiusM, Math.round(800 * 0.71));

  // Every point on the parent circle must fall inside at least one sub-cell,
  // otherwise refinement would silently drop the ring it was meant to search.
  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    const p = {
      lat: CENTRE.lat + (800 * Math.cos(rad)) / 111_320,
      lng: CENTRE.lng + (800 * Math.sin(rad)) / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)),
    };
    const covered = cells.some((c) => haversineM(c.centre, p) <= c.call.radiusM + 1);
    assert.ok(covered, `point at ${deg}° on the parent circle is in no sub-cell`);
  }
});

test('§3.1 a sub-cell keeps the parent query and drops the 先近后远 gate', () => {
  const gated: PlaceCall = { ...call, only_if_fewer_than: 5 };
  for (const c of subdivideCall(gated, CENTRE)) {
    assert.equal(c.call.textQuery, 'egg tart');
    assert.deepEqual(c.call.includedTypes, ['bakery', 'cafe']);
    // The parent already decided the search is warranted; re-applying the
    // "only if thin" gate to its own sub-cells would skip most of them.
    assert.equal(c.call.only_if_fewer_than, undefined);
    assert.match(c.call.label, /^direct@800\/(n|s)(e|w)$/);
  }
});

test('INV-1 a truncated pool can never support a category-gap claim', () => {
  const profile = conceptSearchProfile('egg_tart');
  const clean = assessCategoryGap({ l1_count: 0, layer2: [], profile, both_radii_searched: true });
  assert.equal(clean.category_gap, 'true', 'exhausted search with no hits may still claim a gap');

  const truncated = assessCategoryGap({ l1_count: 0, layer2: [], profile, both_radii_searched: true, pool_truncated: true });
  assert.equal(truncated.category_gap, 'unknown', '"we did not find one" is a fact about the search, not the world');
});

test('INV-2 a failed basemap can no longer take full marks for competitor data', () => {
  const user = { rent_usd: null, sqft: null, seats: null, capex_usd: null };
  const basemapOk = computeConfidence({ sources: { D5: { status: 'ok' as const, coverage_note: '' }, D6: { status: 'ok' as const, coverage_note: '' } }, guard_passed: true, user });
  const basemapFailed = computeConfidence({ sources: { D5: { status: 'failed' as const, coverage_note: '未获取' }, D6: { status: 'ok' as const, coverage_note: '' } }, guard_passed: true, user });

  assert.equal(basemapOk.components.competitors.quality, 1);
  // The shipped report printed "餐饮门店底图未获取" and scored this component
  // 1.00 on the same run, because the two sources were combined with `max`.
  assert.ok(basemapFailed.components.competitors.quality < 1, 'a failed primary source must cost quality');
  assert.equal(Math.round(basemapFailed.components.competitors.quality * 100), 40);
  assert.ok(basemapFailed.total < basemapOk.total);
});

test('§3.1 truncation costs in proportion to what was actually found', () => {
  // Zeroing the component for any truncation was disproportionate: a Chinatown
  // search is truncated as a matter of course, so 156 found competitors scored
  // as zero-quality data and no core-market address could ever reach GO. The
  // harm is "we may have missed some", which matters most when we found few.
  const user = { rent_usd: null, sqft: null, seats: null, capex_usd: null };
  const sources = { D5: { status: 'ok' as const, coverage_note: '' }, D6: { status: 'ok' as const, coverage_note: '' } };
  const rich = computeConfidence({ sources, guard_passed: true, user, pool_truncated: true, competitor_count: 156 });
  const thin = computeConfidence({ sources, guard_passed: true, user, pool_truncated: true, competitor_count: 3 });
  const clean = computeConfidence({ sources, guard_passed: true, user, competitor_count: 156 });

  assert.equal(clean.components.competitors.quality, 1);
  assert.equal(Math.round(rich.components.competitors.quality * 100), Math.round(TRUNCATION_DISCOUNT * 100), 'a substantive pool is discounted');
  assert.equal(thin.components.competitors.quality, 0, 'a thin AND unexhausted pool is genuinely unknown');
  assert.ok(rich.total > thin.total && rich.total < clean.total);
  assert.match(rich.components.competitors.note, /156/);
  assert.match(thin.components.competitors.note, /过少/);
});

test('§4.3 the evidence cap: completeness and truncation bound the verdict', () => {
  assert.equal(verdictCap({ completeness: 90 }), 'GO');
  assert.equal(verdictCap({ completeness: 80 }), 'GO');
  // The report that prompted this: completeness 75 with a failed basemap, printed GO.
  assert.equal(verdictCap({ completeness: 75 }), 'CONDITIONAL_GO');
  assert.equal(verdictCap({ completeness: 90, coreSourceDegraded: true }), 'CONDITIONAL_GO');
  assert.equal(verdictCap({ completeness: 54 }), null, 'below 55 no verdict is supported');
  // Truncation is NOT a separate cap: it is already paid for inside completeness.
  // Capping again made GO unreachable in every dense Chinese trade area, which is
  // the market this product exists for.
  assert.equal(verdictCap({ completeness: 95, poolTruncated: true }), 'GO', 'truncation is priced in completeness, not capped twice');
});

test('§4.3 the cap clamps a verdict down and never lifts one up', () => {
  assert.equal(verdictFromScore(95, { rentMissing: false }), 'GO', 'no completeness given → the pure score path is unchanged');
  assert.equal(verdictFromScore(95, { rentMissing: false, completeness: 75 }), 'CONDITIONAL_GO');
  assert.equal(verdictFromScore(95, { rentMissing: false, completeness: 95, poolTruncated: true }), 'GO', 'a rich but unexhausted pool still supports a verdict');
  assert.equal(verdictFromScore(30, { rentMissing: false, completeness: 95 }), 'NO_GO', 'good data never rescues bad numbers');
  assert.equal(verdictFromScore(30, { rentMissing: false, completeness: 20 }), 'NO_GO', 'and poor data never softens them either');
});

test('§3.1 the per-call cap constant is what the request actually asks for', () => {
  // If these ever diverge, truncation detection silently stops firing.
  assert.equal(PLACES_PER_CALL_CAP, 20, 'Places (New) maxResultCount ceiling');
});

test('§3.2 Layer 1 searches both scripts, because Text Search matches names per language', () => {
  // Measured live at 900 Grant Ave, San Francisco (800 m bias):
  //   "egg tart"       →  0 results
  //   "蛋挞"            → 11 results, Golden Gate Bakery ranked first
  //   "pastel de nata" →  6 results
  // Searching only the first Latin keyword is what made the best known egg tart
  // shop in the city invisible to an egg tart report 194 m away.
  const egg = conceptSearchProfile('egg_tart');
  assert.ok(egg.queries.includes('蛋挞'), `CJK alias missing: ${egg.queries.join(',')}`);
  assert.ok(egg.queries.some((q) => /[a-z]{3,}/i.test(q)), 'a Latin alias is still searched');
  assert.ok(egg.queries.length > 1 && egg.queries.length <= L1_QUERY_ALIASES);

  // A Chinese-audience concept leads with its Chinese alias.
  const hunan = conceptSearchProfile('hunan');
  assert.equal(hunan.queries[0], '湘菜');
  assert.ok(hunan.queries.includes('Hunan'));

  // `query` stays the first alias, so single-query callers are unchanged.
  assert.equal(egg.query, egg.queries[0]);
});

test('§3.2 the plan issues one Layer-1 call per alias at each radius', () => {
  const plan = buildCallPlanForProfile(conceptSearchProfile('egg_tart'), 99);
  const direct = plan.filter((c) => c.layer === 'direct');
  const near = direct.filter((c) => c.radiusM === 800);
  const far = direct.filter((c) => c.radiusM === 1600);
  assert.equal(near.length, conceptSearchProfile('egg_tart').queries.length);
  assert.deepEqual(near.map((c) => c.textQuery), conceptSearchProfile('egg_tart').queries);
  // The wider radius still only runs when the near one came back thin.
  assert.ok(far.every((c) => c.only_if_fewer_than === 5));
  assert.ok(near.every((c) => c.only_if_fewer_than == null));
});

test('§3.1 Layer 2 searches the near ring before widening', () => {
  // Measured at 1115 Clement St: a plain 800 m bakery Nearby returns Breadbelly
  // (426 m) and Schubert's (406 m) — and returns exactly 20, i.e. truncated.
  // Layer 2 used to start at 1600 m, four times the area, so it truncated and
  // cut the nearest same-category stores. The near ring is never gated: it is
  // the ring the customer actually walks.
  const plan = buildCallPlanForProfile(conceptSearchProfile('egg_tart'), 99);
  const subs = plan.filter((c) => c.layer === 'substitute' && !c.textQuery);
  assert.ok(subs.length >= 2, `expected a near and a wide substitute pass: ${subs.map((c) => c.label).join(',')}`);
  assert.equal(subs[0].radiusM, 800);
  assert.equal(subs[1].radiusM, 1600);
  assert.ok(subs.every((c) => c.only_if_fewer_than == null));
  // Both passes look for the same Table A types.
  assert.deepEqual(subs[0].includedTypes, subs[1].includedTypes);
});

test('§3.1 refinement has its own budget, not the leftovers of the plan cap', () => {
  // The budget used to be `maxCalls - plan.length`. With a 12-step plan under a
  // cap of 14 that left 2 calls, a quadrant split needs 4, and so the shipped
  // config detected truncation and then never refined any of it. Live at 900
  // Grant Ave this was the difference between a 137-place pool and a 190-place
  // one, and between 50 and 123 same-category stores.
  const d = getDefaults().data_budget;
  const plan = buildCallPlan('egg_tart');
  assert.ok(plan.length > d.google_places_max_calls - 4, 'the plan really does leave fewer than one split spare');
  assert.ok(d.google_places_max_refine_calls >= 4, 'refinement must be able to afford at least one split');
});

test('§3.1 refinement stops at the data cost cap once calls are billed', async () => {
  // While Places is inside Google's free allowance perCallCost is 0 and the cap
  // never binds. Once billed, a dense market would otherwise spend many times
  // the declared per-report data budget.
  const d = getDefaults().data_budget;
  const perCall = d.google_places_cost_usd_per_call;
  const maxRefineSpend = d.google_places_max_refine_calls * perCall;
  assert.ok(maxRefineSpend > d.data_cost_cap_usd, 'this test is only meaningful while refinement could outspend the cap');
  // The guard is in fetchGooglePlaces: a split is skipped when it would take the
  // ledger past data_cost_cap_usd, and the cell is reported as still truncated.
  const src = readFileSync(new URL('./google-places.ts', import.meta.url), 'utf8');
  assert.match(src, /ctx\.cost\.total\(\) \+ splitCost > costCap/);
});
