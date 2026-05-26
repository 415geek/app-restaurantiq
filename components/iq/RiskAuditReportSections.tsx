'use client';

import { CompetitorMap } from '@/components/iq/CompetitorMap';
import { RiskAuditScorecard } from '@/components/iq/RiskAuditScorecard';
import { buildCompetitorMapPins } from '@/lib/funnel/iq-competitor-map';
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
