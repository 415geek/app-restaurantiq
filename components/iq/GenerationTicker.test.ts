import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityOf, etaLabel, tickerMessages } from './GenerationTicker';

test('cityOf extracts the city from US addresses', () => {
  assert.equal(cityOf('1115 Clement St, San Francisco, CA 94118'), 'San Francisco');
  assert.equal(cityOf('1711 El Camino Real, Millbrae, CA'), 'Millbrae');
  assert.equal(cityOf('Somewhere'), 'Somewhere');
});

test('ticker messages are address-aware and have two wordings per phase in every language', () => {
  const addr = '1115 Clement St, San Francisco, CA 94118';
  const zh = tickerMessages('zh', addr);
  assert.ok(zh.length >= 6);
  assert.ok(zh.every((g) => g.length === 2));
  assert.ok(zh.some((g) => g.some((m) => m.includes('San Francisco'))));
  assert.ok(zh[1][0].includes('过往商家'));

  const en = tickerMessages('en', addr);
  const es = tickerMessages('es', addr);
  assert.equal(en.length, zh.length);
  assert.equal(es.length, zh.length);
  assert.ok(es.every((g) => g.length === 2));
  assert.ok(es.some((g) => g.some((m) => m.includes('San Francisco'))));
  assert.ok(es[3][0].includes('competidores del mismo tipo de cocina'));
  assert.ok(es[4][1].includes('punto de equilibrio'));
  // No Chinese characters leak into the Spanish or English tickers.
  assert.ok(es.flat().every((m) => !/[一-鿿]/.test(m)));
  assert.ok(en.flat().every((m) => !/[一-鿿]/.test(m)));
});

test('eta: hidden during grace, counts down from 3 min, stretches instead of going negative', () => {
  assert.equal(etaLabel('zh', 5, 10), null);
  assert.equal(etaLabel('zh', 30, 20), '预计还需约 2 分 30 秒');
  assert.equal(etaLabel('zh', 170, 60), '预计还需约 2 分 10 秒'); // stretched to the 5-min anchor near the 3-min mark
  assert.equal(etaLabel('zh', 320, 70), '比平时慢一些，正在收尾…');
  assert.equal(etaLabel('zh', 100, 95), '正在收尾，马上就好');
  assert.equal(etaLabel('en', 30, 20), 'About 2:30 to go');
  assert.equal(etaLabel('en', 150, 40), 'Under a minute to go');
});

test('eta: Spanish strings', () => {
  assert.equal(etaLabel('es', 5, 10), null);
  assert.equal(etaLabel('es', 30, 20), 'Faltan unos 2:30');
  assert.equal(etaLabel('es', 60, 20), 'Faltan unos 2 min');
  assert.equal(etaLabel('es', 150, 40), 'Falta menos de un minuto');
  assert.equal(etaLabel('es', 320, 70), 'Está tardando un poco más de lo normal; terminando…');
  assert.equal(etaLabel('es', 100, 95), 'Terminando; ya casi está');
});
