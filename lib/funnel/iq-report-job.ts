/**
 * Background, resumable generation of the paid LocationIQ report.
 *
 * Why this exists: the previous design ran enrichment + LLM drafting +
 * verification inside ONE HTTP request capped at 300s on Vercel. Any slow
 * stage (a 188s decode, a Tavily poll, a verify leg that ignored the budget)
 * killed the whole request, nothing after market enrichment was persisted, and
 * "Retry" started over from scratch — the 89%-then-timeout loop users saw.
 *
 * Now each stage runs in its OWN serverless invocation with its own budget,
 * checkpoints its output to `generation_state_json`, and chains the next stage
 * by calling the worker route again. The browser only polls a status endpoint,
 * so the user can leave (and be emailed) and a retry resumes from the failed
 * stage instead of restarting.
 *
 *   enrich ─▶ draft ─▶ verify ─▶ finalize ─▶ done (+ email)
 *
 * Requires migration 0008. When the columns are missing every entry point
 * reports `legacy: true` so callers fall back to the synchronous path.
 */

import { kickReport360 } from '@/lib/iq/kick';
import { generateReport360ForRow } from '@/lib/iq/generate';
import { parseConclusion, verdictRuleText, type Conclusion } from '@/lib/iq/conclusion/conclusion';
import type { CompetitorCounts } from '@/lib/iq/model/schema';
import { type Locale, toLocale } from '@/lib/i18n/locale';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getPublicBaseUrl } from '@/lib/funnel/base-url';
import { createIqDeadline } from '@/lib/funnel/iq-deadline';
import { applyDualModelVerification } from '@/lib/funnel/iq-dual-model-verify';
import type { DeterministicFinanceModel } from '@/lib/funnel/iq-finance-model';
import {
  applyCompetitorWhitelist,
  applyConclusionOverride,
  logFullReportQuality,
  parseIqFullReport,
  type IqReportWithGrounding,
} from '@/lib/funnel/iq-full-report-schema';
import {
  activeStageIndex,
  computeStageProgress,
  deriveUiStages,
  stageCeiling,
  STAGE_STALL_MS,
  type StepTimes,
  type UiStage,
  type UiStageId,
} from '@/lib/funnel/iq-generation-stages';
import { tierEtaFromHistory, type EtaSource, type TierEta } from '@/lib/funnel/iq-eta';
import { runFullPremiumReport } from '@/lib/funnel/iq-llm';
import { resolveMarketDataForIqReport, type MarketResolveStep } from '@/lib/funnel/iq-market-data-resolve';
import { extractCompetitorWhitelist } from '@/lib/funnel/iq-market-signals';
import { stripInternalIqReportFields } from '@/lib/funnel/iq-report-sanitize';
import {
  iqClaimReportGeneration,
  iqGetReport,
  iqMarkReportNotified,
  iqRecentGenerationDurationsMs,
  iqSetFullReport,
  iqSetReportNotifyEmail,
  iqUpdateMarketDataJson,
  iqUpdateReportGeneration,
  isMissingColumnError,
  type IqReportRow,
} from '@/lib/funnel/iq-repository';
import { runMultiAgentFullReport } from '@/lib/funnel/agents/orchestrator';
import { generateFullReportWithN8n, shouldUseN8nForIqFullReport } from '@/lib/n8n';
import { isReportEmailConfigured, sendReportReadyEmail } from '@/lib/email/send-report-email';

export type GenerationMode = 'standard' | 'professional';
export type GenerationStage = 'enrich' | 'draft' | 'verify' | 'finalize' | 'done';

export const GENERATION_STAGES: GenerationStage[] = ['enrich', 'draft', 'verify', 'finalize', 'done'];

/** Each stage runs in its own invocation; the worker route allows 300s. */
export const STAGE_BUDGET_MS = 250_000;
/** A 'running' claim untouched for this long is treated as a dead worker. */
export const STALE_CLAIM_MS = 6 * 60_000;
const MAX_STAGE_ATTEMPTS = 2;

export type GenerationState = {
  v: 1;
  mode: GenerationMode;
  language: Locale;
  trigger?: string;
  attempts: Partial<Record<GenerationStage, number>>;
  timingsMs: Partial<Record<GenerationStage, number>>;
  /** Parsed LLM draft (with `_`-prefixed telemetry) awaiting verify/finalize. */
  draft?: Record<string, unknown>;
  draftSource?: 'multi_agent' | 'n8n' | 'llm';
  verified?: boolean;
  /** Start/finish timestamps of the five UI stages (评审 Spec §4.6); advanced only by real completions. */
  steps?: StepTimes;
  /** The standard-tier run already scheduled its professional upgrade (once per row). */
  autoUpgradeKicked?: boolean;
  /** §4.1 单一结论源: the deterministic core did not land before the draft — the body is marked preliminary. */
  conclusionPending?: boolean;
  /** §4.7 stage-stall: stages the job gave up on and walked past instead of failing the run. */
  degraded?: GenerationStage[];
  log: string[];
};

export type GenerationStatusView = {
  legacy: false;
  status: 'idle' | 'running' | 'done' | 'failed';
  stage: GenerationStage | null;
  mode: GenerationMode | null;
  /** 0–100: completed-stage weight + a capped in-stage creep (never past the stage's end). */
  progress: number;
  /** Index into `stages` (the five-row UI checklist). */
  activeIndex: number;
  /** The five real stages with their live state. */
  stages: UiStage[];
  /** §4.7: the stage that has been current past `STAGE_STALL_MS` and is being retried. */
  stalledStage: UiStageId | null;
  /** §4.7 分档 ETA: typical total wait for this tier, and where the figure came from. */
  etaSeconds: number;
  etaSource: EtaSource;
  /** A standard-tier body is already stored (the professional pass replaces it later). */
  standardReady: boolean;
  updatedAt: string | null;
  startedAt: string | null;
  error: string | null;
  hasReport: boolean;
  generationTier: string | null;
  notifyEmail: string | null;
  notified: boolean;
  /** §4.7: capture is always on — the address is stored whether or not sending is configured. */
  emailEnabled: boolean;
  /** Whether a mail can actually go out (RESEND_API_KEY), so the UI never promises one that cannot. */
  emailWillSend: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function shortErr(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 400);
}

function pushLog(state: GenerationState, line: string): void {
  state.log = [...state.log.slice(-24), `${nowIso().slice(11, 19)} ${line}`];
}

function readState(row: IqReportRow): GenerationState | null {
  const s = row.generation_state_json;
  if (!s || typeof s !== 'object' || (s as { v?: unknown }).v !== 1) return null;
  return s as GenerationState;
}

function hasStoredReport(row: IqReportRow): boolean {
  const f = row.full_report_json;
  return Boolean(f && typeof f === 'object' && Object.keys(f).length > 0);
}

function storedTier(row: IqReportRow): string | null {
  if (!hasStoredReport(row)) return null;
  const t = (row.full_report_json as Record<string, unknown>).generation_tier;
  return typeof t === 'string' ? t : null;
}

const RESOLVE_STEP_TO_UI: Record<MarketResolveStep, UiStageId> = {
  places: 'competitors',
  acs: 'demographics',
  finance: 'finance',
};

/** Record a UI-stage boundary in the checkpoint (idempotent: a retry keeps the first start). */
function markStep(state: GenerationState, id: UiStageId, phase: 'start' | 'done'): void {
  const steps: StepTimes = state.steps ?? {};
  const cur = steps[id] ?? {};
  if (phase === 'start') {
    if (!cur.startedAt) steps[id] = { ...cur, startedAt: nowIso() };
  } else {
    steps[id] = { startedAt: cur.startedAt ?? nowIso(), finishedAt: nowIso() };
  }
  state.steps = steps;
}

/** IQ_AUTO_UPGRADE=false disables the automatic professional pass after a standard report. */
function autoUpgradeEnabled(): boolean {
  return (process.env.IQ_AUTO_UPGRADE ?? '').trim().toLowerCase() !== 'false';
}

// ---------------------------------------------------------------------------
// Worker auth + scheduling
// ---------------------------------------------------------------------------

function workerSecret(): string | null {
  const explicit = process.env.IQ_WORKER_SECRET?.trim();
  if (explicit) return explicit;
  // Same derivation pattern as the admin session secret: no extra env needed.
  const seed = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!seed) return null;
  return createHash('sha256').update(`iq-worker:${seed}`).digest('hex');
}

export function verifyWorkerSecret(header: string | null): boolean {
  const expected = workerSecret();
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Kick the worker for a report. Fire-and-forget: the worker responds 202
 * immediately and does the stage work after responding, so awaiting this only
 * costs a round trip.
 */
export async function scheduleReportWorker(reportId: string): Promise<void> {
  const secret = workerSecret();
  if (!secret) {
    console.error('[iq-report-job] no worker secret (set IQ_WORKER_SECRET or SUPABASE_SERVICE_ROLE_KEY)');
    return;
  }
  const url = `${getPublicBaseUrl()}/api/funnel/full-report/worker`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-iq-worker-secret': secret,
  };
  // Preview deployments sit behind Vercel deployment protection.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reportId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[iq-report-job] worker kick failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  } catch (e) {
    console.error('[iq-report-job] worker kick threw:', shortErr(e));
  }
}

// ---------------------------------------------------------------------------
// Start / resume
// ---------------------------------------------------------------------------

export type StartResult =
  | { kind: 'legacy' }
  | { kind: 'not_found' }
  | { kind: 'unpaid' }
  | { kind: 'already_done' }
  | { kind: 'running'; stage: GenerationStage; resumed: boolean };

/**
 * Claim the report for generation and kick the first worker. A failed job is
 * resumed from its last stage; `force` restarts from `enrich` even when a
 * report already exists (used by the professional-tier upgrade).
 */
export async function startReportGeneration(opts: {
  reportId: string;
  mode: GenerationMode;
  language?: Locale;
  force?: boolean;
  trigger?: string;
}): Promise<StartResult> {
  const row = await iqGetReport(opts.reportId);
  if (!row) return { kind: 'not_found' };
  if (!row.paid) return { kind: 'unpaid' };
  if (hasStoredReport(row) && !opts.force) return { kind: 'already_done' };

  const language: Locale = opts.language ?? toLocale(row.language);
  const prev = readState(row);
  const resumable =
    !opts.force &&
    prev != null &&
    row.generation_status === 'failed' &&
    prev.mode === opts.mode &&
    prev.language === language &&
    row.generation_stage != null &&
    row.generation_stage !== 'done';

  const stage: GenerationStage = resumable ? (row.generation_stage as GenerationStage) : 'enrich';
  const state: GenerationState = resumable
    ? { ...prev!, attempts: {}, log: [...prev!.log, `${nowIso().slice(11, 19)} resumed at ${stage}`] }
    : {
        v: 1,
        mode: opts.mode,
        language,
        trigger: opts.trigger,
        attempts: {},
        timingsMs: {},
        log: [`${nowIso().slice(11, 19)} started (${opts.mode}, ${opts.trigger ?? 'api'})`],
      };

  let claimed: boolean;
  try {
    claimed = await iqClaimReportGeneration({
      reportId: opts.reportId,
      stage,
      stateJson: state,
      staleBeforeIso: new Date(Date.now() - STALE_CLAIM_MS).toISOString(),
    });
  } catch (e) {
    if (isMissingColumnError(e)) {
      console.warn('[iq-report-job] migration 0008 missing — using legacy synchronous generation');
      return { kind: 'legacy' };
    }
    throw e;
  }

  if (!claimed) {
    // Someone else holds a fresh claim — report where it is instead of racing.
    const current = await iqGetReport(opts.reportId);
    return {
      kind: 'running',
      stage: ((current?.generation_stage as GenerationStage | null) ?? 'enrich'),
      resumed: true,
    };
  }

  await scheduleReportWorker(opts.reportId);
  return { kind: 'running', stage, resumed: resumable };
}

// ---------------------------------------------------------------------------
// Stage runner (called by the worker route)
// ---------------------------------------------------------------------------

type StageCtx = {
  row: IqReportRow;
  state: GenerationState;
  deadline: ReturnType<typeof createIqDeadline>;
  language: Locale;
  professional: boolean;
};

async function stageEnrich(ctx: StageCtx): Promise<void> {
  const { row, state, deadline, language, professional } = ctx;
  try {
    const enriched = await resolveMarketDataForIqReport({
      existing: row.market_data_json,
      location: row.location,
      businessType: row.business_type || 'restaurant',
      isPremium: true,
      lang: language,
      // Deep research runs inside its own stage budget now — it can no longer
      // starve the LLM draft, so let the professional tier have it.
      skipDeepResearchFetch: !professional || !deadline.hasBudget(120_000),
      leanResolve: !professional,
      // §4.6: the checklist advances on real completions (places → ACS → finance),
      // persisted as they happen so the poller sees them mid-stage.
      onStep: async (step, phase) => {
        markStep(state, RESOLVE_STEP_TO_UI[step], phase);
        await iqUpdateReportGeneration(row.id, { stateJson: state });
      },
    });
    if (enriched && Object.keys(enriched).length > 0) {
      await iqUpdateMarketDataJson(row.id, enriched);
      pushLog(state, `enrich ok (${Object.keys(enriched).length} keys)`);
    } else {
      pushLog(state, 'enrich returned nothing; keeping stored market data');
    }
  } catch (e) {
    // Enrichment is best-effort: a stale market pack beats no report.
    console.warn('[iq-report-job] enrich failed, continuing with stored market data:', shortErr(e));
    pushLog(state, `enrich failed: ${shortErr(e).slice(0, 120)}`);
  }
}

/** How long the draft stage waits for the deterministic core before going ahead without it. */
export const CONCLUSION_BUDGET_MS = 150_000;

/** The conclusion already stored on the row, if the 360° core has run. */
export function storedConclusion(row: IqReportRow): Conclusion | null {
  const m = row.report_model_json as { conclusion?: unknown } | null | undefined;
  return m && typeof m === 'object' ? parseConclusion(m.conclusion) : null;
}

/**
 * §4.4 P1-a 计数单一化: the ONE competitor count block, taken from the model
 * (`competitors.counts`) or from its funnel twin (`market_data.summary.counts`).
 * The web body prints these instead of anything the LLM counted for itself.
 */
export function storedCompetitorCounts(row: IqReportRow): CompetitorCounts | null {
  const fromModel = (row.report_model_json as { competitors?: { counts?: unknown } } | null | undefined)?.competitors?.counts;
  const fromMarket = (row.market_data_json as { summary?: { counts?: unknown } } | null | undefined)?.summary?.counts;
  const raw = fromModel ?? fromMarket;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const by = (c.by_source ?? {}) as Record<string, unknown>;
  const total = n(c.total);
  if (total == null) return null;
  return {
    total,
    direct: n(c.direct) ?? 0,
    same_category: n(c.same_category) ?? 0,
    l3: n(c.l3) ?? 0,
    anchors: n(c.anchors) ?? 0,
    by_source: { google: n(by.google) ?? 0, yelp: n(by.yelp) ?? 0, foursquare: n(by.foursquare) ?? 0 },
  };
}

/**
 * §4.1 单一结论源 (P0-A), ordering fix: the deterministic core runs BEFORE the LLM
 * draft, not after it.
 *
 * The 360° model is generated WITHOUT narratives (prose is the slow part and it is
 * not needed to freeze the numbers) inside a budget. If it lands, its conclusion is
 * injected into the draft prompt anchors and into the finalize override, so the web
 * report prints exactly what the PDF will print. If it does not land in time, the
 * job falls back to today's behaviour and flags `conclusionPending`, and the body
 * says the numbers are preliminary instead of showing a second set.
 *
 * Idempotent: a conclusion already stored on the row is reused, never recomputed.
 */
async function ensureConclusion(ctx: StageCtx, row: IqReportRow): Promise<Conclusion | null> {
  const { state } = ctx;
  const existing = storedConclusion(row);
  if (existing) {
    pushLog(state, 'conclusion: reused the stored 360° core');
    return existing;
  }
  const budget = Math.min(CONCLUSION_BUDGET_MS, Math.max(0, ctx.deadline.remainingMs() - 30_000));
  if (budget < 20_000) {
    pushLog(state, 'conclusion: no budget left for the deterministic core');
    return null;
  }
  const t0 = Date.now();
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), budget).unref?.());
    const run = generateReport360ForRow(row.id, { narrative: false }).then((r) => r?.model.conclusion ?? null);
    const conclusion = await Promise.race([run, timeout]);
    if (!conclusion) {
      pushLog(state, `conclusion: core did not land in ${Math.round(budget / 1000)}s — numbers stay preliminary`);
      return null;
    }
    pushLog(state, `conclusion: core landed in ${Date.now() - t0}ms (${conclusion.verdict} ${conclusion.overall})`);
    return conclusion;
  } catch (e) {
    console.warn('[iq-report-job] deterministic core failed, continuing without a conclusion:', shortErr(e));
    pushLog(state, `conclusion: core failed: ${shortErr(e).slice(0, 120)}`);
    return null;
  }
}

async function stageDraft(ctx: StageCtx): Promise<void> {
  const { state, deadline, language, professional } = ctx;
  // Re-read: enrich persisted a fresh market pack.
  const row = (await iqGetReport(ctx.row.id)) ?? ctx.row;
  // §4.1: freeze the numbers FIRST, then let the LLM write prose around them.
  const conclusion = await ensureConclusion(ctx, row);
  state.conclusionPending = conclusion == null;
  const marketData = ((): Record<string, unknown> | undefined => {
    const md = (row.market_data_json as Record<string, unknown> | null) ?? undefined;
    // The anchors block reads `market_data.conclusion` and turns it into hard rules.
    return conclusion ? { ...(md ?? {}), conclusion } : md;
  })();
  const base = {
    location: row.location,
    businessType: row.business_type,
    headline: row.headline,
    reason: row.reason,
    marketData,
    language,
  };
  const whitelist = extractCompetitorWhitelist(marketData ?? null);

  if (process.env.IQ_ENGINE?.trim().toLowerCase() === 'multi_agent') {
    try {
      const parsed = await runMultiAgentFullReport({ ...base, reportId: row.id });
      state.draft = applyCompetitorWhitelist(parseIqFullReport(parsed), whitelist, language);
      state.draftSource = 'multi_agent';
      pushLog(state, 'draft via multi-agent engine');
      return;
    } catch (e) {
      console.warn('[iq-report-job] multi-agent draft failed, falling back:', shortErr(e));
      pushLog(state, `multi-agent failed: ${shortErr(e).slice(0, 120)}`);
    }
  }

  if (shouldUseN8nForIqFullReport()) {
    try {
      const raw = await generateFullReportWithN8n({
        analysis_id: row.id,
        address: row.location,
        industry: 'restaurant',
        cuisine_type: row.business_type ?? undefined,
        market_data: marketData,
        headline: row.headline,
        reason: row.reason,
        language,
      });
      state.draft = applyCompetitorWhitelist(parseIqFullReport(raw), whitelist, language);
      state.draftSource = 'n8n';
      pushLog(state, 'draft via n8n');
      return;
    } catch (e) {
      console.warn('[iq-report-job] n8n draft failed, falling back to in-app LLM:', shortErr(e));
      pushLog(state, `n8n failed: ${shortErr(e).slice(0, 120)}`);
    }
  }

  const draft = await runFullPremiumReport({
    ...base,
    leanGeneration: !professional,
    timeoutMs: deadline.remainingMs(),
  });
  state.draft = draft;
  state.draftSource = 'llm';
  pushLog(
    state,
    `draft via ${String(draft._generation_provider ?? 'llm')}/${String(draft._generation_model ?? '?')}`,
  );
}

async function stageVerify(ctx: StageCtx): Promise<void> {
  const { state, language, professional, row } = ctx;
  if (!state.draft) throw new Error('verify: no draft checkpoint');
  if (!professional) {
    pushLog(state, 'verify skipped (standard tier)');
    return;
  }
  try {
    const draft = state.draft as IqReportWithGrounding;
    const verified = await applyDualModelVerification(draft, {
      language,
      location: row.location,
      businessType: row.business_type,
      primaryProvider:
        typeof draft._generation_provider === 'string' ? draft._generation_provider : undefined,
      primaryModel: typeof draft._generation_model === 'string' ? draft._generation_model : undefined,
      reportSource: state.draftSource === 'n8n' ? 'n8n' : 'llm',
    });
    state.draft = verified;
    state.verified = true;
    pushLog(state, 'verify ok');
  } catch (e) {
    // Verification is a quality pass — never let it cost the user the report.
    console.warn('[iq-report-job] verify failed, keeping draft:', shortErr(e));
    pushLog(state, `verify failed: ${shortErr(e).slice(0, 120)}`);
  }
}

async function stageFinalize(ctx: StageCtx): Promise<void> {
  const { state, professional } = ctx;
  if (!state.draft) throw new Error('finalize: no draft checkpoint');
  const row = (await iqGetReport(ctx.row.id)) ?? ctx.row;
  const financeModel = ((row.market_data_json as Record<string, unknown> | null)?.finance_model ??
    null) as DeterministicFinanceModel | null;
  // §4.1 单一结论源: the stored conclusion replaces every headline figure the LLM
  // wrote (score, verdict, break-even, safe revenue, cost table, occupancy, data
  // confidence, revenue scenarios). The draft stage froze it; re-read in case this
  // stage runs in a later invocation. Without one, the legacy finance override runs
  // and the body is marked preliminary.
  const conclusion = storedConclusion(row);
  state.conclusionPending = conclusion == null;
  const withFinance = applyConclusionOverride(
    state.draft as IqReportWithGrounding,
    conclusion,
    ctx.language,
    { financeModel, verdictRule: verdictRuleText(ctx.language), counts: storedCompetitorCounts(row) },
  );
  logFullReportQuality(withFinance, `reportId=${row.id} job/${state.draftSource ?? 'llm'}`);
  const clean = stripInternalIqReportFields(withFinance) as Record<string, unknown>;
  clean.generation_tier = professional ? 'professional' : 'standard';
  await iqSetFullReport(row.id, clean);
  // Drop the (large) draft from the checkpoint once the report is stored.
  delete state.draft;
  pushLog(state, `finalized (${clean.generation_tier}${conclusion ? `, conclusion ${conclusion.snapshot_id}` : ', conclusion pending'})`);
  // The 360° pass now only writes the page narratives around the frozen numbers
  // (idempotent server-side: an existing model is never recomputed).
  await kickReport360(row.id);
}

/**
 * §4.5: the server schedules the professional pass itself once the standard
 * report is persisted (the report page used to POST it on mount, once per
 * visitor). Guarded so it happens once per row: not when a professional body
 * is already stored, not when this run is the upgrade, and not twice.
 */
async function maybeKickAutoUpgrade(reportId: string, state: GenerationState): Promise<void> {
  if (state.mode !== 'standard' || state.trigger === 'auto-upgrade' || state.autoUpgradeKicked) return;
  if (!autoUpgradeEnabled()) return;
  const fresh = await iqGetReport(reportId);
  if (!fresh || !fresh.paid) return;
  if (storedTier(fresh) === 'professional') return;
  state.autoUpgradeKicked = true;
  pushLog(state, 'auto-upgrade: scheduling professional pass');
  await iqUpdateReportGeneration(reportId, { stateJson: state });
  try {
    const started = await startReportGeneration({
      reportId,
      mode: 'professional',
      language: state.language,
      force: true,
      trigger: 'auto-upgrade',
    });
    console.log(`[iq-report-job] ${reportId}: auto-upgrade → ${started.kind}`);
  } catch (e) {
    console.error(`[iq-report-job] ${reportId}: auto-upgrade kick failed:`, shortErr(e));
  }
}

async function notifyIfRequested(row: IqReportRow, language: Locale): Promise<void> {
  const email = row.notify_email?.trim();
  if (!email || row.notified_at) return;
  if (!isReportEmailConfigured()) {
    console.warn('[iq-report-job] notify requested but RESEND_API_KEY is not set');
    return;
  }
  const res = await sendReportReadyEmail({
    to: email,
    reportId: row.id,
    location: row.location,
    headline: row.headline,
    lang: language,
  });
  if (res.ok) {
    await iqMarkReportNotified(row.id);
    console.log(`[iq-report-job] report-ready email sent for ${row.id}`);
  } else {
    console.error(`[iq-report-job] report-ready email failed for ${row.id}: ${res.error}`);
  }
}

function nextStage(stage: GenerationStage): GenerationStage {
  const i = GENERATION_STAGES.indexOf(stage);
  return GENERATION_STAGES[Math.min(i + 1, GENERATION_STAGES.length - 1)];
}

/**
 * §4.7 stage-stall: a stage that hangs past its own budget is cut off rather
 * than left to burn the whole invocation. The underlying promise is abandoned,
 * not cancelled — the invocation is about to end anyway, and the stage is
 * re-entered from its last checkpoint on the retry.
 *
 * It must stay comfortably under `STAGE_STALL_MS` (5 min): the watchdog firing
 * writes a checkpoint, so a job that has been silent for the stall window is
 * a dead invocation rather than a slow one, and the status endpoint can re-kick
 * it without racing a live worker.
 */
const STAGE_WATCHDOG_MS = STAGE_BUDGET_MS + 15_000;

function withStageTimeout<T>(stage: GenerationStage, ms: number, run: () => Promise<T>): Promise<T> {
  return Promise.race([
    run(),
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`stage ${stage} timed out after ${Math.round(ms / 1000)}s`)), ms);
      t.unref?.();
    }),
  ]);
}

/**
 * §4.7 degradation: which stages the job may walk past once its attempts are
 * spent, instead of failing the whole run.
 *
 *   enrich  → the stored market pack is stale but usable
 *   verify  → an unverified draft is still a report (it is a quality pass)
 *   draft   → only when an earlier attempt already checkpointed one
 *   finalize→ nothing to degrade to: without it there is no stored report
 */
export function canDegradeStage(stage: GenerationStage, state: Pick<GenerationState, 'draft'>): boolean {
  if (stage === 'enrich' || stage === 'verify') return true;
  if (stage === 'draft') return state.draft != null;
  return false;
}

/** Close the UI-checklist rows a job stage owns (shared by the success and degrade paths). */
function closeStageSteps(state: GenerationState, stage: GenerationStage): void {
  if (stage === 'enrich') {
    for (const id of ['competitors', 'demographics', 'finance'] as const) markStep(state, id, 'done');
  }
  if (stage === 'verify') markStep(state, 'write', 'done');
}

/**
 * Execute exactly one stage for the report, checkpoint, and chain the next
 * worker invocation. Safe to call repeatedly: a finished or foreign job no-ops.
 */
export async function runReportGenerationStage(reportId: string): Promise<void> {
  const row = await iqGetReport(reportId);
  if (!row) return;
  if (row.generation_status !== 'running') {
    console.log(`[iq-report-job] ${reportId}: status=${row.generation_status}, nothing to run`);
    return;
  }
  const state = readState(row);
  const stage = (row.generation_stage as GenerationStage | null) ?? 'enrich';
  if (!state) {
    await iqUpdateReportGeneration(reportId, { status: 'failed', error: 'corrupt generation state' });
    return;
  }
  // Older checkpoints may predate the Locale contract; coerce rather than trust.
  const language = toLocale(state.language);
  const professional = state.mode === 'professional';

  if (stage === 'done') {
    await iqUpdateReportGeneration(reportId, { status: 'done', stage: 'done', stateJson: state });
    await notifyIfRequested(row, language);
    return;
  }

  const attempt = (state.attempts[stage] ?? 0) + 1;
  state.attempts[stage] = attempt;
  // UI checklist (§4.6): "write" spans draft + verify, "layout" spans finalize + 360 kick.
  if (stage === 'draft') markStep(state, 'write', 'start');
  if (stage === 'finalize') markStep(state, 'layout', 'start');
  // Heartbeat so a concurrent starter sees a live claim.
  await iqUpdateReportGeneration(reportId, { stage, stateJson: state });

  const deadline = createIqDeadline(STAGE_BUDGET_MS);
  const ctx: StageCtx = { row, state, deadline, language, professional };
  const t0 = Date.now();
  try {
    // §4.7: no stage may hang forever — the watchdog turns a hang into a normal
    // stage failure, which then retries and finally degrades.
    await withStageTimeout(stage, STAGE_WATCHDOG_MS, async () => {
      if (stage === 'enrich') await stageEnrich(ctx);
      else if (stage === 'draft') await stageDraft(ctx);
      else if (stage === 'verify') await stageVerify(ctx);
      else if (stage === 'finalize') await stageFinalize(ctx);
    });
    state.timingsMs[stage] = Date.now() - t0;
    // Whatever the resolver reported, the rows this stage owns are over now.
    closeStageSteps(state, stage);

    const next = nextStage(stage);
    if (next === 'done') {
      markStep(state, 'layout', 'done');
      await iqUpdateReportGeneration(reportId, { status: 'done', stage: 'done', stateJson: state, error: null });
      console.log(`[iq-report-job] ${reportId}: done (${JSON.stringify(state.timingsMs)})`);
      const fresh = await iqGetReport(reportId);
      if (fresh) await notifyIfRequested(fresh, language);
      await maybeKickAutoUpgrade(reportId, state);
      return;
    }
    await iqUpdateReportGeneration(reportId, { stage: next, stateJson: state, error: null });
    console.log(`[iq-report-job] ${reportId}: ${stage} → ${next} in ${Date.now() - t0}ms`);
    await scheduleReportWorker(reportId);
  } catch (e) {
    const msg = shortErr(e);
    console.error(`[iq-report-job] ${reportId}: stage ${stage} attempt ${attempt} failed: ${msg}`);
    pushLog(state, `${stage} attempt ${attempt} failed: ${msg.slice(0, 160)}`);
    if (attempt < MAX_STAGE_ATTEMPTS) {
      await iqUpdateReportGeneration(reportId, { stage, stateJson: state, error: msg });
      await scheduleReportWorker(reportId);
      return;
    }
    // §4.7: attempts spent — walk past the stage when the run can survive
    // without it, rather than hanging the visitor on a failed screen.
    if (canDegradeStage(stage, state)) {
      state.degraded = [...(state.degraded ?? []), stage];
      closeStageSteps(state, stage);
      pushLog(state, `${stage} degraded after ${attempt} attempts — continuing without it`);
      const next = nextStage(stage);
      await iqUpdateReportGeneration(reportId, { stage: next, stateJson: state, error: null });
      console.warn(`[iq-report-job] ${reportId}: ${stage} degraded → ${next}`);
      await scheduleReportWorker(reportId);
      return;
    }
    await iqUpdateReportGeneration(reportId, { status: 'failed', stage, stateJson: state, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Status (polled by the browser) + email opt-in
// ---------------------------------------------------------------------------

/**
 * §4.7 分档 ETA. The median of 30 runs moves by minutes per week, not per poll,
 * so it is computed once per tier and held for ten minutes — the status endpoint
 * is hit every 3 s per open wait screen and must stay a single row read.
 */
const ETA_CACHE_MS = 10 * 60_000;
const etaCache = new Map<GenerationMode, { at: number; eta: TierEta }>();

export async function tierEta(mode: GenerationMode): Promise<TierEta> {
  const hit = etaCache.get(mode);
  if (hit && Date.now() - hit.at < ETA_CACHE_MS) return hit.eta;
  let durations: number[] = [];
  try {
    durations = await iqRecentGenerationDurationsMs(mode, 30);
  } catch (e) {
    console.warn('[iq-report-job] ETA history unavailable, using the static default:', shortErr(e));
  }
  const eta = tierEtaFromHistory(mode, durations);
  etaCache.set(mode, { at: Date.now(), eta });
  return eta;
}

export async function getReportGenerationStatus(
  reportId: string,
): Promise<GenerationStatusView | { legacy: true } | null> {
  const row = await iqGetReport(reportId);
  if (!row) return null;
  if (!('generation_status' in row)) return { legacy: true };

  const hasReport = hasStoredReport(row);
  const statusRaw = (row.generation_status ?? 'idle') as GenerationStatusView['status'];
  const stage = (row.generation_stage as GenerationStage | null) ?? null;
  const state = readState(row);
  const updatedAt = row.generation_updated_at ?? null;

  // Self-heal (§4.7 stage-stall): a stage with no checkpoint for STAGE_STALL_MS
  // is a dead invocation — its own budget is only ~250s. Re-kick it from the
  // last checkpoint the next time anyone asks, so the "retrying" the checklist
  // shows is a real retry and not a spinner.
  let status = statusRaw;
  if (status === 'running' && updatedAt && Date.now() - Date.parse(updatedAt) > STAGE_STALL_MS) {
    console.warn(`[iq-report-job] ${reportId}: stalled at ${stage}, re-kicking worker`);
    await iqUpdateReportGeneration(reportId, { stage: stage ?? 'enrich' });
    await scheduleReportWorker(reportId);
  }
  if (status === 'done' && !hasReport) status = 'failed';

  // §4.6: stage-based, not time-eased. Finished stages count in full; the
  // running stage adds a small creep that stays below its own end.
  const stages = deriveUiStages({ steps: state?.steps, jobStage: stage, status, updatedAt });
  const progress =
    status === 'done' ? 100 : Math.min(computeStageProgress(stages), Math.max(0, stageCeiling(stages) - 1));

  const tier = storedTier(row);
  // §4.7 分档 ETA: the tier being generated decides the figure (the standard
  // pass is ~4 min, the professional one ~12), so an unknown mode reads as standard.
  const eta = await tierEta(state?.mode ?? 'standard');
  const stalled = stages.find((s) => s.stalled)?.id ?? null;

  return {
    legacy: false,
    status,
    stage,
    mode: state?.mode ?? null,
    progress,
    activeIndex: Math.min(stages.length - 1, activeStageIndex(stages)),
    stages,
    stalledStage: stalled,
    etaSeconds: eta.seconds,
    etaSource: eta.source,
    standardReady: tier === 'standard',
    updatedAt,
    startedAt: row.generation_started_at ?? null,
    error: status === 'failed' ? row.generation_error ?? null : null,
    hasReport,
    generationTier: tier,
    notifyEmail: row.notify_email ?? null,
    notified: Boolean(row.notified_at),
    // §4.7 P1-f: capture is always offered — the address is stored on the row
    // either way, and `emailWillSend` tells the UI what to promise.
    emailEnabled: true,
    emailWillSend: isReportEmailConfigured(),
  };
}

/** Store the opt-in address; if the report is already done, email right away. */
export async function requestReportEmail(
  reportId: string,
  email: string,
): Promise<{ ok: true; sentNow: boolean } | { ok: false; reason: 'not_found' | 'unpaid' | 'legacy' }> {
  const row = await iqGetReport(reportId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (!row.paid) return { ok: false, reason: 'unpaid' };
  try {
    await iqSetReportNotifyEmail(reportId, email);
  } catch (e) {
    if (isMissingColumnError(e)) return { ok: false, reason: 'legacy' };
    throw e;
  }
  if (hasStoredReport(row)) {
    const fresh = await iqGetReport(reportId);
    if (fresh) await notifyIfRequested(fresh, toLocale(fresh.language));
    return { ok: true, sentNow: true };
  }
  return { ok: true, sentNow: false };
}
