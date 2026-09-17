/**
 * Remove internal provider/model telemetry before persisting or returning reports,
 * and drop prose that came back structurally corrupted (评审 Spec v2 §4.6 P1-g:
 * 「门店née点计数器」 reached a paying customer in v2 testing).
 */
import type { IqReportWithGrounding } from '@/lib/funnel/iq-full-report-schema';
import { formatTextQuality, scanTextQuality, scrubCorruptedSentences, type TextQualityReport } from '@/lib/funnel/iq-text-quality';

const INTERNAL_KEYS = [
  '_generation_provider',
  '_generation_model',
  '_generation_task',
  '_verify_provider',
  '_verify_model',
  '_llm_completeness_score',
] as const;

function scrubDisclaimer(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/双模型|Dual-model|主模型|Report LLM|报告主模型|复核.*→|→\s*复核/i.test(t)) {
        return false;
      }
      if (/mimo|openai|tavily|deepseek|gpt-|anthropic|claude|opus|sonnet|gemini/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function scrubWarnings(warnings: unknown): string[] | undefined {
  if (!Array.isArray(warnings)) return undefined;
  const out = warnings
    .filter((w): w is string => typeof w === 'string')
    .map((w) =>
      w
        .replace(/Primary\s+[\w/]+\s+failed[^.]*\./gi, '')
        .replace(/mimo|openai|anthropic|claude|opus|sonnet|gemini|deepseek/gi, 'alternate engine')
        .trim(),
    )
    .filter((w) => w.length > 0);
  return out.length > 0 ? out : undefined;
}

/** Longest strings first so one log line shows the worst offender. */
const TEXT_SCAN_MIN_LENGTH = 12;

/**
 * Walk every string in the report, drop sentences with structural corruption and
 * report what was seen. Rare-but-legitimate characters (a competitor's name) are
 * only counted, never removed — `context` carries the report's own data so those
 * characters are recognised.
 */
export function scrubCorruptedReportText(
  report: IqReportWithGrounding,
  opts: { context?: string } = {},
): { report: IqReportWithGrounding; quality: TextQualityReport; removedSentences: number } {
  const findings: TextQualityReport['findings'] = [];
  let removedSentences = 0;

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value.length < TEXT_SCAN_MIN_LENGTH) return value;
      const scan = scanTextQuality(value, opts);
      findings.push(...scan.findings);
      if (scan.ok) return value;
      const { text, removed } = scrubCorruptedSentences(value, opts);
      removedSentences += removed;
      // A field that is nothing but corruption becomes empty; keep the original
      // rather than shipping an empty section the renderer would still print.
      return text.trim() ? text : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = walk(v);
      return o;
    }
    return value;
  };

  const scrubbed = walk(report) as IqReportWithGrounding;
  const corrupt = findings.filter((f) => f.severity === 'corrupt').length;
  const quality: TextQualityReport = { findings, corrupt, suspect: findings.length - corrupt, ok: corrupt === 0 };
  if (findings.length) console.warn(`[iq-report] ${formatTextQuality(quality)}`);
  return { report: scrubbed, quality, removedSentences };
}

export function stripInternalIqReportFields(
  report: IqReportWithGrounding,
): IqReportWithGrounding {
  const out = { ...report } as Record<string, unknown>;

  for (const key of INTERNAL_KEYS) {
    delete out[key];
  }

  const dv = out.dual_model_verification;
  if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
    const d = dv as Record<string, unknown>;
    out.dual_model_verification = {
      status: typeof d.status === 'string' ? d.status : undefined,
      disagreements: Array.isArray(d.disagreements) ? d.disagreements : undefined,
    };
  }

  if (typeof out.data_sources_and_disclaimer === 'string') {
    out.data_sources_and_disclaimer = scrubDisclaimer(out.data_sources_and_disclaimer);
  }

  const scrubbedWarnings = scrubWarnings(out._warnings);
  if (scrubbedWarnings) out._warnings = scrubbedWarnings;
  else delete out._warnings;

  // Structural corruption is context-independent, so every caller gets the text
  // guard without having to pass the report's own vocabulary; rare characters
  // are only counted here (suspect findings never modify the text).
  return scrubCorruptedReportText(out as IqReportWithGrounding).report;
}
