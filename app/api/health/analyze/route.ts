import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type ServiceResult = {
  configured: boolean;
  reachable?: boolean;
  latencyMs?: number;
  error?: string;
  hint?: string;
};

async function testN8n(): Promise<ServiceResult> {
  const url =
    process.env.N8N_IQ_ANALYZE_WEBHOOK_URL?.trim() ||
    process.env.N8N_ANALYZE_WEBHOOK_URL?.trim() ||
    null;

  if (!url) {
    return {
      configured: false,
      hint: 'Set N8N_IQ_ANALYZE_WEBHOOK_URL in Vercel env vars',
    };
  }

  const token =
    process.env.N8N_IQ_WEBHOOK_SECRET?.trim() ||
    process.env.N8N_INTERNAL_AUTH_TOKEN?.trim() ||
    null;

  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const start = Date.now();
  try {
    // Send a minimal probe payload — real workflows should ignore or short-circuit on missing required fields.
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ _healthcheck: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;
    const body = await res.text().catch(() => '');

    if (res.ok || res.status === 400 || res.status === 422) {
      // Any HTTP response means the server is reachable
      return { configured: true, reachable: true, latencyMs };
    }
    return {
      configured: true,
      reachable: true,
      latencyMs,
      error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      hint:
        res.status === 401 || res.status === 403
          ? 'Auth failed — check N8N_IQ_WEBHOOK_SECRET / N8N_INTERNAL_AUTH_TOKEN'
          : undefined,
    };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.includes('timed out') || msg.includes('abort') || msg.toLowerCase().includes('timeout');
    return {
      configured: true,
      reachable: false,
      latencyMs,
      error: msg,
      hint: isTimeout
        ? 'N8N responded but took > 10 s — it may be running slowly'
        : 'Cannot reach N8N host — check if the server is running and publicly accessible from Vercel',
    };
  }
}

async function testOpenAi(): Promise<ServiceResult> {
  const key = process.env.OPENAI_API_KEY?.trim() || null;

  if (!key) {
    return {
      configured: false,
      hint: 'Set OPENAI_API_KEY in Vercel env vars',
    };
  }

  const start = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) return { configured: true, reachable: true, latencyMs };

    const body = await res.json().catch(() => ({}));
    const errMsg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    return {
      configured: true,
      reachable: res.status !== 401 && res.status !== 403,
      latencyMs,
      error: errMsg,
      hint:
        res.status === 401
          ? 'API key is invalid or expired — regenerate it at platform.openai.com/api-keys'
          : res.status === 429
          ? 'Rate limited or quota exceeded'
          : undefined,
    };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      configured: true,
      reachable: false,
      latencyMs,
      error: msg,
      hint: 'Cannot reach api.openai.com — check Vercel outbound network policy',
    };
  }
}

export async function GET() {
  const [n8n, openai] = await Promise.all([testN8n(), testOpenAi()]);

  const overallOk = (n8n.reachable === true) || (openai.reachable === true);

  return NextResponse.json(
    {
      status: overallOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { n8n, openai },
      summary: overallOk
        ? 'At least one analysis provider is reachable.'
        : 'No analysis provider is reachable — requests to /api/funnel/analyze will fail.',
    },
    { status: overallOk ? 200 : 503 },
  );
}
