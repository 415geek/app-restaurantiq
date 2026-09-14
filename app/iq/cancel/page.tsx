import Link from 'next/link';
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { resolveServerLocale } from '@/lib/i18n/server-locale';

type Props = {
  searchParams?: Promise<{ lang?: string; reportId?: string }>;
};

const COPY: Record<Locale, { title: string; body: string; back: string }> = {
  en: { title: 'Checkout canceled', body: 'Your payment was not completed.', back: 'Back to the analyzer' },
  zh: { title: '已取消支付', body: '你的付款没有完成。', back: '返回分析页' },
  es: { title: 'Pago cancelado', body: 'Tu pago no se completó.', back: 'Volver al analizador' },
};

export default async function IqCancelPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const locale = await resolveServerLocale({ param: sp.lang });
  const t = COPY[locale];
  return (
    <main lang={LOCALE_TAG[locale]} className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-3xl font-bold">{t.title}</h1>
        <p className="mb-8 text-white/70">{t.body}</p>
        <Link href={withLang('/iq', locale)} className="text-emerald-400 underline">
          {t.back}
        </Link>
      </div>
    </main>
  );
}
