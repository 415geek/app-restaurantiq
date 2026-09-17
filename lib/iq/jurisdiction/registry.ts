/**
 * §4.8.2 `jurisdiction_registry` — the declared, persisted map from a county
 * FIPS (or place GEOID) to the endpoints that answer the evidence ladder.
 *
 * 关键设计约束: an unknown jurisdiction NEVER triggers free-form fetching during
 * a report. `lookupJurisdiction` returns null, the report takes the declared
 * fallback path immediately, and `lib/iq/jurisdiction/discovery.ts` fills the
 * row later, asynchronously. Only a persisted row is ever used.
 *
 * §4.8.7 cold start: P0 only — SF, San Mateo, Santa Clara, Alameda. The three
 * non-SF counties ship as declared-but-unconnected rows (a typed national
 * parcel stub, `coverage_score` 0) rather than as invented dataset ids; later
 * batches are added as DATA ROWS (SQL / discovery), not as code changes.
 */

import { supabaseAdmin } from '@/lib/server/supabase-admin';
import { envValue } from '@/lib/env-value';
import type { JurisdictionAdapterSpec, JurisdictionRegistryRow } from './types';
import { ADAPTER_TYPES, EVIDENCE_ORDER } from './types';

export const REGISTRY_TABLE = 'iq_jurisdiction_registry';

const DATASF_LICENSE = 'Public domain — DataSF open data (City and County of San Francisco)';
const REGRID_LICENSE = 'Commercial API (Regrid national parcel) — internal reasoning only, not redistributable';

/** Words that turn a permit row into a hood / grease-interceptor record (E2). */
export const DEFAULT_HOOD_KEYWORDS: readonly string[] = [
  'type i hood',
  'type 1 hood',
  'hood',
  'grease interceptor',
  'grease trap',
  'kitchen exhaust',
  'commercial kitchen',
  'exhaust duct',
  'ansul',
  'make up air',
  'makeup air',
];

/** Regrid-style national parcel stub — declared so the gap is visible, not implemented. */
function nationalParcelStub(): JurisdictionAdapterSpec {
  return {
    evidence: 'E4',
    type: 'national_parcel',
    endpoint: 'https://app.regrid.com/api/v2/parcels/address',
    address_field: 'path',
    license: REGRID_LICENSE,
    fields: { year_built: 'yearbuilt', use_code: 'usedesc' },
  };
}

/**
 * P0 seed rows. Identical to the INSERT in
 * supabase/migrations/0012_jurisdiction_registry.sql — kept in code so the
 * resolver still works (and stays unit-testable) when Supabase is not
 * configured. Nothing here is invented at fact level: an endpoint that is not
 * confidently known is left out and the row says so in `notes`.
 */
export const SEED_REGISTRY: readonly JurisdictionRegistryRow[] = [
  {
    jurisdiction_id: '06075',
    name: 'City and County of San Francisco',
    adapters: [
      {
        evidence: 'E1',
        type: 'socrata',
        endpoint: 'https://data.sfgov.org/resource/pyih-qa8i.json',
        address_field: 'business_address',
        license: DATASF_LICENSE,
        fields: {
          facility_name: 'business_name',
          permit_type: 'business_name',
          date: 'inspection_date',
        },
      },
      {
        evidence: 'E2',
        type: 'socrata',
        endpoint: 'https://data.sfgov.org/resource/i98e-djp9.json',
        address_field: 'street_name',
        keyword_filter: [...DEFAULT_HOOD_KEYWORDS],
        license: DATASF_LICENSE,
        fields: {
          street_number: 'street_number',
          street_name: 'street_name',
          description: 'description',
          permit_type: 'permit_type_definition',
          status: 'status',
          date: 'permit_creation_date',
        },
      },
      {
        evidence: 'E4',
        type: 'socrata',
        endpoint: 'https://data.sfgov.org/resource/wv5m-vpq2.json',
        address_field: 'property_location',
        license: DATASF_LICENSE,
        fields: {
          year_built: 'year_property_built',
          use_code: 'property_class_code',
        },
      },
    ],
    coverage_score: 0.8,
    verified_at: '2026-09-17T00:00:00.000Z',
    verified_by: 'auto',
    notes:
      'DataSF 数据集 ID 由冷启动 seed 写入，尚未人工核验；一次成功的 E1/E2 取数后应由运营把 verified_by 改为 human。',
  },
  {
    jurisdiction_id: '06081',
    name: 'San Mateo County',
    adapters: [nationalParcelStub()],
    coverage_score: 0.15,
    verified_at: '2026-09-17T00:00:00.000Z',
    verified_by: 'auto',
    notes:
      '尚未接入：San Mateo County 环境健康许可 / 建筑许可的开放数据端点未经核验，不编造数据集 ID。E4 仅声明 national_parcel（商用 API，未实现）。待 discovery 或人工补录。',
  },
  {
    jurisdiction_id: '06085',
    name: 'Santa Clara County',
    adapters: [nationalParcelStub()],
    coverage_score: 0.15,
    verified_at: '2026-09-17T00:00:00.000Z',
    verified_by: 'auto',
    notes:
      '尚未接入：Santa Clara County 食品设施许可 / 机械许可端点未经核验，不编造数据集 ID。待 discovery 或人工补录。',
  },
  {
    jurisdiction_id: '06001',
    name: 'Alameda County',
    adapters: [nationalParcelStub()],
    coverage_score: 0.15,
    verified_at: '2026-09-17T00:00:00.000Z',
    verified_by: 'auto',
    notes:
      '尚未接入：Alameda County 食品设施许可 / 机械许可端点未经核验，不编造数据集 ID。待 discovery 或人工补录。',
  },
];

/** P0 batch (§4.8.7). Later batches are data rows, not code. */
export const P0_JURISDICTION_IDS: readonly string[] = SEED_REGISTRY.map((r) => r.jurisdiction_id);

// ---------------------------------------------------------------------------
// Row validation — rows may arrive from the DB or from a discovery draft
// ---------------------------------------------------------------------------

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function normalizeAdapter(raw: unknown): JurisdictionAdapterSpec | null {
  if (!isRec(raw)) return null;
  const evidence = String(raw.evidence ?? '');
  const type = String(raw.type ?? '');
  if (!(EVIDENCE_ORDER as readonly string[]).includes(evidence)) return null;
  if (!(ADAPTER_TYPES as readonly string[]).includes(type)) return null;
  const spec: JurisdictionAdapterSpec = {
    evidence: evidence as JurisdictionAdapterSpec['evidence'],
    type: type as JurisdictionAdapterSpec['type'],
    endpoint: String(raw.endpoint ?? ''),
    license: String(raw.license ?? ''),
  };
  if (typeof raw.address_field === 'string' && raw.address_field.trim()) spec.address_field = raw.address_field.trim();
  if (Array.isArray(raw.keyword_filter)) {
    const kw = raw.keyword_filter.map((k) => String(k).toLowerCase().trim()).filter(Boolean);
    if (kw.length) spec.keyword_filter = kw;
  }
  if (isRec(raw.fields)) {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.fields)) if (typeof v === 'string' && v.trim()) fields[k] = v.trim();
    if (Object.keys(fields).length) spec.fields = fields;
  }
  return spec;
}

/** Coerce anything (DB row, JSON) into a registry row; null when unusable. */
export function normalizeRegistryRow(raw: unknown): JurisdictionRegistryRow | null {
  if (!isRec(raw)) return null;
  const id = String(raw.jurisdiction_id ?? '').trim();
  if (!/^\d{5}$|^\d{7}$/.test(id)) return null;
  const adapters = Array.isArray(raw.adapters)
    ? raw.adapters.map(normalizeAdapter).filter((a): a is JurisdictionAdapterSpec => a !== null)
    : [];
  const score = Number(raw.coverage_score);
  const verifiedBy = raw.verified_by === 'human' ? 'human' : 'auto';
  const row: JurisdictionRegistryRow = {
    jurisdiction_id: id,
    name: String(raw.name ?? id),
    adapters,
    coverage_score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
    verified_at: typeof raw.verified_at === 'string' ? raw.verified_at : new Date(0).toISOString(),
    verified_by: verifiedBy,
  };
  if (typeof raw.notes === 'string' && raw.notes.trim()) row.notes = raw.notes.trim();
  return row;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface JurisdictionStore {
  get(jurisdictionId: string): Promise<JurisdictionRegistryRow | null>;
  put(row: JurisdictionRegistryRow): Promise<void>;
}

/** In-memory store, seeded with whatever rows the caller passes (tests, discovery dry runs). */
export function createMemoryJurisdictionStore(
  rows: readonly JurisdictionRegistryRow[] = SEED_REGISTRY,
): JurisdictionStore & { rows(): JurisdictionRegistryRow[] } {
  const map = new Map<string, JurisdictionRegistryRow>(rows.map((r) => [r.jurisdiction_id, r]));
  return {
    async get(id) {
      return map.get(id) ?? null;
    },
    async put(row) {
      map.set(row.jurisdiction_id, row);
    },
    rows() {
      return [...map.values()];
    },
  };
}

function hasSupabaseEnv(): boolean {
  return Boolean(envValue('SUPABASE_URL')) && Boolean(envValue('SUPABASE_SERVICE_ROLE_KEY'));
}

const seedById = new Map(SEED_REGISTRY.map((r) => [r.jurisdiction_id, r]));

/** The P0 seed row for an id, or null. Pure — no IO. */
export function seedRegistryRow(jurisdictionId: string): JurisdictionRegistryRow | null {
  return seedById.get(jurisdictionId) ?? null;
}

/**
 * Supabase-backed store. Falls back to the P0 seed rows when Supabase is not
 * configured or the read fails — the seed is the same data the migration
 * inserts, so behaviour is identical with and without a database. Never throws.
 */
export function createSupabaseJurisdictionStore(): JurisdictionStore {
  return {
    async get(id) {
      if (hasSupabaseEnv()) {
        try {
          const { data, error } = await supabaseAdmin()
            .from(REGISTRY_TABLE)
            .select('jurisdiction_id, name, adapters, coverage_score, verified_at, verified_by, notes')
            .eq('jurisdiction_id', id)
            .maybeSingle();
          if (!error && data) {
            const row = normalizeRegistryRow(data);
            if (row) return row;
          }
        } catch {
          /* fall through to seed */
        }
      }
      return seedRegistryRow(id);
    },
    async put(row) {
      if (!hasSupabaseEnv()) return;
      try {
        await supabaseAdmin()
          .from(REGISTRY_TABLE)
          .upsert(
            {
              jurisdiction_id: row.jurisdiction_id,
              name: row.name,
              adapters: row.adapters,
              coverage_score: row.coverage_score,
              verified_at: row.verified_at,
              verified_by: row.verified_by,
              notes: row.notes ?? null,
            },
            { onConflict: 'jurisdiction_id' },
          );
      } catch {
        /* registry writes are best-effort; a report never depends on them */
      }
    },
  };
}

export interface JurisdictionKey {
  /** 5-digit county FIPS (state FIPS + county). */
  county: string | null;
  /** Optional 7-digit place GEOID; when registered it wins over the county row. */
  place?: string | null;
}

export interface JurisdictionLookup {
  row: JurisdictionRegistryRow | null;
  /** The key that produced `row`, or the key that was searched when nothing matched. */
  jurisdiction_id: string | null;
  reason: string | null;
}

/**
 * address → Census geocoder (already used by lib/iq/data/geocode.ts) → FIPS →
 * registry lookup. Place GEOID first, then county FIPS. Never fetches.
 */
export async function lookupJurisdiction(store: JurisdictionStore, key: JurisdictionKey): Promise<JurisdictionLookup> {
  const place = key.place && /^\d{7}$/.test(key.place) ? key.place : null;
  const county = key.county && /^\d{5}$/.test(key.county) ? key.county : null;
  if (!place && !county) {
    return { row: null, jurisdiction_id: null, reason: 'no_fips: 地址未解析出县级 FIPS（Census geocoder 未命中）' };
  }
  for (const id of [place, county].filter((v): v is string => Boolean(v))) {
    const row = await store.get(id);
    if (row) return { row, jurisdiction_id: id, reason: null };
  }
  const searched = place ?? county;
  return {
    row: null,
    jurisdiction_id: searched,
    reason: `jurisdiction_not_registered: ${searched} 不在 jurisdiction_registry 中；本次报告走声明式回退，discovery 异步补录`,
  };
}
