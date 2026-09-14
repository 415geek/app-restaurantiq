/**
 * Free-tier analyze idempotency (评审 Spec §4.5).
 *
 * `POST /api/funnel/analyze` is keyed by the normalized inputs: the same
 * address + concept + rent + size + language within 24 h returns the stored
 * row instead of re-running the LLM and creating a duplicate
 * `iq_location_reports` row. The key lives in `market_data_json.analyze_key`
 * (no migration) and the free result itself in `market_data_json.free_result`
 * so the canonical `/iq/result/<reportId>` page can render without the LLM.
 */
import { createHash } from 'node:crypto';
import { toLocale, type Locale } from '@/lib/i18n/locale';

export const ANALYZE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type AnalyzeInputs = {
  location: string;
  businessType?: string | null;
  monthlyRentUsd?: number | string | null;
  sqft?: number | string | null;
  language?: string | null;
  /** Resolved taxonomy id (user pick or classifier); part of the key so a different confirmed concept is a different analysis. */
  conceptId?: string | null;
};

export type NormalizedAnalyzeInputs = {
  location: string;
  businessType: string;
  monthlyRentUsd: number | null;
  sqft: number | null;
  language: Locale;
  conceptId: string;
};

/** "  123 Main St.,  San Francisco , CA " → "123 main st, san francisco, ca". */
export function normalizeLocation(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[　\s]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/[.\s,]+$/g, '')
    .trim();
}

export function normalizeBusinessType(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[　\s]+/g, ' ')
    .replace(/[.\s,;:!?。，；：！？]+$/g, '')
    .trim();
}

/** Positive finite number (accepts "$12,000" / "2,200"), rounded to an integer; anything else → null. */
export function normalizeMoneyOrSize(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function normalizeAnalyzeInputs(input: AnalyzeInputs): NormalizedAnalyzeInputs {
  return {
    location: normalizeLocation(input.location),
    businessType: normalizeBusinessType(input.businessType),
    monthlyRentUsd: normalizeMoneyOrSize(input.monthlyRentUsd),
    sqft: normalizeMoneyOrSize(input.sqft),
    language: toLocale(input.language),
    conceptId: String(input.conceptId ?? '').trim(),
  };
}

/** Stable sha256 (hex) over the normalized inputs. */
export function analyzeCacheKey(input: AnalyzeInputs): string {
  const n = normalizeAnalyzeInputs(input);
  const material = JSON.stringify([
    'analyze-v1',
    n.location,
    n.businessType,
    n.monthlyRentUsd,
    n.sqft,
    n.language,
    n.conceptId,
  ]);
  return createHash('sha256').update(material).digest('hex');
}

export function analyzeCacheSinceIso(now: number = Date.now()): string {
  return new Date(now - ANALYZE_CACHE_TTL_MS).toISOString();
}

/** True when a row created at `createdAt` is still inside the idempotency window. */
export function isAnalyzeCacheFresh(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && now - t >= 0 && now - t < ANALYZE_CACHE_TTL_MS;
}

/** The free-tier payload persisted in `market_data_json.free_result`. */
export type StoredFreeResult = {
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
  decision_tier?: string;
  risk_audit_preview?: Record<string, unknown>;
};

export function readStoredFreeResult(marketData: unknown): StoredFreeResult | null {
  if (!marketData || typeof marketData !== 'object' || Array.isArray(marketData)) return null;
  const fr = (marketData as Record<string, unknown>).free_result;
  if (!fr || typeof fr !== 'object' || Array.isArray(fr)) return null;
  const o = fr as Record<string, unknown>;
  const verdict = typeof o.verdict === 'string' ? o.verdict : '';
  const headline = typeof o.headline === 'string' ? o.headline : '';
  if (!verdict || !headline) return null;
  return {
    verdict,
    headline,
    subheadline: typeof o.subheadline === 'string' ? o.subheadline : undefined,
    market_snapshot: Array.isArray(o.market_snapshot)
      ? o.market_snapshot.filter((x): x is string => typeof x === 'string')
      : undefined,
    hidden_risk: typeof o.hidden_risk === 'string' ? o.hidden_risk : undefined,
    paywall_teaser: typeof o.paywall_teaser === 'string' ? o.paywall_teaser : undefined,
    decision_tier: typeof o.decision_tier === 'string' ? o.decision_tier : undefined,
    risk_audit_preview:
      o.risk_audit_preview && typeof o.risk_audit_preview === 'object' && !Array.isArray(o.risk_audit_preview)
        ? (o.risk_audit_preview as Record<string, unknown>)
        : undefined,
  };
}
