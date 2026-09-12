/**
 * D5 · Overture Maps Places base map, served from Supabase `iq_poi`
 * (loaded per metro by scripts/load_overture.py; see supabase/migrations/0009).
 *
 * Two reads per request:
 *   1. POIs inside the bbox around the site (then haversine-filtered to radiusM).
 *   2. Metro-wide counts by `sub_cuisine` — feeds the Phase 3 competitor guard
 *      ("metro has ≥ N of this sub-cuisine but 0 inside drive10 → crawl anomaly").
 *
 * The table being empty / Supabase env missing is reported as `failed` with a
 * precise note; nothing is ever estimated in its place. `deps` lets tests inject
 * rows without Supabase.
 */
import { bboxAround, haversineM, type BBox } from '@/lib/iq/geo';
import { getHubs } from '@/lib/iq/params';
import { DATA_SOURCE_NAMES, failed, nowIso, type DataResult, type FetchContext } from './types';

export interface OverturePoiRow {
  id: string;
  metro?: string | null;
  name: string | null;
  names_json?: { primary?: string | null; common?: Record<string, string> | null } | null;
  lat: number;
  lng: number;
  taxonomy_path: string[] | null;
  primary_category: string | null;
  operating_status: string | null;
  confidence: number | null;
  brand: string | null;
  address: string | null;
  sub_cuisine: string | null;
  sub_cuisine_confidence: number | null;
  google_place_id: string | null;
  release?: string | null;
}

export interface OverturePoi {
  id: string;
  name: string;
  name_zh?: string | null;
  lat: number;
  lng: number;
  taxonomy_path: string[];
  primary_category: string | null;
  operating_status: string;
  confidence: number | null;
  brand: string | null;
  address: string | null;
  sub_cuisine: string | null;
  sub_cuisine_confidence: number | null;
  google_place_id: string | null;
  distance_m: number;
}

export interface OverturePoiData {
  pois: OverturePoi[];
  metro_counts_by_sub_cuisine: Record<string, number>;
  release: string | null;
  loaded: boolean;
}

export interface OvertureInput {
  lat: number;
  lng: number;
  radiusM: number;
  metro: string;
}

export interface MetroSummary {
  /** Total iq_poi rows for the metro (any category). 0 ⇒ not loaded. */
  total: number;
  by_sub_cuisine: Record<string, number>;
  release: string | null;
}

export interface OvertureDeps {
  /** Rows whose lat/lng fall inside `bbox` and whose metro matches. */
  poiQuery?: (bbox: BBox, metro: string) => Promise<OverturePoiRow[]>;
  /** Metro-wide totals; when omitted but `poiQuery` is given, derived from poiQuery(metro_bbox). */
  metroSummaryQuery?: (metro: string) => Promise<MetroSummary>;
}

const SOURCE_ID = 'D5' as const;
const CACHE_SOURCE = 'iq360_overture';
const CACHE_TTL_S = 24 * 3600;
const LICENSE = 'Overture Maps Places · CDLA-Permissive-2.0 (sources ODbL/CC-BY where noted in sources_json)';
const NOT_LOADED_NOTE = 'iq_poi 未加载：运行 scripts/load_overture.py --metro sf-bay';
const PAGE = 1000;

const POI_COLUMNS =
  'id,metro,name,names_json,lat,lng,taxonomy_path,primary_category,operating_status,confidence,brand,address,sub_cuisine,sub_cuisine_confidence,google_place_id,release';

/** Page through PostgREST (default max 1000 rows per response). */
async function pageAll<T>(run: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function supabaseDeps(): Promise<Required<OvertureDeps>> {
  // Throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing — caller maps to `failed`.
  const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
  const supa = supabaseAdmin();
  return {
    poiQuery: (bbox, metro) =>
      pageAll<OverturePoiRow>((from, to) =>
        supa
          .from('iq_poi')
          .select(POI_COLUMNS)
          .eq('metro', metro)
          .gte('lat', bbox.minLat)
          .lte('lat', bbox.maxLat)
          .gte('lng', bbox.minLng)
          .lte('lng', bbox.maxLng)
          .range(from, to) as unknown as Promise<{ data: OverturePoiRow[] | null; error: { message: string } | null }>,
      ),
    metroSummaryQuery: async (metro) => {
      const head = await supa.from('iq_poi').select('id', { count: 'exact', head: true }).eq('metro', metro);
      if (head.error) throw new Error(head.error.message);
      const rows = await pageAll<{ sub_cuisine: string | null; release: string | null }>((from, to) =>
        supa
          .from('iq_poi')
          .select('sub_cuisine,release')
          .eq('metro', metro)
          .not('sub_cuisine', 'is', null)
          .range(from, to) as unknown as Promise<{
          data: Array<{ sub_cuisine: string | null; release: string | null }> | null;
          error: { message: string } | null;
        }>,
      );
      const by_sub_cuisine: Record<string, number> = {};
      let release: string | null = null;
      for (const r of rows) {
        if (r.sub_cuisine) by_sub_cuisine[r.sub_cuisine] = (by_sub_cuisine[r.sub_cuisine] ?? 0) + 1;
        if (r.release && (!release || r.release > release)) release = r.release;
      }
      if (!release && (head.count ?? 0) > 0) {
        const one = await supa.from('iq_poi').select('release').eq('metro', metro).not('release', 'is', null).limit(1);
        release = (one.data?.[0]?.release as string | undefined) ?? null;
      }
      return { total: head.count ?? 0, by_sub_cuisine, release };
    },
  };
}

function metroBbox(metro: string): BBox {
  const hubs = getHubs();
  if (hubs.metro === metro) {
    const b = hubs.metro_bbox;
    return { minLat: b.min_lat, minLng: b.min_lng, maxLat: b.max_lat, maxLng: b.max_lng };
  }
  // Unknown metro: whole world — the metro filter does the real scoping.
  return { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 };
}

function summaryFromRows(rows: OverturePoiRow[]): MetroSummary {
  const by_sub_cuisine: Record<string, number> = {};
  let release: string | null = null;
  for (const r of rows) {
    if (r.sub_cuisine) by_sub_cuisine[r.sub_cuisine] = (by_sub_cuisine[r.sub_cuisine] ?? 0) + 1;
    if (r.release && (!release || r.release > release)) release = r.release;
  }
  return { total: rows.length, by_sub_cuisine, release };
}

export function toOverturePoi(row: OverturePoiRow, site: { lat: number; lng: number }): OverturePoi {
  const common = row.names_json?.common ?? null;
  const zh = common ? (common['zh'] ?? common['zh-Hans'] ?? common['zh-Hant'] ?? common['zh-CN'] ?? null) : null;
  return {
    id: row.id,
    name: row.name ?? row.names_json?.primary ?? '',
    name_zh: zh,
    lat: row.lat,
    lng: row.lng,
    taxonomy_path: Array.isArray(row.taxonomy_path) ? row.taxonomy_path : row.primary_category ? [row.primary_category] : [],
    primary_category: row.primary_category ?? null,
    operating_status: row.operating_status ?? 'unknown',
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    brand: row.brand ?? null,
    address: row.address ?? null,
    sub_cuisine: row.sub_cuisine ?? null,
    sub_cuisine_confidence: typeof row.sub_cuisine_confidence === 'number' ? row.sub_cuisine_confidence : null,
    google_place_id: row.google_place_id ?? null,
    distance_m: Math.round(haversineM(site, { lat: row.lat, lng: row.lng })),
  };
}

function cacheKey(input: OvertureInput, bbox: BBox): string {
  const r = (n: number) => n.toFixed(4);
  return `${input.metro}:${r(bbox.minLat)},${r(bbox.minLng)},${r(bbox.maxLat)},${r(bbox.maxLng)}:${Math.round(input.radiusM)}`;
}

export async function fetchOverturePois(
  input: OvertureInput,
  ctx: FetchContext,
  deps: OvertureDeps = {},
): Promise<DataResult<OverturePoiData>> {
  const t0 = Date.now();
  const site = { lat: input.lat, lng: input.lng };
  const bbox = bboxAround(site, input.radiusM);
  const key = cacheKey(input, bbox);
  const base = { id: SOURCE_ID, name: DATA_SOURCE_NAMES[SOURCE_ID], license: LICENSE, cost_usd: 0 };

  const cached = await ctx.cache.get<OverturePoiData>(CACHE_SOURCE, key);
  if (cached?.loaded && Array.isArray(cached.pois)) {
    return {
      ...base,
      status: 'ok',
      data: cached,
      source: `Supabase iq_poi (Overture release ${cached.release ?? '?'}; cached ≤ 24 h)`,
      fetched_at: nowIso(ctx),
      coverage_note: `半径 ${Math.round(input.radiusM)} m 内 ${cached.pois.length} 个 POI（缓存命中）。`,
      cache: 'hit',
      elapsed_ms: Date.now() - t0,
    };
  }

  let poiQuery = deps.poiQuery;
  let metroSummaryQuery = deps.metroSummaryQuery;
  if (!poiQuery) {
    try {
      const d = await supabaseDeps();
      poiQuery = d.poiQuery;
      metroSummaryQuery = metroSummaryQuery ?? d.metroSummaryQuery;
    } catch (err) {
      return failed(SOURCE_ID, ctx, {
        source: 'Supabase iq_poi',
        license: LICENSE,
        note: `iq_poi 未加载 / Supabase 未配置（${(err as Error)?.message ?? err}）`,
        error: String((err as Error)?.message ?? err),
      });
    }
  }
  const poiQ = poiQuery;
  const summaryQ: (metro: string) => Promise<MetroSummary> =
    metroSummaryQuery ?? (async (metro) => summaryFromRows(await poiQ(metroBbox(metro), metro)));

  let rows: OverturePoiRow[];
  let summary: MetroSummary;
  try {
    [rows, summary] = await Promise.all([poiQ(bbox, input.metro), summaryQ(input.metro)]);
  } catch (err) {
    return failed(SOURCE_ID, ctx, {
      source: 'Supabase iq_poi',
      license: LICENSE,
      note: `iq_poi 查询失败：${(err as Error)?.message ?? err}`,
      error: String((err as Error)?.message ?? err),
    });
  }

  if (summary.total === 0 && rows.length === 0) {
    return {
      ...failed<OverturePoiData>(SOURCE_ID, ctx, {
        source: 'Supabase iq_poi',
        license: LICENSE,
        note: NOT_LOADED_NOTE,
        error: `iq_poi 中 metro=${input.metro} 无记录`,
      }),
      data: { pois: [], metro_counts_by_sub_cuisine: {}, release: null, loaded: false },
    };
  }

  const pois = rows
    .map((r) => toOverturePoi(r, site))
    .filter((p) => p.distance_m <= input.radiusM)
    .sort((a, b) => a.distance_m - b.distance_m);

  const release = summary.release ?? rows.find((r) => r.release)?.release ?? null;
  const data: OverturePoiData = {
    pois,
    metro_counts_by_sub_cuisine: summary.by_sub_cuisine,
    release,
    loaded: true,
  };
  await ctx.cache.set(CACHE_SOURCE, key, data, CACHE_TTL_S);

  const classified = pois.filter((p) => p.sub_cuisine).length;
  const metroClassified = Object.values(summary.by_sub_cuisine).reduce((s, n) => s + n, 0);
  const notes = [
    `半径 ${Math.round(input.radiusM)} m 内 ${pois.length} 个 POI（bbox 命中 ${rows.length}），其中已分类子菜系 ${classified} 个。`,
    `metro=${input.metro} 共 ${summary.total} 个 POI，已分类 ${metroClassified} 个。`,
  ];
  let status: DataResult<OverturePoiData>['status'] = 'ok';
  if (metroClassified === 0) {
    status = 'partial';
    notes.push('子菜系尚未分类（Phase 3 classifier 未运行）→ 竞品守卫的 metro 计数不可用。');
  }
  return {
    ...base,
    status,
    data,
    source: `Supabase iq_poi (Overture Maps release ${release ?? '未知'})`,
    fetched_at: nowIso(ctx),
    coverage_note: notes.join(' '),
    cache: 'miss',
    elapsed_ms: Date.now() - t0,
  };
}
