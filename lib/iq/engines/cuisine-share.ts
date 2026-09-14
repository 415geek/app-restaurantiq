/**
 * Demand share of the concept (研发提示词 §2.3 + 评审 Spec §4.1 step 4).
 *
 * Not hand-picked: derived from the supply mix in the trade area (Overture +
 * Google), weighting each open POI by its Google review count when known
 * (supply share ≈ demand share, self-calibrating), Laplace-smoothed.
 *
 *   audience 'chinese' (中餐)          — share of Chinese-restaurant spend going to
 *     the sub-cuisine: over the Chinese POI pool. `computeCuisineShare`, unchanged
 *     since Phase 2 (the Millbrae numbers depend on it byte for byte).
 *   audience 'general' (烘焙 / 饮品 / 西餐 / 其他亚洲餐) — share of ALL restaurant
 *     spend: category share among every food POI × subtype share inside the
 *     category (`computeCategoryShare`), the same two-stage shape as
 *     chinese_spend × sub-cuisine share on the Chinese path.
 *
 * `computeConceptShare` dispatches on the taxonomy `audience` and tells the
 * trade-area engine which spend basis to multiply.
 */
import { CONCEPT_CATEGORIES, classifyCuisineText, cuisineById, cuisinesInCategory, findCuisine, getTaxonomy, isChineseCategory, type ConceptCategory } from '../params';
import type { MergedPoi } from './competitor';

export type DemandBasis = 'chinese_spend' | 'restaurant_spend';

export interface CuisineShareResult {
  share: number;
  method: string;
  weighted_total: number;
  n_chinese: number;
}

export interface ConceptShareResult extends CuisineShareResult {
  /** Which block-group spend the share multiplies (trade-area engine). */
  basis: DemandBasis;
  /** General-audience concepts: the two factors behind `share`. */
  category_share?: number;
  subtype_share?: number;
  n_category?: number;
  n_food?: number;
}

/**
 * Laplace pseudo-count denominator of the Chinese path: 0.5 × 14. The 14 was
 * the taxonomy size when the share was calibrated; it is a prior-strength
 * constant, not a live count, so growing the taxonomy never moves a Chinese
 * concept's numbers.
 */
export const CHINESE_PRIOR_CLASSES = 14;

const isOpen = (m: MergedPoi) => !/closed_permanently|CLOSED_PERMANENTLY/i.test(m.operating_status);

export function computeCuisineShare(merged: MergedPoi[], cuisine: string): CuisineShareResult {
  const chinese = merged.filter((m) => m.is_chinese && m.is_food && isOpen(m));
  if (chinese.length === 0) return { share: 0.08, method: '无中餐供给样本 → 先验 8%', weighted_total: 0, n_chinese: 0 };
  const hasCounts = chinese.some((m) => (m.rating_count ?? 0) > 0);
  const w = (m: MergedPoi) => (hasCounts ? Math.log(1 + (m.rating_count ?? 0)) + 0.5 : 1);
  const total = chinese.reduce((s, m) => s + w(m), 0);
  const mine = chinese.filter((m) => (m.sub_cuisine ?? 'other_chinese') === cuisine).reduce((s, m) => s + w(m), 0);
  // Laplace smoothing so a cuisine absent from local supply still gets a floor
  // (destination cuisines draw from beyond the trade area); cap so a single
  // dominant cuisine cannot claim the whole pool.
  const raw = (mine + 0.5) / (total + 0.5 * CHINESE_PRIOR_CLASSES);
  const share = Math.max(0.03, Math.min(0.5, raw));
  return {
    share: Math.round(share * 1000) / 1000,
    method: hasCounts ? '供给份额 ≈ 需求份额：按评论数 log 权重（D5+D6），Laplace 平滑，[3%,50%] 截断' : '供给份额 ≈ 需求份额：按门店数（无评论数），Laplace 平滑',
    weighted_total: Math.round(total * 100) / 100,
    n_chinese: chinese.length,
  };
}

/* ------------------------------------------------------------------ */
/* POI → concept category (general-audience path)                        */
/* ------------------------------------------------------------------ */

/** Google / Overture types too generic to identify a category. */
const GENERIC_TYPES = new Set(['restaurant', 'food', 'point_of_interest', 'establishment', 'store', 'meal_takeaway', 'meal_delivery', 'bar', 'eatery', 'diner_restaurant']);
/** Types shared by several categories where one reading is clearly the common case. */
const TYPE_CATEGORY_OVERRIDES: Record<string, ConceptCategory> = { cafe: 'beverage', coffee_shop: 'beverage', tea_house: 'beverage', bakery: 'bakery_dessert', dessert_shop: 'bakery_dessert', dessert_restaurant: 'bakery_dessert' };

type TypeIndex = { toId: Map<string, string>; toCategory: Map<string, ConceptCategory> };
let typeIndexCache: { taxonomy: unknown; index: TypeIndex } | null = null;

/**
 * Type → subtype id when the type belongs to exactly one entry (ice_cream_shop
 * → ice_cream, japanese_restaurant → japanese); type → category when every
 * entry sharing it sits in one category (bakery → bakery_dessert). Built from
 * `mappings` ∪ `search.types` of the whole taxonomy, memoized per taxonomy.
 */
function typeIndex(): TypeIndex {
  const t = getTaxonomy();
  if (typeIndexCache && typeIndexCache.taxonomy === t) return typeIndexCache.index;
  const owners = new Map<string, Array<{ id: string; category: ConceptCategory }>>();
  for (const c of t.cuisines) {
    for (const ty of [...c.mappings, ...(c.search?.types ?? [])]) {
      const k = ty.toLowerCase();
      if (GENERIC_TYPES.has(k)) continue;
      const list = owners.get(k) ?? [];
      if (!list.some((o) => o.id === c.id)) list.push({ id: c.id, category: c.category });
      owners.set(k, list);
    }
  }
  const toId = new Map<string, string>();
  const toCategory = new Map<string, ConceptCategory>();
  for (const [ty, list] of owners) {
    if (list.length === 1) toId.set(ty, list[0].id);
    const cats = new Set(list.map((o) => o.category));
    if (cats.size === 1) toCategory.set(ty, list[0].category);
  }
  for (const [ty, cat] of Object.entries(TYPE_CATEGORY_OVERRIDES)) toCategory.set(ty, cat);
  const index = { toId, toCategory };
  typeIndexCache = { taxonomy: t, index };
  return index;
}

export interface PoiConcept {
  /** Taxonomy id when a subtype could be told apart; null for "some food place of that category". */
  id: string | null;
  category: ConceptCategory;
  method: 'sub_cuisine' | 'type' | 'keyword' | 'unknown_food';
}

/**
 * Which concept (subtype + category) a food POI belongs to, for the
 * general-audience share. Chinese-pool POIs keep the engine's sub_cuisine
 * (so a boba shop reads as beverage, a Hunan place as chinese_regional); other
 * POIs are read from their Google / Overture types, then name keywords over
 * every category; unknown food POIs are `western_other` (American / generic
 * eateries dominate that residue).
 */
export function conceptOfPoi(poi: Pick<MergedPoi, 'name' | 'name_zh' | 'categories' | 'primary_category' | 'is_chinese' | 'sub_cuisine'>): PoiConcept {
  if (poi.is_chinese) {
    const c = cuisineById(poi.sub_cuisine ?? 'other_chinese');
    return { id: c.id, category: c.category, method: 'sub_cuisine' };
  }
  const idx = typeIndex();
  const types = [poi.primary_category ?? '', ...poi.categories].filter(Boolean).map((x) => x.toLowerCase());
  for (const ty of types) {
    const id = idx.toId.get(ty);
    if (id) return { id, category: cuisineById(id).category, method: 'type' };
  }
  const kw = classifyCuisineText(`${poi.name} ${poi.name_zh ?? ''}`, { scope: 'all' });
  if (kw.matched) {
    const c = cuisineById(kw.id);
    // A Chinese keyword on a POI the engine did not call Chinese is noise (e.g. "Wok" in a Thai name); keep it in its own category only when non-Chinese.
    if (!isChineseCategory(c.category)) return { id: c.id, category: c.category, method: 'keyword' };
  }
  for (const ty of types) {
    const cat = idx.toCategory.get(ty);
    if (cat) return { id: null, category: cat, method: 'type' };
  }
  return { id: null, category: 'western_other', method: 'unknown_food' };
}

export function conceptCategoryOfPoi(poi: Parameters<typeof conceptOfPoi>[0]): ConceptCategory {
  return conceptOfPoi(poi).category;
}

/**
 * General-audience share: category share among all open food POIs × subtype
 * share inside the category, both review-weighted and Laplace-smoothed with the
 * number of categories / subtypes as pseudo-classes, each clamped so a thin
 * sample never zeroes or monopolises the pool.
 */
export function computeCategoryShare(merged: MergedPoi[], cuisine: string): ConceptShareResult {
  const cu = findCuisine(cuisine) ?? cuisineById(cuisine);
  const food = merged.filter((m) => m.is_food && isOpen(m));
  const basis: DemandBasis = 'restaurant_spend';
  if (food.length === 0) return { share: 0.03, method: '无餐饮供给样本 → 先验 3%', weighted_total: 0, n_chinese: 0, basis, n_food: 0, n_category: 0 };
  const hasCounts = food.some((m) => (m.rating_count ?? 0) > 0);
  const w = (m: MergedPoi) => (hasCounts ? Math.log(1 + (m.rating_count ?? 0)) + 0.5 : 1);
  const concepts = food.map((m) => ({ m, c: conceptOfPoi(m) }));
  const total = food.reduce((s, m) => s + w(m), 0);
  const inCat = concepts.filter((x) => x.c.category === cu.category);
  const catWeight = inCat.reduce((s, x) => s + w(x.m), 0);
  const nSub = Math.max(1, cuisinesInCategory(cu.category).length);
  const mine = inCat.filter((x) => x.c.id === cu.id).reduce((s, x) => s + w(x.m), 0);
  const categoryShare = Math.max(0.02, Math.min(0.7, (catWeight + 0.5) / (total + 0.5 * CONCEPT_CATEGORIES.length)));
  const subtypeShare = Math.max(0.05, Math.min(0.6, (mine + 0.5) / (catWeight + 0.5 * nSub)));
  const share = categoryShare * subtypeShare;
  return {
    share: Math.round(share * 10000) / 10000,
    method: hasCounts
      ? `供给份额 ≈ 需求份额（大众客群）：品类份额 ${(categoryShare * 100).toFixed(1)}% × 品类内业态份额 ${(subtypeShare * 100).toFixed(1)}%，按评论数 log 权重（D5+D6），Laplace 平滑`
      : `供给份额 ≈ 需求份额（大众客群）：品类份额 ${(categoryShare * 100).toFixed(1)}% × 品类内业态份额 ${(subtypeShare * 100).toFixed(1)}%，按门店数（无评论数），Laplace 平滑`,
    weighted_total: Math.round(total * 100) / 100,
    n_chinese: food.filter((m) => m.is_chinese).length,
    basis,
    category_share: Math.round(categoryShare * 1000) / 1000,
    subtype_share: Math.round(subtypeShare * 1000) / 1000,
    n_category: inCat.length,
    n_food: food.length,
  };
}

/** Share + spend basis for any concept: Chinese audience → sub-cuisine share of Chinese spend; general → category share of all restaurant spend. */
export function computeConceptShare(merged: MergedPoi[], cuisine: string): ConceptShareResult {
  const cu = cuisineById(cuisine);
  if (cu.audience === 'general') return computeCategoryShare(merged, cuisine);
  return { ...computeCuisineShare(merged, cuisine), basis: 'chinese_spend' };
}
