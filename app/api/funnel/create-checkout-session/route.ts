import { NextResponse } from 'next/server';
import { getPublicBaseUrl } from '@/lib/funnel/base-url';
import { getStripe } from '@/lib/funnel/stripe-server';
import { iqGetReport, iqUpdateStripeSession } from '@/lib/funnel/iq-repository';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { reportId } = (await req.json()) as { reportId?: string };
    if (!reportId) {
      return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
    }

    const report = await iqGetReport(reportId);
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    const baseUrl = getPublicBaseUrl();
    const priceId = process.env.STRIPE_PRICE_ID?.trim();
    const amountUsd = Number(process.env.NEXT_PUBLIC_STRIPE_PRICE_USD || '19');

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'always',
      metadata: { reportId },
      success_url: `${baseUrl}/iq/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/iq/cancel?reportId=${encodeURIComponent(reportId)}`,
      line_items: priceId
        ? [{ price: priceId, quantity: 1 }]
        : [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: Math.round(amountUsd * 100),
                product_data: {
                  name: 'RestaurantIQ Full Report',
                  description: 'Unlock the complete AI decision report',
                },
              },
            },
          ],
    });

    if (session.id) {
      await iqUpdateStripeSession(reportId, session.id);
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[funnel/create-checkout-session]', e);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
