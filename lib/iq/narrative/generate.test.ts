import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportModel } from '../model/schema';
import { createCostLedger } from '../data/context';
import { numberGuard } from './number-guard';
import { PAGES, pageFragment, templateNarrative, type PageId } from './templates';
import {
  NARRATIVE_COST_PAGE_USD,
  NARRATIVE_COST_SUMMARY_USD,
  checkNarrative,
  generateNarratives,
  narrativeForPage,
  type NarrativeLlm,
  type NarrativeLlmRequest,
} from './generate';

const load = (): ReportModel => JSON.parse(readFileSync(join(process.cwd(), 'qa/fixtures/report_model_millbrae.json'), 'utf8')) as ReportModel;
const noEnv = () => null;
const base = (m: ReportModel, llm: NarrativeLlm | null | undefined, extra: Partial<Parameters<typeof generateNarratives>[1]> = {}) =>
  generateNarratives(m, { llm, cost: createCostLedger(), env: noEnv, language: 'zh', timeoutMs: 2_000, ...extra });

/** Short, number-free output that passes every guard rule (page 2 also needs the verbatim conditions). */
function validFor(m: ReportModel, pageId: PageId): { title: string; body: string; refs: string[] } {
  const key = PAGES.find((p) => p.id === pageId)!.fragment[0];
  const condList = m.score.conditions.map((c) => c.text_zh).join('；') || '无';
  const conds = pageId === 'page_2' ? `签约前条件：${condList}。` : pageId === 'page_15' ? `签约前必须做的事：${condList}。` : '';
  return { title: '需求不足，不建议签约', body: `按 [src:${key}] 判断需求不足。${conds}`, refs: [key] };
}

test('(a) llm: null → all 15 pages are templates and every template passes NumberGuard on its own fragment', async () => {
  const m = load();
  const { narrative, stats } = await base(m, null);
  assert.equal(PAGES.length, 15);
  assert.equal(Object.keys(narrative).length, 15);
  assert.deepEqual(stats, { llm_pages: 0, template_pages: 15, regenerated: 0, guard_failures: [] });
  for (const p of PAGES) {
    const n = narrative[p.id];
    const t = templateNarrative(m, p.id);
    assert.equal(n.title, t.title);
    assert.equal(n.body, t.body);
    assert.equal(n.guard, 'template_fallback:no_llm');
    const g = numberGuard(`${t.title} ${t.body}`, pageFragment(m, p.id), { isVoid: m.competitors.void.is_void });
    assert.ok(g.ok, `${p.id} template fails guard: ${JSON.stringify(g)}`);
    for (const r of t.refs) assert.ok(PAGES.find((x) => x.id === p.id)!.fragment.some((k) => r === k || r.startsWith(k + '.') || k.startsWith(r + '.')), `${p.id} ref ${r} outside fragment`);
  }
  // no key in env + llm undefined → templates only, no cost
  const cost = createCostLedger();
  const r2 = await generateNarratives(m, { cost, env: noEnv, language: 'zh' });
  assert.equal(r2.stats.template_pages, 15);
  assert.equal(cost.entries().length, 0);
});

test('templates speak plain Chinese: no ring ids, layer codes, field names, Greek letters or cost lines', async () => {
  const m = load();
  const { narrative } = await base(m, null);
  const jargon = /\b(walk10|drive5|drive10|drive15|L1|L2|L3|L4|coverage_ratio|cluster_score|Huff|HHI|P25|P75|CapEx)\b|β|α|报告成本|置信度/;
  const prose = (s: string) => s.replace(/\s*\[src:[^\]]*\]/g, ''); // citations carry field paths by design; the renderer strips them
  for (const p of PAGES) {
    const n = narrative[p.id];
    assert.ok(!jargon.test(prose(`${n.title} ${n.body}`)), `${p.id} leaks jargon: ${n.title} ${n.body}`);
  }
  assert.equal(narrative.page_14.title, '每个数字都可追溯到公开数据来源');
  assert.ok(!/12 个数据源中|个完整/.test(narrative.page_14.title + narrative.page_14.body));
  assert.ok(narrative.page_15.body.startsWith('结论：') && narrative.page_15.body.includes('签约前必须做的事：') && narrative.page_15.body.includes('下一步：'), narrative.page_15.body);
  for (const c of m.score.conditions) assert.ok(narrative.page_15.body.includes(c.text_zh));
});

test('(b) fabricated number on the first call, valid on the second → regenerated once, guard ok_after_regen', async () => {
  const m = load();
  const calls: NarrativeLlmRequest[] = [];
  const llm: NarrativeLlm = async (req) => {
    if (req.pageId !== 'page_9') return null;
    calls.push(req);
    if (calls.length === 1) {
      return { title: '租金溢价 127%，偏高', body: `租金溢价 127% [src:demand.coverage_ratio]，捕获月需求 $${Math.round(m.demand.captured_monthly_usd!).toLocaleString('en-US')} [src:demand.captured_monthly_usd]。`, refs: ['demand.coverage_ratio'] };
    }
    return {
      title: `捕获需求仅覆盖保本线 ${(m.demand.coverage_ratio! * 100).toFixed(1)}%，不足`,
      body: `捕获月需求 $${Math.round(m.demand.captured_monthly_usd!).toLocaleString('en-US')} [src:demand.captured_monthly_usd]，覆盖保本线 ${(m.demand.coverage_ratio! * 100).toFixed(1)}% [src:demand.coverage_ratio]。`,
      refs: ['demand.captured_monthly_usd', 'demand.coverage_ratio'],
      provider: 'anthropic/claude-sonnet-5',
    };
  };
  const { narrative, stats } = await base(m, llm);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].user.includes('上一次输出的问题：') && calls[1].user.includes('127%'), calls[1].user.slice(-200));
  assert.equal(calls[0].tier, 'page');
  assert.equal(stats.regenerated, 1);
  assert.equal(stats.llm_pages, 1);
  assert.equal(stats.template_pages, 14);
  assert.deepEqual(stats.guard_failures, [{ page: 'page_9', unmatched: ['127%', '127%'], banned: [] }]);
  assert.equal(narrative.page_9.guard, 'ok_after_regen');
  assert.equal(narrative.page_9.provider, 'anthropic/claude-sonnet-5');
  assert.deepEqual(narrative.page_9.refs, ['demand.captured_monthly_usd', 'demand.coverage_ratio']);
  assert.equal(narrative.page_1.guard, 'template_fallback:llm_null');
});

test('(c) always fabricating → template fallback with the guard reason', async () => {
  const m = load();
  let n = 0;
  const llm: NarrativeLlm = async (req) => {
    if (req.pageId !== 'page_9') return null;
    n++;
    return { title: '租金溢价 127%，偏高', body: '租金溢价 127% [src:demand.coverage_ratio]。', refs: [] };
  };
  const { narrative, stats } = await base(m, llm);
  assert.equal(n, 2);
  assert.equal(stats.llm_pages, 0);
  assert.equal(stats.guard_failures.length, 2);
  const t = templateNarrative(m, 'page_9');
  assert.equal(narrative.page_9.title, t.title);
  assert.equal(narrative.page_9.body, t.body);
  assert.ok(narrative.page_9.guard?.startsWith('template_fallback:guard:数字 127% 不在 JSON 中'), narrative.page_9.guard);
});

test('(d) a throwing or hanging llm → template fallback, never throws', async () => {
  const m = load();
  const boom: NarrativeLlm = async () => {
    throw new Error('socket hang up');
  };
  const r1 = await base(m, boom);
  assert.equal(r1.stats.template_pages, 15);
  assert.equal(r1.narrative.page_4.guard, 'template_fallback:llm_error:socket hang up');
  const hang: NarrativeLlm = () => new Promise(() => {});
  const r2 = await base(m, hang, { timeoutMs: 30 });
  assert.equal(r2.stats.template_pages, 15);
  assert.ok(r2.narrative.page_2.guard?.startsWith('template_fallback:llm_error:timeout'), r2.narrative.page_2.guard);
});

test('(e) 零竞争 is rejected unless competitors.void.is_void is true', async () => {
  const m = load();
  assert.equal(m.competitors.void.is_void, false);
  const llm: NarrativeLlm = async (req) => (req.pageId === 'page_8' ? { title: '该品类零竞争，可做', body: '该品类零竞争 [src:competitors.void.is_void]。', refs: ['competitors.void.is_void'] } : null);
  const r1 = await base(m, llm);
  assert.ok(r1.narrative.page_8.guard?.startsWith('template_fallback:guard:含禁用词 零竞争'), r1.narrative.page_8.guard);
  assert.deepEqual(r1.stats.guard_failures.map((f) => f.banned), [['零竞争'], ['零竞争']]);

  const voidModel: ReportModel = structuredClone(m);
  voidModel.competitors.void.is_void = true;
  const r2 = await base(voidModel, llm);
  assert.equal(r2.narrative.page_8.guard, 'ok');
  assert.equal(r2.narrative.page_8.title, '该品类零竞争，可做');
  assert.equal(r2.stats.llm_pages, 1);
});

test('(f) cost ledger increments per LLM call; pages 2 and 15 run last on the summary tier', async () => {
  const m = load();
  const order: PageId[] = [];
  const tiers = new Map<PageId, string>();
  const systems = new Map<PageId, string>();
  const llm: NarrativeLlm = async (req) => {
    order.push(req.pageId);
    tiers.set(req.pageId, req.tier);
    systems.set(req.pageId, req.system);
    assert.ok(req.system.includes('RestaurantIQ') && req.user.startsWith(`页面 = ${req.pageId}`));
    return validFor(m, req.pageId);
  };
  const cost = createCostLedger();
  const { narrative, stats } = await generateNarratives(m, { llm, cost, env: noEnv, language: 'zh', concurrency: 3 });
  assert.equal(stats.llm_pages, 15);
  assert.equal(stats.template_pages, 0);
  assert.equal(order.length, 15);
  assert.equal(order[13], 'page_2');
  assert.equal(order[14], 'page_15');
  assert.equal(tiers.get('page_2'), 'summary');
  assert.equal(tiers.get('page_15'), 'summary');
  assert.ok([...tiers.entries()].filter(([id]) => id !== 'page_2' && id !== 'page_15').every(([, t]) => t === 'page'));
  // audience rule on every page; page-specific summary instructions
  for (const [, s] of systems) assert.ok(s.includes('写给餐饮老板看') && s.includes('不用英文缩写'), s.slice(0, 120));
  assert.ok(systems.get('page_2')!.includes('执行摘要') && !systems.get('page_2')!.includes('面向老板的总结'));
  assert.ok(systems.get('page_15')!.includes('面向老板的总结') && systems.get('page_15')!.includes('签约前必须做的事'));
  assert.ok(!systems.get('page_9')!.includes('执行摘要'));
  assert.equal(cost.entries().length, 15);
  assert.equal(cost.entries().filter((e) => e.source === 'llm').length, 15);
  assert.equal(cost.total(), Math.round((13 * NARRATIVE_COST_PAGE_USD + 2 * NARRATIVE_COST_SUMMARY_USD) * 10_000) / 10_000);
  assert.ok(cost.entries().some((e) => e.note === 'narrative page_2'));
  assert.ok(cost.entries().some((e) => e.note === 'narrative page_15'));
  for (const p of PAGES) assert.equal(narrative[p.id].guard, 'ok');

  // regen calls are charged too
  const cost2 = createCostLedger();
  let k = 0;
  await generateNarratives(m, { llm: async (req) => (req.pageId === 'page_9' ? (k++ === 0 ? { title: '偏高', body: '溢价 127% [src:demand]', refs: [] } : validFor(m, 'page_9')) : null), cost: cost2, env: noEnv, language: 'zh' });
  assert.deepEqual(cost2.entries().filter((e) => e.note.includes('page_9')).map((e) => e.note), ['narrative page_9', 'narrative page_9 regen']);
});

test('page 15 summary must copy the conditions verbatim on its own fragment', () => {
  const m = load();
  const frag = pageFragment(m, 'page_15');
  const conds = m.score.conditions.map((c) => c.text_zh);
  const bad = checkNarrative({ title: '不建议', body: '结论：不建议 [src:score.total]。签约前必须做的事：无。', refs: ['score.total'] }, frag, { isVoid: false, language: 'zh', tier: 'summary', conditions: conds });
  assert.ok(bad.reasons.some((r) => r.startsWith('签约前条件未逐字复制')), bad.reasons.join(' | '));
  const good = checkNarrative(
    { title: '不建议', body: `结论：不建议 [src:score.total]，需求覆盖率 ${(m.demand.coverage_ratio! * 100).toFixed(1)}% [src:demand.coverage_ratio]。签约前必须做的事：${conds.join('；')}。`, refs: ['score.total', 'demand.coverage_ratio'] },
    frag,
    { isVoid: false, language: 'zh', tier: 'summary', conditions: conds },
  );
  assert.deepEqual(good.reasons, []);
});

test('page 2 summary must copy 签约前条件 verbatim; ref paths must exist in the fragment', async () => {
  const m = load();
  const frag = pageFragment(m, 'page_2');
  const conds = m.score.conditions.map((c) => c.text_zh);
  const bad = checkNarrative({ title: '需求不足，不建议', body: '按 [src:score.total] 判断不足。签约前条件：租金需谈至 ≤ $3,000/月。', refs: ['score.total'] }, frag, { isVoid: false, language: 'zh', tier: 'summary', conditions: conds });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((r) => r.startsWith('签约前条件未逐字复制')), bad.reasons.join(' | '));
  assert.ok(bad.reasons.some((r) => r.startsWith('数字 $3,000 不在 JSON 中')), bad.reasons.join(' | '));
  const good = checkNarrative({ title: '需求不足，不建议', body: `按 [src:score.total] 判断不足。签约前条件：${conds.join('；')}。`, refs: ['score.total', 'score.conditions[0].text_zh'] }, frag, { isVoid: false, language: 'zh', tier: 'summary', conditions: conds });
  assert.deepEqual(good.reasons, []);
  const badRef = checkNarrative({ title: '不足', body: '见 [src:trade_area.rings.9.pop] 不足。', refs: ['finance.rent_source'] }, pageFragment(m, 'page_3'), { isVoid: false, language: 'zh', tier: 'page' });
  assert.deepEqual(badRef.unmatched, ['ref:finance.rent_source', 'ref:trade_area.rings.9.pop']);
  const longTitle = checkNarrative({ title: '一'.repeat(29), body: '见 [src:score.total] 不足。', refs: [] }, frag, { isVoid: false, language: 'zh', tier: 'page' });
  assert.deepEqual(longTitle.reasons, ['标题超过 28 字']);
});

test('english mode: prompts in English, 12-word title cap, verbatim text_en conditions', async () => {
  const m = load();
  const seen: NarrativeLlmRequest[] = [];
  const llm: NarrativeLlm = async (req) => {
    seen.push(req);
    return null;
  };
  await base(m, llm, { language: 'en' });
  assert.equal(seen.length, 15);
  assert.ok(seen[0].system.startsWith('You are a RestaurantIQ analyst') && seen[0].user.startsWith('page = '));
  assert.ok(seen.find((r) => r.pageId === 'page_2')!.system.includes('Pre-lease conditions'));
  assert.ok(seen.find((r) => r.pageId === 'page_15')!.system.includes('Must do before signing'));
  assert.equal(seen.find((r) => r.pageId === 'page_15')!.tier, 'summary');
  const frag = pageFragment(m, 'page_2');
  const r = checkNarrative({ title: 'one two three four five six seven eight nine ten eleven twelve thirteen', body: 'Demand falls short [src:score.total].', refs: [] }, frag, { isVoid: false, language: 'en', tier: 'page' });
  assert.deepEqual(r.reasons, ['title exceeds 12 words']);
});

test('narrativeForPage falls back to the template when the model has no narrative', () => {
  const m = load();
  assert.deepEqual(narrativeForPage(m, 'page_6'), templateNarrative(m, 'page_6'));
  const withN: ReportModel = { ...m, narrative: { page_6: { title: 'T', body: 'B [src:competitors]', refs: ['competitors'], guard: 'ok' } } };
  assert.equal(narrativeForPage(withN, 'page_6').title, 'T');
  assert.deepEqual(narrativeForPage(withN, 'page_7'), templateNarrative(m, 'page_7'));
});
