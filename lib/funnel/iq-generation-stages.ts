/**
 * Stage-based progress for the paid-report wait screen (评审 Spec §4.6).
 *
 * Five real stages, advanced only when the underlying work actually finishes
 * (the job records start/finish timestamps in `generation_state_json.steps`):
 *
 *   competitors   enrich → Google Places / Yelp competitor pull
 *   demographics  enrich → Census ACS
 *   finance       enrich → deterministic finance model
 *   write         draft + verify (the LLM)
 *   layout        finalize + 360° kick
 *
 * Progress = sum of finished stage weights + a small creep inside the active
 * stage that never reaches that stage's end, so the bar cannot run ahead of
 * reality and then stall at 89 %.
 */

export const UI_STAGE_IDS = ['competitors', 'demographics', 'finance', 'write', 'layout'] as const;
export type UiStageId = (typeof UI_STAGE_IDS)[number];

export type UiStageState = 'done' | 'active' | 'pending';

export type UiStage = {
  id: UiStageId;
  /** i18n key on the client (`FULL_STAGE_LABELS[lang][label_key]`). */
  label_key: UiStageId;
  state: UiStageState;
  startedAt?: string;
  finishedAt?: string;
};

export type StepTimes = Partial<Record<UiStageId, { startedAt?: string; finishedAt?: string }>>;

type StageSpec = { id: UiStageId; weight: number; expectedMs: number };

/** Weights sum to 100; expectedMs is the typical duration used for the in-stage creep. */
export const UI_STAGE_SPECS: readonly StageSpec[] = [
  { id: 'competitors', weight: 14, expectedMs: 25_000 },
  { id: 'demographics', weight: 8, expectedMs: 10_000 },
  { id: 'finance', weight: 4, expectedMs: 3_000 },
  { id: 'write', weight: 62, expectedMs: 170_000 },
  { id: 'layout', weight: 12, expectedMs: 15_000 },
];

/** Legacy job stage (enrich/draft/verify/finalize/done) → UI stage that is running during it. */
const JOB_STAGE_TO_UI: Record<string, UiStageId | 'all'> = {
  enrich: 'competitors',
  draft: 'write',
  verify: 'write',
  finalize: 'layout',
  done: 'all',
};

/** The creep inside the active stage: ease-out that tops out at 90 % of the stage. */
function creep(elapsedMs: number, expectedMs: number): number {
  if (expectedMs <= 0) return 0;
  const t = Math.max(0, elapsedMs) / expectedMs;
  const eased = 1 - 1 / (1 + t); // 0 → 1 asymptotically, 0.5 at t = 1
  return Math.min(0.9, eased * 1.2);
}

/**
 * Build the five UI stages from the recorded step timestamps. When a step has
 * no timestamps (older checkpoints, or the enrich call did not report a
 * sub-step) the job-level stage decides: everything before the running job
 * stage is done, the mapped UI stage is active, the rest pending.
 */
export function deriveUiStages(input: {
  steps?: StepTimes | null;
  jobStage?: string | null;
  status?: 'idle' | 'running' | 'done' | 'failed' | string | null;
  /** When the job-level stage started (fallback `startedAt` for the active stage). */
  updatedAt?: string | null;
}): UiStage[] {
  const steps = input.steps ?? {};
  const status = input.status ?? 'idle';
  if (status === 'done') {
    return UI_STAGE_SPECS.map((s) => ({
      id: s.id,
      label_key: s.id,
      state: 'done',
      startedAt: steps[s.id]?.startedAt,
      finishedAt: steps[s.id]?.finishedAt,
    }));
  }
  const mapped = input.jobStage ? JOB_STAGE_TO_UI[input.jobStage] ?? null : null;
  const fallbackActiveIdx =
    mapped === 'all' ? UI_STAGE_SPECS.length : mapped ? UI_STAGE_SPECS.findIndex((s) => s.id === mapped) : -1;

  const out: UiStage[] = [];
  let activeAssigned = false;
  for (let i = 0; i < UI_STAGE_SPECS.length; i++) {
    const spec = UI_STAGE_SPECS[i];
    const st = steps[spec.id];
    let state: UiStageState;
    if (st?.finishedAt) state = 'done';
    else if (st?.startedAt) state = status === 'running' && !activeAssigned ? 'active' : 'pending';
    else if (fallbackActiveIdx >= 0) {
      // No instrumentation for this stage: fall back to the job-level stage
      // (everything before the running/failed job stage did finish).
      if (i < fallbackActiveIdx) state = 'done';
      else if (i === fallbackActiveIdx && status === 'running' && !activeAssigned) state = 'active';
      else state = 'pending';
    } else state = 'pending';
    if (state === 'active') activeAssigned = true;
    out.push({
      id: spec.id,
      label_key: spec.id,
      state,
      startedAt: st?.startedAt ?? (state === 'active' ? input.updatedAt ?? undefined : undefined),
      finishedAt: st?.finishedAt,
    });
  }
  // A failed job keeps its done stages and shows nothing active.
  if (status !== 'running') {
    for (const s of out) if (s.state === 'active') s.state = 'pending';
  }
  return out;
}

/**
 * 0–100. Completed stages contribute their full weight; the active stage adds
 * at most 90 % of its own weight; pending stages add nothing.
 */
export function computeStageProgress(stages: readonly Pick<UiStage, 'id' | 'state' | 'startedAt'>[], now: number = Date.now()): number {
  let pct = 0;
  for (const spec of UI_STAGE_SPECS) {
    const s = stages.find((x) => x.id === spec.id);
    if (!s) continue;
    if (s.state === 'done') pct += spec.weight;
    else if (s.state === 'active') {
      const started = s.startedAt ? Date.parse(s.startedAt) : NaN;
      const elapsed = Number.isFinite(started) ? now - started : 0;
      pct += spec.weight * creep(elapsed, spec.expectedMs);
    }
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Index of the active stage (or of the first pending one; stages.length when everything is done). */
export function activeStageIndex(stages: readonly Pick<UiStage, 'state'>[]): number {
  const active = stages.findIndex((s) => s.state === 'active');
  if (active >= 0) return active;
  const pending = stages.findIndex((s) => s.state === 'pending');
  return pending >= 0 ? pending : stages.length;
}

/** Upper bound of the active stage's band — progress may never exceed it while that stage runs. */
export function stageCeiling(stages: readonly Pick<UiStage, 'id' | 'state'>[]): number {
  let ceiling = 0;
  for (const spec of UI_STAGE_SPECS) {
    const s = stages.find((x) => x.id === spec.id);
    if (!s) continue;
    ceiling += spec.weight;
    if (s.state === 'active') return ceiling;
    if (s.state === 'pending') return ceiling - spec.weight;
  }
  return 100;
}
