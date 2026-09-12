import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMarketDataUserInputs, mergeUserInputs, reportInputsBodySchema, reportInputsSchema, REPORT_INPUTS_MAX_BODY_BYTES } from './iq-report-inputs';

test('report-inputs schema: coerces "$ , %" strings, splits lists, drops junk, caps lengths', () => {
  const parsed = reportInputsSchema.parse({
    seats: ' 60 ',
    ticket_in: '$24',
    ticket_delivery: 28,
    delivery_ratio: '25%',
    capex_usd: '$250,000',
    parking_spaces: '12',
    monthly_rent_usd: '$12,000',
    sqft: '2,200',
    existing_stores: '100 Main St, San Mateo, CA\n\n 200 Broadway, Millbrae, CA ',
    known_competitors: 'Hunan Home Kitchen, 湘水缘\nGolden Dragon; hunan home kitchen',
    listing_urls: 'https://www.loopnet.com/Listing/1 not-a-url\nhttp://x.example/2, https://www.loopnet.com/Listing/1',
    dayparts: ['lunch', 'DINNER', 'brunch', 'lunch'],
    notes: '  near a BART station  ',
    unknown_key: 'dropped',
  });
  assert.equal(parsed.seats, 60);
  assert.equal(parsed.ticket_in, 24);
  assert.equal(parsed.ticket_delivery, 28);
  assert.equal(parsed.delivery_ratio, 0.25);
  assert.equal(parsed.capex_usd, 250_000);
  assert.equal(parsed.parking_spaces, 12);
  assert.equal(parsed.monthly_rent_usd, 12_000);
  assert.equal(parsed.sqft, 2_200);
  assert.deepEqual(parsed.existing_stores, ['100 Main St, San Mateo, CA', '200 Broadway, Millbrae, CA']);
  assert.deepEqual(parsed.known_competitors, ['Hunan Home Kitchen', '湘水缘', 'Golden Dragon']);
  assert.deepEqual(parsed.listing_urls, ['https://www.loopnet.com/Listing/1', 'http://x.example/2']);
  assert.deepEqual(parsed.dayparts, ['lunch', 'dinner']);
  assert.equal(parsed.notes, 'near a BART station');
  assert.ok(!('unknown_key' in parsed));

  // Blank → null / [] / '' (never an error); ratio in 0–1 form is kept.
  const blank = reportInputsSchema.parse({ seats: '', ticket_in: 'abc', delivery_ratio: 0.3, known_competitors: [], notes: 7 });
  assert.equal(blank.seats, null);
  assert.equal(blank.ticket_in, null);
  assert.equal(blank.delivery_ratio, 0.3);
  assert.deepEqual(blank.known_competitors, []);
  assert.equal(blank.notes, '');
  assert.equal(blank.capex_usd, undefined);

  // Caps: ≤ 10 competitors, ≤ 5 stores / urls, notes ≤ 1000 chars, names ≤ 80 chars.
  const capped = reportInputsSchema.parse({
    known_competitors: Array.from({ length: 14 }, (_, i) => `Shop ${i}`),
    existing_stores: Array.from({ length: 8 }, (_, i) => `${i} Main St`),
    listing_urls: Array.from({ length: 8 }, (_, i) => `https://l.example/${i}`),
    notes: 'n'.repeat(2000),
  });
  assert.equal(capped.known_competitors!.length, 10);
  assert.equal(capped.existing_stores!.length, 5);
  assert.equal(capped.listing_urls!.length, 5);
  assert.equal(capped.notes!.length, 1000);
  assert.equal(reportInputsSchema.parse({ known_competitors: ['Y'.repeat(300)] }).known_competitors![0].length, 80);
});

test('report-inputs schema: rejects out-of-range numbers and bad bodies', () => {
  assert.equal(reportInputsSchema.safeParse({ seats: -5 }).success, false);
  assert.equal(reportInputsSchema.safeParse({ seats: 0 }).success, false);
  assert.equal(reportInputsSchema.safeParse({ seats: 99_999 }).success, false);
  assert.equal(reportInputsSchema.safeParse({ delivery_ratio: '150%' }).success, false);
  assert.equal(reportInputsSchema.safeParse({ capex_usd: 1e12 }).success, false);

  assert.equal(reportInputsBodySchema.safeParse({ inputs: {} }).success, false, 'reportId required');
  assert.equal(reportInputsBodySchema.safeParse({ reportId: '', inputs: {} }).success, false);
  assert.equal(reportInputsBodySchema.safeParse({ reportId: 'x'.repeat(65), inputs: {} }).success, false);
  assert.equal(reportInputsBodySchema.safeParse({ reportId: 'rpt_1' }).success, false, 'inputs required');
  const ok = reportInputsBodySchema.safeParse({ reportId: ' rpt_1 ', inputs: { seats: '40' } });
  assert.ok(ok.success);
  assert.equal(ok.data.reportId, 'rpt_1');
  assert.equal(ok.data.inputs.seats, 40);
  assert.equal(REPORT_INPUTS_MAX_BODY_BYTES, 20 * 1024);
});

test('report-inputs merge: keeps existing keys, blanks never overwrite, unknown keys survive', () => {
  const existing = { monthly_rent_usd: 12_000, sqft: 2_200, seats: 50, legacy_flag: true };
  const parsed = reportInputsSchema.parse({ seats: '60', ticket_in: '', known_competitors: 'A, B', dayparts: [], notes: '' });
  const merged = mergeUserInputs(existing, parsed);
  assert.deepEqual(merged, { monthly_rent_usd: 12_000, sqft: 2_200, seats: 60, legacy_flag: true, known_competitors: ['A', 'B'] });
  // Input object not mutated.
  assert.equal(existing.seats, 50);

  // No existing inputs / garbage existing → fresh object.
  assert.deepEqual(mergeUserInputs(undefined, reportInputsSchema.parse({ seats: 10 })), { seats: 10 });
  assert.deepEqual(mergeUserInputs('nope', reportInputsSchema.parse({ seats: 10 })), { seats: 10 });
  assert.deepEqual(mergeUserInputs([1, 2], reportInputsSchema.parse({})), {});

  // Whole market_data_json: sibling keys untouched, user_inputs merged.
  const md = { competitors: [{ name: 'X' }], user_inputs: { monthly_rent_usd: 9_000 }, cached_at: 't' };
  const { market, inputs } = mergeMarketDataUserInputs(md, reportInputsSchema.parse({ sqft: '1,500', listing_urls: 'https://a.example/1' }));
  assert.deepEqual(market.competitors, [{ name: 'X' }]);
  assert.equal(market.cached_at, 't');
  assert.deepEqual(inputs, { monthly_rent_usd: 9_000, sqft: 1_500, listing_urls: ['https://a.example/1'] });
  assert.equal(market.user_inputs, inputs);
  assert.deepEqual(mergeMarketDataUserInputs(null, reportInputsSchema.parse({ seats: 8 })).market, { user_inputs: { seats: 8 } });
});
