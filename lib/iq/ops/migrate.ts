/**
 * Runtime migration runner: applies every SQL file under supabase/migrations
 * that scripts/apply-iq-migration.cjs knows about, in order, over
 * DATABASE_URL. All files are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT
 * EXISTS), so re-running is safe. Used by the ops endpoint and by
 * generateReport360 when it hits a missing 0009 column.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envValue } from '@/lib/env-value';

export const MIGRATION_FILES = [
  '0002_iq_location_reports.sql',
  '0003_add_user_id.sql',
  '0004_add_language.sql',
  '20260327_add_share_features.sql',
  '0007_iq_market_cache.sql',
  '0008_iq_report_generation.sql',
  '0009_iq_360_data_layer.sql',
  '0010_iq_settings.sql',
  '0011_iq_source_candidates.sql',
];

export interface MigrateResult {
  ok: boolean;
  applied: string[];
  reason: string | null;
}

function usableDatabaseUrl(): string | null {
  const raw = envValue('DATABASE_URL');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (!h || h === 'localhost' || h === '127.0.0.1') return null;
    return u.toString();
  } catch {
    return null;
  }
}

let inflight: Promise<MigrateResult> | null = null;

export function migrationsAvailable(): boolean {
  return Boolean(usableDatabaseUrl());
}

/** Apply pending migrations once per process (concurrent callers share the run). */
export async function runPendingMigrations(opts: { only?: string[] } = {}): Promise<MigrateResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    const url = usableDatabaseUrl();
    if (!url) return { ok: false, applied: [], reason: 'DATABASE_URL 未设置（Supabase → Settings → Database → URI）' };
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    const applied: string[] = [];
    try {
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
      for (const name of opts.only ?? MIGRATION_FILES) {
        const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
        await client.query(sql);
        applied.push(name);
      }
      return { ok: true, applied, reason: null };
    } catch (e) {
      return { ok: false, applied, reason: e instanceof Error ? e.message : String(e) };
    } finally {
      await client.end().catch(() => {});
    }
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
