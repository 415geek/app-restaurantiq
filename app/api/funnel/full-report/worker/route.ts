import { NextResponse, after } from 'next/server';
import { runReportGenerationStage, verifyWorkerSecret } from '@/lib/funnel/iq-report-job';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export const runtime = 'nodejs';
/** One generation stage per invocation; must cover STAGE_BUDGET_MS + persistence. */
export const maxDuration = 300;

/**
 * Internal worker: runs ONE stage of the background report job, then chains
 * the next invocation. Responds 202 immediately and does the work in after()
 * so the caller (the previous stage, or the start endpoint) never waits on it.
 */
export async function POST(req: Request) {
  await ensureRuntimeConfig();
  if (!verifyWorkerSecret(req.headers.get('x-iq-worker-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { reportId } = (await req.json().catch(() => ({}))) as { reportId?: string };
  if (!reportId) return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });

  after(async () => {
    try {
      await runReportGenerationStage(reportId);
    } catch (e) {
      console.error('[full-report/worker] stage crashed:', e);
    }
  });

  return NextResponse.json({ accepted: true, reportId }, { status: 202 });
}
