/**
 * D12 · User inputs. Pure normalization of the form payload into `SiteInput`.
 * Nothing is defaulted or estimated: an absent / unparseable / non-positive
 * value becomes `null`, and the coverage_note lists what was and wasn't given
 * so the report can hide dependent sections (e.g. "缺 CapEx → 回收期隐藏").
 */
import { classifyCuisineText, getTaxonomy } from '@/lib/iq/params';
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
  language?: string | null;
  listing_urls?: unknown;
  existing_stores?: unknown;
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

function resolveCuisine(raw: RawSiteInput): { id: string; how: string } {
  const text = (raw.cuisine_text ?? '').trim();
  const id = (raw.cuisine ?? '').trim();
  if (text) {
    const c = classifyCuisineText(text);
    return { id: c.id, how: c.matched ? `文本 "${text}" → ${c.id}（匹配 "${c.matched}"）` : `文本 "${text}" 未匹配 → other_chinese` };
  }
  if (id && getTaxonomy().cuisines.some((c) => c.id === id)) return { id, how: `taxonomy id ${id}` };
  if (id) {
    const c = classifyCuisineText(id);
    return { id: c.id, how: c.matched ? `"${id}" → ${c.id}（匹配 "${c.matched}"）` : `"${id}" 未匹配 → other_chinese` };
  }
  return { id: 'other_chinese', how: '未提供菜系 → other_chinese' };
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

export function normalizeUserInputs(raw: RawSiteInput): { input: SiteInput; result: DataResult<SiteInput> } {
  const language: SiteInput['language'] = String(raw.language ?? '').trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
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
  };

  const provided = FIELD_LABELS.filter(([k]) => input[k] != null).map(([, label]) => label);
  const missing = FIELD_LABELS.filter(([k]) => input[k] == null).map(([, label]) => label);
  const parts = [
    `已提供：${provided.length ? provided.join('、') : '无'}`,
    `缺失：${missing.length ? missing.join('、') : '无'}`,
    `菜系：${cuisine.how}`,
  ];
  if (input.listing_urls.length) parts.push(`挂牌链接 ${input.listing_urls.length} 条`);
  if (input.existing_stores.length) parts.push(`现有门店 ${input.existing_stores.length} 家`);
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
  return { input, result };
}
