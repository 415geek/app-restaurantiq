/**
 * generateReport360 — the full 360° job for one paid report row:
 * pipeline → page narratives → QA gates → persist (report_model_json,
 * narrative_json, tier) → itemized cost log. Never throws for QA failures:
 * a failing report is stored as tier 'precheck' with its reasons.
 */
import { iqGetReport, iqSetReportModel, isMissingColumnError } from '@/lib/funnel/iq-repository';
import { toLocale, type Locale } from '@/lib/i18n/locale';
import { createFetchContext } from './data/context';
import { persistCostLog, REPORT_COST_CAP_USD } from './data/cost-log';
import { generateNarratives } from './narrative/generate';
import { runQaGates, type GatesReport } from './qa/gates';
import { runPendingMigrations } from './ops/migrate';
import { runReport360, type Report360Options } from './pipeline';
import type { FetchContext } from './data/types';
import { reportModelSchema, type ReportModel } from './model/schema';

export interface Generate360Result {
  model: ReportModel;
  gates: GatesReport;
  persisted: boolean;
  cost_usd: number;
  elapsed_ms: number;
}

export async function generateReport360(
  input: { reportId: string; address: string; cuisineText: string | null; language: Locale; user?: Record<string, unknown> },
  opts: Report360Options & { persist?: boolean; narrative?: boolean } = {},
): Promise<Generate360Result> {
  const t0 = Date.now();
  const ctx = opts.ctx ?? createFetchContext({ budgetMs: 60_000 });
  const { model } = await runReport360(
    { report_id: input.reportId, address: input.address, cuisine_text: input.cuisineText, language: input.language, ...(input.user ?? {}) },
    { ...opts, ctx },
  );

  if (opts.narrative !== false) {
    const { narrative, stats } = await generateNarratives(model, { cost: ctx.cost, env: ctx.env, language: input.language });
    model.narrative = narrative;
    model.meta.narrative_pass = 'llm';
    ctx.log(`[iq360] narrative: llm=${stats.llm_pages} template=${stats.template_pages} regen=${stats.regenerated}`);
  } else {
    // §4.1 ordering: the core runs first, with template prose only; the LLM pass
    // follows and rewrites the pages around these same frozen numbers.
    const { PAGES, templateNarrative } = await import('./narrative/templates');
    for (const p of PAGES) model.narrative[p.id] = templateNarrative(model, p.id, input.language);
    model.meta.narrative_pass = 'template';
  }
  model.meta.language = input.language;
  model.meta.narrative_language = input.language;

  const gates = runQaGates(model);
  if (!gates.passed) {
    model.meta.tier = 'precheck';
    const known = new Set(model.meta.precheck_reasons);
    const fresh = gates.failures.filter((f) => !known.has(f.replace(/^\[\w+\] /, '')));
    model.meta.precheck_reasons = [...new Set([...model.meta.precheck_reasons, ...fresh])];
  }
  model.meta.cost_usd = ctx.cost.total();
  model.meta.cost_breakdown = ctx.cost.bySource();
  model.meta.elapsed_ms = Date.now() - t0;
  if (model.meta.cost_usd > REPORT_COST_CAP_USD) ctx.log(`[iq360] cost $${model.meta.cost_usd} exceeds cap $${REPORT_COST_CAP_USD}`, model.meta.cost_breakdown);

  let persisted = false;
  if (opts.persist !== false) {
    const { narrative, ...rest } = model;
    // `__lang` records the narrative language so the renderer can fall back to templates when a report is printed in another language.
    const narrativeJson: Record<string, unknown> = { ...narrative, __lang: input.language };
    const persist = () =>
      iqSetReportModel({ reportId: input.reportId, reportModelJson: rest as unknown as Record<string, unknown>, narrativeJson, tier: model.meta.tier, costUsd: model.meta.cost_usd });
    try {
      await persist();
      persisted = true;
    } catch (e) {
      if (isMissingColumnError(e)) {
        // Migration 0009 not applied: apply it now over DATABASE_URL and retry once.
        const mig = await runPendingMigrations();
        if (mig.ok) {
          try {
            await persist();
            persisted = true;
            ctx.log(`[iq360] applied migrations ${mig.applied.join(', ')} and persisted`);
          } catch (e2) {
            ctx.log('[iq360] persist failed after migration', e2);
          }
        } else ctx.log(`[iq360] migration 0009 missing and auto-migrate unavailable: ${mig.reason}`);
      } else ctx.log('[iq360] persist failed', e);
    }
    await persistCostLog(input.reportId, ctx.cost);
  }
  return { model, gates, persisted, cost_usd: model.meta.cost_usd, elapsed_ms: model.meta.elapsed_ms };
}

/**
 * §4.1 单一结论源 (P0-A) — the narrative pass.
 *
 * The deterministic core now runs BEFORE the web draft (lib/funnel/iq-report-job.ts),
 * so by the time this runs `report_model_json` already holds the frozen conclusion.
 * This pass therefore only writes prose: it re-parses the stored model (the parse
 * applies the conclusion guard), generates the page narratives and persists them.
 * It never recomputes finance or score — the customer's numbers are already fixed.
 */
export async function generateReport360Narratives(
  reportId: string,
  opts: { ctx?: FetchContext } = {},
): Promise<{ model: ReportModel; persisted: boolean } | null> {
  const row = await iqGetReport(reportId);
  if (!row?.report_model_json) return null;
  const parsed = reportModelSchema.safeParse(row.report_model_json);
  if (!parsed.success) {
    console.warn(`[iq360] narratives: stored model for ${reportId} failed validation`, parsed.error.issues.slice(0, 3));
    return null;
  }
  const model = parsed.data;
  const ctx = opts.ctx ?? createFetchContext({ budgetMs: 120_000 });
  const language = toLocale(row.language, model.meta.language);
  const { narrative, stats } = await generateNarratives(model, { cost: ctx.cost, env: ctx.env, language });
  model.narrative = narrative;
  model.meta.language = language;
  model.meta.narrative_language = language;
  model.meta.narrative_pass = 'llm';
  ctx.log(`[iq360] narrative-only: llm=${stats.llm_pages} template=${stats.template_pages} regen=${stats.regenerated}`);
  const { narrative: n, ...rest } = model;
  let persisted = false;
  try {
    await iqSetReportModel({
      reportId,
      reportModelJson: rest as unknown as Record<string, unknown>,
      narrativeJson: { ...n, __lang: language },
      tier: model.meta.tier,
      costUsd: model.meta.cost_usd,
    });
    persisted = true;
  } catch (e) {
    console.warn('[iq360] narrative-only persist failed', e);
  }
  return { model, persisted };
}

/** True when the stored model carries the frozen conclusion but its prose is still the template pass. */
export function needsNarrativePass(reportModelJson: unknown): boolean {
  if (!reportModelJson || typeof reportModelJson !== 'object') return false;
  const m = reportModelJson as { conclusion?: unknown; meta?: { narrative_pass?: unknown } };
  if (!m.conclusion) return false;
  return m.meta?.narrative_pass !== 'llm';
}

/** Convenience for the API route: load the row, derive inputs, run. */
export async function generateReport360ForRow(reportId: string, opts: Report360Options & { persist?: boolean; narrative?: boolean } = {}): Promise<Generate360Result | null> {
  const row = await iqGetReport(reportId);
  if (!row) return null;
  // `market_data_json.user_inputs` is written by /api/funnel/analyze (rent, sqft) and
  // /api/funnel/report-inputs (everything else); every key is optional and D12 re-normalizes.
  const md = (row.market_data_json ?? {}) as {
    user_inputs?: {
      monthly_rent_usd?: unknown;
      sqft?: unknown;
      seats?: unknown;
      ticket_in?: unknown;
      ticket_delivery?: unknown;
      delivery_ratio?: unknown;
      capex_usd?: unknown;
      parking_spaces?: unknown;
      existing_stores?: unknown;
      listing_urls?: unknown;
      known_competitors?: unknown;
    };
  };
  const u = md.user_inputs ?? {};
  return generateReport360(
    {
      reportId,
      address: row.location,
      cuisineText: row.business_type,
      language: toLocale(row.language),
      user: {
        rent_usd: u.monthly_rent_usd ?? null,
        sqft: u.sqft ?? null,
        seats: u.seats ?? null,
        capex_usd: u.capex_usd ?? null,
        ticket_in: u.ticket_in ?? null,
        ticket_delivery: u.ticket_delivery ?? null,
        delivery_ratio: u.delivery_ratio ?? null,
        parking_spaces: u.parking_spaces ?? null,
        existing_stores: u.existing_stores ?? [],
        listing_urls: u.listing_urls ?? [],
        known_competitors: u.known_competitors ?? [],
      },
    },
    opts,
  );
}
