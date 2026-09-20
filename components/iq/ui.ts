/**
 * The /iq visual system, as class strings.
 *
 * One canvas (warm white), one ink (navy), one signal colour (green) used for
 * status and positives — never as the surface of a whole card. Cards are white
 * with a hairline border and a very short shadow; primary actions are navy.
 * Nothing glows, nothing is translucent over a gradient, and icons are line
 * SVGs, not emoji: the product should read like a tool a consultancy ships,
 * not like a demo.
 *
 * Every funnel surface (landing, result, progress, paid report shell, account
 * pages) reads from here so a change lands everywhere at once.
 */
export const ui = {
  /** Page ground under every /iq route. */
  canvas: 'bg-[#F6F6F2] text-brand-navy',
  /** White card on the canvas. */
  card: 'rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
  /** Muted inset inside a card (forms, secondary groups). */
  inset: 'rounded-xl border border-zinc-200 bg-[#FAFAF8]',
  /** Small caps section label. */
  kicker: 'text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500',
  /** Card heading. */
  h2: 'text-base font-semibold tracking-tight text-brand-navy',
  body: 'text-sm leading-relaxed text-zinc-600',
  muted: 'text-xs text-zinc-500',
  /** Primary action: navy, white text. */
  btnPrimary:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-navy px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1B2537] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/30 disabled:cursor-not-allowed disabled:opacity-50',
  /** Secondary action: white, hairline border. */
  btnSecondary:
    'inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-brand-navy transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/20 disabled:cursor-not-allowed disabled:opacity-50',
  /** Quiet text action. */
  btnLink: 'text-sm font-medium text-brand-navy underline decoration-zinc-300 underline-offset-4 transition hover:decoration-brand-navy disabled:opacity-50',
  input:
    'w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-brand-navy placeholder:text-zinc-400 outline-none transition focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10 disabled:bg-zinc-50 disabled:opacity-60',
  label: 'mb-1 block text-xs font-medium text-zinc-600',
  hint: 'mt-1 text-[11px] leading-snug text-zinc-500',
  /** Segmented control (language pills etc.). */
  segment: 'inline-flex rounded-full border border-zinc-200 bg-white p-0.5',
  segmentOn: 'rounded-full bg-brand-navy px-3 py-1 text-xs font-semibold text-white',
  segmentOff: 'rounded-full px-3 py-1 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-brand-navy',
  /** Status pill tints: light ground, dark ink — readable on white. */
  pill: {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    orange: 'border-orange-200 bg-orange-50 text-orange-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    neutral: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  },
  error: 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800',
  notice: 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900',
} as const;

/** Verdict / decision-tier → pill tint. */
export const tierPill: Record<string, string> = {
  strong_go: ui.pill.green,
  go: ui.pill.green,
  go_with_conditions: ui.pill.sky,
  caution: ui.pill.amber,
  need_more_data: ui.pill.amber,
  high_risk: ui.pill.orange,
  no_go: ui.pill.rose,
  no: ui.pill.rose,
};
