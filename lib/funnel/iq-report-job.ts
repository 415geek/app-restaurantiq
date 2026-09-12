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

import { createHash, timingSafeEqual } from 'node:crypto';
import { getPublicBaseUrl } from '@/lib/funnel/base-url';
import { createIqDeadline } from '@/lib/funnel/iq-deadline';
import { applyDualModelVerification } from '@/lib/funnel/iq-dual-model-verify';
import type { DeterministicFinanceModel } from '@/lib/funnel/iq-finance-model';
import {
  applyCompetitorWhitelist,
  applyFinanceModelOverride,
  logFullReportQuality,
  parseIqFullReport,
  type IqReportWithGrounding,
} from '@/lib/funnel/iq-full-report-schema';
import { runFullPremiumReport } from '@/lib/funnel/iq-llm';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';
import { extractCompetitorWhitelist } from '@/lib/funnel/iq-market-signals';
import { stripInternalIqReportFields } from '@/lib/funnel/iq-report-sanitize';
import {
  iqClaimReportGeneration,
  iqGetReport,
  iqMarkReportNotified,
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
  language: 'en' | 'zh';
  trigger?: string;
  attempts: Partial<Record<GenerationStage, number>>;
  timingsMs: Partial<Record<GenerationStage, number>>;
  /** Parsed LLM draft (with `_`-prefixed telemetry) awaiting verify/finalize. */
  draft?: Record<string, unknown>;
  draftSource?: 'multi_agent' | 'n8n' | 'llm';
  verified?: boolean;
  log: string[];
};

export type GenerationStatusView = {
  legacy: false;
  status: 'idle' | 'running' | 'done' | 'failed';
  stage: GenerationStage | null;
  mode: GenerationMode | null;
  /** 0–100, derived from stage + time spent in it. */
  progress: number;
  /** Index into the 6-row UI checklist. */
  activeIndex: number;
  updatedAt: string | null;
  startedAt: string | null;
  error: string | null;
  hasReport: boolean;
  generationTier: string | null;
  notifyEmail: string | null;
  notified: boolean;
  emailEnabled: boolean;
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
  language?: 'en' | 'zh';
  force?: boolean;
  trigger?: string;
}): Promise<StartResult> {
  const row = await iqGetReport(opts.reportId);
  if (!row) return { kind: 'not_found' };
  if (!row.paid) return { kind: 'unpaid' };
  if (hasStoredReport(row) && !opts.force) return { kind: 'already_done' };

  const language: 'en' | 'zh' = opts.language ?? (row.language === 'zh' ? 'zh' : 'en');
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
  language: 'en' | 'zh';
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

async function stageDraft(ctx: StageCtx): Promise<void> {
  const { state, deadline, language, professional } = ctx;
  // Re-read: enrich persisted a fresh market pack.
  const row = (await iqGetReport(ctx.row.id)) ?? ctx.row;
  const marketData = (row.market_data_json as Record<string, unknown> | null) ?? undefined;
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
      state.draft = applyCompetitorWhitelist(parseIqFullReport(parsed), whitelist);
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
      state.draft = applyCompetitorWhitelist(parseIqFullReport(raw), whitelist);
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
  const withFinance = applyFinanceModelOverride(state.draft as IqReportWithGrounding, financeModel);
  logFullReportQuality(withFinance, `reportId=${row.id} job/${state.draftSource ?? 'llm'}`);
  const clean = stripInternalIqReportFields(withFinance) as Record<string, unknown>;
  clean.generation_tier = professional ? 'professional' : 'standard';
  await iqSetFullReport(row.id, clean);
  // Drop the (large) draft from the checkpoint once the report is stored.
  delete state.draft;
  pushLog(state, `finalized (${clean.generation_tier})`);
}

async function notifyIfRequested(row: IqReportRow, language: 'en' | 'zh'): Promise<void> {
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
  const language = state.language;
  const professional = state.mode === 'professional';

  if (stage === 'done') {
    await iqUpdateReportGeneration(reportId, { status: 'done', stage: 'done', stateJson: state });
    await notifyIfRequested(row, language);
    return;
  }

  const attempt = (state.attempts[stage] ?? 0) + 1;
  state.attempts[stage] = attempt;
  // Heartbeat so a concurrent starter sees a live claim.
  await iqUpdateReportGeneration(reportId, { stage, stateJson: state });

  const deadline = createIqDeadline(STAGE_BUDGET_MS);
  const ctx: StageCtx = { row, state, deadline, language, professional };
  const t0 = Date.now();
  try {
    if (stage === 'enrich') await stageEnrich(ctx);
    else if (stage === 'draft') await stageDraft(ctx);
    else if (stage === 'verify') await stageVerify(ctx);
    else if (stage === 'finalize') await stageFinalize(ctx);
    state.timingsMs[stage] = Date.now() - t0;

    const next = nextStage(stage);
    if (next === 'done') {
      await iqUpdateReportGeneration(reportId, { status: 'done', stage: 'done', stateJson: state, error: null });
      console.log(`[iq-report-job] ${reportId}: done (${JSON.stringify(state.timingsMs)})`);
      const fresh = await iqGetReport(reportId);
      if (fresh) await notifyIfRequested(fresh, language);
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
    await iqUpdateReportGeneration(reportId, { status: 'failed', stage, stateJson: state, error: msg });
  }
}

// ---------------------------------------------------------------------------
// Status (polled by the browser) + email opt-in
// ---------------------------------------------------------------------------

/** Progress band per stage: [start, end, expectedMs]. */
const STAGE_BANDS: Record<GenerationStage, [number, number, number]> = {
  enrich: [4, 30, 40_000],
  draft: [30, 84, 170_000],
  verify: [84, 92, 60_000],
  finalize: [92, 98, 8_000],
  done: [100, 100, 1],
};

/** Checklist row (6 rows in the UI) per stage. */
const STAGE_CHECKLIST_INDEX: Record<GenerationStage, number> = {
  enrich: 1,
  draft: 3,
  verify: 4,
  finalize: 5,
  done: 5,
};

function easeOut(t: number): number {
  return 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;
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

  // Self-heal: a running job whose worker died (cold-start failure, crash) is
  // re-kicked from its last checkpoint the next time anyone asks.
  let status = statusRaw;
  if (status === 'running' && updatedAt && Date.now() - Date.parse(updatedAt) > STALE_CLAIM_MS) {
    console.warn(`[iq-report-job] ${reportId}: stale claim at ${stage}, re-kicking worker`);
    await iqUpdateReportGeneration(reportId, { stage: stage ?? 'enrich' });
    await scheduleReportWorker(reportId);
  }
  if (status === 'done' && !hasReport) status = 'failed';

  let progress = 0;
  if (status === 'done') progress = 100;
  else if (stage && status === 'running') {
    const [start, end, expected] = STAGE_BANDS[stage];
    const elapsed = updatedAt ? Date.now() - Date.parse(updatedAt) : 0;
    progress = start + (end - start) * easeOut(elapsed / expected) * 0.95;
  } else if (stage && status === 'failed') {
    progress = STAGE_BANDS[stage][0];
  }

  const tier =
    hasReport && typeof (row.full_report_json as Record<string, unknown>).generation_tier === 'string'
      ? String((row.full_report_json as Record<string, unknown>).generation_tier)
      : null;

  return {
    legacy: false,
    status,
    stage,
    mode: state?.mode ?? null,
    progress: Math.round(progress),
    activeIndex: stage ? STAGE_CHECKLIST_INDEX[stage] : 0,
    updatedAt,
    startedAt: row.generation_started_at ?? null,
    error: status === 'failed' ? row.generation_error ?? null : null,
    hasReport,
    generationTier: tier,
    notifyEmail: row.notify_email ?? null,
    notified: Boolean(row.notified_at),
    emailEnabled: isReportEmailConfigured(),
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
    if (fresh) await notifyIfRequested(fresh, fresh.language === 'zh' ? 'zh' : 'en');
    return { ok: true, sentNow: true };
  }
  return { ok: true, sentNow: false };
}
