/**
 * Minimal US street-address parsing for jurisdiction adapter queries.
 *
 * Open-data portals key permits on a street number + street name, sometimes in
 * one column, sometimes split. We only need enough structure to build a safe
 * `LIKE` predicate and to post-filter rows by street number — address matching
 * is deliberately conservative: a miss is `null` (未获取), never a guess.
 */

export interface ParsedAddress {
  raw: string;
  number: string | null;
  /** Street name WITHOUT the number and without the unit, upper-cased words preserved as typed. */
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const UNIT_RE = /\b(?:ste|suite|unit|apt|apartment|#|fl|floor|rm|room)\.?\s*[\w-]+\b/gi;

/** Strip characters that have no business inside a SoQL / ArcGIS string literal. */
export function sanitizeLiteral(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s\-'.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** SoQL / ArcGIS single-quote escaping. */
export function escapeSqlLiteral(value: string): string {
  return sanitizeLiteral(value).replace(/'/g, "''");
}

/** Column identifiers are never interpolated unless they look like identifiers. */
export function isSafeFieldName(name: string | null | undefined): name is string {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name);
}

export function parseUsAddress(raw: string): ParsedAddress {
  const cleaned = String(raw ?? '').trim();
  const out: ParsedAddress = { raw: cleaned, number: null, street: null, city: null, state: null, zip: null };
  if (!cleaned) return out;

  const zipMatch = cleaned.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
  if (zipMatch) out.zip = zipMatch[1];

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  const first = parts[0] ?? cleaned;

  const line = first.replace(UNIT_RE, ' ').replace(/\s+/g, ' ').trim();
  const m = line.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (m) {
    out.number = m[1];
    out.street = m[2].trim() || null;
  } else {
    out.street = line || null;
  }

  if (parts.length >= 2) out.city = parts[1] || null;
  const tail = parts.slice(2).join(' ');
  const st = tail.match(/\b([A-Z]{2})\b/);
  if (st) out.state = st[1];
  return out;
}

/**
 * The prefix used for `LIKE '<prefix>%'`. Returns null when the address has no
 * usable street portion — the adapter then reports `skipped`, not a bad query.
 */
export function addressLikePrefix(parsed: ParsedAddress): string | null {
  if (!parsed.street) return null;
  const street = sanitizeLiteral(parsed.street);
  if (!street) return null;
  return parsed.number ? `${parsed.number} ${street}` : street;
}

/**
 * True when a returned row plausibly belongs to the queried address: its text
 * must contain the street number as a standalone token AND the first
 * significant word of the street name.
 */
export function rowMatchesAddress(row: Record<string, unknown>, parsed: ParsedAddress): boolean {
  const text = Object.values(row)
    .map((v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join(' ')
    .toLowerCase();
  if (!text) return false;
  if (parsed.number) {
    const re = new RegExp(`(^|[^0-9])${parsed.number.toLowerCase()}([^0-9]|$)`);
    if (!re.test(text)) return false;
  }
  const streetWord = (parsed.street ?? '')
    .toLowerCase()
    .split(/\s+/)
    .find((w) => w.length >= 3 && !/^(st|ave|rd|blvd|dr|ln|ct|way|pl|hwy)$/.test(w));
  if (streetWord && !text.includes(streetWord)) return false;
  return true;
}
