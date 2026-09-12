import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostLedger, createMemoryCache } from './context';
import {
  buildRentSearchQuery,
  fetchRentComps,
  parseRentText,
  runWebSearch,
  streetFromAddress,
  type RentCompsInput,
} from './rent-comps';
import type { FetchContext } from './types';

const FIX = join(process.cwd(), 'qa', 'fixtures');
const tavilyFixture = readFileSync(join(FIX, 'tavily_rent_search.json'), 'utf8');
const listingHtml = readFileSync(join(FIX, 'listing_page_sample.html'), 'utf8');

interface StubOpts {
  tavilyBody?: string;
  env?: Record<string, string>;
}

function makeCtx(opts: StubOpts = {}) {
  const calls: string[] = [];
  const cache = createMemoryCache();
  const env = opts.env ?? { TAVILY_API_KEY: 'tvly-test' };
  const ctx: FetchContext = {
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.startsWith('https://api.tavily.com/search')) {
        return new Response(opts.tavilyBody ?? tavilyFixture, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('https://api.search.brave.com/')) {
        return new Response(
          JSON.stringify({ web: { results: [{ title: 'Brave hit', url: 'https://x.example/1', description: '1,500 SF at $4.00/SF/MO' }] } }),
          { status: 200 },
        );
      }
      if (url === 'https://listings.example/1711-el-camino-real') {
        return new Response(listingHtml, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url === 'https://listings.example/404') return new Response('nope', { status: 404 });
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch,
    cost: createCostLedger(),
    cache,
    env: (name) => env[name] ?? null,
    now: () => new Date('2026-09-12T00:00:00Z'),
    log: () => {},
    budgetMs: 40_000,
  };
  return { ctx, calls, cache };
}

const baseInput: RentCompsInput = {
  address: '1711 El Camino Real, Millbrae, CA 94030',
  city: 'Millbrae',
  state: 'CA',
  lat: 37.6003,
  lng: -122.3868,
  userRentUsd: 12_000,
  userSqft: 2_200,
  listingUrls: ['https://listings.example/1711-el-camino-real'],
};

test('D8 parseRentText: monthly, annual (÷12), unit-less heuristic, sqft, monthly total', () => {
  assert.equal(parseRentText('Rate: $4.25/SF/MO NNN, 2,200 SF').psf_month, 4.25);
  assert.equal(parseRentText('asking $54.00/SF/YR').psf_month, 4.5);
  assert.equal(parseRentText('$3.95 per sq ft per month').psf_month, 3.95);
  const inferred = parseRentText('Retail at $48/SF NNN');
  assert.equal(inferred.psf_month, 4);
  assert.equal(inferred.psf_unit, 'inferred_year');
  assert.equal(parseRentText('2,200 SF available').sqft, 2200);
  assert.equal(parseRentText('$4.25/SF/MO').sqft, null, 'the 25 in $4.25/SF must not read as sqft');
  assert.equal(parseRentText('Lease: $8,500/mo').monthly_rent_usd, 8500);
  assert.equal(parseRentText('building for sale at $850/SF').psf_month, null, 'sale price outside lease window');
});

test('D8 streetFromAddress + query shape', () => {
  assert.equal(streetFromAddress('1711 El Camino Real, Millbrae, CA 94030'), 'El Camino Real');
  assert.equal(streetFromAddress('200 Broadway Suite 4, Millbrae, CA'), 'Broadway');
  assert.equal(streetFromAddress('Millbrae, CA'), 'Millbrae');
  assert.equal(
    buildRentSearchQuery(baseInput),
    '"Millbrae, CA" retail restaurant space for lease "El Camino Real" $/SF',
  );
});

test('D8 rent comps: listing + ONE search → median, premium with ≥3 comps, annual converted', async () => {
  const { ctx, calls } = makeCtx();
  const r = await fetchRentComps(baseInput, ctx);
  assert.equal(r.id, 'D8');
  assert.equal(r.status, 'ok', r.coverage_note);
  assert.ok(r.data);
  assert.equal(r.data.subject_psf_month, 5.45);
  assert.equal(r.data.search_query, buildRentSearchQuery(baseInput));

  const listing = r.data.comps.find((c) => c.source === 'user_listing');
  assert.ok(listing);
  assert.equal(listing.rent_psf_month, 4.25);
  assert.equal(listing.sqft, 2200);
  assert.match(listing.address_or_label, /1711 El Camino Real/);

  const web = r.data.comps.filter((c) => c.source === 'web_search');
  assert.equal(web.length, 5, 'five usable search comps; planning page + for-sale price ignored');
  const annual = web.find((c) => c.url?.includes('crexi.com'));
  assert.equal(annual?.rent_psf_month, 4.5, '$54/SF/YR → $4.50/SF/mo');
  assert.equal(annual?.sqft, 2400);
  assert.match(annual?.snippet ?? '', /年租金 ÷12/);
  assert.ok(!web.some((c) => c.url?.includes('55555555')), 'for-sale listing excluded');

  const sample = r.data.comps.filter((c) => c.source !== 'user_input').length;
  assert.equal(sample, 6);
  assert.equal(r.data.sample_sufficient, true);
  assert.equal(r.data.comp_median_psf_month, 4.38);
  assert.ok(r.data.premium_pct != null && r.data.premium_pct > 20 && r.data.premium_pct < 30, String(r.data.premium_pct));
  assert.ok(!r.coverage_note.includes('[样本不足]'));

  assert.equal(calls.filter((u) => u.startsWith('https://api.tavily.com')).length, 1, 'exactly one search call');
  assert.equal(r.cost_usd, 0.03);
  assert.equal(ctx.cost.bySource().search, 0.03);
  assert.equal(r.cache, 'miss');

  // second run: search served from cache, no new cost, listing refetched
  const r2 = await fetchRentComps(baseInput, ctx);
  assert.equal(r2.cache, 'hit');
  assert.equal(r2.cost_usd, 0);
  assert.equal(calls.filter((u) => u.startsWith('https://api.tavily.com')).length, 1);
  assert.equal(r2.data?.comp_median_psf_month, 4.38);
});

test('D8 rent comps: fewer than 3 comps → premium null + [样本不足]', async () => {
  const oneResult = JSON.stringify({
    results: [
      { title: 'Only comp', url: 'https://only.example/a', content: '1,000 SF at $4.00/SF/MO' },
      { title: 'No price here', url: 'https://only.example/b', content: 'Great retail corridor.' },
    ],
  });
  const { ctx } = makeCtx({ tavilyBody: oneResult });
  const r = await fetchRentComps({ ...baseInput, listingUrls: [] }, ctx);
  assert.equal(r.status, 'partial');
  assert.ok(r.data);
  assert.equal(r.data.comps.filter((c) => c.source === 'web_search').length, 1);
  assert.equal(r.data.comp_median_psf_month, 4);
  assert.equal(r.data.premium_pct, null);
  assert.equal(r.data.sample_sufficient, false);
  assert.match(r.coverage_note, /\[样本不足\]/);
  assert.equal(r.cost_usd, 0.03);
});

test('D8 rent comps: no search key → partial, subject psf still computed, no cost', async () => {
  const { ctx, calls } = makeCtx({ env: {} });
  const r = await fetchRentComps({ ...baseInput, listingUrls: [] }, ctx);
  assert.equal(r.status, 'partial');
  assert.equal(r.data?.subject_psf_month, 5.45);
  assert.equal(r.data?.search_query, null);
  assert.equal(r.data?.premium_pct, null);
  assert.match(r.coverage_note, /无搜索 key/);
  assert.match(r.coverage_note, /\[样本不足\]/);
  assert.equal(r.cost_usd, 0);
  assert.equal(calls.length, 0);
});

test('D8 rent comps: nothing at all → failed (no invented numbers)', async () => {
  const { ctx } = makeCtx({ env: {} });
  const r = await fetchRentComps({ ...baseInput, userRentUsd: null, userSqft: null, listingUrls: ['https://listings.example/404'] }, ctx);
  assert.equal(r.status, 'failed');
  assert.equal(r.data?.comps.length, 0);
  assert.equal(r.data?.subject_psf_month, null);
  assert.match(r.coverage_note, /HTTP 404/);
});

test('D8 runWebSearch: Brave alternative records $0.005', async () => {
  const { ctx, calls } = makeCtx({ env: { BRAVE_SEARCH_API_KEY: 'brave-test' } });
  const out = await runWebSearch('test query', ctx);
  assert.equal(out.provider, 'brave');
  assert.equal(out.hits.length, 1);
  assert.equal(out.cost_usd, 0.005);
  assert.equal(ctx.cost.bySource().search, 0.005);
  assert.ok(calls[0].startsWith('https://api.search.brave.com/res/v1/web/search?q=test'));
});
