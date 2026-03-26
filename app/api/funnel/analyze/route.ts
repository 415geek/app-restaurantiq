import { NextResponse } from 'next/server';
import { iqInsertReport } from '@/lib/funnel/iq-repository';
import { runPartialAnalysis } from '@/lib/funnel/iq-llm';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { location?: string; businessType?: string };
    const location = String(body.location ?? '').trim();
    const businessType = String(body.businessType ?? '').trim();

    if (!location) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    if (location.length > 500) {
      return NextResponse.json({ error: 'Location is too long' }, { status: 400 });
    }

    const parsed = await runPartialAnalysis({ location, businessType });

    const reportId = await iqInsertReport({
      location,
      businessType: businessType || null,
      verdict: parsed.verdict,
      headline: parsed.headline,
      reason: parsed.reason,
    });

    return NextResponse.json({
      reportId,
      verdict: parsed.verdict,
      headline: parsed.headline,
      reason: parsed.reason,
    });
  } catch (e) {
    console.error('[funnel/analyze]', e);
    return NextResponse.json({ error: 'Failed to analyze location' }, { status: 500 });
  }
}
