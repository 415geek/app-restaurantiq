import { NextResponse } from 'next/server';
import { normalizeEmail, normalizeReportId, recoverByEmail, recoverByReportId } from '@/lib/funnel/iq-support-recover';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/iq/support/recover  { reportId?: string; email?: string }
 * → { reports: RecoveredReport[] }  (only paid reports; empty when nothing matches)
 *
 * Used by the support bubble to send a customer back to their generating /
 * finished report after a refresh or back-navigation.
 */
export async function POST(req: Request): Promise<Response> {
  await ensureRuntimeConfig();
  let body: { reportId?: unknown; email?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const reportId = normalizeReportId(body.reportId);
  const email = normalizeEmail(body.email);
  if (!reportId && !email) return NextResponse.json({ error: 'reportId or email required' }, { status: 400 });
  try {
    if (reportId) {
      const one = await recoverByReportId(reportId);
      if (one) return NextResponse.json({ reports: [one] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const list = email ? await recoverByEmail(email) : [];
    return NextResponse.json({ reports: list }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[support/recover]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
}
