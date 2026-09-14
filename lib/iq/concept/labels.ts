/**
 * Client-safe part of the concept classifier contract (评审 Spec §4.1): the
 * option shape the picker renders and the six category labels. No taxonomy
 * loading here — `lib/iq/params` reads YAML from disk and must stay server-side.
 */
import type { Locale } from '@/lib/i18n/locale';
import type { ConceptCategory } from '@/lib/iq/params';

export interface ConceptOption {
  id: string;
  category: ConceptCategory;
  label_zh: string;
  label_en: string;
  label_es: string;
}

export const CONCEPT_CATEGORY_LABELS: Record<ConceptCategory, { zh: string; en: string; es: string }> = {
  chinese_regional: { zh: '中餐 · 地方菜系', en: 'Chinese · regional cuisine', es: 'China · cocina regional' },
  chinese_format: { zh: '中餐 · 业态', en: 'Chinese · format', es: 'China · formato' },
  asian_other: { zh: '其他亚洲餐', en: 'Other Asian', es: 'Otra cocina asiática' },
  bakery_dessert: { zh: '烘焙 / 甜点', en: 'Bakery / dessert', es: 'Panadería / postres' },
  beverage: { zh: '饮品', en: 'Beverage', es: 'Bebidas' },
  western_other: { zh: '西餐 / 其他', en: 'Western / other', es: 'Occidental / otros' },
};

/** Display order of the categories in the picker (Chinese first: the core audience). */
export const CONCEPT_CATEGORY_ORDER: readonly ConceptCategory[] = ['chinese_regional', 'chinese_format', 'asian_other', 'bakery_dessert', 'beverage', 'western_other'];

export function conceptOptionLabel(o: Pick<ConceptOption, 'label_zh' | 'label_en' | 'label_es'>, lang: Locale): string {
  return lang === 'zh' ? o.label_zh : lang === 'es' ? o.label_es || o.label_en : o.label_en;
}

export function conceptCategoryLabel(category: ConceptCategory, lang: Locale): string {
  return CONCEPT_CATEGORY_LABELS[category][lang];
}
