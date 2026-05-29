import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { iqGetReport } from '@/lib/funnel/iq-repository';
import { fulfillIqPaidPurchase } from '@/lib/funnel/iq-complete-purchase';

export const runtime = 'nodejs';

/**
 * Redeems a one-shared-secret access code that grants full-report access without
 * going through Stripe. Same fulfillment path as the paid flow:
 *   1. Mark the report row as paid.
 *   2. Generate full_report_json on the report page (deferred) unless already cached.
 * Rotate by setting IQ_ACCESS_CODE in the Vercel env. The compiled-in default is a
 * convenience for local dev; production should always set the env var.
 */

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { reportId?: string; code?: string }
      | null;
    const reportId = body?.reportId?.trim();
    const code = body?.code?.trim();

    if (!reportId || !code) {
      return NextResponse.json({ error: 'Missing reportId or code' }, { status: 400 });
    }
    if (code.length > 64) {
      return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
    }

    const expected = (process.env.IQ_ACCESS_CODE ?? 'menusifu2026').trim();
    if (!expected) {
      return NextResponse.json({ error: 'Access code not configured' }, { status: 503 });
    }
    if (!safeEqual(code, expected)) {
      return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
    }

    const existing = await iqGetReport(reportId);
    if (!existing) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    const lang = existing.language === 'zh' ? 'zh' : 'en';

    const hasCachedFull =
      existing.full_report_json &&
      typeof existing.full_report_json === 'object' &&
      Object.keys(existing.full_report_json as object).length > 0;

    if (!existing.paid) {
      const sentinel = `access_code:${Date.now()}:${reportId.slice(0, 8)}`;
      await fulfillIqPaidPurchase({
        reportId,
        stripeSessionId: sentinel,
        customerEmail: null,
        // Avoid blocking this API on Tavily + MiMo + dual-verify (often 1–5+ min).
        deferFullReportGeneration: !hasCachedFull,
      });
    }

    return NextResponse.json({
      ok: true,
      reportUrl: `/iq/report/${reportId}?lang=${lang}`,
      generating: !hasCachedFull,
    });
  } catch (e) {
    console.error('[funnel/redeem-access-code]', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: 'Failed to redeem access code', detail: message.slice(0, 500) },
      { status: 500 },
    );
  }
}
