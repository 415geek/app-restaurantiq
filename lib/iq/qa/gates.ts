/**
 * QA gates (研发提示词 Phase 6). Run before rendering; any failure → 预检版.
 *
 *  1 schema            report_model.json validates against 附录 D (zod)
 *  2 data integrity    confidence ≥ 60; competitor guard passed; D1/D2/D5 ok
 *  3 sanity            Chinese share ≤ 100 % and same order as county; rent psf $1–$15;
 *                      high-population ring with zero competitors is an anomaly
 *  4 reconciliation    finance scenarios re-derive; weights = 100; total = Σ w×s/100
 *  5 NumberGuard       every number in every narrative exists in its page fragment
 *  6 banned wording    零竞争 / 空白 (zero competition / white space …) only when void; 保守估计 / 大约 (approximately …) never — per report language
 *  7 visual regression lives in lib/iq/qa/visual-regression.ts (needs a browser)
 *  8 golden backtest   scripts/backtest-golden.ts (needs network)
 */
import { toLocale } from '@/lib/i18n/locale';
import { reportModelSchema, type ReportModel } from '../model/schema';
import { BANNED_WORDS, numberGuard } from '../narrative/number-guard';
import { PAGES, pageFragment } from '../narrative/templates';
import { scenarioRevenue } from '../engines/finance';

export interface GateResult {
  id: 'schema' | 'integrity' | 'sanity' | 'reconciliation' | 'number_guard' | 'wording';
  passed: boolean;
  details: string[];
}

export interface GatesReport {
  passed: boolean;
  tier: 'paid' | 'precheck';
  gates: GateResult[];
  failures: string[];
}

export function gateSchema(raw: unknown): GateResult {
  const r = reportModelSchema.safeParse(raw);
  return { id: 'schema', passed: r.success, details: r.success ? [] : r.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) };
}

export function gateIntegrity(m: ReportModel): GateResult {
  const d: string[] = [];
  if (m.confidence.total < 60) d.push(`置信度 ${m.confidence.total} < 60`);
  if (!m.competitors.guard_passed) d.push(...m.competitors.guard_notes.map((n) => `竞品守卫：${n}`));
  const googleOnly = m.meta.degradations.some((x) => x.startsWith('overture_not_loaded_google_only'));
  for (const id of ['D1', 'D2', 'D5']) {
    if (id === 'D5' && googleOnly) continue; // declared bootstrap mode: Google pool ≥ 15 stands in for Overture
    const s = m.sources.find((x) => x.id === id);
    if (!s) d.push(`${id} 缺失`);
    else if (s.status !== 'ok') d.push(`${id} 状态 ${s.status}：${s.coverage_note}`);
  }
  return { id: 'integrity', passed: d.length === 0, details: d };
}

export function gateSanity(m: ReportModel): GateResult {
  const d: string[] = [];
  const county = m.trade_area.county_benchmark.chinese_hh_share;
  for (const r of m.trade_area.rings) {
    if (r.chinese_hh_share != null && (r.chinese_hh_share < 0 || r.chinese_hh_share > 1)) d.push(`${r.id} 中文家庭占比 ${r.chinese_hh_share} 越界`);
    if (r.chinese_hh_share != null && county != null && county > 0 && (r.chinese_hh_share / county > 10 || r.chinese_hh_share / county < 0.1)) d.push(`${r.id} 中文家庭占比 ${r.chinese_hh_share} 与县值 ${county} 不在同一数量级`);
    if (r.pop != null && r.pop < 0) d.push(`${r.id} 人口为负`);
  }
  const rent = m.finance.fixed_cost.rent;
  if (rent != null && m.input.sqft) {
    const psf = rent / m.input.sqft;
    if (psf < 1 || psf > 15) d.push(`租金 $${psf.toFixed(2)}/sf/月 超出 $1–$15 区间`);
  }
  const d10 = m.trade_area.rings.find((r) => r.id === 'drive10');
  if (d10?.pop != null && d10.pop > 20_000 && m.competitors.l1.length + m.competitors.l2_count === 0) d.push('drive10 人口 > 20,000 而 L1+L2 = 0：竞品异常');
  if (m.demand.coverage_ratio != null && m.demand.coverage_ratio > 20) d.push(`coverage_ratio ${m.demand.coverage_ratio} 不合理`);
  return { id: 'sanity', passed: d.length === 0, details: d };
}

export function gateReconciliation(m: ReportModel): GateResult {
  const d: string[] = [];
  const f = m.finance;
  for (const s of f.scenarios) {
    const re = scenarioRevenue({ seats: s.seats, turns_per_day: s.turns_per_day, delivery_ratio: s.delivery_ratio, ticket_in: s.ticket_in, ticket_delivery: s.ticket_delivery, days_open: s.days_open });
    if (Math.abs(re.monthly_revenue - s.monthly_revenue) >= 1) d.push(`${s.id} 月营收 ${s.monthly_revenue} ≠ 反算 ${re.monthly_revenue}`);
    if (Math.abs(s.dine_in_covers_day - s.seats * s.turns_per_day) > 0.11) d.push(`${s.id} 堂食覆盖 ${s.dine_in_covers_day} ≠ seats×turns ${s.seats * s.turns_per_day}`);
    const fromOrders = (s.dine_in_covers_day * s.ticket_in + s.delivery_orders_day * s.ticket_delivery) * s.days_open;
    if (Math.abs(fromOrders - s.monthly_revenue) > Math.max(1, s.monthly_revenue * 0.002)) d.push(`${s.id} 单量反算营收 ${Math.round(fromOrders)} ≠ ${s.monthly_revenue}`);
  }
  if (f.breakeven_monthly != null && f.fixed_cost.total != null && f.contribution_margin) {
    const be = Math.round(f.fixed_cost.total / f.contribution_margin);
    if (Math.abs(be - f.breakeven_monthly) > 1) d.push(`保本 ${f.breakeven_monthly} ≠ 固定成本 ÷ 边际贡献 ${be}`);
  }
  const w = m.score.dimensions.reduce((s, x) => s + x.weight, 0);
  if (Math.round(w) !== 100) d.push(`权重和 ${w} ≠ 100`);
  const total = Math.round(m.score.dimensions.reduce((s, x) => s + (x.score * x.weight) / 100, 0) * 10) / 10;
  if (Math.abs(total - m.score.total) > 0.05) d.push(`总分 ${m.score.total} ≠ Σ 权重×分 ${total}`);
  for (const x of m.score.dimensions) if (Math.abs(x.weighted - (x.score * x.weight) / 100) > 0.05) d.push(`${x.id} weighted ${x.weighted} ≠ ${(x.score * x.weight) / 100}`);
  if (m.input.capex_usd == null && f.payback_months != null) d.push('无 CapEx 却显示回收期');
  if (m.demand.captured_monthly_usd != null && f.breakeven_monthly) {
    const cov = Math.round((m.demand.captured_monthly_usd / f.breakeven_monthly) * 1000) / 1000;
    if (m.demand.coverage_ratio == null || Math.abs(cov - m.demand.coverage_ratio) > 0.002) d.push(`coverage_ratio ${m.demand.coverage_ratio} ≠ ${cov}`);
  }
  if (m.score.alternatives.length && m.score.alternatives.length !== 14 && m.score.alternatives.length < 3) d.push(`替代菜系表 ${m.score.alternatives.length} 行`);
  return { id: 'reconciliation', passed: d.length === 0, details: d };
}

export function gateNumberGuard(m: ReportModel): GateResult {
  const d: string[] = [];
  for (const p of PAGES) {
    const n = m.narrative[p.id];
    if (!n) {
      d.push(`${p.id} 无叙事`);
      continue;
    }
    const r = numberGuard(`${n.title} ${n.body}`, pageFragment(m, p.id), { isVoid: m.competitors.void.is_void, lang: toLocale(m.meta.narrative_language ?? m.meta.language) });
    if (r.unmatched.length) d.push(`${p.id} 数字不在 JSON 中：${r.unmatched.join(', ')}`);
    if (r.missing_refs) d.push(`${p.id} 缺少 [src:] 引用`);
  }
  return { id: 'number_guard', passed: d.length === 0, details: d };
}

/** "significant" (显著 / significativo) modifying an official statistic, per language. */
const OFFICIAL_STAT_QUALIFIER = {
  zh: { word: /显著/, stat: /ACS|普查|人口/ },
  en: { word: /\bsignificant(ly)?\b/i, stat: /\bACS\b|census|population/i },
  es: { word: /significativ/i, stat: /\bACS\b|censo|población/i },
} as const;

/** Wording gate in the narrative's language (`meta.narrative_language`, else the report language). */
export function gateWording(m: ReportModel): GateResult {
  const d: string[] = [];
  const isVoid = m.competitors.void.is_void;
  const lang = toLocale(m.meta.narrative_language ?? m.meta.language);
  const words = BANNED_WORDS[lang];
  const q = OFFICIAL_STAT_QUALIFIER[lang];
  const has = (text: string, b: string) => (/[a-z]/i.test(b) ? text.toLowerCase().includes(b.toLowerCase()) : text.includes(b));
  for (const p of PAGES) {
    const n = m.narrative[p.id];
    if (!n) continue;
    const text = `${n.title} ${n.body}`;
    for (const b of words.always) if (has(text, b)) d.push(`${p.id} 禁用措辞「${b}」`);
    if (!isVoid) for (const b of words.unlessVoid) if (has(text, b)) d.push(`${p.id} 禁用措辞「${b}」（void=false）`);
    if (q.word.test(text) && q.stat.test(text)) d.push(`${p.id} 「显著」修饰官方统计`);
  }
  return { id: 'wording', passed: d.length === 0, details: d };
}

export function runQaGates(raw: unknown): GatesReport {
  const gates: GateResult[] = [];
  const schema = gateSchema(raw);
  gates.push(schema);
  if (!schema.passed) return { passed: false, tier: 'precheck', gates, failures: schema.details };
  const m = raw as ReportModel;
  gates.push(gateIntegrity(m), gateSanity(m), gateReconciliation(m), gateNumberGuard(m), gateWording(m));
  const failures = gates.flatMap((g) => g.details.map((x) => `[${g.id}] ${x}`));
  const passed = gates.every((g) => g.passed);
  return { passed, tier: passed ? 'paid' : 'precheck', gates, failures };
}
