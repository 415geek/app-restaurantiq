import { NextResponse } from 'next/server';
import { iqGetReport, iqLinkReportToUser } from '@/lib/funnel/iq-repository';

const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export async function POST(req: Request) {
  try {
    let userId: string | null = null;
    
    if (isClerkConfigured) {
      try {
        const { auth } = await import('@clerk/nextjs/server');
        const session = await auth();
        userId = session.userId;
      } catch (e) {
        console.error('[link-report] auth error:', e);
      }
    }
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reportId } = (await req.json()) as { reportId?: string };
    if (!reportId) {
      return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
    }

    const report = await iqGetReport(reportId);
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (!report.paid) {
      return NextResponse.json({ error: 'Report not paid' }, { status: 403 });
    }

    await iqLinkReportToUser(reportId, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/iq/link-report]', error);
    return NextResponse.json({ error: 'Failed to link report' }, { status: 500 });
  }
}
