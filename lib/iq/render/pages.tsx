/**
 * The fifteen /print pages (研发提示词 Phase 5.2 + 总结与建议). Every page has
 * the same fixed structure:
 *   <h1 class="action-title">  — judgment title from model.narrative (LLM) or
 *                                templateNarrative() fallback; never invented here
 *   (Chinese edition only) one-line English subtitle
 *   ONE core chart or table
 *   interpretation (narrative body, citations stripped)
 *   source chips
 * Only report_model fields are shown; null → "n/a" in the report language.
 *
 * Language: the whole document renders in ONE report language (`lang`: en by
 * default, zh or es) — headings, table headers, legends, chips, footnotes,
 * verdict labels and narratives. Labels come from render/i18n.ts; engine
 * strings that reach the page (drivers, conditions, notes) pass through
 * plainText() so no ring ids (walk10), layer codes (L1), field names
 * (coverage_ratio), model names (Huff) or Greek letters reach the reader.
 */
import type { ComponentType, ReactNode } from 'react';
import {
  Calculator,
  Check,
  ClipboardCheck,
  Database,
  FileText,
  Flag,
  Gauge,
  Layers,
  ListChecks,
  MapPin,
  ShieldAlert,
  Store,
  Target,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { LOCALE_TAG, toLocale, type Locale } from '@/lib/i18n/locale';
import type { Competitor, ReportModel } from '../model/schema';
import { PAGES, cuisineName, dimensionName, localizedField, plainText, segmentName, sensitivityName, templateNarrative, type PageId } from '../narrative/templates';
import { SourceChips, type SourceKind } from './chips';
import {
  ClusterCurve,
  CoverageGauge,
  DensityBar,
  HBars,
  PriceLadder,
  RiskMatrix,
  ScoreMeter,
  SegmentBars,
  SensitivityWaterfall,
  SplitBar,
  StackedRingBar,
  Timeline,
  TwinBars,
} from './charts';
import { PALETTE, dataNotes, fmtDate, makeFormatters, nameKey, precheckReasons, probColor, ring, scoreColor, stripCitations, verdictLabel, type Formatters } from './format';
import { fill, strings, type ReportStrings } from './i18n';
import { MapFigure } from './map';
import type { StaticMaps } from './static-map';

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;

/** Props every page receives; `staticMaps` is the optional raster basemap pair resolved server-side (static-map.ts). */
export interface PageProps {
  model: ReportModel;
  staticMaps?: StaticMaps;
  /** Report language; defaults to the model's own language. */
  lang?: Locale;
}

/** Per-render context: the language, its dictionary and its formatters. */
interface Ctx {
  lang: Locale;
  S: ReportStrings;
  F: Formatters;
  /** Engine string → plain words in the report language. */
  t: (s: string | null | undefined) => string;
  /** Bilingual engine field → the report language. */
  field: (zh: string | null | undefined, en: string | null | undefined) => string;
}

function ctxOf(model: ReportModel, lang?: Locale): Ctx {
  const l = lang ?? toLocale(model.meta.language);
  return { lang: l, S: strings(l), F: makeFormatters(l), t: (s) => plainText(s, l), field: (zh, en) => localizedField(zh, en, l) };
}

const PAGE_ICON: Record<PageId, IconType> = {
  page_1: FileText,
  page_2: ClipboardCheck,
  page_3: MapPin,
  page_4: Users,
  page_5: Users,
  page_6: Store,
  page_7: UtensilsCrossed,
  page_8: Layers,
  page_9: Target,
  page_10: Calculator,
  page_11: Gauge,
  page_12: ShieldAlert,
  page_13: ListChecks,
  page_14: Database,
  page_15: Flag,
};

/** Chinese edition keeps a one-line English subtitle under the title; en / es render in one language only. */
const SUBTITLE_EN: Record<PageId, string> = {
  page_1: '360° site-selection report for a Chinese restaurant concept',
  page_2: 'Executive Summary · verdict, evidence, risks and pre-lease conditions',
  page_3: 'Trade Area Map · reach rings, competitors, anchors and rail access',
  page_4: 'Demand Coverage · four-ring profile against the county benchmark',
  page_5: 'Audience · segment share, index and the lunch / dinner split',
  page_6: 'Competitive Landscape · store counts, price ladder and cluster position',
  page_7: 'Direct Competitors · same-cuisine benchmarks against the break-even line',
  page_8: 'Category Gap & Alternatives · gap test and the cuisine ranking',
  page_9: 'Demand Capture · modelled demand by ring, daypart and coverage',
  page_10: 'Financial Model · cost base, break-even, scenarios and sensitivity',
  page_11: 'Cuisine Fit Score · six weighted dimensions and the verdict',
  page_12: 'Risk Register · probability × impact with triggers and hedges',
  page_13: 'Pre-lease Checklist & 90-day Plan · what to settle before signing',
  page_14: 'Method & Sources · data lineage, formulas, parameters and disclaimer',
  page_15: 'Summary · verdict, the three deciding numbers, must-dos and next steps',
};

/** Narratives stored by earlier engine versions counted sources and quoted the report cost; page 14 is a lineage page now. */
const LEGACY_SOURCES_NARRATIVE = /个数据源中|报告成本|数据源状态：|\bD\d+ (ok|partial|failed)\b|\b\d+ (?:of \d+ )?data sources? (?:are |is )?(?:complete|ok)\b|\breport cost\b|\bsource status:|\bcosto del informe\b|\bfuentes? de datos completas?\b/i;

/** Language the stored narrative was written in (loader sets `narrative_language` from narrative_json.__lang). */
export function narrativeLanguage(model: ReportModel): Locale {
  return toLocale(model.meta.narrative_language ?? model.meta.language);
}

/**
 * The page narrative in `lang`: the stored (LLM) narrative when it was written
 * in that language, else the deterministic template for the language.
 */
export function narrativeFor(model: ReportModel, pageId: PageId, lang: Locale = toLocale(model.meta.language)) {
  const n = model.narrative?.[pageId];
  if (n && typeof n.title === 'string' && n.title.trim() && typeof n.body === 'string') {
    if (narrativeLanguage(model) !== lang) return templateNarrative(model, pageId, lang);
    if (pageId === 'page_14' && LEGACY_SOURCES_NARRATIVE.test(`${n.title} ${n.body}`)) return templateNarrative(model, pageId, lang);
    return n;
  }
  return templateNarrative(model, pageId, lang);
}

function PageShell({ c, model, pageId, chips, children, tail }: { c: Ctx; model: ReportModel; pageId: PageId; chips: ReactNode; children: ReactNode; tail?: ReactNode }) {
  const spec = PAGES.find((p) => p.id === pageId)!;
  const n = narrativeFor(model, pageId, c.lang);
  const Icon = PAGE_ICON[pageId];
  const kicker = c.S.pages[pageId];
  const zh = c.lang === 'zh';
  return (
    <section className={`page page-${spec.n}`} data-page={spec.n} aria-label={zh ? `${kicker} · ${spec.en}` : kicker}>
      <header className="page-head">
        <div className="kicker">
          <Icon size={12} strokeWidth={1.75} aria-hidden />
          <span>{zh ? `${kicker} · ${spec.en}` : kicker}</span>
        </div>
        <h1 className="action-title">{c.t(n.title)}</h1>
        {zh ? <p className="subtitle-en">{SUBTITLE_EN[pageId]}</p> : null}
      </header>
      <div className="page-body">{children}</div>
      <div className="page-tail">
        {tail}
        <p className="interp">{stripCitations(c.t(n.body)) || c.S.na}</p>
        {chips}
      </div>
      <footer className="page-foot">
        <span>{model.meta.report_id}</span>
        <span>{model.meta.data_as_of}</span>
        <span className="page-num">
          {spec.n} / {PAGES.length}
        </span>
      </footer>
    </section>
  );
}

function Cell({ children, num, className, na }: { children: ReactNode; num?: boolean; className?: string; na: string }) {
  return <td className={[num ? 'num' : '', className ?? ''].join(' ').trim() || undefined}>{children ?? na}</td>;
}

function VerdictBadge({ c, verdict, size = 'lg' }: { c: Ctx; verdict: ReportModel['score']['verdict']; size?: 'lg' | 'sm' }) {
  const v = verdictLabel(verdict, c.lang);
  return (
    <span className={`verdict-badge verdict-${size}`} data-verdict={verdict}>
      <span className={`verdict-en${v.badge.length > 12 ? ' verdict-long' : ''}`}>{v.badge}</span>
      <span className="verdict-zh">{v.sub}</span>
    </span>
  );
}

function KeyNumber({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="key-number">
      <div className="key-label">{label}</div>
      <div className="key-value">{value}</div>
      {sub ? <div className="key-sub">{sub}</div> : null}
    </div>
  );
}

function XRef({ children }: { children: ReactNode }) {
  return <p className="xref">{children}</p>;
}

/** One line per competitor: Chinese edition shows the Chinese name first with the English smaller; en / es show the listed name. */
function CompetitorName({ c, lang }: { c: Pick<Competitor, 'name' | 'name_zh'>; lang: Locale }) {
  const zh = c.name_zh?.trim();
  const en = c.name.trim();
  if (lang === 'zh' && zh && nameKey(zh) !== nameKey(en)) {
    return (
      <span className="comp-name">
        {zh}
        <span className="comp-name-en">{en}</span>
      </span>
    );
  }
  return <span className="comp-name">{lang === 'zh' ? zh || en : en || zh}</span>;
}

/**
 * Presentation-level dedupe: the same business must never get two cards.
 * Rows sharing a name (either language) collapse into the first one, which
 * inherits a Chinese name from the duplicate when it lacks one.
 */
function uniqueCompetitors(list: Competitor[]): Competitor[] {
  const out: Competitor[] = [];
  const index = new Map<string, number>();
  for (const c of list) {
    const keys = [nameKey(c.name), c.name_zh ? nameKey(c.name_zh) : ''].filter(Boolean);
    const hit = keys.map((k) => index.get(k)).find((i) => i != null);
    if (hit != null) {
      if (!out[hit].name_zh && c.name_zh) out[hit] = { ...out[hit], name_zh: c.name_zh };
      for (const k of keys) index.set(k, hit);
      continue;
    }
    for (const k of keys) index.set(k, out.length);
    out.push(c);
  }
  return out;
}

/** Cuisine label in the report language; the Chinese edition shows "中文 · English". */
function cuisineLabel(c: Ctx, m: ReportModel): string {
  return c.lang === 'zh' ? `${m.input.cuisine_label_zh} · ${m.input.cuisine_label_en}` : cuisineName(m.input, c.lang);
}

/* ------------------------------------------------------------------ */
/* 0 · Cover page (unnumbered title page before the 15 analysis pages)   */
/* ------------------------------------------------------------------ */
function CoverPage({ model, staticMaps, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S } = c;
  const m = model;
  const address = m.input.matched_address ?? m.input.address;
  const region = m.geo.county_name ?? null;
  const cuisine = c.lang === 'zh' ? `${m.input.cuisine_label_zh}（${m.input.cuisine_label_en}）` : cuisineName(m.input, c.lang);
  return (
    <section className="page page-cover" data-page="0" aria-label={c.lang === 'zh' ? '封面 · Cover' : S.cover.title}>
      <div className="cover-page">
        <div className="cover-page-brand">
          <span className="brand-name">{S.brand.name}</span>
          <span className="brand-sub">{S.brand.sub}</span>
        </div>
        <div className="cover-page-title">
          <div className="cover-page-kicker">{m.meta.tier === 'paid' ? S.cover.kickerPaid : S.cover.kickerPrecheck}</div>
          <h2 className="cover-page-h">{S.cover.title}</h2>
          <p className="cover-page-sub">{S.cover.sub}</p>
        </div>
        <div className="cover-page-site">
          <div className="cover-page-address">{address}</div>
          <div className="cover-page-cuisine">
            {fill(S.cover.cuisine, { cuisine })}
            {region ? <span className="muted"> · {region}</span> : null}
          </div>
        </div>
        <div className="cover-page-map">
          <MapFigure model={m} staticMap={staticMaps?.thumb ?? null} variant="thumb" lang={c.lang} />
        </div>
        <div className="cover-page-meta">
          <div>
            <div className="cover-label">{S.cover.reportId}</div>
            <div className="cover-page-meta-v">{m.meta.report_id}</div>
          </div>
          <div>
            <div className="cover-label">{S.cover.generated}</div>
            <div className="cover-page-meta-v">{fmtDate(m.meta.generated_at)}</div>
          </div>
          <div>
            <div className="cover-label">{S.cover.dataAsOf}</div>
            <div className="cover-page-meta-v">{m.meta.data_as_of}</div>
          </div>
          <div>
            <div className="cover-label">{S.cover.preparedBy}</div>
            <div className="cover-page-meta-v">{S.brand.engine}</div>
          </div>
        </div>
        <p className="cover-page-foot">{S.cover.foot}</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · At a glance                                                       */
/* ------------------------------------------------------------------ */
function Page1({ model, staticMaps, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  return (
    <PageShell c={c} model={m} pageId="page_1" chips={<SourceChips model={m} ids={['D1', 'D12']} model_labels={[S.p1.chipScore]} lang={c.lang} />}>
      <div className="cover">
        <div className="cover-brand">
          <span className="brand-name">{S.brand.name}</span>
          <span className="brand-sub">{S.brand.reportSub}</span>
        </div>
        <div className="cover-grid">
          <div className="cover-left">
            <div className="cover-field">
              <div className="cover-label">{S.p1.address}</div>
              <div className="cover-value">{m.input.matched_address ?? m.input.address}</div>
              {m.input.matched_address && m.input.matched_address !== m.input.address ? <div className="cover-note">{fill(S.p1.addressGiven, { address: m.input.address })}</div> : null}
            </div>
            <div className="cover-field">
              <div className="cover-label">{S.p1.cuisine}</div>
              <div className="cover-value">
                {cuisineLabel(c, m)}
                <span className="muted"> · {S.rangeClass[m.input.range_class]}</span>
              </div>
            </div>
            <div className="cover-verdict">
              <VerdictBadge c={c} verdict={m.score.verdict} />
              <div className="cover-keys">
                <KeyNumber label={S.p1.score} value={`${F.num(m.score.total, 1)} / 100`} />
                <KeyNumber label={S.p1.completeness} value={`${F.int(m.confidence.total)} / 100`} sub={S.level[m.confidence.level]} />
              </div>
            </div>
          </div>
          <div className="cover-right">
            <table className="meta-table">
              <tbody>
                <tr>
                  <th>{S.p1.reportId}</th>
                  <Cell na={S.na}>{m.meta.report_id}</Cell>
                </tr>
                <tr>
                  <th>{S.p1.generated}</th>
                  <Cell na={S.na}>{fmtDate(m.meta.generated_at)}</Cell>
                </tr>
                <tr>
                  <th>{S.p1.dataAsOf}</th>
                  <Cell na={S.na}>{m.meta.data_as_of}</Cell>
                </tr>
                <tr>
                  <th>{S.p1.edition}</th>
                  <Cell na={S.na}>{m.meta.tier === 'paid' ? S.p1.editionPaid : S.p1.editionPrecheck}</Cell>
                </tr>
                <tr>
                  <th>{S.p1.region}</th>
                  <Cell na={S.na}>
                    {m.geo.county_name ?? m.geo.county}
                    {m.geo.metro ? ` · ${m.geo.metro}` : ''}
                  </Cell>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="cover-map">
          <MapFigure model={m} staticMap={staticMaps?.thumb ?? null} variant="thumb" lang={c.lang} />
        </div>
        <div className="cover-map-caption">{fill(S.p1.caption, { ring: S.ring[m.trade_area.primary_ring].label, l1: m.competitors.l1.length, l4: m.competitors.l4.length })}</div>
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Executive summary                                                 */
/* ------------------------------------------------------------------ */
function Page2({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const reasons = [...m.score.dimensions].sort((a, b) => b.score - a.score).slice(0, 3);
  const probRank = { high: 0, medium: 1, low: 2 } as const;
  const risks = [...m.risks].sort((a, b) => probRank[a.prob] - probRank[b.prob] || (b.impact_usd ?? 0) - (a.impact_usd ?? 0)).slice(0, 3);
  const conds = m.score.conditions.slice(0, 3);
  // No rent provided → break-even and coverage are ex-rent and every label says so.
  const noRent = m.finance.rent_excluded;
  const xr = noRent ? S.exRent : '';
  return (
    <PageShell c={c} model={m} pageId="page_2" chips={<SourceChips model={m} ids={['D2', 'D5', 'D6', 'D12']} model_labels={[S.p2.chipHuff, S.p2.chipBreakeven]} lang={c.lang} />}>
      <div className="summary-top">
        <VerdictBadge c={c} verdict={m.score.verdict} />
        <div className="summary-keys">
          <KeyNumber label={S.p2.score} value={`${F.num(m.score.total, 1)}`} sub={S.p2.scoreSub} />
          <KeyNumber label={`${S.p2.coverage}${xr}`} value={F.pct(m.demand.coverage_ratio)} sub={`${S.p2.coverageSub}${xr}`} />
          <KeyNumber label={S.p2.completeness} value={`${F.int(m.confidence.total)}`} sub={fill(S.p2.completenessSub, { level: S.level[m.confidence.level] })} />
        </div>
      </div>
      <div className="twin-wrap">
        <h2 className="h2">{S.p2.chart}</h2>
        <TwinBars breakeven={m.finance.breakeven_monthly} captured={m.demand.captured_monthly_usd} safety={m.finance.safety_monthly} lang={c.lang} exRent={noRent} />
      </div>
      <div className="three-col">
        <div className="panel">
          <div className="panel-title">{S.p2.evidence}</div>
          <ol className="tight-list">
            {reasons.map((d) => (
              <li key={d.id}>
                <span className="li-head">
                  {dimensionName(d, c.lang)} {fill(S.p2.points, { n: F.num(d.score, 0) })}
                </span>
                <span className="li-body">{c.t(d.drivers[0]) || S.na}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title">{S.p2.risks}</div>
          <ol className="tight-list">
            {risks.length === 0 ? <li>{S.na}</li> : null}
            {risks.map((r) => (
              <li key={r.id}>
                <span className="dot" style={{ background: probColor(r.prob) }} />
                <span className="li-body">
                  {c.field(r.risk_zh, r.risk_en)}
                  <span className="muted"> {fill(S.p2.probability, { p: S.prob[r.prob] })}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title">{S.p2.conditions}</div>
          <ol className="tight-list">
            {conds.length === 0 ? <li>{S.p2.noConditions}</li> : null}
            {conds.map((x, i) => (
              <li key={i}>
                <span className="li-body">{c.field(x.text_zh, x.text_en)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <XRef>{fill(S.p2.xref, { ring: S.ring[m.trade_area.primary_ring].label, l1: m.competitors.l1.length, l2: m.competitors.l2_count, be: F.usd(m.finance.breakeven_monthly), exRent: xr })}</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Trade-area map                                                    */
/* ------------------------------------------------------------------ */
function Page3({ model, staticMaps, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const p = ring(m, m.trade_area.primary_ring);
  const cc = m.competitors;
  return (
    <PageShell c={c} model={m} pageId="page_3" chips={<SourceChips model={m} ids={['D4', 'D5', 'D6', 'D9']} lang={c.lang} />}>
      <div className="map-wrap">
        <MapFigure model={m} staticMap={staticMaps?.hero ?? null} variant="hero" lang={c.lang} />
      </div>
      <div className="map-facts">
        <KeyNumber label={S.p3.primary} value={S.ring[m.trade_area.primary_ring].label} sub={fill(S.p3.primarySub, { area: F.num(p?.area_sq_mi, 2), bg: p?.block_groups ?? 0 })} />
        <KeyNumber label={S.p3.method} value={m.trade_area.isochrone_method === 'mapbox' ? S.p3.methodMapbox : S.p3.methodRadius} sub={S.p3.methodSub} />
        <KeyNumber label={S.p3.places} value={F.int(cc.candidates_total)} sub={fill(S.p3.placesSub, { l1: cc.l1.length, l2: cc.l2_count, l3: cc.l3_count, l4: cc.l4.length })} />
      </div>
      <XRef>{S.p3.xref}</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Ring table                                                        */
/* ------------------------------------------------------------------ */
function Page4({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const rings = m.trade_area.rings;
  const cb = m.trade_area.county_benchmark;
  const NOT_APPLICABLE = S.notApplicable;
  const R = S.p4.rows;
  const zh = c.lang === 'zh';
  const cuisine = zh ? m.input.cuisine_label_zh : cuisineName(m.input, c.lang);
  const rows: Array<{ key: string; label: string; en: string; get: (r: ReportModel['trade_area']['rings'][number]) => string; county: string }> = [
    { key: 'pop', label: R.pop, en: 'Population', get: (r) => F.int(r.pop), county: NOT_APPLICABLE },
    { key: 'hh', label: R.hh, en: 'Households', get: (r) => F.int(r.hh), county: NOT_APPLICABLE },
    { key: 'income', label: R.income, en: 'Median HH income', get: (r) => F.usd(r.median_income), county: F.usd(cb.median_income) },
    { key: 'chinese_share', label: R.chinese_share, en: 'Chinese-speaking HH', get: (r) => F.pct(r.chinese_hh_share, 1), county: F.pct(cb.chinese_hh_share, 1) },
    { key: 'chinese_pop', label: R.chinese_pop, en: 'Chinese population', get: (r) => F.int(r.chinese_pop), county: NOT_APPLICABLE },
    { key: 'jobs', label: R.jobs, en: 'Daytime jobs', get: (r) => F.int(r.jobs), county: NOT_APPLICABLE },
    { key: 'spend', label: R.spend, en: 'Restaurant spend / yr', get: (r) => F.usd(r.restaurant_spend_usd), county: NOT_APPLICABLE },
    { key: 'chinese_spend', label: R.chinese_spend, en: 'Chinese-food spend / yr', get: (r) => F.usd(r.chinese_spend_usd), county: NOT_APPLICABLE },
    { key: 'cuisine_demand', label: fill(R.cuisine_demand, { cuisine }), en: 'Cuisine demand / yr', get: (r) => F.usd(r.cuisine_demand_usd), county: NOT_APPLICABLE },
    { key: 'age', label: R.age, en: 'Age 25–44', get: (r) => F.pct(r.age_25_44_share, 1), county: NOT_APPLICABLE },
    { key: 'family', label: R.family, en: 'Families w/ children', get: (r) => F.pct(r.family_share, 1), county: NOT_APPLICABLE },
    { key: 'area', label: R.area, en: 'Area (sq mi)', get: (r) => F.num(r.area_sq_mi, 2), county: NOT_APPLICABLE },
  ];
  const jobsMethod = rings.find((r) => r.jobs_method !== 'none')?.jobs_method;
  const jobsMethodText = jobsMethod === 'lodes_wac' ? S.p4.jobsLodes : jobsMethod === 'acs_b08301_estimate' ? S.p4.jobsAcs : S.na;
  return (
    <PageShell c={c} model={m} pageId="page_4" chips={<SourceChips model={m} ids={['D2', 'D3', 'D10']} model_labels={[fill(S.p4.chipShare, { pct: F.pct(m.demand.cuisine_share, 1) })]} lang={c.lang} />}>
      <table className="data-table ring-table">
        <thead>
          <tr>
            <th className="row-head">{S.p4.metric}</th>
            {rings.map((r) => (
              <th key={r.id} className={r.id === m.trade_area.primary_ring ? 'primary' : undefined}>
                {zh ? S.ring[r.id].label : S.ring[r.id].short}
                <span className="th-en">
                  {zh ? `${r.id === 'walk10' ? 'walk' : 'drive'} ${r.minutes}` : ''}
                  {r.id === m.trade_area.primary_ring ? `${zh ? ' · ' : ''}${S.p4.primaryTag}` : zh ? '' : ' '}
                </span>
              </th>
            ))}
            <th className="county">
              {S.p4.county}
              <span className="th-en">{m.geo.county_name ?? m.geo.county}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th className="row-head">
                {row.label}
                {zh ? <span className="th-en">{row.en}</span> : null}
              </th>
              {rings.map((r) => (
                <Cell key={r.id} num className={r.id === m.trade_area.primary_ring ? 'primary' : undefined} na={S.na}>
                  {row.get(r)}
                </Cell>
              ))}
              <Cell num className="county" na={S.na}>
                {row.county}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">{fill(S.p4.note, { jobs: jobsMethodText })}</p>
      <XRef>{S.p4.xref}</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Audience                                                          */
/* ------------------------------------------------------------------ */
function Page5({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const segs = m.audience.segments.map((s) => ({ ...s, label: segmentName(s.id, c.lang) }));
  const [lunch, dinner] = m.audience.lunch_dinner_split;
  return (
    <PageShell c={c} model={m} pageId="page_5" chips={<SourceChips model={m} ids={['D2', 'D3']} model_labels={[S.p5.chipIndex, S.p5.chipSplit]} lang={c.lang} />}>
      <h2 className="h2">{S.p5.segments}</h2>
      <SegmentBars rows={segs.map((s) => ({ label: s.label, share: s.share, index: s.index }))} lang={c.lang} />
      <div className="two-col">
        <div>
          <h2 className="h2">{S.p5.daypart}</h2>
          <SplitBar a={lunch} b={dinner} labelA={S.p5.lunch} labelB={S.p5.dinner} valueA={S.p5.lunchSub} valueB={S.p5.dinnerSub} />
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>{S.p5.jobsWalk}</th>
                <Cell num na={S.na}>{F.int(ring(m, 'walk10')?.jobs)}</Cell>
              </tr>
              <tr>
                <th>{S.p5.hhSize}</th>
                <Cell num na={S.na}>{F.num(ring(m, m.trade_area.primary_ring)?.avg_hh_size, 2)}</Cell>
              </tr>
              <tr>
                <th>{S.p5.renters}</th>
                <Cell num na={S.na}>{F.pct(ring(m, m.trade_area.primary_ring)?.renter_share, 1)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">{S.p5.basis}</h2>
          <table className="data-table compact">
            <tbody>
              {segs.map((s) => (
                <tr key={s.id}>
                  <th>
                    {s.label}
                    {c.lang === 'zh' ? <span className="th-en">{segmentName(s.id, 'en')}</span> : null}
                  </th>
                  <Cell na={S.na}>{c.t(s.basis)}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <XRef>{S.p5.xref}</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Competitive landscape                                             */
/* ------------------------------------------------------------------ */
function Page6({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const cc = model.competitors;
  const cuisine = c.lang === 'zh' ? model.input.cuisine_label_zh : cuisineName(model.input, c.lang);
  const na = S.na;
  return (
    <PageShell c={c} model={model} pageId="page_6" chips={<SourceChips model={model} ids={['D5', 'D6', 'D7']} model_labels={[S.p6.chipCluster]} lang={c.lang} />}>
      <div className="two-col">
        <div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{S.p6.group}</th>
                <th className="num">{S.p6.count}</th>
                <th>{S.p6.note}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{S.p6.l1}</th>
                <Cell num na={na}>{F.int(cc.l1.length)}</Cell>
                <Cell na={na}>{fill(S.p6.l1Note, { cuisine })}</Cell>
              </tr>
              <tr>
                <th>{S.p6.l2}</th>
                <Cell num na={na}>{F.int(cc.l2_count)}</Cell>
                <Cell na={na}>{S.p6.l2Note}</Cell>
              </tr>
              <tr>
                <th>{S.p6.l3}</th>
                <Cell num na={na}>{F.int(cc.l3_count)}</Cell>
                <Cell na={na}>{S.p6.l3Note}</Cell>
              </tr>
              <tr>
                <th>{S.p6.l4}</th>
                <Cell num na={na}>{F.int(cc.l4.length)}</Cell>
                <Cell na={na}>{S.p6.l4Note}</Cell>
              </tr>
              <tr>
                <th>{S.p6.walk10}</th>
                <Cell num na={na}>{F.int(cc.walk10_l1_l2_count)}</Cell>
                <Cell na={na}>{S.p6.walk10Note}</Cell>
              </tr>
              <tr>
                <th>{S.p6.perResidents}</th>
                <Cell num na={na}>{F.num(cc.density_per_10k_residents, 1)}</Cell>
                <Cell na={na}>{S.p6.perResidentsNote}</Cell>
              </tr>
              <tr>
                <th>{S.p6.perChinese}</th>
                <Cell num na={na}>{F.num(cc.density_per_10k_chinese, 1)}</Cell>
                <Cell na={na}>{S.p6.perChineseNote}</Cell>
              </tr>
              <tr>
                <th>{S.p6.hhi}</th>
                <Cell num na={na}>{F.num(cc.hhi, 3)}</Cell>
                <Cell na={na}>{S.p6.hhiNote}</Cell>
              </tr>
              <tr>
                <th>{S.p6.rating}</th>
                <Cell num na={na}>
                  {F.num(cc.avg_rating_l1, 1)} / {F.num(cc.weighted_rating_l1, 2)}
                </Cell>
                <Cell na={na}>{S.p6.ratingNote}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">{S.p6.ladder}</h2>
          <PriceLadder ladder={cc.price_ladder} lang={c.lang} />
          <div className="key-row">
            <KeyNumber label={S.p6.closure} value={F.pct(cc.closure_rate, 1)} sub={S.p6.closureSub} />
            <KeyNumber label={S.p6.cluster} value={F.num(cc.cluster_score, 0)} sub={S.p6.clusterSub} />
          </div>
        </div>
      </div>
      <h2 className="h2">{S.p6.curve}</h2>
      <ClusterCurve walk10Count={cc.walk10_l1_l2_count} clusterScore={cc.cluster_score} lang={c.lang} />
      {!cc.guard_passed ? <p className="table-note">{fill(S.p6.guard, { notes: cc.guard_notes.map(c.t).join(c.lang === 'zh' ? '；' : '; ') || na })}</p> : null}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · Competitor cards                                                  */
/* ------------------------------------------------------------------ */
function Page7({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const na = S.na;
  const sorted = [...m.competitors.l1].sort((a, b) => (b.huff_share ?? 0) - (a.huff_share ?? 0) || a.distance_mi - b.distance_mi);
  const cards = uniqueCompetitors(sorted).slice(0, 8);
  const b = m.competitors.benchmark_revenue_band;
  const be = m.finance.breakeven_monthly;
  const cuisine = c.lang === 'zh' ? m.input.cuisine_label_zh : cuisineName(m.input, c.lang);
  const bandRows = [
    { label: S.p7.bandLow, value: b.p25 },
    { label: S.p7.bandMedian, value: b.median },
    { label: S.p7.bandHigh, value: b.p75 },
    { label: m.finance.rent_excluded ? S.p7.bandBreakevenNoRent : S.p7.bandBreakeven, value: be, color: PALETTE.coral },
  ];
  const tierLabel = (t: number | null) => (t == null ? na : fill(S.p7.tierValue, { n: t }));
  const near = m.competitors.l1_nearest_outside_pool;
  return (
    <PageShell c={c} model={m} pageId="page_7" chips={<SourceChips model={m} ids={['D5', 'D6', 'D7']} model_labels={[S.p7.chipShare]} lang={c.lang} />}>
      <div className="cards-grid">
        {cards.length === 0 ? (
          m.competitors.guard_passed ? (
            <div className="panel void-panel">
              <div className="panel-title">{S.p7.voidTitle}</div>
              <p>
                {fill(S.p7.voidBody, { cuisine, radius: m.competitors.pool_radius_mi ?? 5 })}
                {near ? fill(S.p7.voidNearest, { name: near.name, dist: F.miles(near.distance_mi) }) : null}
                {S.p7.voidTail}
              </p>
            </div>
          ) : (
            <div className="panel">{fill(S.p7.noData, { na })}</div>
          )
        ) : null}
        {cards.map((x, i) => (
          <div className="comp-card" key={x.id}>
            <div className="comp-head">
              <span className="comp-rank">{i + 1}</span>
              <CompetitorName c={x} lang={c.lang} />
              {x.is_chain ? <span className="tag">{S.p7.chain}</span> : null}
            </div>
            <dl className="comp-facts">
              <dt>{S.p7.distance}</dt>
              <dd className="num">{F.miles(x.distance_mi)}</dd>
              <dt>{S.p7.drive}</dt>
              <dd className="num">{F.minutes(x.drive_min)}</dd>
              <dt>{S.p7.rating}</dt>
              <dd className="num">{F.num(x.rating, 1)}</dd>
              <dt>{S.p7.reviews}</dt>
              <dd className="num">{F.int(x.rating_count)}</dd>
              <dt>{S.p7.price}</dt>
              <dd className="num">{F.price(x.price_level)}</dd>
              <dt>{S.p7.tier}</dt>
              <dd className="num">{tierLabel(x.traffic_tier)}</dd>
              <dt>{S.p7.hours}</dt>
              <dd className="num">{x.hours_per_week == null ? na : fill(S.p7.hoursValue, { n: F.int(x.hours_per_week) })}</dd>
              <dt>{S.p7.share}</dt>
              <dd className="num">{F.pct(x.huff_share, 1)}</dd>
              <dt>{S.p7.growth}</dt>
              <dd className="num">{F.int(x.monthly_review_growth)}</dd>
              <dt>{S.p7.delivery}</dt>
              <dd>{x.offers_delivery == null ? na : x.offers_delivery ? S.p7.yes : S.p7.no}</dd>
            </dl>
          </div>
        ))}
      </div>
      <h2 className="h2">{S.p7.band}</h2>
      <HBars rows={bandRows} valueLabel={(v) => F.usd(v)} labelWidth={c.lang === 'zh' ? 110 : 150} valueWidth={90} height={16} gap={6} />
      <p className="table-note">{fill(S.p7.bandNote, { method: S.bandMethod[b.method] ?? c.t(b.method), onlyBreakeven: b.median == null ? S.p7.bandOnlyBreakeven : '' })}</p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · Void analysis + alternatives                                      */
/* ------------------------------------------------------------------ */
function Page8({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const v = m.competitors.void;
  const alts = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
  const mine = m.score.alternatives.find((a) => a.cuisine === m.input.cuisine);
  const conds = [
    { ok: v.conditions.chinese_pop_ok, label: S.p8.condPop, en: 'Chinese population' },
    { ok: v.conditions.density_ok, label: S.p8.condDensity, en: 'Density vs hub median' },
    { ok: v.conditions.l2_ok, label: S.p8.condL2, en: 'Other Chinese supply present' },
  ];
  const rankOf = (cuisine: string) => m.score.alternatives.findIndex((a) => a.cuisine === cuisine) + 1;
  const zh = c.lang === 'zh';
  const altName = (a: ReportModel['score']['alternatives'][number]) => cuisineName(a, c.lang);
  return (
    <PageShell c={c} model={m} pageId="page_8" chips={<SourceChips model={m} ids={['D2', 'D5']} model_labels={[S.p8.chipGap, S.p8.chipAlt]} lang={c.lang} />}>
      <div className="two-col">
        <div>
          <h2 className="h2">{S.p8.density}</h2>
          <DensityBar density={m.competitors.density_per_10k_chinese} ratioVsHub={v.density_vs_hub_median} lang={c.lang} />
          <p className="table-note">{fill(S.p8.densityNote, { ratio: F.multi(v.density_vs_hub_median), n: F.int(m.competitors.metro_sub_cuisine_total) })}</p>
        </div>
        <div>
          <h2 className="h2">{S.p8.gap}</h2>
          <ul className="check-list">
            {conds.map((x) => (
              <li key={x.en} className={x.ok ? 'ok' : 'fail'}>
                {x.ok ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <X size={14} strokeWidth={2.5} aria-hidden />}
                <span>
                  {x.label} {zh ? <span className="muted">{x.en}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="verdict-line">
            {S.p8.conclusion}
            <strong>{v.is_void ? S.p8.isVoid : S.p8.notVoid}</strong>
            <span className="muted"> · {c.t(v.reason)}</span>
          </div>
        </div>
      </div>
      <h2 className="h2">{S.p8.alternatives}</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th className="num">{S.p8.rank}</th>
            <th>{S.p8.cuisine}</th>
            <th className="num">{S.p8.score}</th>
            <th>{S.p8.verdict}</th>
          </tr>
        </thead>
        <tbody>
          {alts.map((a) => (
            <tr key={a.cuisine}>
              <Cell num na={S.na}>{rankOf(a.cuisine)}</Cell>
              <Cell na={S.na}>
                {altName(a)} {zh ? <span className="muted">{a.label_en}</span> : null}
              </Cell>
              <Cell num na={S.na}>{F.num(a.total, 1)}</Cell>
              <Cell na={S.na}>{verdictLabel(a.verdict, c.lang).label}</Cell>
            </tr>
          ))}
          <tr className="highlight">
            <Cell num na={S.na}>{F.int(m.score.user_cuisine_rank)}</Cell>
            <Cell na={S.na}>
              {zh ? m.input.cuisine_label_zh : cuisineName(m.input, c.lang)} <span className="muted">{zh ? `${m.input.cuisine_label_en} · ` : ''}{S.p8.yours}</span>
            </Cell>
            <Cell num na={S.na}>{F.num(mine?.total ?? m.score.total, 1)}</Cell>
            <Cell na={S.na}>{verdictLabel(mine?.verdict ?? m.score.verdict, c.lang).label}</Cell>
          </tr>
        </tbody>
      </table>
      <XRef>{fill(S.p8.xref, { n: m.score.alternatives.length })}</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 9 · Demand capture                                                    */
/* ------------------------------------------------------------------ */
function Page9({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const d = model.demand;
  const parts = d.by_ring.map((r) => ({ label: S.ring[r.ring].short, value: r.monthly_usd, share: r.share }));
  return (
    <PageShell c={c} model={model} pageId="page_9" chips={<SourceChips model={model} ids={['D2', 'D10', 'D5', 'D6']} model_labels={[S.p9.chipHuff]} lang={c.lang} />}>
      <h2 className="h2">{S.p9.byRing}</h2>
      {parts.length ? <StackedRingBar parts={parts} total={d.captured_monthly_usd} lang={c.lang} /> : <p className="table-note">{S.na}</p>}
      <div className="two-col">
        <div>
          <h2 className="h2">{S.p9.daypart}</h2>
          <SplitBar a={d.lunch_usd ?? 0} b={d.dinner_usd ?? 0} labelA={S.p9.lunch} labelB={S.p9.dinner} valueA={F.usd(d.lunch_usd)} valueB={F.usd(d.dinner_usd)} />
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>{S.p9.captured}</th>
                <Cell num na={S.na}>{F.usd(d.captured_monthly_usd)}</Cell>
              </tr>
              <tr>
                <th>{S.p9.covers}</th>
                <Cell num na={S.na}>{F.int(d.captured_covers_day)}</Cell>
              </tr>
              <tr>
                <th>{S.p9.share}</th>
                <Cell num na={S.na}>{F.pct(d.cuisine_share, 1)}</Cell>
              </tr>
              <tr>
                <th>{S.p9.params}</th>
                <Cell num na={S.na}>
                  {F.num(d.huff.alpha, 2)} / {F.num(d.huff.beta, 2)}
                </Cell>
              </tr>
              <tr>
                <th>{S.p9.attractiveness}</th>
                <Cell num na={S.na}>{F.num(d.huff.site_attractiveness, 2)}</Cell>
              </tr>
              <tr>
                <th>{S.p9.competitors}</th>
                <Cell num na={S.na}>{F.int(d.huff.competitor_set)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">
            {S.p9.coverage}
            {model.finance.rent_excluded ? S.exRent : ''}
          </h2>
          <CoverageGauge ratio={d.coverage_ratio} lang={c.lang} exRent={model.finance.rent_excluded} />
        </div>
      </div>
      <XRef>{S.p9.xref}</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 10 · Finance                                                          */
/* ------------------------------------------------------------------ */
function Page10({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const f = model.finance;
  const fc = f.fixed_cost;
  const base = f.scenarios.find((s) => s.id === 'base');
  const costRows: Array<[string, string, number | null]> = [
    ['rent', S.p10.rent, fc.rent],
    ['labor', S.p10.labor, fc.labor],
    ['utilities', S.p10.utilities, fc.utilities],
    ['insurance', S.p10.insurance, fc.insurance],
    ['pos', S.p10.pos, fc.pos],
    ['marketing', S.p10.marketing, fc.marketing],
    ['misc', S.p10.misc, fc.misc],
  ];
  const zh = c.lang === 'zh';
  // No rent provided: the rent row says so (never a number), every total / break-even /
  // safety / coverage label carries the ex-rent suffix, and the rent ceiling replaces the guess.
  const noRent = f.rent_excluded;
  const xr = noRent ? S.exRent : '';
  return (
    <PageShell c={c} model={model} pageId="page_10" chips={<SourceChips model={model} ids={['D12', 'D8']} model_labels={[S.p10.chipBreakeven, S.p10.chipSensitivity]} lang={c.lang} />}>
      <div className="two-col">
        <div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{S.p10.fixed}</th>
                <th className="num">{S.p10.usd}</th>
              </tr>
            </thead>
            <tbody>
              {costRows.map(([key, label, v]) =>
                key === 'rent' && noRent ? (
                  // No rent provided: the row carries the message across the table, never a number.
                  <tr key={key}>
                    <th colSpan={2}>
                      {label}
                      <span className="muted"> · {S.p10.rentNotProvided}</span>
                    </th>
                  </tr>
                ) : (
                  <tr key={key}>
                    <th>
                      {label}
                      {key === 'rent' ? <span className="muted"> · {f.rent_source === 'user_input' ? S.p10.yourInput : c.t(f.rent_source)}</span> : null}
                    </th>
                    <Cell num na={S.na}>{F.usd(v)}</Cell>
                  </tr>
                ),
              )}
              <tr className="total">
                <th>
                  {S.p10.total}
                  {xr}
                </th>
                <Cell num na={S.na}>{F.usd(fc.total)}</Cell>
              </tr>
              <tr>
                <th>{S.p10.margin}</th>
                <Cell num na={S.na}>{F.pct(f.contribution_margin, 1)}</Cell>
              </tr>
              {/* rent ÷ revenue has no meaning without a rent; the rent ceiling key number stands in for it */}
              {noRent ? null : (
                <tr>
                  <th>{S.p10.occupancy}</th>
                  <Cell num na={S.na}>{F.pct(f.occupancy_cost_ratio, 1)}</Cell>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <div className="key-row">
            <KeyNumber label={noRent ? S.p10.breakevenNoRent : S.p10.breakeven} value={F.usd(f.breakeven_monthly)} sub={S.p10.breakevenSub} />
            <KeyNumber label={noRent ? S.p10.safetyNoRent : S.p10.safety} value={F.usd(f.safety_monthly)} sub={S.p10.safetySub} />
          </div>
          {noRent ? <KeyNumber label={S.p10.maxRent} value={F.usd(f.max_rent_for_10pct_usd)} sub={S.p10.maxRentSub} /> : null}
          {f.payback_months != null ? <KeyNumber label={S.p10.payback} value={fill(S.p10.paybackValue, { n: F.int(f.payback_months) })} sub={fill(S.p10.paybackSub, { capex: F.usd(model.input.capex_usd) })} /> : null}
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>{S.p10.inputs}</th>
                <Cell num na={S.na}>{fill(S.p10.inputsValue, { rent: F.usd(model.input.rent_usd), sqft: F.int(model.input.sqft), seats: F.int(model.input.seats) })}</Cell>
              </tr>
              <tr>
                <th>{S.p10.ticket}</th>
                <Cell num na={S.na}>
                  {F.usd(model.input.ticket_in)} / {F.usd(model.input.ticket_delivery)}
                </Cell>
              </tr>
              <tr>
                <th>{S.p10.deliveryRatio}</th>
                <Cell num na={S.na}>{F.pct(model.input.delivery_ratio)}</Cell>
              </tr>
              <tr>
                <th>{S.p10.variable}</th>
                <Cell num na={S.na}>{F.pct(f.variable_rate, 1)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <table className="data-table scenarios">
        <thead>
          <tr>
            <th>{S.p10.scenario}</th>
            <th className="num">{S.p10.seats}</th>
            <th className="num">{S.p10.turns}</th>
            <th className="num">{S.p10.dineIn}</th>
            <th className="num">{S.p10.deliveryOrders}</th>
            <th className="num">{S.p10.orders}</th>
            <th className="num">{S.p10.ticketCol}</th>
            <th className="num">{S.p10.revenue}</th>
            <th className="num">
              {S.p10.vsBreakeven}
              {noRent ? S.exRentShort : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {f.scenarios.map((s) => (
            <tr key={s.id} className={s.id === 'base' ? 'highlight' : undefined}>
              <th>
                {S.scenario[s.id]} {zh ? <span className="muted">{strings('en').scenario[s.id]}</span> : null}
              </th>
              <Cell num na={S.na}>{F.int(s.seats)}</Cell>
              <Cell num na={S.na}>{F.num(s.turns_per_day, 1)}</Cell>
              <Cell num na={S.na}>{F.int(s.dine_in_covers_day)}</Cell>
              <Cell num na={S.na}>{F.num(s.delivery_orders_day, 1)}</Cell>
              <Cell num na={S.na}>{F.num(s.orders_day, 1)}</Cell>
              <Cell num na={S.na}>
                ${F.num(s.ticket_in, 1)} / ${F.num(s.ticket_delivery, 1)}
              </Cell>
              <Cell num na={S.na}>{F.usd(s.monthly_revenue)}</Cell>
              <Cell num className={s.vs_breakeven == null ? undefined : s.vs_breakeven >= 1 ? 'ink-green' : 'ink-red'} na={S.na}>
                {F.multi(s.vs_breakeven)}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="h2">{S.p10.sensitivity}</h2>
      <div className="waterfall-wrap">
        <SensitivityWaterfall base={base?.monthly_revenue ?? null} breakeven={f.breakeven_monthly} items={f.sensitivity.map((s) => ({ label: sensitivityName(s, c.lang), delta: s.monthly_revenue_delta, breaks: s.breaks_breakeven }))} lang={c.lang} exRent={noRent} />
      </div>
      <p className="table-note">
        {fill(S.p10.note, { method: c.t(f.method) })}
        {f.payback_months == null ? S.p10.noCapex : ''}
      </p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 11 · Six-dimension score                                              */
/* ------------------------------------------------------------------ */
function Page11({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const s = model.score;
  const weightSum = s.dimensions.reduce((a, d) => a + d.weight, 0);
  const zh = c.lang === 'zh';
  const sep = zh ? '；' : '; ';
  return (
    <PageShell c={c} model={model} pageId="page_11" chips={<SourceChips model={model} ids={[]} model_labels={[S.p11.chipScore, S.p11.chipThreshold]} lang={c.lang} />}>
      <table className="data-table score-table">
        <thead>
          <tr>
            <th>{S.p11.dimension}</th>
            <th className="num">{S.p11.score}</th>
            <th>{S.p11.meter}</th>
            <th className="num">{S.p11.weight}</th>
            <th className="num">{S.p11.weighted}</th>
            <th>{S.p11.drivers}</th>
          </tr>
        </thead>
        <tbody>
          {s.dimensions.map((d) => (
            <tr key={d.id}>
              <th>
                {dimensionName(d, c.lang)}
                {zh ? <span className="th-en">{d.label_en}</span> : null}
              </th>
              <Cell num na={S.na}>{F.num(d.score, 1)}</Cell>
              <td>
                <ScoreMeter score={d.score} lang={c.lang} />
              </td>
              <Cell num na={S.na}>{F.int(d.weight)}%</Cell>
              <Cell num na={S.na}>{F.num(d.weighted, 2)}</Cell>
              <Cell na={S.na}>{d.drivers.length ? d.drivers.map(c.t).join(sep) : S.na}</Cell>
            </tr>
          ))}
          <tr className="total">
            <th>{S.p11.total}</th>
            <Cell num na={S.na}>—</Cell>
            <td>
              <ScoreMeter score={s.total} lang={c.lang} />
            </td>
            <Cell num na={S.na}>{F.int(weightSum)}%</Cell>
            <Cell num className="key-inline" na={S.na}>
              {F.num(s.total, 1)}
            </Cell>
            <Cell na={S.na}>
              <VerdictBadge c={c} verdict={s.verdict} size="sm" />
            </Cell>
          </tr>
        </tbody>
      </table>
      <div className="two-col">
        <div className="panel">
          <div className="panel-title">{S.p11.conditions}</div>
          <ol className="tight-list">
            {s.conditions.length === 0 ? <li>{S.p11.noConditions}</li> : null}
            {s.conditions.map((x, i) => {
              const dim = s.dimensions.find((d) => d.id === x.dimension);
              return (
                <li key={i}>
                  <span className="li-head">{dim ? dimensionName(dim, c.lang) : c.t(x.dimension)}</span>
                  <span className="li-body">{c.field(x.text_zh, x.text_en)}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title">{S.p11.rule}</div>
          <ul className="tight-list">
            <li>
              <span className="dot" style={{ background: scoreColor(80) }} />
              <span className="li-body">{S.verdictRule.go}</span>
            </li>
            <li>
              <span className="dot" style={{ background: scoreColor(55) }} />
              <span className="li-body">{S.verdictRule.conditional}</span>
            </li>
            <li>
              <span className="dot" style={{ background: scoreColor(20) }} />
              <span className="li-body">{S.verdictRule.noGo}</span>
            </li>
          </ul>
          {s.cannibalization.length ? <p className="table-note">{fill(S.p11.cannibalization, { list: s.cannibalization.map((x) => `${x.store} ${F.pct(x.diverted_share, 1)}`).join(sep) })}</p> : null}
        </div>
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 12 · Risk register                                                    */
/* ------------------------------------------------------------------ */
function Page12({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const risks = model.risks;
  return (
    <PageShell c={c} model={model} pageId="page_12" chips={<SourceChips model={model} ids={['D11', 'D12']} model_labels={[S.p12.chipRisk]} lang={c.lang} />}>
      <h2 className="h2">{S.p12.matrix}</h2>
      <div className="risk-matrix-wrap">
        <RiskMatrix risks={risks} lang={c.lang} />
      </div>
      <div className="key-row three">
        <KeyNumber label={S.p12.highCount} value={fill(S.p12.items, { n: F.int(risks.filter((r) => r.prob === 'high').length) })} sub={fill(S.p12.ofTotal, { n: risks.length })} />
        <KeyNumber label={S.p12.impactSum} value={F.usd(risks.reduce((a, r) => a + (r.impact_usd ?? 0), 0))} sub={fill(S.p12.impactSumSub, { n: risks.filter((r) => r.impact_usd != null).length })} />
        <KeyNumber label={S.p12.unquantified} value={fill(S.p12.items, { n: F.int(risks.filter((r) => r.impact_usd == null).length) })} sub={S.p12.unquantifiedSub} />
      </div>
      <table className="data-table risk-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>{S.p12.risk}</th>
            <th>{S.p12.prob}</th>
            <th className="num">{S.p12.impact}</th>
            <th>{S.p12.trigger}</th>
            <th>{S.p12.hedge}</th>
          </tr>
        </thead>
        <tbody>
          {risks.length === 0 ? (
            <tr>
              <Cell num na={S.na}>—</Cell>
              <Cell na={S.na}>{S.na}</Cell>
              <Cell na={S.na}>{S.na}</Cell>
              <Cell num na={S.na}>{S.na}</Cell>
              <Cell na={S.na}>{S.na}</Cell>
              <Cell na={S.na}>{S.na}</Cell>
            </tr>
          ) : null}
          {risks.map((r) => (
            <tr key={r.id}>
              <Cell num na={S.na}>{r.id}</Cell>
              <Cell na={S.na}>{c.field(r.risk_zh, r.risk_en)}</Cell>
              <td>
                <span className="dot" style={{ background: probColor(r.prob) }} /> {S.prob[r.prob]}
              </td>
              <Cell num na={S.na}>{F.usd(r.impact_usd)}</Cell>
              <Cell na={S.na}>{r.trigger && r.trigger !== '—' ? c.t(r.trigger) : S.na}</Cell>
              <Cell na={S.na}>{c.t(r.hedge) || S.na}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <XRef>{S.p12.xref}</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 13 · Pre-lease checklist + 90-day plan                                */
/* ------------------------------------------------------------------ */
function Page13({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S } = c;
  const m = model;
  const missing = m.finance.inputs_missing;
  return (
    <PageShell c={c} model={m} pageId="page_13" chips={<SourceChips model={m} ids={['D12']} model_labels={[S.p13.chipConditions]} extra={[{ kind: 'model' as SourceKind, label: S.p13.chipChecklist }]} lang={c.lang} />}>
      <div className="two-col">
        <div className="panel">
          <div className="panel-title">{S.p13.checklist}</div>
          <ul className="check-list boxes">
            {m.score.conditions.map((x, i) => (
              <li key={`c${i}`}>
                <span className="box" />
                <span>
                  <strong>{S.p13.condition}</strong> {c.field(x.text_zh, x.text_en)}
                </span>
              </li>
            ))}
            {missing.map((s, i) => (
              <li key={`m${i}`}>
                <span className="box" />
                <span>
                  <strong>{S.p13.input}</strong> {c.t(s)}
                </span>
              </li>
            ))}
            {m.score.conditions.length === 0 && missing.length === 0 ? (
              <li>
                <span className="box" />
                <span>{S.p13.nothing}</span>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-title">{S.p13.docs}</div>
          <ul className="check-list boxes">
            {S.p13.leaseDocs.map((d) => (
              <li key={d}>
                <span className="box" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h2 className="h2">{S.p13.plan}</h2>
      <Timeline steps={S.p13.steps} lang={c.lang} />
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 14 · Sources & method (data lineage)                                  */
/* ------------------------------------------------------------------ */
function Page14({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const notes = dataNotes(m, c.lang);
  const precheck = precheckReasons(m, c.lang);
  const comps = Object.entries(m.confidence.components);
  const rings = m.trade_area.rings;
  const zh = c.lang === 'zh';
  const sep = zh ? '；' : '; ';
  const src = S.source as Record<string, { short: string; content: string; org: string; license: string } | undefined>;
  return (
    <PageShell c={c} model={m} pageId="page_14" chips={<SourceChips model={m} ids={m.sources.map((s) => s.id)} lang={c.lang} />}>
      <table className="data-table sources-table lineage-table">
        <thead>
          <tr>
            <th>{S.p14.source}</th>
            <th>{S.p14.content}</th>
            <th>{S.p14.updated}</th>
            <th>{S.p14.provider}</th>
            <th>{S.p14.license}</th>
          </tr>
        </thead>
        <tbody>
          {m.sources.map((s) => {
            const g = src[s.id];
            return (
              <tr key={s.id}>
                <Cell na={S.na}>
                  <span className="clamp2">{g?.short ?? s.name.split(' (')[0].split(' · ')[0].trim()}</span>
                </Cell>
                <Cell className="wrap" na={S.na}>
                  <span className="clamp2">{g?.content ?? (c.t(s.coverage_note) || S.na)}</span>
                </Cell>
                <Cell na={S.na}>{fmtDate(s.fetched_at)}</Cell>
                <Cell className="wrap" na={S.na}>
                  <span className="clamp2">{g?.org ?? s.source}</span>
                </Cell>
                <Cell className="wrap" na={S.na}>
                  <span className="clamp2">{g?.license ?? s.license ?? S.na}</span>
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
      {notes.length ? (
        <p className="data-notes">
          <span className="data-notes-title">{S.p14.notes}</span>
          {notes.map((n, i) => `${i + 1}. ${n}`).join(zh ? '　' : '  ')}
        </p>
      ) : null}
      <div className="two-col sources-panels">
        <div className="panel">
          <div className="panel-title">{S.p14.method}</div>
          <ul className="tight-list small">
            <li>
              <span className="li-head">{S.p14.finance}</span>
              <span className="li-body">{c.t(m.finance.method)}</span>
            </li>
            <li>
              <span className="li-head">{S.p14.cuisineShare}</span>
              <span className="li-body">{c.t(m.demand.cuisine_share_method)}</span>
            </li>
            <li>
              <span className="li-head">{S.p14.demandSplit}</span>
              <span className="li-body">{fill(S.p14.demandSplitText, { n: F.int(m.demand.huff.competitor_set) })}</span>
            </li>
            <li>
              <span className="li-head">{S.p14.scoring}</span>
              <span className="li-body">{S.p14.scoringText}</span>
            </li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-title">{S.p14.params}</div>
          <p className="params-line">{fill(S.p14.completenessLine, { score: F.int(m.confidence.total), level: S.level[m.confidence.level], parts: comps.map(([k, x]) => `${S.confidenceComponent[k] ?? k} ${F.int(x.weight)}%×${F.num(x.quality, 2)}`).join(' · ') })}</p>
          <p className="params-line">{fill(S.p14.ringsLine, { rings: rings.map((r) => (zh ? S.ring[r.id].label.replace('范围', '') : S.ring[r.id].short)).join(' · '), primary: zh ? S.ring[m.trade_area.primary_ring].label : S.ring[m.trade_area.primary_ring].short, method: m.trade_area.isochrone_method === 'mapbox' ? S.p14.methodMapbox : S.p14.methodRadius })}</p>
          <p className="params-line">{fill(S.p14.huffLine, { alpha: F.num(m.demand.huff.alpha, 2), beta: F.num(m.demand.huff.beta, 2), version: m.meta.engine_version })}</p>
        </div>
      </div>
      <p className="disclaimer">
        {S.p14.disclaimer}
        {m.meta.tier === 'precheck' ? fill(S.p14.precheck, { reasons: precheck.length ? (zh ? `（${precheck.join(sep)}）` : ` (${precheck.join(sep)})`) : '' }) : ''}
      </p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 15 · Summary & recommendations                                        */
/* ------------------------------------------------------------------ */
function Page15({ model, lang }: PageProps) {
  const c = ctxOf(model, lang);
  const { S, F } = c;
  const m = model;
  const zh = c.lang === 'zh';
  const v = verdictLabel(m.score.verdict, c.lang);
  const cuisine = zh ? m.input.cuisine_label_zh : cuisineName(m.input, c.lang);
  const cov = m.demand.coverage_ratio;
  const occ = m.finance.occupancy_cost_ratio;
  const weakest = [...m.score.dimensions].sort((a, b) => a.score - b.score)[0];
  const probRank = { high: 0, medium: 1, low: 2 } as const;
  const topRisk = [...m.risks].sort((a, b) => probRank[a.prob] - probRank[b.prob] || (b.impact_usd ?? 0) - (a.impact_usd ?? 0))[0];
  const alts = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
  const bestAlt = alts.find((a) => a.verdict === 'GO' || a.verdict === 'CONDITIONAL_GO') ?? alts[0];
  const missing = m.finance.inputs_missing;
  const conds = m.score.conditions;
  const rankOf = (cuisine: string) => m.score.alternatives.findIndex((a) => a.cuisine === cuisine) + 1;
  const altName = (a: ReportModel['score']['alternatives'][number]) => cuisineName(a, c.lang);
  // No rent provided: the occupancy-cost number is replaced by the rent ceiling and every
  // break-even / coverage figure is labelled ex-rent; no rent is assumed anywhere on the page.
  const noRent = m.finance.rent_excluded;
  const xr = noRent ? S.exRent : '';
  const maxRent = F.usd(m.finance.max_rent_for_10pct_usd);

  const vars = { cuisine, verdict: v.label, captured: F.usd(m.demand.captured_monthly_usd), breakeven: F.usd(m.finance.breakeven_monthly), coverage: F.pct(cov), occupancy: F.pct(occ, 1), score: F.num(m.score.total, 1), maxRent };
  const conclusion =
    fill(noRent ? S.p15.conclusionNoRent : S.p15.conclusion, vars) +
    (weakest ? fill(S.p15.weakest, { dim: dimensionName(weakest, c.lang), score: F.num(weakest.score, 0) }) : S.p15.weakestNone) +
    (topRisk ? fill(S.p15.topRisk, { risk: c.field(topRisk.risk_zh, topRisk.risk_en) }) : '') +
    (bestAlt && m.score.verdict !== 'GO' ? fill(S.p15.bestAlt, { alt: altName(bestAlt), score: F.num(bestAlt.total, 1), verdict: verdictLabel(bestAlt.verdict, c.lang).label }) : '');

  const nextSteps = [
    conds.length ? fill(S.p15.step1, { n: conds.length }) : S.p15.step1None,
    noRent ? fill(S.p15.step2NoRent, { maxRent }) : occ != null && occ > 0.1 ? fill(S.p15.step2, { occ: F.pct(occ, 1) }) : S.p15.step2Ok,
    missing.length ? S.p15.step3 : S.p15.step3Ok,
  ];

  return (
    <PageShell c={c} model={m} pageId="page_15" chips={<SourceChips model={m} ids={['D2', 'D6', 'D12']} model_labels={[S.p15.chipScore, S.p15.chipHuff, S.p15.chipBreakeven]} lang={c.lang} />}>
      <div className="summary-top">
        <VerdictBadge c={c} verdict={m.score.verdict} />
        <div className="summary-keys">
          <KeyNumber label={`${S.p15.coverage}${xr}`} value={F.pct(cov)} sub={`${S.p15.coverageSub}${xr}`} />
          {noRent ? <KeyNumber label={S.p15.maxRent} value={maxRent} sub={S.p15.maxRentSub} /> : <KeyNumber label={S.p15.occupancy} value={F.pct(occ, 1)} sub={S.p15.occupancySub} />}
          <KeyNumber label={S.p15.score} value={`${F.num(m.score.total, 1)}`} sub={S.p15.scoreSub} />
        </div>
      </div>
      <p className="final-conclusion">{conclusion}</p>
      <div className="two-col">
        <div className="panel">
          <div className="panel-title">{S.p15.mustDo}</div>
          <ul className="check-list boxes">
            {conds.map((x, i) => (
              <li key={`c${i}`}>
                <span className="box" />
                <span>{c.field(x.text_zh, x.text_en)}</span>
              </li>
            ))}
            {missing.length ? (
              <li>
                <span className="box" />
                <span>
                  <strong>{S.p15.fillInputs}</strong> {missing.map(c.t).join(zh ? '、' : ', ')} {S.p15.seePage13}
                </span>
              </li>
            ) : null}
            {conds.length === 0 && missing.length === 0 ? (
              <li>
                <span className="box" />
                <span>{S.p15.nothing}</span>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-title">{S.p15.alternatives}</div>
          <table className="data-table compact alt-table">
            <thead>
              <tr>
                <th className="num">{S.p15.rank}</th>
                <th>{S.p15.cuisine}</th>
                <th className="num">{S.p15.score2}</th>
                <th>{S.p15.verdict}</th>
              </tr>
            </thead>
            <tbody>
              {alts.length === 0 ? (
                <tr>
                  <Cell num na={S.na}>—</Cell>
                  <Cell na={S.na}>{S.na}</Cell>
                  <Cell num na={S.na}>{S.na}</Cell>
                  <Cell na={S.na}>{S.na}</Cell>
                </tr>
              ) : null}
              {alts.map((a) => (
                <tr key={a.cuisine}>
                  <Cell num na={S.na}>{rankOf(a.cuisine)}</Cell>
                  <Cell na={S.na}>{altName(a)}</Cell>
                  <Cell num na={S.na}>{F.num(a.total, 1)}</Cell>
                  <Cell className="nowrap" na={S.na}>{verdictLabel(a.verdict, c.lang).label}</Cell>
                </tr>
              ))}
              <tr className="highlight">
                <Cell num na={S.na}>{F.int(m.score.user_cuisine_rank)}</Cell>
                <Cell na={S.na}>
                  {cuisine} <span className="muted">{S.p15.yours}</span>
                </Cell>
                <Cell num na={S.na}>{F.num(m.score.total, 1)}</Cell>
                <Cell className="nowrap" na={S.na}>{v.label}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <h2 className="h2">{S.p15.next}</h2>
      <ol className="next-steps">
        {nextSteps.map((s, i) => (
          <li key={i}>
            <span className="step-no">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </PageShell>
  );
}

export const PAGE_COMPONENTS: Record<PageId, ComponentType<PageProps>> = {
  page_1: Page1,
  page_2: Page2,
  page_3: Page3,
  page_4: Page4,
  page_5: Page5,
  page_6: Page6,
  page_7: Page7,
  page_8: Page8,
  page_9: Page9,
  page_10: Page10,
  page_11: Page11,
  page_12: Page12,
  page_13: Page13,
  page_14: Page14,
  page_15: Page15,
};

/**
 * An unnumbered cover page, then all fifteen pages in PAGES order, rendered in
 * ONE report language (`lang`, default: the model's language). `staticMaps`
 * (optional) is the raster basemap pair for the cover, page 1 and page 3.
 */
export function ReportDocument({ model, staticMaps, lang }: PageProps) {
  const l = lang ?? toLocale(model.meta.language);
  return (
    <main className="report" data-report-id={model.meta.report_id} data-lang={l} lang={LOCALE_TAG[l]}>
      <CoverPage model={model} staticMaps={staticMaps} lang={l} />
      {PAGES.map((p) => {
        const C = PAGE_COMPONENTS[p.id];
        return <C key={p.id} model={model} staticMaps={staticMaps} lang={l} />;
      })}
    </main>
  );
}
