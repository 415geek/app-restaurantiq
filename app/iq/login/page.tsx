import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { resolveClerkRedirectTarget } from '@/lib/clerk-redirect-url';

const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const metadata = {
  title: 'Sign in · Restaurant IQ',
  description: 'Sign in or create a free account to manage your purchased Restaurant IQ reports.',
};

export default async function IqLoginPage({ searchParams }: LoginPageProps) {
  const sp = (await (searchParams ?? Promise.resolve({}))) as Record<string, string | string[] | undefined>;
  const redirectUrl = resolveClerkRedirectTarget(normalizeParam(sp.redirect_url) || '/iq/dashboard');

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Soft branded backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(242,106,54,0.18),transparent_70%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link href="/iq" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-[#F26A36]/30 bg-[#F26A36]/15">
              <img src="/branding/logo-mark.png" alt="Restaurant IQ" className="h-6 w-6 object-contain" />
            </div>
            <span className="text-sm font-semibold tracking-wide text-zinc-200">Restaurant IQ</span>
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Sign in to manage your reports</h1>
          <p className="text-sm text-zinc-400">
            New here? Create a free account to save and revisit your purchased reports.
          </p>
        </div>

        {isMockMode || !isClerkConfigured ? (
          <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
            <h2 className="text-base font-semibold text-zinc-100">
              {isClerkConfigured ? 'Sign-in temporarily disabled' : 'Authentication not configured'}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              {isClerkConfigured
                ? 'Auth is temporarily disabled while Clerk keys are rotating.'
                : 'Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to enable sign-in.'}
            </p>
            <Link
              href="/iq"
              className="mt-4 inline-flex rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400"
            >
              Back to home
            </Link>
          </div>
        ) : (
          <div className="w-full">
            <SignIn
              signUpUrl={`/sign-up?redirect_url=${encodeURIComponent('/iq/dashboard')}`}
              forceRedirectUrl={redirectUrl}
              fallbackRedirectUrl={redirectUrl}
            />
          </div>
        )}

        {/* Inconspicuous admin trigger — small logo at bottom links to /admin/login */}
        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <Link
            href="/admin/login"
            aria-label="Workspace administrator console"
            title="Workspace administrator console"
            className="group inline-flex items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 p-1.5 opacity-30 transition hover:opacity-90 focus:opacity-90 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
          >
            <img
              src="/branding/logo-mark.png"
              alt=""
              aria-hidden="true"
              className="h-3.5 w-3.5 object-contain grayscale group-hover:grayscale-0"
            />
          </Link>
          <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-700">v2 · Restaurant IQ</span>
        </div>
      </div>
    </main>
  );
}
