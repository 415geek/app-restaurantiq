/**
 * /print/[reportId] — server-rendered 14-page report (Phase 5.3).
 *
 * Reads `iqGetReport(reportId).report_model_json` (+ `narrative_json` merged
 * into model.narrative). In non-production, `?fixture=millbrae` renders
 * qa/fixtures/report_model_millbrae.json so the page works without a DB.
 * 404 when no model exists.
 *
 * Access: the PDF route gates on `paid`; this page mirrors that in production
 * unless the request carries the internal render token
 * (`IQ_PRINT_TOKEN`, sent by lib/iq/render/pdf.ts as `x-iq-print-token`).
 */
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ReportDocument } from '@/lib/iq/render/pages';
import { fixtureAllowed, loadPrintModel } from '@/lib/iq/render/load';
import { resolveStaticMaps } from '@/lib/iq/render/static-map';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = Promise<{ reportId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PrintReportPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  await ensureRuntimeConfig();
  const { reportId } = await params;
  const sp = await searchParams;
  const fixture = fixtureAllowed() ? first(sp.fixture)?.trim() || null : null;

  let loaded: Awaited<ReturnType<typeof loadPrintModel>> = null;
  try {
    loaded = await loadPrintModel({ reportId, fixture });
  } catch (err) {
    console.error('[print] loadPrintModel failed:', err instanceof Error ? err.message : err);
    notFound();
  }
  if (!loaded) notFound();

  if (process.env.NODE_ENV === 'production' && !loaded.fromFixture && !loaded.paid) {
    const expected = process.env.IQ_PRINT_TOKEN?.trim();
    const h = await headers();
    const provided = h.get('x-iq-print-token') ?? first(sp.token) ?? '';
    if (!expected || provided !== expected) notFound();
  }

  // Google Static Maps basemaps (page-3 hero + cover thumbnail), fetched here
  // with the server-side key (populated by ensureRuntimeConfig above) and
  // inlined as data URLs. Either may be null → MapFigure shows the SVG fallback.
  const staticMaps = await resolveStaticMaps(loaded.model);

  return <ReportDocument model={loaded.model} staticMaps={staticMaps} />;
}
