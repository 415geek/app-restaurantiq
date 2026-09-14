import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONCEPT_CATEGORIES, classifyCuisineText, getTaxonomy } from '@/lib/iq/params';
import { classifyConcept, classifyConceptSync, conceptLabelForPrompt, conceptOptions, resolveConcept } from './classify';
import { classifyConceptWithLlm, conceptClassifierPrompt, resolutionFromLlmAnswer } from './llm-classify';

test('dictionary layer: subtype keywords in Chinese, English and Spanish', () => {
  const cases: Array<[string, string]> = [
    ['葡挞、甜点', 'egg_tart'],
    ['港式茶餐厅', 'hk_cafe'],
    ['奶茶', 'boba'],
    ['Portuguese egg tarts', 'egg_tart'],
    ['pastel de nata', 'egg_tart'],
    ['甜品店', 'dessert'],
    ['麻辣烫', 'mala_tang'],
    ['烧腊', 'roast'],
    ['湘菜 Hunan restaurant', 'hunan'],
    ['sushi & ramen', 'japanese'],
    ['taquería', 'mexican'],
    ['panadería', 'bakery'],
    ['coffee shop', 'coffee'],
    ['潮汕牛肉火锅', 'chaoshan'],
    ['Boiling Point Hot Pot', 'hot_pot'],
  ];
  for (const [text, id] of cases) {
    const r = classifyConceptSync(text);
    assert.equal(r.id, id, `${text} → ${r.id} (matched ${r.matched})`);
    assert.equal(r.method, 'dictionary');
    assert.equal(r.needs_confirmation, false);
    assert.equal(r.confidence, 1);
  }
});

test('no dictionary hit → needs_confirmation, other_chinese kept only as a valid placeholder', () => {
  const r = classifyConceptSync('好吃的');
  assert.equal(r.needs_confirmation, true);
  assert.equal(r.method, 'none');
  assert.equal(r.id, 'other_chinese');
  assert.equal(r.confidence, 0);
  assert.ok(r.options.length >= 30);
  assert.equal(classifyConceptSync('').needs_confirmation, true);
});

test('resolveConcept: an explicit user pick wins (method user); unknown ids fall through to the classifier', async () => {
  const r = await resolveConcept({ text: '好吃的', conceptId: 'egg_tart' });
  assert.equal(r.id, 'egg_tart');
  assert.equal(r.method, 'user');
  assert.equal(r.category, 'bakery_dessert');
  assert.equal(r.needs_confirmation, false);
  const bad = await classifyConcept('好吃的', { allowLlm: false });
  assert.equal(bad.needs_confirmation, true);
  const unknownId = await resolveConcept({ text: '奶茶', conceptId: 'nope' });
  assert.equal(unknownId.id, 'boba');
  assert.equal(unknownId.method, 'dictionary');
});

test('options cover every category, grouped in picker order, with Spanish labels', () => {
  const opts = conceptOptions();
  assert.equal(opts.length, getTaxonomy().cuisines.length);
  for (const cat of CONCEPT_CATEGORIES) assert.ok(opts.some((o) => o.category === cat), cat);
  assert.equal(opts[0].category, 'chinese_regional');
  assert.ok(opts.every((o) => o.label_es.length > 0));
  assert.ok(opts.some((o) => o.id === 'other_chinese'), 'other_chinese stays an explicit choice');
});

test('keyword scope: the POI layer is Chinese-only by default; the concept classifier uses every category', () => {
  assert.equal(classifyCuisineText('Sushi Ran', { scope: 'all' }).id, 'japanese');
  assert.equal(classifyCuisineText("Peet's Coffee", { scope: 'all' }).id, 'coffee');
  assert.equal(classifyCuisineText('Boba Guys', { scope: 'all' }).id, 'boba');
  assert.equal(classifyCuisineText('Sushi Ran').matched, null);
  assert.equal(classifyCuisineText('Millbrae Bakery').matched, null);
  assert.equal(classifyCuisineText('Hunan Home').id, 'hunan');
});

test('LLM layer: answer mapping, threshold and the no-key fast path', async () => {
  assert.equal(await classifyConceptWithLlm('好吃的', { env: () => null }), null);
  const prompt = conceptClassifierPrompt();
  assert.ok(prompt.includes('bakery_dessert') && prompt.includes('egg_tart'));

  const confident = resolutionFromLlmAnswer({ category: 'bakery_dessert', subtype: 'egg_tart', confidence: 0.93 })!;
  assert.equal(confident.id, 'egg_tart');
  assert.equal(confident.method, 'llm');
  assert.equal(confident.needs_confirmation, false);

  const unsure = resolutionFromLlmAnswer({ category: 'beverage', subtype: 'coffee', confidence: 0.55 })!;
  assert.equal(unsure.id, 'coffee', 'guess kept so the picker can pre-select it');
  assert.equal(unsure.needs_confirmation, true);

  const other = resolutionFromLlmAnswer({ category: 'chinese_regional', subtype: 'other', confidence: 0.9 })!;
  assert.equal(other.id, 'other_chinese');
  assert.equal(other.needs_confirmation, true);

  const catOnly = resolutionFromLlmAnswer({ category: 'western_other', subtype: 'steak', confidence: 0.9 })!;
  assert.equal(catOnly.category, 'western_other');
  assert.equal(catOnly.needs_confirmation, true);

  assert.equal(resolutionFromLlmAnswer({ category: 'nope', subtype: 'nope', confidence: 1 }), null);
  assert.equal(resolutionFromLlmAnswer(null), null);

  const viaRunner = await classifyConceptWithLlm('a little shop selling custard tarts', { run: async () => ({ category: 'bakery_dessert', subtype: 'egg_tart', confidence: 0.85 }) });
  assert.equal(viaRunner?.id, 'egg_tart');
  const throwing = await classifyConceptWithLlm('x', { run: async () => { throw new Error('boom'); } });
  assert.equal(throwing, null);
});

test('conceptLabelForPrompt appends the resolved label + category, leaves unresolved text alone', () => {
  assert.equal(conceptLabelForPrompt('葡挞', 'zh'), '葡挞 → 葡挞 / 蛋挞（烘焙 / 甜点）');
  assert.equal(conceptLabelForPrompt('egg tart shop', 'en'), 'egg tart shop → Egg tart / pastel de nata (Bakery / dessert)');
  assert.equal(conceptLabelForPrompt('好吃的', 'es'), '好吃的');
  assert.equal(conceptLabelForPrompt('', 'en'), '');
});
