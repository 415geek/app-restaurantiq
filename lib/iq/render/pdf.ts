/**
 * renderReportPdf — Phase 5.3 PDF path.
 *
 * Launches Chromium (shared helper), navigates to `${baseUrl}/print/${reportId}`,
 * waits for the page's `window.__REPORT_READY__` flag (fonts loaded), then
 * prints US Letter with the page's own @page rules (18 mm margins, footer
 * rendered in-page). Returns the PDF bytes.
 */
import type { Browser } from 'puppeteer-core';
import { launchPdfBrowser } from './chromium';

export interface RenderReportPdfOptions {
  reportId: string;
  /** Origin the print page is served from, e.g. https://app.restaurantiq.ai */
  baseUrl: string;
  /** Non-production only: render qa/fixtures/report_model_<fixture>.json instead of the DB row. */
  fixture?: string | null;
  /** Wait budget for __REPORT_READY__ (default 20 s). */
  readyTimeoutMs?: number;
  /** Extra request headers (e.g. deployment-protection bypass). */
  headers?: Record<string, string>;
}

export function printPageUrl(opts: Pick<RenderReportPdfOptions, 'reportId' | 'baseUrl' | 'fixture'>): string {
  const url = new URL(`/print/${encodeURIComponent(opts.reportId)}`, opts.baseUrl.replace(/\/$/, '') + '/');
  if (opts.fixture && process.env.NODE_ENV !== 'production') url.searchParams.set('fixture', opts.fixture);
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
    if (pages !== 15) console.warn(`[iq/render/pdf] expected 15 action titles, found ${pages} (${url})`);

    const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, timeout: 60_000 });
    console.log(`[iq/render/pdf] done id=${opts.reportId} bytes=${pdf.length} elapsed_ms=${Date.now() - t0}`);
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
