import { supabaseAdmin } from '@/lib/server/supabase-admin';

const TABLE = 'iq_location_reports';

export type IqReportRow = {
  id: string;
  location: string;
  business_type: string | null;
  verdict: string;
  headline: string;
  reason: string;
  full_report_json: Record<string, unknown> | null;
  paid: boolean;
  stripe_session_id: string | null;
  customer_email: string | null;
};

export async function iqInsertReport(input: {
  location: string;
  businessType: string | null;
  verdict: string;
  headline: string;
  reason: string;
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
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function iqGetReport(id: string): Promise<IqReportRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
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
