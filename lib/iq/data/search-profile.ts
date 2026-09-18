/**
 * §4.2 concept search profile — what the three-layer competitor retrieval
 * searches for and how a returned record is recognised as a Layer-1 hit.
 *
 *   Layer 1 直接竞品  concept.search.keywords / .types  (Text Search 800 m → 1600 m)
 *   Layer 2 替代竞品  concept.search.substitutes         (same category, other subtypes, 1600 m)
 *   Layer 3 品牌锚点  Layer-1 query city-wide (8 km bias), ≥ 500 reviews, top 5
 *
 * Shared by the D6 fetcher (tier 2 has no Overture / LLM) and the
 * CompetitorEngine (360°) so both tiers apply one rule: a record from a
 * Layer-1 query counts as Layer 1 only when its name carries a Layer-1 keyword
 * or its Places types carry a non-generic concept type. Falls back to the
 * legacy `keywords` + `mappings` fields while the taxonomy `search` block is
 * still being filled in.
 */
import { classifyCuisineText, cuisineById, getTaxonomy, type Audience, type ConceptCategory, type CuisineDef } from '../params';

export const CHINESE_CATEGORIES: ReadonlySet<string> = new Set<ConceptCategory>(['chinese_regional', 'chinese_format']);

export function isChineseCategory(category: string | null | undefined): boolean {
  return category == null ? true : CHINESE_CATEGORIES.has(category);
}

/** Types every restaurant carries — never enough on their own to call a record Layer 1. */
export const GENERIC_PLACE_TYPES: ReadonlySet<string> = new Set(['restaurant', 'chinese_restaurant', 'food', 'point_of_interest', 'establishment', 'meal_takeaway', 'meal_delivery', 'store', 'food_store']);

/** Places (New) Table A food & drink types the plan may pass as includedTypes (anything else → INVALID_ARGUMENT). */
export const TABLE_A_FOOD_TYPES: ReadonlySet<string> = new Set([
  'acai_shop', 'afghani_restaurant', 'african_restaurant', 'american_restaurant', 'asian_restaurant', 'bagel_shop', 'bakery', 'bar', 'bar_and_grill', 'barbecue_restaurant',
  'brazilian_restaurant', 'breakfast_restaurant', 'brunch_restaurant', 'buffet_restaurant', 'cafe', 'cafeteria', 'candy_store', 'cat_cafe', 'chinese_restaurant', 'chocolate_factory',
  'chocolate_shop', 'coffee_shop', 'confectionery', 'deli', 'dessert_restaurant', 'dessert_shop', 'diner', 'dog_cafe', 'donut_shop', 'fast_food_restaurant', 'fine_dining_restaurant',
  'food_court', 'french_restaurant', 'greek_restaurant', 'hamburger_restaurant', 'ice_cream_shop', 'indian_restaurant', 'indonesian_restaurant', 'italian_restaurant', 'japanese_restaurant',
  'juice_shop', 'korean_restaurant', 'lebanese_restaurant', 'meal_delivery', 'meal_takeaway', 'mediterranean_restaurant', 'mexican_restaurant', 'middle_eastern_restaurant', 'pizza_restaurant',
  'pub', 'ramen_restaurant', 'restaurant', 'sandwich_shop', 'seafood_restaurant', 'spanish_restaurant', 'steak_house', 'sushi_restaurant', 'tea_house', 'thai_restaurant', 'turkish_restaurant',
  'vegan_restaurant', 'vegetarian_restaurant', 'vietnamese_restaurant', 'wine_bar',
]);

/** Free-text substitute words → Table A type (lower-cased, punctuation-insensitive). */
const SUBSTITUTE_ALIASES: Record<string, string> = {
  dessert: 'dessert_shop', desserts: 'dessert_shop', 甜品: 'dessert_shop', bakery: 'bakery', 面包店: 'bakery', 烘焙: 'bakery', 'pastry shop': 'bakery', pastry: 'bakery', 'cake shop': 'bakery', cake: 'bakery',
  coffee: 'coffee_shop', 咖啡: 'coffee_shop', cafe: 'cafe', café: 'cafe',
  tea: 'tea_house', 茶: 'tea_house', 'ice cream': 'ice_cream_shop', 冰淇淋: 'ice_cream_shop', juice: 'juice_shop', donut: 'donut_shop', donuts: 'donut_shop', bagel: 'bagel_shop', deli: 'deli',
  chinese: 'chinese_restaurant', 中餐: 'chinese_restaurant', japanese: 'japanese_restaurant', korean: 'korean_restaurant', vietnamese: 'vietnamese_restaurant', thai: 'thai_restaurant', indian: 'indian_restaurant',
  mexican: 'mexican_restaurant', italian: 'italian_restaurant', american: 'american_restaurant', french: 'french_restaurant', mediterranean: 'mediterranean_restaurant', asian: 'asian_restaurant',
  ramen: 'ramen_restaurant', sushi: 'sushi_restaurant', pizza: 'pizza_restaurant', sandwich: 'sandwich_shop', sandwiches: 'sandwich_shop', burger: 'hamburger_restaurant', hamburger: 'hamburger_restaurant',
  'fast food': 'fast_food_restaurant', breakfast: 'breakfast_restaurant', brunch: 'brunch_restaurant', seafood: 'seafood_restaurant', steak: 'steak_house', bbq: 'barbecue_restaurant', barbecue: 'barbecue_restaurant',
  vegan: 'vegan_restaurant', vegetarian: 'vegetarian_restaurant', bar: 'bar', pub: 'pub', restaurant: 'restaurant', diner: 'diner', buffet: 'buffet_restaurant', 'fine dining': 'fine_dining_restaurant',
};

/** Map a substitute term to a Table A type, or null when it must stay a free-text Text Search. */
export function toTableAType(term: string): string | null {
  const t = term.trim().toLowerCase();
  if (!t) return null;
  if (TABLE_A_FOOD_TYPES.has(t)) return t;
  const snake = t.replace(/[\s-]+/g, '_');
  if (TABLE_A_FOOD_TYPES.has(snake)) return snake;
  return SUBSTITUTE_ALIASES[t] ?? null;
}

export interface ConceptSearchProfile {
  id: string;
  category: ConceptCategory;
  audience: Audience;
  label_en: string;
  label_zh: string;
  /** Layer-1 Text Search query (the first of `queries`); kept for callers that want one string. */
  query: string;
  /** 底层重构 §3.2: the multilingual alias set Layer 1 searches, best first. */
  queries: string[];
  /** Every Layer-1 keyword (search.keywords ∪ keywords), for name matching. */
  keywords: string[];
  /** Layer-1 Table A types (Text Search `includedType` when exactly one). */
  types: string[];
  /** Non-generic types whose presence on a record is a Layer-1 match (search.types ∪ mappings − generic). */
  match_types: string[];
  /** Layer-2 substitutes that map to Table A types (one Nearby call). */
  substitute_types: string[];
  /** Layer-2 substitutes that stay free text (one Text Search on the first). */
  substitute_terms: string[];
  /** Other taxonomy ids in the same category (a classified record with one of these is Layer 2). */
  sibling_ids: string[];
  /** Where the profile came from (taxonomy `search` block, legacy fields, or a free-text concept the taxonomy does not know). */
  origin: 'search' | 'legacy' | 'text';
}

function latinQueryWord(keywords: string[], fallback: string): string {
  const hit = keywords.find((k) => /[a-z]{3,}/i.test(k));
  return (hit ?? fallback).trim();
}

/** 底层重构 §3.2: how many aliases Layer 1 searches for. */
export const L1_QUERY_ALIASES = 3;

/**
 * 底层重构 §3.2 step 1 — the multilingual alias set Layer 1 searches, best first.
 *
 * Text Search matches what a business is *called*, not what it sells, and it does
 * so per language. Measured at 900 Grant Ave, San Francisco with an 800 m bias:
 * "egg tart" returned 1 result and not the shop everyone means, while "蛋挞"
 * returned 11 with Golden Gate Bakery ranked first. Searching one Latin keyword
 * is what made the most famous egg tart shop in the city invisible to a report
 * about egg tarts, so both scripts go in, CJK first for a Chinese-audience
 * concept. The category term ("Chinese bakery") is the third net: it catches
 * shops whose name says neither.
 */
export function conceptQueries(c: Pick<CuisineDef, 'keywords' | 'label_en' | 'label_zh' | 'search' | 'audience'>): string[] {
  const kws = [...new Set([...(c.search?.keywords ?? []), ...c.keywords].map((k) => k.trim()).filter(Boolean))];
  const cjk = kws.filter((k) => /[一-鿿]/.test(k));
  const latin = kws.filter((k) => /[a-z]{3,}/i.test(k));
  const preferCjk = c.audience === 'chinese';
  const ordered = preferCjk ? [...cjk, ...latin] : [...latin, ...cjk];
  // A general-audience concept in a Chinese trade area still needs its CJK alias,
  // so always keep the best of each script before falling back to the rest.
  const seeded = [...new Set([ordered[0], preferCjk ? latin[0] : cjk[0], ...ordered].filter((x): x is string => Boolean(x)))];
  return seeded.length ? seeded.slice(0, L1_QUERY_ALIASES) : [latinQueryWord(kws, c.label_en)];
}

/** Build the profile for a taxonomy entry (id or definition). */
export function conceptSearchProfile(idOrDef: string | CuisineDef): ConceptSearchProfile {
  const c = typeof idOrDef === 'string' ? cuisineById(idOrDef) : idOrDef;
  const t = getTaxonomy();
  const chinese = isChineseCategory(c.category);
  const s = c.search;
  const keywords = [...new Set([...(s?.keywords ?? []), ...c.keywords].map((k) => k.trim()).filter(Boolean))];
  const rawTypes = s?.types?.length ? s.types : chinese ? ['chinese_restaurant'] : ['restaurant'];
  const types = [...new Set(rawTypes.map((x) => x.toLowerCase()).filter((x) => TABLE_A_FOOD_TYPES.has(x)))];
  const match_types = [...new Set([...rawTypes, ...c.mappings].map((x) => x.toLowerCase()).filter((x) => x && !GENERIC_PLACE_TYPES.has(x)))];
  const substitutes = s ? s.substitutes : chinese ? ['chinese'] : [];
  const substitute_types: string[] = [];
  const substitute_terms: string[] = [];
  for (const sub of substitutes) {
    const term = sub.trim();
    if (!term) continue;
    // 1) a Table A type by name / alias; 2) a taxonomy concept whose own search types are Table A
    //    ("Sichuan" → chinese_restaurant, "coffee" → coffee_shop); 3) otherwise a free-text Text Search.
    let tys: string[] = [];
    const direct = toTableAType(term);
    if (direct) tys = [direct];
    else {
      const hit = classifyCuisineText(term);
      // Layer 2 = same category, other subtype: only a sibling concept's types qualify. A keyword hit in another
      // family ("港式面包" → hk_cafe via 港式, "Korean BBQ" → korean) must not import that family's types.
      const sameFamily = (a: ConceptCategory, b: ConceptCategory) => a === b || (isChineseCategory(a) && isChineseCategory(b));
      if (hit.matched && hit.id !== c.id) {
        const def = cuisineById(hit.id);
        if (sameFamily(def.category, c.category)) {
          const own = def.search?.types?.length ? def.search.types : isChineseCategory(def.category) ? ['chinese_restaurant'] : [];
          tys = own.map((x) => x.toLowerCase()).filter((x) => TABLE_A_FOOD_TYPES.has(x));
        }
      }
    }
    if (tys.length) {
      for (const ty of tys) if (!substitute_types.includes(ty)) substitute_types.push(ty);
    } else substitute_terms.push(term);
  }
  // Same-category siblings: for Chinese concepts every other Chinese entry (other_chinese included, it is the L2 bucket).
  const sibling_ids = t.cuisines.filter((x) => x.id !== c.id && (chinese ? isChineseCategory(x.category) : x.category === c.category)).map((x) => x.id);
  return {
    id: c.id,
    category: c.category,
    audience: c.audience,
    label_en: c.label_en,
    label_zh: c.label_zh,
    query: conceptQueries(c)[0],
    queries: conceptQueries(c),
    keywords,
    types: types.length ? types : chinese ? ['chinese_restaurant'] : ['restaurant'],
    match_types,
    substitute_types,
    substitute_terms,
    sibling_ids,
    origin: s ? 'search' : 'legacy',
  };
}

/** A concept the taxonomy does not know (tier 2 free text such as "Italian trattoria"): search the text itself. */
export function textSearchProfile(text: string): ConceptSearchProfile {
  const q = text.trim().replace(/\s+/g, ' ');
  const words = q.toLowerCase().split(' ').filter((w) => w.length >= 3 && !/^(restaurant|shop|store|cafe|near|the|and)$/.test(w));
  const ty = words.map(toTableAType).find((x): x is string => x != null);
  return {
    id: 'text',
    category: 'western_other',
    audience: 'general',
    label_en: q,
    label_zh: q,
    query: q || 'restaurant',
    queries: [q || 'restaurant'],
    keywords: [q, ...words],
    types: [ty ?? 'restaurant'],
    match_types: ty && !GENERIC_PLACE_TYPES.has(ty) ? [ty] : [],
    substitute_types: [],
    substitute_terms: [],
    sibling_ids: [],
    origin: 'text',
  };
}

const CJK_RE = /[㐀-鿿]/;

/** Name carries one of the keywords (word-bounded for Latin, substring for CJK; single CJK chars need CJK context). */
export function nameMatchesKeywords(name: string, keywords: string[]): boolean {
  const hay = name.toLowerCase();
  if (!hay) return false;
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    if (CJK_RE.test(k)) {
      if (k.length === 1 ? hay.includes(k) && CJK_RE.test(hay) : hay.includes(k)) return true;
      continue;
    }
    if (k.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(hay)) return true;
  }
  return false;
}

/** How much text a §4.2 also-selling quote may carry (characters). */
export const KEYWORD_QUOTE_MAX = 120;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * §4.2 品类空白判定 text probe: does this free text (a review, an editorial
 * summary or a menu blob) carry one of the concept's Layer-1 keywords, and what
 * did it say? Same matching rule as `nameMatchesKeywords` (word-bounded for
 * Latin, substring for CJK, single CJK characters need CJK context) so a store
 * is never called "also selling" on weaker evidence than a name would need.
 *
 * Returns the quoted snippet around the first hit, or null when the text does
 * not mention the concept. A caller that gets `null` for *every* text of a store
 * knows the store does not mention it; a store with no text at all is `unknown`
 * and must never be counted as "does not sell it".
 */
export function findKeywordQuote(text: string | null | undefined, keywords: string[]): string | null {
  const raw = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const hay = raw.toLowerCase();
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    let at = -1;
    if (CJK_RE.test(k)) {
      if (k.length === 1 && !CJK_RE.test(hay)) continue;
      at = hay.indexOf(k);
    } else {
      if (k.length < 3) continue;
      const m = new RegExp(`(^|[^a-z0-9])${escapeRe(k)}([^a-z0-9]|$)`, 'i').exec(hay);
      at = m ? m.index + m[1].length : -1;
    }
    if (at < 0) continue;
    if (raw.length <= KEYWORD_QUOTE_MAX) return raw;
    const pad = Math.max(0, Math.floor((KEYWORD_QUOTE_MAX - k.length) / 2));
    const start = Math.max(0, at - pad);
    const end = Math.min(raw.length, start + KEYWORD_QUOTE_MAX);
    return `${start > 0 ? '…' : ''}${raw.slice(start, end).trim()}${end < raw.length ? '…' : ''}`;
  }
  return null;
}

export function typesMatch(types: Array<string | null | undefined>, wanted: string[]): boolean {
  if (!wanted.length) return false;
  const set = new Set(wanted.map((w) => w.toLowerCase()));
  return types.some((t) => t != null && set.has(t.toLowerCase()));
}

/** §4.2 Layer-1 recognition for a record returned by a Layer-1 query. */
export function matchesLayer1(name: string, types: Array<string | null | undefined>, p: ConceptSearchProfile): boolean {
  return nameMatchesKeywords(name, p.keywords) || typesMatch(types, p.match_types);
}
