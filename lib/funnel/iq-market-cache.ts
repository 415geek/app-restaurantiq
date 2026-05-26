/**
 * Shared TTL cache for paid external market-data APIs (Yelp / Foursquare / Census).
 *
 * Why: paid LocationIQ reports for the same address can be regenerated multiple times
 * (premium retry, n8n + OpenAI race, language switch). Each external call costs money
 * and is rate-limited. We hash (source, key) and persist payload to Supabase.
 *
 * Safety: silently skips cache reads/writes if Supabase env isn't configured (e.g. local
 * dev without DB) — never throws. Callers can run "cacheless" without code changes.
 */

import { supabaseAdmin } from '@/lib/server/supabase-admin';
import { envValue } from '@/lib/env-value';

export type MarketCacheSource =
  | 'yelp_search'
  | 'yelp_business_detail'
  | 'yelp_reviews'
  | 'foursquare_search'
  | 'foursquare_place_detail'
  | 'google_places_textsearch'
  | 'census_acs'
  | 'deepseek_summary'
  | 'claude_demographics';

export interface MarketCacheKeyInput {
  source: MarketCacheSource;
  /** Stable string fingerprint, e.g. JSON of params + rounded lat/lng. */
  key: string;
}

function hasSupabaseEnv(): boolean {
  return Boolean(envValue('SUPABASE_URL')) && Boolean(envValue('SUPABASE_SERVICE_ROLE_KEY'));
}

function buildCacheKey(input: MarketCacheKeyInput): string {
  return `${input.source}::${input.key}`;
}

/**
 * Returns the cached payload if it exists AND has not expired. Otherwise null.
 * Never throws — DB outages just mean we skip cache.
 */
export async function readMarketCache<T = unknown>(
  input: MarketCacheKeyInput,
): Promise<T | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supa = supabaseAdmin();
    const cacheKey = buildCacheKey(input);
    const { data, error } = await supa
      .from('iq_market_cache')
      .select('payload, expires_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    const exp = new Date(data.expires_at as string).getTime();
    if (Number.isFinite(exp) && exp > Date.now()) {
      return data.payload as T;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Upserts a payload into the cache with the given TTL (in seconds).
 * Never throws.
 */
export async function writeMarketCache(
  input: MarketCacheKeyInput & { payload: unknown; ttlSeconds: number },
): Promise<void> {
  if (!hasSupabaseEnv()) return;
  if (!input.payload) return;
  try {
    const supa = supabaseAdmin();
    const cacheKey = buildCacheKey(input);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    let payloadJson: string;
    try {
      payloadJson = JSON.stringify(input.payload);
    } catch {
      return;
    }
    const bytes = Buffer.byteLength(payloadJson, 'utf8');
    // Supabase upsert by primary key
    await supa
      .from('iq_market_cache')
      .upsert(
        {
          cache_key: cacheKey,
          source: input.source,
          payload: input.payload,
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt,
          bytes,
        },
        { onConflict: 'cache_key' },
      );
  } catch {
    // ignore — cache misses are tolerable
  }
}

/** Round lat/lng to 4 decimals so identical-address requests share cache lines. */
export function roundCoord(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
