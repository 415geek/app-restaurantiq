'use client';

import { CompetitorMap } from '@/components/iq/CompetitorMap';
import { RiskAuditScorecard } from '@/components/iq/RiskAuditScorecard';
import { SiteHistorySection } from '@/components/iq/SiteHistorySection';
import type { SiteHistoryPack } from '@/lib/funnel/external-data/site-history';
import { buildCompetitorMapPins } from '@/lib/funnel/iq-competitor-map';
import type { CompetitorInsights } from '@/lib/funnel/iq-deepseek-competitor-insights';
import type { DeterministicFinanceModel } from '@/lib/funnel/iq-finance-model';
import {
  normalizeRiskAuditFromFull,
  numScore,
  type RiskAuditFull,
} from '@/lib/funnel/iq-risk-audit-model';
import {
  conclusionPendingNote,
  occupancyCostPct,
  parseConclusion,
  type Conclusion,
} from '@/lib/iq/conclusion/display';
import { LOCALE_TAG, type Locale } from '@/lib/i18n/locale';

type Props = {
  full: Record<string, unknown>;
  lang: Locale;
  businessType?: string | null;
  marketData?: Record<string, unknown> | null;
  staticMapUrl?: string | null;
  t: {
    riskAudit: string;
    topRisks: string;
    playbook: string;
    leaseChecklist: string;
    costModel: string;
    breakEven: string;
    safeRevenue: string;
    competitorTiers: string;
    competitorMap: string;
    competitorInsights?: string;
  };
};

type Copy = {
  competitorInsights: string;
  calculated: string;
  breakEvenFormula: string;
  safeFormula: string;
  perMonth: string;
  perDay: (usd: string, covers: number, ticket: number) => string;
  howCalculated: string;
  archetype: string;
  citations: string;
  confidence: Record<'high' | 'medium' | 'low', string>;
  aiReviewAnalysis: string;
  groundedIn: (n: number) => string;
  threat: Record<'high' | 'medium' | 'low', string>;
  reviews: string;
  signatureItems: string;
  topPraise: string;
  topComplaints: string;
  pricingPerception: string;
  clusterSummary: string;
  gaps: string;
  generatedBy: string;
  siteHistory: string;
  costItem: string;
  costAmount: string;
  costNote: string;
  /** §4.1: one line that says both surfaces print the same frozen numbers. */
  snapshot: (id: string) => string;
  exRent: string;
  occupancy: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    competitorInsights: 'Competitor deep insights',
    calculated: 'Calculated',
    breakEvenFormula: 'Computed by the D-4 formula: (rent + labor + other fixed costs) / contribution margin',
    safeFormula: 'Break-even × 1.20–1.35 (archetype-specific safety multiplier)',
    perMonth: '/mo',
    perDay: (usd, covers, ticket) => `≈ $${usd}/day · ~${covers} covers @ $${ticket}`,
    howCalculated: 'How this was calculated (click to expand)',
    archetype: 'Cuisine archetype: ',
    citations: 'Citations: ',
    confidence: { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' },
    aiReviewAnalysis: 'AI review analysis',
    groundedIn: (n) => `Grounded in ${n} Google + Yelp review excerpts`,
    threat: { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' },
    reviews: 'reviews',
    signatureItems: 'Signature items',
    topPraise: 'Top praise: ',
    topComplaints: 'Top complaints: ',
    pricingPerception: 'Pricing perception: ',
    clusterSummary: 'Cluster summary',
    gaps: 'Gaps & openings',
    generatedBy: 'AI-extracted from Google Place Details + Yelp Fusion review excerpts',
    siteHistory: 'Businesses at this address & their reviews',
    costItem: 'Item',
    costAmount: 'Amount',
    costNote: 'Note',
    snapshot: (id) => `Conclusion snapshot ${id} — the web report and the 360° PDF print these same figures.`,
    exRent: 'excludes rent (none provided)',
    occupancy: 'Occupancy cost',
  },
  zh: {
    competitorInsights: '竞品深度洞察',
    calculated: '公式计算',
    breakEvenFormula: '由 D-4 公式计算：租金 + 人力 + 其他固定成本 / 边际贡献率',
    safeFormula: '保本 × 1.20–1.35（业态相关安全乘数）',
    perMonth: '/月',
    perDay: (usd, covers, ticket) => `≈ $${usd}/天 · 约 ${covers} 单@$${ticket}`,
    howCalculated: '如何计算（点击展开）',
    archetype: '业态原型：',
    citations: '引用：',
    confidence: { high: '高置信度', medium: '中等置信度', low: '低置信度' },
    aiReviewAnalysis: 'AI 评论分析',
    groundedIn: (n) => `数据基于 ${n} 条 Google + Yelp 评论摘要`,
    threat: { high: '高威胁', medium: '中等威胁', low: '低威胁' },
    reviews: '条评论',
    signatureItems: '代表产品',
    topPraise: '高频好评：',
    topComplaints: '高频差评：',
    pricingPerception: '价格感知：',
    clusterSummary: '竞品集群总结',
    gaps: '可切入的市场缺口',
    generatedBy: 'AI 提炼 · 基于 Google Place Details + Yelp Fusion 评论摘要',
    siteHistory: '该地址过往 / 现有商家与评论',
    costItem: '项目',
    costAmount: '金额',
    costNote: '说明',
    snapshot: (id) => `结论快照 ${id} —— 网页版与 360° PDF 打印的是同一组数字。`,
    exRent: '不含租金（未提供）',
    occupancy: '占用成本',
  },
  es: {
    competitorInsights: 'Análisis a fondo de competidores',
    calculated: 'Calculado',
    breakEvenFormula: 'Calculado con la fórmula D-4: (renta + mano de obra + otros costos fijos) / margen de contribución',
    safeFormula: 'Punto de equilibrio × 1.20–1.35 (multiplicador de seguridad según el arquetipo)',
    perMonth: '/mes',
    perDay: (usd, covers, ticket) => `≈ $${usd}/día · ~${covers} cubiertos a $${ticket}`,
    howCalculated: 'Cómo se calculó (clic para ampliar)',
    archetype: 'Arquetipo de cocina: ',
    citations: 'Referencias: ',
    confidence: { high: 'Confianza alta', medium: 'Confianza media', low: 'Confianza baja' },
    aiReviewAnalysis: 'Análisis de reseñas con IA',
    groundedIn: (n) => `Basado en ${n} extractos de reseñas de Google + Yelp`,
    threat: { high: 'ALTA', medium: 'MEDIA', low: 'BAJA' },
    reviews: 'reseñas',
    signatureItems: 'Platos insignia',
    topPraise: 'Elogios frecuentes: ',
    topComplaints: 'Quejas frecuentes: ',
    pricingPerception: 'Percepción de precio: ',
    clusterSummary: 'Resumen del clúster',
    gaps: 'Huecos y oportunidades',
    generatedBy: 'Extraído por IA a partir de Google Place Details + extractos de reseñas de Yelp Fusion',
    siteHistory: 'Negocios en esta dirección y sus reseñas',
    costItem: 'Concepto',
    costAmount: 'Monto',
    costNote: 'Nota',
    snapshot: (id) => `Snapshot de la conclusión ${id}: el informe web y el PDF 360° imprimen las mismas cifras.`,
    exRent: 'sin renta (no proporcionada)',
    occupancy: 'Costo de ocupación',
  },
};

function SectionShell({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section className="print-section rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-100">
        <span aria-hidden>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function RiskAuditReportSections({
  full,
  lang,
  businessType,
  marketData,
  staticMapUrl,
  t,
}: Props) {
  const c = COPY[lang];
  const numberLocale = LOCALE_TAG[lang];
  const audit: RiskAuditFull | undefined =
    normalizeRiskAuditFromFull(full) ??
    (full.risk_audit && typeof full.risk_audit === 'object'
      ? (full.risk_audit as RiskAuditFull)
      : undefined);

  if (!audit) return null;

  const { center, pins } = buildCompetitorMapPins({
    marketData,
    reportCompetitors: Array.isArray(full.competitors) ? full.competitors : [],
  });

  // Grounding flags injected by lib/funnel/iq-full-report-schema.applyCompetitorWhitelist.
  const insufficientCompetitorData = full._insufficient_competitor_data === true;
  // §4.4 P1-a 计数单一化: the canonical count block wins over the retrieval whitelist
  // size, so the page never prints a competitor count of its own.
  const canonicalCounts = full.competitor_counts as { total?: unknown } | undefined;
  const whitelistTotal =
    canonicalCounts && typeof canonicalCounts.total === 'number'
      ? canonicalCounts.total
      : typeof full._whitelist_total === 'number'
        ? (full._whitelist_total as number)
        : undefined;

  // §4.1 单一结论源 (P0-A): the stored conclusion is what this section prints. The
  // LLM's own break-even / safe revenue are only a pre-P0-A fallback, and when the
  // deterministic core has not landed we print ONE pending line instead of a second
  // set of numbers.
  const conclusion: Conclusion | null = parseConclusion(full.conclusion);
  const pending = full.conclusion_pending === true && !conclusion;
  const breakEven = conclusion ? conclusion.breakeven_monthly ?? undefined : numScore(audit.break_even_revenue_monthly_usd);
  const safeRev = conclusion ? conclusion.safety_monthly ?? undefined : numScore(audit.safe_revenue_monthly_usd);
  const occupancy = conclusion ? occupancyCostPct(conclusion) : null;
  const costs = audit.cost_breakdown ?? [];

  // D-4: deterministic finance-model evidence stamp (set by applyFinanceModelOverride).
  const financeApplied = full._finance_model_applied === true;
  const financeSnapshot =
    full._finance_model_snapshot && typeof full._finance_model_snapshot === 'object'
      ? (full._finance_model_snapshot as DeterministicFinanceModel)
      : undefined;

  // D-5: DeepSeek competitor insights pack (set by enrichMarketDataWithCompetitorInsights).
  const competitorInsights =
    marketData?.competitor_insights && typeof marketData.competitor_insights === 'object'
      ? (marketData.competitor_insights as CompetitorInsights)
      : undefined;
  const competitorInsightsTitle = t.competitorInsights ?? c.competitorInsights;
  // The insight pack carries zh + en text only; Spanish readers get the English text.
  const zhText = lang === 'zh';

  return (
    <>
      <SectionShell title={t.riskAudit} icon="🛡️">
        <RiskAuditScorecard
          audit={audit}
          lang={lang}
          businessType={businessType ?? undefined}
          conclusion={conclusion}
          verdictRule={typeof full.verdict_rule === 'string' ? full.verdict_rule : null}
        />
        {pending && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/80">
            {conclusionPendingNote(lang)}
          </p>
        )}
        {!pending && (breakEven !== undefined || safeRev !== undefined) && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {breakEven !== undefined && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-amber-200/70">{t.breakEven}</span>
                  {financeApplied && (
                    <span
                      className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200"
                      title={c.breakEvenFormula}
                    >
                      {c.calculated}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xl font-semibold text-amber-100">
                  ${breakEven.toLocaleString(numberLocale)}
                  {c.perMonth}
                </div>
                {conclusion?.rent_excluded && <div className="mt-1 text-xs text-amber-200/70">{c.exRent}</div>}
                {!conclusion && financeSnapshot && (
                  <div className="mt-1 text-xs text-amber-200/70">
                    {c.perDay(
                      financeSnapshot.break_even_daily_revenue_usd.toLocaleString('en-US'),
                      financeSnapshot.daily_covers_needed_breakeven,
                      financeSnapshot.avg_ticket_usd,
                    )}
                  </div>
                )}
              </div>
            )}
            {safeRev !== undefined && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-emerald-200/70">{t.safeRevenue}</span>
                  {financeApplied && (
                    <span
                      className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200"
                      title={c.safeFormula}
                    >
                      {c.calculated}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xl font-semibold text-emerald-100">
                  ${safeRev.toLocaleString(numberLocale)}
                  {c.perMonth}
                </div>
                {conclusion?.rent_excluded && <div className="mt-1 text-xs text-emerald-200/70">{c.exRent}</div>}
                {!conclusion && financeSnapshot && (
                  <div className="mt-1 text-xs text-emerald-200/70">
                    {c.perDay(
                      financeSnapshot.safe_daily_revenue_usd.toLocaleString('en-US'),
                      financeSnapshot.daily_covers_needed_safe,
                      financeSnapshot.avg_ticket_usd,
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {conclusion && (
          <p className="mt-4 text-[11px] text-zinc-500">
            {occupancy != null ? `${c.occupancy}: ${occupancy}% · ` : ''}
            {c.snapshot(conclusion.snapshot_id)}
          </p>
        )}

        {!conclusion && financeApplied && financeSnapshot && (
          <details className="mt-4 rounded-xl border border-zinc-700/60 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300">
            <summary className="cursor-pointer font-medium text-zinc-100">
              {c.howCalculated}
              <span className="ml-2 text-xs text-zinc-400">· {c.confidence[financeSnapshot.confidence]}</span>
            </summary>
            <div className="mt-3 space-y-2">
              <div className="text-xs text-zinc-400">
                {c.archetype}
                <span className="text-zinc-200">
                  {zhText ? financeSnapshot.cuisine_archetype_label_zh : financeSnapshot.cuisine_archetype_label_en}
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-300">
                {financeSnapshot.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              <div className="pt-2 text-[11px] text-zinc-500">
                {c.citations}
                {financeSnapshot.citations.join(' · ')}
              </div>
            </div>
          </details>
        )}
      </SectionShell>

      {(center && pins.length > 0) ||
      audit.competitor_tiers_note ||
      insufficientCompetitorData ? (
        <SectionShell title={t.competitorMap} icon="🗺️">
          <CompetitorMap
            center={center}
            pins={pins}
            lang={lang}
            staticMapUrl={staticMapUrl}
            whitelistTotal={whitelistTotal}
            insufficient={insufficientCompetitorData}
          />
          {audit.competitor_tiers_note && (
            <p className="mt-4 text-sm leading-relaxed text-zinc-300">{audit.competitor_tiers_note}</p>
          )}
        </SectionShell>
      ) : null}

      {competitorInsights && competitorInsights.per_competitor?.length > 0 && (
        <SectionShell title={competitorInsightsTitle} icon="🔍">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-200">
              {c.aiReviewAnalysis}
            </span>
            <span>{c.groundedIn(competitorInsights.reviews_fetched.total_review_excerpts)}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
            {competitorInsights.per_competitor.map((row, i) => {
              const threatTheme =
                row.threat_level === 'high'
                  ? 'border-rose-500/40 bg-rose-950/20 text-rose-100'
                  : row.threat_level === 'low'
                    ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-100'
                    : 'border-amber-500/30 bg-amber-950/15 text-amber-100';
              const threatLabel =
                row.threat_level === 'high' ? c.threat.high : row.threat_level === 'low' ? c.threat.low : c.threat.medium;
              const takeaway = zhText ? row.ai_takeaway_zh : row.ai_takeaway_en;
              return (
                <div
                  key={`${i}-${row.name}`}
                  className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-100" title={row.name}>
                        {row.name}
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {[
                          row.rating != null ? `${row.rating}/5` : null,
                          row.review_count != null
                            ? `${row.review_count.toLocaleString(numberLocale)} ${c.reviews}`
                            : null,
                          row.price_tier ?? null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${threatTheme}`}
                    >
                      {threatLabel}
                    </span>
                  </div>
                  {row.positioning && (
                    <p className="mt-3 text-xs leading-relaxed text-zinc-300">{row.positioning}</p>
                  )}
                  {row.signature_items.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{c.signatureItems}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.signature_items.map((item, j) => (
                          <span
                            key={j}
                            className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-200"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {row.top_praise.length > 0 && (
                    <div className="mt-2 text-[11px] text-emerald-200/80">
                      <span className="font-medium">{c.topPraise}</span>
                      {row.top_praise.join(' · ')}
                    </div>
                  )}
                  {row.top_complaints.length > 0 && (
                    <div className="mt-1 text-[11px] text-rose-200/80">
                      <span className="font-medium">{c.topComplaints}</span>
                      {row.top_complaints.join(' · ')}
                    </div>
                  )}
                  {row.pricing_perception && (
                    <div className="mt-1 text-[11px] text-zinc-400">
                      <span className="font-medium">{c.pricingPerception}</span>
                      {row.pricing_perception}
                    </div>
                  )}
                  {takeaway && (
                    <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                      {takeaway}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(zhText ? competitorInsights.cluster_summary_zh : competitorInsights.cluster_summary_en) && (
            <div className="mt-4 rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4 text-sm leading-relaxed text-zinc-200">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">{c.clusterSummary}</div>
              <p>{zhText ? competitorInsights.cluster_summary_zh : competitorInsights.cluster_summary_en}</p>
            </div>
          )}

          {(zhText ? competitorInsights.gaps_and_openings_zh : competitorInsights.gaps_and_openings_en) && (
            <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-4 text-sm leading-relaxed text-emerald-100">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-emerald-300/80">{c.gaps}</div>
              <p>{zhText ? competitorInsights.gaps_and_openings_zh : competitorInsights.gaps_and_openings_en}</p>
            </div>
          )}

          <div className="mt-3 text-[10px] text-zinc-500">
            {c.generatedBy}
          </div>
        </SectionShell>
      )}

      {marketData?.site_history && typeof marketData.site_history === 'object' ? (
        <SectionShell title={c.siteHistory} icon="🏚️">
          <SiteHistorySection
            pack={marketData.site_history as SiteHistoryPack}
            llm={(full.site_history as Record<string, unknown> | undefined) ?? null}
            lang={lang}
          />
        </SectionShell>
      ) : null}

      {costs.length > 0 && (
        <SectionShell title={t.costModel} icon="💵">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead>
                <tr className="border-b border-zinc-700 text-xs uppercase text-zinc-500">
                  <th className="py-2 pr-4">{c.costItem}</th>
                  <th className="py-2 pr-4">{c.costAmount}</th>
                  <th className="py-2">{c.costNote}</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/80">
                    <td className="py-2 pr-4 font-medium text-zinc-200">{row.item}</td>
                    <td className="py-2 pr-4">
                      {row.amount_usd !== undefined ? `$${numScore(row.amount_usd) ?? row.amount_usd}` : '—'}
                    </td>
                    <td className="py-2 text-zinc-400">{row.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionShell>
      )}

      {(audit.top_risks?.length ?? 0) > 0 && (
        <SectionShell title={t.topRisks} icon="⚠️">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            {audit.top_risks!.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </SectionShell>
      )}

      {(audit.playbook?.length ?? 0) > 0 && (
        <SectionShell title={t.playbook} icon="🎯">
          <ul className="space-y-2 text-sm text-zinc-300">
            {audit.playbook!.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-emerald-400">→</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </SectionShell>
      )}

      {(audit.lease_checklist?.length ?? 0) > 0 && (
        <SectionShell title={t.leaseChecklist} icon="✅">
          <ul className="grid gap-2 sm:grid-cols-2">
            {audit.lease_checklist!.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="text-zinc-500">☐</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </SectionShell>
      )}
    </>
  );
}
