#!/usr/bin/env node
/**
 * Idempotently set ADMIN_* env vars on Vercel for production, preview, and development.
 * Reads values from .env.local. Requires VERCEL_TOKEN (or pulls from local CLI auth.json).
 *
 *   node scripts/set-vercel-admin-env.mjs [projectId]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

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

const vars = [
  { key: 'ADMIN_EMAIL', value: readEnv('ADMIN_EMAIL') },
  { key: 'ADMIN_PASSWORD', value: readEnv('ADMIN_PASSWORD') },
  { key: 'ADMIN_SESSION_SECRET', value: readEnv('ADMIN_SESSION_SECRET') },
];
for (const v of vars) {
  if (!v.value) {
    console.error(`Missing ${v.key} in .env.local`);
    process.exit(1);
  }
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
  const existing = (await listEnvs()).filter((e) => e.key === key && Array.isArray(e.target) && e.target.includes(target));
  // If multiple legacy rows exist for the same target, delete extras and patch the first.
  for (let i = 1; i < existing.length; i++) {
    const del = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing[i].id}${qs}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!del.ok) console.warn(`! could not remove duplicate ${key} ${target}: ${del.status}`);
  }
  if (existing[0]) {
    // Don't try to change type — Vercel rejects type change on Sensitive vars.
    const patch = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing[0].id}${qs}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, target: [target] }),
    });
    if (!patch.ok) throw new Error(`PATCH ${key} ${target}: ${patch.status} ${await patch.text()}`);
    console.log(`↻ ${key} → ${target}`);
    return;
  }
  // Sensitive vars can't target 'development' on Vercel — use 'encrypted' there.
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

console.log('Done. Redeploy production to apply: npx vercel --prod');
