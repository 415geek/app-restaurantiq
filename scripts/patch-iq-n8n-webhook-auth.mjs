#!/usr/bin/env node
/**
 * Patch production IQ workflows: Webhook headerAuth + drop duplicate Code auth check.
 * Uses n8nac local API key (not committed).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST = 'https://n8n.c8geek.cloud';
const CRED_PATH = path.join(os.homedir(), 'Library/Preferences/n8nac-nodejs/credentials.json');
const HEADER_CRED = { id: 'JI9XqrzAg4eF0ayn', name: 'RestaurantIQ IQ Webhook Bearer' };

const WORKFLOWS = [
  { id: 'a8d59350c9884d63', validateName: 'Validate+Prompt' },
  { id: '0b4e252ef26f49c8', validateName: 'Validate+Prompt' },
];

function loadApiKey() {
  const raw = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  return raw.hosts[HOST] || raw.instanceProfiles['instance-263f656b'];
}

function stripCodeAuth(jsCode) {
  const marker = 'const body = root.body || {};';
  const idx = jsCode.indexOf(marker);
  if (idx === -1) throw new Error('Could not find body marker in Validate+Prompt code');
  const tail = jsCode.slice(idx);
  return `let root = $json;
try {
  root = $('Webhook').first().json;
} catch {
  /* fallback when Webhook item shape differs */
}

${tail}`;
}

async function patchWorkflow(apiKey, workflowId, validateName) {
  const getRes = await fetch(`${HOST}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': apiKey },
  });
  if (!getRes.ok) throw new Error(`GET ${workflowId}: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  for (const node of wf.nodes) {
    if (node.name === 'Webhook' && node.type === 'n8n-nodes-base.webhook') {
      node.parameters = node.parameters || {};
      node.parameters.authentication = 'headerAuth';
      node.credentials = { httpHeaderAuth: { ...HEADER_CRED } };
    }
    if (node.name === validateName && node.type === 'n8n-nodes-base.code') {
      node.parameters.jsCode = stripCodeAuth(node.parameters.jsCode || '');
    }
  }

  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: wf.settings?.executionOrder || 'v1' },
  };

  const putRes = await fetch(`${HOST}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!putRes.ok) throw new Error(`PUT ${workflowId}: ${putRes.status} ${await putRes.text()}`);
  console.log(`Patched ${workflowId} (${wf.name})`);
}

const apiKey = loadApiKey();
for (const w of WORKFLOWS) {
  await patchWorkflow(apiKey, w.id, w.validateName);
}
