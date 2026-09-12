/**
 * Replay a golden-set case through the paid-report pipeline and scan the
 * output for the regression-baseline defects (研发提示词 §1.5 R1–R8).
 *
 *   npm run replay:golden -- millbrae_1711            # current (legacy) engine
 *   npm run replay:golden -- millbrae_1711 --engine v360   # 360° engine (Phase 2+)
 *
 * Output: qa/out/<case>.<engine>.json + a defect table on stdout.
 * Exit code 0 = ran; 2 = missing env; 1 = crashed.
 *
 * Requires the same env the app uses (GOOGLE_MAPS_API_KEY + one LLM key;
 * SUPABASE_* optional — cache is skipped without it). Nothing is persisted
 * to iq_location_reports.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type GoldenCase = {
  case_id: string;
  input: {
    address: string;
    cuisine: string;
    business_type_raw?: string;
    language: 'en' | 'zh';
    rent_usd?: number | null;
    sqft?: number | null;
    seats?: number | null;
    capex_usd?: number | null;
    ticket_in?: number | null;
    ticket_delivery?: number | null;
    delivery_ratio?: number | null;
  };
};

type Defect = { id: string; hit: boolean; evidence: string };

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Defect scan for the legacy report JSON shape (lib/funnel/iq-full-report-schema.ts). */
export function scanLegacyDefects(full: Record<string, unknown>, input: GoldenCase['input']): Defect[] {
  const text = JSON.stringify(full);
  const competitors = Array.isArray(full.competitors) ? full.competitors : [];
  const zeroWording = /零竞争|空白|no direct competitors|white ?space/i.test(text);

  const dashboard = (full.dashboard ?? {}) as Record<string, unknown>;
  const audit = (full.risk_audit ?? {}) as Record<string, unknown>;
  const matrix = Array.isArray(full.decision_matrix) ? (full.decision_matrix as Record<string, unknown>[]) : [];
  const matrixTotal = matrix.reduce((s, r) => s + (num(r.weighted_score) ?? 0), 0);
  const matrixWeights = matrix.reduce((s, r) => s + (num(r.weight_pct) ?? 0), 0);
  const overall = num(dashboard.overall_score);
  const auditOverall = num(audit.overall_score);

  const scenarios = Array.isArray((full.revenue_model as Record<string, unknown> | undefined)?.scenarios)
    ? ((full.revenue_model as Record<string, unknown>).scenarios as Record<string, unknown>[])
    : [];
  const seats = input.seats ?? null;
  const scenarioIssues: string[] = [];
  for (const s of scenarios) {
    const blob = JSON.stringify(s);
    const orders = /(\d{2,4})\s*(单|orders|covers)/i.exec(blob);
    const turns = /(\d(?:\.\d)?)\s*(turns|翻台)/i.exec(blob);
    if (orders && turns && seats) {
      const implied = seats * Number(turns[1]);
      const stated = Number(orders[1]);
      if (Math.abs(implied - stated) / Math.max(implied, 1) > 0.15) {
        scenarioIssues.push(`${String(s.name)}: seats×turns=${implied.toFixed(0)} vs stated ${stated}`);
      }
    }
  }

  return [
    {
      id: 'R1',
      hit: competitors.length === 0 || zeroWording,
      evidence: `competitors=${competitors.length}; zero-competition wording=${zeroWording}`,
    },
    {
      id: 'R2',
      hit: /无法解析|数据抑制|not available|unavailable/i.test(String(full.demographic_profile ?? '')),
      evidence: `demographic_profile mentions unresolved data=${/无法解析|数据抑制/.test(String(full.demographic_profile ?? ''))}`,
    },
    { id: 'R3', hit: true, evidence: 'legacy PDF is browser-print of the dark web page (structural; see Phase 5)' },
    {
      id: 'R4',
      hit: scenarioIssues.length > 0,
      evidence: scenarioIssues.join(' | ') || 'no seats×turns contradiction detected in scenario text',
    },
    {
      id: 'R5',
      hit:
        (overall != null && auditOverall != null && overall !== auditOverall) ||
        (matrix.length > 0 && overall != null && Math.abs(matrixTotal - overall) > 1) ||
        (matrix.length > 0 && Math.abs(matrixWeights - 100) > 0.5),
      evidence: `dashboard.overall=${overall} risk_audit.overall=${auditOverall} matrixΣ=${matrixTotal.toFixed(1)} weightsΣ=${matrixWeights}`,
    },
    {
      id: 'R6',
      hit:
        (dashboard.payback_months != null && !input.capex_usd) ||
        dashboard.foot_traffic_index != null,
      evidence: `payback_months=${String(dashboard.payback_months)} (capex=${String(input.capex_usd)}); foot_traffic_index=${String(dashboard.foot_traffic_index)} (no traffic snapshot source)`,
    },
    { id: 'R7', hit: !text.includes('isochrone') && !text.includes('map_png'), evidence: 'no map artifact in report model' },
    {
      id: 'R8',
      hit: (text.match(/127%/g) ?? []).length > 1 || (text.match(/BART/g) ?? []).length > 3,
      evidence: `"127%" ×${(text.match(/127%/g) ?? []).length}; "BART" ×${(text.match(/BART/g) ?? []).length}`,
    },
  ];
}

async function main() {
  const caseId = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'millbrae_1711';
  const engine = arg('--engine', 'current');
  const casePath = resolve(process.cwd(), 'qa/golden_set', `${caseId}.json`);
  const golden = JSON.parse(readFileSync(casePath, 'utf8')) as GoldenCase;
  const input = golden.input;

  const hasLlm = Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.MIMO_API_KEY,
  );
  if (!process.env.GOOGLE_MAPS_API_KEY || !hasLlm) {
    console.error(
      '[replay-golden] missing env: need GOOGLE_MAPS_API_KEY and one of ANTHROPIC_API_KEY / OPENAI_API_KEY / MIMO_API_KEY',
    );
    process.exit(2);
  }

  const outDir = resolve(process.cwd(), 'qa/out');
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();

  if (engine === 'current') {
    const { resolveMarketDataForIqReport } = await import('@/lib/funnel/iq-market-data-resolve');
    const { generateIqFullReportWithN8nFallback } = await import('@/lib/funnel/iq-generate-full-report');

    const userInputs: Record<string, number> = {};
    if (input.rent_usd) userInputs.monthly_rent_usd = input.rent_usd;
    if (input.sqft) userInputs.sqft = input.sqft;

    const marketData = await resolveMarketDataForIqReport({
      existing: Object.keys(userInputs).length ? { user_inputs: userInputs } : null,
      location: input.address,
      businessType: input.business_type_raw ?? input.cuisine,
      isPremium: true,
      lang: input.language,
      skipDeepResearchFetch: true,
      leanResolve: true,
    });

    const full = await generateIqFullReportWithN8nFallback({
      reportId: `golden-${golden.case_id}`,
      location: input.address,
      businessType: input.business_type_raw ?? input.cuisine,
      headline: '',
      reason: '',
      marketData: marketData ?? undefined,
      language: input.language,
      skipDualVerify: true,
      leanGeneration: true,
      timeoutMs: 240_000,
    });

    const outPath = resolve(outDir, `${caseId}.current.json`);
    writeFileSync(outPath, JSON.stringify({ market_data: marketData, full_report: full }, null, 2));
    const defects = scanLegacyDefects(full as Record<string, unknown>, input);
    console.log(`\n[replay-golden] engine=current case=${caseId} elapsed=${Math.round((Date.now() - t0) / 1000)}s → ${outPath}`);
    console.table(defects.map((d) => ({ defect: d.id, present: d.hit ? 'YES' : 'no', evidence: d.evidence.slice(0, 110) })));
    return;
  }

  // `--engine v360` is wired in Phase 2 (lib/iq/pipeline.ts).
  console.error(`[replay-golden] unknown engine "${engine}" (use current)`);
  process.exit(2);
}

main().catch((err) => {
  console.error('[replay-golden] FAIL', err);
  process.exit(1);
});
