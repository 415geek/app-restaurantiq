import { NextResponse } from 'next/server';
import { iqGetReport, iqUpdateMarketDataJson } from '@/lib/funnel/iq-repository';
import { mergeMarketDataUserInputs, reportInputsBodySchema, REPORT_INPUTS_MAX_BODY_BYTES } from '@/lib/funnel/iq-report-inputs';
import { ensureRuntimeConfig } from '@/lib/server/runtime-config';

export const runtime = 'nodejs';

/**
 * POST /api/funnel/report-inputs  { reportId, inputs }
 *
 * Saves the optional PaidIntakeForm fields into
 * `iq_location_reports.market_data_json.user_inputs` (merge, never drops keys).
 * The report only has to exist — the form runs before checkout, so `paid` is
 * not required. Returns `{ ok: true, inputs }` with the merged object.
 */
export async function POST(req: Request) {
  await ensureRuntimeConfig();
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > REPORT_INPUTS_MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (raw.length > REPORT_INPUTS_MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = reportInputsBodySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? issue.path.join('.') : 'body';
    return NextResponse.json({ error: 'Invalid inputs', detail: `${path}: ${issue?.message ?? 'invalid'}` }, { status: 400 });
  }
  const { reportId, inputs } = parsed.data;

  try {
    const report = await iqGetReport(reportId);
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    const { market, inputs: merged } = mergeMarketDataUserInputs(report.market_data_json, inputs);
    await iqUpdateMarketDataJson(reportId, market);
    return NextResponse.json({ ok: true, inputs: merged });
  } catch (e) {
    console.error('[funnel/report-inputs]', e);
    return NextResponse.json({ error: 'Failed to save inputs' }, { status: 500 });
  }
}
