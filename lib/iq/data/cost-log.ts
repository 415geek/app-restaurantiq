/**
 * Per-report itemized cost → iq_cost_log (研发提示词 §1.4 第 1 条, Phase 7).
 * Best-effort: never throws, never blocks report delivery.
 */
import { supabaseAdmin } from '@/lib/server/supabase-admin';
import { envValue } from '@/lib/env-value';
import type { CostLedger } from './types';

export const REPORT_COST_CAP_USD = 0.5;

export async function persistCostLog(reportId: string, ledger: CostLedger): Promise<{ written: number; total: number; over_cap: boolean }> {
  const entries = ledger.entries();
  const total = ledger.total();
  const over_cap = total > REPORT_COST_CAP_USD;
  if (over_cap) {
    console.warn(`[iq360/cost] report ${reportId} cost $${total.toFixed(3)} exceeds cap $${REPORT_COST_CAP_USD}`, ledger.bySource());
  }
  if (!envValue('SUPABASE_URL') || !envValue('SUPABASE_SERVICE_ROLE_KEY') || entries.length === 0) {
    return { written: 0, total, over_cap };
  }
  try {
    const sb = supabaseAdmin();
    const rows = entries.map((e) => ({ report_id: reportId, source: e.source, usd: e.usd, note: e.note.slice(0, 500), created_at: e.at }));
    const { error } = await sb.from('iq_cost_log').insert(rows);
    if (error) {
      console.warn('[iq360/cost] insert failed', error.message);
      return { written: 0, total, over_cap };
    }
    return { written: rows.length, total, over_cap };
  } catch (e) {
    console.warn('[iq360/cost] persist threw', e);
    return { written: 0, total, over_cap };
  }
}
