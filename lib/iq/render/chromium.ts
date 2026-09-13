/**
 * Shared headless-Chromium launcher for PDF rendering.
 *
 * Extracted from app/api/iq/report/[id]/pdf/route.ts (D-2) so both the legacy
 * HTML-string generator and the Phase 5 /print renderer (lib/iq/render/pdf.ts)
 * use exactly the same launch path:
 *   - Vercel / Lambda: @sparticuz/chromium (graphics stack disabled). When the
 *     bundled `bin/` brotli files did not make it into the function bundle
 *     (file tracing is bundler-dependent), the matching release pack is
 *     downloaded into /tmp once per instance instead of failing.
 *   - local: PUPPETEER_EXECUTABLE_PATH / CHROME_PATH, then bundled chromium,
 *     then a well-known system Chrome path.
 */
import { existsSync } from 'node:fs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';

export const PDF_VIEWPORT = { width: 1200, height: 1600 };

const LOCAL_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/**
 * Release pack matching the pinned @sparticuz/chromium major (package.json
 * `^143.0.4`). Used only when the bundled bin/ directory is absent at runtime.
 */
export const CHROMIUM_REMOTE_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar';

/**
 * Vercel only exposes VERCEL=1 when "system environment variables" are enabled
 * and Fluid Compute no longer sets AWS_LAMBDA_FUNCTION_NAME, so also accept the
 * other Vercel/Lambda markers and the /var/task function root.
 */
export function isVercelServerless(): boolean {
  const env = process.env;
  if (env.VERCEL === '1' || env.VERCEL === 'true' || env.VERCEL_ENV || env.VERCEL_REGION) return true;
  if (env.AWS_LAMBDA_FUNCTION_NAME || env.LAMBDA_TASK_ROOT || env.AWS_EXECUTION_ENV) return true;
  return process.platform === 'linux' && existsSync('/var/task');
}

let bundledPathPromise: Promise<string> | null = null;

/** Bundled bin/ first; fall back to the release pack downloaded into /tmp (cached per instance). */
export function bundledChromiumPath(): Promise<string> {
  if (!bundledPathPromise) {
    bundledPathPromise = (async () => {
      try {
        return await chromium.executablePath();
      } catch (e) {
        console.warn('[iq/render/chromium] bundled chromium bin/ unavailable, downloading release pack:', e instanceof Error ? e.message : e);
        return chromium.executablePath(CHROMIUM_REMOTE_PACK_URL);
      }
    })().catch((e) => {
      bundledPathPromise = null;
      throw e;
    });
  }
  return bundledPathPromise;
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
    let executablePath: string;
    try {
      executablePath = await bundledChromiumPath();
    } catch (e) {
      throw new Error(`Chromium is not available on this serverless instance: ${e instanceof Error ? e.message : String(e)}`);
    }
    return puppeteer.launch({ args, defaultViewport: PDF_VIEWPORT, executablePath, headless: true });
  }

  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || process.env.CHROME_PATH?.trim();
  if (envPath) {
    return puppeteer.launch({ args: LOCAL_ARGS, defaultViewport: PDF_VIEWPORT, executablePath: envPath, headless: true });
  }

  let bundledError: unknown = null;
  try {
    return await puppeteer.launch({
      args: chromium.args,
      defaultViewport: PDF_VIEWPORT,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  } catch (e) {
    bundledError = e;
    console.warn('[iq/render/chromium] @sparticuz/chromium launch failed, trying system Chrome:', e);
  }
  const sys =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome-stable';
  try {
    return await puppeteer.launch({ args: LOCAL_ARGS, defaultViewport: PDF_VIEWPORT, executablePath: sys, headless: true });
  } catch (e) {
    const b = bundledError instanceof Error ? bundledError.message : String(bundledError);
    const s = e instanceof Error ? e.message : String(e);
    throw new Error(`No Chromium available (bundled: ${b}; system ${sys}: ${s}). Set PUPPETEER_EXECUTABLE_PATH.`);
  }
}
