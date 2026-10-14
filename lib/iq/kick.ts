/**
 * Fire-and-forget trigger for 360° generation, used once the legacy paid
 * report is stored (background job finalize + legacy sync path). Runs in its
 * own serverless invocation via POST /api/iq/report360/:id (202 + after()).
 */
import { getPublicBaseUrl } from '@/lib/funnel/base-url';

export async function kickReport360(reportId: string, opts: { pass?: 'pro' } = {}): Promise<void> {
  if ((process.env.IQ360_AUTO ?? '').trim().toLowerCase() === 'false') return;
  // v4 §1.5: `pass=pro` asks for the professional narrative pass (evidence-backed prose) on an existing model.
  const url = `${getPublicBaseUrl()}/api/iq/report360/${encodeURIComponent(reportId)}${opts.pass === 'pro' ? '?pass=pro' : ''}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  try {
    const res = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok && res.status !== 202) console.warn(`[iq360] kick ${reportId}: HTTP ${res.status}`);
  } catch (e) {
    console.warn('[iq360] kick threw:', e instanceof Error ? e.message : e);
  }
}
