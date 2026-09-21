'use client';

/**
 * Concept category picker (评审 Spec §4.1 step 3): shown when the classifier
 * is not confident about the typed business type. Two-step single select —
 * the six top-level categories, then the subtype inside the chosen category —
 * with the classifier's low-confidence guess pre-selected when there is one.
 * Props are the contract the result page wires to; nothing here touches the
 * taxonomy loader (server-only), the options arrive pre-computed.
 */
import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';
import { CONCEPT_CATEGORY_ORDER, conceptCategoryLabel, conceptOptionLabel, type ConceptOption } from '@/lib/iq/concept/labels';
import type { ConceptCategory } from '@/lib/iq/params';
import { ui } from '@/components/iq/ui';

export interface ConceptPickerProps {
  lang: Locale;
  /** The text the customer typed, echoed in the title. */
  typed: string;
  options: ConceptOption[];
  /** Pre-selected id when the classifier had a low-confidence guess. */
  suggestedId?: string | null;
  onConfirm: (conceptId: string) => void;
  disabled?: boolean;
}

const COPY: Record<Locale, { title: (typed: string) => string; help: string; step1: string; step2: string; suggested: string; confirm: string; pickFirst: string }> = {
  en: {
    title: (t) => (t ? `Which best describes “${t}”?` : 'What kind of business is this?'),
    help: 'Pick the category, then the type, so the report analyzes the right kind of business — demand, competitors and staffing all follow from it.',
    step1: '1 · Category',
    step2: '2 · Type',
    suggested: 'Our best guess — confirm or change it',
    confirm: 'Confirm and analyze',
    pickFirst: 'Choose a category and a type to continue',
  },
  zh: {
    title: (t) => (t ? `「${t}」最接近下面哪一类？` : '这是什么类型的生意？'),
    help: '先选类目、再选业态，报告才会按正确的生意来分析——需求、竞品、人手都由此决定。',
    step1: '1 · 类目',
    step2: '2 · 业态',
    suggested: '系统的猜测——请确认或更改',
    confirm: '确认并开始分析',
    pickFirst: '请先选择类目与业态',
  },
  es: {
    title: (t) => (t ? `¿Cuál describe mejor “${t}”?` : '¿Qué tipo de negocio es?'),
    help: 'Elige la categoría y luego el tipo para que el informe analice el negocio correcto: la demanda, los competidores y el personal dependen de ello.',
    step1: '1 · Categoría',
    step2: '2 · Tipo',
    suggested: 'Nuestra mejor suposición: confírmala o cámbiala',
    confirm: 'Confirmar y analizar',
    pickFirst: 'Elige una categoría y un tipo para continuar',
  },
};

export function ConceptPicker({ lang, typed, options, suggestedId, onConfirm, disabled }: ConceptPickerProps) {
  const t = COPY[lang];
  const suggested = useMemo(() => options.find((o) => o.id === suggestedId) ?? null, [options, suggestedId]);
  const [category, setCategory] = useState<ConceptCategory | null>(suggested?.category ?? null);
  const [id, setId] = useState<string | null>(suggested?.id ?? null);
  // The suggestion seeds the initial selection only; a parent that fetches options later re-mounts with a `key`.

  const categories = useMemo(() => {
    const present = new Set(options.map((o) => o.category));
    const ordered = CONCEPT_CATEGORY_ORDER.filter((c) => present.has(c));
    for (const c of present) if (!ordered.includes(c)) ordered.push(c);
    return ordered;
  }, [options]);
  const subtypes = useMemo(() => options.filter((o) => o.category === category), [options, category]);
  const chosen = id ? options.find((o) => o.id === id) ?? null : null;

  return (
    <div className={`${ui.card} p-5 sm:p-6`} role="group" aria-label={t.title(typed)}>
      <h3 className="text-lg font-semibold tracking-tight text-brand-navy">{t.title(typed)}</h3>
      <p className="mt-1 text-sm text-zinc-600">{t.help}</p>
      {suggested ? (
        <p className="mt-2 text-xs font-medium text-brand-pine">
          {t.suggested}：{conceptCategoryLabel(suggested.category, lang)} · {conceptOptionLabel(suggested, lang)}
        </p>
      ) : null}

      <div className={`mt-5 ${ui.kicker}`}>{t.step1}</div>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t.step1}>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            disabled={disabled}
            aria-checked={category === c}
            onClick={() => {
              if (category === c) return;
              setCategory(c);
              setId(null);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${category === c ? 'border-brand-navy bg-brand-navy text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:border-brand-navy'} disabled:opacity-50`}
          >
            {conceptCategoryLabel(c, lang)}
          </button>
        ))}
      </div>

      {category ? (
        <>
          <div className={`mt-5 ${ui.kicker}`}>{t.step2}</div>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t.step2}>
            {subtypes.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={id === o.id}
                onClick={() => setId(o.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${id === o.id ? 'border-brand-navy bg-brand-navy text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:border-brand-navy'} disabled:opacity-50`}
              >
                {conceptOptionLabel(o, lang)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <button
        type="button"
        disabled={disabled || !chosen}
        onClick={() => chosen && onConfirm(chosen.id)}
        className={`mt-6 w-full ${ui.btnPrimary}`}
      >
        {chosen ? `${t.confirm} · ${conceptOptionLabel(chosen, lang)}` : t.pickFirst}
      </button>
    </div>
  );
}
