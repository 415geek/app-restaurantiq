import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { iqGetReport, iqMarkPaidAndReport } from '@/lib/funnel/iq-repository';
import { runFullReport } from '@/lib/funnel/iq-llm';
import { generateFullReportWithN8n } from '@/lib/n8n';

export const runtime = 'nodejs';

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      metadata?: { reportId?: string };
      customer_details?: { email?: string };
      customer_email?: string;
    };
  };
};

function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  const timestamp = parts['t'];
  const v1Signature = parts['v1'];
  if (!timestamp || !v1Signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = createHmac('sha256', secret).update(signedPayload).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(v1Signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

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

  if (!verifyStripeSignature(body, signature, webhookSecret)) {
    console.error('[funnel/stripe/webhook] signature verification failed');
    return new NextResponse('Invalid signature', { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
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
          const hasN8nWebhook = Boolean(
            process.env.N8N_FULL_REPORT_WEBHOOK_URL?.trim() || process.env.N8N_IQ_FULL_REPORT_WEBHOOK_URL?.trim()
          );
          const marketData = existing.market_data_json as Record<string, unknown> | null;
          
          fullJson = hasN8nWebhook
            ? ((await generateFullReportWithN8n({
                analysis_id: existing.id,
                address: existing.location,
                industry: 'restaurant',
                cuisine_type: existing.business_type ?? undefined,
                market_data: marketData ?? undefined,
                headline: existing.headline,
                reason: existing.reason,
                language: existing.language === 'zh' ? 'zh' : 'en',
              })) as Record<string, unknown>)
            : ((await runFullReport({
                location: existing.location,
                businessType: existing.business_type,
                headline: existing.headline,
                reason: existing.reason,
                marketData: marketData ?? undefined,
              })) as Record<string, unknown>);
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
