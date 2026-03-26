import { getRequestHost } from '@/lib/agent-studio-host';

/**
 * When the deployment is served at this host (e.g. app.restaurantiq.ai), `/` redirects to `/iq`.
 * Set in Vercel: NEXT_PUBLIC_FUNNEL_HOST=app.restaurantiq.ai
 */
const DEFAULT_FUNNEL_HOST = 'app.restaurantiq.ai';

export function getFunnelHost(): string | null {
  const h = process.env.NEXT_PUBLIC_FUNNEL_HOST?.trim().toLowerCase();
  return h || DEFAULT_FUNNEL_HOST;
}

export function isFunnelDeploymentHost(hostHeader: string | null | undefined): boolean {
  const expected = getFunnelHost();
  return getRequestHost(hostHeader) === expected;
}
