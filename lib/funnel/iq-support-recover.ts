/**
 * Support bubble · report recovery.
 *
 * A paying customer who refreshed or went back mid-generation can ask the
 * in-page support chat for a way back. Given the report id (remembered by the
 * browser) or the checkout email, this returns links to the paid report pages —
 * the same `/iq/report/<id>` page that shows the generation progress and, once
 * ready, the report itself. Unpaid reports are never returned.
 */
import { supabaseAdmin } from '@/lib/server/supabase-admin';

export type RecoveredReport = {
  id: string;
  location: string;
  business_type: string | null;
  created_at: string | null;
  /** 'ready' once the full report exists, otherwise 'generating'. */
  status: 'ready' | 'generating';
  url: string;
};

const TABLE = 'iq_location_reports';
const MAX_RESULTS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string;
  location: string;
  business_type: string | null;
  created_at: string | null;
  paid: boolean;
  full_report_json: Record<string, unknown> | null;
};

const SELECT = 'id, location, business_type, created_at, paid, full_report_json';

function toRecovered(r: Row): RecoveredReport {
  const ready = Boolean(r.full_report_json && Object.keys(r.full_report_json).length > 0);
  return {
    id: r.id,
    location: r.location,
    business_type: r.business_type,
    created_at: r.created_at,
    status: ready ? 'ready' : 'generating',
    url: `/iq/report/${encodeURIComponent(r.id)}`,
  };
}

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s.length < 6 || s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

export function normalizeReportId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return UUID_RE.test(s) ? s : null;
}

/** Paid report by id (null when unknown or unpaid). */
export async function recoverByReportId(id: string): Promise<RecoveredReport | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message || JSON.stringify(error));
  const row = data as Row | null;
  if (!row || !row.paid) return null;
  return toRecovered(row);
}

/** Paid reports whose Stripe customer email or notify email matches (newest first, ≤ 5). */
export async function recoverByEmail(email: string): Promise<RecoveredReport[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from(TABLE)
    .select(SELECT)
    .eq('paid', true)
    .or(`customer_email.ilike.${email},notify_email.ilike.${email}`)
    .order('created_at', { ascending: false })
    .limit(MAX_RESULTS);
  if (error) throw new Error(error.message || JSON.stringify(error));
  return ((data ?? []) as Row[]).map(toRecovered);
}
