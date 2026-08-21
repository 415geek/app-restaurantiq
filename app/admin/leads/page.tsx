import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ADMIN_COOKIE_NAME, verifyAdminSession } from '@/lib/server/admin-session';
import { iqListLeads } from '@/lib/funnel/iq-repository';
import { AdminLeadsClient } from '@/components/admin/AdminLeadsClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'Leads · Admin', robots: { index: false, follow: false } };

type SP = { q?: string; page?: string; limit?: string };

export default async function AdminLeadsPage(props: { searchParams?: Promise<SP> }) {
  const jar = await cookies();
  const session = verifyAdminSession(jar.get(ADMIN_COOKIE_NAME)?.value);
  if (!session) redirect('/admin/login');

  const sp = (await props.searchParams) ?? {};
  const search = (sp.q || '').trim() || null;
  const limit = Math.min(Math.max(Number.parseInt(sp.limit || '50', 10) || 50, 1), 200);
  const page = Math.max(Number.parseInt(sp.page || '1', 10) || 1, 1);
  const offset = (page - 1) * limit;

  let rows: Awaited<ReturnType<typeof iqListLeads>>['rows'] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await iqListLeads({ limit, offset, search });
    rows = result.rows;
    total = result.total;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-orange-500/15 text-orange-300">
              <span className="text-xs font-bold">A</span>
            </div>
            <div>
              <div className="text-sm font-semibold">Admin · Leads</div>
              <div className="text-xs text-zinc-500">{session.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/iq" className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700">
              View funnel
            </Link>
            <AdminSignOutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-8">
        <AdminLeadsClient
          rows={rows}
          total={total}
          page={page}
          limit={limit}
          totalPages={totalPages}
          initialQuery={search ?? ''}
          loadError={loadError}
        />
      </section>
    </main>
  );
}

function AdminSignOutButton() {
  return (
    <form action="/api/admin/logout" method="post" className="contents">
      <button
        type="submit"
        className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20"
      >
        Sign out
      </button>
    </form>
  );
}
