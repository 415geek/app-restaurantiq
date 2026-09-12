/**
 * Narrative layer (研发提示词 Phase 5.4 + 附录 E + Phase 6 门槛 5/6).
 *
 * For each of the 14 pages the LLM is handed ONLY the page's JSON fragment
 * (`pageFragment`) and must return `{title, body, refs}` where every number is
 * followed by a `[src:path]` citation. Output is checked by NumberGuard plus
 * length / ref-path rules; a failure is fed back for ONE regeneration, and a
 * second failure falls back to the deterministic template (`templateNarrative`).
 * Nothing in here throws — any exception becomes a template fallback for that
 * page — so the paid report is always fully narrated.
 */
import { runIqProviderJson } from '@/lib/funnel/iq-provider-router';
import type { CostLedger } from '../data/types';
import type { ReportModel } from '../model/schema';
import { getDefaults } from '../params';
import { hasLlmKey } from './llm';
import { numberGuard } from './number-guard';
import { PAGES, pageFragment, templateNarrative, type PageId } from './templates';

export type NarrativeTier = 'page' | 'summary';
export type NarrativeLanguage = 'en' | 'zh';

export type NarrativeLlmRequest = { pageId: PageId; system: string; user: string; tier: NarrativeTier };
/** `provider` ("anthropic/claude-sonnet-5") is a side channel for the report's provenance column. */
export type NarrativeLlmResult = { title: string; body: string; refs: string[]; provider?: string };
export type NarrativeLlm = (req: NarrativeLlmRequest) => Promise<NarrativeLlmResult | null>;

export type NarrativeEntry = ReportModel['narrative'][string];

export interface GuardFailure {
  page: PageId;
  unmatched: string[];
  banned: string[];
}

export interface GenerateNarrativesResult {
  narrative: ReportModel['narrative'];
  stats: { llm_pages: number; template_pages: number; regenerated: number; guard_failures: GuardFailure[] };
}

export interface GenerateNarrativesOptions {
  /** `undefined` → default router-backed LLM when a key exists; `null` → templates only. */
  llm?: NarrativeLlm | null;
  cost: CostLedger;
  env: (n: string) => string | null;
  language: NarrativeLanguage;
  /** Per-call budget (default 45 s). Applies to the default LLM and to a custom `llm`. */
  timeoutMs?: number;
  /** Pool size for page-tier calls (default 4). */
  concurrency?: number;
}

/** Approximate per-call costs; Phase 7 refines them from token counts. */
export const NARRATIVE_COST_PAGE_USD = 0.004;
export const NARRATIVE_COST_SUMMARY_USD = 0.03;
export const NARRATIVE_MAX_TOKENS: Record<NarrativeTier, number> = { page: 600, summary: 1200 };

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_CONCURRENCY = 4;
const SUMMARY_PAGE: PageId = 'page_2';

/**
 * Length limits. The executive summary must carry three reasons, three risks
 * and the verbatim 签约前条件 on top of its two-to-three sentences, so its body
 * cap is wider than the per-page 120 (+overflow to 160) rule of 附录 E.
 */
export const NARRATIVE_LIMITS = {
  zh: { title: 28, body: { page: 160, summary: 480 } },
  en: { title: 12, body: { page: 160, summary: 320 } }, // words
} as const;

// ---------------------------------------------------------------------------
// Prompts (附录 E)
// ---------------------------------------------------------------------------

const SYSTEM_ZH =
  '你是 RestaurantIQ 的分析师，为中餐馆老板写选址报告。你只能使用下面 JSON 里的数字与事实，不得引入任何 JSON 之外的数字、地名、品牌或判断。' +
  '每个数字后面必须紧跟 [src:字段路径]。输出 JSON：{"title": "≤28字、必须包含判断（如 覆盖/不足/偏高/可做）", "body": "≤120字，两句到三句", "refs": [字段路径数组]}。' +
  '禁用词：零竞争、空白（除非 competitors.void.is_void 为 true）、保守估计、大约、显著（修饰官方统计时）。语气：直接、给判断、不夸张、不安慰。中文为主，专有名词可用英文。';

const SYSTEM_ZH_SUMMARY =
  '本页是执行摘要：body 除两到三句结论外，还必须列出三条支持理由与三条风险（每条 ≤ 30 字、每条带 [src:字段路径] 引用），' +
  '并以「签约前条件：」开头逐字复制 score.conditions[].text_zh（用「；」分隔，不得改写任何数字或措辞；无条件时写「无」）。body 总长 ≤ 400 字。';

const SYSTEM_EN =
  'You are a RestaurantIQ analyst writing a site-selection report for a Chinese-restaurant owner. Use ONLY the numbers and facts in the JSON below; ' +
  'never introduce any number, place name, brand or judgement that is not in the JSON. Every number must be immediately followed by [src:field.path]. ' +
  'Output JSON: {"title": "≤ 12 words and it must state a verdict (e.g. covers / falls short / too high / viable)", "body": "≤ 120 words, two to three sentences", "refs": [array of field paths]}. ' +
  'Banned wording: "zero competition", "white space" / "gap" as a category void (unless competitors.void.is_void is true), "conservative estimate", "approximately", "significant" (when describing official statistics). ' +
  'Tone: direct, give a verdict, no hype, no reassurance.';

const SYSTEM_EN_SUMMARY =
  'This page is the executive summary: besides the two-to-three-sentence conclusion, the body must list three supporting reasons and three risks (each ≤ 30 words, each with a [src:field.path] citation), ' +
  'and must start a line with "Pre-lease conditions:" followed by score.conditions[].text_en copied verbatim (separated by "; "; never rewrite a number or wording; write "none" when empty). Body ≤ 300 words.';

const bandsText = (lang: NarrativeLanguage): string => {
  const d = getDefaults();
  const bands = d.cluster_score.bands;
  const names = lang === 'zh' ? ['冷启动', '低集聚', '集聚红利', '偏饱和', '饱和'] : ['cold start', 'low cluster', 'cluster dividend', 'near saturated', 'saturated'];
  const b = bands.map(([lo, hi, s], i) => `${hi >= 999 ? `≥ ${lo}` : lo === hi ? `${lo}` : `${lo}–${hi}`} → ${names[i] ?? ''} ${s}`).join(', ');
  return lang === 'zh' ? `cluster_score 按 walk10 内 L1+L2 家数分档（${b}），再按 coverage_ratio ±${d.cluster_score.coverage_adjust}。` : `cluster_score is banded by the L1+L2 count inside walk10 (${b}), then adjusted ±${d.cluster_score.coverage_adjust} by coverage_ratio.`;
};

/** Brief explanation of the ids and thresholds the LLM will see in the fragment. */
export function paramNotes(lang: NarrativeLanguage): string {
  const v = getDefaults().verdict;
  if (lang === 'zh') {
    return (
      '圈层 id：walk10 = 步行 10 分钟等时圈；drive5 / drive10 / drive15 = 车程 5 / 10 / 15 分钟等时圈；trade_area.primary_ring 为主商圈。' +
      'L1 = 同子菜系直接竞品，L2 = 其他中餐，L3 = 其他亚洲餐，L4 = 客流锚点。' +
      'coverage_ratio = 模型捕获月需求 ÷ 保本线，≥ 1 表示覆盖保本，< 1 表示不足。' +
      bandsText('zh') +
      `verdict：总分 ≥ ${v.go} 为 GO（可做），≥ ${v.conditional} 为 CONDITIONAL_GO（有条件可做），否则 NO_GO（不建议）。` +
      'null = 未获取，只能写「未获取」，不得估算。'
    );
  }
  return (
    'Ring ids: walk10 = 10-minute walk isochrone; drive5 / drive10 / drive15 = 5 / 10 / 15-minute drive isochrones; trade_area.primary_ring is the primary trade area. ' +
    'L1 = direct competitors (same sub-cuisine), L2 = other Chinese restaurants, L3 = other Asian, L4 = traffic anchors. ' +
    'coverage_ratio = captured monthly demand ÷ break-even; ≥ 1 covers break-even, < 1 falls short. ' +
    bandsText('en') +
    ` verdict: total ≥ ${v.go} is GO, ≥ ${v.conditional} is CONDITIONAL_GO, otherwise NO_GO. ` +
    'null = not available: write "not available", never estimate.'
  );
}

export function buildNarrativePrompts(pageId: PageId, fragment: Record<string, unknown>, lang: NarrativeLanguage): { system: string; user: string; tier: NarrativeTier } {
  const spec = PAGES.find((p) => p.id === pageId)!;
  const tier: NarrativeTier = pageId === SUMMARY_PAGE ? 'summary' : 'page';
  const system = lang === 'zh' ? (tier === 'summary' ? `${SYSTEM_ZH} ${SYSTEM_ZH_SUMMARY}` : SYSTEM_ZH) : tier === 'summary' ? `${SYSTEM_EN} ${SYSTEM_EN_SUMMARY}` : SYSTEM_EN;
  const user =
    lang === 'zh'
      ? `页面 = ${pageId}（${spec.zh}/${spec.en}）；页面 JSON 片段 = ${JSON.stringify(fragment)}；参数说明 = ${paramNotes('zh')}`
      : `page = ${pageId} (${spec.zh}/${spec.en}); page JSON fragment = ${JSON.stringify(fragment)}; parameter notes = ${paramNotes('en')}`;
  return { system, user, tier };
}

// ---------------------------------------------------------------------------
// Guard (NumberGuard + length + ref paths + summary conditions)
// ---------------------------------------------------------------------------

export interface NarrativeCheck {
  ok: boolean;
  /** Human-readable problems in the report language — appended to the regen prompt. */
  reasons: string[];
  unmatched: string[];
  banned: string[];
}

const cjkLen = (s: string) => [...s.trim()].length;
const wordLen = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** "[src:trade_area.rings[2].pop]" → "trade_area.rings.2.pop" */
export function normalizeRef(ref: string): string {
  return ref
    .trim()
    .replace(/^\[?\s*src:\s*/i, '')
    .replace(/\]$/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\.+|\.+$/g, '');
}

/** A ref resolves when it is a fragment key, a path under one, or a parent of one. */
export function refExists(ref: string, fragment: Record<string, unknown>): boolean {
  if (!ref) return false;
  for (const key of Object.keys(fragment)) {
    if (ref === key) return fragment[key] !== undefined;
    if (key.startsWith(ref + '.')) return true;
    if (ref.startsWith(key + '.')) {
      let cur: unknown = fragment[key];
      for (const part of ref.slice(key.length + 1).split('.')) {
        if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
        else return false;
      }
      return cur !== undefined;
    }
  }
  return false;
}

function citationsIn(text: string): string[] {
  return [...text.matchAll(/\[src:([^\]]+)\]/g)].map((m) => normalizeRef(m[1]));
}

export function checkNarrative(
  out: { title: string; body: string; refs: string[] },
  fragment: Record<string, unknown>,
  opts: { isVoid: boolean; language: NarrativeLanguage; tier: NarrativeTier; conditions?: string[] },
): NarrativeCheck {
  const zh = opts.language === 'zh';
  const reasons: string[] = [];
  const title = (out.title ?? '').trim();
  const body = (out.body ?? '').trim();
  const lim = NARRATIVE_LIMITS[opts.language];

  if (!title) reasons.push(zh ? '标题为空' : 'title is empty');
  else if (zh ? cjkLen(title) > lim.title : wordLen(title) > lim.title) reasons.push(zh ? `标题超过 ${lim.title} 字` : `title exceeds ${lim.title} words`);
  if (!body) reasons.push(zh ? '正文为空' : 'body is empty');
  else {
    const max = lim.body[opts.tier];
    if (zh ? cjkLen(body) > max : wordLen(body) > max) reasons.push(zh ? `正文超过 ${max} 字` : `body exceeds ${max} words`);
  }

  const g = numberGuard(`${title} ${body}`, fragment, { isVoid: opts.isVoid });
  for (const n of g.unmatched) reasons.push(zh ? `数字 ${n} 不在 JSON 中` : `number ${n} is not in the JSON`);
  for (const b of g.banned) reasons.push(zh ? `含禁用词 ${b}` : `contains banned word ${b}`);
  if (g.missing_refs) reasons.push(zh ? '缺少 [src:]' : 'missing [src:] citations');

  const badRefs = new Set<string>();
  for (const r of [...(Array.isArray(out.refs) ? out.refs : []).map((x) => normalizeRef(String(x))), ...citationsIn(`${title} ${body}`)]) {
    if (!refExists(r, fragment)) badRefs.add(r);
  }
  for (const r of badRefs) reasons.push(zh ? `引用路径 ${r} 不在 JSON 中` : `cited path ${r} is not in the JSON`);

  if (opts.tier === 'summary' && opts.conditions?.length) {
    const missing = opts.conditions.filter((c) => c.trim() && !body.includes(c.trim()));
    if (missing.length) reasons.push(zh ? `签约前条件未逐字复制：${missing.join('；')}` : `pre-lease conditions not copied verbatim: ${missing.join('; ')}`);
  }

  return { ok: reasons.length === 0, reasons, unmatched: [...g.unmatched, ...[...badRefs].map((r) => `ref:${r}`)], banned: g.banned };
}

// ---------------------------------------------------------------------------
// Default LLM (provider router)
// ---------------------------------------------------------------------------

function parseLlmOutput(data: unknown): { title: string; body: string; refs: string[] } | null {
  if (!data || typeof data !== 'object') return null;
  let d = data as Record<string, unknown>;
  // tolerate a wrapper like {"narrative": {...}} / {"output": {...}}
  if (typeof d.title !== 'string' && typeof d.body !== 'string') {
    const inner = Object.values(d).find((v) => v && typeof v === 'object' && typeof (v as Record<string, unknown>).body === 'string');
    if (!inner) return null;
    d = inner as Record<string, unknown>;
  }
  if (typeof d.title !== 'string' || typeof d.body !== 'string') return null;
  const refs = Array.isArray(d.refs) ? d.refs.filter((r): r is string => typeof r === 'string') : [];
  return { title: d.title, body: d.body, refs };
}

/** Page tier → 'iq_partial' on the fast model; summary tier → 'iq_full' (Claude quality path). */
export function defaultNarrativeLlm(timeoutMs = DEFAULT_TIMEOUT_MS): NarrativeLlm {
  return async (req) => {
    const res = await runIqProviderJson<Record<string, unknown>>({
      task: req.tier === 'summary' ? 'iq_full' : 'iq_partial',
      fastModel: req.tier === 'page',
      system: req.system,
      user: req.user,
      maxTokens: NARRATIVE_MAX_TOKENS[req.tier],
      timeoutMs,
    });
    if (!res) return null;
    const parsed = parseLlmOutput(res.data);
    return parsed ? { ...parsed, provider: `${res.provider}/${res.model}` } : null;
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** The narrative stored on the model, or the deterministic template when absent. */
export function narrativeForPage(model: ReportModel, pageId: PageId): NarrativeEntry {
  return model.narrative?.[pageId] ?? templateNarrative(model, pageId);
}

export async function generateNarratives(model: ReportModel, opts: GenerateNarrativesOptions): Promise<GenerateNarrativesResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const llm: NarrativeLlm | null = opts.llm === null ? null : (opts.llm ?? (hasLlmKey(opts.env) ? defaultNarrativeLlm(timeoutMs) : null));
  const lang = opts.language;
  const zh = lang === 'zh';
  const isVoid = Boolean(model.competitors?.void?.is_void);
  const conditions = (model.score?.conditions ?? []).map((c) => (zh ? c.text_zh : c.text_en));

  const narrative: ReportModel['narrative'] = {};
  const stats: GenerateNarrativesResult['stats'] = { llm_pages: 0, template_pages: 0, regenerated: 0, guard_failures: [] };

  const fallback = (pageId: PageId, reason: string) => {
    narrative[pageId] = { ...templateNarrative(model, pageId), guard: `template_fallback:${reason.slice(0, 200)}` };
    stats.template_pages += 1;
  };

  const generatePage = async (pageId: PageId): Promise<void> => {
    if (!llm) return fallback(pageId, 'no_llm');
    let fragment: Record<string, unknown>;
    let prompts: ReturnType<typeof buildNarrativePrompts>;
    try {
      fragment = pageFragment(model, pageId);
      prompts = buildNarrativePrompts(pageId, fragment, lang);
    } catch (e) {
      return fallback(pageId, `prompt_error:${e instanceof Error ? e.message : String(e)}`);
    }
    const { system, user, tier } = prompts;
    const pageN = pageId.replace('page_', '');
    let feedback: string | null = null;
    let lastReason = 'unknown';

    for (let attempt = 0; attempt < 2; attempt++) {
      const userPrompt = feedback ? `${user}\n${zh ? '上一次输出的问题：' : 'Problems with the previous output: '}${feedback}` : user;
      let res: NarrativeLlmResult | null;
      try {
        opts.cost.add('llm', tier === 'summary' ? NARRATIVE_COST_SUMMARY_USD : NARRATIVE_COST_PAGE_USD, `narrative page_${pageN}${attempt ? ' regen' : ''}`);
        res = await withTimeout(Promise.resolve(llm({ pageId, system, user: userPrompt, tier })), timeoutMs);
      } catch (e) {
        lastReason = `llm_error:${e instanceof Error ? e.message : String(e)}`;
        break;
      }
      if (!res || typeof res !== 'object') {
        lastReason = 'llm_null';
        break;
      }
      let check: NarrativeCheck;
      try {
        check = checkNarrative(res, fragment, { isVoid, language: lang, tier, conditions });
      } catch (e) {
        lastReason = `guard_error:${e instanceof Error ? e.message : String(e)}`;
        break;
      }
      if (check.ok) {
        const refs = [...new Set((Array.isArray(res.refs) ? res.refs : []).map((r) => normalizeRef(String(r))))];
        narrative[pageId] = {
          title: res.title.trim(),
          body: res.body.trim(),
          refs,
          ...(res.provider ? { provider: res.provider } : {}),
          guard: attempt === 0 ? 'ok' : 'ok_after_regen',
        };
        stats.llm_pages += 1;
        return;
      }
      stats.guard_failures.push({ page: pageId, unmatched: check.unmatched, banned: check.banned });
      lastReason = `guard:${check.reasons.join(' / ')}`;
      if (attempt === 0) {
        feedback = check.reasons.join(' / ');
        stats.regenerated += 1;
      }
    }
    fallback(pageId, lastReason);
  };

  const pageIds = PAGES.map((p) => p.id);
  const others = pageIds.filter((id) => id !== SUMMARY_PAGE);
  try {
    await runPool(others, opts.concurrency ?? DEFAULT_CONCURRENCY, generatePage);
    await generatePage(SUMMARY_PAGE);
  } catch (e) {
    // generatePage never throws, but the report must be narrated regardless.
    console.warn('[iq360/narrative] unexpected failure', e);
  }
  for (const id of pageIds) if (!narrative[id]) fallback(id, 'unexpected');

  return { narrative, stats };
}
