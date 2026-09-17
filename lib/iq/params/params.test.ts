import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHINESE_CATEGORIES, CONCEPT_CATEGORIES, DAYPART_IDS, DAYPART_SUM_TOLERANCE, classifyCuisineText, cuisineById, cuisinesInCategory, daypartsSchema, findCuisine, getDefaults, getHubs, getTaxonomy, isChineseCategory } from './index';

/** The 14 ids that existed before §4.1; they must keep their ids (fixtures use `hunan`). */
const LEGACY_IDS = ['cantonese', 'hk_cafe', 'dim_sum', 'sichuan', 'hunan', 'dongbei', 'shanghai', 'taiwanese', 'hot_pot', 'skewers', 'noodles', 'chinese_fast', 'boba', 'other_chinese'];

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
  assert.equal(getTaxonomy().cuisines.length, 36);
  assert.equal(getHubs().hubs.length, 16);
});

test('taxonomy §4.1: every legacy id survives, every category has subtypes, every entry carries the downstream parameters', () => {
  const t = getTaxonomy();
  const ids = new Set(t.cuisines.map((c) => c.id));
  assert.equal(ids.size, t.cuisines.length, 'ids unique');
  for (const id of LEGACY_IDS) assert.ok(ids.has(id), `legacy id ${id}`);
  const byCat: Record<string, string[]> = {};
  for (const c of t.cuisines) (byCat[c.category] ??= []).push(c.id);
  assert.deepEqual(Object.keys(byCat).sort(), [...CONCEPT_CATEGORIES].sort());
  assert.deepEqual(byCat.chinese_regional, ['cantonese', 'sichuan', 'hunan', 'dongbei', 'shanghai', 'taiwanese', 'yunnan_guizhou', 'xinjiang', 'chaoshan', 'other_chinese']);
  assert.deepEqual(byCat.chinese_format, ['hk_cafe', 'dim_sum', 'hot_pot', 'skewers', 'noodles', 'mala_tang', 'roast', 'chinese_fast']);
  assert.deepEqual(byCat.asian_other, ['japanese', 'korean', 'vietnamese', 'thai', 'malaysian']);
  assert.deepEqual(byCat.bakery_dessert, ['egg_tart', 'dessert', 'cake', 'ice_cream', 'bakery', 'pastry']);
  assert.deepEqual(byCat.beverage, ['boba', 'coffee', 'juice']);
  assert.deepEqual(byCat.western_other, ['american', 'italian', 'mexican', 'middle_eastern']);
  for (const c of t.cuisines) {
    assert.ok(c.label_es && c.label_es.length > 0, `${c.id} label_es`);
    assert.ok(c.fte_default != null && c.fte_default >= 2, `${c.id} fte_default`);
    assert.ok(c.takeout_share != null && c.takeout_share > 0 && c.takeout_share < 1, `${c.id} takeout_share`);
    assert.ok(c.daypart_profile, `${c.id} daypart_profile`);
    assert.ok(c.search && c.search.keywords.length >= 3 && c.search.types.length >= 1 && c.search.substitutes.length >= 3, `${c.id} search profile`);
    assert.equal(c.audience, CHINESE_CATEGORIES.includes(c.category) ? 'chinese' : 'general', `${c.id} audience follows the category`);
    // `mappings` must be unambiguous: a type that identifies one subtype only (never bakery / cafe / barbecue_restaurant).
    for (const m of c.mappings) assert.ok(!['bakery', 'cafe', 'barbecue_restaurant', 'restaurant', 'chinese_restaurant'].includes(m) || isChineseCategory(c.category), `${c.id} mapping ${m} is ambiguous`);
  }
  // §4.1 parameter table
  const egg = cuisineById('egg_tart');
  assert.equal(egg.fte_default, 4);
  assert.equal(egg.ticket_in, 10);
  assert.equal(egg.takeout_share, 0.75);
  assert.equal(egg.daypart_profile, 'morning_afternoon');
  assert.deepEqual(egg.search!.keywords, ['egg tart', 'pastel de nata', '蛋挞', '葡挞', 'Portuguese bakery']);
  assert.deepEqual(egg.search!.types, ['bakery', 'cafe']);
  const hp = cuisineById('hot_pot');
  assert.equal(hp.fte_default, 10);
  assert.equal(hp.ticket_in, 35);
  assert.equal(hp.takeout_share, 0.15);
  assert.equal(hp.daypart_profile, 'dinner');
  for (const c of cuisinesInCategory('beverage')) {
    assert.equal(c.fte_default, 3);
    assert.ok(c.ticket_in >= 6 && c.ticket_in <= 8, c.id);
    assert.ok(['all_day', 'morning_afternoon'].includes(c.daypart_profile!), c.id);
  }
  for (const c of cuisinesInCategory('bakery_dessert')) {
    assert.ok(c.fte_default! >= 3 && c.fte_default! <= 4, c.id);
    assert.ok(c.ticket_in >= 8 && c.ticket_in <= 12, c.id);
    assert.equal(c.takeout_share, 0.75);
  }
  // hunan keeps the legacy finance defaults byte-identical (12 FTE, 25 % delivery, $24 ticket)
  const hunan = cuisineById('hunan');
  assert.equal(hunan.fte_default, 12);
  assert.equal(hunan.takeout_share, 0.25);
  assert.equal(hunan.ticket_in, 24);
  assert.equal(hunan.range_class, 'destination');
  assert.equal(findCuisine('nope'), null);
  assert.equal(cuisineById('nope').id, 'other_chinese');
});

test('cuisine rule classifier (Chinese sub-cuisines by default; every category with scope all)', () => {
  assert.equal(classifyCuisineText('湘菜 Hunan restaurant').id, 'hunan');
  assert.equal(classifyCuisineText('Hunan Home').id, 'hunan');
  assert.equal(classifyCuisineText('Little Sichuan Restaurant').id, 'sichuan');
  assert.equal(classifyCuisineText('Boiling Point Hot Pot').id, 'hot_pot');
  assert.equal(classifyCuisineText('老四川麻辣烫').id, 'mala_tang');
  assert.equal(classifyCuisineText('Zhang Mama Noodle House').id, 'noodles');
  assert.equal(classifyCuisineText('Canton Roast Duck House').id, 'roast');
  assert.equal(classifyCuisineText('Panda Express').id, 'chinese_fast');
  assert.equal(classifyCuisineText('Golden Dragon').id, 'other_chinese');
  assert.equal(classifyCuisineText('Golden Dragon').matched, null);
  // Dessert keywords: the dessert subtype wins over the legacy boba bucket (defined first, same length and position).
  assert.equal(classifyCuisineText('Meet Fresh Dessert', { scope: 'all' }).id, 'dessert');
  assert.equal(classifyCuisineText('Meet Fresh Dessert').matched, null, 'the POI layer never pins a non-Chinese subtype by name');
  // Non-Chinese names resolve to their own categories only with scope all (competitor engine reads is_chinese from the category).
  for (const [name, id] of [['Sushi Yoshi', 'japanese'], ['Seoul Garden Korean BBQ Kitchen', 'korean'], ["Peet's Coffee", 'coffee'], ['Millbrae Bakery', 'bakery'], ['La Taqueria', 'mexican']] as const) {
    assert.equal(classifyCuisineText(name, { scope: 'all' }).id, id);
    assert.equal(classifyCuisineText(name).matched, null, name);
  }
  assert.equal(classifyCuisineText('Corner Cafe 45', { scope: 'all' }).matched, null, '"cafe" alone is ambiguous (HK cafe vs coffee) and is not a keyword');
  // Longest match wins; equal length → earliest in the text.
  assert.equal(classifyCuisineText('葡挞、甜点', { scope: 'all' }).id, 'egg_tart');
  assert.equal(classifyCuisineText('甜点、葡挞', { scope: 'all' }).id, 'dessert');
  assert.equal(classifyCuisineText('Hong Kong Cafe 茶餐厅', { scope: 'all' }).id, 'hk_cafe');
});

test('§4.3 daypart 按业态取值: every concept carries a four-daypart table summing to 1, with the spec values', () => {
  const t = getTaxonomy();
  for (const c of t.cuisines) {
    const dp = c.dayparts;
    assert.ok(dp, `${c.id} dayparts`);
    const sum = dp.breakfast + dp.lunch + dp.afternoon + dp.dinner;
    assert.ok(Math.abs(sum - 1) <= DAYPART_SUM_TOLERANCE, `${c.id} dayparts sum ${sum}`);
    for (const id of DAYPART_IDS) assert.ok(dp[id] >= 0 && dp[id] <= 1, `${c.id}.${id}`);
  }
  // The four rows the spec fixes by name.
  assert.deepEqual(cuisineById('egg_tart').dayparts, { breakfast: 0.35, lunch: 0.25, afternoon: 0.3, dinner: 0.1 });
  for (const c of cuisinesInCategory('bakery_dessert')) {
    // dessert / ice_cream are the category's afternoon–evening formats and deviate by design (documented in the YAML).
    if (c.id === 'dessert' || c.id === 'ice_cream') continue;
    assert.deepEqual(c.dayparts, { breakfast: 0.35, lunch: 0.25, afternoon: 0.3, dinner: 0.1 }, c.id);
  }
  assert.deepEqual(cuisineById('boba').dayparts, { breakfast: 0.15, lunch: 0.25, afternoon: 0.4, dinner: 0.2 });
  assert.deepEqual(cuisineById('hk_cafe').dayparts, { breakfast: 0.15, lunch: 0.4, afternoon: 0.15, dinner: 0.3 });
  assert.deepEqual(cuisineById('hot_pot').dayparts, { breakfast: 0, lunch: 0.2, afternoon: 0.05, dinner: 0.75 });
  // Category defaults.
  assert.deepEqual(cuisineById('noodles').dayparts, { breakfast: 0.05, lunch: 0.5, afternoon: 0.1, dinner: 0.35 });
  assert.deepEqual(cuisineById('roast').dayparts, { breakfast: 0, lunch: 0.45, afternoon: 0.1, dinner: 0.45 });
  assert.deepEqual(cuisineById('skewers').dayparts, { breakfast: 0, lunch: 0.1, afternoon: 0.05, dinner: 0.85 });
  assert.deepEqual(cuisineById('coffee').dayparts, { breakfast: 0.45, lunch: 0.25, afternoon: 0.25, dinner: 0.05 });
  assert.deepEqual(cuisineById('juice').dayparts, { breakfast: 0.2, lunch: 0.3, afternoon: 0.35, dinner: 0.15 });
  for (const c of cuisinesInCategory('chinese_regional')) {
    assert.deepEqual(c.dayparts, { breakfast: 0, lunch: 0.4, afternoon: 0.05, dinner: 0.55 }, c.id);
  }
});

test('§4.3 the zod schema rejects a daypart table that does not sum to 1', () => {
  assert.throws(() => daypartsSchema.parse({ breakfast: 0.3, lunch: 0.3, afternoon: 0.3, dinner: 0.3 }), /sum to 1/);
  // within the ±0.001 tolerance
  assert.doesNotThrow(() => daypartsSchema.parse({ breakfast: 0.3005, lunch: 0.3, afternoon: 0.2, dinner: 0.2 }));
});
