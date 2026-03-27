import { NextResponse } from 'next/server';
import { iqIncrementShareCount } from '@/lib/funnel/iq-repository';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { reportId?: string; platform?: string };
    const { reportId, platform } = body;

    if (!reportId) {
      return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
    }

    await iqIncrementShareCount(reportId);

    console.log(`[track-share] Report ${reportId} shared via ${platform || 'unknown'}`);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[track-share]', e);
    return NextResponse.json({ success: false });
  }
}
