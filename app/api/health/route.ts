import { NextRequest, NextResponse } from 'next/server';
import { integrationEnvStatus } from '@/lib/env';
import { getAnalyzeWebhookUrl } from '@/lib/n8n';
import { unknownErrorMessage } from '@/lib/unknown-error-message';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const service = req.nextUrl.searchParams.get('service') as keyof typeof integrationEnvStatus | null;
  const probe = req.nextUrl.searchParams.get('probe');

  if (probe === 'iq-supabase') {
    try {
      const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
      const sb = supabaseAdmin();
      const { error } = await sb.from('iq_location_reports').select('id').limit(1);
      return NextResponse.json({
        ok: !error,
        error: error?.message ?? null,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: unknownErrorMessage(e, 300),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (probe === 'iq-n8n') {
    const url = getAnalyzeWebhookUrl();
    if (!url) {
      return NextResponse.json({
        ok: false,
        reason: 'N8N analyze webhook URL not configured',
        timestamp: new Date().toISOString(),
      });
    }
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep raw for debug */
    }
    const secret =
      process.env.N8N_IQ_WEBHOOK_SECRET?.trim() || process.env.N8N_INTERNAL_AUTH_TOKEN?.trim();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ address: 'probe', industry: 'restaurant', language: 'en' }),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      return NextResponse.json({
        ok: res.ok,
        host,
        status: res.status,
        bodyPreview: text.slice(0, 120),
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const cause = e instanceof Error && e.cause !== undefined ? unknownErrorMessage(e.cause, 200) : undefined;
      return NextResponse.json({
        ok: false,
        host,
        error: unknownErrorMessage(e, 300),
        ...(cause ? { cause } : {}),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (!service) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: integrationEnvStatus,
      iqN8n: {
        configured: Boolean(getAnalyzeWebhookUrl()),
        host: (() => {
          const u = getAnalyzeWebhookUrl();
          if (!u) return null;
          try {
            return new URL(u).host;
          } catch {
            return 'invalid_url';
          }
        })(),
      },
    });
  }

  const configured = integrationEnvStatus[service];
  if (configured) {
    return NextResponse.json({ status: 'connected', detail: `${service} configuration detected.`, timestamp: new Date().toISOString() });
  }
  return NextResponse.json({ status: 'missing', detail: `${service} is not configured in env. Mock fallback active if supported.`, timestamp: new Date().toISOString() });
}
