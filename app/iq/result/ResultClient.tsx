'use client';

/**
 * Free-tier result UI shared by the two routes (评审 Spec §4.5):
 *
 *   /iq/result?location=…&businessType=…   (mode: 'query')
 *     POSTs /api/funnel/analyze (idempotent per normalised inputs, 24 h),
 *     caches the payload for the tab, then `router.replace`s to the canonical
 *     `/iq/result/<reportId>?lang=…` so refresh / back / share never re-run the
 *     analysis or create a second row. When the classifier is not confident
 *     the server answers `needs_concept_confirmation` and the ConceptPicker is
 *     shown; confirming re-calls analyze with `conceptId`.
 *
 *   /iq/result/<reportId>                  (mode: 'stored')
 *     Renders the row the server loaded (or the tab cache as a fallback) and
 *     never calls analyze. Lead capture, access codes, checkout and the paid
 *     intake all bind to this canonical reportId.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShareButton } from '@/components/share/ShareButton';
import { SocialProofStats, SocialProofBadge } from '@/components/social-proof/Stats';
import { getIqPaywallLockedItems } from '@/lib/funnel/iq-paywall-sections';
import { RiskAuditScorecard } from '@/components/iq/RiskAuditScorecard';
import { LeadCaptureModal, type LeadCaptureSubmit } from '@/components/iq/LeadCaptureModal';
import { ConceptPicker } from '@/components/iq/ConceptPicker';
import type { ConceptOption } from '@/lib/iq/concept/classify';
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
import { LOCALES, LOCALE_TAG, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { persistLocale, useLocale } from '@/lib/i18n/use-locale';

const LEAD_STORAGE_KEY = 'iq:lead:v1';
const LEAD_DISMISSED_KEY = 'iq:lead:dismissed:v1';
const RESULT_CACHE_PREFIX = 'iq:result:v1:';
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

function readLeadDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(LEAD_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLeadDismissed(): void {
  try {
    window.sessionStorage.setItem(LEAD_DISMISSED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export type AnalyzeResult = {
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

/** What the canonical route needs to render without calling analyze. */
export type StoredResultPayload = {
  reportId: string;
  location: string;
  businessType: string;
  language: Locale;
  result: Omit<AnalyzeResult, 'reportId' | 'risk_audit_preview'> & { risk_audit_preview?: unknown };
  userInputs: { monthly_rent_usd?: number | null; sqft?: number | null };
};

function readResultCache(reportId: string): StoredResultPayload | null {
  if (typeof window === 'undefined' || !reportId) return null;
  try {
    const raw = window.sessionStorage.getItem(RESULT_CACHE_PREFIX + reportId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredResultPayload;
    return parsed && parsed.reportId === reportId && parsed.result?.headline ? parsed : null;
  } catch {
    return null;
  }
}

function writeResultCache(payload: StoredResultPayload): void {
  if (typeof window === 'undefined' || !payload.reportId) return;
  try {
    window.sessionStorage.setItem(RESULT_CACHE_PREFIX + payload.reportId, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

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
  /** Canonical route: the row could not be loaded and the tab has no copy. */
  resultNotFound: string;
  runNewAnalysis: string;
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
  conceptNeeded: string;
  /** Language pills above the result: switching re-runs the free analysis in that language. */
  language: string;
  languageHint: string;
  verdict: Record<'go' | 'caution' | 'no', string>;
};

const SHORT_LABEL: Record<Locale, string> = { en: 'EN', zh: '中文', es: 'ES' };

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
    resultNotFound: 'This result could not be loaded. It may have expired or the link is incomplete.',
    runNewAnalysis: 'Run a new analysis',
    loadingPage: 'Loading…',
    stepOne: 'Step 1 · Three numbers make the report accurate (30 s, optional)',
    stepTwoPrefix: 'Step 2 · ',
    rentNotice:
      'No monthly rent entered: the report will not assume one — it shows a rent-excluded break-even and a rent ceiling instead. Add it for a sharper report ↑',
    rentNoticeFill: 'Add rent',
    rentNoticeProceed: 'Pay anyway',
    conceptNeeded: 'One quick question before we analyze',
    language: 'Language',
    languageHint: 'Switches this result, every page after it, and the full report you unlock.',
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
    resultNotFound: '无法加载这份结果：可能已过期，或链接不完整。',
    runNewAnalysis: '重新分析一个地址',
    loadingPage: '加载中…',
    stepOne: '第 1 步 · 填 3 个数字，报告更准（30 秒，可跳过）',
    stepTwoPrefix: '第 2 步 · ',
    rentNotice: '未填月租：报告将不假设租金，只给保本线（不含租金）与租金上限。填好更准 ↑',
    rentNoticeFill: '填一下',
    rentNoticeProceed: '直接付费',
    conceptNeeded: '分析前先确认一件事',
    language: '语言',
    languageHint: '切换后，本页结果、后续所有页面以及解锁的完整报告都使用该语言。',
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
    resultNotFound: 'No se pudo cargar este resultado: puede haber caducado o el enlace está incompleto.',
    runNewAnalysis: 'Ejecutar un nuevo análisis',
    loadingPage: 'Cargando…',
    stepOne: 'Paso 1 · Tres números hacen el informe más preciso (30 s, opcional)',
    stepTwoPrefix: 'Paso 2 · ',
    rentNotice:
      'No ingresaste el alquiler mensual: el informe no asumirá ninguno; mostrará el punto de equilibrio sin alquiler y un tope de alquiler. Agrégalo para un informe más preciso ↑',
    rentNoticeFill: 'Agregar alquiler',
    rentNoticeProceed: 'Pagar de todos modos',
    conceptNeeded: 'Una pregunta rápida antes de analizar',
    language: 'Idioma',
    languageHint: 'Cambia este resultado, todas las páginas siguientes y el informe completo que desbloquees.',
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

type ConceptPrompt = {
  id: string;
  options: ConceptOption[];
};

type AnalyzeApiJson = Partial<AnalyzeResult> &
  Record<string, unknown> & {
    needs_concept_confirmation?: boolean;
    concept?: { id?: string; options?: ConceptOption[] };
    cached?: boolean;
  };

/** Same request from React StrictMode's doubled effect shares one fetch. */
const inflight = new Map<string, Promise<{ res: Response; json: AnalyzeApiJson | null }>>();

async function postAnalyze(body: Record<string, unknown>): Promise<{ res: Response; json: AnalyzeApiJson | null }> {
  const key = JSON.stringify(body);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const res = await fetch('/api/funnel/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json: AnalyzeApiJson | null = null;
    try {
      const rawText = await res.clone().text();
      json = rawText ? (JSON.parse(rawText) as AnalyzeApiJson) : null;
    } catch {
      json = null;
    }
    return { res, json };
  })();
  inflight.set(key, p);
  p.finally(() => inflight.delete(key)).catch(() => undefined);
  return p;
}

export type ResultClientProps =
  | { mode: 'query' }
  | {
      mode: 'stored';
      reportId: string;
      /** Row loaded on the server; null when it could not be loaded (the tab cache is tried next). */
      initial: StoredResultPayload | null;
    };

export function ResultClient(props: ResultClientProps) {
  const params = useSearchParams();
  const router = useRouter();
  const isQuery = props.mode === 'query';
  const queryLocation = isQuery ? params.get('location') || '' : '';
  const queryBusinessType = isQuery ? params.get('businessType') || '' : '';
  const queryRent = isQuery ? params.get('monthlyRentUsd') || '' : '';
  const querySqft = isQuery ? params.get('sqft') || '' : '';
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [conceptPrompt, setConceptPrompt] = useState<ConceptPrompt | null>(null);

  // Stored mode: server row, else the tab cache written before the replace.
  const [stored, setStored] = useState<StoredResultPayload | null>(() =>
    props.mode === 'stored' ? props.initial : null,
  );
  const [storedMissing, setStoredMissing] = useState(false);
  useEffect(() => {
    if (props.mode !== 'stored' || stored) return;
    const cached = readResultCache(props.reportId);
    if (cached) setStored(cached); // eslint-disable-line react-hooks/set-state-in-effect
    else setStoredMissing(true);
  }, [props, stored]);

  const location = isQuery ? queryLocation : stored?.location ?? '';
  const businessType = isQuery ? queryBusinessType : stored?.businessType ?? '';
  const monthlyRentUsd = isQuery ? queryRent : stored?.userInputs?.monthly_rent_usd != null ? String(stored.userInputs.monthly_rent_usd) : '';
  const sqft = isQuery ? querySqft : stored?.userInputs?.sqft != null ? String(stored.userInputs.sqft) : '';

  // ?lang= (always set by the landing form / the canonical redirect) > the
  // language the row was analysed in > iq_lang cookie/localStorage > browser > English.
  const { locale } = useLocale({ param: params.get('lang'), initial: !isQuery ? stored?.language : undefined });
  const t = resultCopy[locale];
  const [loading, setLoading] = useState(isQuery);
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
  // Rent / size typed on the landing form travel here as URL params (query mode) or come
  // back from market_data_json.user_inputs (stored mode).
  const [intake, setIntake] = useState<PaidIntakeValues>(() => ({
    ...emptyPaidIntakeValues(),
    monthly_rent_usd: monthlyRentUsd.trim(),
    sqft: sqft.trim(),
  }));
  useEffect(() => {
    if (isQuery) return;
    setIntake((prev) => ({ // eslint-disable-line react-hooks/set-state-in-effect
      ...prev,
      monthly_rent_usd: prev.monthly_rent_usd || monthlyRentUsd.trim(),
      sqft: prev.sqft || sqft.trim(),
    }));
  }, [isQuery, monthlyRentUsd, sqft]);
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

  // Lead capture — a dismissible bottom sheet (§4.7): the result stays readable
  // and scrollable; "Not now" closes it for the session. Returning visitors who
  // already left their email never see it.
  const [leadDone, setLeadDone] = useState(false);
  const [leadDismissed, setLeadDismissed] = useState(false);
  const [storedLead, setStoredLead] = useState<StoredLead | null>(null);

  useEffect(() => {
    const existing = readStoredLead();
    if (existing) {
      setStoredLead(existing); // eslint-disable-line react-hooks/set-state-in-effect
      setLeadDone(true);
    }
    if (readLeadDismissed()) setLeadDismissed(true);
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
    setLeadDone(true);
  }

  function handleLeadDismiss() {
    writeLeadDismissed();
    setLeadDismissed(true);
  }

  // Stored mode: hydrate the result from the payload (no network).
  useEffect(() => {
    if (isQuery || !stored) return;
    setData({ // eslint-disable-line react-hooks/set-state-in-effect
      reportId: stored.reportId,
      verdict: stored.result.verdict,
      headline: stored.result.headline,
      subheadline: stored.result.subheadline,
      market_snapshot: stored.result.market_snapshot,
      hidden_risk: stored.result.hidden_risk,
      paywall_teaser: stored.result.paywall_teaser,
      decision_tier: stored.result.decision_tier,
      risk_audit_preview: parseRiskAuditPreview(stored.result.risk_audit_preview),
    });
    setLoading(false);
  }, [isQuery, stored]);

  // Query mode: analyze once (idempotent server-side), then move to the canonical URL.
  useEffect(() => {
    if (!isQuery) return;
    if (!location.trim()) {
      setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect
      setError(t.missingLocation);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setAnalyzeDone(false);
    setConceptPrompt(null);
    const stepTimer = setInterval(() => {
      setLoadingStep((s) => (s < 2 ? s + 1 : s));
    }, 1200);

    async function run() {
      try {
        const { res, json } = await postAnalyze({
          location,
          businessType,
          language: locale,
          ...(monthlyRentUsd ? { monthlyRentUsd } : {}),
          ...(sqft ? { sqft } : {}),
          ...(conceptId ? { conceptId } : {}),
        });
        if (!res.ok) {
          throw new Error(formatAnalyzeApiFailure(json, t.requestFailed));
        }
        if (cancelled) return;
        if (json?.needs_concept_confirmation && json.concept && Array.isArray(json.concept.options)) {
          setConceptPrompt({ id: String(json.concept.id ?? ''), options: json.concept.options });
          return;
        }
        setCheckoutError(null);
        const result: AnalyzeResult = {
          reportId: json?.reportId ?? '',
          verdict: json?.verdict ?? '',
          headline: json?.headline ?? '',
          subheadline: json?.subheadline,
          market_snapshot: json?.market_snapshot,
          hidden_risk: json?.hidden_risk,
          paywall_teaser: json?.paywall_teaser,
          decision_tier: json?.decision_tier,
          risk_audit_preview: parseRiskAuditPreview(json?.risk_audit_preview),
        };
        if (result.reportId) {
          const rentNum = Number(monthlyRentUsd);
          const sqftNum = Number(sqft);
          writeResultCache({
            reportId: result.reportId,
            location,
            businessType,
            language: locale,
            result: {
              verdict: result.verdict,
              headline: result.headline,
              subheadline: result.subheadline,
              market_snapshot: result.market_snapshot,
              hidden_risk: result.hidden_risk,
              paywall_teaser: result.paywall_teaser,
              decision_tier: result.decision_tier,
              risk_audit_preview: json?.risk_audit_preview,
            },
            userInputs: {
              monthly_rent_usd: Number.isFinite(rentNum) && rentNum > 0 ? rentNum : null,
              sqft: Number.isFinite(sqftNum) && sqftNum > 0 ? sqftNum : null,
            },
          });
          router.replace(withLang(`/iq/result/${encodeURIComponent(result.reportId)}`, locale));
          return;
        }
        // No row (mock provider / persistence disabled): render inline.
        setData(result);
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
  }, [isQuery, location, businessType, monthlyRentUsd, sqft, locale, conceptId, router, t.missingLocation, t.requestFailed]);

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

  /**
   * Language switch = a whole-flow switch, not a relabel. The headline, snapshot
   * and risk are written in the analysis language, so the free result is re-run
   * in the new language (idempotent server-side per language for 24 h, so
   * switching back costs nothing) and the choice is persisted first, so the
   * canonical URL, checkout (`language: locale`) and the 360° report follow it.
   * Rent / size typed so far travel along; the rest of the intake is re-entered.
   */
  function switchLanguage(next: Locale) {
    if (next === locale) return;
    persistLocale(next);
    const p = new URLSearchParams({ location, businessType, lang: next });
    const rent = intake.monthly_rent_usd.trim();
    const size = intake.sqft.trim();
    if (rent) p.set('monthlyRentUsd', rent);
    if (size) p.set('sqft', size);
    router.push(`/iq/result?${p.toString()}`);
  }

  const languagePills = (
    <div className="inline-flex items-center gap-2" role="group" aria-label={t.language} title={t.languageHint}>
      <span className="text-xs text-white/50">{t.language}</span>
      <div className="inline-flex rounded-full border border-white/15 bg-white/5 p-0.5">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => switchLanguage(l)}
            aria-pressed={l === locale}
            lang={LOCALE_TAG[l]}
            data-lang-pill={l}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              l === locale ? 'bg-white/90 text-brand-navy' : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            {SHORT_LABEL[l]}
          </button>
        ))}
      </div>
    </div>
  );

  const analyzeProgressPct = useMemo(() => {
    const fromTime = progressFromElapsed(analyzeElapsedSec, FREE_ANALYZE_PHASES, {
      done: analyzeDone,
      maxPctUntilDone: 90,
    });
    const stepFloor = [10, 36, 58][loadingStep] ?? 58;
    return Math.min(100, Math.max(fromTime, analyzeDone ? 100 : stepFloor));
  }, [analyzeElapsedSec, analyzeDone, loadingStep]);

  const showLeadSheet = Boolean(data) && !loading && !leadDone && !leadDismissed;
  const leadSheet = (
    <LeadCaptureModal
      open={showLeadSheet}
      locale={locale}
      location={location}
      defaultCuisine={businessType || storedLead?.cuisine || ''}
      reportId={data?.reportId ?? null}
      onSubmit={handleLeadSubmit}
      onDismiss={handleLeadDismiss}
    />
  );

  const htmlLang = LOCALE_TAG[locale];

  if (isQuery && conceptPrompt) {
    return (
      <main lang={htmlLang} className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg space-y-4">
          <p className="text-center text-xs uppercase tracking-[0.25em] text-white/50">{t.conceptNeeded}</p>
          <p className="text-center text-sm text-white/60">{location}</p>
          <ConceptPicker
            lang={locale}
            typed={businessType}
            options={conceptPrompt.options}
            suggestedId={conceptPrompt.id || null}
            onConfirm={(id) => {
              setConceptPrompt(null);
              setConceptId(id);
            }}
          />
        </div>
      </main>
    );
  }

  if (loading || (!isQuery && !stored && !storedMissing)) {
    return (
      <main lang={htmlLang} className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
          <IqAnalysisProgressBar
            lang={locale}
            title={t.analyzing}
            subtitle={location}
            stages={getFreeAnalyzeStages(locale)}
            percent={isQuery ? analyzeProgressPct : 60}
            elapsedSec={isQuery ? analyzeElapsedSec : undefined}
          />
        </div>
      </main>
    );
  }

  if (!isQuery && storedMissing && !stored) {
    return (
      <main lang={htmlLang} className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <p className="text-sm text-white/80 sm:text-base">{t.resultNotFound}</p>
          <a href={withLang('/iq', locale)} className="mt-4 inline-block text-sm text-emerald-400 underline underline-offset-4">
            {t.runNewAnalysis}
          </a>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main lang={htmlLang} className="flex min-h-screen items-center justify-center px-6">
        <p className="whitespace-pre-line text-center text-sm text-white/80 sm:text-base">
          {error || t.fallbackLoadFailed}
        </p>
      </main>
    );
  }

  const shareUrl =
    typeof window !== 'undefined'
      ? data.reportId
        ? `${window.location.origin}${withLang(`/iq/result/${encodeURIComponent(data.reportId)}`, locale)}`
        : `${window.location.origin}/iq/result?location=${encodeURIComponent(location)}&businessType=${encodeURIComponent(businessType)}&lang=${locale}`
      : '';

  return (
    <>
      {leadSheet}
      <main
        lang={htmlLang}
        className={`flex min-h-screen items-center justify-center px-6 py-12 ${showLeadSheet ? 'pb-[26rem] sm:pb-72' : ''}`}
        data-testid="iq-result"
      >
        <div className="w-full max-w-2xl space-y-6">
          {/* Social proof + language: the pills switch the whole flow (see switchLanguage). */}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SocialProofBadge locale={locale} />
            {languagePills}
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

export const RESULT_LOADING_COPY = resultCopy.en.loadingPage;
