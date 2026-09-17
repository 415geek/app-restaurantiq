/**
 * 评审 Spec §4.6 (P1-d): the sparse-module rule — a block whose printable data
 * is more than half missing collapses entirely instead of printing a table of
 * 「未获取」.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPARSE_MISSING_LIMIT, collapseIfSparse, isMissingCell, keepPopulated, missingShare } from './sparse';

const cells = (r: { a: number | null; b: number | null }) => [r.a, r.b];

test('a cell is missing when the renderer would print the placeholder', () => {
  for (const v of [null, undefined, '', '   ', '—', NaN, []]) assert.equal(isMissingCell(v), true, `${String(v)} should be missing`);
  for (const v of [0, -1, 0.5, 'x', false, [1]]) assert.equal(isMissingCell(v), false, `${String(v)} should be present`);
});

test('missingShare counts cells, not rows; an empty block is fully missing', () => {
  assert.equal(missingShare([], cells), 1);
  assert.equal(missingShare([{ a: 1, b: 2 }], cells), 0);
  assert.equal(missingShare([{ a: 1, b: null }], cells), 0.5);
  assert.equal(missingShare([{ a: null, b: null }, { a: 1, b: 2 }], cells), 0.5);
  assert.equal(missingShare([{ a: null, b: null }, { a: 1, b: null }], cells), 0.75);
});

test('collapseIfSparse keeps a block at exactly half missing and drops it past half', () => {
  assert.equal(SPARSE_MISSING_LIMIT, 0.5);
  const half = [{ a: 1, b: null }, { a: 2, b: null }];
  assert.equal(collapseIfSparse(half, cells).length, 2, 'exactly 50% missing still prints');
  const past = [{ a: 1, b: null }, { a: null, b: null }];
  assert.deepEqual(collapseIfSparse(past, cells), [], 'past 50% missing collapses');
  assert.deepEqual(collapseIfSparse([], cells), [], 'an empty block collapses');
  // the P1-d bug itself: three rows that all read 「未获取」
  assert.deepEqual(collapseIfSparse([{ a: null, b: null }, { a: null, b: null }, { a: null, b: null }], cells), []);
});

test('collapseIfSparse returns a copy, never the caller’s array', () => {
  const rows = [{ a: 1, b: 2 }];
  const out = collapseIfSparse(rows, cells);
  assert.notEqual(out, rows);
  assert.deepEqual(out, rows);
});

test('minRows refuses a block too thin to be a table', () => {
  const two = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
  assert.equal(collapseIfSparse(two, cells, { minRows: 3 }).length, 0);
  assert.equal(collapseIfSparse(two, cells, { minRows: 2 }).length, 2);
});

test('a custom limit moves the line', () => {
  const rows = [{ a: 1, b: null }, { a: 2, b: null }];
  assert.equal(collapseIfSparse(rows, cells, { limit: 0.4 }).length, 0);
  assert.equal(collapseIfSparse(rows, cells, { limit: 0.6 }).length, 2);
});

test('keepPopulated drops empty rows but collapses when they are the majority', () => {
  const rows = [{ a: 812, b: 4.3 }, { a: 275, b: 4.5 }, { a: null, b: null }];
  assert.equal(keepPopulated(rows, cells).length, 2, '2 of 3 populated → print the 2');
  const mostlyEmpty = [{ a: 812, b: 4.3 }, { a: null, b: null }, { a: null, b: null }];
  assert.deepEqual(keepPopulated(mostlyEmpty, cells), [], '1 of 3 populated → collapse');
  const half = [{ a: 812, b: 4.3 }, { a: null, b: null }];
  assert.equal(keepPopulated(half, cells).length, 1, 'exactly half populated still prints');
  assert.deepEqual(keepPopulated([], cells), []);
});
