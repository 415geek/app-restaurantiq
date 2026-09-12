/**
 * Run the Phase 6 model-level QA gates on a report_model.json.
 *
 *   npm run qa:gates                                   # qa/fixtures/report_model_millbrae.json (+ template narratives)
 *   npm run qa:gates -- qa/out/millbrae_1711.v360.json # any model dump
 *
 * Exit 0 when the model may ship as a paid report, 1 when it must be a
 * pre-check. Visual regression (browser) is `npx tsx scripts/visual-regression.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runQaGates } from '@/lib/iq/qa/gates';
import { PAGES, templateNarrative } from '@/lib/iq/narrative/templates';
import type { ReportModel } from '@/lib/iq/model/schema';

const file = process.argv[2] ?? 'qa/fixtures/report_model_millbrae.json';
const model = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as ReportModel;
if (!model.narrative || Object.keys(model.narrative).length === 0) {
  model.narrative = {};
  for (const p of PAGES) model.narrative[p.id] = templateNarrative(model, p.id);
  console.log('[qa-gates] model had no narrative — using template narratives');
}
const r = runQaGates(model);
console.table(r.gates.map((g) => ({ gate: g.id, passed: g.passed ? 'PASS' : 'FAIL', details: g.details.slice(0, 3).join(' | ').slice(0, 120) })));
console.log(`[qa-gates] tier=${r.tier} failures=${r.failures.length}`);
for (const f of r.failures) console.log('  -', f);
process.exit(r.passed ? 0 : 1);
