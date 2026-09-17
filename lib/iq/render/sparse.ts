/**
 * 评审 Spec §4.6 PDF 交付质量 (P1-d) — the sparse-module rule.
 *
 * A module whose data is MORE THAN HALF missing is worth nothing to the reader:
 * a table of 「未获取」 rows costs a page of paper and tells them less than one
 * sentence would. The rule is therefore: **collapse the whole block** and let the
 * caller print the single explanatory line instead.
 *
 * The threshold is on the cells that would be printed, not on the rows: a table
 * of eight rows where every row has a name but no number is 50 % missing by row
 * and 100 % missing by value, and it is the values the reader came for.
 *
 * Nothing here decides *what* to print — it only answers "is this block worth a
 * block?" so every page applies the same rule with the same number.
 */

/** More than this share of missing cells and the block collapses entirely (§4.6). */
export const SPARSE_MISSING_LIMIT = 0.5;

/** A cell is missing when the renderer would print the 「未获取」 placeholder for it. */
export function isMissingCell(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'string') return v.trim() === '' || v.trim() === '—';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Share of printable cells that are missing, 0…1. An empty row set is fully
 * missing (1) — there is nothing to print.
 */
export function missingShare<T>(rows: readonly T[], cells: (row: T) => readonly unknown[]): number {
  let total = 0;
  let missing = 0;
  for (const row of rows) {
    for (const cell of cells(row)) {
      total++;
      if (isMissingCell(cell)) missing++;
    }
  }
  if (total === 0) return 1;
  return missing / total;
}

/**
 * The rows to render, or `[]` when the block is more than `limit` missing.
 *
 * ```ts
 * const rows = collapseIfSparse(competitors, (c) => [c.rating, c.rating_count]);
 * {rows.length ? <Table rows={rows} /> : <p className="table-note">{S.notEnoughData}</p>}
 * ```
 *
 * `minRows` refuses a block that is technically complete but too thin to be a
 * table (a one-row "distribution" is a number, not a distribution).
 */
export function collapseIfSparse<T>(
  rows: readonly T[],
  cells: (row: T) => readonly unknown[],
  opts: { limit?: number; minRows?: number } = {},
): T[] {
  const limit = opts.limit ?? SPARSE_MISSING_LIMIT;
  const minRows = opts.minRows ?? 1;
  if (rows.length < minRows) return [];
  return missingShare(rows, cells) > limit ? [] : [...rows];
}

/**
 * Drop the rows that carry no value at all, then apply the same rule to what is
 * left — the shape most tables want: a chart of the stores that DO have review
 * counts, but only when they are not a minority of the stores we claim to cover.
 */
export function keepPopulated<T>(
  rows: readonly T[],
  cells: (row: T) => readonly unknown[],
  opts: { limit?: number; minRows?: number } = {},
): T[] {
  const populated = rows.filter((r) => cells(r).some((c) => !isMissingCell(c)));
  // more than half the claimed rows carry nothing → the block is not worth a block
  if (rows.length > 0 && populated.length / rows.length < 1 - (opts.limit ?? SPARSE_MISSING_LIMIT)) return [];
  return collapseIfSparse(populated, cells, opts);
}
