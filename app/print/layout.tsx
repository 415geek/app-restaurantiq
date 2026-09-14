/**
 * /print layout — minimal light shell for the 14-page report (Phase 5.3).
 *
 * The app's root layout still wraps this (Next.js allows a single root
 * layout), so print.css forces the light tokens with `!important` and
 * `color-scheme: light only`; prefers-color-scheme has no effect. Fonts come
 * from Google Fonts (Noto Serif SC for titles, Noto Sans SC for body, Inter for
 * numerals) with a real system fallback stack —
 * if the stylesheet cannot load, the page still renders with system CJK fonts.
 *
 * A tiny inline script sets `window.__REPORT_READY__ = true` once the window
 * has loaded and `document.fonts.ready` resolved; lib/iq/render/pdf.ts waits
 * for that flag before calling page.pdf().
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './print.css';

export const metadata: Metadata = {
  title: 'RestaurantIQ · 360° 选址报告',
  robots: { index: false, follow: false },
};

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@600;700;900&display=swap';

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
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FONTS_HREF} />
      {children}
      <script dangerouslySetInnerHTML={{ __html: READY_SCRIPT }} />
    </div>
  );
}
