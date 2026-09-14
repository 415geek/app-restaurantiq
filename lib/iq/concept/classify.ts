/**
 * Concept classifier (评审 Spec §4.1).
 *
 * Every user-typed business type lands on ONE explicit taxonomy entry with a
 * top-level concept category; when the dictionary cannot decide, an LLM pass
 * (temperature 0, JSON) is tried, and when that is still not confident the
 * caller must ask the user to pick — never a silent default bucket.
 *
 * Contract used by /api/funnel/analyze and the result page:
 *   classifyConceptSync(text)        → dictionary layer only (sync, no I/O)
 *   classifyConcept(text)            → ConceptResolution (may need confirmation)
 *   resolveConcept({ text, conceptId }) → the entry the report must use
 */
import type { Locale } from '@/lib/i18n/locale';
import { CONCEPT_CATEGORIES, classifyCuisineText, cuisineById, findCuisine, getTaxonomy, type ConceptCategory, type CuisineDef } from '@/lib/iq/params';
import { CONCEPT_CATEGORY_LABELS, CONCEPT_CATEGORY_ORDER, conceptCategoryLabel, conceptOptionLabel, type ConceptOption } from './labels';

export { CONCEPT_CATEGORY_LABELS, CONCEPT_CATEGORY_ORDER, conceptCategoryLabel, conceptOptionLabel };
export type { ConceptOption };

export const CONCEPT_CONFIDENCE_THRESHOLD = 0.8;

export interface ConceptResolution {
  /** Taxonomy id (`cuisineById(id)`), e.g. `egg_tart`, `hunan`, `boba`. */
  id: string;
  category: ConceptCategory;
  label_zh: string;
  label_en: string;
  label_es: string;
  /** 0–1. Dictionary hits are 1; LLM hits carry the model's confidence; user picks are 1. */
  confidence: number;
  method: 'dictionary' | 'llm' | 'user' | 'none';
  /** True when the UI must show the category picker before analysis proceeds. */
  needs_confirmation: boolean;
  /** Choices for the picker (all taxonomy entries, grouped by category on the client). */
  options: ConceptOption[];
  /** What the classifier matched on, for the data-lineage note. */
  matched: string | null;
}

export function conceptOptions(): ConceptOption[] {
  const order = new Map(CONCEPT_CATEGORY_ORDER.map((c, i) => [c, i]));
  return getTaxonomy()
    .cuisines.map((c, i) => ({ opt: toOption(c), i }))
    .sort((a, b) => (order.get(a.opt.category) ?? 99) - (order.get(b.opt.category) ?? 99) || a.i - b.i)
    .map((x) => x.opt);
}

export function toOption(c: CuisineDef): ConceptOption {
  return { id: c.id, category: c.category, label_zh: c.label_zh, label_en: c.label_en, label_es: c.label_es ?? c.label_en };
}

export function isConceptCategory(v: unknown): v is ConceptCategory {
  return typeof v === 'string' && (CONCEPT_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Dictionary layer only (synchronous). The keyword matcher runs over every
 * category; `other_chinese` has no keywords of its own, so a miss is a miss —
 * the caller escalates (LLM → picker) instead of accepting the bucket. The
 * unresolved result still carries `other_chinese` as a valid id for callers
 * that must proceed anyway (they record that it was not confirmed).
 */
export function classifyConceptSync(text: string): ConceptResolution {
  const trimmed = (text ?? '').trim();
  const hit = trimmed ? classifyCuisineText(trimmed, { scope: 'all' }) : { id: 'other_chinese', matched: null };
  const options = conceptOptions();
  if (hit.matched && hit.id !== 'other_chinese') {
    const c = cuisineById(hit.id);
    return { ...toOption(c), confidence: 1, method: 'dictionary', needs_confirmation: false, options, matched: hit.matched };
  }
  const fallback = cuisineById('other_chinese');
  return { ...toOption(fallback), confidence: 0, method: 'none', needs_confirmation: true, options, matched: null };
}

/**
 * Full classifier: dictionary → LLM (when a provider key is configured) →
 * confirmation. The LLM layer lives in ./llm-classify.ts and returns null
 * quickly when no key exists or the answer is unusable.
 */
export async function classifyConcept(text: string, opts: { allowLlm?: boolean } = {}): Promise<ConceptResolution> {
  const sync = classifyConceptSync(text);
  if (!sync.needs_confirmation || opts.allowLlm === false) return sync;
  try {
    const mod = await import('./llm-classify');
    const llm = await mod.classifyConceptWithLlm(text);
    if (llm) return llm;
  } catch {
    /* LLM layer unavailable → confirmation */
  }
  return sync;
}

/**
 * The concept a report must use: an explicit user choice wins; otherwise the
 * classifier result (which may still need confirmation — callers decide whether
 * to block on it).
 */
export async function resolveConcept(input: { text: string; conceptId?: string | null }): Promise<ConceptResolution> {
  const c = findCuisine(input.conceptId?.trim());
  if (c) return { ...toOption(c), confidence: 1, method: 'user', needs_confirmation: false, options: conceptOptions(), matched: c.id };
  return classifyConcept(input.text);
}

/**
 * "葡挞 → 葡挞 / 蛋挞（烘焙 / 甜点）": the typed text plus the resolved taxonomy
 * label and category, for LLM prompts that only get free text today. Returns
 * the text unchanged when the dictionary cannot resolve it (never invents a
 * category for the model).
 */
export function conceptLabelForPrompt(text: string | null | undefined, lang: Locale): string {
  const typed = (text ?? '').trim();
  if (!typed) return typed;
  const r = classifyConceptSync(typed);
  if (r.needs_confirmation) return typed;
  const label = conceptOptionLabel(r, lang);
  const cat = conceptCategoryLabel(r.category, lang);
  const sep = lang === 'zh' ? '' : ' ';
  const open = lang === 'zh' ? '（' : '(';
  const close = lang === 'zh' ? '）' : ')';
  if (typed.toLowerCase() === label.toLowerCase()) return `${label}${sep}${open}${cat}${close}`;
  return `${typed} → ${label}${sep}${open}${cat}${close}`;
}
