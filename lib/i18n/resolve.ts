/**
 * Pure locale-resolution helpers shared by the client hook (`use-locale.ts`)
 * and the server resolver (`server-locale.ts`). No React, no Next imports, so
 * they run in node tests.
 *
 * Resolution order everywhere in the funnel:
 *   `?lang=` param  >  `iq_lang` cookie / localStorage  >  Accept-Language / navigator.language  >  'en'
 */
import { DEFAULT_LOCALE, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from './locale';

/**
 * Like `toLocale()` but returns `null` for anything that is not one of ours, so
 * a caller can fall through to the next source instead of silently landing on
 * English ("fr" must not beat a stored "zh").
 */
export function strictLocale(v: unknown): Locale | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('es')) return 'es';
  if (s.startsWith('en')) return 'en';
  return null;
}

/** Pick the locale from the sources a browser can see. */
export function resolveClientLocale(input: {
  param?: string | null;
  stored?: string | null;
  navigatorLanguage?: string | null;
}): Locale {
  return (
    strictLocale(input.param) ??
    strictLocale(input.stored) ??
    (input.navigatorLanguage ? localeFromAcceptLanguage(input.navigatorLanguage) : DEFAULT_LOCALE)
  );
}

/** Read the `iq_lang` cookie out of a raw `document.cookie` / `Cookie` header string. */
export function localeFromCookieString(cookie: string | null | undefined): Locale | null {
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== LOCALE_COOKIE) continue;
    return strictLocale(decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return null;
}

/**
 * Append or replace `lang=` on a relative or absolute URL, keeping every other
 * query parameter and the hash. Relative input stays relative.
 */
export function withLang(href: string, lang: Locale): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const url = new URL(href, absolute ? undefined : 'http://relative.local');
  url.searchParams.set('lang', lang);
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}
