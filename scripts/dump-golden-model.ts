/**
 * Dump the offline Millbrae report_model.json fixture used by the renderers
 * and QA gates: `npx tsx scripts/dump-golden-model.ts`
 */
import { writeFileSync } from 'node:fs';
import { runMillbrae } from '@/qa/e2e-report.test';

async function main() {
  const { model } = await runMillbrae();
  writeFileSync('qa/fixtures/report_model_millbrae.json', JSON.stringify(model, null, 2));
  console.log('tier', model.meta.tier, 'total', model.score.total, model.score.verdict, 'conf', model.confidence.total, 'cost', model.meta.cost_usd, 'precheck', model.meta.precheck_reasons);
  console.log('rings', model.trade_area.rings.map((r) => [r.id, r.pop, r.chinese_hh_share, r.jobs]));
  console.log('l1', model.competitors.l1.length, 'l2', model.competitors.l2_count, 'l4', model.competitors.l4.length, 'captured', model.demand.captured_monthly_usd, 'be', model.finance.breakeven_monthly, 'cov', model.demand.coverage_ratio);
}
main().catch((e) => { console.error(e); process.exit(1); });
