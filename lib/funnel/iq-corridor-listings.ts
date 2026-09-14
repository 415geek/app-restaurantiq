/**
 * Alternative-corridor listings (评审 Spec §4.7 c).
 *
 * A listing row may be shown as a sqft / rent table row ONLY when it carries a
 * real listing source. Everything else (LLM "[估算]" rows, "待核实" addresses,
 * rows without a listing source tag, rows without both size and rent) is
 * rendered as text — corridor name + rationale — so no invented numbers reach
 * the customer.
 */

export type CorridorListingRow = Record<string, unknown>;

/** Source tags that come from a commercial listing feed the pipeline actually fetched. */
const LISTING_SOURCE_RE = /\b(loopnet|crexi)\b/i;
/** Markers the prompt uses for guessed rows, in all three languages. */
const ESTIMATE_RE = /\[(估算|estimate|estimación|estimacion|检索|search|búsqueda|busqueda)\]|待核实|待核对|to be verified|por verificar|a verificar|placeholder|占位/i;

function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,\s]/g, '').replace(/[^\d.]+$/, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** True when the row's sqft + rent come from a LoopNet/Crexi listing and nothing marks it as guessed. */
export function isVerifiedListing(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const r = row as CorridorListingRow;
  const source = typeof r.source_tag === 'string' ? r.source_tag.trim() : '';
  if (!source || !LISTING_SOURCE_RE.test(source) || ESTIMATE_RE.test(source)) return false;
  const address = typeof r.address_or_listing === 'string' ? r.address_or_listing : '';
  const highlights = typeof r.highlights === 'string' ? r.highlights : '';
  if (ESTIMATE_RE.test(address) || ESTIMATE_RE.test(highlights)) return false;
  if (!address.trim()) return false;
  return numOf(r.sqft) != null && numOf(r.monthly_rent_usd) != null;
}

/** Listing rows safe to tabulate; empty when the corridor must be text-only. */
export function verifiedListings(listings: unknown): CorridorListingRow[] {
  if (!Array.isArray(listings)) return [];
  return listings.filter(isVerifiedListing) as CorridorListingRow[];
}
