/**
 * Runs supabase/migrations/0002_iq_location_reports.sql against Postgres.
 * Intended for Vercel build when DATABASE_URL is set (Supabase → Settings → Database → URI).
 *
 * If DATABASE_URL is missing, exits 0 and skips (so local `next build` still works).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
  const url = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!url) {
    console.warn(
      '[apply-iq-migration] DATABASE_URL missing/invalid (or points to localhost) — skipping SQL migration.',
    );
    console.warn(
      '[apply-iq-migration] Fix Vercel env DATABASE_URL using Supabase: Project Settings → Database → Connection string → URI.',
    );
    process.exit(0);
  }

  const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '0002_iq_location_reports.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await client.query(sql);
    console.log('[apply-iq-migration] iq_location_reports migration applied OK');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[apply-iq-migration] FAILED:', err.message);
  process.exit(1);
});
