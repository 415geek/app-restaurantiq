/**
 * JSON Schema for Claude structured outputs on the paid full report.
 *
 * Why: a production report failed after 188s of decoding because the 19KB
 * document was not valid JSON (stop_reason=end_turn, repair could not recover
 * it) — the whole paid run was lost to a formatting defect. With
 * `output_config.format` the API constrains decoding to this schema, so the
 * document is always parseable and the repair path is never needed.
 *
 * Constraints of the structured-outputs JSON-schema subset:
 * - every object needs `additionalProperties: false`
 * - no `propertyNames` / record-style objects (radar is pinned to known keys)
 * - no numeric/string constraints (none exist in the report schema)
 */

import { z } from 'zod';
import { iqFullReportSchema } from '@/lib/funnel/iq-full-report-schema';
import { riskAuditFullSchema } from '@/lib/funnel/iq-risk-audit-model';

const RADAR_KEYS = [
  'location_potential',
  'cuisine_match',
  'competition_pressure',
  'spending_power_match',
  'delivery_potential',
  'cost_pressure',
  'success_probability',
] as const;

const numOrStr = z.union([z.number(), z.string()]);

const radarFixed = z.object(
  Object.fromEntries(RADAR_KEYS.map((k) => [k, numOrStr.optional()])) as Record<
    (typeof RADAR_KEYS)[number],
    z.ZodOptional<typeof numOrStr>
  >,
);

/** The zod report schema with record-typed fields pinned to enumerable keys. */
export const iqFullReportStructuredSchema = iqFullReportSchema.extend({
  risk_audit: riskAuditFullSchema.extend({ radar: radarFixed.optional() }).optional(),
  // Site-history review analysis (populated from the address-level review pack).
  site_history: z
    .object({
      prior_failures_detected: z.union([z.boolean(), z.string()]).optional(),
      note: z.string().optional(),
      prior_business_name: z.string().optional(),
      prior_business_status: z.string().optional(),
      review_themes_positive: z.array(z.string()).optional(),
      review_themes_negative: z.array(z.string()).optional(),
      lessons_for_new_operator: z.array(z.string()).optional(),
    })
    .optional(),
});

const DROP_KEYS = new Set([
  '$schema',
  'propertyNames',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'default',
  'examples',
]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (DROP_KEYS.has(k)) continue;
    if (k === 'additionalProperties') continue; // re-set below for objects
    out[k] = strictify(v);
  }
  if (out.type === 'object' || out.properties) {
    out.type = 'object';
    if (!out.properties) out.properties = {};
    out.additionalProperties = false;
  }
  return out;
}

let cached: Record<string, unknown> | null = null;

/** Strict JSON Schema (memoized) for `output_config.format`. */
export function getIqFullReportJsonSchema(): Record<string, unknown> {
  if (cached) return cached;
  const raw = z.toJSONSchema(iqFullReportStructuredSchema, { unrepresentable: 'any' });
  cached = strictify(raw) as Record<string, unknown>;
  return cached;
}

/** Env kill-switch: IQ_STRUCTURED_OUTPUT=false reverts to prompt-only JSON. */
export function structuredOutputEnabled(): boolean {
  return (process.env.IQ_STRUCTURED_OUTPUT?.trim().toLowerCase() ?? '') !== 'false';
}
