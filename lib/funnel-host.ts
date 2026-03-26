import { getRequestHost } from '@/lib/agent-studio-host';

/**
 * When the deployment is served at this host (e.g. app.restaurantiq.ai), `/` redirects to `/iq`.
 * Set in Vercel: NEXT_PUBLIC_FUNNEL_HOST=app.restaurantiq.ai
 */
export function getFunnelHost(): string | null {
  const h = process.env.NEXT_PUBLIC_FUNNEL_HOST?.trim().toLowerCase();
  return h || null;
}

export function isFunnelDeploymentHost(hostHeader: string | null | undefined): boolean {
  const expected = getFunnelHost();
  if (!expected) return false;
  return getRequestHost(hostHeader) === expected;
}
