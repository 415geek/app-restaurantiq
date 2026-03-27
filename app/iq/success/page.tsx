import Link from 'next/link';
import { redirect } from 'next/navigation';
import { iqGetReport } from '@/lib/funnel/iq-repository';

type Props = {
  searchParams?: Promise<{ session_id?: string }>;
};

async function getStripeSession(sessionId: string): Promise<{ reportId: string | null; status: string | null }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
    },
  });

  if (!res.ok) {
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
  } catch {
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

  const report = await iqGetReport(reportId);
  if (report?.paid) {
    redirect(`/iq/report/${reportId}`);
  }

  if (paymentStatus === 'paid') {
    redirect(`/iq/report/${reportId}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-3xl font-bold">Payment received</h1>
        <p className="text-white/70">
          Your report is being generated. This usually takes a few seconds.
        </p>
        <Link
          href={`/iq/report/${reportId}`}
          className="inline-block rounded-xl bg-emerald-400 px-6 py-3 font-semibold text-black"
        >
          View Full Report
        </Link>
      </div>
    </main>
  );
}
