'use client';

/**
 * Lead capture as a dismissible bottom sheet (评审 Spec §4.7): the free result
 * stays readable and scrollable behind it, "Not now" closes it, and it never
 * covers the whole screen. Leaving an email saves the result to the lead.
 */
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';
import { ui } from '@/components/iq/ui';

export type LeadCaptureSubmit = {
  email: string;
  name: string;
  phone: string;
  cuisine: string;
};

type Props = {
  open: boolean;
  locale: Locale;
  location: string;
  defaultCuisine?: string;
  reportId?: string | null;
  onSubmit: (data: LeadCaptureSubmit & { leadId: string | null }) => void;
  /** "Not now" — closes the sheet without capturing anything. */
  onDismiss?: () => void;
};

const copy: Record<
  Locale,
  {
    headline: string;
    subhead: string;
    emailLabel: string;
    emailPlaceholder: string;
    nameLabel: string;
    namePlaceholder: string;
    phoneLabel: string;
    phonePlaceholder: string;
    cuisineLabel: string;
    cuisinePlaceholder: string;
    cta: string;
    submitting: string;
    privacy: string;
    locationLabel: string;
    notNow: string;
    moreFields: string;
    errEmail: string;
    errName: string;
    errCuisine: string;
    errNetwork: string;
  }
> = {
  en: {
    headline: 'Save this result — leave an email',
    subhead:
      'The free result is already on screen. Leave an email to save a link to it and get the PDF and follow-up site insights. We never sell your data.',
    emailLabel: 'Work or personal email',
    emailPlaceholder: 'you@company.com',
    nameLabel: 'Your name',
    namePlaceholder: 'e.g. Alex Chen',
    phoneLabel: 'Phone / WhatsApp / WeChat (optional)',
    phonePlaceholder: '+1 (415) 555-1234',
    cuisineLabel: 'Cuisine / concept',
    cuisinePlaceholder: 'e.g. boba tea, Hong Kong café, hot pot',
    cta: 'Save my result →',
    submitting: 'Saving…',
    privacy: 'We’ll email you the PDF once the report is ready. Unsubscribe anytime.',
    locationLabel: 'Result for',
    notNow: 'Not now',
    moreFields: 'Add name and phone',
    errEmail: 'Please enter a valid email.',
    errName: 'Please enter your name.',
    errCuisine: 'Please tell us your cuisine or concept.',
    errNetwork: 'Could not save your details. Please try again.',
  },
  zh: {
    headline: '留个邮箱，保存这份结果',
    subhead:
      '免费结果已经在页面上了。留下邮箱可以保存结果链接，并收到 PDF 和后续选址建议。我们绝不会把您的信息出售给第三方。',
    emailLabel: '联系邮箱',
    emailPlaceholder: 'you@company.com',
    nameLabel: '您的姓名',
    namePlaceholder: '例：陈先生',
    phoneLabel: '电话 / WhatsApp / 微信（选填）',
    phonePlaceholder: '+1 (415) 555-1234 或微信号',
    cuisineLabel: '想做的菜系 / 业态',
    cuisinePlaceholder: '例：港式茶餐厅、火锅、奶茶、川菜',
    cta: '保存结果 →',
    submitting: '正在保存…',
    privacy: '报告生成后我们会通过邮箱发送 PDF。任何时候都可以一键退订。',
    locationLabel: '本次分析',
    notNow: '稍后再说',
    moreFields: '补充姓名和电话',
    errEmail: '请输入有效的邮箱地址。',
    errName: '请填写您的姓名。',
    errCuisine: '请告诉我们您想做的菜系或业态。',
    errNetwork: '保存失败，请稍后重试。',
  },
  es: {
    headline: 'Guarda este resultado: deja tu correo',
    subhead:
      'El resultado gratuito ya está en pantalla. Deja un correo para guardar el enlace y recibir el PDF y observaciones de seguimiento. Nunca vendemos tu información.',
    emailLabel: 'Correo de trabajo o personal',
    emailPlaceholder: 'tu@empresa.com',
    nameLabel: 'Tu nombre',
    namePlaceholder: 'p. ej., Ana García',
    phoneLabel: 'Teléfono / WhatsApp / WeChat (opcional)',
    phonePlaceholder: '+1 (415) 555-1234',
    cuisineLabel: 'Tipo de cocina / concepto',
    cuisinePlaceholder: 'p. ej., té de burbujas, cafetería hongkonesa, hot pot',
    cta: 'Guardar mi resultado →',
    submitting: 'Guardando…',
    privacy: 'Te enviaremos el PDF por correo cuando el informe esté listo. Cancela cuando quieras.',
    locationLabel: 'Resultado para',
    notNow: 'Ahora no',
    moreFields: 'Agregar nombre y teléfono',
    errEmail: 'Ingresa un correo válido.',
    errName: 'Ingresa tu nombre.',
    errCuisine: 'Dinos tu tipo de cocina o concepto.',
    errNetwork: 'No se pudieron guardar tus datos. Inténtalo de nuevo.',
  },
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function LeadCaptureModal({
  open,
  locale,
  location,
  defaultCuisine,
  reportId,
  onSubmit,
  onDismiss,
}: Props) {
  const t = copy[locale];
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cuisine, setCuisine] = useState(defaultCuisine ?? '');
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) setError(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [open]);

  useEffect(() => {
    if (!defaultCuisine) return;
    setCuisine((c) => c || defaultCuisine); // eslint-disable-line react-hooks/set-state-in-effect
  }, [defaultCuisine]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    const trimmedCuisine = cuisine.trim();

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError(t.errEmail);
      emailRef.current?.focus();
      return;
    }
    if (!trimmedCuisine) {
      setError(t.errCuisine);
      setShowMore(true);
      return;
    }
    if (!trimmedName) {
      setError(t.errName);
      setShowMore(true);
      return;
    }

    setSubmitting(true);
    let leadId: string | null = null;
    try {
      const res = await fetch('/api/iq/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          name: trimmedName,
          phone: phone.trim(),
          cuisine: trimmedCuisine,
          location,
          language: locale,
          reportId: reportId ?? undefined,
        }),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { leadId?: string };
        leadId = json.leadId ?? null;
      } else {
        // Non-fatal: still close the sheet so the user is not blocked by infra issues.
        console.warn('[lead-sheet] persistence failed with status', res.status);
      }
    } catch (err) {
      console.warn('[lead-sheet] network error:', err);
    } finally {
      setSubmitting(false);
    }

    onSubmit({
      email: trimmedEmail,
      name: trimmedName,
      phone: phone.trim(),
      cuisine: trimmedCuisine,
      leadId,
    });
  }

  const inputCls = `mt-1 ${ui.input}`;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:px-6 sm:pb-6"
      data-testid="lead-sheet"
    >
      <section
        role="dialog"
        aria-labelledby="lead-sheet-headline"
        className={`pointer-events-auto w-full max-w-lg ${ui.card} p-5 shadow-[0_24px_60px_-24px_rgba(11,18,32,0.45)]`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={ui.kicker}>{t.locationLabel}</div>
            <div className="truncate text-xs text-zinc-600" title={location}>
              {location || '—'}
            </div>
          </div>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-4 transition hover:text-brand-navy"
              data-testid="lead-sheet-dismiss"
            >
              {t.notNow}
            </button>
          ) : null}
        </div>

        <h2 id="lead-sheet-headline" className="mt-2 text-lg font-semibold tracking-tight text-brand-navy">
          {t.headline}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-600">{t.subhead}</p>

        <form onSubmit={handleSubmit} className="mt-3 space-y-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1">
              <span className="block text-xs font-medium text-zinc-600">{t.emailLabel}</span>
              <input
                ref={emailRef}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.emailPlaceholder}
                className={inputCls}
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className={`${ui.btnPrimary} py-2.5`}
            >
              {submitting ? t.submitting : t.cta}
            </button>
          </div>

          {showMore ? (
            <div className="grid gap-2.5 sm:grid-cols-3">
              <label className="block">
                <span className="block text-xs font-medium text-zinc-600">{t.nameLabel}</span>
                <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-zinc-600">{t.cuisineLabel}</span>
                <input type="text" value={cuisine} onChange={(e) => setCuisine(e.target.value)} placeholder={t.cuisinePlaceholder} className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-zinc-600">{t.phoneLabel}</span>
                <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phonePlaceholder} className={inputCls} />
              </label>
            </div>
          ) : (
            <button type="button" onClick={() => setShowMore(true)} className={`${ui.btnLink} text-xs`}>
              {t.moreFields}
            </button>
          )}

          {error ? (
            <div role="alert" className={ui.error}>
              {error}
            </div>
          ) : null}

          <p className="text-[11px] text-zinc-500">{t.privacy}</p>
        </form>
      </section>
    </div>
  );
}
