/**
 * D12 · User inputs. Pure normalization of the form payload into `SiteInput`.
 * Nothing is defaulted or estimated: an absent / unparseable / non-positive
 * value becomes `null`, and the coverage_note lists what was and wasn't given
 * so the report can hide dependent sections (e.g. "缺 CapEx → 回收期隐藏").
 */
import { toLocale } from '@/lib/i18n/locale';
import { classifyConceptSync } from '@/lib/iq/concept/classify';
import { classifyCuisineText, findCuisine } from '@/lib/iq/params';
import type { DataResult, SiteInput } from './types';
import { DATA_SOURCE_NAMES } from './types';

export const USER_INPUTS_SOURCE_ID = 'D12' as const;

/**
 * Loose form payload. Structurally a superset of `Partial<SiteInput>` (every
 * numeric field widened to `unknown` so "$12,000" / "25%" strings typecheck).
 */
export type RawSiteInput = {
  report_id: string;
  address: string;
  cuisine?: string | null;
  cuisine_text?: string | null;
  /** Taxonomy id the customer confirmed in the concept picker (评审 Spec §4.1 step 3); wins over the free text. */
  concept_id?: string | null;
  language?: string | null;
  listing_urls?: unknown;
  existing_stores?: unknown;
  /** Competitor names the user typed: string[] or one "a, b\nc" string. */
  known_competitors?: unknown;
  /** Form fields may arrive as strings ("$12,000", "25%"). */
  rent_usd?: unknown;
  sqft?: unknown;
  seats?: unknown;
  capex_usd?: unknown;
  ticket_in?: unknown;
  ticket_delivery?: unknown;
  delivery_ratio?: unknown;
  parking_spaces?: unknown;
};

/** "$12,000" → 12000; "" / "abc" / ≤ 0 → null. */
export function coercePositiveNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '').replace(/%$/, '');
    if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** 25 / "25%" / 0.25 → 0.25. Values > 100 or ≤ 0 → null. Exactly 1 is read as 100% (ratio form). */
export function coerceRatio(v: unknown): number | null {
  const n = coercePositiveNumber(v);
  if (n == null) return null;
  const ratio = n > 1 ? n / 100 : n;
  if (ratio > 1) return null;
  return Math.round(ratio * 10_000) / 10_000;
}

function coerceListingUrls(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!/^https?:\/\/\S+$/i.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function coerceExistingStores(v: unknown): SiteInput['existing_stores'] {
  if (!Array.isArray(v)) return [];
  const out: SiteInput['existing_stores'] = [];
  for (const item of v) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ address: item.trim() });
      continue;
    }
    if (item && typeof item === 'object' && typeof (item as { address?: unknown }).address === 'string') {
      const o = item as { address: string; lat?: unknown; lng?: unknown };
      const address = o.address.trim();
      if (!address) continue;
      const store: SiteInput['existing_stores'][number] = { address };
      if (typeof o.lat === 'number' && typeof o.lng === 'number' && Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
        store.lat = o.lat;
        store.lng = o.lng;
      }
      out.push(store);
    }
  }
  return out;
}

export const KNOWN_COMPETITORS_MAX = 10;
const KNOWN_COMPETITOR_NAME_MAX_CHARS = 80;

/**
 * "Hunan Home, 湘水缘\nGolden Dragon" | string[] → ≤ 10 trimmed, de-duplicated
 * (case-insensitive) names. Empty / non-string items are dropped.
 */
export function coerceKnownCompetitors(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n\r,，;；]+/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const s = item.trim().slice(0, KNOWN_COMPETITOR_NAME_MAX_CHARS).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= KNOWN_COMPETITORS_MAX) break;
  }
  return out;
}

export interface CuisineResolution {
  id: string;
  /** Lineage note for the D12 coverage note (Chinese engine string; rendered through plain.ts). */
  how: string;
  /** False when the concept was neither confirmed by the customer nor matched by the dictionary — the report then runs on other_chinese and declares it. */
  confirmed: boolean;
}

/**
 * Concept resolution (§4.1 step 4): the picker's `concept_id` wins; otherwise the
 * typed business type goes through the dictionary classifier over every
 * category; a legacy `cuisine` value may be a taxonomy id or free text. Nothing
 * falls silently into other_chinese: an unresolved concept keeps that id (the
 * engines need a valid one) but is recorded as 未确认 so the pipeline can flag it.
 */
export function resolveCuisine(raw: RawSiteInput): CuisineResolution {
  const picked = findCuisine((raw.concept_id ?? '').trim());
  if (picked) return { id: picked.id, how: `用户确认业态 ${picked.id}（${picked.label_zh}）`, confirmed: true };
  const text = (raw.cuisine_text ?? '').trim();
  const id = (raw.cuisine ?? '').trim();
  if (text) {
    const c = classifyConceptSync(text);
    if (!c.needs_confirmation) return { id: c.id, how: `文本 "${text}" → ${c.id}（匹配 "${c.matched}"）`, confirmed: true };
    return { id: 'other_chinese', how: `文本 "${text}" 未确认 → other_chinese`, confirmed: false };
  }
  if (findCuisine(id)) return { id, how: `taxonomy id ${id}`, confirmed: true };
  if (id) {
    const c = classifyCuisineText(id, { scope: 'all' });
    if (c.matched) return { id: c.id, how: `"${id}" → ${c.id}（匹配 "${c.matched}"）`, confirmed: true };
    return { id: 'other_chinese', how: `"${id}" 未确认 → other_chinese`, confirmed: false };
  }
  return { id: 'other_chinese', how: '未提供业态 未确认 → other_chinese', confirmed: false };
}

const FIELD_LABELS: Array<[keyof SiteInput, string]> = [
  ['rent_usd', '月租'],
  ['sqft', '面积'],
  ['seats', '座位数'],
  ['capex_usd', 'CapEx'],
  ['ticket_in', '堂食客单价'],
  ['ticket_delivery', '外卖客单价'],
  ['delivery_ratio', '外卖占比'],
  ['parking_spaces', '车位数'],
];

export function normalizeUserInputs(raw: RawSiteInput): { input: SiteInput; result: DataResult<SiteInput>; concept: CuisineResolution } {
  const language: SiteInput['language'] = toLocale(raw.language);
  const cuisine = resolveCuisine(raw);
  const input: SiteInput = {
    report_id: String(raw.report_id ?? '').trim(),
    address: String(raw.address ?? '').trim(),
    cuisine: cuisine.id,
    language,
    rent_usd: coercePositiveNumber(raw.rent_usd),
    sqft: coercePositiveNumber(raw.sqft),
    seats: coercePositiveNumber(raw.seats),
    capex_usd: coercePositiveNumber(raw.capex_usd),
    ticket_in: coercePositiveNumber(raw.ticket_in),
    ticket_delivery: coercePositiveNumber(raw.ticket_delivery),
    delivery_ratio: coerceRatio(raw.delivery_ratio),
    parking_spaces: coercePositiveNumber(raw.parking_spaces),
    existing_stores: coerceExistingStores(raw.existing_stores),
    listing_urls: coerceListingUrls(raw.listing_urls),
    known_competitors: coerceKnownCompetitors(raw.known_competitors),
  };

  const provided = FIELD_LABELS.filter(([k]) => input[k] != null).map(([, label]) => label);
  const missing = FIELD_LABELS.filter(([k]) => input[k] == null).map(([, label]) => label);
  const parts = [
    `已提供：${provided.length ? provided.join('、') : '无'}`,
    `缺失：${missing.length ? missing.join('、') : '无'}`,
    `业态：${cuisine.how}`,
  ];
  if (input.listing_urls.length) parts.push(`挂牌链接 ${input.listing_urls.length} 条`);
  if (input.existing_stores.length) parts.push(`现有门店 ${input.existing_stores.length} 家`);
  if (input.known_competitors.length) parts.push(`用户指定竞品 ${input.known_competitors.length} 家`);
  if (input.capex_usd == null) parts.push('缺 CapEx → 回收期隐藏');
  if (input.rent_usd == null || input.sqft == null) parts.push('缺租金或面积 → 标的 $/SF 与租金溢价不计算');

  const result: DataResult<SiteInput> = {
    id: USER_INPUTS_SOURCE_ID,
    name: DATA_SOURCE_NAMES.D12,
    status: 'ok',
    data: input,
    source: 'User form input',
    fetched_at: new Date().toISOString(),
    license: 'User-provided',
    cost_usd: 0,
    coverage_note: parts.join('；'),
    cache: 'none',
  };
  return { input, result, concept: cuisine };
}
