/**
 * The report dictionary must be complete in every language and the English /
 * Spanish editions must never fall through to Chinese.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '@/lib/i18n/locale';
import { hasCjk } from '../narrative/plain';
import { PAGES } from '../narrative/templates';
import { MAP_LANGUAGE, REPORT_STRINGS, fill, strings } from './i18n';

/** Every leaf path ("p4.rows.pop", "p13.steps.3.label") with its string value. */
function leaves(v: unknown, prefix = ''): Array<[string, string]> {
  if (typeof v === 'string') return [[prefix, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${prefix}.${i}`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, prefix ? `${prefix}.${k}` : k));
  return [];
}

test('every key exists in all three locales (no missing fallbacks)', () => {
  const en = leaves(REPORT_STRINGS.en);
  const enKeys = en.map(([k]) => k);
  assert.ok(enKeys.length > 500, `dictionary has ${enKeys.length} leaves`);
  for (const lang of LOCALES) {
    const keys = leaves(REPORT_STRINGS[lang]).map(([k]) => k);
    assert.deepEqual(keys, enKeys, `${lang} leaf set differs from en`);
    for (const [k, v] of leaves(REPORT_STRINGS[lang])) assert.ok(v.trim().length > 0 || k.endsWith('weakestNone'), `${lang}.${k} is empty`);
  }
  for (const p of PAGES) for (const lang of LOCALES) assert.ok(REPORT_STRINGS[lang].pages[p.id], `${lang} kicker for ${p.id}`);
});

test('no Chinese value leaks into the English or Spanish dictionary', () => {
  for (const lang of ['en', 'es'] as const) {
    const bad = leaves(REPORT_STRINGS[lang]).filter(([, v]) => hasCjk(v));
    assert.deepEqual(bad, [], `${lang} carries CJK: ${bad.map(([k]) => k).join(', ')}`);
  }
  // and an en / es value never equals the zh value unless it is language-neutral (brand, unit, "USD", "D0–7")
  const zh = new Map(leaves(REPORT_STRINGS.zh));
  for (const lang of ['en', 'es'] as const) {
    for (const [k, v] of leaves(REPORT_STRINGS[lang])) {
      const z = zh.get(k)!;
      if (v === z) assert.ok(!hasCjk(z), `${lang}.${k} reuses the Chinese value`);
    }
  }
  // Spanish is its own translation, not a copy of English, for the reader-facing labels
  const en = new Map(leaves(REPORT_STRINGS.en));
  const same = leaves(REPORT_STRINGS.es).filter(([k, v]) => en.get(k) === v && /[a-z]{4,}/i.test(v) && !/^(RestaurantIQ|USD|Mapbox|Google|Overture|D\d)/.test(v));
  assert.ok(same.length < 25, `${same.length} Spanish values are identical to English: ${same.slice(0, 10).map(([k]) => k).join(', ')}`);
});

test('verdict labels per language and placeholders', () => {
  assert.deepEqual(
    LOCALES.map((l) => strings(l).verdict.CONDITIONAL_GO.label),
    ['CONDITIONAL GO', '有条件可做', 'VIABLE CON CONDICIONES'],
  );
  assert.deepEqual(
    LOCALES.map((l) => strings(l).verdict.NO_GO.label),
    ['NO GO', '不建议', 'NO VIABLE'],
  );
  assert.equal(strings('zh').verdict.GO.badge, 'GO');
  assert.equal(strings('es').na, 'n/d');
  assert.equal(fill('{a} of {b}', { a: 1, b: 'x' }), '1 of x');
  assert.equal(fill('{missing}', {}), '');
  assert.deepEqual(MAP_LANGUAGE, { en: 'en', zh: 'zh-CN', es: 'es' });
  // engine ids never appear in reader-facing labels
  const jargon = /\b(walk10|drive5|drive10|drive15|coverage_ratio|cluster_score|Huff|HHI|P25|P75|CapEx)\b|\bL[1-4]\b|β|置信度/;
  for (const lang of LOCALES) {
    const hits = leaves(REPORT_STRINGS[lang]).filter(([, v]) => jargon.test(v));
    assert.deepEqual(hits, [], `${lang} labels leak engine ids`);
  }
});
