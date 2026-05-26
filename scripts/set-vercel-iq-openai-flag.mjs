#!/usr/bin/env node
/**
 * B-0: Force production IQ paid-report path to bypass n8n and use OpenAI directly.
 *
 * Idempotently sets IQ_USE_OPENAI=1 on Vercel for production, preview, and development.
 * Required because n8nac push currently fails (400 additional properties), so prompt
 * changes cannot reach the cloud n8n workflow. Until that is resolved, all IQ analyze
 * + full-report calls run through OpenAI inside the Next.js app — fully repo-controlled.
 *
 * Usage:
 *   node scripts/set-vercel-iq-openai-flag.mjs
 *   node scripts/set-vercel-iq-openai-flag.mjs --off    # rollback path
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

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

let projectId = process.env.VERCEL_PROJECT_ID;
let teamId = process.env.VERCEL_TEAM_ID;
try {
  const repo = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel/repo.json'), 'utf8'));
  projectId ||= repo.projects?.[0]?.id;
  teamId ||= repo.projects?.[0]?.orgId;
} catch {}
if (!projectId) {
  console.error('Missing VERCEL_PROJECT_ID (and .vercel/repo.json not found).');
  process.exit(1);
}

const OFF = process.argv.includes('--off');
const VALUE = OFF ? '0' : '1';
const KEY = 'IQ_USE_OPENAI';
const TARGETS = ['production', 'preview', 'development'];
const qs = teamId ? `?teamId=${teamId}` : '';

async function listEnvs() {
  const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list envs: ${res.status} ${await res.text()}`);
  return (await res.json()).envs || [];
}

async function upsert(target) {
  const existing = (await listEnvs()).filter(
    (e) => e.key === KEY && Array.isArray(e.target) && e.target.includes(target),
  );
  for (let i = 1; i < existing.length; i++) {
    await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing[i].id}${qs}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (existing[0]) {
    const patch = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing[0].id}${qs}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: VALUE, target: [target] }),
    });
    if (!patch.ok) throw new Error(`PATCH ${target}: ${patch.status} ${await patch.text()}`);
    console.log(`↻ ${KEY}=${VALUE} → ${target}`);
    return;
  }
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, value: VALUE, type: 'plain', target: [target] }),
  });
  if (!res.ok) throw new Error(`POST ${target}: ${res.status} ${await res.text()}`);
  console.log(`✓ ${KEY}=${VALUE} → ${target}`);
}

for (const target of TARGETS) {
  await upsert(target);
}

console.log(`\nDone. Redeploy production to apply:\n  npx vercel --prod\n`);
console.log(
  OFF
    ? `Note: IQ_USE_OPENAI=0 — n8n IQ webhooks will resume controlling the path.`
    : `Note: IQ paid reports will skip n8n. Verify by hitting /api/funnel/full-report?force=1.`,
);
