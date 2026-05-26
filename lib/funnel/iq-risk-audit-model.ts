import { z } from 'zod';

/** Five-tier lease decision — product-facing (not legacy go/caution/no). */
export const decisionTierSchema = z.enum([
  'strong_go',
  'go_with_conditions',
  'need_more_data',
  'high_risk',
  'no_go',
]);

export type DecisionTier = z.infer<typeof decisionTierSchema>;

export const SCORE_LAYER_IDS = [
  'location_base',
  'cuisine_fit',
  'competition_pressure',
  'revenue_potential',
  'cost_pressure',
  'success_probability',
] as const;

export type ScoreLayerId = (typeof SCORE_LAYER_IDS)[number];

export const scoreLayerRowSchema = z.object({
  id: z.string(),
  score: z.union([z.number(), z.string()]).optional(),
  label: z.string().optional(),
  note: z.string().optional(),
});

export const riskAuditPreviewSchema = z.object({
  product_line: z.string().optional(),
  decision_tier: decisionTierSchema.optional(),
  overall_score: z.union([z.number(), z.string()]).optional(),
  one_line_conclusion: z.string().optional(),
  layers: z.array(scoreLayerRowSchema).optional(),
  radar: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  data_confidence_pct: z.union([z.number(), z.string()]).optional(),
  missing_data: z.array(z.string()).optional(),
  acquired_data: z.array(z.string()).optional(),
});

export const costBreakdownRowSchema = z.object({
  item: z.string(),
  amount_usd: z.union([z.number(), z.string()]).optional(),
  note: z.string().optional(),
});

export const riskAuditFullSchema = riskAuditPreviewSchema.extend({
  location_base_score: z.union([z.number(), z.string()]).optional(),
  cuisine_fit_score: z.union([z.number(), z.string()]).optional(),
  competition_pressure_score: z.union([z.number(), z.string()]).optional(),
  revenue_potential_score: z.union([z.number(), z.string()]).optional(),
  cost_pressure_score: z.union([z.number(), z.string()]).optional(),
  success_probability_score: z.union([z.number(), z.string()]).optional(),
  break_even_revenue_monthly_usd: z.union([z.number(), z.string()]).optional(),
  safe_revenue_monthly_usd: z.union([z.number(), z.string()]).optional(),
  top_risks: z.array(z.string()).optional(),
  playbook: z.array(z.string()).optional(),
  lease_checklist: z.array(z.string()).optional(),
  cost_breakdown: z.array(costBreakdownRowSchema).optional(),
  competitor_tiers_note: z.string().optional(),
});

export type RiskAuditPreview = z.infer<typeof riskAuditPreviewSchema>;
export type RiskAuditFull = z.infer<typeof riskAuditFullSchema>;

export type IqLocale = 'en' | 'zh';

const DECISION_TIER_COPY: Record<DecisionTier, Record<IqLocale, { label: string; desc: string }>> = {
  strong_go: {
    en: { label: 'Strong Go', desc: 'Strong fit — proceed toward lease diligence.' },
    zh: { label: '强烈推荐', desc: '匹配度高，可推进租约尽调。' },
  },
  go_with_conditions: {
    en: { label: 'Go with Conditions', desc: 'Viable only if cost, menu, and ops constraints are met.' },
    zh: { label: '有条件可做', desc: '满足租金、菜单与运营约束后再签。' },
  },
  need_more_data: {
    en: { label: 'Need More Data', desc: 'Add rent, size, or lease terms before signing.' },
    zh: { label: '需补充数据', desc: '请补充租金、面积或租约条款后再决策。' },
  },
  high_risk: {
    en: { label: 'High Risk', desc: 'Material downside — avoid signing without renegotiation.' },
    zh: { label: '高风险', desc: '下行风险显著，未重谈条件前不建议签。' },
  },
  no_go: {
    en: { label: 'No Go', desc: 'Not recommended for this concept at this site.' },
    zh: { label: '不建议', desc: '该址与当前业态组合不建议推进。' },
  },
};

const LAYER_LABELS: Record<ScoreLayerId, Record<IqLocale, string>> = {
  location_base: { en: 'Location base', zh: '位置基础分' },
  cuisine_fit: { en: 'Cuisine fit', zh: '业态匹配' },
  competition_pressure: { en: 'Competition pressure', zh: '竞争压力' },
  revenue_potential: { en: 'Revenue potential', zh: '营收潜力' },
  cost_pressure: { en: 'Cost pressure', zh: '成本压力' },
  success_probability: { en: 'Success probability', zh: '成功概率' },
};

const RADAR_LABELS: Record<string, Record<IqLocale, string>> = {
  location_potential: { en: 'Location potential', zh: '位置潜力' },
  cuisine_match: { en: 'Cuisine match', zh: '业态匹配' },
  competition_pressure: { en: 'Competition pressure', zh: '竞争压力' },
  spending_power_match: { en: 'Spending power', zh: '消费力匹配' },
  delivery_potential: { en: 'Delivery potential', zh: '外卖潜力' },
  cost_pressure: { en: 'Cost pressure', zh: '成本压力' },
  success_probability: { en: 'Success probability', zh: '成功概率' },
};

export function parseDecisionTier(raw: unknown): DecisionTier | undefined {
  const r = decisionTierSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

export function decisionTierDisplay(tier: DecisionTier | undefined, lang: IqLocale) {
  if (!tier) return null;
  return DECISION_TIER_COPY[tier][lang];
}

export function layerLabel(id: string, lang: IqLocale): string {
  const key = id as ScoreLayerId;
  return LAYER_LABELS[key]?.[lang] ?? id;
}

export function radarLabel(key: string, lang: IqLocale): string {
  return RADAR_LABELS[key]?.[lang] ?? key.replace(/_/g, ' ');
}

/** Map 5-tier decision to legacy verdict for DB / Stripe flows. */
export function decisionTierToVerdict(tier: DecisionTier | undefined): 'go' | 'caution' | 'no' {
  switch (tier) {
    case 'strong_go':
      return 'go';
    case 'go_with_conditions':
    case 'need_more_data':
      return 'caution';
    case 'high_risk':
    case 'no_go':
      return 'no';
    default:
      return 'caution';
  }
}

export function parseRiskAuditPreview(raw: unknown): RiskAuditPreview | undefined {
  const r = riskAuditPreviewSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

export function parseRiskAuditFull(raw: unknown): RiskAuditFull | undefined {
  const r = riskAuditFullSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

export function numScore(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n)) return Math.round(n);
  }
  return undefined;
}

const HIGHER_SCORE_IS_WORSE_IDS = new Set<ScoreLayerId>(['competition_pressure', 'cost_pressure']);

/** True when a higher raw 0–100 score means worse outcome (pressure / cost burden). */
export function isHigherScoreWorseLayer(id: string): boolean {
  if (HIGHER_SCORE_IS_WORSE_IDS.has(id as ScoreLayerId)) return true;
  if (id.includes('competition')) return true;
  return id.includes('cost') && id.includes('pressure');
}

/** Progress bar width always equals the displayed score (0–100). */
export function scoreBarWidthPercent(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Bar color resolved as inline-style hex so Tailwind purge cannot drop it.
 * Favorability is dimension-aware: higher pressure → less favorable.
 */
export function scoreBarColorHex(score: number, higherIsWorse: boolean): string {
  const favorable = higherIsWorse ? 100 - score : score;
  if (favorable >= 75) return '#34d399'; // emerald-400
  if (favorable >= 55) return '#fbbf24'; // amber-400
  return '#fb7185'; // rose-400
}

export function scoreLayerFootnote(lang: IqLocale): string {
  return lang === 'zh'
    ? '条形长度与右侧分数一致（0–100）。竞争压力、成本压力：分数越高表示压力越大，颜色反映压力强弱（高分偏红、低分偏绿）。'
    : 'Bar length matches the score (0–100). For competition/cost pressure, higher scores mean more pressure; color shows intensity (high = red, low = green).';
}

/** Build preview object from flat layer scores when LLM returns legacy shape. */
export function normalizeRiskAuditFromFull(full: Record<string, unknown>): RiskAuditFull | undefined {
  const direct = parseRiskAuditFull(full.risk_audit);
  if (direct) return direct;

  const tier = parseDecisionTier(full.decision_tier);
  const overall = numScore(
    (full.risk_audit as Record<string, unknown> | undefined)?.overall_score ??
      (full.dashboard as Record<string, unknown> | undefined)?.overall_score,
  );

  const layers: RiskAuditFull['layers'] = SCORE_LAYER_IDS.map((id) => {
    const flatKey = `${id}_score`;
    const fromRa = (full.risk_audit as Record<string, unknown> | undefined)?.[flatKey];
    const score = numScore(fromRa ?? full[flatKey]);
    return score !== undefined ? { id, score } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  if (!tier && overall === undefined && layers.length === 0) return undefined;

  return {
    decision_tier: tier,
    overall_score: overall,
    one_line_conclusion:
      typeof full.one_line_conclusion === 'string'
        ? full.one_line_conclusion
        : typeof full.final_verdict === 'string'
          ? full.final_verdict
          : undefined,
    layers,
    data_confidence_pct: numScore(full.data_confidence_pct),
    top_risks: Array.isArray(full.top_risks)
      ? full.top_risks.filter((x): x is string => typeof x === 'string')
      : Array.isArray(full.risks)
        ? full.risks.filter((x): x is string => typeof x === 'string').slice(0, 3)
        : undefined,
    lease_checklist: Array.isArray(full.lease_checklist)
      ? full.lease_checklist.filter((x): x is string => typeof x === 'string')
      : undefined,
  };
}

export function productPositioningLine(lang: IqLocale): string {
  return lang === 'zh'
    ? '餐饮选址风险审计 · 签 lease 前用数据算清能不能活'
    : 'Location Risk Audit · Know if this site can work before you sign the lease';
}
