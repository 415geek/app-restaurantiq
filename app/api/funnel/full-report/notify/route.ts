import { NextResponse } from 'next/server';
import { isReportEmailConfigured, isValidEmail } from '@/lib/email/send-report-email';
import { requestReportEmail } from '@/lib/funnel/iq-report-job';

export const runtime = 'nodejs';

/**
 * "Email me when it's ready": `POST { reportId, email }`.
 * The address is stored on the report; the worker sends the link on finalize.
 */
export async function POST(req: Request) {
  const { reportId, email } = (await req.json().catch(() => ({}))) as {
    reportId?: string;
    email?: string;
  };
  const addr = String(email ?? '').trim().toLowerCase();
  if (!reportId) return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
  if (!isValidEmail(addr)) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  if (!isReportEmailConfigured()) {
    return NextResponse.json({ error: 'Email delivery is not configured' }, { status: 503 });
  }

  try {
    const res = await requestReportEmail(reportId, addr);
    if (!res.ok) {
      const status = res.reason === 'not_found' ? 404 : res.reason === 'unpaid' ? 402 : 503;
      return NextResponse.json({ error: res.reason }, { status });
    }
    return NextResponse.json({ ok: true, sentNow: res.sentNow });
  } catch (e) {
    console.error('[full-report/notify]', e);
    return NextResponse.json({ error: 'Failed to save email' }, { status: 500 });
  }
}
