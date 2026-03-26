'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type AnalyzeResult = {
  reportId: string;
  verdict: string;
  headline: string;
  reason: string;
};

function ResultContent() {
  const params = useSearchParams();
  const location = params.get('location') || '';
  const businessType = params.get('businessType') || '';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    if (!location.trim()) {
      setLoading(false);
      setError('Missing location');
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        const res = await fetch('/api/funnel/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location, businessType }),
        });
        const json = (await res.json()) as AnalyzeResult & { error?: string };
        if (!res.ok) {
          throw new Error(json.error || 'Request failed');
        }
        if (!cancelled) {
          setData({
            reportId: json.reportId,
            verdict: json.verdict,
            headline: json.headline,
            reason: json.reason,
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to analyze');
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
  }, [location, businessType]);

  async function handleCheckout() {
    if (!data?.reportId) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/funnel/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: data.reportId }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      setError(json.error || 'Checkout failed');
    } catch {
      setError('Checkout failed');
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="space-y-3 text-center">
          <p className="text-lg">Analyzing competitors…</p>
          <p className="text-lg">Estimating revenue…</p>
          <p className="text-lg">Detecting risks…</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-center text-white/80">{error || 'Failed to load result.'}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-8 text-center shadow-2xl">
          <div className="mb-4 text-sm uppercase tracking-[0.2em] text-red-300">AI Verdict</div>
          <h1 className="mb-4 text-4xl font-bold text-red-300 md:text-5xl">{data.headline}</h1>
          <p className="mx-auto max-w-xl text-lg text-white/70">{data.reason}</p>
        </div>
        <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8">
          <h2 className="mb-6 text-xl font-semibold">Locked full report</h2>
          <div className="space-y-4 text-white/60">
            <div className="rounded-2xl border border-white/10 p-4">Revenue estimate: locked</div>
            <div className="rounded-2xl border border-white/10 p-4">Top risks: locked</div>
            <div className="rounded-2xl border border-white/10 p-4">Opportunities: locked</div>
            <div className="rounded-2xl border border-white/10 p-4">Action plan: locked</div>
          </div>
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={checkoutLoading}
            className="mt-8 w-full rounded-2xl bg-emerald-400 px-6 py-4 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
          >
            {checkoutLoading ? 'Redirecting…' : 'Unlock Full Report for $19'}
          </button>
          <p className="mt-4 text-center text-sm text-white/40">Avoid a costly mistake before you invest.</p>
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
          <p className="text-lg">Loading…</p>
        </main>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
