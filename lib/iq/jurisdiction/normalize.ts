/**
 * §4.8.5 normaliser: adapter outcomes (+ the E3 site-history signal) → exactly
 * the spec's `property_facts` shape plus `jurisdiction_coverage`.
 *
 * Invariants:
 *   · `null` means 未获取 and is NEVER inferred or filled. An adapter that ran
 *     and found no row leaves the fact `null` and records `no_match` — address
 *     strings mismatch far too often for "no row" to mean "no permit".
 *   · `year_built` and `use_code` are E4 context only. Nothing in this file
 *     lets them touch `hood_permit_found` or `prior_food_facility`, which is
 *     the v2 logic hole this section exists to close.
 *   · No branch reads a residential / commercial listing blurb (E5).
 */

import type { PriorTenantSignal } from '@/lib/funnel/external-data/site-history';
import { matchedKeywords, rowText } from './adapters';
import type {
  AdapterOutcome,
  JurisdictionRegistryRow,
  PropertyFact,
  PropertyFacts,
} from './types';
import { emptyPropertyFacts } from './types';

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function firstString(row: Record<string, unknown>, field: string | undefined): string | null {
  if (!field) return null;
  const v = row[field];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** A plausible construction year; anything outside the range is discarded, not clamped. */
export function parseYearBuilt(v: unknown): number | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : String(v);
  const m = s.match(/\b(1[6-9]\d{2}|20\d{2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const maxYear = new Date().getUTCFullYear() + 1;
  return n >= 1600 && n <= maxYear ? n : null;
}

function sourceLabel(row: JurisdictionRegistryRow | null, outcome: AdapterOutcome): string {
  let host = outcome.endpoint;
  try {
    const u = new URL(outcome.endpoint);
    host = `${u.host}${u.pathname}`;
  } catch {
    /* keep the raw endpoint */
  }
  return `${row?.name ?? '未知辖区'} · ${outcome.evidence} ${outcome.type} (${host})`;
}

function byEvidence(outcomes: readonly AdapterOutcome[], evidence: AdapterOutcome['evidence']): AdapterOutcome[] {
  return outcomes.filter((o) => o.evidence === evidence);
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * 0..1. The registry's declared `coverage_score`, scaled by how many of its
 * *implementable* adapters actually answered (`ok` or a clean `no_match`).
 * No row, or a row with nothing implementable, is exactly 0 — the "未接入" case.
 */
export function computeCoverage(row: JurisdictionRegistryRow | null, outcomes: readonly AdapterOutcome[]): number {
  if (!row) return 0;
  const declared = row.adapters.filter((a) => a.type !== 'none');
  if (declared.length === 0) return 0;
  const answered = outcomes.filter(
    (o) => o.type !== 'none' && (o.status === 'ok' || o.status === 'no_match'),
  ).length;
  if (answered === 0) return 0;
  return Math.round(Math.min(1, Math.max(0, row.coverage_score)) * (answered / declared.length) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface NormalizeInput {
  row: JurisdictionRegistryRow | null;
  outcomes: readonly AdapterOutcome[];
  /** E3 — prior tenant concept from lib/funnel/external-data/site-history.ts. */
  priorTenant?: PriorTenantSignal | null;
  now: Date;
}

export interface NormalizeResult {
  property_facts: PropertyFacts;
  jurisdiction_coverage: number;
  /** Why each absent fact is absent, keyed by fact name. */
  gap_reasons: Record<keyof PropertyFacts, string | null>;
}

export function normalizeJurisdictionFacts(input: NormalizeInput): NormalizeResult {
  const { row, outcomes, priorTenant, now } = input;
  const facts = emptyPropertyFacts();
  const gaps: Record<keyof PropertyFacts, string | null> = {
    prior_food_facility: null,
    hood_permit_found: null,
    year_built: null,
    use_code: null,
  };

  // ---- E1: health-department food-facility permit history -----------------
  const e1 = byEvidence(outcomes, 'E1');
  const e1Hit = e1.find((o) => o.status === 'ok' && o.matched_rows > 0);
  if (e1Hit) {
    const spec = row?.adapters.find((a) => a.evidence === 'E1' && a.endpoint === e1Hit.endpoint);
    const first = e1Hit.rows[0] ?? {};
    const facility = firstString(first, spec?.fields?.facility_name);
    const permitType = firstString(first, spec?.fields?.permit_type);
    const date = firstString(first, spec?.fields?.date);
    const bits = [facility, permitType && permitType !== facility ? permitType : null, date]
      .filter(Boolean)
      .join(' · ');
    facts.prior_food_facility = {
      value: true,
      evidence: 'E1',
      detail: `${e1Hit.matched_rows} 条食品设施许可/检查记录${bits ? `（${bits}）` : ''}`,
      source: sourceLabel(row, e1Hit),
      license: e1Hit.license,
      retrieved_at: e1Hit.retrieved_at,
      confidence: 'high',
    } satisfies PropertyFact<boolean>;
  } else if (e1.length > 0) {
    gaps.prior_food_facility = `E1 ${e1[0].status}: ${e1[0].reason ?? '无结果'}`;
  }

  // ---- E2: building / mechanical permits mentioning hood, grease, exhaust --
  const e2 = byEvidence(outcomes, 'E2');
  const e2Hit = e2.find((o) => o.status === 'ok' && o.keyword_rows > 0);
  if (e2Hit) {
    const spec = row?.adapters.find((a) => a.evidence === 'E2' && a.endpoint === e2Hit.endpoint);
    const kw = [...new Set(e2Hit.rows.flatMap((r) => matchedKeywords(r, spec?.keyword_filter)))].slice(0, 4);
    const first = e2Hit.rows[0] ?? {};
    const desc = firstString(first, spec?.fields?.description);
    const date = firstString(first, spec?.fields?.date);
    const detailBits = [kw.length ? kw.join(' / ') : null, desc ? desc.slice(0, 120) : null, date]
      .filter(Boolean)
      .join('；');
    facts.hood_permit_found = {
      value: true,
      evidence: 'E2',
      detail: `${e2Hit.keyword_rows} 条含机械排烟/隔油关键词的许可记录${detailBits ? `（${detailBits}）` : ''}`,
      source: sourceLabel(row, e2Hit),
      license: e2Hit.license,
      retrieved_at: e2Hit.retrieved_at,
      confidence: 'high',
    } satisfies PropertyFact<boolean>;
    // A permitted kitchen hood at this address is itself proof of prior
    // commercial food use — but only when E1 did not already answer it.
    if (!facts.prior_food_facility) {
      facts.prior_food_facility = {
        value: true,
        evidence: 'E2',
        detail: `由机械排烟/隔油许可记录反推：${kw.join(' / ') || '排烟相关许可'}`,
        source: sourceLabel(row, e2Hit),
        license: e2Hit.license,
        retrieved_at: e2Hit.retrieved_at,
        confidence: 'medium',
      } satisfies PropertyFact<boolean>;
    }
  } else if (e2.length > 0) {
    const o = e2[0];
    gaps.hood_permit_found =
      o.status === 'ok'
        ? `E2 ok: 该地址有 ${o.matched_rows} 条许可记录，但无排烟/隔油关键词命中（不等于没有排烟罩）`
        : `E2 ${o.status}: ${o.reason ?? '无结果'}`;
  } else {
    gaps.hood_permit_found = 'E2 未接入: 本辖区未声明建筑/机械许可端点';
  }

  // ---- E3: prior tenant concept (zero-cost, §4.8.1) ------------------------
  if (!facts.prior_food_facility && priorTenant && priorTenant.concept === 'hot_kitchen') {
    facts.prior_food_facility = {
      value: true,
      evidence: 'E3',
      detail: `${priorTenant.detail}——热厨业态意味着该址大概率已具备商用厨房条件，但未经许可记录证实`,
      source: priorTenant.source,
      license: 'Public domain summary of Google Places / Yelp listing facts (business name, category, status)',
      retrieved_at: now.toISOString(),
      confidence: 'low',
    } satisfies PropertyFact<boolean>;
  } else if (!facts.prior_food_facility && !gaps.prior_food_facility) {
    gaps.prior_food_facility = priorTenant
      ? `E3 仅见「${priorTenant.prior_business_name ?? '未具名'}」（${priorTenant.concept}），不足以证明热厨用途`
      : 'E1/E2 未接入且无前租户记录';
  }

  // ---- E4: assessor use code / year built (context only) -------------------
  const e4 = byEvidence(outcomes, 'E4');
  const e4Hit = e4.find((o) => o.status === 'ok' && o.matched_rows > 0);
  if (e4Hit) {
    const spec = row?.adapters.find((a) => a.evidence === 'E4' && a.endpoint === e4Hit.endpoint);
    const first = e4Hit.rows.find((r) => isRec(r)) ?? {};
    const year = parseYearBuilt(spec?.fields?.year_built ? first[spec.fields.year_built] : undefined);
    if (year != null) {
      facts.year_built = {
        value: year,
        evidence: 'E4',
        detail: '县评估局记录的建成年份；仅作物业背景，不得据此推断排烟/电力条件',
        source: sourceLabel(row, e4Hit),
        license: e4Hit.license,
        retrieved_at: e4Hit.retrieved_at,
        confidence: 'medium',
      } satisfies PropertyFact<number>;
    } else {
      gaps.year_built = 'E4 ok: 记录中无可解析的建成年份字段';
    }
    const use = firstString(first, spec?.fields?.use_code);
    if (use) {
      facts.use_code = {
        value: use,
        evidence: 'E4',
        detail: '县评估局用途分类代码',
        source: sourceLabel(row, e4Hit),
        license: e4Hit.license,
        retrieved_at: e4Hit.retrieved_at,
        confidence: 'medium',
      } satisfies PropertyFact<string>;
    } else {
      gaps.use_code = 'E4 ok: 记录中无用途代码字段';
    }
  } else {
    const reason = e4.length > 0 ? `E4 ${e4[0].status}: ${e4[0].reason ?? '无结果'}` : 'E4 未接入: 本辖区未声明评估局端点';
    gaps.year_built = gaps.year_built ?? reason;
    gaps.use_code = gaps.use_code ?? reason;
  }

  return {
    property_facts: facts,
    jurisdiction_coverage: computeCoverage(row, outcomes),
    gap_reasons: gaps,
  };
}

/** Debug helper: the text an E2 row was matched on (used by tests and ops). */
export function describeRow(row: Record<string, unknown>): string {
  return rowText(row).slice(0, 200);
}
