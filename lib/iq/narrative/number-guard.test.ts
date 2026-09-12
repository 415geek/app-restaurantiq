import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNarrativeNumbers, numberGuard } from './number-guard';

const fragment = { demand: { captured_monthly_usd: 116_432, coverage_ratio: 1.12 }, trade_area: { rings: [{ id: 'drive10', hh: 41_230, chinese_hh_share: 0.31 }] } };

test('numbers present in the fragment pass (incl. 万 / % formatting)', () => {
  const r = numberGuard('模型捕获月需求 $11.6 万 [src:demand.captured_monthly_usd]，覆盖保本线 112% [src:demand.coverage_ratio]；车程 10 分钟内 4.1 万户 [src:trade_area.rings.0.hh]，中文家庭占比 31% [src:trade_area.rings.0.chinese_hh_share]。', fragment);
  assert.deepEqual(r.unmatched, []);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('a number not in the fragment fails; banned words fail; missing refs fail', () => {
  const r = numberGuard('租金溢价 127% [src:demand.coverage_ratio]，保守估计零竞争。', fragment);
  assert.ok(r.unmatched.includes('127%'));
  assert.ok(r.banned.includes('保守估计') && r.banned.includes('零竞争'));
  assert.equal(r.ok, false);
  const noRef = numberGuard('覆盖保本线 112%。', fragment);
  assert.equal(noRef.missing_refs, true);
  const voidOk = numberGuard('该品类为空白 [src:competitors.void.is_void]', { competitors: { void: { is_void: true } } }, { isVoid: true });
  assert.deepEqual(voidOk.banned, []);
});

test('extractor ignores citation paths, ring ids and years', () => {
  const nums = extractNarrativeNumbers('drive10 内 [src:trade_area.rings.2.pop] 2024 年 4.1 万户');
  assert.deepEqual(nums.map((n) => n.value), [41_000]);
});

test('a coverage ratio above 1 written as a percentage matches (1.72 → 172%)', () => {
  const r = numberGuard('需求覆盖率 172% [src:demand.coverage_ratio]', { demand: { coverage_ratio: 1.72 } });
  assert.deepEqual(r.unmatched, []);
  const bad = numberGuard('需求覆盖率 190% [src:demand.coverage_ratio]', { demand: { coverage_ratio: 1.72 } });
  assert.deepEqual(bad.unmatched, ['190%']);
});
