import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE_NAME, verifyAdminSession } from '@/lib/server/admin-session';
import { AdminLoginForm } from '@/components/admin/AdminLoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · Restaurant IQ', robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  const jar = await cookies();
  const session = verifyAdminSession(jar.get(ADMIN_COOKIE_NAME)?.value);
  if (session) {
    redirect('/admin/leads');
  }
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
        <div className="mb-6 flex items-center gap-2 text-zinc-400">
          <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
          <span className="text-xs uppercase tracking-[0.2em]">Restricted Console</span>
        </div>
        <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur">
          <h1 className="text-xl font-semibold">Admin sign-in</h1>
          <p className="mt-1 text-sm text-zinc-400">
            This area is for the workspace administrator only. Customer accounts use the regular sign-in page.
          </p>
          <div className="mt-6">
            <AdminLoginForm />
          </div>
        </div>
        <div className="mt-6 text-xs text-zinc-500">
          Looking for the customer sign-in?{' '}
          <Link href="/iq/login" className="text-zinc-300 underline-offset-2 hover:text-orange-300 hover:underline">
            Go to user sign-in
          </Link>
        </div>
      </div>
    </main>
  );
}
