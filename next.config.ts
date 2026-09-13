import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // D-2: keep puppeteer + the bundled chromium binary OUT of the Next function
  // bundle. Without this, Next 16 tries to inline /node_modules/@sparticuz/chromium/bin
  // (~50–60MB) into the serverless function and either explodes the 50MB limit
  // on Vercel or breaks the native binary symlinks.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],

  // Force-include the @sparticuz/chromium binary tarball and its launcher into
  // the deployed function's file trace so it can be loaded at runtime from
  // /var/task/node_modules/@sparticuz/chromium/bin/chromium.br.
  // Keys are picomatch globs matched against the normalized app route
  // ("/api/iq/report/[id]/pdf"); `[id]` must be escaped so it is not read as a
  // character class. The runtime also falls back to downloading the release
  // pack when these files are missing (lib/iq/render/chromium.ts).
  outputFileTracingIncludes: {
    '/api/iq/report/*/pdf': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/iq/report/\\[id\\]/pdf': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
};

export default nextConfig;
