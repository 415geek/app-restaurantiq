'use client';

import { CompetitorMap } from '@/components/iq/CompetitorMap';
import { RiskAuditScorecard } from '@/components/iq/RiskAuditScorecard';
import { buildCompetitorMapPins } from '@/lib/funnel/iq-competitor-map';
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
                <div className="text-xs uppercase tracking-wide text-amber-200/70">{t.breakEven}</div>
                <div className="mt-1 text-xl font-semibold text-amber-100">
                  ${breakEven.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
                  {lang === 'zh' ? '/月' : '/mo'}
                </div>
              </div>
            )}
            {safeRev !== undefined && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-emerald-200/70">{t.safeRevenue}</div>
                <div className="mt-1 text-xl font-semibold text-emerald-100">
                  ${safeRev.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
                  {lang === 'zh' ? '/月' : '/mo'}
                </div>
              </div>
            )}
          </div>
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
