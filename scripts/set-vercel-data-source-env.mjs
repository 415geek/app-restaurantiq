#!/usr/bin/env node
/**
 * Idempotently push the D-Phase external data source keys to Vercel
 * (production, preview, development) by reading from .env.local.
 *
 * Will NOT echo secret values to stdout. Only prints key + target + status.
 *
 *   node scripts/set-vercel-data-source-env.mjs [projectId]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

const KEYS_TO_PUSH = [
  'CENSUS_API_KEY',
  'YELP_API_KEY',
  'FOURSQUARE_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_API_KEY_BACKUP',
  'DEEPSEEK_API_KEY',
  'GOOGLE_MAPS_API_KEY',
];

function unquote(v) {
  v = String(v ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

function readEnv(name) {
  if (!fs.existsSync(ENV_FILE)) return '';
  const line = fs.readFileSync(ENV_FILE, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? unquote(line.slice(name.length + 1)) : '';
}

function readCliToken() {
  const candidates = [
    path.join(os.homedir(), 'Library/Application Support/com.vercel.cli/auth.json'),
    path.join(os.homedir(), '.local/share/com.vercel.cli/auth.json'),
    path.join(os.homedir(), '.config/com.vercel.cli/auth.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.token) return j.token;
      }
    } catch {}
  }
  return null;
}

const token = process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN || readCliToken();
if (!token) {
  console.error('Missing VERCEL_TOKEN and no local CLI auth.json found.');
  process.exit(1);
}

const projectId =
  process.argv[2] ||
  process.env.VERCEL_PROJECT_ID ||
  (() => {
    try {
      const repo = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel/repo.json'), 'utf8'));
      return repo.projects?.[0]?.id;
    } catch {
      return null;
    }
  })();
if (!projectId) {
  console.error('Provide projectId as first arg or set VERCEL_PROJECT_ID.');
  process.exit(1);
}

const teamId =
  process.env.VERCEL_TEAM_ID ||
  (() => {
    try {
      const repo = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel/repo.json'), 'utf8'));
      return repo.projects?.[0]?.orgId;
    } catch {
      return null;
    }
  })();

const vars = KEYS_TO_PUSH.map((k) => ({ key: k, value: readEnv(k) }));
const missing = vars.filter((v) => !v.value);
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.map((m) => m.key).join(', ')}`);
  process.exit(1);
}
const targets = ['production', 'preview', 'development'];
const qs = teamId ? `?teamId=${teamId}` : '';

async function listEnvs() {
  const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list envs: ${res.status} ${await res.text()}`);
  return (await res.json()).envs || [];
}

async function upsert(key, value, target) {
  const existing = (await listEnvs()).filter(
    (e) => e.key === key && Array.isArray(e.target) && e.target.includes(target),
  );
  for (let i = 1; i < existing.length; i++) {
    const del = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing[i].id}${qs}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!del.ok) console.warn(`! could not remove duplicate ${key} ${target}: ${del.status}`);
  }
  if (existing[0]) {
    const patch = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing[0].id}${qs}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, target: [target] }),
    });
    if (!patch.ok) throw new Error(`PATCH ${key} ${target}: ${patch.status} ${await patch.text()}`);
    console.log(`↻ ${key} → ${target}`);
    return;
  }
  const desiredType = target === 'development' ? 'encrypted' : 'sensitive';
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, type: desiredType, target: [target] }),
  });
  const text = await res.text();
  if (res.ok) {
    console.log(`✓ ${key} → ${target}`);
    return;
  }
  throw new Error(`POST ${key} ${target}: ${res.status} ${text}`);
}

for (const { key, value } of vars) {
  for (const target of targets) {
    await upsert(key, value, target);
  }
}

console.log('\nDone. Push a commit or run `npx vercel --prod` to roll into a fresh build.');
