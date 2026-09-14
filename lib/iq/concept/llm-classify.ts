/**
 * LLM layer of the concept classifier (评审 Spec §4.1 step 2).
 *
 * Runs only when the dictionary missed. One small JSON completion at
 * temperature 0 through the existing provider router (Claude / MiMo / OpenAI,
 * whichever is configured) answering `{category, subtype, confidence}`; the
 * answer is mapped onto a taxonomy id. `confidence < 0.8` or an `other`
 * subtype keeps the guess as `id` but sets `needs_confirmation` so the picker
 * can pre-select it. Returns null quickly when no provider key is configured
 * or the answer is unusable, so the caller falls back to the picker.
 */
import { resolveIqRouteResolved, runIqProviderJsonOnRoute } from '@/lib/funnel/iq-provider-router';
import { hasLlmKey } from '@/lib/iq/narrative/llm';
import { cuisinesInCategory, findCuisine, getTaxonomy, type ConceptCategory } from '@/lib/iq/params';
import { CONCEPT_CONFIDENCE_THRESHOLD, conceptOptions, isConceptCategory, toOption, type ConceptResolution } from './classify';
import { CONCEPT_CATEGORY_LABELS, CONCEPT_CATEGORY_ORDER } from './labels';

export const CONCEPT_LLM_TIMEOUT_MS = 12_000;
export const CONCEPT_LLM_MAX_TOKENS = 200;

export interface ConceptLlmAnswer {
  category?: unknown;
  subtype?: unknown;
  confidence?: unknown;
}

export type ConceptLlmRunner = (system: string, user: string) => Promise<ConceptLlmAnswer | null>;

function envOf(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/** Default runner: the IQ provider router at temperature 0, fast model, tiny output cap. */
async function runViaRouter(system: string, user: string): Promise<ConceptLlmAnswer | null> {
  const route = resolveIqRouteResolved('iq_competitor_insights', { fastModel: true });
  if (!route) return null;
  const res = await runIqProviderJsonOnRoute<Record<string, unknown>>({
    route: { ...route, temperature: 0, maxTokens: CONCEPT_LLM_MAX_TOKENS },
    system,
    user,
    timeoutMs: CONCEPT_LLM_TIMEOUT_MS,
  });
  return (res?.data as ConceptLlmAnswer | undefined) ?? null;
}

export function conceptClassifierPrompt(): string {
  const lines = CONCEPT_CATEGORY_ORDER.map((cat) => {
    const subs = cuisinesInCategory(cat)
      .map((c) => `${c.id}(${c.label_zh} / ${c.label_en})`)
      .join(', ');
    return `- ${cat} [${CONCEPT_CATEGORY_LABELS[cat].zh} / ${CONCEPT_CATEGORY_LABELS[cat].en}]: ${subs}`;
  });
  return (
    '你是餐饮业态分类器。把用户输入的业态描述归入一个顶级类目（category）和该类目下的一个子类型 id（subtype）。' +
    '只能使用下面列出的 category 与 subtype id；无法归入任何子类型时 subtype 填 "other"。\n' +
    lines.join('\n') +
    '\n输出 JSON {"category":"<category>","subtype":"<subtype id | other>","confidence":0-1}。confidence 是你对该归类的把握；不要输出其它文字。'
  );
}

/**
 * Map an LLM answer onto the taxonomy. A valid subtype wins; a valid category
 * with an unknown / `other` subtype pre-selects the category's first entry
 * (other_chinese for chinese_regional) with `needs_confirmation`; nothing valid
 * → null (the picker opens without a guess).
 */
export function resolutionFromLlmAnswer(answer: ConceptLlmAnswer | null): ConceptResolution | null {
  if (!answer || typeof answer !== 'object') return null;
  const conf = Math.max(0, Math.min(1, Number(answer.confidence) || 0));
  const subtype = typeof answer.subtype === 'string' ? answer.subtype.trim().toLowerCase() : '';
  const category: ConceptCategory | null = isConceptCategory(answer.category) ? answer.category : null;
  const options = conceptOptions();
  const bySubtype = findCuisine(subtype);
  if (bySubtype && (!category || bySubtype.category === category)) {
    const needs = conf < CONCEPT_CONFIDENCE_THRESHOLD;
    return { ...toOption(bySubtype), confidence: conf, method: 'llm', needs_confirmation: needs, options, matched: `llm:${bySubtype.id}@${conf.toFixed(2)}` };
  }
  if (category) {
    const guess = category === 'chinese_regional' ? findCuisine('other_chinese') : (cuisinesInCategory(category)[0] ?? null);
    if (!guess) return null;
    return { ...toOption(guess), confidence: Math.min(conf, CONCEPT_CONFIDENCE_THRESHOLD - 0.01), method: 'llm', needs_confirmation: true, options, matched: `llm:${category}/${subtype || 'other'}@${conf.toFixed(2)}` };
  }
  return null;
}

export async function classifyConceptWithLlm(text: string, opts: { run?: ConceptLlmRunner; env?: (n: string) => string | null } = {}): Promise<ConceptResolution | null> {
  const typed = (text ?? '').trim();
  if (!typed) return null;
  const env = opts.env ?? envOf;
  if (!opts.run && !hasLlmKey(env)) return null;
  // Guard: the taxonomy must be loadable before we spend a call.
  if (!getTaxonomy().cuisines.length) return null;
  const run = opts.run ?? runViaRouter;
  let answer: ConceptLlmAnswer | null = null;
  try {
    answer = await run(conceptClassifierPrompt(), JSON.stringify({ business_type: typed.slice(0, 200) }));
  } catch {
    return null;
  }
  return resolutionFromLlmAnswer(answer);
}
