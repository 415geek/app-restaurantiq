import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/funnel/stripe-server';
import { iqGetReport, iqMarkPaidAndReport } from '@/lib/funnel/iq-repository';
import { runFullReport } from '@/lib/funnel/iq-llm';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new NextResponse('Missing stripe-signature header', { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new NextResponse('Missing STRIPE_WEBHOOK_SECRET', { status: 500 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('[funnel/stripe/webhook] signature failed', err);
    return new NextResponse('Invalid signature', { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const reportId = session.metadata?.reportId;
      if (!reportId) {
        return NextResponse.json({ received: true });
      }

      const existing = await iqGetReport(reportId);
      if (!existing) {
        return NextResponse.json({ received: true });
      }

      let fullJson = existing.full_report_json as Record<string, unknown> | null;
      if (!fullJson || Object.keys(fullJson).length === 0) {
        try {
          fullJson = (await runFullReport({
            location: existing.location,
            businessType: existing.business_type,
            headline: existing.headline,
            reason: existing.reason,
          })) as Record<string, unknown>;
        } catch (genErr) {
          console.error('[funnel/stripe/webhook] full report generation failed', genErr);
          fullJson = null;
        }
      }

      const email =
        session.customer_details?.email ??
        (typeof session.customer_email === 'string' ? session.customer_email : null);

      await iqMarkPaidAndReport({
        reportId,
        stripeSessionId: session.id,
        customerEmail: email,
        fullReportJson: fullJson,
      });
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('[funnel/stripe/webhook] handler error', e);
    return new NextResponse('Webhook handler error', { status: 500 });
  }
}
