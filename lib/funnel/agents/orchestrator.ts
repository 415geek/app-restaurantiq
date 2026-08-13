/**
 * Multi-agent report orchestrator.
 *
 * Pipeline (mirrors a professional site-selection engagement):
 *   1. Deterministic metrics        — formulas over real data (metrics.ts)
 *   2. Five specialists in parallel — market / competition / site / financial / risk
 *   3. Deterministic decision matrix — V2.0 weights applied in code, not by the LLM
 *   4. Synthesis writer             — partner-level memo in the existing report schema
 *   5. Critic review                — consistency check; one revision pass if it fails
 *
 * The synthesis model may organize and phrase, but the scorecard numbers, scenario
 * anchors, and competitor tables come from the deterministic layer + specialists.
 */

import OpenAI from 'openai';
import { parseIqFullReport, logFullReportQuality } from '@/lib/funnel/iq-full-report-schema';
import { computeSiteMetrics, formatMetricsDigest } from './metrics';
import { SPECIALISTS, runSpecialist, type SpecialistInput } from './specialists';
import type { AgentTrace, CriticReview, Lang, SiteMetrics, SpecialistFinding } from './types';

/** V2.0 weights — single source of truth for free AND premium tiers. */
export const SCORE_WEIGHTS = {
  foot_traffic: 0.25,
  demographic_fit: 0.2,
  competition: 0.2,
  accessibility: 0.2,
  rent_value: 0.15,
} as const;

export type DecisionMatrixRow = {
  dimension: string;
  score_100: number;
  weight_pct: number;
  weighted_score: number;
};

function client(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured (multi-agent engine)');
  return new OpenAI({ apiKey: key });
}

function synthesisModel(): string {
  return (
    process.env.OPENAI_IQ_FULL_MODEL?.trim() ||
    process.env.OPENAI_IQ_MODEL?.trim() ||
    'gpt-4o'
  );
}

function criticModel(): string {
  return (
    process.env.OPENAI_IQ_AGENT_MODEL?.trim() ||
    process.env.OPENAI_IQ_MODEL?.trim() ||
    'gpt-4o-mini'
  );
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pickScore(f: SpecialistFinding | undefined, payloadKey?: string): number | null {
  if (!f) return null;
  if (payloadKey && f.payload && typeof f.payload[payloadKey] === 'number') {
    return clamp100(f.payload[payloadKey] as number);
  }
  return clamp100(f.score_100);
}

/**
 * Build the decision matrix in code. Missing specialists degrade to a 50 neutral score
 * with the gap disclosed, rather than silently skewing the composite.
 */
export function buildDecisionMatrix(
  findings: Map<string, SpecialistFinding>,
  lang: Lang,
): { rows: DecisionMatrixRow[]; composite: number; gaps: string[] } {
  const zh = lang === 'zh';
  const gaps: string[] = [];
  const dims: Array<{ key: keyof typeof SCORE_WEIGHTS; label: string; score: number | null }> = [
    {
      key: 'foot_traffic',
      label: zh ? '客流潜力' : 'Foot traffic potential',
      score: pickScore(findings.get('site'), 'foot_traffic_score_100'),
    },
    {
      key: 'demographic_fit',
      label: zh ? '人群匹配' : 'Demographic fit',
      score: pickScore(findings.get('market')),
    },
    {
      key: 'competition',
      label: zh ? '竞争位势' : 'Competitive position',
      score: pickScore(findings.get('competition')),
    },
    {
      key: 'accessibility',
      label: zh ? '可达性' : 'Accessibility',
      score: pickScore(findings.get('site'), 'accessibility_score_100'),
    },
    {
      key: 'rent_value',
      label: zh ? '租金性价比' : 'Rent value',
      score: pickScore(findings.get('financial')),
    },
  ];

  const rows: DecisionMatrixRow[] = dims.map((d) => {
    let s = d.score;
    if (s == null) {
      s = 50;
      gaps.push(
        zh
          ? `${d.label}：对应分析师缺席，按中性 50 分计入`
          : `${d.label}: specialist unavailable — neutral 50 applied`,
      );
    }
    const weightPct = SCORE_WEIGHTS[d.key] * 100;
    return {
      dimension: d.label,
      score_100: s,
      weight_pct: weightPct,
      weighted_score: Math.round(s * SCORE_WEIGHTS[d.key] * 10) / 10,
    };
  });

  const composite = clamp100(rows.reduce((sum, r) => sum + r.weighted_score, 0));
  return { rows, composite, gaps };
}

export function tierFromComposite(score: number, lang: Lang): string {
  const zh = lang === 'zh';
  if (score >= 80) return zh ? '🟢 强烈推荐' : '🟢 Strong recommend';
  if (score >= 60) return zh ? '🟡 值得考虑' : '🟡 Worth considering';
  if (score >= 40) return zh ? '🟠 谨慎评估' : '🟠 High caution';
  return zh ? '🔴 不建议' : '🔴 Avoid';
}

function specialistBlock(f: SpecialistFinding): string {
  return [
    `### ${f.discipline} (score ${f.score_100}, confidence ${f.confidence})`,
    `Rationale: ${f.score_rationale}`,
    `Key findings: ${f.key_findings.join(' | ')}`,
    `Narrative:\n${f.narrative}`,
    f.payload ? `Structured payload:\n${JSON.stringify(f.payload, null, 1).slice(0, 5_000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function synthesisSystem(lang: Lang): string {
  return lang === 'zh'
    ? [
        '你是选址咨询公司的合伙人，负责把专家团队的分析整合成客户可直接决策的正式报告。',
        '铁律：',
        '1. 决策矩阵（decision_matrix）与综合分已由系统计算，必须原样填入，禁止改动任何数值。',
        '2. 专家的 key_findings 一条都不能丢；竞对表、风险矩阵、营收场景直接采用专家 payload（可润色文字，不可改数字）。',
        '3. 所有章节保持「事实→影响→建议」结构；数据缺口须在 data_sources_and_disclaimer 与相应章节明示。',
        '4. dashboard.overall_score 必须等于系统给出的综合分。',
        '5. 输出严格 JSON，字段结构见用户消息末尾的 schema 说明；正文字段用 Markdown。',
      ].join('\n')
    : [
        'You are the engagement partner at a site-selection consultancy, assembling specialist analyses into a client-ready decision report.',
        'Hard rules:',
        '1. The decision_matrix and composite score were computed by the system — copy them verbatim; never alter any number.',
        '2. No specialist key_finding may be dropped; adopt competitor tables, risk matrix, and revenue scenarios directly from specialist payloads (you may polish prose, never numbers).',
        '3. Every section keeps fact → impact → action structure; data gaps must be disclosed in data_sources_and_disclaimer and the affected sections.',
        '4. dashboard.overall_score MUST equal the system-computed composite.',
        '5. Output strict JSON per the schema notes at the end of the user message; section bodies are Markdown.',
      ].join('\n');
}

function synthesisUser(input: {
  location: string;
  businessType: string;
  headline: string;
  reason: string;
  language: Lang;
  metrics: SiteMetrics;
  findings: SpecialistFinding[];
  matrix: DecisionMatrixRow[];
  composite: number;
  matrixGaps: string[];
  critique?: CriticReview;
}): string {
  const zh = input.language === 'zh';
  const parts = [
    zh ? `地址：${input.location}` : `Address: ${input.location}`,
    zh ? `业态：${input.businessType}` : `Concept: ${input.businessType}`,
    zh
      ? `免费版结论（保持连续性，不可矛盾）：${input.headline} — ${input.reason}`
      : `Free-tier verdict (keep continuity, no contradiction): ${input.headline} — ${input.reason}`,
    '',
    formatMetricsDigest(input.metrics, input.language),
    '',
    zh ? '【系统计算的决策矩阵（原样填入 decision_matrix）】' : '[SYSTEM-COMPUTED DECISION MATRIX (copy into decision_matrix verbatim)]',
    JSON.stringify({ rows: input.matrix, composite: input.composite, tier: tierFromComposite(input.composite, input.language), gaps: input.matrixGaps }, null, 1),
    '',
    zh ? '【专家分析】' : '[SPECIALIST ANALYSES]',
    ...input.findings.map(specialistBlock),
    '',
    zh
      ? [
          '输出 JSON 字段（LocationIQ V2 报告 schema）：',
          'report_title, dashboard{overall_score(=综合分), foot_traffic_index, competition_intensity, payback_months, recommendation},',
          'executive_summary(≥350字), final_verdict, trade_area_analysis(用 market 专家 narrative),',
          'demographic_profile, competition_landscape, site_and_access_assessment(用 site 专家 narrative),',
          'revenue_estimate, revenue_model{methodology(注明三角验证法), scenarios(=financial payload), sensitivity, breakeven, monthly_costs_note},',
          'competitors(=competition payload), risk_matrix(=risk payload), risks, failure_scenarios(=risk payload),',
          'opportunities, differentiation_strategy, acquisition_channels, action_plan_structured(6-10条含owner/budget_band/success_metric/timeframe), action_plan,',
          'comparables{success_cases, failure_cases}, decision_matrix(=系统矩阵), key_evidence_points(≥6条带来源标签),',
          'confidence(高/中/低), confidence_rationale, data_sources_and_disclaimer, alternative_corridors(如有数据)',
        ].join('\n')
      : [
          'Output JSON fields (LocationIQ V2 report schema):',
          'report_title, dashboard{overall_score(=composite), foot_traffic_index, competition_intensity, payback_months, recommendation},',
          'executive_summary(≥250 words), final_verdict, trade_area_analysis(from market specialist narrative),',
          'demographic_profile, competition_landscape, site_and_access_assessment(from site specialist narrative),',
          'revenue_estimate, revenue_model{methodology(state the triangulation), scenarios(=financial payload), sensitivity, breakeven, monthly_costs_note},',
          'competitors(=competition payload), risk_matrix(=risk payload), risks, failure_scenarios(=risk payload),',
          'opportunities, differentiation_strategy, acquisition_channels, action_plan_structured(6-10 rows w/ owner/budget_band/success_metric/timeframe), action_plan,',
          'comparables{success_cases, failure_cases}, decision_matrix(=system matrix), key_evidence_points(≥6 with source tags),',
          'confidence(High/Medium/Low), confidence_rationale, data_sources_and_disclaimer, alternative_corridors(when data exists)',
        ].join('\n'),
  ];

  if (input.critique && !input.critique.passed) {
    parts.push(
      '',
      zh
        ? `【质检未通过——修订要求（必须逐条解决）】\n${input.critique.critical_issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
        : `[CRITIC REVIEW FAILED — revision requirements (address every item)]\n${input.critique.critical_issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    );
  }
  return parts.join('\n');
}

async function runSynthesis(
  input: Parameters<typeof synthesisUser>[0],
): Promise<Record<string, unknown>> {
  const c = client();
  const completion = await c.chat.completions.create({
    model: synthesisModel(),
    messages: [
      { role: 'system', content: synthesisSystem(input.language) },
      { role: 'user', content: synthesisUser(input) },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 16_000,
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Empty synthesis response');
  return JSON.parse(text) as Record<string, unknown>;
}

async function runCritic(
  report: Record<string, unknown>,
  metrics: SiteMetrics,
  matrix: DecisionMatrixRow[],
  composite: number,
  lang: Lang,
): Promise<CriticReview> {
  const c = client();
  const zh = lang === 'zh';
  const system = zh
    ? '你是报告质检官。只输出 JSON：{"passed": bool, "critical_issues": [...], "minor_issues": [...]}。critical=数字与计算指标矛盾、决策矩阵被改动、章节缺失、场景数≠3、竞对用了A/B/C占位名、风险矩阵<5行；minor=表述可改进。'
    : 'You are the report QA reviewer. Output only JSON: {"passed": bool, "critical_issues": [...], "minor_issues": [...]}. critical = numbers contradict computed metrics, decision matrix altered, missing sections, scenario count ≠ 3, placeholder competitor names (A/B/C), risk matrix < 5 rows; minor = phrasing improvements.';
  const user = [
    zh ? '【计算指标（真值）】' : '[COMPUTED METRICS (ground truth)]',
    formatMetricsDigest(metrics, lang),
    zh ? '【系统决策矩阵（真值）】' : '[SYSTEM DECISION MATRIX (ground truth)]',
    JSON.stringify({ rows: matrix, composite }),
    zh ? '【待审报告】' : '[REPORT UNDER REVIEW]',
    JSON.stringify(report).slice(0, 40_000),
  ].join('\n');

  try {
    const completion = await c.chat.completions.create({
      model: criticModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1_500,
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) return { passed: true, critical_issues: [], minor_issues: [] };
    const parsed = JSON.parse(text) as Partial<CriticReview>;
    return {
      passed: parsed.passed !== false,
      critical_issues: Array.isArray(parsed.critical_issues) ? parsed.critical_issues.map(String) : [],
      minor_issues: Array.isArray(parsed.minor_issues) ? parsed.minor_issues.map(String) : [],
    };
  } catch (e) {
    console.warn('[multi-agent] critic failed, passing report through:', e);
    return { passed: true, critical_issues: [], minor_issues: [] };
  }
}

export type MultiAgentReportInput = {
  location: string;
  businessType: string | null;
  headline: string;
  reason: string;
  marketData?: Record<string, unknown>;
  language?: Lang;
  reportId?: string;
};

/**
 * Full multi-agent premium report. Throws when too few specialists succeed so the
 * caller can fall back to the legacy single-call path.
 */
export async function runMultiAgentFullReport(
  input: MultiAgentReportInput,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const language: Lang = input.language === 'zh' ? 'zh' : 'en';
  const businessType = input.businessType || 'restaurant';
  const marketData = input.marketData ?? {};

  const metrics = computeSiteMetrics({ marketData, businessType });

  const specialistInput: SpecialistInput = {
    location: input.location,
    businessType,
    language,
    metrics,
    marketData,
  };

  const settled = await Promise.allSettled(
    SPECIALISTS.map((def) => runSpecialist(def, specialistInput)),
  );

  const findings = new Map<string, SpecialistFinding>();
  const failed: string[] = [];
  settled.forEach((r, i) => {
    const name = SPECIALISTS[i].discipline;
    if (r.status === 'fulfilled') findings.set(name, r.value);
    else {
      failed.push(name);
      console.warn(`[multi-agent] specialist ${name} failed:`, r.reason);
    }
  });

  if (findings.size < 3) {
    throw new Error(
      `Multi-agent engine: only ${findings.size}/5 specialists succeeded (failed: ${failed.join(', ')})`,
    );
  }

  const { rows: matrix, composite, gaps: matrixGaps } = buildDecisionMatrix(findings, language);

  const synthesisInput = {
    location: input.location,
    businessType,
    headline: input.headline,
    reason: input.reason,
    language,
    metrics,
    findings: [...findings.values()],
    matrix,
    composite,
    matrixGaps,
  };

  let report = await runSynthesis(synthesisInput);

  const critique = await runCritic(report, metrics, matrix, composite, language);
  let revisionApplied = false;
  if (!critique.passed && critique.critical_issues.length > 0) {
    console.log('[multi-agent] critic flagged issues, running revision:', critique.critical_issues);
    try {
      report = await runSynthesis({ ...synthesisInput, critique });
      revisionApplied = true;
    } catch (e) {
      console.warn('[multi-agent] revision pass failed, keeping first draft:', e);
    }
  }

  // Deterministic fields always win over whatever the model wrote.
  const dashboard =
    report.dashboard && typeof report.dashboard === 'object' && !Array.isArray(report.dashboard)
      ? (report.dashboard as Record<string, unknown>)
      : {};
  report.dashboard = {
    ...dashboard,
    overall_score: composite,
    recommendation: tierFromComposite(composite, language),
  };
  report.decision_matrix = matrix.map((r) => ({ ...r }));

  const trace: AgentTrace = {
    engine: 'multi_agent_v1',
    specialists_run: [...findings.keys()],
    specialists_failed: failed,
    critic_passed: critique.passed,
    revision_applied: revisionApplied,
    total_ms: Date.now() - started,
  };
  report.agent_trace = trace as unknown as Record<string, unknown>;
  report.computed_metrics = metrics as unknown as Record<string, unknown>;

  const parsed = parseIqFullReport(report);
  logFullReportQuality(parsed, `multi-agent reportId=${input.reportId ?? 'n/a'}`);
  return parsed;
}
