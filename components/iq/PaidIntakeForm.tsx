'use client';

import { useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';
import { ui } from '@/components/iq/ui';

/**
 * PaidIntakeForm — the optional "add details" step between the free report and
 * the paid 360° report. Every field is optional; values are kept as raw strings
 * and coerced server-side (POST /api/funnel/report-inputs).
 *
 * The three fields the 360° engine depends on most — monthly rent, size, seats —
 * lead the form in a highlighted "core" group. When rent is missing the engine
 * no longer assumes one (it reports a rent-excluded break-even and a rent
 * ceiling instead), so the helper text under each core field spells out the
 * consequence of leaving it blank.
 *
 * Two modes:
 *   - embedded   (result page): parent owns `value` / `onChange` and saves on checkout.
 *   - standalone (Report360Panel): the form saves itself and calls `onSaved`.
 */

export type PaidIntakeValues = {
  monthly_rent_usd: string;
  sqft: string;
  seats: string;
  ticket_in: string;
  ticket_delivery: string;
  delivery_ratio: string;
  capex_usd: string;
  parking_spaces: string;
  existing_stores: string;
  known_competitors: string;
  listing_urls: string;
  dayparts: string[];
  notes: string;
};

/** The three inputs the finance engine depends on most; rendered first. */
export type PaidIntakeCoreKey = 'monthly_rent_usd' | 'sqft' | 'seats';
export const PAID_INTAKE_CORE_KEYS: readonly PaidIntakeCoreKey[] = ['monthly_rent_usd', 'sqft', 'seats'];

/** DOM id of a field's <input>; lets a parent focus e.g. the rent input from a notice. */
export function paidIntakeInputId(key: keyof Omit<PaidIntakeValues, 'dayparts'>): string {
  return `intake-${key}`;
}

export const DAYPARTS = ['breakfast', 'lunch', 'dinner', 'late_night'] as const;

export function emptyPaidIntakeValues(): PaidIntakeValues {
  return {
    monthly_rent_usd: '',
    sqft: '',
    seats: '',
    ticket_in: '',
    ticket_delivery: '',
    delivery_ratio: '',
    capex_usd: '',
    parking_spaces: '',
    existing_stores: '',
    known_competitors: '',
    listing_urls: '',
    dayparts: [],
    notes: '',
  };
}

/** True when the user typed anything at all (so the parent can skip an empty POST). */
export function hasPaidIntakeValues(v: PaidIntakeValues): boolean {
  return Object.values(v).some((x) => (Array.isArray(x) ? x.length > 0 : x.trim().length > 0));
}

/** Non-empty fields only, as the API expects them (strings; the server splits lists). */
export function paidIntakePayload(v: PaidIntakeValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x)) {
      if (x.length) out[k] = x;
    } else if (x.trim()) out[k] = x.trim();
  }
  return out;
}

export async function submitPaidIntake(
  reportId: string,
  values: PaidIntakeValues,
): Promise<{ ok: boolean; inputs?: Record<string, unknown>; error?: string }> {
  const res = await fetch('/api/funnel/report-inputs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, inputs: paidIntakePayload(values) }),
  });
  let json: { ok?: boolean; inputs?: Record<string, unknown>; error?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* empty body */
  }
  if (!res.ok || !json.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
  return { ok: true, inputs: json.inputs };
}

const COPY: Record<
  Locale,
  {
    reassurance: string;
    sectionCore: string;
    rent: string;
    rentHint: string;
    sqft: string;
    sqftHint: string;
    seats: string;
    seatsHint: string;
    alreadyProvided: string;
    moreOptional: string;
    moreOptionalHide: string;
    ticketIn: string;
    ticketDelivery: string;
    deliveryRatio: string;
    capex: string;
    parking: string;
    existingStores: string;
    existingStoresHint: string;
    knownCompetitors: string;
    knownCompetitorsHint: string;
    listingUrls: string;
    listingUrlsHint: string;
    dayparts: string;
    daypart: Record<(typeof DAYPARTS)[number], string>;
    notes: string;
    notesHint: string;
    save: string;
    saving: string;
    saved: string;
    failed: string;
    cancel: string;
    sectionFinance: string;
    sectionCompetition: string;
  }
> = {
  zh: {
    reassurance: '不填也能生成；填得越全，竞对与财务越准。',
    sectionCore: '核心三项',
    rent: '月租金 (USD)',
    rentHint: '不填则报告不假设任何租金：只给不含租金的保本线和租金上限',
    sqft: '面积 (sq ft)',
    sqftHint: '不填面积就算不出每平方英尺租金，也无法与同区房源对比',
    seats: '座位数',
    seatsHint: '座位数决定接待能力与每轮营收上限',
    alreadyProvided: '已提供 ✓',
    moreOptional: '更多可选信息（客单价、投入、竞品…）',
    moreOptionalHide: '收起可选信息',
    ticketIn: '计划堂食客单价 ($)',
    ticketDelivery: '计划外卖客单价 ($)',
    deliveryRatio: '外卖占比 (%)',
    capex: '装修 + 设备预算 CapEx ($)',
    parking: '停车位数',
    existingStores: '已有门店地址',
    existingStoresHint: '每行一个地址，用于分流（自蚕食）测算',
    knownCompetitors: '你知道的直接竞品',
    knownCompetitorsHint: '店名，逗号或换行分隔，最多 10 家',
    listingUrls: '房源挂牌链接',
    listingUrlsHint: 'LoopNet / Crexi 等链接，每行一个',
    dayparts: '计划营业时段',
    daypart: { breakfast: '早', lunch: '午', dinner: '晚', late_night: '夜宵' },
    notes: '备注',
    notesHint: '任何想让分析师知道的情况',
    save: '保存并重新生成',
    saving: '保存中…',
    saved: '已保存，正在重新生成…',
    failed: '保存失败，请稍后重试。',
    cancel: '取消',
    sectionFinance: '财务',
    sectionCompetition: '竞争与选址',
  },
  en: {
    reassurance: 'All optional — the report works without these; the more you add, the sharper the competitor and finance sections.',
    sectionCore: 'The three numbers that matter',
    rent: 'Monthly rent (USD)',
    rentHint: 'Leave blank and the report assumes no rent: it shows a rent-excluded break-even and a rent ceiling instead',
    sqft: 'Size (sq ft)',
    sqftHint: 'Without size there is no rent per sq ft and no comparison with nearby listings',
    seats: 'Seats',
    seatsHint: 'Seats set your capacity and the revenue ceiling per turn',
    alreadyProvided: 'already provided ✓',
    moreOptional: 'More optional details (ticket size, budget, competitors…)',
    moreOptionalHide: 'Hide optional details',
    ticketIn: 'Planned dine-in ticket ($)',
    ticketDelivery: 'Planned delivery ticket ($)',
    deliveryRatio: 'Delivery share (%)',
    capex: 'Build-out + equipment budget ($)',
    parking: 'Parking spaces',
    existingStores: 'Existing store addresses',
    existingStoresHint: 'One per line — used for the cannibalization check',
    knownCompetitors: 'Direct competitors you know of',
    knownCompetitorsHint: 'Names, comma- or newline-separated, up to 10',
    listingUrls: 'Listing links',
    listingUrlsHint: 'LoopNet / Crexi, etc., one per line',
    dayparts: 'Planned service hours',
    daypart: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', late_night: 'Late night' },
    notes: 'Notes',
    notesHint: 'Anything the analyst should know',
    save: 'Save & regenerate',
    saving: 'Saving…',
    saved: 'Saved — regenerating…',
    failed: 'Could not save. Please try again.',
    cancel: 'Cancel',
    sectionFinance: 'Finance',
    sectionCompetition: 'Competition & site',
  },
  es: {
    reassurance: 'Todo es opcional: el informe funciona sin estos datos; cuanto más agregues, más precisas serán las secciones de competencia y finanzas.',
    sectionCore: 'Los tres números que importan',
    rent: 'Alquiler mensual (USD)',
    rentHint: 'Si lo dejas en blanco, el informe no asume ningún alquiler: muestra el punto de equilibrio sin alquiler y un tope de alquiler',
    sqft: 'Tamaño (pies cuadrados)',
    sqftHint: 'Sin el tamaño no hay alquiler por pie cuadrado ni comparación con locales cercanos',
    seats: 'Asientos',
    seatsHint: 'Los asientos fijan tu capacidad y el techo de ingresos por turno',
    alreadyProvided: 'ya indicado ✓',
    moreOptional: 'Más datos opcionales (ticket promedio, presupuesto, competidores…)',
    moreOptionalHide: 'Ocultar datos opcionales',
    ticketIn: 'Ticket promedio en el local ($)',
    ticketDelivery: 'Ticket promedio de delivery ($)',
    deliveryRatio: 'Porcentaje de delivery (%)',
    capex: 'Presupuesto de obra + equipo ($)',
    parking: 'Lugares de estacionamiento',
    existingStores: 'Direcciones de tus locales actuales',
    existingStoresHint: 'Una por línea; se usa para medir la canibalización',
    knownCompetitors: 'Competidores directos que conozcas',
    knownCompetitorsHint: 'Nombres separados por coma o salto de línea, hasta 10',
    listingUrls: 'Enlaces del anuncio',
    listingUrlsHint: 'LoopNet / Crexi, etc., uno por línea',
    dayparts: 'Horarios de servicio planeados',
    daypart: { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena', late_night: 'Noche' },
    notes: 'Notas',
    notesHint: 'Cualquier cosa que el analista deba saber',
    save: 'Guardar y volver a generar',
    saving: 'Guardando…',
    saved: 'Guardado; generando de nuevo…',
    failed: 'No se pudo guardar. Inténtalo de nuevo.',
    cancel: 'Cancelar',
    sectionFinance: 'Finanzas',
    sectionCompetition: 'Competencia y ubicación',
  },
};

const inputCls = ui.input;
const coreInputCls = `${ui.input} py-3 text-base`;
const labelCls = ui.label;
const hintCls = ui.hint;

type Props = {
  lang?: Locale;
  reportId: string;
  /** embedded: controlled by the parent (no submit button). standalone: self-saving with a submit button. */
  mode?: 'embedded' | 'standalone';
  value?: PaidIntakeValues;
  onChange?: (next: PaidIntakeValues) => void;
  onSaved?: (inputs: Record<string, unknown>) => void | Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
  className?: string;
  /**
   * When true, only the core group (rent / size / seats) is always visible and
   * the rest of the form sits behind a "more optional details" toggle.
   * Default false: everything is visible (the standalone panel).
   */
  collapsibleExtras?: boolean;
  /** Core fields already supplied earlier (e.g. by the free-analysis form); shown with an "already provided" mark. */
  providedKeys?: readonly PaidIntakeCoreKey[];
};

export function PaidIntakeForm({
  lang = 'en',
  reportId,
  mode = 'embedded',
  value,
  onChange,
  onSaved,
  onCancel,
  disabled,
  className,
  collapsibleExtras = false,
  providedKeys,
}: Props) {
  const t = COPY[lang];
  const [inner, setInner] = useState<PaidIntakeValues>(() => value ?? emptyPaidIntakeValues());
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const v = value ?? inner;

  const set = (patch: Partial<PaidIntakeValues>) => {
    const next = { ...v, ...patch };
    if (onChange) onChange(next);
    else setInner(next);
    if (error) setError(null);
  };
  const setField = (k: keyof Omit<PaidIntakeValues, 'dayparts'>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    set({ [k]: e.target.value } as Partial<PaidIntakeValues>);
  const toggleDaypart = (id: string) =>
    set({ dayparts: v.dayparts.includes(id) ? v.dayparts.filter((d) => d !== id) : [...v.dayparts, id] });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reportId) return;
    setSaving(true);
    setError(null);
    try {
      const r = await submitPaidIntake(reportId, v);
      if (!r.ok) {
        setError(t.failed);
        return;
      }
      setSavedOk(true);
      await onSaved?.(r.inputs ?? {});
    } catch {
      setError(t.failed);
    } finally {
      setSaving(false);
    }
  }

  const busy = Boolean(disabled) || saving;
  const num = (k: keyof Omit<PaidIntakeValues, 'dayparts'>, label: string, placeholder: string) => (
    <div>
      <label className={labelCls} htmlFor={paidIntakeInputId(k)}>
        {label}
      </label>
      <input
        id={paidIntakeInputId(k)}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={v[k]}
        onChange={setField(k)}
        placeholder={placeholder}
        maxLength={20}
        disabled={busy}
        className={inputCls}
      />
    </div>
  );

  // Core field: bigger input, consequence line underneath, "already provided" mark when prefilled upstream.
  const core = (k: PaidIntakeCoreKey, label: string, placeholder: string, hint: string) => {
    const provided = Boolean(providedKeys?.includes(k)) && v[k].trim().length > 0;
    const id = paidIntakeInputId(k);
    return (
      <div className="min-w-0">
        <label className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-semibold text-brand-navy" htmlFor={id}>
          <span>{label}</span>
          {provided ? <span className="text-[11px] font-medium text-brand-pine">{t.alreadyProvided}</span> : null}
        </label>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={v[k]}
          onChange={setField(k)}
          placeholder={placeholder}
          maxLength={20}
          disabled={busy}
          aria-describedby={`${id}-hint`}
          className={coreInputCls}
        />
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-snug text-zinc-500">
          {hint}
        </p>
      </div>
    );
  };

  const coreGroup = (
    <section aria-label={t.sectionCore} className={`${ui.inset} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-brand-navy" aria-hidden />
        <span className={ui.kicker}>{t.sectionCore}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {core('monthly_rent_usd', t.rent, '$12,000', t.rentHint)}
        {core('sqft', t.sqft, '1,800', t.sqftHint)}
        {core('seats', t.seats, '60', t.seatsHint)}
      </div>
    </section>
  );

  const extras = (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">{t.reassurance}</p>

      <div>
        <div className={`mb-2 ${ui.kicker}`}>{t.sectionFinance}</div>
        <div className="grid grid-cols-2 gap-3">
          {num('ticket_in', t.ticketIn, '$24')}
          {num('ticket_delivery', t.ticketDelivery, '$28')}
          {num('delivery_ratio', t.deliveryRatio, '25')}
          {num('capex_usd', t.capex, '$250,000')}
          {num('parking_spaces', t.parking, '12')}
        </div>
      </div>

      <div>
        <div className={`mb-2 ${ui.kicker}`}>{t.sectionCompetition}</div>
        <div className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="intake-known_competitors">
              {t.knownCompetitors}
            </label>
            <textarea
              id="intake-known_competitors"
              rows={2}
              value={v.known_competitors}
              onChange={setField('known_competitors')}
              maxLength={1000}
              disabled={busy}
              className={inputCls}
            />
            <p className={hintCls}>{t.knownCompetitorsHint}</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="intake-existing_stores">
              {t.existingStores}
            </label>
            <textarea
              id="intake-existing_stores"
              rows={2}
              value={v.existing_stores}
              onChange={setField('existing_stores')}
              maxLength={1200}
              disabled={busy}
              className={inputCls}
            />
            <p className={hintCls}>{t.existingStoresHint}</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="intake-listing_urls">
              {t.listingUrls}
            </label>
            <textarea
              id="intake-listing_urls"
              rows={2}
              value={v.listing_urls}
              onChange={setField('listing_urls')}
              maxLength={2600}
              disabled={busy}
              className={inputCls}
              spellCheck={false}
            />
            <p className={hintCls}>{t.listingUrlsHint}</p>
          </div>
          <div>
            <div className={labelCls}>{t.dayparts}</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t.dayparts}>
              {DAYPARTS.map((id) => {
                const on = v.dayparts.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggleDaypart(id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                      on ? 'border-brand-navy bg-brand-navy text-white' : 'border-zinc-300 bg-white text-zinc-600 hover:border-brand-navy'
                    }`}
                  >
                    {t.daypart[id]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="intake-notes">
              {t.notes}
            </label>
            <textarea
              id="intake-notes"
              rows={2}
              value={v.notes}
              onChange={setField('notes')}
              maxLength={1000}
              placeholder={t.notesHint}
              disabled={busy}
              className={inputCls}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const body = (
    <div className={`space-y-4 ${className ?? ''}`}>
      {coreGroup}

      {collapsibleExtras ? (
        <div>
          {/* A bare link in white/60 read as caption text, not a control, so the
              optional fields went unnoticed. It is a full-width bordered row now:
              the border gives it an edge to be clicked, and the chevron sits on
              the right where a disclosure is expected. */}
          <button
            type="button"
            onClick={() => setExtrasOpen((o) => !o)}
            aria-expanded={extrasOpen}
            aria-controls="paid-intake-extras"
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-300 bg-white px-3.5 py-3 text-left text-sm font-medium text-brand-navy transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/20"
          >
            <span>{extrasOpen ? t.moreOptionalHide : t.moreOptional}</span>
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${extrasOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 7.5 10 12.5 15 7.5" />
            </svg>
          </button>
          {extrasOpen ? (
            <div id="paid-intake-extras" className="mt-3 border-t border-zinc-200 pt-4">
              {extras}
            </div>
          ) : null}
        </div>
      ) : (
        extras
      )}

      {error ? (
        <p className="text-sm text-brand-clay" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  if (mode === 'embedded') return body;

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      {body}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !reportId} className={`${ui.btnPrimary} py-2.5`}>
          {saving ? t.saving : t.save}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={saving} className={ui.btnLink}>
            {t.cancel}
          </button>
        ) : null}
        {savedOk && !saving && !error ? <span className="text-xs text-brand-pine">{t.saved}</span> : null}
      </div>
    </form>
  );
}
