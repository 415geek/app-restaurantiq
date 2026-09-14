import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, normalizeReportId } from './iq-support-recover';

test('normalizeEmail trims, lowercases and rejects junk', () => {
  assert.equal(normalizeEmail('  Owner@Example.com '), 'owner@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('a@b'), null);
  assert.equal(normalizeEmail(42), null);
});

test('normalizeReportId accepts only UUIDs', () => {
  assert.equal(normalizeReportId(' 5c361b95-0ccf-4550-bd3e-5a33ca3a6fe9 '), '5c361b95-0ccf-4550-bd3e-5a33ca3a6fe9');
  assert.equal(normalizeReportId('5c361b95'), null);
  assert.equal(normalizeReportId("'; drop table x; --"), null);
});
