#!/usr/bin/env node
/**
 * 本地测试 Analyze webhook（与 /api/funnel/analyze → n8n 入参一致）。
 *
 * 用法：
 *   N8N_IQ_ANALYZE_WEBHOOK_URL="https://你的n8n/webhook/..." \
 *   N8N_IQ_WEBHOOK_SECRET="可选" \
 *   node scripts/test-n8n-analyze-webhook.cjs
 *
 * 或先把 N8N_IQ_ANALYZE_WEBHOOK_URL 写入 .env.local（KEY=value），本脚本会尝试读取。
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function main() {
  loadEnvLocal();

  const url =
    process.env.N8N_IQ_ANALYZE_WEBHOOK_URL?.trim() ||
    process.env.N8N_ANALYZE_WEBHOOK_URL?.trim();
  if (!url) {
    console.error(
      '缺少 N8N_IQ_ANALYZE_WEBHOOK_URL（或 N8N_ANALYZE_WEBHOOK_URL）。\n' +
        '示例：N8N_IQ_ANALYZE_WEBHOOK_URL="https://..." node scripts/test-n8n-analyze-webhook.cjs',
    );
    process.exit(1);
  }

  const secret =
    process.env.N8N_IQ_WEBHOOK_SECRET?.trim() ||
    process.env.N8N_INTERNAL_AUTH_TOKEN?.trim();

  const payload = {
    address: '1600 Amphitheatre Parkway, Mountain View, CA',
    industry: 'restaurant',
    cuisine_type: 'Casual dining',
    language: 'en',
  };

  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('非 JSON 响应:', text.slice(0, 800));
    process.exit(1);
  }

  console.log('HTTP', res.status);
  console.log(JSON.stringify(json, null, 2));

  if (!res.ok) process.exit(1);
  if (!json.verdict || !json.headline) {
    console.error('响应缺少 verdict / headline');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
