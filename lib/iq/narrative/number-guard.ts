/**
 * NumberGuard (研发提示词 Phase 6 门槛 5 / 附录 E): every number in a narrative
 * must exist in the page's JSON fragment (±1 rounding, or ±0.5 % for
 * percentages and ±1 % relative for large USD). Also enforces the [src:path]
 * citation rule and the banned-phrase list (门槛 6).
 */

export interface NumberGuardResult {
  ok: boolean;
  unmatched: string[];
  banned: string[];
  missing_refs: boolean;
  numbers_checked: number;
}

const BANNED_ALWAYS = ['保守估计', '大约', '约莫'];
const BANNED_UNLESS_VOID = ['零竞争', '空白'];

/** Collect every numeric value reachable in the fragment (raw + common formattings). */
export function collectNumbers(fragment: unknown, out = new Set<number>()): Set<number> {
  if (typeof fragment === 'number' && Number.isFinite(fragment)) {
    out.add(fragment);
    // ratios/shares are usually written as percentages
    if (Math.abs(fragment) <= 1.5) out.add(Math.round(fragment * 1000) / 10);
    return out;
  }
  if (typeof fragment === 'string') {
    for (const m of fragment.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      const v = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(v)) out.add(v);
    }
    return out;
  }
  if (Array.isArray(fragment)) fragment.forEach((x) => collectNumbers(x, out));
  else if (fragment && typeof fragment === 'object') Object.values(fragment).forEach((x) => collectNumbers(x, out));
  return out;
}

/** Numbers as they appear in prose: "$11.6 万", "112%", "4.1 万户", "1,711", "0.9 倍". */
export function extractNarrativeNumbers(text: string): Array<{ raw: string; value: number; kind: 'pct' | 'usd' | 'wan' | 'plain' }> {
  const out: Array<{ raw: string; value: number; kind: 'pct' | 'usd' | 'wan' | 'plain' }> = [];
  const re = /(\$|＄|USD\s?)?(-?\d[\d,]*(?:\.\d+)?)\s*(万|k|K|%|％|倍)?/g;
  for (const m of text.matchAll(re)) {
    const numStr = m[2];
    let v = Number(numStr.replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    const unit = m[3] ?? '';
    let kind: 'pct' | 'usd' | 'wan' | 'plain' = 'plain';
    if (unit === '%' || unit === '％') kind = 'pct';
    else if (unit === '万') {
      v = v * 10_000;
      kind = 'wan';
    } else if (unit === 'k' || unit === 'K') {
      v = v * 1_000;
      kind = 'wan';
    } else if (m[1]) kind = 'usd';
    // skip citation paths like [src:trade_area.rings.2.pop] and ring ids (walk10, drive15)
    const before = text.slice(Math.max(0, m.index! - 48), m.index!);
    // inside an open [src:...] citation, or glued to an identifier (walk10, drive15, L1, D2, Q3)
    if (/\[src:[^\]]*$/.test(before) || /(walk|drive|[LDQ])$/.test(before)) continue;
    // years like 2024 in plain text are allowed
    if (kind === 'plain' && v >= 1990 && v <= 2040 && Number.isInteger(v)) continue;
    out.push({ raw: m[0].trim(), value: v, kind });
  }
  return out;
}

function matches(v: number, kind: string, pool: Set<number>): boolean {
  for (const p of pool) {
    if (p === v) return true;
    if (kind === 'pct' && Math.abs(p - v) <= 0.55) return true;
    if (kind === 'wan' || kind === 'usd') {
      if (Math.abs(p - v) <= Math.max(1, Math.abs(p) * 0.012)) return true;
      // "11.6 万" vs 116,432 → allow rounding to the stated precision
      if (Math.abs(p - v) <= 5_000 && Math.abs(v) >= 10_000) return true;
    }
    if (kind === 'plain' && Math.abs(p - v) <= 1) return true;
  }
  return false;
}

export function numberGuard(text: string, fragment: unknown, opts: { isVoid?: boolean } = {}): NumberGuardResult {
  const pool = collectNumbers(fragment);
  const found = extractNarrativeNumbers(text);
  const unmatched: string[] = [];
  for (const n of found) {
    if (!matches(n.value, n.kind, pool)) unmatched.push(n.raw);
  }
  const banned: string[] = [];
  for (const b of BANNED_ALWAYS) if (text.includes(b)) banned.push(b);
  if (!opts.isVoid) for (const b of BANNED_UNLESS_VOID) if (text.includes(b)) banned.push(b);
  const missing_refs = !/\[src:[\w.[\]-]+\]/.test(text);
  return { ok: unmatched.length === 0 && banned.length === 0 && !missing_refs, unmatched, banned, missing_refs, numbers_checked: found.length };
}
