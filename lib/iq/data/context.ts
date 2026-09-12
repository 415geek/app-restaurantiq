/**
 * Default FetchContext: real fetch, Supabase-backed cache (no-op without env),
 * in-memory cost ledger. Tests build their own context with a stub fetch.
 */
import { envValue } from '@/lib/env-value';
import { readMarketCache, writeMarketCache, type MarketCacheSource } from '@/lib/funnel/iq-market-cache';
import type { CacheAdapter, CostEntry, CostLedger, FetchContext } from './types';

export function createCostLedger(): CostLedger {
  const entries: CostEntry[] = [];
  return {
    add(source, usd, note) {
      if (!Number.isFinite(usd) || usd < 0) return;
      entries.push({ source, usd, note, at: new Date().toISOString() });
    },
    total() {
      return Math.round(entries.reduce((s, e) => s + e.usd, 0) * 10_000) / 10_000;
    },
    entries() {
      return [...entries];
    },
    bySource() {
      const out: Record<string, number> = {};
      for (const e of entries) out[e.source] = Math.round(((out[e.source] ?? 0) + e.usd) * 10_000) / 10_000;
      return out;
    },
  };
}

/** Cache adapter over iq_market_cache; every 360° source is namespaced `iq360_*`. */
export function createSupabaseCache(): CacheAdapter {
  return {
    async get<T>(source: string, key: string): Promise<T | null> {
      return readMarketCache<T>({ source: source as MarketCacheSource, key });
    },
    async set(source: string, key: string, payload: unknown, ttlSeconds: number): Promise<void> {
      await writeMarketCache({ source: source as MarketCacheSource, key, payload, ttlSeconds });
    },
  };
}

export function createMemoryCache(): CacheAdapter & { size(): number } {
  const store = new Map<string, { payload: unknown; expires: number }>();
  return {
    async get<T>(source: string, key: string): Promise<T | null> {
      const hit = store.get(`${source}::${key}`);
      if (!hit) return null;
      if (hit.expires < Date.now()) {
        store.delete(`${source}::${key}`);
        return null;
      }
      return hit.payload as T;
    },
    async set(source, key, payload, ttlSeconds) {
      store.set(`${source}::${key}`, { payload, expires: Date.now() + ttlSeconds * 1000 });
    },
    size() {
      return store.size;
    },
  };
}

export function createFetchContext(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    cost: overrides.cost ?? createCostLedger(),
    cache: overrides.cache ?? createSupabaseCache(),
    env: overrides.env ?? envValue,
    now: overrides.now ?? (() => new Date()),
    log: overrides.log ?? ((msg, extra) => (extra === undefined ? console.log(msg) : console.log(msg, extra))),
    budgetMs: overrides.budgetMs ?? 40_000,
  };
}

/** fetch with a hard timeout; rejects with AbortError on expiry. */
export async function fetchWithTimeout(
  ctx: Pick<FetchContext, 'fetch'>,
  url: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 12_000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await ctx.fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
