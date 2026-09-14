/**
 * Site-wide locale contract.
 *
 * Three customer-facing languages. Standard U.S. English is the default for
 * every visitor; a visitor who picks 中文 or Español gets *everything* that
 * follows in that language — UI, progress copy, emails, the free analysis and
 * both report editions. The choice travels as `?lang=` on funnel URLs, is
 * remembered in the `iq_lang` cookie / localStorage, and is stored on the
 * report row (`language`) so server-side generation and PDFs use it too.
 *
 * `pick()` lets a dictionary omit `es` while translations land (falls back to
 * English, never to Chinese).
 */
export const LOCALES = ['en', 'zh', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'iq_lang';

export const LOCALE_LABEL: Record<Locale, string> = { en: 'English', zh: '中文', es: 'Español' };
/** BCP-47 tag for `lang` attributes. */
export const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', zh: 'zh-CN', es: 'es-US' };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Coerce anything (query param, cookie, DB column, Accept-Language) to a Locale. */
export function toLocale(v: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (isLocale(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s.startsWith('zh')) return 'zh';
    if (s.startsWith('es')) return 'es';
    if (s.startsWith('en')) return 'en';
  }
  return fallback;
}

/** Locale from an Accept-Language header (first supported language wins); English when none match. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('es')) return 'es';
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

export type Localized<T> = { en: T; zh: T; es?: T };

/** Read a localized value; Spanish falls back to English while a translation is missing. */
export function pick<T>(lang: Locale, m: Localized<T>): T {
  if (lang === 'es') return m.es ?? m.en;
  return m[lang];
}
