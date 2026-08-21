import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { iqInsertLead } from '@/lib/funnel/iq-repository';

export const runtime = 'nodejs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

function clientIp(req: Request): string | null {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return h.get('x-real-ip');
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      email?: string;
      name?: string;
      phone?: string;
      cuisine?: string;
      location?: string;
      language?: string;
      reportId?: string;
    };

    const email = String(body.email ?? '').trim();
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    }
    if (email.length > 200) {
      return NextResponse.json({ error: 'email_too_long' }, { status: 400 });
    }

    const name = String(body.name ?? '').trim().slice(0, 100) || null;
    const phone = String(body.phone ?? '').trim().slice(0, 60) || null;
    const cuisine = String(body.cuisine ?? '').trim().slice(0, 120) || null;
    const location = String(body.location ?? '').trim().slice(0, 500) || null;
    const language = String(body.language ?? 'en').toLowerCase() === 'zh' ? 'zh' : 'en';
    const reportId = String(body.reportId ?? '').trim() || null;

    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 });
    }
    if (!cuisine) {
      return NextResponse.json({ error: 'cuisine_required' }, { status: 400 });
    }

    const ip = clientIp(req);
    const ipHash = ip ? hashIp(ip) : null;
    const userAgent = req.headers.get('user-agent')?.slice(0, 300) || null;

    let leadId = '';
    try {
      leadId = await iqInsertLead({
        email,
        name,
        phone,
        cuisine,
        location,
        language,
        reportId,
        userAgent,
        ipHash,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Don't block the user from seeing their free report if Supabase is misconfigured.
      // In production this is logged so we can patch env / migrations.
      console.error('[iq/lead] insert failed (non-fatal):', message);
      if (process.env.NODE_ENV === 'production') {
        // Still acknowledge so UX is not blocked; record the gap server-side.
        return NextResponse.json({ ok: true, leadId: '', persisted: false });
      }
      return NextResponse.json(
        { error: 'lead_persist_failed', detail: message.slice(0, 240) },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, leadId, persisted: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[iq/lead]', message);
    return NextResponse.json({ error: 'bad_request', detail: message.slice(0, 240) }, { status: 400 });
  }
}
