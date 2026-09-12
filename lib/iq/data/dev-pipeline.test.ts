import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import { buildDevPipelineQuery, extractExpectedDelivery, extractUnitsOrSqft, fetchDevPipeline } from './dev-pipeline';
import type { FetchContext } from './types';

const fixture = readFileSync(join(process.cwd(), 'qa', 'fixtures', 'tavily_dev_pipeline.json'), 'utf8');

function makeCtx(opts: { body?: string; env?: Record<string, string> } = {}) {
  const calls: string[] = [];
  const env = opts.env ?? { TAVILY_API_KEY: 'tvly-test' };
  const ctx: FetchContext = {
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.startsWith('https://api.tavily.com/search')) return new Response(opts.body ?? fixture, { status: 200 });
      if (url.startsWith('https://api.search.brave.com/')) {
        return new Response(JSON.stringify({ web: { results: [{ title: 'Brave project approved', url: 'https://b.example/p', description: '50 units, 2027' }] } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch,
    cost: createCostLedger(),
    cache: createMemoryCache(),
    env: (name) => env[name] ?? null,
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
  };
  return { ctx, calls };
}

const input = { city: 'Millbrae', state: 'CA', address: '1711 El Camino Real, Millbrae, CA 94030' };

test('D11 query + token extraction', () => {
  assert.equal(
    buildDevPipelineQuery(input, 2026),
    'Millbrae CA planning "under construction" OR "approved" mixed-use OR apartments OR development 2026',
  );
  assert.equal(extractExpectedDelivery('Phase 2 is expected to deliver in Q3 2026.', 2026), 'Q3 2026');
  assert.equal(extractExpectedDelivery('begin in 2026 with completion targeted for 2028', 2026), '2028');
  assert.equal(extractExpectedDelivery('completed in 2019', 2026), null);
  assert.equal(extractUnitsOrSqft('includes 400 residential units and 44,000 square feet of retail'), '400 units');
  assert.equal(extractUnitsOrSqft('8,500 sq ft of ground-floor retail'), '8,500 SF');
  assert.equal(extractUnitsOrSqft('nothing quantified'), null);
});

test('D11 dev pipeline: ok → ≤6 projects with URLs, delivery + size tokens, risk-hint note, one search', async () => {
  const { ctx, calls } = makeCtx();
  const r = await fetchDevPipeline(input, ctx);
  assert.equal(r.id, 'D11');
  assert.equal(r.status, 'ok');
  assert.ok(r.data);
  assert.equal(r.data.query, buildDevPipelineQuery(input, 2026));
  assert.equal(r.data.projects.length, 6, 'cap 6 (fixture has 7 with URLs + 1 without)');
  assert.ok(r.data.projects.every((p) => /^https:\/\//.test(p.url)));
  assert.ok(!r.data.projects.some((p) => p.source_title.includes('without a link')));

  const gateway = r.data.projects[0];
  assert.match(gateway.name, /Gateway at Millbrae Station/);
  assert.equal(gateway.expected_delivery, 'Q3 2026');
  assert.equal(gateway.units_or_sqft, '400 units');

  const ecr = r.data.projects.find((p) => p.url.includes('millbrae-approves-el-camino-project'));
  assert.equal(ecr?.expected_delivery, '2028');
  assert.equal(ecr?.units_or_sqft, '150 units');

  const plan = r.data.projects.find((p) => p.url.endsWith('/msasp'));
  assert.equal(plan?.expected_delivery, null, 'no future year token in the specific-plan snippet');

  assert.match(r.coverage_note, /仅作供给侧风险提示，不计入当前需求/);
  assert.equal(calls.length, 1);
  assert.equal(r.cost_usd, 0.03);
  assert.equal(r.cache, 'miss');

  const r2 = await fetchDevPipeline(input, ctx);
  assert.equal(r2.cache, 'hit');
  assert.equal(r2.cost_usd, 0);
  assert.equal(calls.length, 1);
  assert.equal(r2.data?.projects.length, 6);
});

test('D11 dev pipeline: empty results → ok with 0 projects and 检索无结果', async () => {
  const { ctx } = makeCtx({ body: JSON.stringify({ results: [] }) });
  const r = await fetchDevPipeline(input, ctx);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.data?.projects, []);
  assert.match(r.coverage_note, /检索无结果/);
  assert.match(r.coverage_note, /不计入当前需求/);
});

test('D11 dev pipeline: no key → failed with 未获取（无搜索 key）', async () => {
  const { ctx, calls } = makeCtx({ env: {} });
  const r = await fetchDevPipeline(input, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(r.data, null);
  assert.match(r.coverage_note, /未获取（无搜索 key）/);
  assert.equal(r.cost_usd, 0);
  assert.equal(calls.length, 0);
});

test('D11 dev pipeline: HTTP error → failed but cost still booked', async () => {
  const { ctx } = makeCtx();
  ctx.fetch = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
  const r = await fetchDevPipeline(input, ctx);
  assert.equal(r.status, 'failed');
  assert.match(r.error ?? '', /HTTP 429/);
  assert.equal(r.cost_usd, 0.03);
});

test('D11 dev pipeline: Brave alternative', async () => {
  const { ctx } = makeCtx({ env: { BRAVE_SEARCH_API_KEY: 'b' } });
  const r = await fetchDevPipeline(input, ctx);
  assert.equal(r.status, 'ok');
  assert.equal(r.data?.projects.length, 1);
  assert.equal(r.data?.projects[0].expected_delivery, '2027');
  assert.equal(r.data?.projects[0].units_or_sqft, '50 units');
  assert.equal(r.cost_usd, 0.005);
});
