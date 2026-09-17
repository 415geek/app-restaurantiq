/**
 * §4.8.3 adapters. One function per `type`; all share `AdapterOutcome` so the
 * normaliser never cares where a row came from.
 *
 * `socrata` and `arcgis_rest` are fully implemented — between them they cover
 * most US open-data portals and county assessor/GIS layers. `ckan`, `accela`,
 * `national_parcel` and `none` are typed stubs that return
 * `status: 'not_implemented'`: a missing adapter degrades the report's wording,
 * it must never fail the report.
 *
 * Every call goes through the injected `FetchContext` (lib/iq/data/context.ts),
 * so unit tests supply a stub `fetch` and no test ever touches the network.
 * Responses are cached through the shared market cache (`iq360_jurisdiction`)
 * and cost is booked on the same ledger as the other 360° sources (D11 —
 * permits / development pipeline; open-data endpoints are $0).
 */

import { fetchWithTimeout } from '@/lib/iq/data/context';
import type { FetchContext } from '@/lib/iq/data/types';
import {
  addressLikePrefix,
  escapeSqlLiteral,
  isSafeFieldName,
  parseUsAddress,
  rowMatchesAddress,
  sanitizeLiteral,
  type ParsedAddress,
} from './address';
import { MAX_KEPT_ROWS, type AdapterOutcome, type JurisdictionAdapterSpec } from './types';

export const ADAPTER_TIMEOUT_MS = 8_000;
/** Permit data changes slowly; a week is plenty and keeps report reruns free. */
export const ADAPTER_CACHE_TTL_S = 7 * 24 * 3600;
export const ADAPTER_CACHE_SOURCE = 'iq360_jurisdiction';
const MAX_QUERY_ROWS = 50;

interface CachedRows {
  rows: Array<Record<string, unknown>>;
  status: 'ok' | 'error';
  reason: string | null;
}

function nowIso(ctx: FetchContext): string {
  return ctx.now().toISOString();
}

function base(spec: JurisdictionAdapterSpec, ctx: FetchContext): Omit<AdapterOutcome, 'status' | 'reason'> {
  return {
    evidence: spec.evidence,
    type: spec.type,
    endpoint: spec.endpoint,
    license: spec.license,
    rows: [],
    matched_rows: 0,
    keyword_rows: 0,
    retrieved_at: nowIso(ctx),
    cache: 'none',
    elapsed_ms: 0,
  };
}

function outcome(
  spec: JurisdictionAdapterSpec,
  ctx: FetchContext,
  status: AdapterOutcome['status'],
  reason: string | null,
  extra: Partial<AdapterOutcome> = {},
): AdapterOutcome {
  return { ...base(spec, ctx), status, reason, ...extra };
}

/** Flatten a row to searchable lower-case text (used for keyword + address matching). */
export function rowText(row: Record<string, unknown>): string {
  return Object.values(row)
    .map((v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join(' ')
    .toLowerCase();
}

/** The keywords a row hit, e.g. ['type i hood', 'grease interceptor']. */
export function matchedKeywords(row: Record<string, unknown>, keywords: readonly string[] | undefined): string[] {
  if (!keywords || keywords.length === 0) return [];
  const text = rowText(row);
  return keywords.filter((k) => text.includes(k.toLowerCase()));
}

function cacheKey(spec: JurisdictionAdapterSpec, address: string): string {
  return `${spec.type}|${spec.evidence}|${spec.endpoint}|${address.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

// ---------------------------------------------------------------------------
// Socrata (SODA 2.x): https://<portal>/resource/<id>.json
// ---------------------------------------------------------------------------

/**
 * Build the SODA query URL.
 *
 * Three shapes, in order of preference:
 *   1. split schema — `fields.street_number` + `fields.street_name`
 *      (`street_number = '1711' AND upper(street_name) like 'EL CAMINO%'`)
 *   2. single column — `address_field` (`upper(addr) like '1711 EL CAMINO%'`)
 *   3. no column declared — full-text `$q`
 */
export function buildSocrataUrl(spec: JurisdictionAdapterSpec, parsed: ParsedAddress): URL | null {
  const prefix = addressLikePrefix(parsed);
  if (!prefix) return null;
  const url = new URL(spec.endpoint);
  url.searchParams.set('$limit', String(MAX_QUERY_ROWS));

  const numField = spec.fields?.street_number;
  const nameField = spec.fields?.street_name;
  if (isSafeFieldName(numField) && isSafeFieldName(nameField) && parsed.number && parsed.street) {
    const where = [
      `${numField} = '${escapeSqlLiteral(parsed.number)}'`,
      `upper(${nameField}) like '${escapeSqlLiteral(parsed.street).toUpperCase()}%'`,
    ].join(' AND ');
    url.searchParams.set('$where', where);
    return url;
  }
  if (isSafeFieldName(spec.address_field)) {
    url.searchParams.set(
      '$where',
      `upper(${spec.address_field}) like '${escapeSqlLiteral(prefix).toUpperCase()}%'`,
    );
    return url;
  }
  url.searchParams.set('$q', sanitizeLiteral(prefix));
  return url;
}

async function fetchSocrataRows(
  spec: JurisdictionAdapterSpec,
  parsed: ParsedAddress,
  ctx: FetchContext,
): Promise<CachedRows> {
  const url = buildSocrataUrl(spec, parsed);
  if (!url) return { rows: [], status: 'error', reason: 'address_unusable: 地址缺少可用的街道部分' };
  try {
    const res = await fetchWithTimeout(ctx, url, {
      timeoutMs: ADAPTER_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { rows: [], status: 'error', reason: `http_${res.status}` };
    const json: unknown = await res.json().catch(() => null);
    if (!Array.isArray(json)) return { rows: [], status: 'error', reason: 'bad_payload: Socrata 未返回数组' };
    const rows = json.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r));
    return { rows, status: 'ok', reason: null };
  } catch (e) {
    return { rows: [], status: 'error', reason: `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` };
  }
}

// ---------------------------------------------------------------------------
// ArcGIS REST FeatureServer / MapServer layer
// ---------------------------------------------------------------------------

export function buildArcgisUrl(spec: JurisdictionAdapterSpec, parsed: ParsedAddress): URL | null {
  const prefix = addressLikePrefix(parsed);
  if (!prefix) return null;
  if (!isSafeFieldName(spec.address_field)) return null;
  const endpoint = spec.endpoint.replace(/\/+$/, '');
  const url = new URL(/\/query$/i.test(endpoint) ? endpoint : `${endpoint}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', String(MAX_QUERY_ROWS));
  url.searchParams.set('where', `UPPER(${spec.address_field}) LIKE '${escapeSqlLiteral(prefix).toUpperCase()}%'`);
  return url;
}

async function fetchArcgisRows(
  spec: JurisdictionAdapterSpec,
  parsed: ParsedAddress,
  ctx: FetchContext,
): Promise<CachedRows> {
  if (!isSafeFieldName(spec.address_field)) {
    return { rows: [], status: 'error', reason: 'missing_address_field: arcgis_rest 适配器必须声明 address_field' };
  }
  const url = buildArcgisUrl(spec, parsed);
  if (!url) return { rows: [], status: 'error', reason: 'address_unusable: 地址缺少可用的街道部分' };
  try {
    const res = await fetchWithTimeout(ctx, url, {
      timeoutMs: ADAPTER_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { rows: [], status: 'error', reason: `http_${res.status}` };
    const json: unknown = await res.json().catch(() => null);
    if (typeof json !== 'object' || json === null) {
      return { rows: [], status: 'error', reason: 'bad_payload: ArcGIS 未返回对象' };
    }
    const obj = json as Record<string, unknown>;
    if (obj.error) {
      const msg = (obj.error as Record<string, unknown> | null)?.message;
      return { rows: [], status: 'error', reason: `arcgis_error: ${String(msg ?? 'unknown').slice(0, 120)}` };
    }
    const features = Array.isArray(obj.features) ? obj.features : [];
    const rows = features
      .map((f) =>
        typeof f === 'object' && f !== null ? ((f as Record<string, unknown>).attributes as unknown) : null,
      )
      .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && !Array.isArray(a));
    return { rows, status: 'ok', reason: null };
  } catch (e) {
    return { rows: [], status: 'error', reason: `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` };
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const STUB_REASON: Record<string, string> = {
  ckan: 'not_implemented: CKAN 适配器尚未实现（registry 已声明端点，待接入）',
  accela: 'not_implemented: Accela Citizen Access 适配器尚未实现（需要凭证与逐辖区映射）',
  national_parcel: 'not_implemented: 全国宗地商用 API 适配器尚未实现；其许可也不允许在报告中转载数值',
  none: 'not_connected: 本辖区该证据层无可用端点（registry 显式声明为 none）',
};

/**
 * Run one declared adapter. Never throws: every failure becomes an
 * `AdapterOutcome` with a stated reason, so the normaliser can leave the
 * corresponding fact `null` *and say why*.
 */
export async function runAdapter(
  spec: JurisdictionAdapterSpec,
  address: string,
  ctx: FetchContext,
): Promise<AdapterOutcome> {
  const started = Date.now();
  if (spec.type !== 'socrata' && spec.type !== 'arcgis_rest') {
    return outcome(spec, ctx, 'not_implemented', STUB_REASON[spec.type] ?? 'not_implemented', {
      elapsed_ms: Date.now() - started,
    });
  }
  if (!spec.endpoint || !/^https:\/\//i.test(spec.endpoint)) {
    return outcome(spec, ctx, 'skipped', 'bad_endpoint: 端点缺失或非 https', { elapsed_ms: Date.now() - started });
  }

  const parsed = parseUsAddress(address);
  if (!addressLikePrefix(parsed)) {
    return outcome(spec, ctx, 'skipped', 'address_unusable: 地址缺少可用的街道部分', {
      elapsed_ms: Date.now() - started,
    });
  }

  const key = cacheKey(spec, address);
  let cache: AdapterOutcome['cache'] = 'miss';
  let fetched = await ctx.cache.get<CachedRows>(ADAPTER_CACHE_SOURCE, key);
  if (fetched && Array.isArray(fetched.rows)) {
    cache = 'hit';
  } else {
    fetched = spec.type === 'socrata' ? await fetchSocrataRows(spec, parsed, ctx) : await fetchArcgisRows(spec, parsed, ctx);
    // Open-data endpoints are free; booked on the same ledger as the other
    // 360° sources so the cost table stays complete.
    let host = spec.endpoint;
    try {
      host = new URL(spec.endpoint).host;
    } catch {
      /* keep the raw endpoint in the ledger note */
    }
    ctx.cost.add('D11', 0, `jurisdiction ${spec.evidence} ${spec.type} ${host}`);
    if (fetched.status === 'ok') {
      await ctx.cache.set(ADAPTER_CACHE_SOURCE, key, fetched, ADAPTER_CACHE_TTL_S);
    }
  }

  if (fetched.status !== 'ok') {
    return outcome(spec, ctx, 'error', fetched.reason ?? 'error', { cache, elapsed_ms: Date.now() - started });
  }

  const matched = fetched.rows.filter((r) => rowMatchesAddress(r, parsed));
  const keywordRows = spec.keyword_filter
    ? matched.filter((r) => matchedKeywords(r, spec.keyword_filter).length > 0)
    : [];
  const kept = (spec.keyword_filter && keywordRows.length ? keywordRows : matched).slice(0, MAX_KEPT_ROWS);

  if (matched.length === 0) {
    return outcome(spec, ctx, 'no_match', `no_match: 端点可达，但该地址在 ${fetched.rows.length} 条返回中无匹配记录`, {
      cache,
      elapsed_ms: Date.now() - started,
    });
  }
  return outcome(spec, ctx, 'ok', null, {
    rows: kept,
    matched_rows: matched.length,
    keyword_rows: keywordRows.length,
    cache,
    elapsed_ms: Date.now() - started,
  });
}

/**
 * Run the declared adapters in evidence order E1 → E2 → E4 (§4.8.2). Sequential
 * on purpose: an E1 hit already answers the decisive question, so the weaker
 * layers only run when they still add something.
 */
export async function runAdapters(
  specs: readonly JurisdictionAdapterSpec[],
  address: string,
  ctx: FetchContext,
): Promise<AdapterOutcome[]> {
  const ordered = [...specs].sort((a, b) => a.evidence.localeCompare(b.evidence));
  const out: AdapterOutcome[] = [];
  for (const spec of ordered) {
    out.push(await runAdapter(spec, address, ctx));
  }
  return out;
}
