'use client';

import type { SiteHistoryPack } from '@/lib/funnel/external-data/site-history';
import type { Locale } from '@/lib/i18n/locale';

type LlmSiteHistory = {
  prior_failures_detected?: boolean | string;
  note?: string;
  prior_business_name?: string;
  prior_business_status?: string;
  review_themes_positive?: string[];
  review_themes_negative?: string[];
  lessons_for_new_operator?: string[];
};

type Props = {
  pack: SiteHistoryPack | null | undefined;
  llm: LlmSiteHistory | null | undefined;
  lang: Locale;
};

const STATUS_COPY: Record<string, { label: Record<Locale, string>; cls: string }> = {
  operational: { label: { zh: '营业中', en: 'Operating', es: 'En operación' }, cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  closed_temporarily: { label: { zh: '暂停营业', en: 'Temporarily closed', es: 'Cerrado temporalmente' }, cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200' },
  closed_permanently: { label: { zh: '已永久关闭', en: 'Permanently closed', es: 'Cerrado permanentemente' }, cls: 'border-rose-500/40 bg-rose-500/10 text-rose-200' },
  unknown: { label: { zh: '状态未知', en: 'Status unknown', es: 'Estado desconocido' }, cls: 'border-zinc-600 bg-zinc-800 text-zinc-300' },
};

const RISK_COPY: Record<string, { label: Record<Locale, string>; cls: string }> = {
  high: { label: { zh: '高风险信号', en: 'High-risk signal', es: 'Señal de riesgo alto' }, cls: 'border-rose-500/40 bg-rose-950/30 text-rose-200' },
  medium: { label: { zh: '中等风险信号', en: 'Medium-risk signal', es: 'Señal de riesgo medio' }, cls: 'border-amber-500/40 bg-amber-950/30 text-amber-200' },
  low: { label: { zh: '低风险信号', en: 'Low-risk signal', es: 'Señal de riesgo bajo' }, cls: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200' },
};

const COPY: Record<
  Locale,
  {
    none: (radius: number) => string;
    reviews: string;
    negative: string;
    positive: string;
    closure: string;
    lessons: string;
    sources: (g: string, y: string, sampled: number, radius: number) => string;
    themeExtraction: string;
  }
> = {
  en: {
    none: (r) => `No Google / Yelp business record found within ${r} m of this address (new construction, non-food use, or a data source is not enabled).`,
    reviews: 'reviews',
    negative: 'Negative review themes',
    positive: 'Positive review themes',
    closure: 'Closure signals',
    lessons: 'Lessons for the new operator',
    sources: (g, y, n, r) => `Sources: Google Places (${g}), Yelp Fusion (${y}) · ${n} reviews sampled · match radius ${r} m`,
    themeExtraction: 'theme extraction',
  },
  zh: {
    none: (r) => `在该地址 ${r} 米范围内未检索到 Google / Yelp 商家记录（可能为新建物业、非餐饮用途或数据源未开通）。`,
    reviews: '条评论',
    negative: '评论中的负面主题',
    positive: '评论中的正面主题',
    closure: '关店 / 失败信号',
    lessons: '对新经营者的启示',
    sources: (g, y, n, r) => `数据来源：Google Places（${g}）、Yelp Fusion（${y}）· 采样评论 ${n} 条 · 匹配半径 ${r} m`,
    themeExtraction: '主题提炼',
  },
  es: {
    none: (r) => `No se encontró ningún registro de negocio en Google / Yelp a ${r} m de esta dirección (construcción nueva, uso no gastronómico o fuente de datos no activada).`,
    reviews: 'reseñas',
    negative: 'Temas negativos en las reseñas',
    positive: 'Temas positivos en las reseñas',
    closure: 'Señales de cierre',
    lessons: 'Lecciones para el nuevo operador',
    sources: (g, y, n, r) => `Fuentes: Google Places (${g}), Yelp Fusion (${y}) · ${n} reseñas muestreadas · radio de coincidencia ${r} m`,
    themeExtraction: 'extracción de temas',
  },
};

function List({ title, items, tone }: { title: string; items: string[]; tone: 'pos' | 'neg' | 'neutral' }) {
  if (!items.length) return null;
  const cls =
    tone === 'pos'
      ? 'border-emerald-500/25 bg-emerald-950/15 text-emerald-100'
      : tone === 'neg'
        ? 'border-rose-500/25 bg-rose-950/15 text-rose-100'
        : 'border-zinc-700/60 bg-zinc-900/40 text-zinc-200';
  return (
    <div className={`rounded-xl border p-4 text-sm leading-relaxed ${cls}`}>
      <div className="mb-1 text-[11px] uppercase tracking-wide opacity-70">{title}</div>
      <ul className="list-disc space-y-1 pl-4">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function SiteHistorySection({ pack, llm, lang }: Props) {
  const t = COPY[lang];
  if (!pack || typeof pack !== 'object') return null;
  const businesses = Array.isArray(pack.businesses) ? pack.businesses : [];
  const a = pack.analysis;

  const negative = llm?.review_themes_negative?.length ? llm.review_themes_negative : a?.negative_themes ?? [];
  const positive = llm?.review_themes_positive?.length ? llm.review_themes_positive : a?.positive_themes ?? [];
  const lessons = llm?.lessons_for_new_operator?.length ? llm.lessons_for_new_operator : a?.lessons_for_new_operator ?? [];
  const closure = a?.closure_signals ?? [];
  // The analysis pack carries zh + en summaries; Spanish readers get the English one.
  const summary = a ? (lang === 'zh' ? a.summary_zh : a.summary_en) : llm?.note;
  const risk = a?.risk_flag ? RISK_COPY[a.risk_flag] : null;

  return (
    <div className="space-y-4">
      {businesses.length === 0 ? (
        <p className="text-sm text-zinc-400">{t.none(pack.match_radius_m)}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {businesses.map((b) => {
            const st = STATUS_COPY[b.status] ?? STATUS_COPY.unknown;
            return (
              <div key={`${b.source}:${b.id}`} className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-100">{b.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>
                    {st.label[lang]}
                  </span>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase text-zinc-400">
                    {b.source}
                  </span>
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {b.rating != null ? `${b.rating}★` : '—'} · {b.review_count ?? '?'} {t.reviews}
                  {b.categories.length ? ` · ${b.categories.slice(0, 3).join(', ')}` : ''}
                  {b.distance_m != null ? ` · ${b.distance_m} m` : ''}
                </div>
                {b.reviews.slice(0, 2).map((r, i) => (
                  <p key={i} className="mt-2 border-l-2 border-zinc-700 pl-3 text-xs leading-relaxed text-zinc-300">
                    <span className="text-zinc-500">{r.rating ?? '?'}★ {r.time}</span> — {r.text.slice(0, 200)}
                    {r.text.length > 200 ? '…' : ''}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {(risk || summary) && (
        <div className={`rounded-xl border p-4 text-sm leading-relaxed ${risk?.cls ?? 'border-zinc-700/60 bg-zinc-900/40 text-zinc-200'}`}>
          {risk ? <div className="mb-1 text-[11px] uppercase tracking-wide opacity-80">{risk.label[lang]}</div> : null}
          {summary ? <p>{summary}</p> : null}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <List title={t.negative} items={negative} tone="neg" />
        <List title={t.positive} items={positive} tone="pos" />
        <List title={t.closure} items={closure} tone="neg" />
        <List title={t.lessons} items={lessons} tone="neutral" />
      </div>

      <div className="text-[10px] text-zinc-500">
        {t.sources(pack.api_status.google, pack.api_status.yelp, pack.total_reviews_sampled, pack.match_radius_m)}
        {a?.provider ? ` · ${t.themeExtraction}: ${a.provider}/${a.model ?? ''}` : ''}
      </div>
    </div>
  );
}
