'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type AnalyzeResult = {
  reportId: string;
  verdict: string;
  headline: string;
  reason: string;
};

type Locale = 'en' | 'zh';

const resultCopy: Record<
  Locale,
  {
    missingLocation: string;
    requestFailed: string;
    loading: [string, string, string];
    aiVerdict: string;
    lockedFullReport: string;
    lockedRevenue: string;
    lockedRisks: string;
    lockedOpportunities: string;
    lockedActionPlan: string;
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
    loading: ['Analyzing competitors…', 'Estimating revenue…', 'Detecting risks…'],
    aiVerdict: 'AI Verdict',
    lockedFullReport: 'Locked full report',
    lockedRevenue: 'Revenue estimate: locked',
    lockedRisks: 'Top risks: locked',
    lockedOpportunities: 'Opportunities: locked',
    lockedActionPlan: 'Action plan: locked',
    redirecting: 'Redirecting…',
    unlockReport: 'Unlock Full Report for $19',
    footnote: 'Avoid a costly mistake before you invest.',
    checkoutFailed: 'Checkout failed',
    paymentUnavailable: 'Payment is temporarily unavailable for this analysis.',
    fallbackLoadFailed: 'Failed to load result.',
    loadingPage: 'Loading…',
  },
  zh: {
    missingLocation: '缺少地址信息',
    requestFailed: '请求失败',
    loading: ['正在分析竞争格局…', '正在估算收入…', '正在识别风险…'],
    aiVerdict: 'AI 结论',
    lockedFullReport: '完整报告（已锁定）',
    lockedRevenue: '收入预估：已锁定',
    lockedRisks: '主要风险：已锁定',
    lockedOpportunities: '机会点：已锁定',
    lockedActionPlan: '行动方案：已锁定',
    redirecting: '正在跳转…',
    unlockReport: '支付 $19 解锁完整报告',
    footnote: '在投入资金前，先避免高成本决策失误。',
    checkoutFailed: '支付会话创建失败',
    paymentUnavailable: '该次分析暂时无法支付，请稍后重试。',
    fallbackLoadFailed: '结果加载失败。',
    loadingPage: '加载中…',
  },
};

function ResultContent() {
  const params = useSearchParams();
  const location = params.get('location') || '';
  const businessType = params.get('businessType') || '';
  const langParam = (params.get('lang') || 'en').toLowerCase();
  const locale: Locale = langParam === 'zh' ? 'zh' : 'en';
  const t = resultCopy[locale];
  const [loading, setLoading] = useState(true);
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

    async function run() {
      try {
        const res = await fetch('/api/funnel/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location, businessType, language: locale }),
        });
        let json: (AnalyzeResult & { error?: string }) | null = null;
        let rawText = '';
        try {
          rawText = await res.clone().text();
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
            reason: json?.reason ?? '',
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t.requestFailed);
      } finally {
        if (!cancelled) {
          setTimeout(() => setLoading(false), 1800);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
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
        } catch {
          /* non-JSON error body */
        }
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
        <div className="space-y-3 text-center">
          <p className="text-lg">{t.loading[0]}</p>
          <p className="text-lg">{t.loading[1]}</p>
          <p className="text-lg">{t.loading[2]}</p>
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

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-8 text-center shadow-2xl">
          <div className="mb-4 text-sm uppercase tracking-[0.2em] text-red-300">{t.aiVerdict}</div>
          <h1 className="mb-4 text-4xl font-bold text-red-300 md:text-5xl">{data.headline}</h1>
          <p className="mx-auto max-w-xl text-lg text-white/70">{data.reason}</p>
        </div>
        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8">
          <h2 className="mb-6 text-xl font-semibold">{t.lockedFullReport}</h2>
          <div className="space-y-4 text-white/60">
            <div className="rounded-2xl border border-white/10 p-4">{t.lockedRevenue}</div>
            <div className="rounded-2xl border border-white/10 p-4">{t.lockedRisks}</div>
            <div className="rounded-2xl border border-white/10 p-4">{t.lockedOpportunities}</div>
            <div className="rounded-2xl border border-white/10 p-4">{t.lockedActionPlan}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={checkoutLoading}
            className="mt-8 w-full rounded-2xl bg-emerald-400 px-6 py-4 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
          >
            {checkoutLoading ? t.redirecting : t.unlockReport}
          </button>
          {checkoutError ? <p className="mt-3 text-center text-sm text-rose-300">{checkoutError}</p> : null}
          <p className="mt-4 text-center text-sm text-white/40">{t.footnote}</p>
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
