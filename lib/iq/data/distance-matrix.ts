/**
 * §4.2 「距离用路网」 — Google Distance Matrix (walking) from the site to the
 * Layer-1 / Layer-2 candidates within 1600 m straight-line.
 *
 * Batches ≤ 25 destinations per request (API limit), caches every leg by
 * (origin@4dp → destination@4dp) for 90 days through `ctx.cache` like the other
 * fetchers, and books each *network* request to the ledger under D6 at
 * `data_budget.distance_matrix_cost_usd_per_element` × elements once the account
 * is billed (GOOGLE_PLACES_BILLED=1; the Essentials SKU sits inside the monthly
 * free allowance otherwise). `data_budget.distance_matrix_max_calls` (4) caps the
 * requests per report; legs beyond the cap simply stay straight-line.
 */
import { getDefaults } from '@/lib/iq/params';
import { roundCoord } from '@/lib/funnel/iq-market-cache';
import { fetchWithTimeout } from './context';
import type { FetchContext, LatLng } from './types';

export interface WalkLeg {
  /** Walking network distance, metres. */
  walk_m: number;
  /** Walking time, minutes (rounded). */
  walk_min: number;
}

export interface WalkingInput {
  origin: LatLng;
  destinations: Array<{ id: string; lat: number; lng: number }>;
  /** Override defaults.data_budget.distance_matrix_max_calls. */
  maxCalls?: number;
}

export interface WalkingResult {
  walk: Record<string, WalkLeg>;
  calls_made: number;
  cache_hits: number;
  /** Destinations that got no leg (over budget, API error, or no walking route). */
  missing: string[];
  status: 'ok' | 'partial' | 'failed' | 'no_key' | 'empty';
  note: string;
  cost_usd: number;
}

const SOURCE_ID = 'D6' as const;
const CACHE_SOURCE = 'iq360_distance_matrix';
const CACHE_TTL_S = 90 * 24 * 3600;
const URL_BASE = 'https://maps.googleapis.com/maps/api/distancematrix/json';
export const MAX_DESTINATIONS_PER_CALL = 25;

export function perElementCost(ctx: Pick<FetchContext, 'env'>): number {
  const billed = (ctx.env('GOOGLE_PLACES_BILLED') ?? '').toLowerCase();
  return billed === '1' || billed === 'true' ? getDefaults().data_budget.distance_matrix_cost_usd_per_element : 0;
}

function legKey(o: LatLng, d: LatLng): string {
  return `${roundCoord(o.lat)},${roundCoord(o.lng)}>${roundCoord(d.lat)},${roundCoord(d.lng)}`;
}

interface MatrixResponse {
  status?: string;
  error_message?: string;
  rows?: Array<{ elements?: Array<{ status?: string; distance?: { value?: number }; duration?: { value?: number } }> }>;
}

export async function fetchWalkingDistances(input: WalkingInput, ctx: FetchContext): Promise<WalkingResult> {
  const walk: Record<string, WalkLeg> = {};
  const missing: string[] = [];
  const base = { walk, calls_made: 0, cache_hits: 0, missing, cost_usd: 0 };
  if (!input.destinations.length) return { ...base, status: 'empty', note: 'no destinations' };

  // Cache first: legs already known cost nothing.
  const pending: WalkingInput['destinations'] = [];
  let cacheHits = 0;
  for (const d of input.destinations) {
    const hit = await ctx.cache.get<WalkLeg>(CACHE_SOURCE, legKey(input.origin, d));
    if (hit && typeof hit.walk_m === 'number' && typeof hit.walk_min === 'number') {
      walk[d.id] = hit;
      cacheHits++;
    } else pending.push(d);
  }
  if (!pending.length) return { ...base, cache_hits: cacheHits, status: 'ok', note: `${cacheHits} 条步行距离全部命中缓存` };

  const key = ctx.env('GOOGLE_MAPS_API_KEY');
  if (!key) {
    missing.push(...pending.map((d) => d.id));
    return { ...base, cache_hits: cacheHits, status: 'no_key', note: 'GOOGLE_MAPS_API_KEY 未设置：步行距离改用直线距离' };
  }

  const maxCalls = Math.max(0, input.maxCalls ?? getDefaults().data_budget.distance_matrix_max_calls);
  const batches: Array<WalkingInput['destinations']> = [];
  for (let i = 0; i < pending.length; i += MAX_DESTINATIONS_PER_CALL) batches.push(pending.slice(i, i + MAX_DESTINATIONS_PER_CALL));
  const overBudget = batches.splice(maxCalls);
  for (const b of overBudget) missing.push(...b.map((d) => d.id));

  const errors: string[] = [];
  let calls = 0;
  let costUsd = 0;
  for (const batch of batches) {
    const url = new URL(URL_BASE);
    url.searchParams.set('origins', `${input.origin.lat},${input.origin.lng}`);
    url.searchParams.set('destinations', batch.map((d) => `${d.lat},${d.lng}`).join('|'));
    url.searchParams.set('mode', 'walking');
    url.searchParams.set('units', 'metric');
    url.searchParams.set('key', key);
    let res: Response;
    try {
      res = await fetchWithTimeout(ctx, url, { method: 'GET', timeoutMs: Math.min(10_000, ctx.budgetMs) });
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError' ? 'timeout' : String((err as Error)?.message ?? err);
      errors.push(msg);
      missing.push(...batch.map((d) => d.id));
      continue;
    }
    calls++;
    const cost = Math.round(perElementCost(ctx) * batch.length * 10_000) / 10_000;
    costUsd += cost;
    ctx.cost.add(SOURCE_ID, cost, `DistanceMatrix walking ×${batch.length} → HTTP ${res.status}`);
    let json: MatrixResponse = {};
    try {
      json = (await res.json()) as MatrixResponse;
    } catch {
      /* fallthrough → treated as an error below */
    }
    if (!res.ok || json.status !== 'OK' || !Array.isArray(json.rows) || !json.rows[0]?.elements) {
      errors.push(json.error_message ?? json.status ?? `HTTP ${res.status}`);
      missing.push(...batch.map((d) => d.id));
      continue;
    }
    const elements = json.rows[0].elements;
    batch.forEach((d, i) => {
      const el = elements[i];
      if (!el || el.status !== 'OK' || typeof el.distance?.value !== 'number' || typeof el.duration?.value !== 'number') {
        missing.push(d.id);
        return;
      }
      const leg: WalkLeg = { walk_m: Math.round(el.distance.value), walk_min: Math.max(1, Math.round(el.duration.value / 60)) };
      walk[d.id] = leg;
      void ctx.cache.set(CACHE_SOURCE, legKey(input.origin, d), leg, CACHE_TTL_S);
    });
  }

  const got = Object.keys(walk).length;
  const status: WalkingResult['status'] = got === 0 ? 'failed' : missing.length ? 'partial' : 'ok';
  const notes = [`步行距离 ${got}/${input.destinations.length}（网络 ${calls}，缓存 ${cacheHits}）`];
  if (overBudget.length) notes.push(`超出预算 ${overBudget.reduce((s, b) => s + b.length, 0)} 个目的地保留直线距离`);
  if (errors.length) notes.push(`失败：${errors.join('；')}`);
  return { walk, calls_made: calls, cache_hits: cacheHits, missing, status, note: notes.join('；'), cost_usd: Math.round(costUsd * 10_000) / 10_000 };
}
