import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  buildAdminSessionCookieAttrs,
  isAdminAuthConfigured,
  signAdminSession,
  verifyAdminCredentials,
} from '@/lib/server/admin-session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      { error: 'admin_auth_not_configured', detail: 'Set ADMIN_EMAIL and ADMIN_PASSWORD in environment.' },
      { status: 503 },
    );
  }

  let body: { email?: string; password?: string } = {};
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const email = (body.email || '').trim();
  const password = body.password || '';
  if (!email || !password) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  if (!verifyAdminCredentials(email, password)) {
    // Avoid leaking which of the two was wrong.
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const token = signAdminSession(email);
  const secure = process.env.NODE_ENV === 'production';
  const res = NextResponse.json({ ok: true, redirect: '/admin/leads' });
  res.headers.append(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=${token}; ${buildAdminSessionCookieAttrs(secure)}`,
  );
  return res;
}
