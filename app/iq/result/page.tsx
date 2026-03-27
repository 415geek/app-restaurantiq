'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShareButton } from '@/components/share/ShareButton';
import { SocialProofStats, SocialProofBadge } from '@/components/social-proof/Stats';

type AnalyzeResult = {
  reportId: string;
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
};

type Locale = 'en' | 'zh';

const resultCopy: Record<
  Locale,
  {
    missingLocation: string;
    requestFailed: string;
    loading: [string, string, string];
    aiVerdict: string;
    marketSnapshot: string;
    keyRisk: string;
    lockedFullReport: string;
    lockedItems: string[];
    redirecting: string;
    unlockReport: string;
    footnote: string;
    checkoutFailed: string;
    paymentUnavailable: string;
    fallbackLoadFailed: string;
    loadingPage: string;
  }
> = {
  en: {
    missingLocation: 'Missing location',
    requestFailed: 'Request failed',
    loading: ['Scanning market data…', 'Analyzing competition…', 'Detecting hidden risks…'],
    aiVerdict: 'Preliminary Assessment',
    marketSnapshot: 'Market Snapshot',
    keyRisk: 'Hidden Risk',
    lockedFullReport: 'Full Analysis Locked',
    lockedItems: [
      '📊 Revenue projection & break-even timeline',
      '⚠️ Top 5 risks with mitigation strategies',
      '💡 3 differentiation opportunities',
      '📋 90-day action plan',
    ],
    redirecting: 'Redirecting…',
    unlockReport: 'Unlock Full Report — $19',
    footnote: 'Know before you invest. Avoid costly mistakes.',
    checkoutFailed: 'Checkout failed',
    paymentUnavailable: 'Payment is temporarily unavailable.',
    fallbackLoadFailed: 'Failed to load result.',
    loadingPage: 'Loading…',
  },
  zh: {
    missingLocation: '缺少地址信息',
    requestFailed: '请求失败',
    loading: ['正在扫描市场数据…', '正在分析竞争格局…', '正在识别隐藏风险…'],
    aiVerdict: '初步判断',
    marketSnapshot: '市场快照',
    keyRisk: '关键风险',
    lockedFullReport: '完整分析（已锁定）',
    lockedItems: [
      '📊 收入预估 & 回本周期',
      '⚠️ 5大风险及应对策略',
      '💡 3个差异化机会点',
      '📋 90天落地行动方案',
    ],
    redirecting: '正在跳转…',
    unlockReport: '解锁完整报告 — $19',
    footnote: '投资前先看清，避免高成本失误。',
    checkoutFailed: '支付会话创建失败',
    paymentUnavailable: '暂时无法支付，请稍后重试。',
    fallbackLoadFailed: '结果加载失败。',
    loadingPage: '加载中…',
  },
};

function VerdictBadge({ verdict, locale }: { verdict: string; locale: Locale }) {
  const v = verdict.toLowerCase();
  const labels: Record<string, Record<Locale, string>> = {
    go: { en: 'Opportunity', zh: '可进入' },
    caution: { en: 'Proceed with Caution', zh: '谨慎推进' },
    no: { en: 'High Risk', zh: '风险较高' },
  };
  const colors: Record<string, string> = {
    go: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    caution: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    no: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  };
  const label = labels[v]?.[locale] || verdict;
  const color = colors[v] || 'bg-white/10 text-white/80 border-white/20';
  return (
    <span className={`inline-block rounded-full border px-4 py-1.5 text-sm font-medium ${color}`}>
      {label}
    </span>
  );
}

function ResultContent() {
  const params = useSearchParams();
  const location = params.get('location') || '';
  const businessType = params.get('businessType') || '';
  const langParam = (params.get('lang') || 'en').toLowerCase();
  const locale: Locale = langParam === 'zh' ? 'zh' : 'en';
  const t = resultCopy[locale];
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (!location.trim()) {
      setLoading(false);
      setError(t.missingLocation);
      return;
    }

    let cancelled = false;
    const stepTimer = setInterval(() => {
      setLoadingStep((s) => (s < 2 ? s + 1 : s));
    }, 1200);

    async function run() {
      try {
        const res = await fetch('/api/funnel/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location, businessType, language: locale }),
        });
        let json: (AnalyzeResult & { error?: string }) | null = null;
        try {
          const rawText = await res.clone().text();
          json = rawText ? (JSON.parse(rawText) as AnalyzeResult & { error?: string }) : null;
        } catch {
          json = null;
        }
        if (!res.ok) {
          throw new Error(json?.error || t.requestFailed);
        }
        if (!cancelled) {
          setCheckoutError(null);
          setData({
            reportId: json?.reportId ?? '',
            verdict: json?.verdict ?? '',
            headline: json?.headline ?? '',
            subheadline: json?.subheadline,
            market_snapshot: json?.market_snapshot,
            hidden_risk: json?.hidden_risk,
            paywall_teaser: json?.paywall_teaser,
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t.requestFailed);
      } finally {
        clearInterval(stepTimer);
        if (!cancelled) {
          setTimeout(() => setLoading(false), 800);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      clearInterval(stepTimer);
    };
  }, [location, businessType, locale, t.missingLocation, t.requestFailed]);

  async function handleCheckout() {
    if (!data?.reportId) {
      setCheckoutError(t.paymentUnavailable);
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/funnel/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: data.reportId }),
      });
      const raw = await res.text();
      let json: { url?: string; error?: string } = {};
      if (raw) {
        try {
          json = JSON.parse(raw) as { url?: string; error?: string };
        } catch { /* ignore */ }
      }
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      setCheckoutError(json.error || t.checkoutFailed);
    } catch {
      setCheckoutError(t.checkoutFailed);
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="space-y-4 text-center">
          {t.loading.map((step, i) => (
            <p
              key={i}
              className={`text-lg transition-opacity duration-500 ${
                i <= loadingStep ? 'opacity-100' : 'opacity-30'
              }`}
            >
              {i <= loadingStep ? '✓ ' : '○ '}
              {step}
            </p>
          ))}
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-center text-white/80">{error || t.fallbackLoadFailed}</p>
      </main>
    );
  }

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/iq/result?location=${encodeURIComponent(location)}&businessType=${encodeURIComponent(businessType)}&lang=${locale}`
      : '';

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl space-y-6">
        {/* Social Proof Badge */}
        <div className="text-center">
          <SocialProofBadge locale={locale} />
        </div>

        {/* 1. Verdict + Headline Card */}
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-center shadow-2xl">
          <div className="mb-3 text-xs uppercase tracking-[0.25em] text-white/50">
            {t.aiVerdict}
          </div>
          <VerdictBadge verdict={data.verdict} locale={locale} />
          <h1 className="mt-5 text-3xl font-bold leading-tight text-white md:text-4xl">
            {data.headline}
          </h1>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-lg text-base text-white/60">{data.subheadline}</p>
          )}
        </div>

        {/* 2. Market Snapshot */}
        {data.market_snapshot && data.market_snapshot.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/70">
              <span>📊</span> {t.marketSnapshot}
            </h2>
            <ul className="space-y-3">
              {data.market_snapshot.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-sm text-white/80"
                >
                  <span className="mt-0.5 text-emerald-400">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 3. Hidden Risk */}
        {data.hidden_risk && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-rose-300">
              <span>⚠️</span> {t.keyRisk}
            </h2>
            <p className="text-base leading-relaxed text-white/80">{data.hidden_risk}</p>
          </div>
        )}

        {/* 4. Paywall Teaser + Locked Content */}
        <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-900/20 to-amber-800/10 p-6">
          {data.paywall_teaser && (
            <p className="mb-5 text-center text-base font-medium text-amber-200">
              &ldquo;{data.paywall_teaser}&rdquo;
            </p>
          )}
          <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-wide text-white/60">
            🔒 {t.lockedFullReport}
          </h2>
          <ul className="space-y-2.5 text-sm text-white/50">
            {t.lockedItems.map((item, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="blur-[2px]">████</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={checkoutLoading}
            className="mt-6 w-full rounded-2xl bg-emerald-400 px-6 py-4 text-lg font-bold text-black transition hover:bg-emerald-300 hover:shadow-lg hover:shadow-emerald-400/20 disabled:opacity-60"
          >
            {checkoutLoading ? t.redirecting : t.unlockReport}
          </button>
          {checkoutError && (
            <p className="mt-3 text-center text-sm text-rose-300">{checkoutError}</p>
          )}
          <p className="mt-4 text-center text-xs text-white/40">{t.footnote}</p>
        </div>

        {/* Share + Social Proof */}
        <div className="flex flex-col items-center gap-4">
          <ShareButton
            shareUrl={shareUrl}
            title={data.headline}
            description={data.subheadline || data.hidden_risk || ''}
            reportId={data.reportId}
            locale={locale}
            variant="ghost"
            size="md"
          />
          <SocialProofStats locale={locale} variant="compact" />
        </div>
      </div>
    </main>
  );
}

export default function IqResultPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center px-6">
          <p className="text-lg">{resultCopy.en.loadingPage}</p>
        </main>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
