import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localeFromCookieString, resolveClientLocale, strictLocale, withLang } from './resolve';

test('strictLocale accepts only supported languages and returns null otherwise', () => {
  assert.equal(strictLocale('es-419'), 'es');
  assert.equal(strictLocale(' ZH '), 'zh');
  assert.equal(strictLocale('en-US'), 'en');
  assert.equal(strictLocale('fr'), null);
  assert.equal(strictLocale(''), null);
  assert.equal(strictLocale(undefined), null);
});

test('resolveClientLocale: param > stored > navigator > en', () => {
  assert.equal(resolveClientLocale({ param: 'es', stored: 'zh', navigatorLanguage: 'en-US' }), 'es');
  assert.equal(resolveClientLocale({ param: 'fr', stored: 'zh', navigatorLanguage: 'en-US' }), 'zh');
  assert.equal(resolveClientLocale({ stored: null, navigatorLanguage: 'es-MX' }), 'es');
  assert.equal(resolveClientLocale({ navigatorLanguage: 'de-DE' }), 'en');
  assert.equal(resolveClientLocale({}), 'en');
});

test('localeFromCookieString reads iq_lang among other cookies', () => {
  assert.equal(localeFromCookieString('a=1; iq_lang=zh; b=2'), 'zh');
  assert.equal(localeFromCookieString('iq_lang=es'), 'es');
  assert.equal(localeFromCookieString('other=iq_lang'), null);
  assert.equal(localeFromCookieString(''), null);
});

test('withLang appends or replaces lang on relative and absolute URLs', () => {
  assert.equal(withLang('/iq/login', 'es'), '/iq/login?lang=es');
  assert.equal(withLang('/iq/result?location=x&lang=zh#top', 'en'), '/iq/result?location=x&lang=en#top');
  assert.equal(withLang('https://app.restaurantiq.ai/iq/report/abc', 'zh'), 'https://app.restaurantiq.ai/iq/report/abc?lang=zh');
});
