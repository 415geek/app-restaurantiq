/**
 * D7 · Traffic proxy from Google review-count snapshots (`iq_poi_snapshot`,
 * written monthly by scripts/snapshot-reviews.ts).
 *
 * Output is strictly *relative*: a 1–5 tier (quintile) and a percentile among
 * metro peers. Absolute foot traffic is never produced — the review→covers
 * conversion (defaults.review_to_covers.k) is applied downstream and labelled
 * as an estimate there.
 *
 *   snapshot_growth   ≥ 2 monthly snapshots for the place → (latest − earliest)
 *                     / months, ranked among metro places that also have history.
 *   review_percentile no history → rank the *current* review count among the
 *                     metro's latest-month counts (or, without any snapshots,
 *                     among the caller-supplied counts) → `partial`.
 */
import { DATA_SOURCE_NAMES, failed, nowIso, type DataResult, type FetchContext } from './types';

export interface SnapshotRow {
  place_id: string;
  /** YYYY-MM-DD (first of month) */
  snapshot_month: string;
  user_rating_count: number | null;
  rating?: number | null;
  business_status?: string | null;
}

export type TrafficTier = 1 | 2 | 3 | 4 | 5;

export interface TrafficProxyPlace {
  monthly_review_growth: number | null;
  months_of_history: number;
  traffic_tier: TrafficTier | null;
  percentile: number | null;
}

export interface TrafficProxyData {
  per_place: Record<string, TrafficProxyPlace>;
  method: 'snapshot_growth' | 'review_percentile';
  metro_sample_size: number;
  /** Month (YYYY-MM-DD) of the latest snapshot used, null when none. */
  latest_snapshot_month: string | null;
}

export interface TrafficProxyInput {
  placeIds: string[];
  metro: string;
  /** Current Google user_rating_count per place (from D6). */
  currentCounts: Record<string, number>;
}

export interface TrafficProxyDeps {
  /** Snapshot rows for the metro with snapshot_month ≥ sinceMonth (YYYY-MM-DD). */
  snapshotQuery?: (metro: string, sinceMonth: string) => Promise<SnapshotRow[]>;
}

const SOURCE_ID = 'D7' as const;
const CACHE_SOURCE = 'iq360_traffic_proxy';
const CACHE_TTL_S = 24 * 3600;
const LICENSE = 'Derived from Google Places rating counts (internal monthly snapshots); relative tiers only';
const HISTORY_MONTHS = 13;
/** Below this many peers a percentile is meaningless → tier null. */
export const MIN_SAMPLE = 5;
const PAGE = 1000;

interface MetroSummary {
  /** place_id → growth stats for places with ≥ 2 months of history. */
  growth: Record<string, { monthly_review_growth: number; months_of_history: number }>;
  /** place_id → months seen (1 for single-snapshot places). */
  months: Record<string, number>;
  /** place_id → user_rating_count in the latest snapshot month. */
  latest_counts: Record<string, number>;
  latest_month: string | null;
  rows: number;
}

function firstOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function monthsApart(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function summarizeSnapshots(rows: SnapshotRow[]): MetroSummary {
  const byPlace = new Map<string, Array<{ m: string; c: number }>>();
  let latest_month: string | null = null;
  for (const r of rows) {
    if (!r.place_id || typeof r.snapshot_month !== 'string') continue;
    if (typeof r.user_rating_count !== 'number' || !Number.isFinite(r.user_rating_count)) continue;
    const m = r.snapshot_month.slice(0, 10);
    if (!latest_month || m > latest_month) latest_month = m;
    const arr = byPlace.get(r.place_id) ?? [];
    arr.push({ m, c: r.user_rating_count });
    byPlace.set(r.place_id, arr);
  }
  const growth: MetroSummary['growth'] = {};
  const months: MetroSummary['months'] = {};
  const latest_counts: MetroSummary['latest_counts'] = {};
  for (const [pid, arr] of byPlace) {
    // Dedupe by month (keep the last write), then order.
    const byMonth = new Map<string, number>();
    for (const x of arr) byMonth.set(x.m, x.c);
    const seq = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    months[pid] = seq.length;
    const last = seq[seq.length - 1];
    if (latest_month && last[0] === latest_month) latest_counts[pid] = last[1];
    if (seq.length >= 2) {
      const first = seq[0];
      const span = monthsApart(first[0], last[0]);
      if (span > 0) growth[pid] = { monthly_review_growth: (last[1] - first[1]) / span, months_of_history: seq.length };
    }
  }
  return { growth, months, latest_counts, latest_month, rows: rows.length };
}

/** Percentile (0–100) of `v` in `sample` = share of sample ≤ v. */
export function percentileOf(v: number, sample: number[]): number {
  if (sample.length === 0) return 0;
  let le = 0;
  for (const s of sample) if (s <= v) le++;
  return Math.round((le / sample.length) * 1000) / 10;
}

export function tierOf(percentile: number): TrafficTier {
  if (percentile <= 20) return 1;
  if (percentile <= 40) return 2;
  if (percentile <= 60) return 3;
  if (percentile <= 80) return 4;
  return 5;
}

async function supabaseSnapshotQuery(): Promise<NonNullable<TrafficProxyDeps['snapshotQuery']>> {
  const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
  const supa = supabaseAdmin();
  return async (metro, sinceMonth) => {
    const out: SnapshotRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supa
        .from('iq_poi_snapshot')
        .select('place_id,snapshot_month,user_rating_count,rating,business_status')
        .eq('metro', metro)
        .gte('snapshot_month', sinceMonth)
        .order('snapshot_month', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...(data as unknown as SnapshotRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  };
}

export async function fetchTrafficProxy(
  input: TrafficProxyInput,
  ctx: FetchContext,
  deps: TrafficProxyDeps = {},
): Promise<DataResult<TrafficProxyData>> {
  const t0 = Date.now();
  const base = { id: SOURCE_ID, name: DATA_SOURCE_NAMES[SOURCE_ID], license: LICENSE, cost_usd: 0, fetched_at: nowIso(ctx) };
  const now = ctx.now();
  const thisMonth = firstOfMonth(now);
  const since = firstOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - HISTORY_MONTHS, 1)));
  const cacheKey = `${input.metro}:${thisMonth}`;

  // 1. Metro snapshot summary (cached 24 h; the table only changes monthly).
  let summary: MetroSummary | null = await ctx.cache.get<MetroSummary>(CACHE_SOURCE, cacheKey);
  let cache: DataResult<TrafficProxyData>['cache'] = summary ? 'hit' : 'miss';
  const problems: string[] = [];
  if (!summary) {
    let q = deps.snapshotQuery;
    if (!q) {
      try {
        q = await supabaseSnapshotQuery();
      } catch (err) {
        problems.push(`iq_poi_snapshot 未加载 / Supabase 未配置（${(err as Error)?.message ?? err}）`);
      }
    }
    if (q) {
      try {
        summary = summarizeSnapshots(await q(input.metro, since));
        await ctx.cache.set(CACHE_SOURCE, cacheKey, summary, CACHE_TTL_S);
      } catch (err) {
        problems.push(`iq_poi_snapshot 查询失败：${(err as Error)?.message ?? err}`);
      }
    }
    if (!summary) cache = 'none';
  }

  const ids = [...new Set(input.placeIds)];
  if (ids.length === 0) {
    return {
      ...base,
      status: 'ok',
      data: { per_place: {}, method: 'review_percentile', metro_sample_size: 0, latest_snapshot_month: summary?.latest_month ?? null },
      source: 'iq_poi_snapshot',
      coverage_note: '无需评估的地点（placeIds 为空）。',
      cache,
      elapsed_ms: Date.now() - t0,
    };
  }

  const growthSample = summary ? Object.values(summary.growth).map((g) => g.monthly_review_growth) : [];
  // Count sample: latest snapshot month across the metro when available, else the caller's counts.
  const latestCounts = summary ? Object.values(summary.latest_counts) : [];
  const callerCounts = Object.values(input.currentCounts).filter((n) => Number.isFinite(n));
  const countSample = latestCounts.length >= MIN_SAMPLE ? latestCounts : callerCounts;
  const countSampleName = latestCounts.length >= MIN_SAMPLE ? `iq_poi_snapshot ${summary?.latest_month ?? ''} 月` : '本次 Google 结果';

  const per_place: Record<string, TrafficProxyPlace> = {};
  let withHistory = 0;
  let viaPercentile = 0;
  let unrated = 0;
  for (const pid of ids) {
    const g = summary?.growth[pid];
    if (g && growthSample.length >= MIN_SAMPLE) {
      const pct = percentileOf(g.monthly_review_growth, growthSample);
      per_place[pid] = {
        monthly_review_growth: Math.round(g.monthly_review_growth * 100) / 100,
        months_of_history: g.months_of_history,
        traffic_tier: tierOf(pct),
        percentile: pct,
      };
      withHistory++;
      continue;
    }
    const cur = input.currentCounts[pid];
    const months = summary?.months[pid] ?? 0;
    if (typeof cur === 'number' && Number.isFinite(cur) && countSample.length >= MIN_SAMPLE) {
      const pct = percentileOf(cur, countSample);
      per_place[pid] = {
        monthly_review_growth: g ? Math.round(g.monthly_review_growth * 100) / 100 : null,
        months_of_history: months,
        traffic_tier: tierOf(pct),
        percentile: pct,
      };
      viaPercentile++;
    } else {
      per_place[pid] = { monthly_review_growth: null, months_of_history: months, traffic_tier: null, percentile: null };
      unrated++;
    }
  }

  const method: TrafficProxyData['method'] = withHistory > 0 ? 'snapshot_growth' : 'review_percentile';
  const metro_sample_size = method === 'snapshot_growth' ? growthSample.length : countSample.length;
  const data: TrafficProxyData = { per_place, method, metro_sample_size, latest_snapshot_month: summary?.latest_month ?? null };

  if (withHistory === 0 && viaPercentile === 0) {
    return {
      ...failed<TrafficProxyData>(SOURCE_ID, ctx, {
        source: 'iq_poi_snapshot',
        license: LICENSE,
        note: `无历史快照且当前评论数样本不足（<${MIN_SAMPLE}）→ 流量等级标「未获取」。${problems.join('；')}`.trim(),
        error: problems.join('; ') || 'insufficient sample',
      }),
      data,
      elapsed_ms: Date.now() - t0,
    };
  }

  const notes: string[] = [];
  if (withHistory > 0) {
    notes.push(`${withHistory}/${ids.length} 个地点有 ≥2 个月快照 → 月均新增评论数在 metro ${growthSample.length} 家有历史的门店中的百分位（五分位等级）。`);
  }
  if (viaPercentile > 0) {
    notes.push(`无历史快照 → 相对等级（评论数百分位）：${viaPercentile}/${ids.length} 个地点按当前评论数在${countSampleName}（n=${countSample.length}）中的百分位定级。`);
  }
  if (unrated > 0) notes.push(`${unrated} 个地点无评论数或样本不足，等级为 null。`);
  notes.push('等级为相对值，不代表绝对客流。');
  if (problems.length) notes.push(problems.join('；'));

  const allHistory = withHistory === ids.length;
  return {
    ...base,
    status: allHistory && problems.length === 0 ? 'ok' : 'partial',
    data,
    source: summary
      ? `Supabase iq_poi_snapshot（${summary.rows} 行，${since} 起）`
      : '本次 Google Places 评论数（无快照表）',
    coverage_note: notes.join(' '),
    cache,
    degraded_from: withHistory === 0 ? 'snapshot_growth' : undefined,
    error: problems.length ? problems.join('; ') : undefined,
    elapsed_ms: Date.now() - t0,
  };
}
