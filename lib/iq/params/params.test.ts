import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCuisineText, cuisineById, getDefaults, getHubs, getTaxonomy } from './index';

test('parameter tables load and validate', () => {
  const d = getDefaults();
  const w = d.score.weights;
  assert.equal(
    w.demand_coverage + w.audience_fit + w.competitive_position + w.access_traffic + w.financial_viability + w.occasion_delivery,
    100,
  );
  const cw = d.confidence_weights;
  assert.equal(Object.values(cw).reduce((a, b) => a + b, 0), 100);
  assert.equal(d.huff.beta.destination, 1.1);
  assert.equal(getTaxonomy().cuisines.length, 14);
  assert.equal(getHubs().hubs.length, 16);
});

test('cuisine rule classifier', () => {
  assert.equal(classifyCuisineText('湘菜 Hunan restaurant').id, 'hunan');
  assert.equal(classifyCuisineText('Hunan Home').id, 'hunan');
  assert.equal(classifyCuisineText('Little Sichuan Restaurant').id, 'sichuan');
  assert.equal(classifyCuisineText('Boiling Point Hot Pot').id, 'hot_pot');
  assert.equal(classifyCuisineText('老四川麻辣烫').id, 'noodles');
  assert.equal(classifyCuisineText('Panda Express').id, 'chinese_fast');
  assert.equal(classifyCuisineText('Golden Dragon').id, 'other_chinese');
  assert.equal(cuisineById('nope').id, 'other_chinese');
});
