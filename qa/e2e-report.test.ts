/**
 * Phase 2/3/4 acceptance on the Millbrae golden case (offline fixtures):
 *  - four rings, coverage_ratio explainable (intermediates present)
 *  - cuisine → 中式快餐 moves the primary ring to drive5 and changes capture
 *  - L1 ≥ 1 / L2 ≥ 15 / L4 ≥ 1; emptied POI table trips the guard
 *  - reconciliation: one score(), weights = 100, scenarios self-consistent,
 *    payback null without CapEx, alternatives table
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchLodes } from '@/lib/iq/data/lodes';
import { fetchOverturePois } from '@/lib/iq/data/overture';
import { fetchTrafficProxy } from '@/lib/iq/data/traffic-proxy';
import { runReport360 } from '@/lib/iq/pipeline';
import { reportModelSchema } from '@/lib/iq/model/schema';
import { createOfflineContext } from './fixtures/router';

const golden = JSON.parse(readFileSync(join(process.cwd(), 'qa/golden_set/millbrae_1711.json'), 'utf8')) as { input: Record<string, unknown> & { address: string } };

export async function runMillbrae(over: { cuisine_text?: string; competitorsDown?: boolean; skipAlternatives?: boolean } = {}) {
  const { ctx, deps } = createOfflineContext({ competitorsDown: over.competitorsDown });
  return runReport360(
    {
      report_id: 'golden-millbrae',
      address: golden.input.address,
      cuisine_text: over.cuisine_text ?? String(golden.input.business_type_raw),
      language: 'zh',
      rent_usd: golden.input.rent_usd,
      sqft: golden.input.sqft,
      seats: golden.input.seats,
      ticket_in: golden.input.ticket_in,
      ticket_delivery: golden.input.ticket_delivery,
      delivery_ratio: golden.input.delivery_ratio,
      listing_urls: ['https://listings.example/1711-el-camino-real'],
    },
    {
      ctx,
      llmClassify: null,
      skipAlternatives: over.skipAlternatives ?? false,
      fetchers: {
        overture: (i, c) => fetchOverturePois(i, c, { poiQuery: deps.poiQuery }),
        lodes: (i, c) => fetchLodes(i, c, { wacQuery: deps.wacQuery }),
        traffic: (i, c) => fetchTrafficProxy(i, c, { snapshotQuery: deps.snapshotQuery }),
      },
    },
  );
}

test('Phase 2: four rings, explainable coverage ratio, range_class drives the primary ring', async () => {
  const { model, intermediates } = await runMillbrae({ skipAlternatives: true });
  assert.deepEqual(model.trade_area.rings.map((r) => r.id), ['walk10', 'drive5', 'drive10', 'drive15']);
  const d15 = model.trade_area.rings[3];
  assert.ok(d15.pop != null && d15.pop > 0, 'drive15 pop');
  assert.ok(d15.hh != null && d15.median_income != null && d15.chinese_hh_share != null);
  assert.ok(d15.cuisine_demand_usd != null && d15.cuisine_demand_usd > 0);
  assert.equal(model.trade_area.primary_ring, 'drive15');
  // coverage_ratio = captured / breakeven, with every intermediate on the model
  assert.ok(model.demand.captured_monthly_usd != null && model.demand.captured_monthly_usd > 0);
  assert.ok(model.finance.breakeven_monthly != null);
  assert.equal(model.demand.coverage_ratio, Math.round((model.demand.captured_monthly_usd! / model.finance.breakeven_monthly!) * 1000) / 1000);
  assert.ok(intermediates.huff.p_distribution, 'P value distribution printed');
  assert.ok(model.demand.by_ring.length >= 1);
  assert.ok(model.demand.cuisine_share > 0 && model.demand.cuisine_share <= 0.5);

  const fast = await runMillbrae({ cuisine_text: '中式快餐', skipAlternatives: true });
  assert.equal(fast.model.input.cuisine, 'chinese_fast');
  assert.equal(fast.model.trade_area.primary_ring, 'drive5');
  assert.equal(fast.model.demand.huff.beta, 2.0);
  assert.notEqual(fast.model.demand.captured_monthly_usd, model.demand.captured_monthly_usd);
});

test('Phase 3: layers populated for Millbrae; guard trips when the POI pipeline is empty (R1)', async () => {
  const { model } = await runMillbrae({ skipAlternatives: true });
  assert.ok(model.competitors.l1.length >= 1, `L1 = ${model.competitors.l1.length}`);
  assert.ok(model.competitors.l2_count >= 15, `L2 = ${model.competitors.l2_count}`);
  assert.ok(model.competitors.l4.length >= 1, 'L4 anchor (99 Ranch)');
  assert.equal(model.competitors.guard_passed, true, model.competitors.guard_notes.join('; '));
  assert.ok(model.competitors.l1.every((c) => c.rating != null || c.source === 'overture'));
  assert.ok(model.competitors.l1.some((c) => c.huff_share != null));
  assert.equal(model.competitors.void.is_void, false);

  const down = await runMillbrae({ competitorsDown: true, skipAlternatives: true });
  assert.equal(down.model.competitors.guard_passed, false);
  assert.equal(down.model.meta.tier, 'precheck');
  assert.ok(down.model.meta.precheck_reasons.length >= 1);
  assert.ok(!JSON.stringify(down.model.competitors.void).includes('空白'), 'no 空白 wording when data failed');
});

test('Phase 4: single score(), reconciliation, hidden payback, alternatives', async () => {
  const { model } = await runMillbrae();
  assert.ok(reportModelSchema.safeParse(model).success);
  const dims = model.score.dimensions;
  assert.equal(dims.reduce((s, d) => s + d.weight, 0), 100);
  const manual = Math.round(dims.reduce((s, d) => s + (d.score * d.weight) / 100, 0) * 10) / 10;
  assert.equal(model.score.total, manual);
  assert.ok(['GO', 'CONDITIONAL_GO', 'NO_GO'].includes(model.score.verdict));
  for (const s of model.finance.scenarios) {
    const recomputed = (s.dine_in_covers_day * s.ticket_in + s.delivery_orders_day * s.ticket_delivery) * s.days_open;
    assert.ok(Math.abs(recomputed - s.monthly_revenue) < 60, `${s.id}`);
    assert.ok(Math.abs(s.dine_in_covers_day - s.seats * s.turns_per_day) < 0.11);
  }
  assert.equal(model.finance.payback_months, null);
  assert.equal(model.score.alternatives.length, 14);
  assert.ok(model.score.alternatives.slice(0, 3).every((a) => a.total >= model.score.alternatives[3].total));
  assert.ok(model.score.user_cuisine_rank >= 1 && model.score.user_cuisine_rank <= 14);
  assert.equal(model.score.conditions.length, 2);
  assert.ok(model.confidence.total > 0 && model.confidence.total <= 100);
  assert.equal(model.sources.length, 12);
  assert.ok(model.meta.cost_usd <= 0.5);
  assert.ok(model.risks.length >= 1);
  // R6: no KPI without an input behind it
  assert.equal(model.finance.payback_months, null);
  assert.ok(model.finance.inputs_missing.some((x) => x.startsWith('capex')));
});
