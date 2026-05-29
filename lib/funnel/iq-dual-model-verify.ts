/**
 * C-5: cross-provider verification of decision_tier / scores after paid report generation.
 */
import type { IqReportWithGrounding } from '@/lib/funnel/iq-full-report-schema';
import { normalizeRiskAuditFromFull } from '@/lib/funnel/iq-risk-audit-model';
import {
  type IqLlmProvider,
  resolveIqCrossVerifyRoute,
  runIqProviderJsonOnRoute,
} from '@/lib/funnel/iq-provider-router';

type VerifySnapshot = {
  decision_tier?: string;
  overall_score?: number;
  verdict_line?: string;
  matrix: Array<{ dimension: string; score_100?: number }>;
};

type VerifyLlmPayload = {
  decision_tier?: string;
  overall_score?: number;
  verdict_one_line?: string;
  decision_matrix?: Array<{ dimension?: string; score_100?: number }>;
  rationale?: string;
};

export function isDualVerifyEnabled(): boolean {
  const v = process.env.IQ_ENABLE_DUAL_VERIFY?.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
}

function numScore(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function normalizeTier(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

function extractSnapshot(report: Record<string, unknown>): VerifySnapshot {
  const audit = normalizeRiskAuditFromFull(report);
  const matrix = Array.isArray(report.decision_matrix)
    ? (report.decision_matrix as Record<string, unknown>[])
        .map((row) => ({
          dimension: typeof row.dimension === 'string' ? row.dimension.trim() : '',
          score_100: numScore(row.score_100),
        }))
        .filter((r) => r.dimension.length > 0)
    : [];

  return {
    decision_tier: normalizeTier(
      audit?.decision_tier ?? (report.decision_tier as string | undefined),
    ),
    overall_score: numScore(audit?.overall_score),
    verdict_line:
      audit?.one_line_conclusion ??
      (typeof report.one_line_conclusion === 'string'
        ? report.one_line_conclusion
        : typeof report.final_verdict === 'string'
          ? report.final_verdict
          : undefined),
    matrix,
  };
}

function buildVerifyPrompts(
  snapshot: VerifySnapshot,
  opts: { location: string; businessType: string | null; language: 'en' | 'zh' },
): { system: string; user: string } {
  const lang = opts.language;
  const system =
    lang === 'zh'
      ? '你是独立的选址决策审计员。仅根据给定摘要复核 decision_tier 与分数，输出严格 JSON，不要 Markdown。'
      : 'You are an independent location-decision auditor. Re-score only from the summary; output strict JSON only, no markdown.';

  const user =
    lang === 'zh'
      ? [
          `地址：${opts.location}`,
          opts.businessType ? `业态：${opts.businessType}` : '',
          '主模型结论摘要（勿编造竞品名）：',
          JSON.stringify(
            {
              decision_tier: snapshot.decision_tier,
              overall_score: snapshot.overall_score,
              verdict_one_line: snapshot.verdict_line,
              decision_matrix: snapshot.matrix,
            },
            null,
            2,
          ),
          '',
          '返回 JSON：',
          '{',
          '  "decision_tier": "strong_go|go_with_conditions|need_more_data|high_risk|no_go",',
          '  "overall_score": 0-100,',
          '  "verdict_one_line": "一句签租建议",',
          '  "decision_matrix": [{"dimension":"...","score_100":0-100}],',
          '  "rationale": "≤120字复核理由"',
          '}',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `Address: ${opts.location}`,
          opts.businessType ? `Concept: ${opts.businessType}` : '',
          'Primary model summary (do not invent competitor names):',
          JSON.stringify(
            {
              decision_tier: snapshot.decision_tier,
              overall_score: snapshot.overall_score,
              verdict_one_line: snapshot.verdict_line,
              decision_matrix: snapshot.matrix,
            },
            null,
            2,
          ),
          '',
          'Return JSON:',
          '{',
          '  "decision_tier": "strong_go|go_with_conditions|need_more_data|high_risk|no_go",',
          '  "overall_score": 0-100,',
          '  "verdict_one_line": "one-line sign/conditional/no recommendation",',
          '  "decision_matrix": [{"dimension":"...","score_100":0-100}],',
          '  "rationale": "≤120 char review note"',
          '}',
        ]
          .filter(Boolean)
          .join('\n');

  return { system, user };
}

function compareSnapshots(
  primary: VerifySnapshot,
  verify: VerifySnapshot,
  lang: 'en' | 'zh',
): { aligned: boolean; disagreements: string[] } {
  const disagreements: string[] = [];

  if (primary.decision_tier && verify.decision_tier) {
    if (primary.decision_tier !== verify.decision_tier) {
      disagreements.push(
        lang === 'zh'
          ? '签租建议档位与独立复核不一致，建议结合现场调研再定'
          : 'Sign/lease recommendation tier differs from independent review—confirm on site',
      );
    }
  }

  if (primary.overall_score !== undefined && verify.overall_score !== undefined) {
    const delta = Math.abs(primary.overall_score - verify.overall_score);
    if (delta > 8) {
      disagreements.push(
        lang === 'zh'
          ? `综合评分差距较大（约 ${delta.toFixed(0)} 分），建议人工核对`
          : `Overall score differs by ~${delta.toFixed(0)} points—manual review recommended`,
      );
    }
  }

  const primaryMap = new Map(primary.matrix.map((r) => [r.dimension.toLowerCase(), r.score_100]));
  for (const row of verify.matrix) {
    const key = row.dimension.toLowerCase();
    const p = primaryMap.get(key);
    if (p !== undefined && row.score_100 !== undefined && Math.abs(p - row.score_100) > 12) {
      disagreements.push(
        lang === 'zh'
          ? `「${row.dimension}」维度评分差异明显，建议重点核实`
          : `"${row.dimension}" scores differ materially—verify this dimension`,
      );
    }
  }

  return { aligned: disagreements.length === 0, disagreements };
}

function downgradeConfidence(report: Record<string, unknown>): void {
  const raw = typeof report.confidence === 'string' ? report.confidence : '';
  if (/high/i.test(raw)) {
    report.confidence = 'Medium';
  } else if (/medium/i.test(raw)) {
    report.confidence = 'Low';
  } else if (!raw) {
    report.confidence = 'Low';
  }
}

/**
 * Run C-5 verify pass and stamp dual_model_verification on the report.
 */
export async function applyDualModelVerification(
  report: IqReportWithGrounding,
  opts: {
    language: 'en' | 'zh';
    location: string;
    businessType: string | null;
    primaryProvider?: string;
    primaryModel?: string;
    reportSource?: 'n8n' | 'llm';
  },
): Promise<IqReportWithGrounding> {
  if (!isDualVerifyEnabled()) return report;

  const primaryProvider = (opts.primaryProvider ||
    (typeof report._generation_provider === 'string'
      ? report._generation_provider
      : 'openai')) as IqLlmProvider;

  const route = resolveIqCrossVerifyRoute(primaryProvider);
  if (!route) {
    console.warn('[iq-dual-verify] no verify route available; skipping');
    return report;
  }

  const primarySnap = extractSnapshot(report as Record<string, unknown>);
  if (!primarySnap.decision_tier && primarySnap.overall_score === undefined) {
    console.warn('[iq-dual-verify] insufficient decision fields; skipping');
    return report;
  }

  const { system, user } = buildVerifyPrompts(primarySnap, {
    location: opts.location,
    businessType: opts.businessType,
    language: opts.language,
  });

  try {
    const routed = await runIqProviderJsonOnRoute<VerifyLlmPayload>({
      route,
      system,
      user,
    });
    if (!routed?.data) {
      console.warn('[iq-dual-verify] verify LLM returned empty');
      return report;
    }

    const verifySnap: VerifySnapshot = {
      decision_tier: normalizeTier(routed.data.decision_tier),
      overall_score: numScore(routed.data.overall_score),
      verdict_line:
        typeof routed.data.verdict_one_line === 'string'
          ? routed.data.verdict_one_line
          : undefined,
      matrix: Array.isArray(routed.data.decision_matrix)
        ? routed.data.decision_matrix
            .map((row) => ({
              dimension:
                typeof row.dimension === 'string' ? row.dimension.trim() : '',
              score_100: numScore(row.score_100),
            }))
            .filter((r) => r.dimension.length > 0)
        : [],
    };

    const { aligned, disagreements } = compareSnapshots(
      primarySnap,
      verifySnap,
      opts.language,
    );

    const lang = opts.language;
    const status = aligned
      ? lang === 'zh'
        ? '结论已复核 ✓'
        : 'Conclusion reviewed ✓'
      : lang === 'zh'
        ? '存在待核对项'
        : 'Needs your review';

    report.dual_model_verification = {
      status,
      disagreements: disagreements.length > 0 ? disagreements : undefined,
    };

    if (typeof report._generation_model !== 'string' && opts.primaryModel) {
      report._generation_model = opts.primaryModel;
    }
    if (typeof report._generation_provider !== 'string' && opts.primaryProvider) {
      report._generation_provider = opts.primaryProvider;
    }
    report._verify_provider = routed.provider;
    report._verify_model = routed.model;

    if (!aligned) {
      downgradeConfidence(report as Record<string, unknown>);
      const w = Array.isArray(report._warnings) ? (report._warnings as string[]) : [];
      report._warnings = [
        ...w,
        lang === 'zh'
          ? '部分结论与独立复核不一致，已下调置信度；请结合报告中的待核对项人工确认。'
          : 'Some conclusions differ from independent review; confidence lowered—confirm flagged items.',
      ];
    }

    console.log(
      `[iq-dual-verify] ${aligned ? 'aligned' : 'divergent'} primary=${primaryProvider} verify=${routed.provider}/${routed.model} disagreements=${disagreements.length}`,
    );
  } catch (e) {
    console.warn('[iq-dual-verify] failed:', e);
  }

  return report;
}
