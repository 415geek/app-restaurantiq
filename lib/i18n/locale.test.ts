import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localeFromAcceptLanguage, pick, toLocale } from './locale';

test('toLocale coerces params, cookies and language tags; English is the default', () => {
  assert.equal(toLocale('zh'), 'zh');
  assert.equal(toLocale('zh-CN'), 'zh');
  assert.equal(toLocale('es-MX'), 'es');
  assert.equal(toLocale('EN-us'), 'en');
  assert.equal(toLocale('fr'), 'en');
  assert.equal(toLocale(undefined), 'en');
  assert.equal(toLocale(null, 'zh'), 'zh');
});

test('localeFromAcceptLanguage picks the first supported language', () => {
  assert.equal(localeFromAcceptLanguage('es-419,es;q=0.9,en;q=0.8'), 'es');
  assert.equal(localeFromAcceptLanguage('fr-FR,fr;q=0.9'), 'en');
  assert.equal(localeFromAcceptLanguage(null), 'en');
});

test('pick falls back from Spanish to English, never to Chinese', () => {
  assert.equal(pick('es', { en: 'Hi', zh: '你好' }), 'Hi');
  assert.equal(pick('es', { en: 'Hi', zh: '你好', es: 'Hola' }), 'Hola');
  assert.equal(pick('zh', { en: 'Hi', zh: '你好' }), '你好');
});
