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
  type RiskAuditPreview,
} from '@/lib/funnel/iq-risk-audit-model';
import { dimensionLabel, verdictLabelOf, type Conclusion } from '@/lib/iq/conclusion/display';
import type { Locale } from '@/lib/i18n/locale';
import { tierPill, ui } from '@/components/iq/ui';

type Props = {
  audit: RiskAuditPreview;
  lang: Locale;
  businessType?: string;
  compact?: boolean;
  /**
   * §4.1 单一结论源 (P0-A): when the report carries the stored conclusion, the score,
   * the verdict, the data confidence and the six dimension bars are read from IT —
   * never from the LLM's `risk_audit` — so this card can never disagree with the PDF.
   */
  conclusion?: Conclusion | null;
  /**
   * The printed verdict rule, generated server-side from the ONE threshold set
   * (`verdictRuleText`) and carried on the report body, so the page and the PDF
   * quote the same numbers.
   */
  verdictRule?: string | null;
};

const COPY: Record<
  Locale,
  {
    overall: (n: number) => string;
    confidence: (n: string | number) => string;
    concept: (c: string) => string;
    dimensions: string;
    missing: string;
  }
> = {
  en: {
    overall: (n) => `Overall ${n}/100`,
    confidence: (n) => `Data confidence ${n}%`,
    concept: (c) => `Concept: ${c}`,
    dimensions: 'Score dimensions',
    missing: 'Missing inputs (add them for higher accuracy)',
  },
  zh: {
    overall: (n) => `综合 ${n}/100`,
    confidence: (n) => `数据置信度 ${n}%`,
    concept: (c) => `业态：${c}`,
    dimensions: '多维评分',
    missing: '缺失数据（补充后可显著提高精度）',
  },
  es: {
    overall: (n) => `General ${n}/100`,
    confidence: (n) => `Confianza de los datos ${n}%`,
    concept: (c) => `Concepto: ${c}`,
    dimensions: 'Dimensiones de la puntuación',
    missing: 'Datos faltantes (agrégalos para mayor precisión)',
  },
};

function ScoreBar({ score, higherIsWorse }: { score: number; higherIsWorse?: boolean }) {
  const width = scoreBarWidthPercent(score);
  const color = scoreBarColorHex(score, Boolean(higherIsWorse));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-zinc-200"
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

export function RiskAuditScorecard({ audit, lang, businessType, compact, conclusion, verdictRule }: Props) {
  const t = COPY[lang];
  const tier = parseDecisionTier(audit.decision_tier);
  const tierCopy = decisionTierDisplay(tier, lang);
  // The conclusion wins over every LLM-written figure on this card.
  const overall = conclusion ? conclusion.overall : numScore(audit.overall_score);
  const confidencePct = conclusion ? conclusion.data_confidence_pct : numScore(audit.data_confidence_pct) ?? audit.data_confidence_pct;
  const layers = conclusion
    ? conclusion.dimensions.map((d) => ({ id: d.id, score: d.score, label: dimensionLabel(d.id, lang), note: `${d.weight}% × ${d.score}` }))
    : audit.layers ?? [];
  const radar = audit.radar ?? {};
  const radarEntries = Object.entries(radar).filter(([, v]) => numScore(v) !== undefined);

  return (
    <div className="space-y-5">
      {audit.one_line_conclusion && (
        <p className="text-base leading-relaxed text-zinc-800 md:text-lg">{audit.one_line_conclusion}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {tierCopy && tier && (
          <span className={`inline-block rounded-full border px-4 py-1.5 text-sm font-semibold ${tierPill[tier] ?? ui.pill.neutral}`}>
            {conclusion ? verdictLabelOf(conclusion.verdict, lang) : tierCopy.label}
          </span>
        )}
        {overall !== undefined && (
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-semibold tabular-nums text-brand-navy">
            {t.overall(overall)}
          </span>
        )}
        {confidencePct !== undefined && (
          <span className="text-xs text-zinc-500">{t.confidence(confidencePct)}</span>
        )}
      </div>

      {conclusion && verdictRule && !compact && <p className="text-xs text-zinc-500">{verdictRule}</p>}

      {tierCopy && !compact && (
        <p className="text-sm text-zinc-600">{tierCopy.desc}</p>
      )}

      {businessType && (
        <p className={ui.kicker}>{t.concept(businessType)}</p>
      )}

      {layers.length > 0 && (
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            {layers.map((row) => {
              const s = numScore(row.score);
              if (s === undefined) return null;
              const higherIsWorse = isHigherScoreWorseLayer(row.id);
              return (
                <div key={row.id} className={`${ui.inset} px-4 py-3`}>
                  <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                    <span className="text-zinc-600">{row.label || layerLabel(row.id, lang)}</span>
                    <span className="font-semibold tabular-nums text-brand-navy">{s}</span>
                  </div>
                  <ScoreBar score={s} higherIsWorse={higherIsWorse} />
                  {row.note && <p className="mt-2 text-xs text-zinc-500">{row.note}</p>}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">{scoreLayerFootnote(lang)}</p>
        </div>
      )}

      {radarEntries.length > 0 && !compact && (
        <div>
          <h3 className={`mb-3 ${ui.kicker}`}>{t.dimensions}</h3>
          <div className="space-y-2">
            {radarEntries.map(([key, val]) => {
              const s = numScore(val)!;
              const higherIsWorse = isHigherScoreWorseLayer(key);
              return (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-xs text-zinc-600">
                    <span>{radarLabel(key, lang)}</span>
                    <span className="tabular-nums">{s}</span>
                  </div>
                  <ScoreBar score={s} higherIsWorse={higherIsWorse} />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">{scoreLayerFootnote(lang)}</p>
        </div>
      )}

      {(audit.missing_data?.length ?? 0) > 0 && (
        <div className={`${ui.notice} text-xs`}>
          <div className="mb-1 font-medium">{t.missing}</div>
          <ul className="list-inside list-disc space-y-0.5 text-brand-ochre">
            {audit.missing_data!.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
