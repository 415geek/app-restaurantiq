'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShareButton } from '@/components/share/ShareButton';
import { SocialProofStats, SocialProofBadge } from '@/components/social-proof/Stats';
import { getIqPaywallLockedItems } from '@/lib/funnel/iq-paywall-sections';
import { RiskAuditScorecard } from '@/components/iq/RiskAuditScorecard';
import { LeadCaptureModal, type LeadCaptureSubmit } from '@/components/iq/LeadCaptureModal';
import {
  emptyPaidIntakeValues,
  hasPaidIntakeValues,
  PaidIntakeForm,
  paidIntakeInputId,
  submitPaidIntake,
  type PaidIntakeCoreKey,
  type PaidIntakeValues,
} from '@/components/iq/PaidIntakeForm';
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
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { useLocale } from '@/lib/i18n/use-locale';

const LEAD_STORAGE_KEY = 'iq:lead:v1';
const PRICE_USD = process.env.NEXT_PUBLIC_STRIPE_PRICE_USD?.trim() || '19';

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

type Copy = {
  missingLocation: string;
  requestFailed: string;
  analyzing: string;
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
  accessCodeVerified: string;
  accessCodeInvalid: string;
  accessCodeGenericError: string;
  footnote: string;
  checkoutFailed: string;
  paymentUnavailable: string;
  reportNotSaved: string;
  fallbackLoadFailed: string;
  loadingPage: string;
  riskAudit: string;
  /** Step 1 header above the intake fields (rent / size / seats). */
  stepOne: string;
  /** Prefix for the unlock button, e.g. "Step 2 · ". */
  stepTwoPrefix: string;
  /** Shown once when unlock is clicked with an empty rent field; never blocks payment. */
  rentNotice: string;
  rentNoticeFill: string;
  rentNoticeProceed: string;
  verdict: Record<'go' | 'caution' | 'no', string>;
};

const resultCopy: Record<Locale, Copy> = {
  en: {
    missingLocation: 'Missing location',
    requestFailed: 'Request failed',
    analyzing: 'Analyzing your location…',
    aiVerdict: 'Preliminary assessment',
    marketSnapshot: 'Market snapshot',
    keyRisk: 'Hidden risk',
    lockedFullReport: 'Full analysis locked',
    redirecting: 'Redirecting…',
    unlockReport: `Unlock the full risk audit — $${PRICE_USD}`,
    riskAudit: 'Location risk scorecard',
    promoCodeHint: '🔑 Have an access code? Enter it to unlock the report',
    accessCodePlaceholder: 'Access code',
    accessCodeSubmit: 'Unlock',
    accessCodeSubmitting: 'Unlocking…',
    accessCodeVerified: 'Verified — opening your report…',
    accessCodeInvalid: 'Invalid access code',
    accessCodeGenericError: 'Could not redeem that code. Please try again.',
    footnote: 'Know before you invest. Avoid costly mistakes.',
    checkoutFailed: 'Checkout failed',
    paymentUnavailable: 'Payment is temporarily unavailable.',
    reportNotSaved: 'The report was not saved — please rerun the analysis, then unlock.',
    fallbackLoadFailed: 'Could not load the result.',
    loadingPage: 'Loading…',
    stepOne: 'Step 1 · Three numbers make the report accurate (30 s, optional)',
    stepTwoPrefix: 'Step 2 · ',
    rentNotice:
      'No monthly rent entered: the report will not assume one — it shows a rent-excluded break-even and a rent ceiling instead. Add it for a sharper report ↑',
    rentNoticeFill: 'Add rent',
    rentNoticeProceed: 'Pay anyway',
    verdict: { go: 'Opportunity', caution: 'Proceed with caution', no: 'High risk' },
  },
  zh: {
    missingLocation: '缺少地址信息',
    requestFailed: '请求失败',
    analyzing: '正在分析选址风险…',
    aiVerdict: '初步判断',
    marketSnapshot: '市场快照',
    keyRisk: '关键风险',
    lockedFullReport: '完整分析（已锁定）',
    redirecting: '正在跳转…',
    unlockReport: `解锁完整风险审计 — $${PRICE_USD}`,
    riskAudit: '选址风险评分卡',
    promoCodeHint: '🔑 输入 access code 解锁报告',
    accessCodePlaceholder: '请输入 access code',
    accessCodeSubmit: '解锁',
    accessCodeSubmitting: '解锁中…',
    accessCodeVerified: '验证成功，正在打开报告页…',
    accessCodeInvalid: 'Access code 无效',
    accessCodeGenericError: '无法兑换 access code，请稍后重试。',
    footnote: '投资前先看清，避免高成本失误。',
    checkoutFailed: '支付会话创建失败',
    paymentUnavailable: '暂时无法支付，请稍后重试。',
    reportNotSaved: '报告尚未保存成功，请重新运行分析后再解锁。',
    fallbackLoadFailed: '结果加载失败。',
    loadingPage: '加载中…',
    stepOne: '第 1 步 · 填 3 个数字，报告更准（30 秒，可跳过）',
    stepTwoPrefix: '第 2 步 · ',
    rentNotice: '未填月租：报告将不假设租金，只给保本线（不含租金）与租金上限。填好更准 ↑',
    rentNoticeFill: '填一下',
    rentNoticeProceed: '直接付费',
    verdict: { go: '可进入', caution: '谨慎推进', no: '风险较高' },
  },
  es: {
    missingLocation: 'Falta la dirección',
    requestFailed: 'La solicitud falló',
    analyzing: 'Analizando tu ubicación…',
    aiVerdict: 'Evaluación preliminar',
    marketSnapshot: 'Panorama del mercado',
    keyRisk: 'Riesgo oculto',
    lockedFullReport: 'Análisis completo bloqueado',
    redirecting: 'Redirigiendo…',
    unlockReport: `Desbloquear la auditoría de riesgo completa — $${PRICE_USD}`,
    riskAudit: 'Tarjeta de riesgo de la ubicación',
    promoCodeHint: '🔑 ¿Tienes un código de acceso? Ingrésalo para desbloquear el informe',
    accessCodePlaceholder: 'Código de acceso',
    accessCodeSubmit: 'Desbloquear',
    accessCodeSubmitting: 'Desbloqueando…',
    accessCodeVerified: 'Verificado; abriendo tu informe…',
    accessCodeInvalid: 'Código de acceso no válido',
    accessCodeGenericError: 'No se pudo canjear ese código. Inténtalo de nuevo.',
    footnote: 'Infórmate antes de invertir. Evita errores costosos.',
    checkoutFailed: 'No se pudo iniciar el pago',
    paymentUnavailable: 'El pago no está disponible por el momento.',
    reportNotSaved: 'El informe no se guardó. Vuelve a ejecutar el análisis y luego desbloquéalo.',
    fallbackLoadFailed: 'No se pudo cargar el resultado.',
    loadingPage: 'Cargando…',
    stepOne: 'Paso 1 · Tres números hacen el informe más preciso (30 s, opcional)',
    stepTwoPrefix: 'Paso 2 · ',
    rentNotice:
      'No ingresaste el alquiler mensual: el informe no asumirá ninguno; mostrará el punto de equilibrio sin alquiler y un tope de alquiler. Agrégalo para un informe más preciso ↑',
    rentNoticeFill: 'Agregar alquiler',
    rentNoticeProceed: 'Pagar de todos modos',
    verdict: { go: 'Oportunidad', caution: 'Proceder con cautela', no: 'Riesgo alto' },
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
  const colors: Record<string, string> = {
    go: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    caution: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    no: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  };
  const label = (v === 'go' || v === 'caution' || v === 'no' ? resultCopy[locale].verdict[v] : null) || verdict;
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
  // ?lang= (always set by the landing form) > iq_lang cookie/localStorage > browser language > English.
  const { locale } = useLocale({ param: params.get('lang') });
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
  // Optional supplemental inputs for the paid 360° report (saved best-effort before checkout).
  // Rent / size typed on the landing form travel here as URL params, so prefill them
  // (they are already stored in market_data_json.user_inputs by /api/funnel/analyze).
  const [intake, setIntake] = useState<PaidIntakeValues>(() => ({
    ...emptyPaidIntakeValues(),
    monthly_rent_usd: monthlyRentUsd.trim(),
    sqft: sqft.trim(),
  }));
  const providedCoreKeys = useMemo<PaidIntakeCoreKey[]>(() => {
    const keys: PaidIntakeCoreKey[] = [];
    if (monthlyRentUsd.trim()) keys.push('monthly_rent_usd');
    if (sqft.trim()) keys.push('sqft');
    return keys;
  }, [monthlyRentUsd, sqft]);
  // The "no rent entered" nudge shows once; the next unlock click (or "pay anyway") proceeds.
  const [rentNoticeShown, setRentNoticeShown] = useState(false);
  const rentMissing = intake.monthly_rent_usd.trim().length === 0;

  function focusRentInput() {
    const el = document.getElementById(paidIntakeInputId('monthly_rent_usd'));
    if (!(el instanceof HTMLInputElement)) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }
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

  async function handleCheckout(opts: { skipRentNotice?: boolean } = {}) {
    if (!data?.reportId) {
      setCheckoutError(t.reportNotSaved);
      return;
    }
    // Non-blocking nudge: the first unlock click with an empty rent field only shows the
    // notice; the second click (or "pay anyway") goes straight to checkout.
    if (rentMissing && !rentNoticeShown && !opts.skipRentNotice) {
      setRentNoticeShown(true);
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError(null);
    // Best-effort: persist supplemental inputs first so the 360° job can use them.
    // A failure here must never block checkout.
    if (hasPaidIntakeValues(intake)) {
      try {
        await submitPaidIntake(data.reportId, intake);
      } catch {
        /* ignore — proceed to checkout */
      }
    }
    try {
      const res = await fetch('/api/funnel/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: data.reportId, language: locale }),
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
      setAccessCodeError(t.reportNotSaved);
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

  const htmlLang = LOCALE_TAG[locale];

  if (loading) {
    return (
      <>
        {leadModal}
        <main lang={htmlLang} className="flex min-h-screen items-center justify-center px-6 py-12">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
            <IqAnalysisProgressBar
              lang={locale}
              title={t.analyzing}
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
        <main lang={htmlLang} className="flex min-h-screen items-center justify-center px-6">
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
      <main lang={htmlLang} className="flex min-h-screen items-center justify-center px-6 py-12">
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

          {/* Step 1 — always-visible intake (rent / size / seats first; the rest behind a toggle). Saved on unlock. */}
          <section aria-labelledby="paid-intake-step" className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
            <h3 id="paid-intake-step" className="mb-3 text-sm font-semibold leading-snug text-white">
              {t.stepOne}
            </h3>
            <PaidIntakeForm
              lang={locale}
              reportId={data.reportId}
              mode="embedded"
              value={intake}
              onChange={setIntake}
              disabled={checkoutLoading}
              collapsibleExtras
              providedKeys={providedCoreKeys}
            />
          </section>

          {/* Step 2 — unlock. Never blocked by the intake. */}
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={checkoutLoading}
            className="mt-4 w-full rounded-2xl bg-emerald-400 px-6 py-4 text-lg font-bold text-black transition hover:bg-emerald-300 hover:shadow-lg hover:shadow-emerald-400/20 disabled:opacity-60"
          >
            {checkoutLoading ? t.redirecting : `${t.stepTwoPrefix}${t.unlockReport}`}
          </button>
          {rentNoticeShown && rentMissing && !checkoutLoading ? (
            <div
              role="status"
              className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100"
            >
              <p>{t.rentNotice}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <button
                  type="button"
                  onClick={focusRentInput}
                  className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-brand-navy transition hover:brightness-110"
                >
                  {t.rentNoticeFill}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCheckout({ skipRentNotice: true })}
                  className="text-xs text-white/60 underline underline-offset-4 transition hover:text-white"
                >
                  {t.rentNoticeProceed}
                </button>
              </div>
            </div>
          ) : null}
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
                <p className="mt-2 text-center text-xs text-white/50">{t.accessCodeVerified}</p>
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
