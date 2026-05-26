#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST = 'https://n8n.c8geek.cloud';
const apiKey = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), 'Library/Preferences/n8nac-nodejs/credentials.json'), 'utf8'),
).hosts[HOST];

const WORKFLOW_IDS = ['a8d59350c9884d63', '0b4e252ef26f49c8'];

function fixReturns(code, mode) {
  if (mode !== 'runOnceForEachItem' || !code.includes('return [')) return code;
  return code
    .replace(/return\s*\[\s*\{\s*json\s*:/g, 'return { json:')
    .replace(/\}\s*\]\s*;/g, '};');
}

for (const id of WORKFLOW_IDS) {
  const wf = await (
    await fetch(`${HOST}/api/v1/workflows/${id}`, { headers: { 'X-N8N-API-KEY': apiKey } })
  ).json();

  for (const node of wf.nodes) {
    if (node.type !== 'n8n-nodes-base.code') continue;
    node.parameters.jsCode = fixReturns(node.parameters.jsCode || '', node.parameters.mode || '');
  }

  const put = await fetch(`${HOST}/api/v1/workflows/${id}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: { executionOrder: 'v1' },
    }),
  });
  if (!put.ok) {
    console.error(id, put.status, await put.text());
    process.exit(1);
  }
  console.log(`Fixed code returns: ${id}`);
}
