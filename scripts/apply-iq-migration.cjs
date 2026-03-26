/**
 * Runs supabase/migrations/0002_iq_location_reports.sql against Postgres.
 * Intended for Vercel build when DATABASE_URL is set (Supabase → Settings → Database → URI).
 *
 * If DATABASE_URL is missing, exits 0 and skips (so local `next build` still works).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) {
    console.warn(
      '[apply-iq-migration] DATABASE_URL not set — skipping SQL migration. Set it in Vercel to auto-apply on deploy.',
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
