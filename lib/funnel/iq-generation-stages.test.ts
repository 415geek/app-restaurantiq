import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeStageIndex,
  computeStageProgress,
  deriveUiStages,
  stageCeiling,
  UI_STAGE_IDS,
  UI_STAGE_SPECS,
} from './iq-generation-stages';

const T0 = Date.parse('2026-09-14T10:00:00Z');
const iso = (ms: number) => new Date(T0 + ms).toISOString();

test('stage specs: five real stages whose weights sum to 100', () => {
  assert.deepEqual(UI_STAGE_SPECS.map((s) => s.id), [...UI_STAGE_IDS]);
  assert.equal(UI_STAGE_SPECS.reduce((a, s) => a + s.weight, 0), 100);
});

test('deriveUiStages: a stage advances only when its step actually finished', () => {
  const stages = deriveUiStages({
    status: 'running',
    jobStage: 'enrich',
    steps: {
      competitors: { startedAt: iso(0), finishedAt: iso(20_000) },
      demographics: { startedAt: iso(20_000) },
    },
    updatedAt: iso(0),
  });
  assert.deepEqual(stages.map((s) => s.state), ['done', 'active', 'pending', 'pending', 'pending']);
  assert.equal(activeStageIndex(stages), 1);
  assert.equal(stageCeiling(stages), UI_STAGE_SPECS[0].weight + UI_STAGE_SPECS[1].weight);

  // Same job stage, no sub-step finished yet → still on the first stage (no time-based skipping).
  const early = deriveUiStages({ status: 'running', jobStage: 'enrich', steps: { competitors: { startedAt: iso(0) } }, updatedAt: iso(0) });
  assert.deepEqual(early.map((s) => s.state), ['active', 'pending', 'pending', 'pending', 'pending']);
});

test('deriveUiStages: older checkpoints without step timestamps fall back to the job stage', () => {
  assert.deepEqual(deriveUiStages({ status: 'running', jobStage: 'draft', updatedAt: iso(0) }).map((s) => s.state), ['done', 'done', 'done', 'active', 'pending']);
  assert.deepEqual(deriveUiStages({ status: 'running', jobStage: 'finalize', updatedAt: iso(0) }).map((s) => s.state), ['done', 'done', 'done', 'done', 'active']);
  assert.deepEqual(deriveUiStages({ status: 'done', jobStage: 'done' }).map((s) => s.state), ['done', 'done', 'done', 'done', 'done']);
  // A failed job shows nothing active.
  assert.deepEqual(deriveUiStages({ status: 'failed', jobStage: 'draft', steps: { write: { startedAt: iso(0) } } }).map((s) => s.state), ['done', 'done', 'done', 'pending', 'pending']);
  assert.deepEqual(deriveUiStages({ status: 'idle' }).map((s) => s.state), ['pending', 'pending', 'pending', 'pending', 'pending']);
});

test('computeStageProgress: completed weight + capped in-stage creep, never past the stage end', () => {
  const stages = deriveUiStages({
    status: 'running',
    jobStage: 'draft',
    steps: {
      competitors: { startedAt: iso(0), finishedAt: iso(20_000) },
      demographics: { startedAt: iso(20_000), finishedAt: iso(28_000) },
      finance: { startedAt: iso(28_000), finishedAt: iso(29_000) },
      write: { startedAt: iso(29_000) },
    },
  });
  const done = UI_STAGE_SPECS[0].weight + UI_STAGE_SPECS[1].weight + UI_STAGE_SPECS[2].weight; // 26
  const ceiling = done + UI_STAGE_SPECS[3].weight; // 88
  assert.equal(stageCeiling(stages), ceiling);
  const atStart = computeStageProgress(stages, T0 + 29_000);
  assert.equal(atStart, done);
  let prev = atStart;
  for (let t = 29_000; t < 29_000 + 40 * 60_000; t += 15_000) {
    const p = computeStageProgress(stages, T0 + t);
    assert.ok(p >= prev, `progress went backwards at +${t}ms: ${prev} → ${p}`);
    assert.ok(p < ceiling, `progress ${p} reached the write-stage ceiling ${ceiling} at +${t}ms`);
    prev = p;
  }
  // After 40 minutes it is still short of the end of the stage (but well above its start).
  assert.ok(prev >= done + 0.8 * UI_STAGE_SPECS[3].weight);
  // Everything done → 100.
  assert.equal(computeStageProgress(deriveUiStages({ status: 'done' })), 100);
  // Nothing started → 0.
  assert.equal(computeStageProgress(deriveUiStages({ status: 'idle' })), 0);
});
