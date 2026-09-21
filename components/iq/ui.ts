/**
 * The /iq visual system, as class strings.
 *
 * Two colours carry the whole funnel: a warm-white canvas and a navy ink.
 * Everything structural — buttons, bullets, section numbers, focus rings,
 * badges — is navy or neutral grey. The five status tints (globals.css) are
 * the only colour, and they are only ever used to say what a number means:
 * green is "good", not decoration. Cards are white with a hairline border and
 * a very short shadow. Nothing glows, nothing is translucent over a gradient,
 * and icons are line SVGs, not emoji: the product should read like a tool a
 * consultancy ships, not like a demo.
 *
 * Every funnel surface (landing, result, progress, paid report shell, account
 * pages) reads from here so a change lands everywhere at once.
 */
export const ui = {
  /** Page ground under every /iq route. */
  canvas: 'bg-brand-canvas text-brand-navy',
  /** White card on the canvas. */
  card: 'rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
  /** Muted inset inside a card (forms, secondary groups). */
  inset: 'rounded-xl border border-zinc-200 bg-brand-paper',
  /** Small caps section label. */
  kicker: 'text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500',
  /** Card heading. */
  h2: 'text-base font-semibold tracking-tight text-brand-navy',
  body: 'text-sm leading-relaxed text-zinc-600',
  muted: 'text-xs text-zinc-500',
  /** Primary action: navy, white text. */
  btnPrimary:
    'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-navy px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-navy-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/30 disabled:cursor-not-allowed disabled:opacity-50',
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
  /**
   * Status tints: the ink carries the meaning and its own ground and hairline
   * are mixed from that same ink, so the five read as one family and none of
   * them fights the warm canvas.
   */
  pill: {
    pine: 'border-brand-pine/25 bg-brand-pine/8 text-brand-pine',
    steel: 'border-brand-steel/25 bg-brand-steel/8 text-brand-steel',
    ochre: 'border-brand-ochre/25 bg-brand-ochre/8 text-brand-ochre',
    sienna: 'border-brand-sienna/25 bg-brand-sienna/8 text-brand-sienna',
    clay: 'border-brand-clay/25 bg-brand-clay/8 text-brand-clay',
    neutral: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  },
  error: 'rounded-lg border border-brand-clay/25 bg-brand-clay/8 px-3 py-2 text-xs text-brand-clay',
  notice: 'rounded-xl border border-brand-ochre/25 bg-brand-ochre/8 px-4 py-3 text-sm leading-relaxed text-brand-ochre',
} as const;

/** Verdict / decision-tier → status tint. */
export const tierPill: Record<string, string> = {
  strong_go: ui.pill.pine,
  go: ui.pill.pine,
  go_with_conditions: ui.pill.steel,
  caution: ui.pill.ochre,
  need_more_data: ui.pill.ochre,
  high_risk: ui.pill.sienna,
  no_go: ui.pill.clay,
  no: ui.pill.clay,
};
