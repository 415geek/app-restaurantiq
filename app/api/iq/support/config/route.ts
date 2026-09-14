import { NextResponse } from 'next/server';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/iq/support/config → { whatsapp: string | null, email: string | null }
 *
 * Human-handoff targets for the support bubble. `SUPPORT_WHATSAPP` is the
 * operator's number in international digits (e.g. 14155551234) and lives in
 * `iq_settings` (runtime config) or the deployment env; `SUPPORT_EMAIL` is
 * the fallback when no WhatsApp number is configured.
 */
export async function GET(): Promise<Response> {
  await ensureRuntimeConfig();
  const whatsapp = (process.env.SUPPORT_WHATSAPP ?? '').replace(/[^\d]/g, '') || null;
  const email = process.env.SUPPORT_EMAIL?.trim() || process.env.IQ_EMAIL_FROM?.trim() || null;
  return NextResponse.json({ whatsapp, email }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
