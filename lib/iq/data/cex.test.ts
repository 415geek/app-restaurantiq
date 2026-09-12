import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchContext, createMemoryCache } from './context';
import { CEX_2023_TABLE, CEX_EXTRAPOLATION_CAP, cexFafhForHousehold, fetchCex, pickQuintile } from './cex';

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('D10 table shape: 5 ascending quintiles with shares', () => {
  const q = CEX_2023_TABLE.quintiles;
  assert.equal(q.length, 5);
  assert.deepEqual(
    q.map((x) => x.quintile),
    ['lowest', 'second', 'third', 'fourth', 'highest'],
  );
  for (let i = 1; i < q.length; i++) {
    assert.ok(q[i].income_after_taxes > q[i - 1].income_after_taxes);
    assert.ok(q[i].food_away_from_home_usd > q[i - 1].food_away_from_home_usd);
  }
  assert.deepEqual(
    q.map((x) => x.food_away_from_home_usd),
    [1668, 2441, 3286, 4383, 7246],
  );
  near(q[4].share_of_after_tax_income, 7246 / 210_000, 1e-4);
  assert.match(CEX_2023_TABLE.note, /scripts\/refresh-cex\.ts/);
});

test('D10 pickQuintile uses midpoints between quintile means', () => {
  assert.equal(pickQuintile(10_000), 'lowest');
  assert.equal(pickQuintile(27_749), 'lowest');
  assert.equal(pickQuintile(27_750), 'second');
  assert.equal(pickQuintile(60_000), 'third');
  assert.equal(pickQuintile(150_000), 'fourth');
  assert.equal(pickQuintile(153_000), 'highest');
  assert.equal(pickQuintile(1_000_000), 'highest');
  assert.equal(pickQuintile(Number.NaN), 'lowest');
});

test('D10 interpolation between quintile points', () => {
  // exactly on a point
  const on = cexFafhForHousehold(39_000);
  assert.equal(on.usd, 2441);
  assert.equal(on.method, 'interpolated');
  // halfway between second (39k → 2441) and third (61k → 3286)
  const mid = cexFafhForHousehold(50_000);
  near(mid.usd, 2863.5);
  assert.equal(mid.quintile, 'third'); // 50k is exactly the second/third midpoint boundary
  assert.equal(cexFafhForHousehold(49_000).quintile, 'second');
  near(mid.share ?? 0, 2863.5 / 50_000, 1e-6);
  // Millbrae-like MHI 128,500 between fourth (96k → 4383) and highest (210k → 7246)
  const mb = cexFafhForHousehold(128_500);
  near(mb.usd, 4383 + ((128_500 - 96_000) / (210_000 - 96_000)) * (7246 - 4383));
  assert.equal(mb.quintile, 'fourth');
  assert.equal(mb.method, 'interpolated');
});

test('D10 extrapolation above highest quintile: share-based, capped at 1.2× highest', () => {
  const share = CEX_2023_TABLE.quintiles[4].share_of_after_tax_income;
  const cap = 7246 * CEX_EXTRAPOLATION_CAP;
  const modest = cexFafhForHousehold(220_000);
  near(modest.usd, 220_000 * share);
  assert.ok(modest.usd < cap);
  assert.equal(modest.method, 'extrapolated');
  assert.equal(modest.quintile, 'highest');

  const rich = cexFafhForHousehold(300_000);
  near(rich.usd, cap);
  assert.equal(rich.method, 'extrapolated_capped');
  assert.equal(cexFafhForHousehold(2_000_000).usd, rich.usd);
});

test('D10 below lowest quintile: scaled by lowest share, never negative', () => {
  const low = cexFafhForHousehold(10_000);
  near(low.usd, 10_000 * CEX_2023_TABLE.quintiles[0].share_of_after_tax_income);
  assert.equal(low.method, 'below_lowest');
  const zero = cexFafhForHousehold(0);
  assert.equal(zero.usd, 0);
  assert.equal(zero.share, null);
  assert.equal(cexFafhForHousehold(-5_000).usd, 0);
});

test('D10 fetchCex is static: ok, cost 0, no cache, no network', async () => {
  let fetched = 0;
  const ctx = createFetchContext({
    fetch: (async () => {
      fetched++;
      return new Response('{}');
    }) as unknown as typeof fetch,
    cache: createMemoryCache(),
    env: () => null,
    log: () => {},
    now: () => new Date('2026-09-12T00:00:00Z'),
  });
  const r = await fetchCex(null, ctx);
  assert.equal(r.id, 'D10');
  assert.equal(r.status, 'ok');
  assert.equal(r.cost_usd, 0);
  assert.equal(r.cache, 'none');
  assert.equal(r.data, CEX_2023_TABLE);
  assert.equal(r.fetched_at, '2026-09-12T00:00:00.000Z');
  assert.equal(fetched, 0);
  assert.match(r.source, /Table 1101/);
  assert.match(r.coverage_note, /税前中位数/);
});
