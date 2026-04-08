import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { iqGetReport, iqLinkReportToUser } from '@/lib/funnel/iq-repository';
import { fulfillIqPaidPurchase } from '@/lib/funnel/iq-complete-purchase';

type Props = {
  searchParams?: Promise<{ session_id?: string }>;
};

type StripeSessionPayload = {
  metadata?: { reportId?: string };
  payment_status?: string;
  status?: string;
  customer_details?: { email?: string };
  customer_email?: string;
};

async function getStripeCheckoutSession(sessionId: string): Promise<{
  reportId: string | null;
  paymentStatus: string | null;
  checkoutStatus: string | null;
  customerEmail: string | null;
}> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    console.error('[getStripeCheckoutSession] STRIPE_SECRET_KEY not set');
    throw new Error('STRIPE_SECRET_KEY not set');
  }

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[getStripeCheckoutSession] Failed:', res.status, errText);
    throw new Error('Failed to retrieve session');
  }

  const session = (await res.json()) as StripeSessionPayload;
  const customerEmail =
    session.customer_details?.email ??
    (typeof session.customer_email === 'string' ? session.customer_email : null);

  return {
    reportId: session.metadata?.reportId ?? null,
    paymentStatus: session.payment_status ?? null,
    checkoutStatus: session.status ?? null,
    customerEmail,
  };
}

function checkoutPaymentSucceeded(paymentStatus: string | null, checkoutStatus: string | null): boolean {
  const paid =
    paymentStatus === 'paid' ||
    paymentStatus === 'no_payment_required';
  const complete = checkoutStatus === 'complete';
  return paid && complete;
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
  let checkoutStatus: string | null = null;
  let customerEmail: string | null = null;
  try {
    const session = await getStripeCheckoutSession(sessionId);
    reportId = session.reportId;
    paymentStatus = session.paymentStatus;
    checkoutStatus = session.checkoutStatus;
    customerEmail = session.customerEmail;
  } catch (err) {
    console.error('[success] getStripeCheckoutSession error:', err);
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

  if (report?.paid) {
    redirect(`/iq/report/${reportId}`);
  }

  /** Stripe redirects here before webhooks; mark paid in DB so /iq/report/[id] does not show locked. */
  if (checkoutPaymentSucceeded(paymentStatus, checkoutStatus)) {
    try {
      await fulfillIqPaidPurchase({
        reportId,
        stripeSessionId: sessionId,
        customerEmail,
      });
    } catch (e) {
      console.error('[success] fulfillIqPaidPurchase error:', e);
      return (
        <main className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-md space-y-4 text-center">
            <p className="text-white/90">Payment received, but we could not unlock your report yet.</p>
            <p className="text-sm text-white/60">Please wait a minute and refresh, or contact support with your session ID.</p>
            <Link
              href={`/iq/report/${reportId}`}
              className="inline-block text-emerald-400 underline"
            >
              Try opening report again
            </Link>
          </div>
        </main>
      );
    }
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
