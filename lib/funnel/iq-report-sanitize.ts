/**
 * Remove internal provider/model telemetry before persisting or returning reports.
 */
import type { IqReportWithGrounding } from '@/lib/funnel/iq-full-report-schema';

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
      if (/mimo|openai|tavily|deepseek|gpt-/i.test(t)) return false;
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
        .replace(/mimo|openai/gi, 'alternate engine')
        .trim(),
    )
    .filter((w) => w.length > 0);
  return out.length > 0 ? out : undefined;
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

  return out as IqReportWithGrounding;
}
