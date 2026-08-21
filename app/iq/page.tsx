'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { productPositioningLine } from '@/lib/funnel/iq-risk-audit-model';

type Locale = 'en' | 'zh';

const copy: Record<
  Locale,
  {
    badge: string;
    title: string;
    subtitle: string;
    addressPlaceholder: string;
    businessPlaceholder: string;
    rentPlaceholder: string;
    sqftPlaceholder: string;
    analyze: string;
    footnote: string;
    toggle: string;
    sampleTitle: string;
    sampleScore: string;
    sampleVerdict: string;
    sampleBreakeven: string;
    sampleRisk: string;
    tiersTitle: string;
    tierFree: string;
    tierPro: string;
    audiences: string[];
    accountTitle: string;
    accountSubtitle: string;
    signIn: string;
    register: string;
  }
> = {
  en: {
    badge: 'RestaurantIQ · Location Risk Audit',
    title: 'Before you sign the lease, know if this site can work',
    subtitle:
      'We combine nearby competitors, demographics, delivery signals, rent pressure, and cuisine fit into a pre-lease risk audit—not a generic AI essay.',
    addressPlaceholder: 'Restaurant address (required)',
    businessPlaceholder: 'Concept e.g. Hong Kong cafe, hot pot, boba',
    rentPlaceholder: 'Monthly rent USD (optional)',
    sqftPlaceholder: 'Size sqft (optional)',
    analyze: 'Get free risk score',
    footnote: 'Wrong site ≠ rent only—it is build-out, payroll, transfer fee, and 12 months of cash.',
    toggle: '中文',
    sampleTitle: 'Sample output',
    sampleScore: 'Overall 76/100',
    sampleVerdict: 'Go with Conditions',
    sampleBreakeven: 'Break-even ~$82k/mo',
    sampleRisk: 'Top risk: strong direct competitor 0.3 mi away',
    tiersTitle: 'What you get',
    tierFree: 'Free: scorecard, 3 insights, decision tier',
    tierPro: 'Pro ($19+): full audit, revenue scenarios, lease checklist, PDF',
    audiences: [
      'First-time operators',
      'Multi-unit expansion teams',
      'CRE brokers & landlords',
      'POS / payments / delivery BD',
    ],
    accountTitle: 'Manage your purchased reports',
    accountSubtitle: 'Sign in to access reports you have paid for. New here? Create a free account.',
    signIn: 'Sign in',
    register: 'Create account',
  },
  zh: {
    badge: 'RestaurantIQ · 餐饮选址风险审计',
    title: '签餐厅 lease 前，先算清楚这个位置能不能赚钱',
    subtitle:
      '结合周边竞品、人口结构、外卖信号、租金压力与业态匹配度，输出签租前的风险审计报告，而不是泛泛的 AI 建议。',
    addressPlaceholder: '餐厅地址（必填）',
    businessPlaceholder: '业态，例如：港式茶餐厅、火锅、奶茶',
    rentPlaceholder: '预计月租金 USD（选填）',
    sqftPlaceholder: '面积 sqft（选填）',
    analyze: '免费生成风险评分',
    footnote: '开错店不只是亏租金，还有装修、人工、转让费与 12 个月现金流。',
    toggle: 'EN',
    sampleTitle: '报告样例预览',
    sampleScore: '综合 76/100',
    sampleVerdict: '有条件可做',
    sampleBreakeven: '打平约 $82k/月',
    sampleRisk: '最大风险：0.3 英里内已有强势直接竞品',
    tiersTitle: '你将获得',
    tierFree: '免费：评分卡 + 3 条洞察 + 五档决策',
    tierPro: '付费（$19 起）：完整审计、营收三情景、签租清单、PDF',
    audiences: ['首次创业者', '连锁拓店团队', '商业地产经纪', 'POS/支付/外卖 BD'],
    accountTitle: '管理已购买的报告',
    accountSubtitle: '登录后可查看您已付费的完整报告。第一次来？注册一个免费账号。',
    signIn: '登录',
    register: '注册',
  },
};

export default function IqLandingPage() {
  const [location, setLocation] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [sqft, setSqft] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const router = useRouter();
  const t = copy[locale];

  function handleSubmit() {
    if (!location.trim()) return;
    const params = new URLSearchParams({ location, businessType, lang: locale });
    if (monthlyRent.trim()) params.set('monthlyRentUsd', monthlyRent.trim());
    if (sqft.trim()) params.set('sqft', sqft.trim());
    router.push(`/iq/result?${params.toString()}`);
  }

  return (
    <main className="min-h-screen px-6 py-16">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
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

        <div className="text-center">
          <p className="mb-3 text-sm text-emerald-300/80">{productPositioningLine(locale)}</p>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-5xl">{t.title}</h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-white/70">{t.subtitle}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-2xl md:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <input
              type="text"
              placeholder={t.addressPlaceholder}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="md:col-span-2 w-full rounded-xl bg-white px-4 py-4 text-black outline-none"
            />
            <input
              type="text"
              placeholder={t.businessPlaceholder}
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="md:col-span-2 w-full rounded-xl bg-white px-4 py-4 text-black outline-none"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder={t.rentPlaceholder}
              value={monthlyRent}
              onChange={(e) => setMonthlyRent(e.target.value)}
              className="w-full rounded-xl bg-white/95 px-4 py-3 text-black outline-none"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder={t.sqftPlaceholder}
              value={sqft}
              onChange={(e) => setSqft(e.target.value)}
              className="w-full rounded-xl bg-white/95 px-4 py-3 text-black outline-none"
            />
            <button
              type="button"
              onClick={handleSubmit}
              className="md:col-span-2 w-full rounded-xl bg-emerald-400 px-6 py-4 font-semibold text-black transition hover:bg-emerald-300"
            >
              {t.analyze}
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-sm text-white/40">{t.footnote}</p>

        <div className="mt-12 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-800/40 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            {t.sampleTitle}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
              <div className="text-xs text-white/45">{t.sampleScore}</div>
              <div className="mt-1 text-lg font-semibold text-white">{t.sampleVerdict}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
              <div className="text-xs text-white/45">{locale === 'zh' ? '财务' : 'Financial'}</div>
              <div className="mt-1 text-sm text-white/85">{t.sampleBreakeven}</div>
            </div>
            <div className="sm:col-span-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100/90">
              {t.sampleRisk}
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
              {t.tiersTitle}
            </h3>
            <ul className="space-y-2 text-sm text-white/75">
              <li>{t.tierFree}</li>
              <li>{t.tierPro}</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
              {locale === 'zh' ? '适用人群' : 'Built for'}
            </h3>
            <ul className="space-y-1.5 text-sm text-white/70">
              {t.audiences.map((a) => (
                <li key={a}>· {a}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer account block — sign-in + register entry */}
        <div className="mt-12 rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6 text-center sm:p-8">
          <h3 className="text-base font-semibold text-white">{t.accountTitle}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/60">{t.accountSubtitle}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/iq/login"
              className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
            >
              {t.signIn}
            </Link>
            <Link
              href={`/sign-up?redirect_url=${encodeURIComponent('/iq/dashboard')}`}
              className="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-300"
            >
              {t.register}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
