/**
 * v4 §1.3 异常输入阻断. The case that prompted it: $400/month on Grant Ave,
 * scored as 0.8% occupancy → financial viability 90 → GO.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInputSanity, inputBlocked } from './input-sanity';

const SF = { cuisine: 'egg_tart', sqft: null, ticket_in: null, median_income: 120_000, state: 'CA' };

test('$400 in a hcol metro is flagged below the tier floor and kept out of the scores', () => {
  const flags = checkInputSanity({ ...SF, rent_usd: 400 });
  const rent = flags.find((f) => f.field === 'rent_usd');
  assert.ok(rent, 'flagged');
  assert.equal(rent.reason, 'below_floor');
  assert.equal(rent.benchmark?.label, 'tier_floor_hcol');
  assert.equal(rent.blocks_scoring, true);
  assert.equal(inputBlocked(flags, 'rent_usd'), true);
});

test('a plausible rent passes, a confirmed flag stops blocking, and "typo" withdraws the number', () => {
  assert.equal(checkInputSanity({ ...SF, rent_usd: 6_500 }).length, 0);
  const net = checkInputSanity({ ...SF, rent_usd: 400, rent_confirmation: 'net' });
  assert.equal(net[0].confirmed, true);
  assert.equal(net[0].blocks_scoring, false, 'the customer says it really is $400 net — it scores');
  const typo = checkInputSanity({ ...SF, rent_usd: 400, rent_confirmation: 'typo' });
  assert.equal(typo[0].blocks_scoring, true, 'a confirmed typo must not be scored');
});

test('with a size, the $/sqft band is the benchmark; with a corridor median, ±60% is', () => {
  const psf = checkInputSanity({ ...SF, rent_usd: 400, sqft: 2_000 });
  assert.equal(psf[0].benchmark?.label, 'psf_band_min_monthly');
  const corridor = checkInputSanity({ ...SF, rent_usd: 2_000, sqft: 1_000, corridor_rent_usd: { value: 7_000, source: 'test comps' } });
  assert.equal(corridor[0].reason, 'below_corridor');
  assert.equal(checkInputSanity({ ...SF, rent_usd: 6_000, sqft: 1_000, corridor_rent_usd: { value: 7_000, source: 'test comps' } }).length, 0);
});

test('a ticket far outside the concept norm is flagged and blocked; size outliers are flagged but kept', () => {
  const t = checkInputSanity({ ...SF, rent_usd: null, ticket_in: 120 });
  assert.equal(t[0]?.field, 'ticket_in');
  assert.equal(t[0]?.blocks_scoring, true);
  const sz = checkInputSanity({ ...SF, rent_usd: null, sqft: 40 });
  assert.equal(sz[0]?.reason, 'size_concept_mismatch');
  assert.equal(sz[0]?.blocks_scoring, false);
});
