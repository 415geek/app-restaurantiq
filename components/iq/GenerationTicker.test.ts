import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityOf, etaLabel, phaseOf, pickMessage, tickerMessages, tickerPhaseForStage } from './GenerationTicker';

test('cityOf extracts the city from US addresses', () => {
  assert.equal(cityOf('1115 Clement St, San Francisco, CA 94118'), 'San Francisco');
  assert.equal(cityOf('1711 El Camino Real, Millbrae, CA'), 'Millbrae');
  assert.equal(cityOf('Somewhere'), 'Somewhere');
});

test('ticker messages are address-aware with several distinct wordings per phase in every language', () => {
  const addr = '1115 Clement St, San Francisco, CA 94118';
  const zh = tickerMessages('zh', addr);
  assert.ok(zh.length >= 6);
  assert.ok(zh.every((g) => g.length >= 4));
  assert.ok(zh.some((g) => g.some((m) => m.includes('San Francisco'))));
  assert.ok(zh[1][0].includes('过往商家'));

  const en = tickerMessages('en', addr);
  const es = tickerMessages('es', addr);
  assert.equal(en.length, zh.length);
  assert.equal(es.length, zh.length);
  assert.ok(es.every((g) => g.length >= 4));
  assert.ok(es.some((g) => g.some((m) => m.includes('San Francisco'))));
  assert.ok(es[3][0].includes('competidores del mismo tipo de cocina'));
  assert.ok(es[4][1].includes('punto de equilibrio'));
  // No Chinese characters leak into the Spanish or English tickers.
  assert.ok(es.flat().every((m) => !/[一-鿿]/.test(m)));
  assert.ok(en.flat().every((m) => !/[一-鿿]/.test(m)));
  // No duplicate wording anywhere in a language.
  for (const g of [zh, en, es]) assert.equal(new Set(g.flat()).size, g.flat().length);
});

test('a long phase keeps saying new things and never repeats the previous line', () => {
  const groups = tickerMessages('zh', '1115 Clement St, San Francisco, CA 94118');
  const phase = phaseOf(81, groups.length);
  const seen: string[] = [];
  for (let tick = 0; tick < 12; tick++) seen.push(pickMessage(groups, phase, tick));
  // 12 ticks (one minute) show at least 10 different sentences.
  assert.ok(new Set(seen).size >= 10, `only ${new Set(seen).size} distinct lines`);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  // Starts with the phase's own first wording.
  assert.equal(seen[0], groups[phase][0]);
  // The last phase still rotates (no next phase to borrow from).
  const last = groups.length - 1;
  assert.equal(pickMessage(groups, last, 7), groups[last][7 % groups[last].length]);
});

test('eta: hidden during grace, counts down from the 3–5 min midpoint and never goes back up', () => {
  assert.equal(etaLabel('zh', 5, 10), null);
  assert.equal(etaLabel('zh', 30, 20), '预计还需约 3 分 30 秒');
  assert.equal(etaLabel('zh', 160, 60), '预计还需约 1 分 20 秒');
  assert.equal(etaLabel('zh', 185, 60), '预计还需不到 1 分钟');
  assert.equal(etaLabel('zh', 230, 60), '预计还需不到 1 分钟'); // never stretches back up
  assert.equal(etaLabel('zh', 260, 70), '比平时慢一些，正在收尾…');
  assert.equal(etaLabel('zh', 100, 95), '正在收尾，马上就好');
  assert.equal(etaLabel('en', 30, 20), 'About 3:30 to go');
  assert.equal(etaLabel('en', 210, 40), 'Under a minute to go');

  // Monotonic: the numeric remaining time parsed from consecutive seconds never increases.
  const secs = (label: string | null): number => {
    const m = label?.match(/(\d+) 分(?: (\d+) 秒)?/);
    if (!m) return label?.includes('不到 1 分钟') ? 59 : 0;
    return Number(m[1]) * 60 + Number(m[2] ?? 0);
  };
  let prev = Infinity;
  for (let t = 15; t < 400; t++) {
    const cur = secs(etaLabel('zh', t, 60));
    assert.ok(cur <= prev, `countdown went up at t=${t}: ${prev} → ${cur}`);
    prev = cur;
  }
});

test('eta: Spanish strings', () => {
  assert.equal(etaLabel('es', 5, 10), null);
  assert.equal(etaLabel('es', 30, 20), 'Faltan unos 3:30');
  assert.equal(etaLabel('es', 60, 20), 'Faltan unos 3 min');
  assert.equal(etaLabel('es', 210, 40), 'Falta menos de un minuto');
  assert.equal(etaLabel('es', 320, 70), 'Está tardando un poco más de lo normal; terminando…');
  assert.equal(etaLabel('es', 100, 95), 'Terminando; ya casi está');
});

test('ticker follows the real server stage when one is reported', () => {
  const groups = tickerMessages('zh', '1711 El Camino Real, Millbrae, CA');
  const n = groups.length;
  // competitors → demographics → finance → write → layout map onto ascending wording groups.
  const phases = [0, 1, 2, 3, 4].map((i) => tickerPhaseForStage(i, n));
  for (let i = 1; i < phases.length; i++) assert.ok(phases[i] > phases[i - 1], `stage ${i} must move forward`);
  assert.equal(tickerPhaseForStage(4, n), n - 1, 'layout uses the last (排版 / proof) wording group');
  assert.ok(pickMessage(groups, tickerPhaseForStage(1, n), 0).includes('人口'), 'demographics stage talks about population');
  assert.ok(pickMessage(groups, tickerPhaseForStage(4, n), 1).includes('排版'), 'layout stage talks about layout');
  // Out-of-range indexes clamp instead of throwing.
  assert.equal(tickerPhaseForStage(99, n), n - 1);
  assert.equal(tickerPhaseForStage(-3, n), 0);
});
