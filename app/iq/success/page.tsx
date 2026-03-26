import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStripe } from '@/lib/funnel/stripe-server';
import { iqGetReport } from '@/lib/funnel/iq-repository';

type Props = {
  searchParams?: Promise<{ session_id?: string }>;
};

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
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    reportId = session.metadata?.reportId ?? null;
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

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-3xl font-bold">Payment received</h1>
        <p className="text-white/70">
          Your report is unlocking via Stripe webhook. This usually takes a few seconds.
        </p>
        <Link
          href={`/iq/report/${reportId}`}
          className="inline-block rounded-xl bg-emerald-400 px-6 py-3 font-semibold text-black"
        >
          Open report
        </Link>
      </div>
    </main>
  );
}
