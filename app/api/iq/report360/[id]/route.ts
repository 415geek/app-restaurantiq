import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { iqGetReport, iqHasReportModelColumn } from '@/lib/funnel/iq-repository';
import { verifyWorkerSecret } from '@/lib/funnel/iq-report-job';
import { generateReport360ForRow, generateReport360Narratives, needsNarrativePass } from '@/lib/iq/generate';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 360° report generation for a paid row.
 *   POST /api/iq/report360/:id            → 202, runs in the background (after())
 *   POST /api/iq/report360/:id?sync=1     → waits and returns { tier, total, verdict, gates } (ops / worker only)
 *   GET  /api/iq/report360/:id            → status: whether report_model_json exists, tier, cost
 * Auth: the row must be paid; sync mode additionally requires the worker secret.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureRuntimeConfig();
  const { id } = await params;
  const row = await iqGetReport(id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!row.paid) return NextResponse.json({ error: 'unpaid' }, { status: 403 });
  const model = row.report_model_json as { meta?: { tier?: string; cost_usd?: number; generated_at?: string; precheck_reasons?: string[] }; score?: { total?: number; verdict?: string } } | null | undefined;
  const migration_needed = model ? false : !(await iqHasReportModelColumn());
  return NextResponse.json({
    ready: Boolean(model),
    migration_needed,
    precheck_reasons: model?.meta?.precheck_reasons ?? [],
    tier: row.report_tier ?? model?.meta?.tier ?? null,
    generated_at: model?.meta?.generated_at ?? null,
    cost_usd: row.report_cost_usd ?? model?.meta?.cost_usd ?? null,
    total: model?.score?.total ?? null,
    verdict: model?.score?.verdict ?? null,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureRuntimeConfig();
  const { id } = await params;
  const url = new URL(req.url);
  const sync = url.searchParams.get('sync') === '1';
  const row = await iqGetReport(id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!row.paid) return NextResponse.json({ error: 'unpaid' }, { status: 403 });
  if (sync) {
    if (!verifyWorkerSecret(req.headers.get('x-iq-worker-secret'))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const r = await generateReport360ForRow(id);
    if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ tier: r.model.meta.tier, total: r.model.score.total, verdict: r.model.score.verdict, cost_usd: r.cost_usd, elapsed_ms: r.elapsed_ms, persisted: r.persisted, gates: r.gates.failures });
  }
  const force = url.searchParams.get('force') === '1';
  // §4.1 单一结论源: the deterministic core already ran before the web draft, so a
  // stored model here needs PROSE only — never a second run that would recompute
  // the conclusion the customer has already been shown.
  if (row.report_model_json && !force) {
    if (!needsNarrativePass(row.report_model_json)) {
      return NextResponse.json({ status: 'ready', tier: row.report_tier ?? null }, { status: 200 });
    }
    after(async () => {
      try {
        const r = await generateReport360Narratives(id);
        console.log(`[iq360] report ${id}: narratives ${r ? `persisted=${r.persisted}` : 'skipped'}`);
      } catch (e) {
        console.error('[iq360] narrative pass failed', id, e);
      }
    });
    return NextResponse.json({ status: 'running', phase: 'narrative' }, { status: 202 });
  }
  after(async () => {
    try {
      const r = await generateReport360ForRow(id);
      console.log(`[iq360] report ${id}: tier=${r?.model.meta.tier} total=${r?.model.score.total} cost=$${r?.cost_usd} persisted=${r?.persisted}`);
    } catch (e) {
      console.error('[iq360] generation failed', id, e);
    }
  });
  return NextResponse.json({ status: 'running' }, { status: 202 });
}
