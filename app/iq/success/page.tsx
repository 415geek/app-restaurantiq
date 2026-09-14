import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { iqGetReport, iqLinkReportToUser } from '@/lib/funnel/iq-repository';
import { fulfillIqPaidPurchase } from '@/lib/funnel/iq-complete-purchase';
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { strictLocale, withLang } from '@/lib/i18n/resolve';
import { resolveServerLocale } from '@/lib/i18n/server-locale';

type Props = {
  searchParams?: Promise<{ session_id?: string; lang?: string }>;
};

type StripeSessionPayload = {
  metadata?: { reportId?: string };
  payment_status?: string;
  status?: string;
  customer_details?: { email?: string };
  customer_email?: string;
};

const COPY: Record<
  Locale,
  {
    missingSession: string;
    verifyFailed: string;
    missingReport: string;
    loadFailed: string;
    unlockFailedTitle: string;
    unlockFailedBody: string;
    unlockFailedRetry: string;
    title: string;
    body: string;
    view: string;
  }
> = {
  en: {
    missingSession: 'Missing session ID.',
    verifyFailed: 'We could not verify the payment session.',
    missingReport: 'Missing report reference.',
    loadFailed: 'We could not load the report data.',
    unlockFailedTitle: 'Payment received, but we could not unlock your report yet.',
    unlockFailedBody: 'Please wait a minute and refresh, or contact support with your session ID.',
    unlockFailedRetry: 'Try opening the report again',
    title: 'Payment successful',
    body: 'Your professional report is being generated. This usually takes a few seconds.',
    view: 'View the full report →',
  },
  zh: {
    missingSession: '缺少支付会话 ID。',
    verifyFailed: '无法核实支付会话。',
    missingReport: '缺少报告引用。',
    loadFailed: '无法加载报告数据。',
    unlockFailedTitle: '已收到付款，但暂时还没能解锁你的报告。',
    unlockFailedBody: '请稍等一分钟后刷新，或带上支付会话 ID 联系客服。',
    unlockFailedRetry: '再次尝试打开报告',
    title: '支付成功',
    body: '你的专业版报告正在生成，通常只需几秒钟。',
    view: '查看完整报告 →',
  },
  es: {
    missingSession: 'Falta el ID de la sesión.',
    verifyFailed: 'No pudimos verificar la sesión de pago.',
    missingReport: 'Falta la referencia del informe.',
    loadFailed: 'No pudimos cargar los datos del informe.',
    unlockFailedTitle: 'Recibimos el pago, pero todavía no pudimos desbloquear tu informe.',
    unlockFailedBody: 'Espera un minuto y actualiza la página, o contacta a soporte con el ID de tu sesión.',
    unlockFailedRetry: 'Intentar abrir el informe de nuevo',
    title: 'Pago exitoso',
    body: 'Tu informe profesional se está generando. Normalmente tarda unos segundos.',
    view: 'Ver el informe completo →',
  },
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

function Message({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <main lang={LOCALE_TAG[locale]} className="flex min-h-screen items-center justify-center px-6">
      <p>{children}</p>
    </main>
  );
}

export default async function IqSuccessPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const sessionId = sp.session_id;
  // Checkout appends the visitor's lang to Stripe's success URL; otherwise ?lang > iq_lang cookie > Accept-Language,
  // and once the report row is loaded its `language` column takes precedence over the cookie.
  let locale = await resolveServerLocale({ param: sp.lang });
  let t = COPY[locale];
  if (!sessionId) {
    return <Message locale={locale}>{t.missingSession}</Message>;
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
    return <Message locale={locale}>{t.verifyFailed}</Message>;
  }

  if (!reportId) {
    return <Message locale={locale}>{t.missingReport}</Message>;
  }

  let report;
  try {
    report = await iqGetReport(reportId);
  } catch (err) {
    console.error('[success] iqGetReport error:', err);
    return <Message locale={locale}>{t.loadFailed}</Message>;
  }

  if (!strictLocale(sp.lang) && report?.language) {
    locale = strictLocale(report.language) ?? locale;
    t = COPY[locale];
  }
  const reportHref = withLang(`/iq/report/${reportId}`, locale);

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
    redirect(reportHref);
  }

  /** Stripe redirects here before webhooks; mark paid in DB so /iq/report/[id] does not show locked. */
  if (checkoutPaymentSucceeded(paymentStatus, checkoutStatus)) {
    try {
      // Defer full-report generation: this page runs under the default function
      // timeout, far shorter than report generation. Mark paid fast, then the
      // report page generates via /api/funnel/full-report (maxDuration 300).
      await fulfillIqPaidPurchase({
        reportId,
        stripeSessionId: sessionId,
        customerEmail,
        deferFullReportGeneration: true,
      });
    } catch (e) {
      console.error('[success] fulfillIqPaidPurchase error:', e);
      return (
        <main lang={LOCALE_TAG[locale]} className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-md space-y-4 text-center">
            <p className="text-white/90">{t.unlockFailedTitle}</p>
            <p className="text-sm text-white/60">{t.unlockFailedBody}</p>
            <Link
              href={reportHref}
              className="inline-block text-emerald-400 underline"
            >
              {t.unlockFailedRetry}
            </Link>
          </div>
        </main>
      );
    }
    redirect(reportHref);
  }

  return (
    <main lang={LOCALE_TAG[locale]} className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="mb-4 text-5xl">✅</div>
        <h1 className="text-3xl font-bold text-white">{t.title}</h1>
        <p className="text-white/70">{t.body}</p>
        <div className="animate-pulse">
          <div className="mx-auto h-2 w-32 rounded-full bg-emerald-500/30" />
        </div>
        <Link
          href={reportHref}
          className="inline-block rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-black transition hover:bg-emerald-400"
        >
          {t.view}
        </Link>
      </div>
    </main>
  );
}
