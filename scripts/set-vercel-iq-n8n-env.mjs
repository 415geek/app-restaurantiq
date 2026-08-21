#!/usr/bin/env node
/**
 * Set IQ n8n env vars on Vercel via REST API.
 * Requires VERCEL_TOKEN in environment or .env.local (VERCEL_TOKEN or VERCEL_ACCESS_TOKEN).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

function loadEnvLocal() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function unquoteEnvValue(raw) {
  let v = String(raw ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function get(name) {
  const line = fs.readFileSync(ENV_FILE, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? unquoteEnvValue(line.slice(name.length + 1)) : '';
}

loadEnvLocal();

const token = process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN;
if (!token) {
  console.error('Missing VERCEL_TOKEN. Add to .env.local or export before running.');
  process.exit(1);
}

const projectId =
  process.env.VERCEL_PROJECT_ID ||
  process.argv[2] ||
  (() => {
    try {
      const repo = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel/repo.json'), 'utf8'));
      return repo.projects?.[0]?.id;
    } catch {
      return undefined;
    }
  })();
if (!projectId) {
  console.error('Usage: VERCEL_TOKEN=... node scripts/set-vercel-iq-n8n-env.mjs <vercel-project-id>');
  console.error('Or set VERCEL_PROJECT_ID in .env.local');
  process.exit(1);
}

const analyzeUrl = get('N8N_IQ_ANALYZE_WEBHOOK_URL') || get('N8N_ANALYZE_WEBHOOK_URL');
const fullUrl = get('N8N_IQ_FULL_REPORT_WEBHOOK_URL') || get('N8N_FULL_REPORT_WEBHOOK_URL');
const secret = get('N8N_IQ_WEBHOOK_SECRET') || get('N8N_INTERNAL_AUTH_TOKEN');

const vars = [
  { key: 'N8N_IQ_ANALYZE_WEBHOOK_URL', value: analyzeUrl },
  { key: 'N8N_IQ_FULL_REPORT_WEBHOOK_URL', value: fullUrl },
  { key: 'N8N_IQ_WEBHOOK_SECRET', value: secret, type: 'encrypted' },
  // Legacy names still read first in lib/n8n.ts — keep them in sync (no JSON quotes).
  { key: 'N8N_ANALYZE_WEBHOOK_URL', value: analyzeUrl },
  { key: 'N8N_FULL_REPORT_WEBHOOK_URL', value: fullUrl },
];

for (const v of vars) {
  if (!v.value) {
    console.error(`Missing ${v.key} in .env.local`);
    process.exit(1);
  }
}

const targets = ['production', 'preview', 'development'];

for (const { key, value, type } of vars) {
  for (const target of targets) {
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        value,
        type: type || 'plain',
        target: [target],
      }),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`✓ ${key} → ${target}`);
      continue;
    }
    if (res.status === 409 || text.includes('already exists')) {
      const list = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const envs = await list.json();
      const existing = (envs.envs || []).find((e) => e.key === key && e.target?.includes(target));
      if (!existing) {
        console.error(`✗ ${key} ${target}:`, text);
        process.exit(1);
      }
      const patch = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value, type: type || 'plain', target: [target] }),
      });
      if (!patch.ok) {
        console.error(`✗ PATCH ${key} ${target}:`, await patch.text());
        process.exit(1);
      }
      console.log(`↻ ${key} → ${target} (updated)`);
    } else {
      console.error(`✗ ${key} ${target}:`, text);
      process.exit(1);
    }
  }
}

console.log('Done. Redeploy production for changes to apply.');
