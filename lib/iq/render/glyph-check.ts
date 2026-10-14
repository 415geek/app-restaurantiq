/**
 * v4 §1.4 PDF 字形校验 — the glyph gate.
 *
 * The report that prompted this printed 893 missing-glyph boxes across all 15
 * pages: every Chinese string inside a Latin-styled cell (table headers,
 * 「分钟」, 「未获取」, the edition cell's 「预检版」) had no font to fall back to on
 * Vercel's Chromium, which ships Open Sans and nothing else. The web page and
 * the PDF were 92.3% the same text.
 *
 * The font stacks are fixed in print.css; this is the check that stops a bad
 * PDF from being delivered if a regression (or a slow font fetch past the
 * 12 s ready fallback) ever brings the boxes back. Pure over text: the caller
 * extracts the PDF's text and the page's visible text and hands both in.
 */

/** Characters that only ever appear when a glyph could not be rendered or mapped. */
const NULL_GLYPH_RE = /[\u0000�]/g;
/** CJK Unified Ideographs + extension A + fullwidth punctuation most report copy uses. */
const CJK_RE = /[㐀-䶿一-鿿　-〿＀-￯]/g;

export interface GlyphCheck {
  /** U+0000 / U+FFFD occurrences in the PDF text — must be zero. */
  null_glyphs: number;
  /** CJK characters found in the PDF text vs. on the page. */
  cjk_pdf: number;
  cjk_page: number;
  /** cjk_pdf ÷ cjk_page (1 when the page has no CJK at all). */
  cjk_ratio: number;
  ok: boolean;
  reason: string | null;
}

/** Below this share of the page's CJK characters surviving into the PDF, the PDF is not delivered. */
export const MIN_CJK_RATIO = 0.97;
/** A page with fewer CJK characters than this is not judged on the ratio (an English edition, or a cover-only render). */
export const MIN_CJK_SAMPLE = 40;

export function checkPdfGlyphs(pdfText: string, pageText: string): GlyphCheck {
  const null_glyphs = (pdfText.match(NULL_GLYPH_RE) ?? []).length;
  const cjk_pdf = (pdfText.match(CJK_RE) ?? []).length;
  const cjk_page = (pageText.match(CJK_RE) ?? []).length;
  const cjk_ratio = cjk_page === 0 ? 1 : Math.min(1, cjk_pdf / cjk_page);
  let reason: string | null = null;
  if (null_glyphs > 0) reason = `${null_glyphs} unmapped glyph(s) in the PDF text`;
  else if (cjk_page >= MIN_CJK_SAMPLE && cjk_ratio < MIN_CJK_RATIO) reason = `only ${Math.round(cjk_ratio * 1000) / 10}% of the page's Chinese characters survived into the PDF`;
  return { null_glyphs, cjk_pdf, cjk_page, cjk_ratio: Math.round(cjk_ratio * 1000) / 1000, ok: reason == null, reason };
}
