import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYZE_CACHE_TTL_MS,
  analyzeCacheKey,
  isAnalyzeCacheFresh,
  normalizeAnalyzeInputs,
  readStoredFreeResult,
} from './iq-analyze-cache';

test('analyze cache: normalisation ignores case, whitespace, trailing punctuation and number formatting', () => {
  const a = normalizeAnalyzeInputs({
    location: '  1711 El Camino Real ,Millbrae,  CA 94030. ',
    businessType: ' Hunan  Cuisine, ',
    monthlyRentUsd: '$12,000',
    sqft: '2,200',
    language: 'ZH',
  });
  const b = normalizeAnalyzeInputs({
    location: '1711 el camino real, millbrae, ca 94030',
    businessType: 'hunan cuisine',
    monthlyRentUsd: 12000,
    sqft: 2200,
    language: 'zh',
  });
  assert.deepEqual(a, b);
  assert.equal(a.location, '1711 el camino real, millbrae, ca 94030');
  assert.equal(a.businessType, 'hunan cuisine');
  assert.equal(a.monthlyRentUsd, 12000);
  assert.equal(a.sqft, 2200);
  assert.equal(a.language, 'zh');
  assert.equal(analyzeCacheKey({ location: a.location, businessType: 'HUNAN CUISINE', monthlyRentUsd: '12000', sqft: '2200', language: 'zh' }), analyzeCacheKey(b));
});

test('analyze cache: the key is a stable sha256 hex that changes with any input dimension', () => {
  const base = { location: '1 Main St, San Mateo, CA', businessType: 'boba', monthlyRentUsd: 5000, sqft: 1200, language: 'en' as const };
  const k = analyzeCacheKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(analyzeCacheKey({ ...base }), k);
  assert.notEqual(analyzeCacheKey({ ...base, language: 'es' }), k);
  assert.notEqual(analyzeCacheKey({ ...base, monthlyRentUsd: 5001 }), k);
  assert.notEqual(analyzeCacheKey({ ...base, sqft: null }), k);
  assert.notEqual(analyzeCacheKey({ ...base, businessType: 'hot pot' }), k);
  assert.notEqual(analyzeCacheKey({ ...base, location: '2 Main St, San Mateo, CA' }), k);
  assert.notEqual(analyzeCacheKey({ ...base, conceptId: 'boba' }), k);
  // Missing / blank / junk rent and size all normalise to null.
  assert.equal(analyzeCacheKey({ ...base, monthlyRentUsd: undefined, sqft: '' }), analyzeCacheKey({ ...base, monthlyRentUsd: 'n/a', sqft: 0 }));
  // Unknown language falls back to English rather than producing a distinct key.
  assert.equal(analyzeCacheKey({ ...base, language: 'fr' }), analyzeCacheKey({ ...base, language: 'en' }));
});

test('analyze cache: 24 h freshness window', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  assert.equal(isAnalyzeCacheFresh(new Date(now - 60_000).toISOString(), now), true);
  assert.equal(isAnalyzeCacheFresh(new Date(now - ANALYZE_CACHE_TTL_MS + 1000).toISOString(), now), true);
  assert.equal(isAnalyzeCacheFresh(new Date(now - ANALYZE_CACHE_TTL_MS - 1000).toISOString(), now), false);
  assert.equal(isAnalyzeCacheFresh(null, now), false);
  assert.equal(isAnalyzeCacheFresh('not a date', now), false);
});

test('analyze cache: stored free result round-trips and rejects incomplete payloads', () => {
  assert.equal(readStoredFreeResult(null), null);
  assert.equal(readStoredFreeResult({ free_result: { headline: 'x' } }), null);
  const r = readStoredFreeResult({
    free_result: {
      verdict: 'caution',
      headline: 'h',
      subheadline: 's',
      market_snapshot: ['a', 2, 'b'],
      hidden_risk: 'r',
      paywall_teaser: 't',
      decision_tier: 'go_with_conditions',
      risk_audit_preview: { overall_score: 61 },
    },
  });
  assert.ok(r);
  assert.deepEqual(r.market_snapshot, ['a', 'b']);
  assert.equal(r.decision_tier, 'go_with_conditions');
  assert.deepEqual(r.risk_audit_preview, { overall_score: 61 });
});
