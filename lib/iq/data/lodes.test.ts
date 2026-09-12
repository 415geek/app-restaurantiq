import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { fetchLodes, resolveTractList, type LodesWacRow } from './lodes';
import type { CensusGeography, FetchContext } from './types';

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'qa', 'fixtures', 'lodes_wac_sample.json'), 'utf8')) as {
  rows: LodesWacRow[];
};

const geography: CensusGeography = {
  block: '060816017001001',
  block_group: '060816017001',
  tract: '06081601700',
  county: '06081',
  state: '06',
  zcta: '94030',
  county_name: 'San Mateo County',
  state_abbr: 'CA',
};

function makeCtx(): FetchContext & { cache: ReturnType<typeof createMemoryCache> } {
  const cache = createMemoryCache();
  return {
    fetch: (async () => {
      throw new Error('network disabled in tests');
    }) as unknown as typeof fetch,
    cost: createCostLedger(),
    cache,
    env: () => null,
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
  };
}

test('D3 lodes: ok path aggregates blocks for the requested tracts and caches', async () => {
  const ctx = makeCtx();
  const calls: Array<{ tracts: string[]; year: number }> = [];
  const wacQuery = async (tracts: string[], year: number) => {
    calls.push({ tracts, year });
    return year === 2022 ? fixture.rows : [];
  };

  const r = await fetchLodes({ geography, tractGeoids: ['06081601700', '06081601800'] }, ctx, { wacQuery });
  assert.equal(r.id, 'D3');
  assert.equal(r.status, 'ok');
  assert.equal(r.cache, 'miss');
  assert.equal(r.cost_usd, 0);
  assert.ok(r.data);
  assert.equal(r.data.method, 'lodes_wac');
  assert.equal(r.data.year, 2022);
  assert.equal(r.data.by_block.length, 5);
  assert.equal(r.data.total_jobs, 412 + 138 + 27 + 980 + 61);
  const big = r.data.by_block.find((b) => b.block_geoid === '060816018001001');
  assert.ok(big);
  assert.equal(big.accommodation_food, 150);
  assert.equal(big.asian, 410);
  // null cr04 → 0, never invented
  assert.equal(r.data.by_block.find((b) => b.block_geoid === '060816018002005')?.asian, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { tracts: ['06081601700', '06081601800'], year: 2022 });
  assert.match(r.coverage_note, /LODES 2022 WAC/);

  // second call → cache hit, no query
  const r2 = await fetchLodes({ geography, tractGeoids: ['06081601800', '06081601700'] }, ctx, { wacQuery });
  assert.equal(r2.cache, 'hit');
  assert.equal(r2.status, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(r2.data?.total_jobs, r.data.total_jobs);
});

test('D3 lodes: tract without rows → partial with the covered subset', async () => {
  const ctx = makeCtx();
  const r = await fetchLodes(
    { geography, tractGeoids: ['06081601700', '06081601800', '06081601900'] },
    ctx,
    { wacQuery: async () => fixture.rows },
  );
  assert.equal(r.status, 'partial');
  assert.equal(r.data?.method, 'lodes_wac');
  assert.match(r.coverage_note, /覆盖 2\/3 个 tract/);
  assert.match(r.coverage_note, /06081601900/);
});

test('D3 lodes: empty table → partial + acs_b08301_estimate fallback after trying 2022 then 2021', async () => {
  const ctx = makeCtx();
  const years: number[] = [];
  const r = await fetchLodes({ geography, tractGeoids: ['06081601700'] }, ctx, {
    wacQuery: async (_t, year) => {
      years.push(year);
      return [];
    },
  });
  assert.deepEqual(years, [2022, 2021]);
  assert.equal(r.status, 'partial');
  assert.equal(r.data?.method, 'acs_b08301_estimate');
  assert.deepEqual(r.data?.by_block, []);
  assert.equal(r.data?.total_jobs, 0);
  assert.equal(r.degraded_from, 'lodes_wac');
  assert.match(r.coverage_note, /LODES 未加载 → 用 ACS B08301 反推 \(置信度 0\.5\)/);
  assert.equal(ctx.cache.size(), 0, 'fallback must not be cached');
});

test('D3 lodes: unreachable table → partial fallback with error, never throws', async () => {
  const ctx = makeCtx();
  const r = await fetchLodes({ geography, tractGeoids: ['06081601700'], year: 2022 }, ctx, {
    wacQuery: async () => {
      throw new Error('connection refused');
    },
  });
  assert.equal(r.status, 'partial');
  assert.equal(r.data?.method, 'acs_b08301_estimate');
  assert.match(r.error ?? '', /connection refused/);
  assert.match(r.coverage_note, /不可达/);
  assert.match(r.coverage_note, /ACS B08301/);
});

test('D3 lodes: no valid tract ids → failed', async () => {
  const ctx = makeCtx();
  const r = await fetchLodes({ geography: { ...geography, tract: '' }, tractGeoids: ['abc'] }, ctx, {
    wacQuery: async () => fixture.rows,
  });
  assert.equal(r.status, 'failed');
  assert.equal(r.data, null);
});

test('D3 lodes: resolveTractList merges block prefixes and dedupes', () => {
  assert.deepEqual(
    resolveTractList({ geography, tractGeoids: ['06081601800', '06081601800'], blockGeoids: ['060816017001001'] }),
    ['06081601700', '06081601800'],
  );
  assert.deepEqual(resolveTractList({ geography, tractGeoids: [] }), ['06081601700']);
});
