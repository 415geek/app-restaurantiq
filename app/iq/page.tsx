'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Locale = 'en' | 'zh';

const copy: Record<
  Locale,
  {
    badge: string;
    title: string;
    subtitle: string;
    addressPlaceholder: string;
    businessPlaceholder: string;
    analyze: string;
    footnote: string;
    toggle: string;
  }
> = {
  en: {
    badge: 'RestaurantIQ · Location check',
    title: 'Should You Open a Restaurant Here?',
    subtitle: 'AI will tell you before you lose $300,000',
    addressPlaceholder: 'Enter restaurant address...',
    businessPlaceholder: 'Business type (optional) e.g. Hong Kong Cafe',
    analyze: 'Analyze Location',
    footnote: 'One decision can save you six figures.',
    toggle: '中文',
  },
  zh: {
    badge: 'RestaurantIQ · 选址评估',
    title: '这个位置适合开餐厅吗？',
    subtitle: 'AI 会在你亏损 30 万美元前提醒你',
    addressPlaceholder: '输入餐厅地址...',
    businessPlaceholder: '业态（可选）例如：港式茶餐厅',
    analyze: '开始分析',
    footnote: '一个决策，可能省下六位数成本。',
    toggle: 'EN',
  },
};

export default function IqLandingPage() {
  const [location, setLocation] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const router = useRouter();
  const t = copy[locale];

  function handleSubmit() {
    if (!location.trim()) return;
    const params = new URLSearchParams({ location, businessType, lang: locale });
    router.push(`/iq/result?${params.toString()}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-2xl text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
            {t.badge}
          </div>
          <button
            type="button"
            onClick={() => setLocale((prev) => (prev === 'en' ? 'zh' : 'en'))}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10"
            aria-label="Toggle language"
          >
            {t.toggle}
          </button>
        </div>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-6xl">{t.title}</h1>
        <p className="mb-10 text-lg text-white/70 md:text-xl">{t.subtitle}</p>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-2xl md:p-6">
          <div className="space-y-4">
            <input
              type="text"
              placeholder={t.addressPlaceholder}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-xl bg-white px-4 py-4 text-black outline-none"
            />
            <input
              type="text"
              placeholder={t.businessPlaceholder}
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="w-full rounded-xl bg-white px-4 py-4 text-black outline-none"
            />
            <button
              type="button"
              onClick={handleSubmit}
              className="w-full rounded-xl bg-emerald-400 px-6 py-4 font-semibold text-black transition hover:bg-emerald-300"
            >
              {t.analyze}
            </button>
          </div>
        </div>
        <p className="mt-6 text-sm text-white/40">{t.footnote}</p>
      </div>
    </main>
  );
}
