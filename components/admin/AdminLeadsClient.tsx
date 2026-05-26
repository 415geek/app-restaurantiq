'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IqLeadRow } from '@/lib/funnel/iq-repository';

type Props = {
  rows: IqLeadRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  initialQuery: string;
  loadError: string | null;
};

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function csvEscape(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: IqLeadRow[]): string {
  const headers = [
    'created_at',
    'email',
    'name',
    'phone',
    'cuisine',
    'location',
    'language',
    'report_id',
    'utm_source',
    'utm_medium',
    'utm_campaign',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.created_at,
        r.email,
        r.name,
        r.phone,
        r.cuisine,
        r.location,
        r.language,
        r.report_id,
        r.utm_source,
        r.utm_medium,
        r.utm_campaign,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

export function AdminLeadsClient({ rows, total, page, limit, totalPages, initialQuery, loadError }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);

  const startIndex = useMemo(() => (page - 1) * limit + 1, [page, limit]);
  const endIndex = useMemo(() => Math.min(page * limit, total), [page, limit, total]);

  function applySearch(nextQ: string, nextPage: number) {
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set('q', nextQ.trim());
    if (nextPage > 1) params.set('page', String(nextPage));
    if (limit !== 50) params.set('limit', String(limit));
    const qs = params.toString();
    router.push(`/admin/leads${qs ? `?${qs}` : ''}`);
  }

  function exportCsv() {
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iq-leads-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm text-zinc-400">
            {total > 0 ? (
              <>
                Showing <span className="text-zinc-100">{startIndex}-{endIndex}</span> of{' '}
                <span className="text-zinc-100">{total.toLocaleString()}</span> leads
              </>
            ) : (
              'No leads yet.'
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applySearch(q, 1);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search email / name / cuisine / location"
              className="w-72 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-orange-500"
            />
            <button
              type="submit"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
            >
              Search
            </button>
            {initialQuery ? (
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  applySearch('', 1);
                }}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Clear
              </button>
            ) : null}
          </form>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV (this page)
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          Failed to load leads: {loadError}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-900/95 text-xs uppercase tracking-wide text-zinc-400 backdrop-blur">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Time</th>
                <th className="px-4 py-2.5 text-left font-medium">Email</th>
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Phone</th>
                <th className="px-4 py-2.5 text-left font-medium">Cuisine</th>
                <th className="px-4 py-2.5 text-left font-medium">Location</th>
                <th className="px-4 py-2.5 text-left font-medium">Lang</th>
                <th className="px-4 py-2.5 text-left font-medium">Report</th>
                <th className="px-4 py-2.5 text-left font-medium">UTM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-zinc-500">
                    {initialQuery ? 'No matching leads.' : 'No leads have been captured yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-900/60">
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-300">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <a href={`mailto:${r.email}`} className="text-orange-300 hover:underline">
                        {r.email}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-200">{r.name || <span className="text-zinc-600">—</span>}</td>
                    <td className="px-4 py-2.5 text-zinc-300">
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="hover:underline">
                          {r.phone}
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-200">{r.cuisine || <span className="text-zinc-600">—</span>}</td>
                    <td className="px-4 py-2.5 text-zinc-300">
                      {r.location ? (
                        <span title={r.location}>{r.location.length > 40 ? `${r.location.slice(0, 40)}…` : r.location}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{r.language || 'en'}</td>
                    <td className="px-4 py-2.5">
                      {r.report_id ? (
                        <a
                          href={`/iq/report/${r.report_id}`}
                          target="_blank"
                          rel="noopener"
                          className="font-mono text-xs text-zinc-300 hover:text-orange-300 hover:underline"
                        >
                          {r.report_id.slice(0, 8)}…
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">
                      {[r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(' / ') || <span className="text-zinc-600">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <div>
            Page <span className="text-zinc-100">{page}</span> of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => applySearch(initialQuery, page - 1)}
              className="rounded-md border border-zinc-800 px-3 py-1 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => applySearch(initialQuery, page + 1)}
              className="rounded-md border border-zinc-800 px-3 py-1 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
