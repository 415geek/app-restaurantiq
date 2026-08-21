'use client';

import {
  decisionTierDisplay,
  isHigherScoreWorseLayer,
  layerLabel,
  numScore,
  parseDecisionTier,
  radarLabel,
  scoreBarColorHex,
  scoreBarWidthPercent,
  scoreLayerFootnote,
  type IqLocale,
  type RiskAuditPreview,
} from '@/lib/funnel/iq-risk-audit-model';

type Props = {
  audit: RiskAuditPreview;
  lang: IqLocale;
  businessType?: string;
  compact?: boolean;
};

function ScoreBar({ score, higherIsWorse }: { score: number; higherIsWorse?: boolean }) {
  const width = scoreBarWidthPercent(score);
  const color = scoreBarColorHex(score, Boolean(higherIsWorse));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function RiskAuditScorecard({ audit, lang, businessType, compact }: Props) {
  const tier = parseDecisionTier(audit.decision_tier);
  const tierCopy = decisionTierDisplay(tier, lang);
  const overall = numScore(audit.overall_score);
  const layers = audit.layers ?? [];
  const radar = audit.radar ?? {};
  const radarEntries = Object.entries(radar).filter(([, v]) => numScore(v) !== undefined);

  const tierColors: Record<string, string> = {
    strong_go: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
    go_with_conditions: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
    need_more_data: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
    high_risk: 'border-orange-500/40 bg-orange-500/15 text-orange-200',
    no_go: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  };

  return (
    <div className="space-y-5">
      {audit.one_line_conclusion && (
        <p className="text-base leading-relaxed text-white/85 md:text-lg">{audit.one_line_conclusion}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {tierCopy && tier && (
          <span
            className={`inline-block rounded-full border px-4 py-1.5 text-sm font-semibold ${tierColors[tier] ?? 'border-white/20 bg-white/10 text-white/80'}`}
          >
            {tierCopy.label}
          </span>
        )}
        {overall !== undefined && (
          <span className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/90">
            {lang === 'zh' ? `综合 ${overall}/100` : `Overall ${overall}/100`}
          </span>
        )}
        {audit.data_confidence_pct !== undefined && (
          <span className="text-xs text-white/50">
            {lang === 'zh'
              ? `数据置信度 ${numScore(audit.data_confidence_pct) ?? audit.data_confidence_pct}%`
              : `Data confidence ${numScore(audit.data_confidence_pct) ?? audit.data_confidence_pct}%`}
          </span>
        )}
      </div>

      {tierCopy && !compact && (
        <p className="text-sm text-white/55">{tierCopy.desc}</p>
      )}

      {businessType && (
        <p className="text-xs uppercase tracking-wide text-white/40">
          {lang === 'zh' ? `业态：${businessType}` : `Concept: ${businessType}`}
        </p>
      )}

      {layers.length > 0 && (
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            {layers.map((row) => {
              const s = numScore(row.score);
              if (s === undefined) return null;
              const higherIsWorse = isHigherScoreWorseLayer(row.id);
              return (
                <div key={row.id} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                    <span className="text-white/70">{row.label || layerLabel(row.id, lang)}</span>
                    <span className="font-semibold text-white tabular-nums">{s}</span>
                  </div>
                  <ScoreBar score={s} higherIsWorse={higherIsWorse} />
                  {row.note && <p className="mt-2 text-xs text-white/45">{row.note}</p>}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-white/35">{scoreLayerFootnote(lang)}</p>
        </div>
      )}

      {radarEntries.length > 0 && !compact && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
            {lang === 'zh' ? '多维评分' : 'Score dimensions'}
          </h3>
          <div className="space-y-2">
            {radarEntries.map(([key, val]) => {
              const s = numScore(val)!;
              const higherIsWorse = isHigherScoreWorseLayer(key);
              return (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-xs text-white/60">
                    <span>{radarLabel(key, lang)}</span>
                    <span className="tabular-nums">{s}</span>
                  </div>
                  <ScoreBar score={s} higherIsWorse={higherIsWorse} />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-white/35">{scoreLayerFootnote(lang)}</p>
        </div>
      )}

      {(audit.missing_data?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/80">
          <div className="mb-1 font-medium">
            {lang === 'zh' ? '缺失数据（补充后可显著提高精度）' : 'Missing inputs (add for higher accuracy)'}
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-amber-100/60">
            {audit.missing_data!.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
