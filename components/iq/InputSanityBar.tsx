'use client';

/**
 * v4 §1.3 异常输入阻断 — the confirmation bar.
 *
 * Shown wherever a report carries an unconfirmed input-sanity flag (the free
 * result and the paid 360° page). Until the customer answers, the flagged
 * number is kept out of every score and the verdict is locked at CONDITIONAL
 * GO; the bar says exactly that, names the benchmark, and takes one of four
 * answers. The answer is stored in `user_inputs.rent_confirmation` through the
 * same route the intake form uses, so the next (re)generation reads it.
 */
import { useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';
import type { InputSanityFlag } from '@/lib/iq/model/schema';
import { ui } from '@/components/iq/ui';

type Answer = NonNullable<InputSanityFlag['confirmation']>;

const COPY: Record<
  Locale,
  {
    title: (v: string, b: string | null) => string;
    body: string;
    options: Record<Answer, string>;
    save: string;
    saving: string;
    saved: Record<Answer, string>;
    failed: string;
    sizeTitle: (v: string) => string;
    ticketTitle: (v: string, ref: string) => string;
  }
> = {
  zh: {
    title: (v, b) => `你填的月租 ${v} 明显低于${b ? `本地沿街铺位的下限（约 ${b}）` : '合理范围'}。请确认：`,
    body: '确认之前，这个数字不会进入任何评分，判定最高只到「有条件可做」。',
    options: { net: '这是净租金，就是这个数', nnn_base: '这是 NNN 基础租（不含税费、保险、公共维护）', promo: '这是部分期 / 免租期的优惠价', typo: '填错了，我重新填' },
    save: '确认',
    saving: '保存中…',
    saved: { net: '已记录：按净租金计入。完整报告会按此重算。', nnn_base: '已记录：按 NNN 基础租计入，报告会提醒补上三项费用。', promo: '已记录：按优惠期租金计入，报告会按正常期提示。', typo: '已记录：请在下方租金栏重新填写，报告将不使用这个数字。' },
    failed: '保存失败，请稍后重试。',
    sizeTitle: (v) => `你填的面积 ${v} sq ft 看起来不像一个餐饮铺位，请核对。`,
    ticketTitle: (v, ref) => `你填的客单价 $${v} 与该业态常见水平（约 $${ref}）差距很大，确认前按业态默认值计算。`,
  },
  en: {
    title: (v, b) => `The monthly rent you entered, ${v}, is well below ${b ? `the floor for a storefront here (about ${b})` : 'a plausible range'}. Please confirm:`,
    body: 'Until you confirm, this number stays out of every score and the verdict is capped at CONDITIONAL GO.',
    options: { net: 'It is the net rent, as entered', nnn_base: 'It is the NNN base rent (taxes, insurance and CAM on top)', promo: 'It is a promotional / free-rent period figure', typo: 'A typo — I will re-enter it' },
    save: 'Confirm',
    saving: 'Saving…',
    saved: { net: 'Recorded as net rent. The full report will be recomputed on it.', nnn_base: 'Recorded as NNN base; the report will flag the three pass-throughs to add.', promo: 'Recorded as a promotional figure; the report will note the post-promo rent.', typo: 'Recorded. Re-enter the rent below; this figure will not be used.' },
    failed: 'Could not save. Please try again.',
    sizeTitle: (v) => `The size you entered, ${v} sq ft, does not look like a restaurant storefront. Please check it.`,
    ticketTitle: (v, ref) => `The ticket you entered, $${v}, is far from the usual level for this concept (about $${ref}); the concept default is used until you confirm.`,
  },
  es: {
    title: (v, b) => `El alquiler mensual que ingresaste, ${v}, está muy por debajo ${b ? `del mínimo de un local aquí (unos ${b})` : 'de un rango plausible'}. Confirma:`,
    body: 'Hasta que confirmes, esta cifra no entra en ninguna puntuación y el veredicto se limita a VIABLE CON CONDICIONES.',
    options: { net: 'Es el alquiler neto, tal cual', nnn_base: 'Es la renta base NNN (impuestos, seguro y mantenimiento aparte)', promo: 'Es una cifra promocional / de meses gratis', typo: 'Un error, lo vuelvo a ingresar' },
    save: 'Confirmar',
    saving: 'Guardando…',
    saved: { net: 'Registrado como alquiler neto. El informe completo se recalculará con él.', nnn_base: 'Registrado como base NNN; el informe señalará los tres cargos a sumar.', promo: 'Registrado como cifra promocional; el informe indicará el alquiler posterior.', typo: 'Registrado. Vuelve a ingresar el alquiler abajo; esta cifra no se usará.' },
    failed: 'No se pudo guardar. Inténtalo de nuevo.',
    sizeTitle: (v) => `El tamaño que ingresaste, ${v} sq ft, no parece un local de restaurante. Revísalo.`,
    ticketTitle: (v, ref) => `El ticket que ingresaste, $${v}, está lejos del nivel habitual del concepto (unos $${ref}); se usa el valor por defecto hasta que confirmes.`,
  },
};

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

type Props = {
  lang: Locale;
  reportId: string | null;
  flags: InputSanityFlag[];
  /** Called after a confirmation is stored (the parent may focus the rent input on `typo`). */
  onAnswered?: (answer: Answer) => void;
  className?: string;
};

export function InputSanityBar({ lang, reportId, flags, onAnswered, className = '' }: Props) {
  const t = COPY[lang];
  const rent = flags.find((f) => f.field === 'rent_usd' && !f.confirmed);
  const others = flags.filter((f) => f.field !== 'rent_usd');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saved, setSaved] = useState<Answer | null>(null);

  if (!rent && others.length === 0) return null;

  async function submit() {
    if (!answer || !reportId) return;
    setState('saving');
    try {
      const res = await fetch('/api/funnel/report-inputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, inputs: { rent_confirmation: answer } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(answer);
      setState('saved');
      onAnswered?.(answer);
    } catch {
      setState('failed');
    }
  }

  return (
    <section className={`${ui.notice} ${className}`} role="status" data-testid="input-sanity-bar">
      {rent ? (
        <>
          <p className="font-semibold">{t.title(usd(rent.value), rent.benchmark ? usd(rent.benchmark.value) : null)}</p>
          <p className="mt-1 text-xs opacity-90">{t.body}</p>
          {state === 'saved' && saved ? (
            <p className="mt-2 text-xs font-medium">{t.saved[saved]}</p>
          ) : (
            <>
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2" role="radiogroup">
                {(Object.keys(t.options) as Answer[]).map((k) => (
                  <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg border border-brand-ochre/25 bg-white/70 px-3 py-2 text-xs text-brand-navy">
                    <input type="radio" name="rent_confirmation" value={k} checked={answer === k} onChange={() => setAnswer(k)} className="mt-0.5" />
                    <span>{t.options[k]}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={() => void submit()} disabled={!answer || !reportId || state === 'saving'} className={`${ui.btnPrimary} py-2 text-xs`}>
                  {state === 'saving' ? t.saving : t.save}
                </button>
                {state === 'failed' ? <span className="text-xs text-brand-clay">{t.failed}</span> : null}
              </div>
            </>
          )}
        </>
      ) : null}
      {others.map((f) => (
        <p key={f.field} className={`text-xs ${rent ? 'mt-3 border-t border-brand-ochre/20 pt-2' : ''}`}>
          {f.field === 'sqft' ? t.sizeTitle(Math.round(f.value).toLocaleString('en-US')) : t.ticketTitle(String(Math.round(f.value)), f.benchmark ? String(Math.round(f.benchmark.value)) : '—')}
        </p>
      ))}
    </section>
  );
}
