import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { iqGetReport, iqLinkReportToUser } from '@/lib/funnel/iq-repository';

type Props = {
  searchParams?: Promise<{ session_id?: string }>;
};

async function getStripeSession(sessionId: string): Promise<{ reportId: string | null; status: string | null }> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    console.error('[getStripeSession] STRIPE_SECRET_KEY not set');
    throw new Error('STRIPE_SECRET_KEY not set');
  }

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[getStripeSession] Failed:', res.status, errText);
    throw new Error('Failed to retrieve session');
  }

  const session = await res.json();
  return {
    reportId: session.metadata?.reportId ?? null,
    status: session.payment_status ?? null,
  };
}

export default async function IqSuccessPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const sessionId = sp.session_id;
  if (!sessionId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p>Missing session ID.</p>
      </main>
    );
  }

  let reportId: string | null = null;
  let paymentStatus: string | null = null;
  try {
    const session = await getStripeSession(sessionId);
    reportId = session.reportId;
    paymentStatus = session.status;
  } catch (err) {
    console.error('[success] getStripeSession error:', err);
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p>Could not verify payment session.</p>
      </main>
    );
  }

  if (!reportId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p>Missing report reference.</p>
      </main>
    );
  }

  let report;
  try {
    report = await iqGetReport(reportId);
  } catch (err) {
    console.error('[success] iqGetReport error:', err);
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p>Could not load report data.</p>
      </main>
    );
  }
  
  // Auto-link report to user if logged in (only if Clerk is configured)
  const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  if (isClerkConfigured) {
    try {
      const { userId } = await auth();
      if (userId && report && !report.user_id) {
        await iqLinkReportToUser(reportId, userId);
      }
    } catch (e) {
      console.error('[success] Failed to auto-link report to user:', e);
    }
  }

  if (report?.paid || paymentStatus === 'paid') {
    redirect(`/iq/report/${reportId}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="mb-4 text-5xl">✅</div>
        <h1 className="text-3xl font-bold text-white">Payment Successful!</h1>
        <p className="text-white/70">
          Your premium report is being generated. This usually takes a few seconds.
        </p>
        <div className="animate-pulse">
          <div className="mx-auto h-2 w-32 rounded-full bg-emerald-500/30" />
        </div>
        <Link
          href={`/iq/report/${reportId}`}
          className="inline-block rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-black transition hover:bg-emerald-400"
        >
          View Full Report →
        </Link>
      </div>
    </main>
  );
}
