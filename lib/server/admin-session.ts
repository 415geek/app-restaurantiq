/**
 * Admin session — independent of Clerk so the admin tenant cannot be silently
 * widened by Clerk org changes. Single hard-coded admin email + password via env.
 *
 * Cookie format: `${base64url(payload)}.${hex(HMAC-SHA256(secret, base64url))}`
 * Payload: { email, role: 'admin', exp: unix-seconds }
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { envValue } from '@/lib/env-value';

export const ADMIN_COOKIE_NAME = 'iq_admin_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function getSecret(): string {
  const explicit = envValue('ADMIN_SESSION_SECRET');
  if (explicit && explicit.length >= 24) return explicit;
  // Fallback: derive a deterministic secret from another always-set server secret
  // so single-admin self-hosters don't have to remember an extra env var.
  // Still warns when neither is set — required in production.
  const supa = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (supa && supa.length >= 24) {
    return createHash('sha256').update(`iq-admin-session::${supa}`).digest('hex');
  }
  throw new Error('ADMIN_SESSION_SECRET is not configured (set it or SUPABASE_SERVICE_ROLE_KEY).');
}

function getAdminEmail(): string | null {
  return envValue('ADMIN_EMAIL')?.toLowerCase() ?? null;
}

function getAdminPassword(): string | null {
  return envValue('ADMIN_PASSWORD');
}

/** Constant-time compare of two utf8 strings via SHA-256 digests. */
function safeStringEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function isAdminAuthConfigured(): boolean {
  return Boolean(getAdminEmail() && getAdminPassword());
}

export function verifyAdminCredentials(email: string, password: string): boolean {
  const a = getAdminEmail();
  const p = getAdminPassword();
  if (!a || !p) return false;
  // Compare email case-insensitively but constant-time on the SHA digest.
  const emailOk = safeStringEqual(email.trim().toLowerCase(), a);
  const passOk = safeStringEqual(password, p);
  return emailOk && passOk;
}

export type AdminSessionPayload = { email: string; role: 'admin'; exp: number };

export function signAdminSession(email: string, ttlSeconds = SESSION_TTL_SECONDS): string {
  const secret = getSecret();
  const payload: AdminSessionPayload = {
    email: email.trim().toLowerCase(),
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${sig}`;
}

export function verifyAdminSession(token: string | null | undefined): AdminSessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expectedSig: string;
  try {
    expectedSig = createHmac('sha256', getSecret()).update(body).digest('hex');
  } catch {
    return null;
  }
  // Length check first (timingSafeEqual throws on mismatch).
  if (expectedSig.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(sig, 'hex'))) return null;
  } catch {
    return null;
  }
  let parsed: AdminSessionPayload;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString('utf8')) as AdminSessionPayload;
  } catch {
    return null;
  }
  if (parsed.role !== 'admin') return null;
  if (!parsed.exp || parsed.exp * 1000 < Date.now()) return null;
  if (!parsed.email) return null;
  // Sanity: make sure session email still matches current env admin
  // (so rotating ADMIN_EMAIL revokes all outstanding sessions).
  const current = getAdminEmail();
  if (current && parsed.email !== current) return null;
  return parsed;
}

/** Returns a Set-Cookie-friendly value (without the name=, just the value + attrs). */
export function buildAdminSessionCookieAttrs(secure: boolean): string {
  const parts = [
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Random session id reserved for future revocation (not yet persisted). */
export function newSessionRef(): string {
  return randomBytes(12).toString('hex');
}
