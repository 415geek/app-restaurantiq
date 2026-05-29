'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShareButton } from '@/components/share/ShareButton';
import { SocialProofStats, SocialProofBadge } from '@/components/social-proof/Stats';
import { getIqPaywallLockedItems } from '@/lib/funnel/iq-paywall-sections';
import { RiskAuditScorecard } from '@/components/iq/RiskAuditScorecard';
import { LeadCaptureModal, type LeadCaptureSubmit } from '@/components/iq/LeadCaptureModal';
import {
  FREE_ANALYZE_PHASES,
  getFreeAnalyzeStages,
  IqAnalysisProgressBar,
  progressFromElapsed,
  useAnalysisProgressTimer,
} from '@/components/iq/IqAnalysisProgress';
import {
  decisionTierDisplay,
  parseDecisionTier,
  parseRiskAuditPreview,
  type RiskAuditPreview,
} from '@/lib/funnel/iq-risk-audit-model';

const LEAD_STORAGE_KEY = 'iq:lead:v1';

type StoredLead = {
  email: string;
  name?: string;
  phone?: string;
  cuisine?: string;
  leadId?: string | null;
  ts?: number;
};

function readStoredLead(): StoredLead | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEAD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLead;
    if (parsed && typeof parsed.email === 'string' && parsed.email.includes('@')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredLead(payload: StoredLead): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LEAD_STORAGE_KEY, JSON.stringify({ ...payload, ts: Date.now() }));
  } catch {
    /* ignore quota / privacy mode */
  }
}

type AnalyzeResult = {
  reportId: string;
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
  decision_tier?: string;
  risk_audit_preview?: RiskAuditPreview;
};

/** API may return error/detail as strings or structured JSON; never call .trim() on unknown. */
function jsonApiFieldToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatAnalyzeApiFailure(json: Record<string, unknown> | null, fallback: string): string {
  const base = (jsonApiFieldToString(json?.error) || fallback).trim();
  const detail = jsonApiFieldToString(json?.detail);
  if (!detail || detail === base) return base;
  const short = detail.length > 240 ? `${detail.slice(0, 240)}…` : detail;
  return `${base}\n${short}`;
}

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
    redirecting: string;
    unlockReport: string;
    promoCodeHint: string;
    accessCodePlaceholder: string;
    accessCodeSubmit: string;
    accessCodeSubmitting: string;
    accessCodeInvalid: string;
    accessCodeGenericError: string;
    footnote: string;
    checkoutFailed: string;
    paymentUnavailable: string;
    fallbackLoadFailed: string;
    loadingPage: string;
    riskAudit: string;
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
    redirecting: 'Redirecting…',
    unlockReport: 'Unlock Risk Audit — $19',
    riskAudit: 'Location risk scorecard',
    promoCodeHint: '🔑 Enter access code to unlock the report',
    accessCodePlaceholder: 'Access code',
    accessCodeSubmit: 'Unlock',
    accessCodeSubmitting: 'Unlocking…',
    accessCodeInvalid: 'Invalid access code',
    accessCodeGenericError: 'Could not redeem code. Please try again.',
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
    redirecting: '正在跳转…',
    unlockReport: '解锁完整风险审计 — $19',
    riskAudit: '选址风险评分卡',
    promoCodeHint: '🔑 输入 access code 解锁报告',
    accessCodePlaceholder: '请输入 access code',
    accessCodeSubmit: '解锁',
    accessCodeSubmitting: '解锁中…',
    accessCodeInvalid: 'Access code 无效',
    accessCodeGenericError: '无法兑换 access code，请稍后重试。',
    footnote: '投资前先看清，避免高成本失误。',
    checkoutFailed: '支付会话创建失败',
    paymentUnavailable: '暂时无法支付，请稍后重试。',
    fallbackLoadFailed: '结果加载失败。',
    loadingPage: '加载中…',
  },
};

function VerdictBadge({
  verdict,
  decisionTier,
  locale,
}: {
  verdict: string;
  decisionTier?: string;
  locale: Locale;
}) {
  const tier = parseDecisionTier(decisionTier);
  const tierCopy = decisionTierDisplay(tier, locale);
  if (tierCopy) {
    const tierColors: Record<string, string> = {
      strong_go: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      go_with_conditions: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      need_more_data: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      high_risk: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
      no_go: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    };
    const color = tierColors[tier!] ?? 'bg-white/10 text-white/80 border-white/20';
    return (
      <span className={`inline-block rounded-full border px-4 py-1.5 text-sm font-medium ${color}`}>
        {tierCopy.label}
      </span>
    );
  }
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
  const monthlyRentUsd = params.get('monthlyRentUsd') || '';
  const sqft = params.get('sqft') || '';
  const langParam = (params.get('lang') || 'en').toLowerCase();
  const locale: Locale = langParam === 'zh' ? 'zh' : 'en';
  const t = resultCopy[locale];
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [analyzeDone, setAnalyzeDone] = useState(false);
  const analyzeElapsedSec = useAnalysisProgressTimer(loading);
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeLoading, setAccessCodeLoading] = useState(false);
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  // Lead capture gate — required before the free report is revealed.
  // Returning visitors who already left their email skip the modal.
  const [unlocked, setUnlocked] = useState(false);
  const [storedLead, setStoredLead] = useState<StoredLead | null>(null);

  useEffect(() => {
    const existing = readStoredLead();
    if (existing) {
      setStoredLead(existing);
      setUnlocked(true);
    }
  }, []);

  function handleLeadSubmit(payload: LeadCaptureSubmit & { leadId: string | null }) {
    const next: StoredLead = {
      email: payload.email,
      name: payload.name,
      phone: payload.phone,
      cuisine: payload.cuisine,
      leadId: payload.leadId,
    };
    writeStoredLead(next);
    setStoredLead(next);
    setUnlocked(true);
  }

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
          body: JSON.stringify({
            location,
            businessType,
            language: locale,
            ...(monthlyRentUsd ? { monthlyRentUsd } : {}),
            ...(sqft ? { sqft } : {}),
          }),
        });
        let json: (AnalyzeResult & Record<string, unknown>) | null = null;
        try {
          const rawText = await res.clone().text();
          json = rawText ? (JSON.parse(rawText) as AnalyzeResult & Record<string, unknown>) : null;
        } catch {
          json = null;
        }
        if (!res.ok) {
          throw new Error(formatAnalyzeApiFailure(json, t.requestFailed));
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
            decision_tier: json?.decision_tier,
            risk_audit_preview: parseRiskAuditPreview(json?.risk_audit_preview),
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t.requestFailed);
      } finally {
        clearInterval(stepTimer);
        if (!cancelled) {
          setAnalyzeDone(true);
          setTimeout(() => setLoading(false), 700);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      clearInterval(stepTimer);
    };
  }, [location, businessType, monthlyRentUsd, sqft, locale, t.missingLocation, t.requestFailed]);

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

  async function handleRedeemAccessCode() {
    if (!data?.reportId) {
      setAccessCodeError(t.paymentUnavailable);
      return;
    }
    const trimmed = accessCode.trim();
    if (!trimmed) {
      setAccessCodeError(t.accessCodeInvalid);
      return;
    }
    setAccessCodeLoading(true);
    setAccessCodeError(null);
    try {
      const res = await fetch('/api/funnel/redeem-access-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: data.reportId, code: trimmed }),
      });
      const raw = await res.text();
      let json: { ok?: boolean; reportUrl?: string; error?: string } = {};
      if (raw) {
        try {
          json = JSON.parse(raw) as { ok?: boolean; reportUrl?: string; error?: string };
        } catch { /* ignore */ }
      }
      if (res.ok && json.ok && json.reportUrl) {
        window.location.href = json.reportUrl;
        return;
      }
      if (res.status === 401) {
        setAccessCodeError(t.accessCodeInvalid);
      } else {
        setAccessCodeError(json.error || t.accessCodeGenericError);
      }
    } catch {
      setAccessCodeError(t.accessCodeGenericError);
    } finally {
      setAccessCodeLoading(false);
    }
  }

  const analyzeProgressPct = useMemo(() => {
    const fromTime = progressFromElapsed(analyzeElapsedSec, FREE_ANALYZE_PHASES, {
      done: analyzeDone,
      maxPctUntilDone: 90,
    });
    const stepFloor = [10, 36, 58][loadingStep] ?? 58;
    return Math.min(100, Math.max(fromTime, analyzeDone ? 100 : stepFloor));
  }, [analyzeElapsedSec, analyzeDone, loadingStep]);

  const leadModal = (
    <LeadCaptureModal
      open={!unlocked}
      locale={locale}
      location={location}
      defaultCuisine={businessType || storedLead?.cuisine || ''}
      reportId={data?.reportId ?? null}
      onSubmit={handleLeadSubmit}
    />
  );

  if (loading) {
    const analyzeTitle =
      locale === 'zh' ? '正在分析选址风险…' : 'Analyzing your location…';
    return (
      <>
        {leadModal}
        <main className="flex min-h-screen items-center justify-center px-6 py-12">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
            <IqAnalysisProgressBar
              lang={locale}
              title={analyzeTitle}
              subtitle={location}
              stages={getFreeAnalyzeStages(locale)}
              percent={analyzeProgressPct}
              elapsedSec={analyzeElapsedSec}
            />
          </div>
        </main>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        {leadModal}
        <main className="flex min-h-screen items-center justify-center px-6">
          <p className="whitespace-pre-line text-center text-sm text-white/80 sm:text-base">
            {error || t.fallbackLoadFailed}
          </p>
        </main>
      </>
    );
  }

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/iq/result?location=${encodeURIComponent(location)}&businessType=${encodeURIComponent(businessType)}&lang=${locale}`
      : '';

  return (
    <>
      {leadModal}
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
          <VerdictBadge
            verdict={data.verdict}
            decisionTier={data.decision_tier}
            locale={locale}
          />
          <h1 className="mt-5 text-3xl font-bold leading-tight text-white md:text-4xl">
            {data.headline}
          </h1>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-lg text-base text-white/60">{data.subheadline}</p>
          )}
        </div>

        {data.risk_audit_preview && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/70">
              {t.riskAudit}
            </h2>
            <RiskAuditScorecard
              audit={data.risk_audit_preview}
              lang={locale}
              businessType={businessType}
              compact
            />
          </div>
        )}

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
            {getIqPaywallLockedItems(locale).map((item, i) => (
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
            <p className="mt-2 text-center text-sm text-rose-300">{checkoutError}</p>
          )}

          <div className="mt-5">
            <p className="mb-2 text-center text-sm text-emerald-300/80">{t.promoCodeHint}</p>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void handleRedeemAccessCode();
              }}
            >
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                value={accessCode}
                onChange={(e) => {
                  setAccessCode(e.target.value);
                  if (accessCodeError) setAccessCodeError(null);
                }}
                placeholder={t.accessCodePlaceholder}
                maxLength={64}
                aria-label={t.accessCodePlaceholder}
                disabled={accessCodeLoading}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition focus:border-emerald-400/60 focus:bg-white/10 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={accessCodeLoading || !accessCode.trim()}
                className="rounded-xl bg-emerald-400/20 px-5 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/30 disabled:opacity-50"
              >
                {accessCodeLoading ? t.accessCodeSubmitting : t.accessCodeSubmit}
              </button>
            </form>
            {accessCodeLoading ? (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/5 animate-pulse rounded-full bg-gradient-to-r from-emerald-600 to-teal-400" />
                </div>
                <p className="mt-2 text-center text-xs text-white/50">
                  {locale === 'zh' ? '验证成功，正在打开报告页…' : 'Verified — opening report…'}
                </p>
              </div>
            ) : null}
            {accessCodeError && (
              <p className="mt-2 text-center text-sm text-rose-300">{accessCodeError}</p>
            )}
          </div>

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
    </>
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
