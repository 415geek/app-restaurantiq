/**
 * Runtime configuration from the database (public.iq_settings).
 *
 * Why: the operator cannot always reach the Vercel dashboard, but the app
 * always reaches Supabase with its service role. Allow-listed keys stored in
 * iq_settings are copied onto process.env once per serverless instance (and
 * refreshed every 5 minutes), OVERRIDING whatever the deployment env carries,
 * so a broken key can be replaced without a redeploy.
 *
 * Call `await ensureRuntimeConfig()` at the top of any route that needs these
 * keys. Never throws; without Supabase env it is a no-op.
 */
import { supabaseAdmin } from '@/lib/server/supabase-admin';
import { envValue } from '@/lib/env-value';

export const RUNTIME_CONFIG_KEYS = [
  'GOOGLE_MAPS_API_KEY',
  'GOOGLE_PLACES_BILLED',
  'MAPBOX_TOKEN',
  'CRON_SECRET',
  'TAVILY_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'CENSUS_API_KEY',
  'IQ_PRINT_TOKEN',
  'IQ360_AUTO',
  'IQ_ENGINE',
  'IQ_STRUCTURED_OUTPUT',
  'RESEND_API_KEY',
  'IQ_EMAIL_FROM',
  'YELP_API_KEY',
  'DATABASE_URL',
] as const;

const TTL_MS = 5 * 60_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
let applied: Record<string, string> = {};

export async function ensureRuntimeConfig(): Promise<Record<string, string>> {
  if (Date.now() - loadedAt < TTL_MS) return applied;
  if (inflight) {
    await inflight;
    return applied;
  }
  inflight = (async () => {
    if (!envValue('SUPABASE_URL') || !envValue('SUPABASE_SERVICE_ROLE_KEY')) {
      loadedAt = Date.now();
      return;
    }
    try {
      const sb = supabaseAdmin();
      const { data, error } = await sb.from('iq_settings').select('key, value');
      if (error) {
        // Table missing (migration 0010 not applied) or transient — keep env as is.
        loadedAt = Date.now();
        return;
      }
      const allowed = new Set<string>(RUNTIME_CONFIG_KEYS);
      const next: Record<string, string> = {};
      for (const row of data ?? []) {
        const k = String(row.key ?? '').trim();
        const v = typeof row.value === 'string' ? row.value.trim() : '';
        if (!allowed.has(k) || !v) continue;
        process.env[k] = v;
        next[k] = v;
      }
      applied = next;
      loadedAt = Date.now();
      if (Object.keys(next).length) console.log(`[runtime-config] applied ${Object.keys(next).join(', ')} from iq_settings`);
    } catch (e) {
      console.warn('[runtime-config] load failed (using deployment env):', e instanceof Error ? e.message : e);
      loadedAt = Date.now();
    }
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
  return applied;
}
