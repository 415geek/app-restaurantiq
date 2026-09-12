import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coercePositiveNumber, coerceRatio, normalizeUserInputs } from './user-inputs';

test('D12 coercion helpers', () => {
  assert.equal(coercePositiveNumber('$12,000'), 12000);
  assert.equal(coercePositiveNumber(' 2,200 '), 2200);
  assert.equal(coercePositiveNumber('24.5'), 24.5);
  assert.equal(coercePositiveNumber(0), null);
  assert.equal(coercePositiveNumber(-5), null);
  assert.equal(coercePositiveNumber(''), null);
  assert.equal(coercePositiveNumber('abc'), null);
  assert.equal(coercePositiveNumber(null), null);
  assert.equal(coercePositiveNumber(undefined), null);
  assert.equal(coercePositiveNumber(Number.NaN), null);

  assert.equal(coerceRatio(25), 0.25);
  assert.equal(coerceRatio('25%'), 0.25);
  assert.equal(coerceRatio(0.25), 0.25);
  assert.equal(coerceRatio(1), 1);
  assert.equal(coerceRatio(100), 1);
  assert.equal(coerceRatio(150), null);
  assert.equal(coerceRatio(0), null);
});

test('D12 normalizeUserInputs: golden-set style payload with string numbers', () => {
  const { input, result } = normalizeUserInputs({
    report_id: 'rpt_1',
    address: ' 1711 El Camino Real, Millbrae, CA 94030 ',
    cuisine: 'hunan',
    cuisine_text: '湘菜 Hunan restaurant',
    language: 'zh-CN',
    rent_usd: '$12,000',
    sqft: '2,200',
    seats: 60,
    capex_usd: '',
    ticket_in: '24',
    ticket_delivery: 28,
    delivery_ratio: 25,
    parking_spaces: '0',
    existing_stores: [{ address: '100 Main St, San Mateo, CA', lat: 37.56, lng: -122.32 }, 'ignored-empty ', ''],
    listing_urls: ['https://www.loopnet.com/Listing/1', 'ftp://nope', 'not a url', 'http://x.example/2', 'https://www.loopnet.com/Listing/1'],
  });
  assert.equal(result.id, 'D12');
  assert.equal(result.status, 'ok');
  assert.equal(result.data, input);
  assert.equal(input.report_id, 'rpt_1');
  assert.equal(input.address, '1711 El Camino Real, Millbrae, CA 94030');
  assert.equal(input.cuisine, 'hunan');
  assert.equal(input.language, 'zh');
  assert.equal(input.rent_usd, 12000);
  assert.equal(input.sqft, 2200);
  assert.equal(input.seats, 60);
  assert.equal(input.capex_usd, null);
  assert.equal(input.ticket_in, 24);
  assert.equal(input.ticket_delivery, 28);
  assert.equal(input.delivery_ratio, 0.25);
  assert.equal(input.parking_spaces, null);
  assert.deepEqual(input.existing_stores, [
    { address: '100 Main St, San Mateo, CA', lat: 37.56, lng: -122.32 },
    { address: 'ignored-empty' },
  ]);
  assert.deepEqual(input.listing_urls, ['https://www.loopnet.com/Listing/1', 'http://x.example/2']);
  assert.match(result.coverage_note, /已提供：月租、面积、座位数、堂食客单价、外卖客单价、外卖占比/);
  assert.match(result.coverage_note, /缺失：CapEx、车位数/);
  assert.match(result.coverage_note, /缺 CapEx → 回收期隐藏/);
  assert.match(result.coverage_note, /挂牌链接 2 条/);
  assert.equal(result.cost_usd, 0);
  assert.equal(result.cache, 'none');
});

test('D12 normalizeUserInputs: cuisine resolution paths', () => {
  assert.equal(normalizeUserInputs({ report_id: 'r', address: 'a', cuisine: 'hk_cafe' }).input.cuisine, 'hk_cafe');
  assert.equal(normalizeUserInputs({ report_id: 'r', address: 'a', cuisine: 'Boiling Point Hot Pot' }).input.cuisine, 'hot_pot');
  assert.equal(normalizeUserInputs({ report_id: 'r', address: 'a', cuisine: 'hk_cafe', cuisine_text: 'Sichuan' }).input.cuisine, 'sichuan');
  assert.equal(normalizeUserInputs({ report_id: 'r', address: 'a' }).input.cuisine, 'other_chinese');
  assert.equal(normalizeUserInputs({ report_id: 'r', address: 'a', cuisine: 'Golden Dragon' }).input.cuisine, 'other_chinese');
});

test('D12 normalizeUserInputs: empty payload → all null, English, note lists everything missing', () => {
  const { input, result } = normalizeUserInputs({ report_id: 'r2', address: 'X', delivery_ratio: '0.3' });
  assert.equal(input.language, 'en');
  assert.equal(input.rent_usd, null);
  assert.equal(input.delivery_ratio, 0.3);
  assert.deepEqual(input.listing_urls, []);
  assert.deepEqual(input.existing_stores, []);
  assert.match(result.coverage_note, /已提供：外卖占比/);
  assert.match(result.coverage_note, /缺 CapEx → 回收期隐藏/);
  assert.match(result.coverage_note, /缺租金或面积/);
});
