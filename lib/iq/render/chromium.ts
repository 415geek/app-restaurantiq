/**
 * Shared headless-Chromium launcher for PDF rendering.
 *
 * Extracted from app/api/iq/report/[id]/pdf/route.ts (D-2) so both the legacy
 * HTML-string generator and the Phase 5 /print renderer (lib/iq/render/pdf.ts)
 * use exactly the same launch path:
 *   - Vercel / Lambda: @sparticuz/chromium (graphics stack disabled)
 *   - local: PUPPETEER_EXECUTABLE_PATH / CHROME_PATH, then bundled chromium,
 *     then a well-known system Chrome path.
 */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';

export const PDF_VIEWPORT = { width: 1200, height: 1600 };

const LOCAL_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

export function isVercelServerless(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.VERCEL === 'true' ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  );
}

export async function launchPdfBrowser(): Promise<Browser> {
  if (isVercelServerless()) {
    // D-2: drop the graphics stack (no GPU on Lambda). This also avoids
    // extracting swiftshader.tar.br at runtime, shaving ~15MB off cold-start.
    try {
      (chromium as unknown as { setGraphicsMode: boolean }).setGraphicsMode = false;
    } catch {
      /* older versions ignore */
    }
    const args = [...chromium.args, '--font-render-hinting=none', '--disable-font-subpixel-positioning'];
    return puppeteer.launch({
      args,
      defaultViewport: PDF_VIEWPORT,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || process.env.CHROME_PATH?.trim();
  if (envPath) {
    return puppeteer.launch({ args: LOCAL_ARGS, defaultViewport: PDF_VIEWPORT, executablePath: envPath, headless: true });
  }

  try {
    return await puppeteer.launch({
      args: chromium.args,
      defaultViewport: PDF_VIEWPORT,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  } catch (e) {
    console.warn('[iq/render/chromium] @sparticuz/chromium launch failed, trying system Chrome:', e);
    const sys =
      process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : process.platform === 'win32'
          ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
          : '/usr/bin/google-chrome-stable';
    return puppeteer.launch({ args: LOCAL_ARGS, defaultViewport: PDF_VIEWPORT, executablePath: sys, headless: true });
  }
}
