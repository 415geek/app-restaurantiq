import { NextResponse } from 'next/server';
import { getPublicBaseUrl } from '@/lib/funnel/base-url';
import { iqGetReport, iqUpdateStripeSession } from '@/lib/funnel/iq-repository';

export const runtime = 'nodejs';

async function createStripeCheckoutSession(params: {
  priceId?: string;
  amountUsd: number;
  reportId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');

  const body = new URLSearchParams();
  body.append('mode', 'payment');
  body.append('customer_creation', 'always');
  body.append('allow_promotion_codes', 'true');
  body.append('metadata[reportId]', params.reportId);
  body.append('success_url', params.successUrl);
  body.append('cancel_url', params.cancelUrl);

  if (params.priceId) {
    body.append('line_items[0][price]', params.priceId);
    body.append('line_items[0][quantity]', '1');
  } else {
    body.append('line_items[0][quantity]', '1');
    body.append('line_items[0][price_data][currency]', 'usd');
    body.append('line_items[0][price_data][unit_amount]', String(Math.round(params.amountUsd * 100)));
    body.append('line_items[0][price_data][product_data][name]', 'RestaurantIQ Full Report');
    body.append('line_items[0][price_data][product_data][description]', 'Unlock the complete AI decision report');
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || 'Stripe API error');
  }
  return { id: json.id, url: json.url };
}

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

    if (!process.env.STRIPE_SECRET_KEY?.trim()) {
      return NextResponse.json(
        { error: 'Payment is not configured. Please try again later or contact support.' },
        { status: 503 }
      );
    }

    const baseUrl = getPublicBaseUrl();
    const priceId = process.env.STRIPE_PRICE_ID?.trim();
    const amountUsd = Number(process.env.NEXT_PUBLIC_STRIPE_PRICE_USD || '19');

    const session = await createStripeCheckoutSession({
      priceId,
      amountUsd,
      reportId,
      successUrl: `${baseUrl}/iq/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/iq/cancel?reportId=${encodeURIComponent(reportId)}`,
    });

    if (session.id) {
      await iqUpdateStripeSession(reportId, session.id);
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[funnel/create-checkout-session]', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Failed to create checkout session', detail: message.slice(0, 300) }, { status: 500 });
  }
}
