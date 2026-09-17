import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDegradeStage, GENERATION_STAGES, STAGE_BUDGET_MS } from './iq-report-job';
import { STAGE_STALL_MS } from './iq-generation-stages';

test('§4.7 degradation: a stalled stage is walked past only when the run survives without it', () => {
  // Quality passes: a stale market pack and an unverified draft still make a report.
  assert.equal(canDegradeStage('enrich', {}), true);
  assert.equal(canDegradeStage('verify', {}), true);

  // The draft may only be skipped when an earlier attempt checkpointed one.
  assert.equal(canDegradeStage('draft', {}), false);
  assert.equal(canDegradeStage('draft', { draft: { summary: 'x' } }), true);

  // Finalize is what stores the report — there is nothing to degrade to.
  assert.equal(canDegradeStage('finalize', { draft: { summary: 'x' } }), false);
  assert.equal(canDegradeStage('done', { draft: { summary: 'x' } }), false);
});

test('§4.7: the stall threshold sits above a stage budget, so a silent job is dead, not slow', () => {
  // The watchdog cuts a stage off at its budget and checkpoints the failure, so
  // no live worker can stay silent for the stall window.
  assert.ok(STAGE_BUDGET_MS < STAGE_STALL_MS, `${STAGE_BUDGET_MS}ms budget must be under the ${STAGE_STALL_MS}ms stall window`);
  assert.ok(STAGE_STALL_MS - STAGE_BUDGET_MS >= 30_000, 'leave headroom for the checkpoint write');
  // Every non-terminal stage has a successor to degrade into.
  for (const stage of GENERATION_STAGES) {
    if (canDegradeStage(stage, { draft: {} })) {
      assert.notEqual(stage, 'done');
      assert.ok(GENERATION_STAGES.indexOf(stage) < GENERATION_STAGES.length - 1);
    }
  }
});
