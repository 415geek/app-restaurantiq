import { supabaseAdmin } from '@/lib/server/supabase-admin';

const TABLE = 'iq_location_reports';
const LEADS_TABLE = 'iq_leads';

export type IqLeadInput = {
  email: string;
  name?: string | null;
  phone?: string | null;
  cuisine?: string | null;
  location?: string | null;
  language?: string | null;
  reportId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  userAgent?: string | null;
  ipHash?: string | null;
};

/**
 * Persist a free-tier lead capture (email-gated unlock).
 * Returns the lead id. Caller should attach this to the report flow.
 */
export async function iqInsertLead(input: IqLeadInput): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from(LEADS_TABLE)
    .insert({
      email: input.email.trim().toLowerCase(),
      name: input.name?.trim() || null,
      phone: input.phone?.trim() || null,
      cuisine: input.cuisine?.trim() || null,
      location: input.location?.trim() || null,
      language: input.language?.trim() || 'en',
      report_id: input.reportId || null,
      utm_source: input.utmSource || null,
      utm_medium: input.utmMedium || null,
      utm_campaign: input.utmCampaign || null,
      user_agent: input.userAgent || null,
      ip_hash: input.ipHash || null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
  return data.id as string;
}

export type IqLeadRow = {
  id: string;
  created_at: string;
  email: string;
  name: string | null;
  phone: string | null;
  cuisine: string | null;
  location: string | null;
  language: string;
  report_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

export type IqLeadListResult = {
  rows: IqLeadRow[];
  total: number;
};

const LEAD_COLUMNS =
  'id, created_at, email, name, phone, cuisine, location, language, report_id, utm_source, utm_medium, utm_campaign';

/**
 * Admin-only: list leads with simple pagination + optional search by email/name/cuisine.
 * Uses service-role client; callers MUST verify admin session before invoking.
 */
export async function iqListLeads(opts: {
  limit?: number;
  offset?: number;
  search?: string | null;
} = {}): Promise<IqLeadListResult> {
  const sb = supabaseAdmin();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  let query = sb
    .from(LEADS_TABLE)
    .select(LEAD_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const search = opts.search?.trim();
  if (search) {
    // Escape PostgREST `or` filter separators.
    const safe = search.replace(/[,()]/g, ' ').trim();
    if (safe) {
      const pattern = `%${safe}%`;
      query = query.or(
        `email.ilike.${pattern},name.ilike.${pattern},cuisine.ilike.${pattern},location.ilike.${pattern}`,
      );
    }
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
  return {
    rows: (data ?? []) as IqLeadRow[],
    total: count ?? (data?.length ?? 0),
  };
}

export type IqReportRow = {
  id: string;
  location: string;
  business_type: string | null;
  verdict: string;
  headline: string;
  reason: string;
  full_report_json: Record<string, unknown> | null;
  market_data_json: Record<string, unknown> | null;
  paid: boolean;
  stripe_session_id: string | null;
  customer_email: string | null;
  share_count: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  user_id: string | null;
  language: string;
  created_at?: string;
  // Background generation (migration 0008). Absent until the migration runs.
  generation_status?: string | null;
  generation_stage?: string | null;
  generation_state_json?: Record<string, unknown> | null;
  generation_error?: string | null;
  generation_started_at?: string | null;
  generation_updated_at?: string | null;
  notify_email?: string | null;
  notified_at?: string | null;
  // 360° report (migration 0009). Absent until the migration runs.
  report_model_json?: Record<string, unknown> | null;
  narrative_json?: Record<string, unknown> | null;
  report_tier?: string | null;
  report_cost_usd?: number | null;
  pdf_storage_path?: string | null;
};

/**
 * True when a Supabase/PostgREST error means migration 0008 has not been
 * applied yet — callers fall back to the legacy synchronous path.
 */
export function isMissingColumnError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e ?? '')) ?? '';
  const code = (e as { code?: string } | null)?.code ?? '';
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /column .* does not exist|could not find the .* column|schema cache/i.test(msg)
  );
}

export async function iqInsertReport(input: {
  location: string;
  businessType: string | null;
  verdict: string;
  headline: string;
  reason: string;
  marketDataJson?: Record<string, unknown> | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  language?: string;
}): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from(TABLE)
    .insert({
      location: input.location,
      business_type: input.businessType,
      verdict: input.verdict,
      headline: input.headline,
      reason: input.reason,
      market_data_json: input.marketDataJson ?? null,
      utm_source: input.utmSource ?? null,
      utm_medium: input.utmMedium ?? null,
      utm_campaign: input.utmCampaign ?? null,
      language: input.language ?? 'en',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
  return data.id as string;
}

export async function iqIncrementShareCount(reportId: string): Promise<void> {
  const sb = supabaseAdmin();
  
  const { data: current } = await sb
    .from(TABLE)
    .select('share_count')
    .eq('id', reportId)
    .single();
  
  const newCount = (current?.share_count ?? 0) + 1;
  
  const { error } = await sb
    .from(TABLE)
    .update({ share_count: newCount })
    .eq('id', reportId);
  
  if (error) throw error;
}

export async function iqGetReport(id: string): Promise<IqReportRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message || JSON.stringify(error));
  return data as IqReportRow | null;
}

export async function iqUpdateStripeSession(reportId: string, stripeSessionId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from(TABLE).update({ stripe_session_id: stripeSessionId }).eq('id', reportId);
  if (error) throw error;
}

export async function iqMarkPaidAndReport(input: {
  reportId: string;
  stripeSessionId: string;
  customerEmail: string | null;
  fullReportJson: Record<string, unknown> | null;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from(TABLE)
    .update({
      paid: true,
      stripe_session_id: input.stripeSessionId,
      customer_email: input.customerEmail,
      full_report_json: input.fullReportJson,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.reportId);
  if (error) throw error;
}

export async function iqSetFullReport(reportId: string, fullReportJson: Record<string, unknown>): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from(TABLE)
    .update({ full_report_json: fullReportJson, updated_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw error;
}

/** Persist the 360° report model + page narratives (migration 0009 columns). */
export async function iqSetReportModel(input: {
  reportId: string;
  reportModelJson: Record<string, unknown>;
  narrativeJson: Record<string, unknown>;
  tier: 'paid' | 'precheck';
  costUsd: number;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from(TABLE)
    .update({
      report_model_json: input.reportModelJson,
      narrative_json: input.narrativeJson,
      report_tier: input.tier,
      report_cost_usd: input.costUsd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.reportId);
  if (error) throw error;
}

export async function iqUpdateMarketDataJson(
  reportId: string,
  marketDataJson: Record<string, unknown>,
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from(TABLE)
    .update({ market_data_json: marketDataJson, updated_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw error;
}

export async function iqLinkReportToUser(reportId: string, userId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from(TABLE)
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw error;
}

export async function iqGetUserReports(userId: string): Promise<IqReportRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as IqReportRow[];
}

export async function iqGetUserPaidReports(userId: string): Promise<IqReportRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('paid', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as IqReportRow[];
}

// ---------------------------------------------------------------------------
// Background generation state (migration 0008)
// ---------------------------------------------------------------------------

export type IqGenerationClaim = {
  reportId: string;
  stage: string;
  stateJson: Record<string, unknown>;
  /** A 'running' row untouched since before this instant is considered dead and reclaimable. */
  staleBeforeIso: string;
};

/**
 * Atomically mark a report as generating. Returns false when another worker
 * holds a fresh claim. Throws the raw error when the columns are missing so
 * the caller can detect the un-migrated database.
 */
export async function iqClaimReportGeneration(input: IqGenerationClaim): Promise<boolean> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from(TABLE)
    .update({
      generation_status: 'running',
      generation_stage: input.stage,
      generation_state_json: input.stateJson,
      generation_error: null,
      generation_started_at: now,
      generation_updated_at: now,
    })
    .eq('id', input.reportId)
    .or(
      `generation_status.neq.running,generation_updated_at.is.null,generation_updated_at.lt.${input.staleBeforeIso}`,
    )
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export async function iqUpdateReportGeneration(
  reportId: string,
  patch: {
    status?: 'running' | 'done' | 'failed' | 'idle';
    stage?: string | null;
    stateJson?: Record<string, unknown> | null;
    error?: string | null;
  },
): Promise<void> {
  const sb = supabaseAdmin();
  const row: Record<string, unknown> = { generation_updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.generation_status = patch.status;
  if (patch.stage !== undefined) row.generation_stage = patch.stage;
  if (patch.stateJson !== undefined) row.generation_state_json = patch.stateJson;
  if (patch.error !== undefined) row.generation_error = patch.error;
  const { error } = await sb.from(TABLE).update(row).eq('id', reportId);
  if (error) throw error;
}

export async function iqSetReportNotifyEmail(reportId: string, email: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from(TABLE)
    .update({ notify_email: email, notified_at: null })
    .eq('id', reportId);
  if (error) throw error;
}

export async function iqMarkReportNotified(reportId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from(TABLE)
    .update({ notified_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw error;
}
