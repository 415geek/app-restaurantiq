import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSiteMetrics } from './metrics';

test('computeSiteMetrics (§4.2): Layer 1 ranks first, brand anchors are never counted or listed', () => {
  const m = computeSiteMetrics({
    businessType: 'egg tart bakery',
    marketData: {
      summary: {
        competitor_count_google: 3,
        competitor_layers: { direct: 2, substitute: 1, brand_anchor: 1 },
        avg_rating_google: 4.5,
        avg_review_count_google: 1000,
        sample_competitors_google: [
          { name: 'Toy Boat Dessert Cafe', rating: 4.6, reviews: 5000, price_level: 1, layer: 'substitute', walk_min: 6 },
          { name: 'Tartine Manufactory', rating: 4.7, reviews: 30000, price_level: 2, layer: 'brand_anchor' },
          { name: 'Breadbelly', rating: 4.4, reviews: 900, price_level: 2, layer: 'direct', walk_min: 3 },
          { name: "Schubert's Bakery", rating: 4.6, reviews: 1500, price_level: 2, layer: 'direct', walk_min: 9 },
        ],
      },
    },
  });
  const c = m.competition;
  assert.equal(c.competitor_count, 3, 'Layer 1 + 2 only');
  assert.deepEqual(
    c.top_competitors.map((x) => `${x.layer}:${x.name}`),
    ['direct:Schubert\'s Bakery', 'direct:Breadbelly', 'substitute:Toy Boat Dessert Cafe'],
    'direct first (attractiveness within a layer), then substitute; no brand anchor',
  );
  assert.equal(c.top_competitors[0].walk_min, 9);
  assert.ok(!c.top_competitors.some((x) => x.name.startsWith('Tartine')));
  const expectedTotal = Math.round((4.6 * Math.log(5001) + 4.4 * Math.log(901) + 4.6 * Math.log(1501)) * 10) / 10;
  assert.equal(c.total_attractiveness, expectedTotal, 'anchor excluded from the Huff denominator');
  assert.ok(m.data_sources.some((s) => s.includes('three-layer')));
});

test('computeSiteMetrics: legacy samples without layers keep the attractiveness ordering', () => {
  const m = computeSiteMetrics({
    businessType: 'hot pot',
    marketData: { summary: { sample_competitors_google: [{ name: 'A', rating: 4.0, reviews: 10 }, { name: 'B', rating: 4.8, reviews: 2000 }] } },
  });
  assert.deepEqual(m.competition.top_competitors.map((x) => x.name), ['B', 'A']);
  assert.equal(m.competition.competitor_count, 2);
  assert.ok(m.data_sources.some((s) => s.includes('textsearch')));
});
