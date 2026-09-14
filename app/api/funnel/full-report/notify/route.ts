import { NextResponse } from 'next/server';
import { isReportEmailConfigured, isValidEmail } from '@/lib/email/send-report-email';
import { requestReportEmail } from '@/lib/funnel/iq-report-job';

export const runtime = 'nodejs';

/**
 * "Email me when it's ready": `POST { reportId, email }`.
 * The address is always stored on the report (`notify_email`); the worker
 * sends the link on finalize when RESEND_API_KEY is configured. Without it the
 * address is still kept and the response says so (`willSend: false`) so the
 * UI never promises an email that cannot go out.
 */
export async function POST(req: Request) {
  const { reportId, email } = (await req.json().catch(() => ({}))) as {
    reportId?: string;
    email?: string;
  };
  const addr = String(email ?? '').trim().toLowerCase();
  if (!reportId) return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
  if (!isValidEmail(addr)) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  const willSend = isReportEmailConfigured();

  try {
    const res = await requestReportEmail(reportId, addr);
    if (!res.ok) {
      const status = res.reason === 'not_found' ? 404 : res.reason === 'unpaid' ? 402 : 503;
      return NextResponse.json({ error: res.reason }, { status });
    }
    return NextResponse.json({ ok: true, willSend, sentNow: willSend && res.sentNow });
  } catch (e) {
    console.error('[full-report/notify]', e);
    return NextResponse.json({ error: 'Failed to save email' }, { status: 500 });
  }
}
