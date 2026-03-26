import { NextResponse } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { getAgentStudioHost, getRequestHost, isAgentStudioHost } from '@/lib/agent-studio-host';
import { isFunnelDeploymentHost } from '@/lib/funnel-host';
import { DEMO_COOKIE_NAME } from '@/lib/server/demo-session';

const isProtectedRoute = createRouteMatcher([
  '/analysis(.*)',
  '/ops-copilot(.*)',
  '/agent-management(.*)',
  '/settings(.*)',
  '/account(.*)',
  '/social-radar(.*)',
  '/delivery(.*)',
  '/menu-management(.*)',
  '/billing-access(.*)',
  '/bo(.*)',
  '/api/bo(.*)',
]);

const isBoHostPath = (pathname: string) => pathname.startsWith('/bo') || pathname.startsWith('/api/bo');

const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const primaryAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://restaurantiq.ai';

function buildPrimarySignInUrl(targetUrl: string) {
  const signInUrl = new URL('/sign-in', primaryAppUrl);
  signInUrl.searchParams.set('redirect_url', targetUrl);
  return signInUrl;
}

function hasDemoCookie(cookieHeader: string | null) {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => part.trim().startsWith(`${DEMO_COOKIE_NAME}=`));
}

const demoModeEnabled = process.env.DEMO_MODE_ENABLED === 'true';

const clerkHandler = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    // 仅当 DEMO_MODE_ENABLED=true 时允许 demo cookie 免登录；否则一律要求 Clerk 登录（production 模式）
    if (demoModeEnabled && !isBoHostPath(new URL(req.url).pathname) && hasDemoCookie(req.headers.get('cookie'))) return;

    const session = await auth();
    if (!session.userId) {
      if (isAgentStudioHost(getRequestHost(req.headers.get('host')))) {
        return NextResponse.redirect(buildPrimarySignInUrl(req.url));
      }
      return NextResponse.redirect(new URL('/sign-in', req.url));
    }
  }
});

export default function middleware(req: Request, event: Event) {
  const url = new URL(req.url);
  const host = getRequestHost(req.headers.get('host'));
  const isDevLike = process.env.NODE_ENV !== 'production';

  // app.restaurantiq.ai (or NEXT_PUBLIC_FUNNEL_HOST): marketing home → IQ funnel landing
  // Dev parity: in non-production (localhost), also redirect / -> /iq so the funnel page is the default landing.
  if ((isFunnelDeploymentHost(req.headers.get('host')) || isDevLike) && url.pathname === '/') {
    return NextResponse.redirect(new URL('/iq', req.url));
  }

  const agentStudioHost = getAgentStudioHost();
  const onAgentStudioHost = isAgentStudioHost(host);
  const isAgentStudioPath = url.pathname.startsWith('/agent-management');
  const isAgentStudioApi = url.pathname.startsWith('/api/agent-management');

  const onBoHost = host.startsWith('bo.');
  if (onBoHost) {
    // Route bo.restaurantiq.ai/* to /bo/* (excluding API/static).
    if (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/_next') && !url.pathname.includes('.')) {
      const nextUrl = new URL(req.url);
      nextUrl.pathname = url.pathname === '/' ? '/bo' : `/bo${url.pathname}`;
      return NextResponse.rewrite(nextUrl);
    }
  }

  if (onAgentStudioHost && (url.pathname === '/' || url.pathname === '/dashboard')) {
    return NextResponse.redirect(new URL('/agent-management', req.url));
  }

  if (!onAgentStudioHost && (isAgentStudioPath || isAgentStudioApi)) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  if (onAgentStudioHost && !isAgentStudioPath && !isAgentStudioApi && !url.pathname.startsWith('/sign-')) {
    return NextResponse.redirect(new URL('/agent-management', `https://${agentStudioHost}`));
  }

  if (onAgentStudioHost && url.pathname.startsWith('/sign-')) {
    return NextResponse.redirect(buildPrimarySignInUrl(`https://${agentStudioHost}/agent-management`));
  }

  if (isMockMode || !isClerkConfigured) {
    return NextResponse.next();
  }

  return clerkHandler(req as never, event as never);
}

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};