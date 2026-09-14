'use client';

/**
 * Client-side locale: resolves `?lang=` > `iq_lang` (localStorage, then cookie)
 * > `navigator.language` > 'en', and persists every choice to both the cookie
 * (so server pages such as /iq/success and /iq/dashboard see it) and
 * localStorage (so it survives cookie clearing on the same device).
 */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './locale';
import { localeFromCookieString, resolveClientLocale, strictLocale, withLang } from './resolve';

const COOKIE_MAX_AGE_SEC = 365 * 86_400;

export function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromStorage = strictLocale(window.localStorage.getItem(LOCALE_COOKIE));
    if (fromStorage) return fromStorage;
  } catch {
    /* private mode / blocked storage */
  }
  try {
    return localeFromCookieString(document.cookie);
  } catch {
    return null;
  }
}

export function persistLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_COOKIE, locale);
  } catch {
    /* ignore */
  }
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

type Options = {
  /** Locale the server already resolved (cookie / Accept-Language) — avoids a flash of English. */
  initial?: Locale;
  /** Raw `?lang=` value from the URL; wins over everything else and is persisted. */
  param?: string | null;
  /** Keep `?lang=` on the current URL in sync when the user switches (history.replaceState). */
  syncUrl?: boolean;
};

export function useLocale(opts: Options = {}): { locale: Locale; setLocale: (next: Locale) => void } {
  const paramLocale = strictLocale(opts.param);
  const [locale, setLocaleState] = useState<Locale>(paramLocale ?? opts.initial ?? DEFAULT_LOCALE);
  const { initial, syncUrl } = opts;

  useEffect(() => {
    if (paramLocale) {
      persistLocale(paramLocale);
      setLocaleState(paramLocale); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    if (initial) {
      persistLocale(initial);
      return;
    }
    setLocaleState(resolveClientLocale({ stored: readStoredLocale(), navigatorLanguage: navigator.language }));
  }, [paramLocale, initial]);

  const setLocale = useCallback(
    (next: Locale) => {
      persistLocale(next);
      setLocaleState(next);
      if (syncUrl && typeof window !== 'undefined') {
        try {
          const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          window.history.replaceState(window.history.state, '', withLang(here, next));
        } catch {
          /* ignore */
        }
      }
    },
    [syncUrl],
  );

  return { locale, setLocale };
}
