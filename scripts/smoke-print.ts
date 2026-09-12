/**
 * Phase 5.5 smoke: render the /print page for the Millbrae fixture with a local
 * Chromium, save qa/out/print-millbrae.pdf + per-page screenshots, and assert:
 *   - exactly 15 h1.action-title (plus an unnumbered cover page → 16 PDF pages)
 *   - no text node with contrast < 4.5:1 against its effective background
 *   - no empty <td>
 *   - PDF between 50 KB and 5 MB
 *
 * Usage: npx tsx scripts/smoke-print.ts [--base http://localhost:3111] [--fixture millbrae]
 * Requires a running dev server (npx next dev -p 3111).
 */
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const argOf = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = argOf('--base', process.env.SMOKE_BASE_URL ?? 'http://localhost:3111');
const FIXTURE = argOf('--fixture', 'millbrae');
const OUT = path.join(process.cwd(), 'qa', 'out');
/** 14 analysis pages + 总结与建议 (page 15). */
const EXPECTED_PAGES = 15; // numbered analysis pages (h1.action-title)
const EXPECTED_PDF_PAGES = EXPECTED_PAGES + 1; // + unnumbered cover page
/** Customer-facing text must not leak engine ids (研发提示词 wording rule). */
const JARGON_RE = /\b(walk10|drive5|drive10|drive15|coverage_ratio|cluster_score|Huff|HHI|P25|P75|CapEx)\b|\bL[1-4]\b|β|置信度/;

function findChrome(): string {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (env) return env;
  try {
    const found = execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch {
    /* fallthrough */
  }
  for (const p of ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    try {
      execSync(`test -x ${p}`);
      return p;
    } catch {
      /* next */
    }
  }
  throw new Error('No Chromium binary found; set PUPPETEER_EXECUTABLE_PATH');
}

interface ContrastViolation {
  text: string;
  color: string;
  background: string;
  ratio: number;
  path: string;
}

/*
 * Browser-side checks are plain JS strings: tsx/esbuild's keepNames injects a
 * `__name` helper into serialized functions, which does not exist in the page.
 */
const FONT_INFO_JS = `(() => {
  const faces = [];
  document.fonts.forEach((f) => faces.push({ family: f.family.replace(/["']/g, ''), status: f.status }));
  const loaded = (fam) => faces.some((f) => f.family === fam && f.status === 'loaded');
  return { inter: loaded('Inter'), noto: loaded('Noto Sans SC'), faces: faces.length, families: Array.from(new Set(faces.map((f) => f.family))) };
})()`;

const CONTRAST_JS = `(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const blend = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };
  const effectiveBg = (el) => {
    let cur = el; const layers = [];
    while (cur) {
      const bg = parse(getComputedStyle(cur).backgroundColor);
      if (bg && bg[3] > 0) { layers.push(bg); if (bg[3] >= 1) break; }
      cur = cur.parentElement;
    }
    let out = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('script,style,noscript,[hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const isSvgText = el.tagName.toLowerCase() === 'text';
    const fgRaw = isSvgText ? cs.fill : cs.color;
    const fg = parse(fgRaw);
    if (!fg) continue;
    let bg;
    if (isSvgText) {
      // elementsFromPoint only hit-tests inside the viewport: bring the label on screen first
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      let found = null;
      for (const s of stack) {
        if (s === el) continue;
        const tag = s.tagName.toLowerCase();
        if (tag === 'rect' || tag === 'circle' || tag === 'path') {
          const f = parse(getComputedStyle(s).fill);
          if (f && f[3] > 0) { found = f[3] >= 1 ? f : blend(f, effectiveBg(s.parentElement)); break; }
        }
        if (!(s instanceof SVGElement)) { found = effectiveBg(s); break; }
      }
      bg = found || effectiveBg(el.parentElement);
    } else {
      bg = effectiveBg(el);
    }
    const fgB = fg[3] < 1 ? blend(fg, bg) : fg;
    const l1 = lum(fgB), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 4.5) {
      const parts = []; let p = el;
      while (p && parts.length < 4) { parts.unshift(p.tagName.toLowerCase() + (typeof p.className === 'string' && p.className ? '.' + p.className.split(' ')[0] : '')); p = p.parentElement; }
      out.push({ text: t.slice(0, 40), color: fgRaw, background: 'rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ')', ratio: Math.round(ratio * 100) / 100, path: parts.join('>') });
    }
  }
  return out;
})()`;

const EMPTY_TD_JS = `Array.from(document.querySelectorAll('td')).filter((td) => !(td.textContent || '').trim() && !td.querySelector('svg,img')).length`;
const EMOJI_JS = `/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(document.body.innerText) ? 'found' : 'none'`;
/* .page is a flex column: an over-tall .page-body is shrunk (and paints over the tail) rather than overflowing .page, so measure the body itself too. */
const PAGE_OVERFLOW_JS = `Array.from(document.querySelectorAll('section.page')).map((p, i) => {
  const body = p.querySelector('.page-body');
  const bodyOver = body ? body.scrollHeight - body.clientHeight : 0;
  return { page: i + 1, overflow: Math.round(Math.max(p.scrollHeight - p.clientHeight, bodyOver)) };
}).filter((x) => x.overflow > 1)`;
const PAGE_FILL_JS = `Array.from(document.querySelectorAll('section.page')).map((p, i) => { const b = p.querySelector('.page-body'); return 'p' + (i + 1) + ':' + (b ? Math.round((b.scrollHeight / b.clientHeight) * 100) : 0) + '%'; }).join(' ')`;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const url = `${BASE}/print/${FIXTURE}?fixture=${FIXTURE}`;
  const exe = findChrome();
  console.log(`[smoke-print] chromium=${exe}`);
  console.log(`[smoke-print] url=${url}`);
  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  // Sandboxes that only reach the internet through an egress proxy: let Chromium
  // use it so Google Fonts can load (dev-only; the proxy CA is not in Chromium's store).
  const proxy = process.env.SMOKE_CHROME_PROXY === '1' ? process.env.HTTPS_PROXY || process.env.https_proxy : undefined;
  if (proxy) launchArgs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1', '--ignore-certificate-errors');
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: launchArgs,
    defaultViewport: { width: 1200, height: 1600, deviceScaleFactor: 1 },
  });
  const results: Record<string, unknown> = {};
  let failed = 0;
  const assert = (name: string, ok: boolean, detail: string) => {
    results[name] = { ok, detail };
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  };
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('requestfailed', (r) => {
      if (/fonts\.g(oogleapis|static)\.com/.test(r.url())) console.log(`[smoke-print] font request failed: ${r.url()} (${r.failure()?.errorText})`);
    });
    const t0 = Date.now();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    console.log(`[smoke-print] status=${res?.status()} dom_ms=${Date.now() - t0}`);
    await page.waitForFunction(() => (window as unknown as { __REPORT_READY__?: boolean }).__REPORT_READY__ === true, { timeout: 20_000, polling: 100 });
    console.log(`[smoke-print] ready_ms=${Date.now() - t0}`);

    const fontInfo = (await page.evaluate(FONT_INFO_JS)) as { inter: boolean; noto: boolean; faces: number; families: string[] };
    console.log(`[smoke-print] fonts: Inter=${fontInfo.inter} NotoSansSC=${fontInfo.noto} faces=${fontInfo.faces} families=${fontInfo.families.join(', ') || '(none; system fallback stack in use)'}`);
    results.fonts = fontInfo;

    // 1) page count
    const titles = await page.$$eval('h1.action-title', (els) => els.map((e) => (e.textContent ?? '').trim()));
    assert('action_titles', titles.length === EXPECTED_PAGES, `${titles.length} h1.action-title (expected ${EXPECTED_PAGES})`);
    const longTitles = titles.filter((t) => t.length > 28);
    console.log(`[smoke-print] titles > 28 chars: ${longTitles.length}${longTitles.length ? ' → ' + longTitles.map((t) => `"${t}" (${t.length})`).join('; ') : ''}`);
    const emptyTitles = titles.filter((t) => !t);
    assert('action_titles_nonempty', emptyTitles.length === 0, `${emptyTitles.length} empty`);

    // 2) empty td
    const emptyTds = (await page.evaluate(EMPTY_TD_JS)) as number;
    assert('no_empty_td', emptyTds === 0, `${emptyTds} empty <td>`);

    // 3) emoji scan
    const emoji = (await page.evaluate(EMOJI_JS)) as string;
    assert('no_emoji', emoji === 'none', emoji);

    // 3b) jargon scan on the customer-facing text (footer report ids excluded by the regex)
    // textContent (not innerText) so hidden/clamped text is scanned too; scripts (RSC payload serialises the raw model),
    // map legend / SVG (map module, scanned by its owner) and footers (report ids by design) are excluded
    const bodyText = (await page.evaluate(`(() => { const b = document.body.cloneNode(true); b.querySelectorAll('script, style, noscript, template, .map-legend, svg, .page-foot').forEach((e) => e.remove()); return b.textContent || ''; })()`)) as string;
    const jargonHits = [...new Set((bodyText.match(new RegExp(JARGON_RE.source, 'g')) ?? []))];
    assert('no_jargon', jargonHits.length === 0, jargonHits.length ? `leaked: ${jargonHits.join(', ')}` : 'no engine ids in page text');
    assert('no_cost_line', !/报告成本|成本 \$0\.\d{3}/.test(bodyText), '成本 column / per-report cost line absent');
    assert('no_source_count_title', !/个数据源中 \d+ 个完整/.test(bodyText), '"N 个数据源中 M 个完整" absent');
    const titleP15 = titles[14] ?? '';
    assert('page_15_is_summary', /总结与建议/.test(bodyText) && titleP15.length > 0, `page 15 title: "${titleP15}"`);

    // 4) contrast (text nodes incl. SVG <text>; effective background resolved through transparent ancestors)
    const violations = (await page.evaluate(CONTRAST_JS)) as ContrastViolation[];
    assert('contrast_4_5', violations.length === 0, `${violations.length} text nodes < 4.5:1`);
    for (const v of violations.slice(0, 25)) console.log(`   ${v.ratio}  ${v.color} on ${v.background}  ${v.path}  "${v.text}"`);

    // 4b) page-box overflow (content clipped by the fixed 243 mm page)
    await page.emulateMediaType('print');
    const overflow = (await page.evaluate(PAGE_OVERFLOW_JS)) as Array<{ page: number; overflow: number }>;
    assert('no_page_overflow', overflow.length === 0, overflow.length ? overflow.map((o) => `p${o.page} +${o.overflow}px`).join(', ') : `cover + all ${EXPECTED_PAGES} pages fit the 243 mm box`);
    console.log(`[smoke-print] body fill (content ÷ available): ${await page.evaluate(PAGE_FILL_JS)}`);

    // 5) screenshots per page
    await page.emulateMediaType('screen');
    const pageEls = await page.$$('section.page');
    for (let i = 0; i < pageEls.length; i++) {
      const file = path.join(OUT, `print-page-${i + 1}.png`);
      await pageEls[i].screenshot({ path: file as `${string}.png` });
    }
    console.log(`[smoke-print] screenshots: ${pageEls.length} → qa/out/print-page-N.png`);

    // 6) PDF
    await page.emulateMediaType('print');
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, timeout: 60_000 });
    const pdfPath = path.join(OUT, `print-${FIXTURE}.pdf`);
    await fs.writeFile(pdfPath, pdf);
    const kb = pdf.length / 1024;
    assert('pdf_size', pdf.length > 50 * 1024 && pdf.length < 5 * 1024 * 1024, `${kb.toFixed(1)} KB → ${pdfPath}`);
    const pdfPages = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    assert('pdf_pages', pdfPages === EXPECTED_PDF_PAGES, `${pdfPages} PDF pages (expected ${EXPECTED_PDF_PAGES} = cover + ${EXPECTED_PAGES})`);

    if (consoleErrors.length) console.log(`[smoke-print] console errors (${consoleErrors.length}):\n  ${consoleErrors.slice(0, 5).join('\n  ')}`);
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(JSON.stringify(results, null, 2));
  if (failed) {
    console.log(`[smoke-print] ${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('[smoke-print] all assertions passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
