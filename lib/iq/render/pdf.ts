/**
 * renderReportPdf — Phase 5.3 PDF path.
 *
 * Launches Chromium (shared helper), navigates to `${baseUrl}/print/${reportId}`,
 * waits for the page's `window.__REPORT_READY__` flag (fonts loaded), then
 * prints US Letter with the page's own @page rules (18 mm margins, footer
 * rendered in-page). Returns the PDF bytes.
 */
import type { Browser } from 'puppeteer-core';
import type { Locale } from '@/lib/i18n/locale';
import { launchPdfBrowser } from './chromium';
import { checkPdfGlyphs, type GlyphCheck } from './glyph-check';

export interface RenderReportPdfOptions {
  reportId: string;
  /** Origin the print page is served from, e.g. https://app.restaurantiq.ai */
  baseUrl: string;
  /** Non-production only: render qa/fixtures/report_model_<fixture>.json instead of the DB row. */
  fixture?: string | null;
  /** Report language (`?lang=`); omitted → the print page uses the report row's stored language. */
  lang?: Locale | null;
  /** Wait budget for __REPORT_READY__ (default 20 s). */
  readyTimeoutMs?: number;
  /** Extra request headers (e.g. deployment-protection bypass). */
  headers?: Record<string, string>;
}

export function printPageUrl(opts: Pick<RenderReportPdfOptions, 'reportId' | 'baseUrl' | 'fixture' | 'lang'>): string {
  const url = new URL(`/print/${encodeURIComponent(opts.reportId)}`, opts.baseUrl.replace(/\/$/, '') + '/');
  if (opts.fixture && process.env.NODE_ENV !== 'production') url.searchParams.set('fixture', opts.fixture);
  if (opts.lang) url.searchParams.set('lang', opts.lang);
  return url.toString();
}

export async function renderReportPdf(opts: RenderReportPdfOptions): Promise<Buffer> {
  const url = printPageUrl(opts);
  const readyTimeout = opts.readyTimeoutMs ?? 20_000;
  const t0 = Date.now();
  let browser: Browser | null = null;
  try {
    browser = await launchPdfBrowser();
    const page = await browser.newPage();

    const extra: Record<string, string> = { ...(opts.headers ?? {}) };
    const token = process.env.IQ_PRINT_TOKEN?.trim();
    if (token) extra['x-iq-print-token'] = token;
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
    if (bypass) extra['x-vercel-protection-bypass'] = bypass;
    if (Object.keys(extra).length) await page.setExtraHTTPHeaders(extra);

    await page.emulateMediaType('print');
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const status = res?.status() ?? 0;
    if (status >= 400) throw new Error(`print page ${url} responded ${status}`);

    await page.waitForFunction(() => (window as unknown as { __REPORT_READY__?: boolean }).__REPORT_READY__ === true, { timeout: readyTimeout, polling: 100 });
    // one paint after fonts settle
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

    const pages = await page.$$eval('h1.action-title', (els) => els.length);
    if (pages !== 16) console.warn(`[iq/render/pdf] expected 16 action titles, found ${pages} (${url})`);

    // v4 §1.4: print, then prove the glyphs made it. A failed check gets one more
    // try after the fonts have had a chance to settle; a second failure is not
    // delivered — a PDF full of boxes is worse than no PDF.
    const pageText = await page.evaluate(() => document.body.innerText ?? '');
    let pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, timeout: 60_000 });
    let check = await glyphCheckOf(Buffer.from(pdf), pageText);
    if (check && !check.ok) {
      console.warn(`[iq/render/pdf] glyph check failed for ${opts.reportId}: ${check.reason} (null=${check.null_glyphs} cjk ${check.cjk_pdf}/${check.cjk_page}); retrying once`);
      await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => null, () => null) : null));
      await new Promise((r) => setTimeout(r, 1_500));
      pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, timeout: 60_000 });
      check = await glyphCheckOf(Buffer.from(pdf), pageText);
      if (check && !check.ok) throw new PdfGlyphError(check);
    }
    const glyphNote = check ? `glyphs null=${check.null_glyphs} cjk=${check.cjk_pdf}/${check.cjk_page}` : 'glyph check skipped (no text extraction)';
    console.log(`[iq/render/pdf] done id=${opts.reportId} bytes=${pdf.length} elapsed_ms=${Date.now() - t0} ${glyphNote}`);
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Thrown when the rendered PDF fails the glyph gate twice; the route maps it to a retryable error. */
export class PdfGlyphError extends Error {
  readonly check: GlyphCheck;
  constructor(check: GlyphCheck) {
    super(`pdf glyph check failed: ${check.reason}`);
    this.name = 'PdfGlyphError';
    this.check = check;
  }
}

/**
 * Run the glyph gate on a rendered PDF. `null` when the text could not be
 * extracted at all — that is a tooling failure, not a glyph failure, and it is
 * logged rather than turned into a refused download.
 */
async function glyphCheckOf(bytes: Buffer, pageText: string): Promise<GlyphCheck | null> {
  try {
    const text = await extractPdfText(bytes);
    return checkPdfGlyphs(text, pageText);
  } catch (e) {
    console.warn('[iq/render/pdf] pdf text extraction failed, glyph check skipped:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** pdf-parse 2.x: a parser object over the bytes; the text of every page, then release the worker. */
export async function extractPdfText(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: bytes });
  try {
    const r = await parser.getText();
    return r.text ?? '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}
