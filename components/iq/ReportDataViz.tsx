'use client';

/**
 * Deterministic data visualizations for the paid report.
 * Every number rendered here is read directly from market_data_json
 * (Google Places / Yelp / Foursquare / US Census ACS / D-4 finance model)
 * — never from LLM text — so charts stay accurate and traceable.
 * Chart colors validated for the dark surface (emerald #059669 marks,
 * amber #d97706 threshold line always paired with a text label).
 */

import { useMemo } from 'react';

type Md = Record<string, unknown> | null | undefined;

const BAR = '#059669'; // emerald-600 — magnitude marks
const THRESHOLD = '#d97706'; // amber-600 — break-even reference (always text-labeled)

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtUsd(n: number): string {
  return `$${fmtInt(n)}`;
}

function pick<T = unknown>(obj: Md, key: string): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key] as T | undefined;
}

type CompetitorRow = {
  name: string;
  rating: number | null;
  reviews: number | null;
  source: 'Google' | 'Yelp';
  address: string | null;
  distanceM: number | null;
};

function extractCompetitors(md: Md): CompetitorRow[] {
  const summary = pick<Record<string, unknown>>(md, 'summary');
  const rows: CompetitorRow[] = [];
  const g = pick<unknown[]>(summary, 'sample_competitors_google');
  if (Array.isArray(g)) {
    for (const r of g) {
      const o = r as Record<string, unknown>;
      if (typeof o.name !== 'string' || !o.name) continue;
      rows.push({
        name: o.name,
        rating: num(o.rating),
        reviews: num(o.reviews),
        source: 'Google',
        address: typeof o.address === 'string' ? o.address : null,
        distanceM: null,
      });
    }
  }
  const y = pick<unknown[]>(summary, 'sample_competitors_yelp');
  if (Array.isArray(y)) {
    for (const r of y) {
      const o = r as Record<string, unknown>;
      if (typeof o.name !== 'string' || !o.name) continue;
      rows.push({
        name: o.name,
        rating: num(o.rating),
        reviews: num(o.reviews),
        source: 'Yelp',
        address: typeof o.address === 'string' ? o.address : null,
        distanceM: num(o.distance_m),
      });
    }
  }
  // Dedupe by normalized name, keep the row with more reviews.
  const byName = new Map<string, CompetitorRow>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    const prev = byName.get(key);
    if (!prev || (r.reviews ?? 0) > (prev.reviews ?? 0)) byName.set(key, r);
  }
  return [...byName.values()]
    .filter((r) => (r.reviews ?? 0) > 0)
    .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))
    .slice(0, 8);
}

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="print-section rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <span aria-hidden>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SourceNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">{children}</p>;
}

/** Horizontal bar rows (HTML marks): thin bars, rounded data-end, visible labels. */
function HBars({
  rows,
  maxValue,
  valueFmt,
}: {
  rows: { label: string; sub?: string; value: number; title?: string }[];
  maxValue?: number;
  valueFmt?: (n: number) => string;
}) {
  const max = maxValue ?? Math.max(...rows.map((r) => r.value), 1);
  const fmt = valueFmt ?? fmtInt;
  return (
    <div className="space-y-2" role="img">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3" title={r.title}>
          <div className="w-40 shrink-0 truncate text-right text-xs text-zinc-300 sm:w-48">
            {r.label}
            {r.sub ? <span className="ml-1 text-zinc-500">{r.sub}</span> : null}
          </div>
          <div className="relative h-[14px] flex-1 rounded-r bg-zinc-800/40">
            <div
              className="absolute inset-y-0 left-0 rounded-r"
              style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%`, backgroundColor: BAR }}
            />
          </div>
          <div className="w-16 shrink-0 text-xs tabular-nums text-zinc-400">{fmt(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

const L = {
  zh: {
    vizTitle: '数据看板（原始数据直读）',
    statCompetitors: '周边同类竞对',
    statAvgRating: 'Google 平均评分',
    statPopulation: '人口（普查区）',
    statIncome: '家庭收入中位数',
    statEdu: '本科及以上占比',
    competitorChart: '竞对热度（按评论数）',
    competitorNote: (d: string) => `来源：Google Places · Yelp Fusion（获取于 ${d}）。评论数与评分为平台原始值，未经模型加工。`,
    incomeChart: '高收入家庭结构（户数）',
    incomeNote: (y: string) => `来源：U.S. Census ACS 5-year（${y}），按报告地址所在普查区（census tract）统计。`,
    bucket100: '$100k–125k',
    bucket125: '$125k–150k',
    bucket150: '$150k–200k',
    bucket200: '$200k+',
    revenueChart: '营收情景 vs 盈亏平衡',
    breakEvenLabel: '盈亏平衡',
    safeLabel: '安全线',
    revenueNote:
      '情景柱为模型估算 [估算]；「盈亏平衡」与「安全线」来自确定性财务模型（D-4，公式推导，非 LLM 生成）。',
    noData: '该数据源未配置或本次未返回数据（不做估算填充）。',
    provTitle: '数据溯源',
    provIntro:
      '本报告图表与关键数字直接读取以下原始数据源；正文中标注 [估算] 的内容为模型推断，建议实地验证。本系统不编造数据：数据缺失时明确标注，不以虚构数值填充。',
    provSource: '数据源',
    provStatus: '状态',
    provCoverage: '本次抓取',
    provTime: '获取时间',
    ok: '正常',
    notConfigured: '未配置',
    failed: '未返回',
    financeModel: '确定性财务模型（D-4）',
    financeDesc: (conf: string) => `公式推导（置信度 ${conf}），盈亏平衡/安全营收非 LLM 估算`,
    acsRow: (y: string) => `ACS 5-year ${y} · 普查区级`,
    competitorsUnit: '家',
  },
  en: {
    vizTitle: 'Data Dashboard (read directly from sources)',
    statCompetitors: 'Nearby competitors',
    statAvgRating: 'Avg Google rating',
    statPopulation: 'Population (tract)',
    statIncome: 'Median household income',
    statEdu: "Bachelor's or higher",
    competitorChart: 'Competitor traction (by review count)',
    competitorNote: (d: string) => `Source: Google Places · Yelp Fusion (fetched ${d}). Review counts and ratings are raw platform values, not model output.`,
    incomeChart: 'High-income households (count)',
    incomeNote: (y: string) => `Source: U.S. Census ACS 5-year (${y}), census tract of the report address.`,
    bucket100: '$100k–125k',
    bucket125: '$125k–150k',
    bucket150: '$150k–200k',
    bucket200: '$200k+',
    revenueChart: 'Revenue scenarios vs break-even',
    breakEvenLabel: 'Break-even',
    safeLabel: 'Safe line',
    revenueNote:
      'Scenario bars are model estimates [estimate]; break-even and safe lines come from the deterministic D-4 finance model (formula-derived, not LLM-generated).',
    noData: 'Source not configured or returned no data this run (no fabricated fill-in).',
    provTitle: 'Data Provenance',
    provIntro:
      'Charts and key figures are read directly from the sources below; statements tagged [estimate] are model inference and should be field-verified. This system does not fabricate data — missing data is labeled as missing, never filled with invented numbers.',
    provSource: 'Source',
    provStatus: 'Status',
    provCoverage: 'This fetch',
    provTime: 'Fetched at',
    ok: 'OK',
    notConfigured: 'Not configured',
    failed: 'No data',
    financeModel: 'Deterministic finance model (D-4)',
    financeDesc: (conf: string) => `Formula-derived (confidence: ${conf}); break-even / safe revenue are not LLM estimates`,
    acsRow: (y: string) => `ACS 5-year ${y} · tract level`,
    competitorsUnit: '',
  },
};

export function ReportDataViz({
  marketData,
  full,
  lang,
}: {
  marketData: Md;
  full: Record<string, unknown>;
  lang: 'en' | 'zh';
}) {
  const t = L[lang];
  const summary = pick<Record<string, unknown>>(marketData, 'summary');
  const acs = pick<Record<string, unknown>>(marketData, 'acs_context');
  const tractRow = pick<Record<string, unknown>>(acs, 'tract');
  const countyRow = pick<Record<string, unknown>>(acs, 'county');
  const acsTract = (pick(acs, 'tract_data_available') !== false && tractRow ? tractRow : countyRow) ?? tractRow;
  const finance = pick<Record<string, unknown>>(marketData, 'finance_model');
  const fetchedAt = pick<string>(marketData, 'fetched_at');
  const fetchedDate = typeof fetchedAt === 'string' ? fetchedAt.slice(0, 10) : '—';

  const competitors = useMemo(() => extractCompetitors(marketData), [marketData]);

  const gCount = num(pick(summary, 'competitor_count_google'));
  const yCount = num(pick(summary, 'competitor_count_yelp'));
  const avgRating = num(pick(summary, 'avg_rating_google'));

  const population = num(pick(acsTract, 'population'));
  const medianIncome = num(pick(acsTract, 'median_household_income_usd'));
  const eduPct = num(pick(pick<Record<string, unknown>>(acsTract, 'education'), 'bachelors_plus_pct'));
  const acsYear = String(pick(acs, 'acs_year') ?? '');

  const brackets = pick<Record<string, unknown>>(acsTract, 'income_brackets');
  const incomeRows = brackets
    ? (
        [
          [t.bucket100, num(pick(brackets, 'hh_100k_to_125k'))],
          [t.bucket125, num(pick(brackets, 'hh_125k_to_150k'))],
          [t.bucket150, num(pick(brackets, 'hh_150k_to_200k'))],
          [t.bucket200, num(pick(brackets, 'hh_200k_plus'))],
        ] as const
      )
        .filter((r): r is readonly [string, number] => r[1] !== null)
        .map(([label, value]) => ({ label, value }))
    : [];

  const revenueModel = pick<Record<string, unknown>>(full, 'revenue_model');
  const scenarios = (pick<unknown[]>(revenueModel, 'scenarios') ?? [])
    .map((s) => {
      const o = s as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : typeof o.scenario === 'string' ? o.scenario : null;
      const v = num(o.monthly_revenue_usd);
      return name && v !== null ? { label: name, value: v } : null;
    })
    .filter((x): x is { label: string; value: number } => x !== null)
    .slice(0, 4);
  const breakEven = num(pick(finance, 'break_even_revenue_monthly_usd'));
  const safeRev = num(pick(finance, 'safe_revenue_monthly_usd'));

  const revMax = Math.max(...scenarios.map((s) => s.value), breakEven ?? 0, safeRev ?? 0, 1) * 1.12;

  const stats = [
    gCount !== null || yCount !== null
      ? {
          label: t.statCompetitors,
          value: `${fmtInt((gCount ?? 0) + (yCount ?? 0))}${t.competitorsUnit}`,
          cap: 'Google+Yelp',
        }
      : null,
    avgRating !== null ? { label: t.statAvgRating, value: avgRating.toFixed(1), cap: 'Google Places' } : null,
    population !== null ? { label: t.statPopulation, value: fmtInt(population), cap: `ACS ${acsYear}` } : null,
    medianIncome !== null ? { label: t.statIncome, value: fmtUsd(medianIncome), cap: `ACS ${acsYear}` } : null,
    eduPct !== null ? { label: t.statEdu, value: `${eduPct.toFixed(0)}%`, cap: `ACS ${acsYear}` } : null,
  ].filter(Boolean) as { label: string; value: string; cap: string }[];

  const hasAnything = stats.length > 0 || competitors.length > 0 || incomeRows.length > 0 || scenarios.length > 0;
  if (!hasAnything) return null;

  return (
    <SectionCard title={t.vizTitle} icon="📈">
      {stats.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s, i) => (
            <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{s.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">{s.value}</div>
              <div className="mt-0.5 text-[10px] text-zinc-600">{s.cap}</div>
            </div>
          ))}
        </div>
      )}

      {competitors.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">{t.competitorChart}</h3>
          <HBars
            rows={competitors.map((c) => ({
              label: c.name,
              sub: c.rating !== null ? `★${c.rating.toFixed(1)}` : undefined,
              value: c.reviews ?? 0,
              title: [
                c.name,
                c.rating !== null ? `★${c.rating}` : null,
                c.address,
                c.distanceM !== null ? `${fmtInt(c.distanceM)}m` : null,
                `[${c.source}]`,
              ]
                .filter(Boolean)
                .join(' · '),
            }))}
          />
          <SourceNote>{t.competitorNote(fetchedDate)}</SourceNote>
        </div>
      )}

      {incomeRows.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">{t.incomeChart}</h3>
          <HBars rows={incomeRows} />
          <SourceNote>{t.incomeNote(acsYear)}</SourceNote>
        </div>
      )}

      {scenarios.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">{t.revenueChart}</h3>
          <div className="relative pr-16">
            <HBars rows={scenarios} maxValue={revMax} valueFmt={fmtUsd} />
            {breakEven !== null && (
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{ left: `calc(12rem + (100% - 12rem - 4rem) * ${Math.min(breakEven / revMax, 1)})` }}
              >
                <div className="h-full border-l-2 border-dashed" style={{ borderColor: THRESHOLD }} />
                <div className="absolute -top-1 left-1 whitespace-nowrap text-[10px]" style={{ color: THRESHOLD }}>
                  {t.breakEvenLabel} {fmtUsd(breakEven)}
                </div>
              </div>
            )}
            {safeRev !== null && (
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{ left: `calc(12rem + (100% - 12rem - 4rem) * ${Math.min(safeRev / revMax, 1)})` }}
              >
                <div className="h-full border-l-2 border-dashed border-zinc-500" />
                <div className="absolute -bottom-1 left-1 whitespace-nowrap text-[10px] text-zinc-400">
                  {t.safeLabel} {fmtUsd(safeRev)}
                </div>
              </div>
            )}
          </div>
          <SourceNote>{t.revenueNote}</SourceNote>
        </div>
      )}
    </SectionCard>
  );
}

export function DataProvenance({ marketData, lang }: { marketData: Md; lang: 'en' | 'zh' }) {
  const t = L[lang];
  const summary = pick<Record<string, unknown>>(marketData, 'summary');
  const acs = pick<Record<string, unknown>>(marketData, 'acs_context');
  const finance = pick<Record<string, unknown>>(marketData, 'finance_model');
  const fetchedAt = pick<string>(marketData, 'fetched_at');
  const fetchedDate = typeof fetchedAt === 'string' ? fetchedAt.replace('T', ' ').slice(0, 16) : '—';

  const statusText = (s: unknown): string => {
    const v = String(s ?? '');
    if (v === 'ok' || v === 'OK') return t.ok;
    if (v === 'not_configured' || v === '') return t.notConfigured;
    return `${t.failed} (${v})`;
  };

  const rows: { source: string; status: string; coverage: string; time: string }[] = [];
  if (summary) {
    rows.push({
      source: 'Google Places',
      status: statusText(pick(summary, 'places_status')),
      coverage: `${fmtInt(num(pick(summary, 'competitor_count_google')) ?? 0)} competitors`,
      time: fetchedDate,
    });
    rows.push({
      source: 'Yelp Fusion',
      status: statusText(pick(summary, 'yelp_status')),
      coverage: `${fmtInt(num(pick(summary, 'competitor_count_yelp')) ?? 0)} competitors`,
      time: fetchedDate,
    });
    rows.push({
      source: 'Foursquare Places',
      status: statusText(pick(summary, 'foursquare_status')),
      coverage: `${fmtInt(num(pick(summary, 'competitor_count_foursquare')) ?? 0)} venues`,
      time: fetchedDate,
    });
  }
  if (acs) {
    const year = String(pick(acs, 'acs_year') ?? '');
    const tractOk = pick(acs, 'tract_data_available');
    rows.push({
      source: 'U.S. Census Bureau',
      status: tractOk === false ? t.failed : t.ok,
      coverage: t.acsRow(year),
      time: fetchedDate,
    });
  }
  if (finance) {
    const conf = String(pick(finance, 'confidence') ?? 'low');
    rows.push({
      source: t.financeModel,
      status: t.ok,
      coverage: t.financeDesc(conf),
      time: fetchedDate,
    });
  }

  if (rows.length === 0) return null;

  return (
    <section className="print-section rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <span aria-hidden>🔍</span>
        {t.provTitle}
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-zinc-400">{t.provIntro}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-2 pr-4 font-medium">{t.provSource}</th>
              <th className="py-2 pr-4 font-medium">{t.provStatus}</th>
              <th className="py-2 pr-4 font-medium">{t.provCoverage}</th>
              <th className="py-2 font-medium">{t.provTime}</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-zinc-800/60">
                <td className="py-2 pr-4">{r.source}</td>
                <td className="py-2 pr-4">{r.status}</td>
                <td className="py-2 pr-4">{r.coverage}</td>
                <td className="py-2 tabular-nums">{r.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
