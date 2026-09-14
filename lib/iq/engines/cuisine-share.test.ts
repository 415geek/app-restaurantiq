import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../geo';
import { dedupeCandidates, type CandidatePoi } from './competitor';
import { computeCategoryShare, computeConceptShare, computeCuisineShare, conceptCategoryOfPoi, conceptOfPoi } from './cuisine-share';

const site = { lat: 37.5985, lng: -122.3872 };

function poi(id: string, name: string, types: string[], over: Partial<CandidatePoi> = {}): CandidatePoi {
  const p = destination(site, (id.charCodeAt(0) * 37) % 360, 300 + id.length * 90);
  return { id, source: 'google', name, lat: p.lat, lng: p.lng, categories: types, primary_category: types[0] ?? null, operating_status: 'OPERATIONAL', rating: 4.3, rating_count: 200, price_level: 1, ...over };
}

const pool = dedupeCandidates(site, [
  poi('h1', 'Hunan Impression', ['chinese_restaurant']),
  poi('c1', 'Golden Dragon', ['chinese_restaurant']),
  poi('b1', 'Lord Stow Egg Tarts', ['bakery', 'cafe'], { rating_count: 900 }),
  poi('b2', 'Millbrae Bakery', ['bakery'], { rating_count: 150 }),
  poi('b3', 'Sheng Kee', ['bakery'], { rating_count: 400 }),
  poi('i1', 'Cold Stone Creamery', ['ice_cream_shop'], { rating_count: 300 }),
  poi('k1', "Peet's Coffee", ['coffee_shop', 'cafe'], { rating_count: 500 }),
  poi('t1', 'Tea Hut Boba', ['cafe'], { rating_count: 250 }),
  poi('j1', 'Sushi Yoshi', ['japanese_restaurant'], { rating_count: 600 }),
  poi('m1', 'La Taqueria', ['mexican_restaurant'], { rating_count: 1_200 }),
  poi('g1', 'Corner Cafe', ['cafe'], { rating_count: 80 }),
  poi('e1', 'Generic Eatery', ['restaurant'], { rating_count: 40 }),
  poi('x1', 'Dead Bakery', ['bakery'], { operating_status: 'CLOSED_PERMANENTLY' }),
  poi('r1', '99 Ranch Market', ['asian_grocery_store']),
]);

test('conceptOfPoi: sub-cuisine for Chinese POIs, unique types → subtype, shared types → category, unknown food → western_other', () => {
  const by = (id: string) => pool.find((m) => m.id === id)!;
  assert.deepEqual(conceptOfPoi(by('h1')), { id: 'hunan', category: 'chinese_regional', method: 'sub_cuisine' });
  assert.equal(conceptOfPoi(by('b1')).id, 'egg_tart');
  assert.equal(conceptCategoryOfPoi(by('b1')), 'bakery_dessert');
  assert.equal(conceptOfPoi(by('b2')).id, 'bakery');
  assert.equal(conceptCategoryOfPoi(by('b3')), 'bakery_dessert', 'a plain bakery type is the category even without a subtype keyword');
  assert.equal(conceptOfPoi(by('i1')).id, 'ice_cream');
  assert.equal(conceptOfPoi(by('i1')).category, 'bakery_dessert');
  assert.equal(conceptCategoryOfPoi(by('k1')), 'beverage');
  assert.equal(conceptCategoryOfPoi(by('t1')), 'beverage');
  assert.equal(conceptOfPoi(by('j1')).category, 'asian_other');
  assert.equal(conceptOfPoi(by('m1')).id, 'mexican');
  assert.equal(conceptCategoryOfPoi(by('g1')), 'beverage', '"cafe" alone reads as a coffee place');
  assert.deepEqual(conceptOfPoi(by('e1')), { id: null, category: 'western_other', method: 'unknown_food' });
});

test('computeCategoryShare: category share × subtype share of ALL restaurant spend, review-weighted and smoothed', () => {
  const r = computeCategoryShare(pool, 'egg_tart');
  assert.equal(r.basis, 'restaurant_spend');
  assert.equal(r.n_food, 12, 'closed and non-food POIs excluded');
  assert.equal(r.n_category, 4, 'three bakeries + ice cream');
  assert.ok(r.category_share! > 0.2 && r.category_share! < 0.5, String(r.category_share));
  assert.ok(r.subtype_share! > 0.2 && r.subtype_share! < 0.6, String(r.subtype_share));
  assert.ok(Math.abs(r.share - r.category_share! * r.subtype_share!) < 0.002);
  assert.match(r.method, /大众客群/);
  // a subtype absent from local supply keeps a floor, never zero
  const juice = computeCategoryShare(pool, 'juice');
  assert.ok(juice.share > 0 && juice.share < r.share);
  // no food supply at all → prior
  assert.equal(computeCategoryShare([], 'egg_tart').share, 0.03);
});

test('computeConceptShare dispatches on audience; the Chinese path is the legacy computeCuisineShare', () => {
  const chinese = computeConceptShare(pool, 'hunan');
  assert.equal(chinese.basis, 'chinese_spend');
  assert.deepEqual({ share: chinese.share, method: chinese.method, n_chinese: chinese.n_chinese }, { share: computeCuisineShare(pool, 'hunan').share, method: computeCuisineShare(pool, 'hunan').method, n_chinese: computeCuisineShare(pool, 'hunan').n_chinese });
  assert.equal(computeCuisineShare(pool, 'hunan').n_chinese, 2, 'bakeries and coffee shops never enter the Chinese pool');
  const general = computeConceptShare(pool, 'coffee');
  assert.equal(general.basis, 'restaurant_spend');
  assert.ok(general.share > 0);
});
