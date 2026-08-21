/**
 * Smoke test: IQ provider router resolves and MiMo client handles missing key.
 * Run: node scripts/test-iq-provider-router.mjs
 */
import assert from 'node:assert/strict';

process.env.IQ_PRIMARY_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'sk-test-openai-routing-only';
delete process.env.MIMO_API_KEY;

const { resolveIqRoute, shouldUseFullMarketContextForIqFull } = await import(
  '../lib/funnel/iq-provider-router.ts'
);

const partial = resolveIqRoute('iq_partial');
assert.equal(partial?.provider, 'openai', 'openai primary when IQ_PRIMARY_PROVIDER=openai');

const full = resolveIqRoute('iq_full');
assert.equal(full?.provider, 'openai');
assert.equal(shouldUseFullMarketContextForIqFull(), false);

process.env.IQ_PRIMARY_PROVIDER = 'mimo';
process.env.MIMO_API_KEY = 'sk-test';

const fullMimo = resolveIqRoute('iq_full');
assert.equal(fullMimo?.provider, 'mimo');
assert.equal(fullMimo?.thinking, true);
assert.equal(shouldUseFullMarketContextForIqFull(), true);

const { getMimoClient } = await import('../lib/funnel/llm/mimo-client.ts');
assert.ok(getMimoClient(), 'mimo client when key set');

delete process.env.MIMO_API_KEY;
assert.equal(getMimoClient(), null, 'mimo client null without key');

console.log('iq-provider-router smoke: OK');
