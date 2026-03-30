import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { resolveClerkRedirectTarget } from '@/lib/clerk-redirect-url';

const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeRedirectUrl(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function Page({ searchParams }: SignInPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const redirectUrl = resolveClerkRedirectTarget(
    normalizeRedirectUrl(resolvedSearchParams.redirect_url) || '/dashboard',
  );

  if (isMockMode || !isClerkConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">{isClerkConfigured ? 'Mock Mode' : 'Auth Not Configured'}</h1>
          <p className="text-sm text-zinc-300">
            {isClerkConfigured
              ? 'Auth is temporarily disabled while Clerk production keys are being updated.'
              : 'Clerk publishable key is missing. Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in .env.local to enable authentication.'}
          </p>
          <Link href="/dashboard" className="inline-flex rounded bg-orange-500 px-4 py-2 font-medium text-black hover:bg-orange-400">
            Continue to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-black">
      <SignIn forceRedirectUrl={redirectUrl} fallbackRedirectUrl={redirectUrl} />
    </div>
  );
}
