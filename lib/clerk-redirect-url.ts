/**
 * Clerk validates redirect targets against the Dashboard allow-list.
 * Using an absolute URL (when NEXT_PUBLIC_APP_URL is set) avoids OAuth
 * falling back to the wrong route in production.
 */
export function resolveClerkRedirectTarget(pathOrUrl: string | undefined): string {
  const raw = (pathOrUrl ?? '').trim();
  const fallback = '/dashboard';
  const target = raw || fallback;
  if (/^https?:\/\//i.test(target)) {
    return target;
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const path = target.startsWith('/') ? target : `/${target}`;
  if (!base) {
    return path;
  }
  return `${base}${path}`;
}
