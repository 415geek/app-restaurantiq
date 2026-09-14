import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from './locale';
import { strictLocale } from './resolve';

/**
 * Server-side locale for the funnel pages (`/iq/**` is force-dynamic, so
 * reading cookies / headers is fine):
 *
 *   `?lang=` param  >  `preferred` (e.g. the report row's `language`)  >
 *   `iq_lang` cookie  >  Accept-Language  >  'en'
 */
export async function resolveServerLocale(
  opts: { param?: string | string[] | null; preferred?: string | null } = {},
): Promise<Locale> {
  const param = Array.isArray(opts.param) ? opts.param[0] : opts.param;
  const fromParam = strictLocale(param);
  if (fromParam) return fromParam;
  const fromPreferred = strictLocale(opts.preferred);
  if (fromPreferred) return fromPreferred;
  try {
    const fromCookie = strictLocale((await cookies()).get(LOCALE_COOKIE)?.value);
    if (fromCookie) return fromCookie;
  } catch {
    /* outside a request scope */
  }
  try {
    return localeFromAcceptLanguage((await headers()).get('accept-language'));
  } catch {
    return 'en';
  }
}
