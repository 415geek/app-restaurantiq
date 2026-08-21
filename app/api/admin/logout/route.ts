import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME } from '@/lib/server/admin-session';

export const runtime = 'nodejs';

function clearCookieResponse(redirectTo: string) {
  const secure = process.env.NODE_ENV === 'production';
  const url = new URL(redirectTo, 'http://placeholder.local');
  const res = NextResponse.redirect(url, { status: 303 });
  res.headers.set(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`,
  );
  return res;
}

/** Plain form-post logout — clears cookie + 303 redirect to /admin/login. */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const dest = new URL('/admin/login', origin);
  const secure = process.env.NODE_ENV === 'production';
  const res = NextResponse.redirect(dest, { status: 303 });
  res.headers.set(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`,
  );
  return res;
}

/** GET also supported so plain links can log out (e.g. from email/audit). */
export async function GET(req: Request) {
  return clearCookieResponse(new URL('/admin/login', new URL(req.url).origin).toString());
}
