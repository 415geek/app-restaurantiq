import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedListing, verifiedListings } from './iq-corridor-listings';

const real = { address_or_listing: '200 Broadway, Millbrae, CA', sqft: 1800, monthly_rent_usd: '$7,200', highlights: 'corner, 2nd-gen restaurant', source_tag: 'LoopNet' };

test('corridor listings: only LoopNet/Crexi rows with real sqft + rent are tabulated', () => {
  assert.equal(isVerifiedListing(real), true);
  assert.equal(isVerifiedListing({ ...real, source_tag: 'Crexi listing 2026-08' }), true);
  // Guessed / unverified rows are text-only.
  assert.equal(isVerifiedListing({ ...real, source_tag: '[估算]' }), false);
  assert.equal(isVerifiedListing({ ...real, source_tag: '[estimate]' }), false);
  assert.equal(isVerifiedListing({ ...real, source_tag: undefined }), false);
  assert.equal(isVerifiedListing({ ...real, source_tag: 'Yelp' }), false);
  assert.equal(isVerifiedListing({ ...real, address_or_listing: 'El Camino Real 商铺（待核实）' }), false);
  assert.equal(isVerifiedListing({ ...real, address_or_listing: 'Retail space, to be verified' }), false);
  assert.equal(isVerifiedListing({ ...real, highlights: '[估算] 参考同街租金' }), false);
  assert.equal(isVerifiedListing({ ...real, sqft: null }), false);
  assert.equal(isVerifiedListing({ ...real, monthly_rent_usd: '' }), false);
  assert.equal(isVerifiedListing({ ...real, address_or_listing: '' }), false);
  assert.equal(isVerifiedListing('LoopNet'), false);
});

test('corridor listings: filter keeps order and drops everything unverified', () => {
  const rows = verifiedListings([{ ...real, address_or_listing: 'A' }, { ...real, source_tag: '[估算]' }, { ...real, address_or_listing: 'B', source_tag: 'crexi' }]);
  assert.deepEqual(rows.map((r) => r.address_or_listing), ['A', 'B']);
  assert.deepEqual(verifiedListings(null), []);
  assert.deepEqual(verifiedListings([{ address_or_listing: 'x', source_tag: '[estimación]', sqft: 1000, monthly_rent_usd: 5000 }]), []);
});
