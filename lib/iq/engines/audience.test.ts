import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateSegments, computeAudience } from './audience';
import type { Ring } from '../model/schema';

const ring = (over: Partial<Ring>): Ring =>
  ({
    id: 'drive10',
    method: 'radius',
    minutes: 10,
    radius_mi: 2,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    area_sq_mi: 12,
    pop: 38_000,
    hh: 14_000,
    median_income: 118_000,
    chinese_hh_share: 0.31,
    chinese_pop: 11_000,
    age_25_44_share: 0.3,
    family_share: 0.33,
    avg_hh_size: 2.6,
    renter_share: 0.44,
    jobs: 5_200,
    jobs_method: 'lodes_wac',
    restaurant_spend_usd: 41_000_000,
    chinese_spend_usd: 12_000_000,
    cuisine_demand_usd: 1_400_000,
    block_groups: 22,
    ...over,
  }) as Ring;

const county = { chinese_hh_share: 0.11, median_income: 112_000, family_share: 0.3, age_25_44_share: 0.28, jobs_per_pop: null };

const audienceOf = (over: Parameters<typeof computeAudience>[0] extends infer T ? Partial<T> : never = {}) =>
  computeAudience({
    primary: ring({}),
    walk10: ring({ id: 'walk10', jobs: 5_200, pop: 6_000 }),
    county,
    lunch_usd: 22_000,
    dinner_usd: 48_000,
    ...over,
  });

test('P1-i: segment shares sum to 1 ± 0.02 — they partition the primary ring, not four unrelated weights', () => {
  const a = audienceOf();
  const sum = a.segments.reduce((s, x) => s + x.share, 0);
  assert.ok(Math.abs(sum - 1) <= 0.02, String(sum));
  assert.equal(a.segments.length, 4);
});

test('P1-i: a share ≥ 25 % can only carry an index < 50 when the county share is genuinely higher', () => {
  // The guard, run over a spread of trade areas — this is the gate that the 「通勤白领 31%，指数 20」
  // pairing can never come back: share and index are the SAME quantity on two geographies.
  for (const cn of [0.02, 0.09, 0.18, 0.31, 0.52]) {
    for (const jobs of [0, 900, 5_200, 24_000]) {
      const a = computeAudience({
        primary: ring({ chinese_hh_share: cn }),
        walk10: ring({ id: 'walk10', jobs, pop: 6_000 }),
        county,
        lunch_usd: 10_000,
        dinner_usd: 30_000,
      });
      const countyShares = allocateSegments({
        chinese_hh_share: county.chinese_hh_share,
        family_share: county.family_share,
        age_25_44_share: county.age_25_44_share,
        jobs_per_pop: county.jobs_per_pop,
      });
      assert.ok(Math.abs(a.segments.reduce((s, x) => s + x.share, 0) - 1) <= 0.02, `shares ${cn}/${jobs}`);
      for (const s of a.segments) {
        if (s.share < 0.25 || s.index == null || s.index >= 50) continue;
        assert.ok(countyShares[s.id] > s.share, `${s.id} share ${s.share} index ${s.index} but county share ${countyShares[s.id]}`);
      }
    }
  }
});

test('P1-i: index 100 means "exactly the county"; a ring identical to the county indexes at 100 everywhere', () => {
  const same = computeAudience({
    primary: ring({ chinese_hh_share: county.chinese_hh_share, family_share: county.family_share, age_25_44_share: county.age_25_44_share, pop: 10_000 }),
    walk10: ring({ id: 'walk10', jobs: 0, pop: 10_000 }),
    county,
    lunch_usd: 1,
    dinner_usd: 1,
  });
  for (const s of same.segments) assert.equal(s.index, 100, s.id);
});

test('P1-i: a missing county row leaves the index null — never an estimate — while the shares still sum to 1', () => {
  const a = computeAudience({
    primary: ring({}),
    walk10: ring({ id: 'walk10', jobs: 5_200, pop: 6_000 }),
    county: { chinese_hh_share: null, median_income: null },
    lunch_usd: 1,
    dinner_usd: 1,
  });
  for (const s of a.segments) assert.equal(s.index, null, s.id);
  assert.ok(Math.abs(a.segments.reduce((s, x) => s + x.share, 0) - 1) <= 0.02);
});

test('P1-i: every segment states its denominator, and §4.3 dayparts drive the lunch / dinner split', () => {
  const a = audienceOf({ dayparts: [
    { id: 'breakfast', share: 0.35, monthly_usd: 14_000 },
    { id: 'lunch', share: 0.25, monthly_usd: 10_000 },
    { id: 'afternoon', share: 0.3, monthly_usd: 12_000 },
    { id: 'dinner', share: 0.1, monthly_usd: 4_000 },
  ] });
  for (const s of a.segments) assert.match(s.basis, /主商圈家庭数占比/, s.id);
  // 10,000 / (10,000 + 4,000) = 0.71 — the bakery's own lunch:dinner ratio, not a full-service one.
  assert.deepEqual(a.lunch_dinner_split, [0.71, 0.29]);
});
