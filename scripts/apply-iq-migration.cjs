/**
 * Runs iq funnel SQL migrations in order under supabase/migrations/.
 * (Previously only 0002 ran — production then missed `language` and other columns.)
 *
 * By default this script does NOTHING (exits 0). Vercel build machines often cannot
 * reach Supabase reliably (IPv6 / pooler / SSL). Prefer `supabase db push` in CI or locally.
 *
 * To run migration during `npm run build:vercel`, set:
 *   RUN_IQ_MIGRATION_ON_BUILD=true
 * and a valid DATABASE_URL (Supabase → Settings → Database → URI).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function migrationOnBuildEnabled() {
  const v = String(process.env.RUN_IQ_MIGRATION_ON_BUILD || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function normalizeDatabaseUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (!u.hostname) return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

async function main() {
  if (!migrationOnBuildEnabled()) {
    console.warn(
      '[apply-iq-migration] Skipping SQL migration (RUN_IQ_MIGRATION_ON_BUILD is not true). Use `supabase db push` or enable the flag + DATABASE_URL if you need build-time apply.',
    );
    process.exit(0);
  }

  const url = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!url) {
    console.warn(
      '[apply-iq-migration] RUN_IQ_MIGRATION_ON_BUILD is set but DATABASE_URL is missing/invalid (or points to localhost) — skipping SQL migration.',
    );
    console.warn(
      '[apply-iq-migration] Set DATABASE_URL from Supabase: Project Settings → Database → Connection string → URI.',
    );
    process.exit(0);
  }

  const migrationFiles = [
    '0002_iq_location_reports.sql',
    '0003_add_user_id.sql',
    '0004_add_language.sql',
    '20260327_add_share_features.sql',
  ];

  const client = new Client({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    for (const name of migrationFiles) {
      const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', name);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sql);
      console.log(`[apply-iq-migration] Applied ${name}`);
    }
    console.log('[apply-iq-migration] All iq_location_reports migrations applied OK');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[apply-iq-migration] FAILED:', err.message);
  process.exit(1);
});
