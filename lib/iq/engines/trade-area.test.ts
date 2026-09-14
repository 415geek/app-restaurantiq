import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circlePolygon, destination } from '../geo';
import { computeTradeArea, primaryRingFor, type BlockGroupInput, type RingInput } from './trade-area';
import { computeHuff, lunchAudienceFor } from './demand-huff';

const site = { lat: 37.5985, lng: -122.3872 };

function bg(id: string, center: { lat: number; lng: number }, radiusM: number, over: Partial<BlockGroupInput> = {}): BlockGroupInput {
  return {
    geoid: id,
    tract: id.slice(0, 11),
    geometry: circlePolygon(center, radiusM, 24),
    pop: 2000,
    pop5plus: 1900,
    households: 700,
    median_income: 120_000,
    chinese_speakers: 570, // 30 %
    chinese_pop_est: 700,
    age_25_44: 600,
    families_with_children: 210,
    renter_households: 280,
    occupied_households: 700,
    commute_total: 1000,
    commute_transit: 200,
    commute_walk: 50,
    commute_drove_alone: 650,
    jobs: 800,
    ...over,
  };
}

const rings: RingInput[] = [
  { id: 'walk10', geometry: circlePolygon(site, 800, 48), method: 'radius', minutes: 10, radius_mi: 0.5 },
  { id: 'drive5', geometry: circlePolygon(site, 1_609, 48), method: 'radius', minutes: 5, radius_mi: 1 },
  { id: 'drive10', geometry: circlePolygon(site, 4_828, 48), method: 'radius', minutes: 10, radius_mi: 3 },
  { id: 'drive15', geometry: circlePolygon(site, 8_047, 48), method: 'radius', minutes: 15, radius_mi: 5 },
];

const params = {
  cuisine_share: 0.1,
  range_class: 'destination' as const,
  fafhForIncome: () => 4_383,
  jobs_method: 'lodes_wac' as const,
  county: { chinese_hh_share: 0.2, median_income: 140_000 },
};

test('rings nest: drive15 ⊇ drive10 ⊇ drive5 ⊇ walk10 populations', () => {
  const groups = [
    bg('060816023001', site, 500),
    bg('060816023002', destination(site, 90, 2_500), 600),
    bg('060816023003', destination(site, 180, 6_000), 800),
    bg('060816023004', destination(site, 0, 12_000), 800), // outside drive15
  ];
  const r = computeTradeArea({ rings, block_groups: groups, params });
  const [w, d5, d10, d15] = r.rings;
  assert.ok(w.pop! <= d5.pop! && d5.pop! <= d10.pop! && d10.pop! <= d15.pop!, JSON.stringify(r.rings.map((x) => x.pop)));
  assert.ok(d15.pop! < 8000, 'BG outside drive15 must not count');
  assert.equal(d15.block_groups, 3);
  assert.equal(r.primary_ring, 'drive15');
  assert.equal(primaryRingFor('everyday'), 'drive5');
  assert.ok(Math.abs(d5.chinese_hh_share! - 0.3) < 0.01);
  assert.equal(d5.jobs_method, 'lodes_wac');
  // demand: 700 hh × 4383 × 1.15 = 3,528,315 → chinese share (0.3×0.55 + 0.7×0.08 = 0.221) → cuisine 10 %
  assert.ok(Math.abs(w.restaurant_spend_usd! - 3_528_315 * (w.hh! / 700)) / w.restaurant_spend_usd! < 0.05);
  assert.ok(Math.abs(r.commute_mix.transit! - 0.2) < 0.01);
});

test('missing income → zero demand, missing geometry → not counted', () => {
  const groups = [bg('a', site, 500, { median_income: null }), bg('b', site, 500, { geometry: null })];
  const r = computeTradeArea({ rings, block_groups: groups, params });
  assert.equal(r.rings[0].restaurant_spend_usd, 0);
  assert.equal(r.coverage.bg_with_geometry, 1);
  assert.equal(r.rings[0].block_groups, 1);
});

test('huff: closer / stronger competitors take more; changing β changes capture', () => {
  const groups = [bg('060816023001', site, 500), bg('060816023002', destination(site, 90, 2_500), 600)];
  const ta = computeTradeArea({ rings, block_groups: groups, params });
  const comp = (id: string, bearing: number, distM: number, cnt: number): import('./demand-huff').HuffCompetitor => {
    const p = destination(site, bearing, distM);
    return { id, lat: p.lat, lng: p.lng, rating: 4.3, rating_count: cnt, layer: 'L1', drive_min: null };
  };
  const base = {
    site,
    range_class: 'destination' as const,
    bg_demand: ta.bg_demand,
    seats: null,
    walk10: rings[0].geometry,
    lunch: { jobs_walk10: 5000, asian_job_share: 0.3, ticket_lunch: 18, chinese_share: 0.25 },
  };
  const weak = computeHuff({ ...base, competitors: [comp('far', 45, 6_000, 50)] });
  const strong = computeHuff({ ...base, competitors: [comp('near', 45, 400, 1_500)] });
  assert.ok(weak.captured_monthly_usd! > strong.captured_monthly_usd!, `${weak.captured_monthly_usd} vs ${strong.captured_monthly_usd}`);
  assert.ok(strong.competitor_shares.near > 0.3);
  assert.ok(weak.lunch_usd! > strong.lunch_usd!, 'walk10 competitor must dilute lunch');
  const everyday = computeHuff({ ...base, range_class: 'everyday', competitors: [comp('far', 45, 6_000, 50)] });
  assert.notEqual(everyday.captured_monthly_usd, weak.captured_monthly_usd);
  assert.equal(everyday.huff.beta, 2.0);
  assert.ok(weak.by_ring.length >= 1 && weak.by_ring[0].share <= 1);
});

test('§4.1 demand basis: a general-audience concept multiplies ALL restaurant spend, a Chinese concept the Chinese spend', () => {
  const groups = [bg('060816023001', site, 500)];
  const chinese = computeTradeArea({ rings, block_groups: groups, params });
  const general = computeTradeArea({ rings, block_groups: groups, params: { ...params, demand_basis: 'restaurant_spend' } });
  const c = chinese.bg_demand[0];
  const g = general.bg_demand[0];
  assert.equal(c.restaurant_spend_usd, g.restaurant_spend_usd);
  assert.ok(Math.abs(c.cuisine_demand_usd - c.chinese_spend_usd * 0.1) < 1e-6);
  assert.ok(Math.abs(g.cuisine_demand_usd - g.restaurant_spend_usd * 0.1) < 1e-6);
  assert.ok(g.cuisine_demand_usd > c.cuisine_demand_usd);
  const lunch = lunchAudienceFor({ audience: 'general' }, { chinese_share: 0.3, asian_job_share: 0.4, concept_share: 0.05, ticket_lunch: 8 });
  assert.deepEqual(lunch, { asian_job_share: null, ticket_lunch: 8, chinese_share: 0.05 });
  assert.deepEqual(lunchAudienceFor({ audience: 'chinese', daypart_profile: 'lunch_dinner' }, { chinese_share: 0.3, asian_job_share: 0.4, concept_share: 0.05, ticket_lunch: 18 }), { asian_job_share: 0.4, ticket_lunch: 18, chinese_share: 0.3 });
  assert.equal(lunchAudienceFor({ audience: 'chinese', daypart_profile: 'dinner' }, { chinese_share: 0.3, asian_job_share: 0.4, concept_share: 0.05, ticket_lunch: 26 }).ticket_lunch, null, 'dinner-only formats have no lunch pool');
});
