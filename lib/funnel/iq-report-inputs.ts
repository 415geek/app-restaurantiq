/**
 * Supplemental paid-report inputs (PaidIntakeForm → POST /api/funnel/report-inputs).
 *
 * Pure: the zod schema coerces the loose form payload ("$12,000", "25%",
 * "a, b\nc") into the canonical `market_data_json.user_inputs` shape, and
 * `mergeUserInputs` folds it into whatever is already stored (rent / sqft
 * from the free funnel) without dropping keys. The route is a thin wrapper so
 * both halves are unit-testable offline.
 *
 * Canonical keys (all optional):
 *   monthly_rent_usd, sqft, seats, ticket_in, ticket_delivery, delivery_ratio (0–1),
 *   capex_usd, parking_spaces, existing_stores[], known_competitors[], listing_urls[],
 *   dayparts[] ('breakfast' | 'lunch' | 'dinner' | 'late_night'), notes
 */
import { z } from 'zod';

/** Bodies above this are rejected before JSON parsing (light abuse guard). */
export const REPORT_INPUTS_MAX_BODY_BYTES = 20 * 1024;

export const DAYPART_IDS = ['breakfast', 'lunch', 'dinner', 'late_night'] as const;
export type DaypartId = (typeof DAYPART_IDS)[number];

const LIMITS = {
  monthly_rent_usd: 1_000_000,
  sqft: 200_000,
  seats: 2_000,
  ticket_in: 1_000,
  ticket_delivery: 1_000,
  capex_usd: 50_000_000,
  parking_spaces: 5_000,
  existing_stores: { items: 5, chars: 200 },
  known_competitors: { items: 10, chars: 80 },
  listing_urls: { items: 5, chars: 500 },
  notes: 1_000,
} as const;

/** "$12,000" / " 2,200 " / 24.5 → number; blank / non-numeric → null (never throws). */
function cleanNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[$,\s]/g, '').replace(/%$/, '');
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Positive number ≤ max, or null when absent. Out-of-range values are rejected (not clamped). */
function positiveNumber(max: number) {
  return z
    .unknown()
    .transform((v) => cleanNumber(v))
    .pipe(z.number().positive().max(max).nullable())
    .optional();
}

/** 25 / "25%" / 0.25 → 0.25; blank → null; > 100% or ≤ 0 rejected. */
const ratioField = z
  .unknown()
  .transform((v) => {
    const n = cleanNumber(v);
    if (n == null) return null;
    const ratio = n > 1 ? n / 100 : n;
    return Math.round(ratio * 10_000) / 10_000;
  })
  .pipe(z.number().positive().max(1).nullable())
  .optional();

function splitList(v: unknown, sep: RegExp): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(sep) : [];
  return list.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

/** string[] | separated string → trimmed, de-duplicated (case-insensitive), capped list. */
function stringList(sep: RegExp, limits: { items: number; chars: number }, keep: (s: string) => boolean = () => true) {
  return z
    .unknown()
    .transform((v) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const raw of splitList(v, sep)) {
        const s = raw.slice(0, limits.chars).trim();
        if (!s || !keep(s)) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
        if (out.length >= limits.items) break;
      }
      return out;
    })
    .optional();
}

const LINE_SEP = /[\n\r]+/;
const NAME_SEP = /[\n\r,，;；]+/;
const URL_SEP = /[\s,]+/;
const isHttpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

export const reportInputsSchema = z
  .object({
    monthly_rent_usd: positiveNumber(LIMITS.monthly_rent_usd),
    sqft: positiveNumber(LIMITS.sqft),
    seats: positiveNumber(LIMITS.seats),
    ticket_in: positiveNumber(LIMITS.ticket_in),
    ticket_delivery: positiveNumber(LIMITS.ticket_delivery),
    delivery_ratio: ratioField,
    capex_usd: positiveNumber(LIMITS.capex_usd),
    parking_spaces: positiveNumber(LIMITS.parking_spaces),
    existing_stores: stringList(LINE_SEP, LIMITS.existing_stores),
    known_competitors: stringList(NAME_SEP, LIMITS.known_competitors),
    listing_urls: stringList(URL_SEP, LIMITS.listing_urls, isHttpUrl),
    dayparts: z
      .unknown()
      .transform((v) => {
        const ids = new Set<string>(DAYPART_IDS);
        const out: DaypartId[] = [];
        for (const s of splitList(v, NAME_SEP)) {
          const id = s.toLowerCase();
          if (ids.has(id) && !out.includes(id as DaypartId)) out.push(id as DaypartId);
        }
        return out;
      })
      .optional(),
    notes: z
      .unknown()
      .transform((v) => (typeof v === 'string' ? v.trim().slice(0, LIMITS.notes) : ''))
      .optional(),
  })
  .strip();

export type ReportInputs = z.infer<typeof reportInputsSchema>;

export const reportInputsBodySchema = z.object({
  reportId: z.string().trim().min(1).max(64),
  inputs: reportInputsSchema,
});

export type ReportInputsBody = z.infer<typeof reportInputsBodySchema>;

/** The stored shape: numbers, string arrays and a notes string, all optional. */
export type StoredUserInputs = Record<string, unknown>;

function isProvided(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Fold validated inputs into the existing `user_inputs` object. A field the
 * user left blank (null / '' / []) never overwrites a stored value, and keys
 * this form doesn't know about are kept verbatim.
 */
export function mergeUserInputs(existing: unknown, parsed: ReportInputs): StoredUserInputs {
  const base: StoredUserInputs =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as StoredUserInputs) } : {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isProvided(value)) base[key] = value;
  }
  return base;
}

/** Merge into the whole `market_data_json` row value (keeps every other key). */
export function mergeMarketDataUserInputs(marketData: unknown, parsed: ReportInputs): { market: Record<string, unknown>; inputs: StoredUserInputs } {
  const md: Record<string, unknown> =
    marketData && typeof marketData === 'object' && !Array.isArray(marketData) ? { ...(marketData as Record<string, unknown>) } : {};
  const inputs = mergeUserInputs(md.user_inputs, parsed);
  md.user_inputs = inputs;
  return { market: md, inputs };
}
