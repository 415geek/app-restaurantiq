/**
 * §4.8.2 关键设计约束 / §4.8.4 — discovery is CONFIGURATION, not live scraping.
 *
 * An unknown jurisdiction must never make a report go hunting for endpoints.
 * `resolveJurisdictionFacts` takes the declared fallback path immediately and
 * (at most) records that the jurisdiction is missing. This module is the
 * separate, asynchronous entry point that fills the gap:
 *
 *   · it is never called from the report path;
 *   · it writes a DRAFT registry row (`verified_by: 'auto'`) with a
 *     `coverage_score`, and only a persisted row is ever used afterwards;
 *   · a total failure still writes a row — `adapters: []` plus the reason — so
 *     the next report reads "nothing here" instead of retrying.
 *
 * All IO is injected (`DiscoveryDeps`). With no `findCandidates` dep the
 * function makes no network calls at all, which is how the tests run it.
 */

import type { JurisdictionAdapterSpec, JurisdictionRegistryRow, EvidenceLevel } from './types';
import { IMPLEMENTED_ADAPTER_TYPES } from './types';
import type { JurisdictionStore } from './registry';

/** How much of the ladder each evidence level is worth in `coverage_score`. */
export const EVIDENCE_WEIGHT: Record<EvidenceLevel, number> = { E1: 0.45, E2: 0.3, E3: 0, E4: 0.15, E5: 0 };

/** A candidate endpoint proposed by whatever discovery mechanism is plugged in. */
export interface DiscoveryCandidate extends JurisdictionAdapterSpec {
  /** 0..1 — how sure the proposer is that this endpoint answers this evidence level. */
  confidence: number;
}

export interface DiscoveryDeps {
  store: JurisdictionStore;
  /**
   * Proposes candidate endpoints. Supplied by the ops job (web search + portal
   * catalogues). Absent → discovery records a failure row and returns.
   */
  findCandidates?: (input: { jurisdictionId: string; name: string }) => Promise<DiscoveryCandidate[]>;
  /**
   * Optional live probe of one candidate (a single query against a known
   * address). Absent → candidates are kept but `coverage_score` is discounted,
   * since nothing has actually been proven to answer.
   */
  probe?: (candidate: DiscoveryCandidate) => Promise<boolean>;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface DiscoveryOptions {
  jurisdictionId: string;
  name: string;
  /** Compute the row but do not persist it. */
  dryRun?: boolean;
}

export interface DiscoveryResult {
  row: JurisdictionRegistryRow;
  persisted: boolean;
  probed: number;
  candidates: number;
}

/** Discount applied when nothing could be probed — a paper adapter is not a working one. */
export const UNPROBED_DISCOUNT = 0.6;

function scoreCoverage(adapters: readonly JurisdictionAdapterSpec[], probed: boolean): number {
  const levels = new Set(adapters.filter((a) => IMPLEMENTED_ADAPTER_TYPES.includes(a.type)).map((a) => a.evidence));
  const raw = [...levels].reduce((s, e) => s + (EVIDENCE_WEIGHT[e] ?? 0), 0);
  const scaled = probed ? raw : raw * UNPROBED_DISCOUNT;
  return Math.round(Math.min(1, Math.max(0, scaled)) * 100) / 100;
}

function failureRow(id: string, name: string, at: string, reason: string): JurisdictionRegistryRow {
  return {
    jurisdiction_id: id,
    name,
    adapters: [],
    coverage_score: 0,
    verified_at: at,
    verified_by: 'auto',
    notes: `discovery_failed: ${reason}（已落库，下次报告不再重试；需人工补录或更换发现源）`,
  };
}

/**
 * Asynchronous discovery entry point. Never throws; always returns the row it
 * wrote (or would have written under `dryRun`).
 */
export async function discoverJurisdiction(
  opts: DiscoveryOptions,
  deps: DiscoveryDeps,
): Promise<DiscoveryResult> {
  const now = (deps.now ?? (() => new Date()))();
  const at = now.toISOString();
  const log = deps.log ?? (() => {});
  const id = String(opts.jurisdictionId ?? '').trim();
  const name = String(opts.name ?? '').trim() || id;

  if (!/^\d{5}$|^\d{7}$/.test(id)) {
    const row = failureRow(id || 'unknown', name, at, 'bad_jurisdiction_id（非 5 位县 FIPS / 7 位 place GEOID）');
    return { row, persisted: false, probed: 0, candidates: 0 };
  }

  if (!deps.findCandidates) {
    const row = failureRow(id, name, at, 'no_discovery_source（未配置候选端点发现器）');
    if (!opts.dryRun) await deps.store.put(row);
    log(`[jurisdiction/discovery] ${id} no discovery source → adapters: []`);
    return { row, persisted: !opts.dryRun, probed: 0, candidates: 0 };
  }

  let candidates: DiscoveryCandidate[] = [];
  try {
    candidates = (await deps.findCandidates({ jurisdictionId: id, name })) ?? [];
  } catch (e) {
    const row = failureRow(id, name, at, `candidate_lookup_error: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    if (!opts.dryRun) await deps.store.put(row);
    return { row, persisted: !opts.dryRun, probed: 0, candidates: 0 };
  }

  // Keep the best candidate per evidence level, implemented types first.
  const best = new Map<EvidenceLevel, DiscoveryCandidate>();
  for (const c of candidates) {
    if (!c || !c.endpoint || !/^https:\/\//i.test(c.endpoint)) continue;
    const prev = best.get(c.evidence);
    const rank = (x: DiscoveryCandidate) => (IMPLEMENTED_ADAPTER_TYPES.includes(x.type) ? 1 : 0) + (Number(x.confidence) || 0);
    if (!prev || rank(c) > rank(prev)) best.set(c.evidence, c);
  }

  if (best.size === 0) {
    const row = failureRow(id, name, at, `no_usable_candidate（发现器返回 ${candidates.length} 条，无一可用）`);
    if (!opts.dryRun) await deps.store.put(row);
    return { row, persisted: !opts.dryRun, probed: 0, candidates: candidates.length };
  }

  let probed = 0;
  const adapters: JurisdictionAdapterSpec[] = [];
  for (const c of best.values()) {
    if (deps.probe) {
      let ok = false;
      try {
        ok = await deps.probe(c);
      } catch {
        ok = false;
      }
      if (!ok) {
        log(`[jurisdiction/discovery] ${id} ${c.evidence} ${c.type} probe failed → dropped`);
        continue;
      }
      probed += 1;
    }
    const spec: JurisdictionAdapterSpec = {
      evidence: c.evidence,
      type: c.type,
      endpoint: c.endpoint,
      license: c.license,
    };
    if (c.address_field) spec.address_field = c.address_field;
    if (c.keyword_filter?.length) spec.keyword_filter = c.keyword_filter;
    if (c.fields) spec.fields = c.fields;
    adapters.push(spec);
  }

  if (adapters.length === 0) {
    const row = failureRow(id, name, at, `all_probes_failed（${best.size} 个候选端点均未通过探测）`);
    if (!opts.dryRun) await deps.store.put(row);
    return { row, persisted: !opts.dryRun, probed, candidates: candidates.length };
  }

  const row: JurisdictionRegistryRow = {
    jurisdiction_id: id,
    name,
    adapters: adapters.sort((a, b) => a.evidence.localeCompare(b.evidence)),
    coverage_score: scoreCoverage(adapters, probed > 0),
    verified_at: at,
    verified_by: 'auto',
    notes: `discovery_draft: 自动发现 ${adapters.length} 个端点（${probed > 0 ? `已探测 ${probed} 个` : '未探测'}）；人工核验后将 verified_by 改为 human。`,
  };
  if (!opts.dryRun) await deps.store.put(row);
  log(`[jurisdiction/discovery] ${id} drafted ${adapters.length} adapter(s), coverage_score=${row.coverage_score}`);
  return { row, persisted: !opts.dryRun, probed, candidates: candidates.length };
}
