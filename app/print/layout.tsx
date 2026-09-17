/**
 * /print layout — minimal light shell for the 14-page report (Phase 5.3).
 *
 * The app's root layout still wraps this (Next.js allows a single root
 * layout), so print.css forces the light tokens with `!important` and
 * `color-scheme: light only`; prefers-color-scheme has no effect. Fonts are
 * self-hosted (Noto Serif SC for titles, Noto Sans SC for body, Inter for
 * numerals) behind the same system fallback stack, so the page still renders
 * with system CJK fonts if a face fails to load.
 *
 * They are self-hosted rather than loaded from Google Fonts because the CSS API
 * splits every CJK family into ~100 `unicode-range` slices. Chromium embedded
 * each slice the document touched as its own Type3 font — 464 of them, about
 * 4 MB — which put the Chinese PDF over the 5 MB smoke cap while the English
 * one, touching only Latin slices, came in at 1.35 MB. One face per weight lets
 * Chromium embed a single subset of the glyphs actually used instead.
 *
 * A tiny inline script sets `window.__REPORT_READY__ = true` once the window
 * has loaded and `document.fonts.ready` resolved; lib/iq/render/pdf.ts waits
 * for that flag before calling page.pdf().
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/noto-sans-sc/chinese-simplified-400.css';
import '@fontsource/noto-sans-sc/chinese-simplified-500.css';
import '@fontsource/noto-sans-sc/chinese-simplified-600.css';
import '@fontsource/noto-sans-sc/chinese-simplified-700.css';
import '@fontsource/noto-serif-sc/chinese-simplified-600.css';
import '@fontsource/noto-serif-sc/chinese-simplified-700.css';
import '@fontsource/noto-serif-sc/chinese-simplified-900.css';
import './print.css';

export const metadata: Metadata = {
  title: 'RestaurantIQ · 360° 选址报告',
  robots: { index: false, follow: false },
};

const READY_SCRIPT = `(function(){
  var done=false;
  function ready(){ if(done) return; done=true; window.__REPORT_READY__=true; document.documentElement.setAttribute('data-report-ready','1'); }
  function afterFonts(){ try { if (document.fonts && document.fonts.ready) { document.fonts.ready.then(ready, ready); } else { ready(); } } catch (e) { ready(); } }
  if (document.readyState === 'complete') { afterFonts(); } else { window.addEventListener('load', afterFonts); }
  setTimeout(ready, 12000); /* never block the PDF on a hanging font request */
})();`;

export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <div className="print-root" data-print-root="">
      {children}
      <script dangerouslySetInnerHTML={{ __html: READY_SCRIPT }} />
    </div>
  );
}
