import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/server/supabase-admin';
import { getDemoIdFromRequest, demoUserKey } from '@/lib/server/demo-session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  eventName: z.string().min(1).max(120),
  pathname: z.string().min(1).max(500),
  props: z.record(z.string(), z.unknown()).optional(),
});

function getOrCreateSessionId(req: NextRequest) {
  const cookie = req.cookies.get('riq_sid')?.value;
  if (cookie && cookie.length >= 10 && cookie.length <= 80) return cookie;
  return `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const demoId = getDemoIdFromRequest({ headers: req.headers });
  let userId: string | null = null;
  if (!demoId) {
    try {
      const authResult = await auth();
      userId = authResult.userId ?? null;
    } catch {
      userId = null;
    }
  }

  const sessionId = getOrCreateSessionId(req);
  const userKey = demoId ? demoUserKey(demoId) : (userId ?? null);

  // Telemetry is best-effort; failures must not break the demo.
  try {
    const sb = supabaseAdmin();
    await sb.from('telemetry_events').insert({
      session_id: sessionId,
      user_key: userKey,
      event_name: parsed.data.eventName,
      pathname: parsed.data.pathname,
      props: parsed.data.props ?? {},
      user_agent: req.headers.get('user-agent') ?? null,
    });
  } catch {
    // ignore
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('riq_sid', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
