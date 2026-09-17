import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circlePolygon } from '../geo';
import { cuisineById, DAYPART_IDS } from '../params';
import { computeHuff, lunchAudienceFor, type HuffInput } from './demand-huff';
import type { BlockGroupDemand } from './trade-area';

const SITE = { lat: 37.6, lng: -122.4 };

/** Four block groups around the site, $1.2 M of annual concept demand in total. */
const BG: BlockGroupDemand[] = [0, 1, 2, 3].map((i) => ({
  geoid: `0608100100${i}`,
  centroid: { lat: SITE.lat + 0.004 * (i + 1), lng: SITE.lng + 0.003 * (i + 1) },
  cuisine_demand_usd: 300_000,
  chinese_spend_usd: 900_000,
  restaurant_spend_usd: 3_000_000,
  pop: 1_800,
  weightByRing: { walk10: 1, drive5: 1, drive10: 1, drive15: 1 },
}));

function huffFor(cuisineId: string, over: Partial<HuffInput> = {}) {
  const cu = cuisineById(cuisineId);
  return computeHuff({
    site: SITE,
    range_class: cu.range_class,
    competitors: [
      { id: 'c1', lat: SITE.lat + 0.002, lng: SITE.lng, rating: 4.3, rating_count: 240, layer: 'L1', drive_min: null },
      { id: 'c2', lat: SITE.lat - 0.006, lng: SITE.lng + 0.004, rating: 4.0, rating_count: 90, layer: 'L2', drive_min: null },
    ],
    bg_demand: BG,
    seats: null,
    walk10: circlePolygon(SITE, 800, 32),
    lunch: {
      jobs_walk10: 4_000,
      ...lunchAudienceFor(cu, { chinese_share: 0.18, asian_job_share: 0.3, concept_share: 0.12, ticket_lunch: Math.round(cu.ticket_in * 0.75) }),
    },
    dayparts: cu.dayparts,
    ...over,
  });
}

test('§4.3: the Huff result carries four dayparts in clock order whose shares sum to 1', () => {
  const r = huffFor('hunan');
  assert.deepEqual(r.dayparts.map((d) => d.id), [...DAYPART_IDS]);
  const sum = r.dayparts.reduce((s, d) => s + d.share, 0);
  assert.ok(Math.abs(sum - 1) <= 0.002, String(sum));
  // The captured total is still resident pool + workplace pool — the split does not create money.
  const dollars = r.dayparts.reduce((s, d) => s + d.monthly_usd, 0);
  assert.ok(Math.abs(dollars - (r.captured_monthly_usd ?? 0)) <= 4, `${dollars} vs ${r.captured_monthly_usd}`);
  assert.equal(r.captured_monthly_usd, Math.round((r.resident_usd ?? 0) + (r.workplace_lunch_usd ?? 0)));
});

test('§4.3 P0-C: an egg-tart bakery reports a ~25 % lunch share and a real morning / afternoon, never 午市 0% / 晚市 100%', () => {
  // A residential site with no workplace pool: the split IS the concept's own table, 35 / 25 / 30 / 10.
  const residential = huffFor('egg_tart', { lunch: { jobs_walk10: null, asian_job_share: null, ticket_lunch: null, chinese_share: 0 } });
  const rs = (id: string) => residential.dayparts.find((d) => d.id === id)!.share;
  assert.equal(rs('lunch'), 0.25);
  assert.equal(rs('breakfast'), 0.35);
  assert.equal(rs('afternoon'), 0.3);
  assert.equal(rs('dinner'), 0.1);
  assert.notEqual(rs('lunch'), 0);
  assert.notEqual(rs('dinner'), 1);

  // With a walk-10 workplace pool the lunch share can only rise above the concept's own 25 %.
  const withJobs = huffFor('egg_tart');
  const ws = (id: string) => withJobs.dayparts.find((d) => d.id === id)!.share;
  assert.ok(ws('lunch') >= 0.25, `lunch ${ws('lunch')}`);
  assert.ok(ws('breakfast') > 0.1 && ws('afternoon') > 0.1, `${ws('breakfast')} / ${ws('afternoon')}`);
  assert.ok(ws('dinner') > 0 && ws('dinner') < 0.15, `dinner ${ws('dinner')}`);
  // The 10 % evening slice is the concept's, not the model's: a bakery is never 晚市 100%.
  assert.ok(ws('dinner') < ws('breakfast') && ws('dinner') < ws('afternoon'));
});

test('§4.3: a dinner-led concept keeps its evening weight and gets no workplace lunch pool', () => {
  const r = huffFor('hot_pot');
  const share = (id: string) => r.dayparts.find((d) => d.id === id)!.share;
  assert.equal(r.workplace_lunch_usd, null, 'a dinner daypart_profile has no lunch pool');
  assert.ok(share('dinner') >= 0.7, `dinner ${share('dinner')}`);
  assert.ok(share('lunch') >= 0.15 && share('lunch') <= 0.25, `lunch ${share('lunch')}`);
});

test('§4.3: two concepts on the SAME site split the same resident pool differently', () => {
  const bakery = huffFor('egg_tart');
  const cafe = huffFor('hk_cafe');
  const s = (r: typeof bakery, id: string) => r.dayparts.find((d) => d.id === id)!.share;
  assert.ok(s(cafe, 'lunch') > s(bakery, 'lunch'), `${s(cafe, 'lunch')} vs ${s(bakery, 'lunch')}`);
  assert.ok(s(bakery, 'breakfast') > s(cafe, 'breakfast'));
  assert.ok(s(bakery, 'afternoon') > s(cafe, 'afternoon'));
});

test('no block-group demand and no lunch pool → null dayparts, never a fabricated split', () => {
  const r = huffFor('hunan', { bg_demand: [], lunch: { jobs_walk10: null, asian_job_share: null, ticket_lunch: null, chinese_share: 0 } });
  assert.equal(r.captured_monthly_usd, null);
  assert.equal(r.lunch_usd, null);
  assert.equal(r.dinner_usd, null);
  assert.deepEqual(r.dayparts, []);
});
