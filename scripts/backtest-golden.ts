/**
 * Phase 6 gate 8 — golden-set backtest. Scores every case in
 * qa/golden_set/backtest_bay_area.json with the 360° engine and reports the
 * AUC of score.total against the open/closed label. Must be ≥ 0.75 before a
 * parameter change ships (研发提示词 §Phase 6.8).
 *
 *   npx tsx scripts/backtest-golden.ts [--file qa/golden_set/backtest_bay_area.json] [--skip-verify]
 *
 * Requires the same env as production (network + Supabase). Each case costs
 * ≈ one report (data only, no narrative). Labels are re-verified against
 * Google business_status unless --skip-verify.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runReport360 } from '@/lib/iq/pipeline';

type Case = { id: string; label: 0 | 1; address: string; cuisine: string; seats?: number; note?: string };

export function auc(pairs: Array<{ score: number; label: 0 | 1 }>): number | null {
  const pos = pairs.filter((p) => p.label === 1).map((p) => p.score);
  const neg = pairs.filter((p) => p.label === 0).map((p) => p.score);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[args.indexOf('--file') + 1] || 'qa/golden_set/backtest_bay_area.json';
  const skipVerify = args.includes('--skip-verify');
  const { cases } = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as { cases: Case[] };
  const rows: Array<{ id: string; label: 0 | 1; score: number; verdict: string; confidence: number; tier: string; verified: boolean }> = [];
  mkdirSync('qa/out', { recursive: true });
  for (const c of cases) {
    try {
      const { model, bundle } = await runReport360({ report_id: `backtest-${c.id}`, address: c.address, cuisine: c.cuisine, seats: c.seats ?? null, language: 'zh' }, { skipAlternatives: true, llmClassify: null });
      let verified = skipVerify;
      if (!skipVerify) {
        // The venue itself should appear in D6 within ~60 m with the matching status.
        const self = (bundle.google?.data?.places ?? []).find((p) => p.distance_m <= 60);
        const status = self?.business_status ?? null;
        verified = c.label === 0 ? status === 'CLOSED_PERMANENTLY' : status === 'OPERATIONAL' && (self?.rating ?? 0) >= 4.2;
        if (!verified) console.warn(`[backtest] ${c.id}: label ${c.label} not confirmed (status=${status}, rating=${self?.rating ?? '—'}) — excluded`);
      }
      rows.push({ id: c.id, label: c.label, score: model.score.total, verdict: model.score.verdict, confidence: model.confidence.total, tier: model.meta.tier, verified });
      writeFileSync(`qa/out/backtest-${c.id}.json`, JSON.stringify(model, null, 2));
    } catch (e) {
      console.warn(`[backtest] ${c.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.table(rows);
  const used = rows.filter((r) => r.verified);
  const a = auc(used.map((r) => ({ score: r.score, label: r.label })));
  console.log(`[backtest] n=${used.length} AUC=${a == null ? 'n/a' : a.toFixed(3)} (threshold 0.75)`);
  writeFileSync('qa/out/backtest-summary.json', JSON.stringify({ at: new Date().toISOString(), auc: a, rows }, null, 2));
  if (a != null && a < 0.75) process.exit(1);
}

if (process.argv[1] && /backtest-golden/.test(process.argv[1])) {
  main().catch((e) => {
    console.error('[backtest] FAIL', e);
    process.exit(1);
  });
}
