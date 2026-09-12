import { NextResponse } from 'next/server';
import { isOpsAuthorized } from '@/lib/iq/ops/auth';
import { parseOpsParams, runOps } from '@/lib/iq/ops/run';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Ops endpoint for the 360° data jobs — the cron-on-Vercel replacement for
 * running scripts/*.ts by hand.
 *
 *   GET|POST /api/iq/ops?task=migrate|lodes|hubs|snapshots|all
 *            &metro=sf-bay&state=ca&year=2022&counties=06081,06075&dryRun=1&maxDetails=0&force=1
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron adds it when the
 * CRON_SECRET env var exists) or `x-iq-worker-secret` (IQ_WORKER_SECRET / the
 * derived worker secret). Tasks run inline within the 300 s budget; `lodes`
 * gets ≈ 240 s and returns `counties_remaining` when it has to stop early
 * (progress is recorded, the next cron run continues). `all` runs
 * migrate → hubs → snapshots → lodes (one county) and never throws — per-task
 * errors are collected in the JSON body (`ok: false` when any task failed).
 */
async function handle(req: Request): Promise<Response> {
  if (!isOpsAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let params;
  try {
    params = parseOpsParams(new URL(req.url).searchParams);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  // Leave headroom under maxDuration for the response itself. `lodes` ≈ 240 s.
  const budgetMs = params.task === 'lodes' ? 240_000 : 280_000;
  const result = await runOps(params, { budgetMs });
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request) {
  await ensureRuntimeConfig();
  return handle(req);
}

export async function POST(req: Request) {
  await ensureRuntimeConfig();
  return handle(req);
}
