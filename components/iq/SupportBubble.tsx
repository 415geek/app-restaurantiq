'use client';

/**
 * Floating support bubble (bottom-right) for the IQ funnel.
 *
 * Scripted assistant, no LLM: the one job that matters is getting a paying
 * customer back to their generating / finished report after a refresh or a
 * back-navigation. It remembers the last paid report id in localStorage
 * (written by the report page), verifies it is paid through
 * /api/iq/support/recover, and hands out the link; otherwise it asks for the
 * checkout email and looks the reports up by email. A small button hands the
 * conversation to a human on WhatsApp (number from /api/iq/support/config,
 * i.e. iq_settings SUPPORT_WHATSAPP) with the report context pre-filled in the
 * customer's language.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LOCALES, type Locale } from '@/lib/i18n/locale';
import { useLocale } from '@/lib/i18n/use-locale';

export const LAST_PAID_REPORT_KEY = 'iq:last_paid_report';

/** Called by the report page so the bubble can find the report again after a refresh. */
export function rememberPaidReport(id: string, location?: string) {
  try {
    localStorage.setItem(LAST_PAID_REPORT_KEY, JSON.stringify({ id, location: location ?? '', at: Date.now() }));
  } catch {
    /* storage unavailable (private mode) */
  }
}

function readRememberedReport(): { id: string; location: string } | null {
  try {
    const raw = localStorage.getItem(LAST_PAID_REPORT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { id?: string; location?: string; at?: number };
    if (!j.id) return null;
    // forget after 30 days
    if (j.at && Date.now() - j.at > 30 * 86_400_000) return null;
    return { id: j.id, location: j.location ?? '' };
  } catch {
    return null;
  }
}

type Recovered = { id: string; location: string; status: 'ready' | 'generating'; url: string; created_at: string | null };
type Msg = { from: 'bot' | 'me'; text?: string; links?: Recovered[]; askEmail?: boolean };

type Copy = {
  open: string;
  title: string;
  sub: string;
  close: string;
  hello: string;
  q_lost: string;
  q_time: string;
  q_pdf: string;
  q_refund: string;
  a_time: string;
  a_pdf: string;
  a_refund: string;
  checking: string;
  found_one: string;
  found_many: string;
  ask_email: string;
  email_ph: string;
  email_btn: string;
  not_found: string;
  error: string;
  status_ready: string;
  status_generating: string;
  go: string;
  human: string;
  human_mail: string;
  human_none: string;
  mail_subject: string;
  wa_text: (ctx: string) => string;
  ctx_report: (id: string, loc: string) => string;
  back: string;
};

const T: Record<Locale, Copy> = {
  zh: {
    open: '在线客服',
    title: 'RestaurantIQ 客服',
    sub: '付费后页面刷新或后退了？这里能带你回去。',
    close: '关闭',
    hello: '你好！我是 RestaurantIQ 客服。付费后如果页面刷新、后退或者关掉了，报告仍在后台生成，不会丢。请选择：',
    q_lost: '我付费了，页面找不到了',
    q_time: '报告要生成多久？',
    q_pdf: '怎么下载 PDF？',
    q_refund: '付款有问题',
    a_time: '免费结论约 60 秒；付费专业版通常 1–3 分钟，最长 5 分钟。生成期间可以离开页面，回来打开同一链接即可，也可以在生成页留邮箱，好了自动发你。',
    a_pdf: '报告页最上方「360° 专业版报告」面板里点「下载 360° PDF」；「打印 / 在线预览」会打开浅色打印版，也可以用浏览器另存为 PDF。',
    a_refund: '付款问题请直接转人工，把付款邮箱和大概时间告诉我们，我们核对 Stripe 记录后处理。',
    checking: '正在核对你的付款记录…',
    found_one: '找到了，你的付款已确认。点下面的链接就能回到报告：',
    found_many: '找到了以下已付费的报告，点链接即可回去：',
    ask_email: '请输入你付款时用的邮箱，我来帮你找：',
    email_ph: '付款邮箱',
    email_btn: '查找',
    not_found: '没有找到这个邮箱对应的已付费报告。可能是用了别的邮箱，或付款还没完成。你可以转人工客服，我们帮你核对。',
    error: '查询出了点问题，请稍后再试或转人工客服。',
    status_ready: '已生成',
    status_generating: '生成中',
    go: '回到报告页',
    human: '转人工客服（WhatsApp）',
    human_mail: '转人工客服（邮件）',
    human_none: '人工客服暂未接入，请稍后再试。',
    mail_subject: 'RestaurantIQ 客服',
    wa_text: (ctx) => `你好，我是 RestaurantIQ 用户，需要人工帮助。${ctx}`,
    ctx_report: (id, loc) => `报告编号 ${id}${loc ? `（${loc}）` : ''}。`,
    back: '返回菜单',
  },
  en: {
    open: 'Support',
    title: 'RestaurantIQ Support',
    sub: 'Refreshed or hit back after paying? We can take you right back.',
    close: 'Close',
    hello: 'Hi! If you refreshed, went back, or closed the page after paying, your report is still generating in the background — nothing is lost. Pick one:',
    q_lost: 'I paid but lost the page',
    q_time: 'How long does generation take?',
    q_pdf: 'How do I download the PDF?',
    q_refund: 'Payment problem',
    a_time: 'The free verdict takes about 60 seconds; the paid report usually 1–3 minutes, 5 at most. You can leave and reopen the same link, or leave your email on the generating page and we’ll send it when it’s ready.',
    a_pdf: 'On the report page, the “360° Professional Report” panel has “Download 360° PDF”; “Print / preview” opens the light print edition, which you can also save as a PDF from your browser.',
    a_refund: 'For payment issues, hand off to a human with the email you paid with and the approximate time; we’ll check the Stripe record and sort it out.',
    checking: 'Checking your payment record…',
    found_one: 'Found it — your payment is confirmed. Use the link below to get back to your report:',
    found_many: 'Found these paid reports. Tap a link to go back:',
    ask_email: 'Enter the email you used at checkout and I’ll look it up:',
    email_ph: 'Checkout email',
    email_btn: 'Find',
    not_found: 'No paid report matches that email. It may have been a different email, or the payment didn’t complete. You can hand off to a human and we’ll check.',
    error: 'Lookup failed — please try again shortly or hand off to a human.',
    status_ready: 'ready',
    status_generating: 'generating',
    go: 'Back to the report',
    human: 'Talk to a human (WhatsApp)',
    human_mail: 'Talk to a human (email)',
    human_none: 'Human support isn’t connected yet — please try again later.',
    mail_subject: 'RestaurantIQ support',
    wa_text: (ctx) => `Hi, I’m a RestaurantIQ customer and need help. ${ctx}`,
    ctx_report: (id, loc) => `Report ${id}${loc ? ` (${loc})` : ''}.`,
    back: 'Back to menu',
  },
  es: {
    open: 'Soporte',
    title: 'Soporte de RestaurantIQ',
    sub: '¿Actualizaste o retrocediste después de pagar? Te llevamos de vuelta.',
    close: 'Cerrar',
    hello: '¡Hola! Si actualizaste, retrocediste o cerraste la página después de pagar, tu informe sigue generándose en segundo plano; no se pierde nada. Elige una opción:',
    q_lost: 'Pagué pero perdí la página',
    q_time: '¿Cuánto tarda la generación?',
    q_pdf: '¿Cómo descargo el PDF?',
    q_refund: 'Problema con el pago',
    a_time: 'El veredicto gratuito tarda unos 60 segundos; el informe de pago normalmente de 1 a 3 minutos, 5 como máximo. Puedes salir y volver a abrir el mismo enlace, o dejar tu correo en la página de generación y te lo enviamos cuando esté listo.',
    a_pdf: 'En la página del informe, el panel “Informe profesional 360°” tiene “Descargar PDF 360°”; “Imprimir / vista previa” abre la edición clara para impresión, que también puedes guardar como PDF desde el navegador.',
    a_refund: 'Para problemas con el pago, pasa con una persona e indícanos el correo con el que pagaste y la hora aproximada; revisamos el registro en Stripe y lo resolvemos.',
    checking: 'Verificando tu registro de pago…',
    found_one: 'Lo encontramos: tu pago está confirmado. Usa el enlace de abajo para volver a tu informe:',
    found_many: 'Encontramos estos informes pagados. Toca un enlace para volver:',
    ask_email: 'Escribe el correo que usaste al pagar y lo busco:',
    email_ph: 'Correo de la compra',
    email_btn: 'Buscar',
    not_found: 'Ningún informe pagado coincide con ese correo. Puede que hayas usado otro correo o que el pago no se haya completado. Puedes pasar con una persona y lo revisamos.',
    error: 'La búsqueda falló. Inténtalo de nuevo en un momento o pasa con una persona.',
    status_ready: 'listo',
    status_generating: 'generando',
    go: 'Volver al informe',
    human: 'Hablar con una persona (WhatsApp)',
    human_mail: 'Hablar con una persona (correo)',
    human_none: 'El soporte humano aún no está conectado; inténtalo más tarde.',
    mail_subject: 'Soporte de RestaurantIQ',
    wa_text: (ctx) => `Hola, soy cliente de RestaurantIQ y necesito ayuda. ${ctx}`,
    ctx_report: (id, loc) => `Informe ${id}${loc ? ` (${loc})` : ''}.`,
    back: 'Volver al menú',
  },
};

const SHORT_LABEL: Record<Locale, string> = { en: 'EN', zh: '中文', es: 'ES' };

function pathReportId(pathname: string | null): string | null {
  const m = pathname?.match(/^\/iq\/report\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

export function SupportBubble() {
  const pathname = usePathname();
  const search = useSearchParams();
  // Same resolution as every funnel page: ?lang > iq_lang cookie/localStorage > browser language > English.
  const { locale: lang, setLocale: setLang } = useLocale({ param: search?.get('lang') });
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState<{ whatsapp: string | null; email: string | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = T[lang];

  const known = useMemo(() => {
    const fromPath = pathReportId(pathname);
    if (fromPath) return { id: fromPath, location: '' };
    return typeof window === 'undefined' ? null : readRememberedReport();
  }, [pathname]);

  const reset = useCallback(() => setMsgs([{ from: 'bot', text: t.hello }]), [t.hello]);

  useEffect(() => {
    if (open && msgs.length === 0) reset();
  }, [open, msgs.length, reset]);

  useEffect(() => {
    if (!open || contact) return;
    fetch('/api/iq/support/config', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setContact(j ?? { whatsapp: null, email: null }))
      .catch(() => setContact({ whatsapp: null, email: null }));
  }, [open, contact]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);

  const push = (...m: Msg[]) => setMsgs((prev) => [...prev, ...m]);

  const recover = async (body: { reportId?: string; email?: string }) => {
    setBusy(true);
    push({ from: 'bot', text: t.checking });
    try {
      const res = await fetch('/api/iq/support/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await res.json()) as { reports?: Recovered[] };
      const list = j.reports ?? [];
      if (list.length === 1) push({ from: 'bot', text: t.found_one, links: list });
      else if (list.length > 1) push({ from: 'bot', text: t.found_many, links: list });
      else if (body.reportId && !body.email) push({ from: 'bot', text: t.ask_email, askEmail: true });
      else push({ from: 'bot', text: t.not_found });
    } catch {
      push({ from: 'bot', text: t.error });
    } finally {
      setBusy(false);
    }
  };

  const onLost = () => {
    push({ from: 'me', text: t.q_lost });
    if (known?.id) void recover({ reportId: known.id });
    else push({ from: 'bot', text: t.ask_email, askEmail: true });
  };

  const onEmail = () => {
    const v = email.trim();
    if (!v || busy) return;
    push({ from: 'me', text: v });
    setEmail('');
    void recover({ email: v });
  };

  const humanHref = (() => {
    const ctx = known?.id ? t.ctx_report(known.id, known.location) : '';
    const text = encodeURIComponent(t.wa_text(ctx));
    if (contact?.whatsapp) return `https://wa.me/${contact.whatsapp}?text=${text}`;
    if (contact?.email) return `mailto:${contact.email}?subject=${encodeURIComponent(t.mail_subject)}&body=${text}`;
    return null;
  })();

  /** Switching language restarts the scripted conversation in that language. */
  const switchLang = (next: Locale) => {
    if (next === lang) return;
    setLang(next);
    setMsgs([{ from: 'bot', text: T[next].hello }]);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 print:hidden" data-support-bubble>
      {open ? (
        <div className="flex h-[min(560px,calc(100vh-7rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-brand-navy text-white shadow-2xl ring-1 ring-black/30" role="dialog" aria-label={t.title}>
          <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3">
            <div>
              <div className="text-sm font-bold">{t.title}</div>
              <div className="text-[11px] text-zinc-400">{t.sub}</div>
            </div>
            <div className="flex items-center gap-1">
              <div className="inline-flex rounded-full border border-white/15 p-0.5" role="group" aria-label="Language">
                {LOCALES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => switchLang(l)}
                    aria-pressed={l === lang}
                    className={`rounded-full px-1.5 py-0.5 text-[11px] ${l === lang ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white'}`}
                  >
                    {SHORT_LABEL[l]}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t.close} className="rounded-full p-1 text-zinc-300 hover:bg-white/10">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {msgs.map((m, i) => (
              <div key={i} className={m.from === 'me' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${m.from === 'me' ? 'bg-brand-green text-brand-navy' : 'bg-white/8 text-zinc-100'}`}>
                  {m.text}
                  {m.links?.length ? (
                    <ul className="mt-2 space-y-2">
                      {m.links.map((r) => (
                        <li key={r.id} className="rounded-xl bg-brand-navy/60 p-2.5 ring-1 ring-white/10">
                          <div className="text-xs text-zinc-300">{r.location}</div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">
                            {r.status === 'ready' ? t.status_ready : t.status_generating} · {r.id.slice(0, 8)}
                          </div>
                          <a href={r.url} className="mt-2 inline-flex rounded-lg bg-brand-green px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-emerald-400">
                            {t.go} →
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.askEmail && i === msgs.length - 1 ? (
                    <form
                      className="mt-2 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        onEmail();
                      }}
                    >
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.email_ph} className="h-9 min-w-0 flex-1 rounded-lg bg-white px-2.5 text-sm text-brand-navy outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-brand-green" autoComplete="email" />
                      <button type="submit" disabled={busy || !email.trim()} className="h-9 rounded-lg bg-brand-green px-3 text-xs font-bold text-brand-navy disabled:opacity-50">
                        {t.email_btn}
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-white/10 px-3 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={onLost} disabled={busy} className="rounded-full border border-brand-green/50 bg-brand-green/10 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-brand-green/20 disabled:opacity-50">{t.q_lost}</button>
              <button type="button" onClick={() => push({ from: 'me', text: t.q_time }, { from: 'bot', text: t.a_time })} className="rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10">{t.q_time}</button>
              <button type="button" onClick={() => push({ from: 'me', text: t.q_pdf }, { from: 'bot', text: t.a_pdf })} className="rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10">{t.q_pdf}</button>
              <button type="button" onClick={() => push({ from: 'me', text: t.q_refund }, { from: 'bot', text: t.a_refund })} className="rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10">{t.q_refund}</button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {humanHref ? (
                <a href={humanHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/15">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-300" fill="currentColor" aria-hidden><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.5 4c.6.3 1.1.4 1.5.5a3.6 3.6 0 001.6.1 2.7 2.7 0 001.8-1.3 2.2 2.2 0 00.2-1.3c-.1-.1-.3-.2-.5-.3z" /></svg>
                  {contact?.whatsapp ? t.human : t.human_mail}
                </a>
              ) : (
                <span className="text-[11px] text-zinc-500">{contact ? t.human_none : '…'}</span>
              )}
              <button type="button" onClick={reset} className="text-[11px] text-zinc-400 underline-offset-2 hover:underline">{t.back}</button>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t.open}
        className="inline-flex h-12 items-center gap-2 rounded-full bg-brand-green pl-3.5 pr-4 text-sm font-bold text-brand-navy shadow-lg shadow-emerald-500/30 ring-2 ring-white/70 transition hover:bg-emerald-400"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11H8l-4 4V5z" />
        </svg>
        {t.open}
      </button>
    </div>
  );
}
