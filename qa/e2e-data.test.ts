/**
 * Phase 1 acceptance (offline replay of the Millbrae golden case):
 *  - D2 returns tract-level Chinese ancestry + income
 *  - D5 ≥ 30 food POIs within 1 mi, ≥ 10 Chinese
 *  - D6 ≤ 6 calls
 *  - every source has a status; data cost ≤ $0.10
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAllData, sourcesFromResults } from '@/lib/iq/data';
import { fetchLodes } from '@/lib/iq/data/lodes';
import { fetchOverturePois } from '@/lib/iq/data/overture';
import { fetchTrafficProxy } from '@/lib/iq/data/traffic-proxy';
import { normalizeUserInputs } from '@/lib/iq/data/user-inputs';
import { getDefaults } from '@/lib/iq/params';
import { createOfflineContext } from './fixtures/router';

const golden = JSON.parse(readFileSync(join(process.cwd(), 'qa/golden_set/millbrae_1711.json'), 'utf8')) as { input: Record<string, unknown> & { address: string } };

export async function runMillbraeData(opts: Parameters<typeof createOfflineContext>[0] = {}) {
  const { ctx, deps, calls } = createOfflineContext(opts);
  const { input, result } = normalizeUserInputs({
    report_id: 'golden-millbrae',
    address: golden.input.address,
    cuisine_text: String(golden.input.business_type_raw),
    language: 'zh',
    rent_usd: golden.input.rent_usd,
    sqft: golden.input.sqft,
    seats: golden.input.seats,
    ticket_in: golden.input.ticket_in,
    ticket_delivery: golden.input.ticket_delivery,
    delivery_ratio: golden.input.delivery_ratio,
    listing_urls: ['https://listings.example/1711-el-camino-real'],
  });
  const bundle = await fetchAllData(input, result, ctx, {
    overture: (i, c) => fetchOverturePois(i, c, { poiQuery: deps.poiQuery }),
    lodes: (i, c) => fetchLodes(i, c, { wacQuery: deps.wacQuery }),
    traffic: (i, c) => fetchTrafficProxy(i, c, { snapshotQuery: deps.snapshotQuery }),
  });
  return { bundle, ctx, calls };
}

test('Phase 1 acceptance: Millbrae data bundle', async () => {
  const { bundle, ctx } = await runMillbraeData();
  assert.equal(bundle.fatal, null);
  assert.equal(bundle.site.cuisine, 'hunan');
  assert.equal(bundle.geocode.data?.geography.tract, '06081602300');
  assert.equal(bundle.geocode.data?.metro, 'sf-bay');

  // D2: tract-level Chinese ancestry and income exist (R2 can no longer happen for a resolvable address)
  const acs = bundle.acs!.data!;
  assert.ok(acs.tracts.some((t) => t.chinese_pop != null && t.chinese_pop > 0), 'tract Chinese pop');
  assert.ok(acs.block_groups.some((b) => b.median_income != null), 'BG income');
  assert.ok(acs.block_groups.some((b) => b.geometry), 'BG geometry');
  assert.notEqual(bundle.acs!.status, 'failed');

  // D5: ≥ 30 food POIs within 1 mi incl. ≥ 10 Chinese; D6 ≤ 6 calls
  const ov = bundle.overture!.data!;
  const within1mi = ov.pois.filter((p) => p.distance_m <= 1609);
  assert.ok(within1mi.length >= 30, `overture within 1 mi = ${within1mi.length}`);
  assert.ok(within1mi.filter((p) => p.sub_cuisine && p.sub_cuisine !== 'boba').length >= 10);
  assert.ok(bundle.google!.data!.calls_made <= getDefaults().data_budget.google_places_max_calls);

  // sources[] complete with statuses
  const sources = sourcesFromResults(bundle.results);
  assert.equal(sources.length, 12, sources.map((s) => s.id).join(','));
  for (const s of sources) assert.ok(['ok', 'partial', 'failed'].includes(s.status), `${s.id} has status`);
  assert.ok(sources.every((s) => s.coverage_note.length > 0));

  // cost ≤ $0.10 for data
  const total = ctx.cost.total();
  assert.ok(total <= 0.1, `data cost $${total}`);
  assert.ok(bundle.elapsed_ms < 10_000);
});

test('Phase 1 degradation: no Mapbox → radius rings, flagged; competitors down → failed sources, never estimates', async () => {
  const { bundle } = await runMillbraeData({ noMapbox: true, competitorsDown: true });
  assert.equal(bundle.isochrones!.status, 'partial');
  assert.equal(bundle.isochrones!.degraded_from, 'mapbox');
  assert.ok(bundle.isochrones!.coverage_note.includes('直线半径'));
  assert.equal(bundle.google!.status, 'failed');
  assert.equal(bundle.overture!.status, 'failed');
  assert.equal(bundle.overture!.data?.loaded ?? false, false);
});
