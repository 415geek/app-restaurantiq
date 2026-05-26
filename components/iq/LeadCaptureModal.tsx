'use client';

import { useEffect, useRef, useState } from 'react';

export type LeadCaptureSubmit = {
  email: string;
  name: string;
  phone: string;
  cuisine: string;
};

type Locale = 'en' | 'zh';

type Props = {
  open: boolean;
  locale: Locale;
  location: string;
  defaultCuisine?: string;
  reportId?: string | null;
  onSubmit: (data: LeadCaptureSubmit & { leadId: string | null }) => void;
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
    errEmail: string;
    errName: string;
    errCuisine: string;
    errNetwork: string;
    bullets: string[];
  }
> = {
  en: {
    headline: 'Almost there — unlock your free risk audit',
    subhead:
      'Tell us where to send the report. We use this only to deliver your PDF and follow-up site insights. We never sell your data.',
    emailLabel: 'Work or personal email',
    emailPlaceholder: 'you@company.com',
    nameLabel: 'Your name',
    namePlaceholder: 'e.g. Alex Chen',
    phoneLabel: 'Phone / WhatsApp / WeChat (optional)',
    phonePlaceholder: '+1 (415) 555-1234',
    cuisineLabel: 'Cuisine / concept',
    cuisinePlaceholder: 'e.g. Boba tea, Hong Kong cafe, hot pot',
    cta: 'Unlock free risk audit →',
    submitting: 'Unlocking…',
    privacy: 'We will email you the PDF once the report is ready. Unsubscribe anytime.',
    locationLabel: 'Auditing',
    errEmail: 'Please enter a valid email.',
    errName: 'Please enter your name.',
    errCuisine: 'Please tell us your cuisine or concept.',
    errNetwork: 'Could not save your details. Please retry.',
    bullets: [
      'Decision-grade scorecard for this exact address',
      '3 fact-based insights citing real nearby competitors',
      '1 hidden risk most operators miss',
    ],
  },
  zh: {
    headline: '差最后一步 — 解锁免费风险审计',
    subhead:
      '告诉我们把报告发到哪里。我们仅用您留下的信息发送 PDF 和后续选址优化建议，绝不会出售给第三方。',
    emailLabel: '联系邮箱',
    emailPlaceholder: 'you@company.com',
    nameLabel: '您的姓名',
    namePlaceholder: '例：陈先生',
    phoneLabel: '电话 / WhatsApp / 微信（选填）',
    phonePlaceholder: '+1 (415) 555-1234 或微信号',
    cuisineLabel: '想做的菜系 / 业态',
    cuisinePlaceholder: '例：港式茶餐厅、火锅、奶茶、川菜',
    cta: '解锁免费风险审计 →',
    submitting: '正在解锁…',
    privacy: '报告生成后我们会通过邮箱发送 PDF。任何时候都可以一键退订。',
    locationLabel: '正在审计',
    errEmail: '请输入有效的邮箱地址。',
    errName: '请填写您的姓名。',
    errCuisine: '请告诉我们您想做的菜系或业态。',
    errNetwork: '保存失败，请稍后重试。',
    bullets: [
      '本地址专属决策级评分卡',
      '3 条引用真实周边竞品的事实型洞察',
      '1 条多数老板会忽略的隐藏风险',
    ],
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
}: Props) {
  const t = copy[locale];
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cuisine, setCuisine] = useState(defaultCuisine ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      // Focus email shortly after the modal mounts/animates in.
      const id = window.setTimeout(() => emailRef.current?.focus(), 80);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Lock body scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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
    if (!trimmedName) {
      setError(t.errName);
      return;
    }
    if (!trimmedCuisine) {
      setError(t.errCuisine);
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
        // Non-fatal: still unlock the report so the user is not blocked by infra issues.
        console.warn('[lead-modal] persistence failed with status', res.status);
      }
    } catch (err) {
      console.warn('[lead-modal] network error:', err);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-modal-headline"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl">
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wider text-emerald-300/80">
            {t.locationLabel}
          </div>
          <div className="mt-1 truncate text-sm text-white/70" title={location}>
            {location || '—'}
          </div>
        </div>

        <h2 id="lead-modal-headline" className="text-xl font-semibold text-white sm:text-2xl">
          {t.headline}
        </h2>
        <p className="mt-2 text-sm text-white/65">{t.subhead}</p>

        <ul className="mt-4 space-y-1.5 text-sm text-white/80">
          {t.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-white/55">{t.emailLabel}</span>
            <input
              ref={emailRef}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder-white/35 outline-none focus:border-emerald-400/60 focus:bg-white/15"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-white/55">{t.nameLabel}</span>
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePlaceholder}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder-white/35 outline-none focus:border-emerald-400/60 focus:bg-white/15"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-white/55">{t.cuisineLabel}</span>
            <input
              type="text"
              required
              value={cuisine}
              onChange={(e) => setCuisine(e.target.value)}
              placeholder={t.cuisinePlaceholder}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder-white/35 outline-none focus:border-emerald-400/60 focus:bg-white/15"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-white/55">{t.phoneLabel}</span>
            <input
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t.phonePlaceholder}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder-white/35 outline-none focus:border-emerald-400/60 focus:bg-white/15"
            />
          </label>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? t.submitting : t.cta}
          </button>

          <p className="text-center text-[11px] text-white/40">{t.privacy}</p>
        </form>
      </div>
    </div>
  );
}
