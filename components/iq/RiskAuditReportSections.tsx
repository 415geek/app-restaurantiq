'use client';

import { CompetitorMap } from '@/components/iq/CompetitorMap';
import { RiskAuditScorecard } from '@/components/iq/RiskAuditScorecard';
import { buildCompetitorMapPins } from '@/lib/funnel/iq-competitor-map';
import type { CompetitorInsights } from '@/lib/funnel/iq-deepseek-competitor-insights';
import type { DeterministicFinanceModel } from '@/lib/funnel/iq-finance-model';
import {
  normalizeRiskAuditFromFull,
  numScore,
  type IqLocale,
  type RiskAuditFull,
} from '@/lib/funnel/iq-risk-audit-model';

type Props = {
  full: Record<string, unknown>;
  lang: IqLocale;
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
  const whitelistTotal =
    typeof full._whitelist_total === 'number' ? (full._whitelist_total as number) : undefined;

  const breakEven = numScore(audit.break_even_revenue_monthly_usd);
  const safeRev = numScore(audit.safe_revenue_monthly_usd);
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
  const competitorInsightsTitle = t.competitorInsights ?? (lang === 'zh' ? '竞品深度洞察' : 'Competitor deep insights');
  const calcBadge = lang === 'zh' ? '公式计算' : 'Calculated';
  const confidenceCopy: Record<'high' | 'medium' | 'low', { zh: string; en: string }> = {
    high: { zh: '高置信度', en: 'High confidence' },
    medium: { zh: '中等置信度', en: 'Medium confidence' },
    low: { zh: '低置信度', en: 'Low confidence' },
  };

  return (
    <>
      <SectionShell title={t.riskAudit} icon="🛡️">
        <RiskAuditScorecard
          audit={audit}
          lang={lang}
          businessType={businessType ?? undefined}
        />
        {(breakEven !== undefined || safeRev !== undefined) && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {breakEven !== undefined && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-amber-200/70">{t.breakEven}</span>
                  {financeApplied && (
                    <span
                      className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200"
                      title={
                        lang === 'zh'
                          ? '由 D-4 公式计算：租金 + 人力 + 其他固定成本 / 边际贡献率'
                          : 'Computed by D-4 formula: (rent + labor + other fixed) / contribution margin'
                      }
                    >
                      {calcBadge}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xl font-semibold text-amber-100">
                  ${breakEven.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
                  {lang === 'zh' ? '/月' : '/mo'}
                </div>
                {financeSnapshot && (
                  <div className="mt-1 text-xs text-amber-200/70">
                    {lang === 'zh'
                      ? `≈ $${financeSnapshot.break_even_daily_revenue_usd.toLocaleString('en-US')}/天 · 约 ${financeSnapshot.daily_covers_needed_breakeven} 单@$${financeSnapshot.avg_ticket_usd}`
                      : `≈ $${financeSnapshot.break_even_daily_revenue_usd.toLocaleString('en-US')}/day · ~${financeSnapshot.daily_covers_needed_breakeven} covers @ $${financeSnapshot.avg_ticket_usd}`}
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
                      title={
                        lang === 'zh'
                          ? '保本 × 1.20–1.35（业态相关安全乘数）'
                          : 'Break-even × 1.20–1.35 (archetype-specific safety multiplier)'
                      }
                    >
                      {calcBadge}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xl font-semibold text-emerald-100">
                  ${safeRev.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
                  {lang === 'zh' ? '/月' : '/mo'}
                </div>
                {financeSnapshot && (
                  <div className="mt-1 text-xs text-emerald-200/70">
                    {lang === 'zh'
                      ? `≈ $${financeSnapshot.safe_daily_revenue_usd.toLocaleString('en-US')}/天 · 约 ${financeSnapshot.daily_covers_needed_safe} 单@$${financeSnapshot.avg_ticket_usd}`
                      : `≈ $${financeSnapshot.safe_daily_revenue_usd.toLocaleString('en-US')}/day · ~${financeSnapshot.daily_covers_needed_safe} covers @ $${financeSnapshot.avg_ticket_usd}`}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {financeApplied && financeSnapshot && (
          <details className="mt-4 rounded-xl border border-zinc-700/60 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300">
            <summary className="cursor-pointer font-medium text-zinc-100">
              {lang === 'zh' ? '如何计算（点击展开）' : 'How this was calculated (click to expand)'}
              <span className="ml-2 text-xs text-zinc-400">
                · {confidenceCopy[financeSnapshot.confidence][lang === 'zh' ? 'zh' : 'en']}
              </span>
            </summary>
            <div className="mt-3 space-y-2">
              <div className="text-xs text-zinc-400">
                {lang === 'zh' ? '业态原型：' : 'Cuisine archetype: '}
                <span className="text-zinc-200">
                  {lang === 'zh'
                    ? financeSnapshot.cuisine_archetype_label_zh
                    : financeSnapshot.cuisine_archetype_label_en}
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-300">
                {financeSnapshot.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              <div className="pt-2 text-[11px] text-zinc-500">
                {lang === 'zh' ? '引用：' : 'Citations: '}
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
              {lang === 'zh' ? 'AI 评论分析' : 'AI review analysis'}
            </span>
            <span>
              {lang === 'zh'
                ? `数据基于 ${competitorInsights.reviews_fetched.total_review_excerpts} 条 Google + Yelp 评论摘要`
                : `Grounded in ${competitorInsights.reviews_fetched.total_review_excerpts} Google + Yelp review excerpts`}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
            {competitorInsights.per_competitor.map((row, i) => {
              const threatTheme =
                row.threat_level === 'high'
                  ? 'border-rose-500/40 bg-rose-950/20 text-rose-100'
                  : row.threat_level === 'low'
                    ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-100'
                    : 'border-amber-500/30 bg-amber-950/15 text-amber-100';
              const threatLabel = (() => {
                if (lang === 'zh') {
                  if (row.threat_level === 'high') return '高威胁';
                  if (row.threat_level === 'low') return '低威胁';
                  return '中等威胁';
                }
                return row.threat_level.toUpperCase();
              })();
              const takeaway = lang === 'zh' ? row.ai_takeaway_zh : row.ai_takeaway_en;
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
                            ? `${row.review_count.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')} ${lang === 'zh' ? '条评论' : 'reviews'}`
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
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                        {lang === 'zh' ? '代表产品' : 'Signature items'}
                      </div>
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
                      <span className="font-medium">
                        {lang === 'zh' ? '高频好评：' : 'Top praise: '}
                      </span>
                      {row.top_praise.join(' · ')}
                    </div>
                  )}
                  {row.top_complaints.length > 0 && (
                    <div className="mt-1 text-[11px] text-rose-200/80">
                      <span className="font-medium">
                        {lang === 'zh' ? '高频差评：' : 'Top complaints: '}
                      </span>
                      {row.top_complaints.join(' · ')}
                    </div>
                  )}
                  {row.pricing_perception && (
                    <div className="mt-1 text-[11px] text-zinc-400">
                      <span className="font-medium">
                        {lang === 'zh' ? '价格感知：' : 'Pricing perception: '}
                      </span>
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

          {(lang === 'zh' ? competitorInsights.cluster_summary_zh : competitorInsights.cluster_summary_en) && (
            <div className="mt-4 rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4 text-sm leading-relaxed text-zinc-200">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
                {lang === 'zh' ? '竞品集群总结' : 'Cluster summary'}
              </div>
              <p>
                {lang === 'zh'
                  ? competitorInsights.cluster_summary_zh
                  : competitorInsights.cluster_summary_en}
              </p>
            </div>
          )}

          {(lang === 'zh' ? competitorInsights.gaps_and_openings_zh : competitorInsights.gaps_and_openings_en) && (
            <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-4 text-sm leading-relaxed text-emerald-100">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-emerald-300/80">
                {lang === 'zh' ? '可切入的市场缺口' : 'Gaps & openings'}
              </div>
              <p>
                {lang === 'zh'
                  ? competitorInsights.gaps_and_openings_zh
                  : competitorInsights.gaps_and_openings_en}
              </p>
            </div>
          )}

          <div className="mt-3 text-[10px] text-zinc-500">
            {lang === 'zh'
              ? `由 ${competitorInsights.provider} (${competitorInsights.model}) 基于 Google Place Details + Yelp Fusion 评论摘要生成`
              : `Generated by ${competitorInsights.provider} (${competitorInsights.model}) from Google Place Details + Yelp Fusion review excerpts`}
          </div>
        </SectionShell>
      )}

      {costs.length > 0 && (
        <SectionShell title={t.costModel} icon="💵">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead>
                <tr className="border-b border-zinc-700 text-xs uppercase text-zinc-500">
                  <th className="py-2 pr-4">{lang === 'zh' ? '项目' : 'Item'}</th>
                  <th className="py-2 pr-4">{lang === 'zh' ? '金额' : 'Amount'}</th>
                  <th className="py-2">{lang === 'zh' ? '说明' : 'Note'}</th>
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
