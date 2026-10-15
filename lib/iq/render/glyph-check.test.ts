/** v4 §1.4: the PDF glyph gate (the real report had 893 boxes and 92.3% text similarity). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPdfGlyphs } from './glyph-check';

const page = '商圈选址分析报告 '.repeat(20) + '步行 10 分钟 · 未获取 · 预检版';

test('a clean render passes; unmapped glyphs or lost Chinese text fail', () => {
  assert.equal(checkPdfGlyphs(page, page).ok, true);
  const boxes = checkPdfGlyphs(page.replace(/分钟/g, '\u0000\u0000'), page);
  assert.equal(boxes.ok, false);
  assert.equal(boxes.null_glyphs, 2);
  const lost = checkPdfGlyphs(page.slice(0, Math.floor(page.length * 0.9)), page);
  assert.equal(lost.ok, false);
  assert.match(lost.reason ?? '', /survived/);
});

test('an English edition with little Chinese is not judged on the ratio', () => {
  const en = 'Restaurant Site Intelligence report · 分钟';
  assert.equal(checkPdfGlyphs('Restaurant Site Intelligence report', en).ok, true);
});
