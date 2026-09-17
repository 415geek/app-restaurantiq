import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ETA_DEFAULT_MINUTES,
  ETA_MIN_SAMPLES,
  etaMinutesFromMs,
  etaSubtitle,
  etaTier,
  monotonicRemainingSec,
  p50,
  tierEtaFromHistory,
} from './iq-eta';
import { LOCALES } from '@/lib/i18n/locale';

const MIN = 60_000;
/** n samples of the same duration — enough history for the median to be used. */
const runs = (minutes: number, n = ETA_MIN_SAMPLES) => Array.from({ length: n }, () => minutes * MIN);

test('p50: lower-half median for odd counts, midpoint for even, null when empty', () => {
  assert.equal(p50([]), null);
  assert.equal(p50([5]), 5);
  assert.equal(p50([9, 1, 5]), 5);
  assert.equal(p50([1, 2, 3, 4]), 2.5);
  // Outliers move the mean, not the median — that is the point of using P50.
  assert.equal(p50([1, 2, 3, 4, 500]), 3);
});

test('tier ETA falls back to the static 4 / 12 minutes below 30 runs of that tier', () => {
  assert.equal(etaTier('professional'), 'professional');
  assert.equal(etaTier('standard'), 'standard');
  assert.equal(etaTier(null), 'standard', 'an unknown mode reads as the standard tier');

  for (const n of [0, 1, 7, ETA_MIN_SAMPLES - 1]) {
    const std = tierEtaFromHistory('standard', runs(9, n));
    assert.equal(std.source, 'default', `${n} runs must not drive the ETA`);
    assert.equal(std.minutes, ETA_DEFAULT_MINUTES.standard);
    assert.equal(std.seconds, 4 * 60);

    const pro = tierEtaFromHistory('professional', runs(30, n));
    assert.equal(pro.source, 'default');
    assert.equal(pro.minutes, ETA_DEFAULT_MINUTES.professional);
    assert.equal(pro.seconds, 12 * 60);
  }
});

test('tier ETA is the P50 of the last 30 runs once there are 30 of them', () => {
  // 30 runs: fifteen fast, fifteen slow → the median sits between them.
  const mixed = [...runs(3, 15), ...runs(7, 15)];
  const eta = tierEtaFromHistory('standard', mixed);
  assert.equal(eta.source, 'p50');
  assert.equal(eta.minutes, 5);
  assert.equal(eta.seconds, 5 * 60);

  // One absurd run cannot move it (a mean would have).
  const withOutlier = [...runs(3, 15), ...runs(7, 14), 55 * MIN];
  assert.equal(tierEtaFromHistory('standard', withOutlier).minutes, 5);

  // Only the newest 30 count: the 30 recent slow runs win over older fast ones.
  const windowed = [...runs(11, 30), ...runs(2, 40)];
  assert.equal(tierEtaFromHistory('professional', windowed).minutes, 11);

  // Implausible samples (a crashed worker, clock skew) are dropped, which can
  // take the usable count back under the threshold.
  const junk = [...runs(4, 29), 1_000, -5, 9 * 60 * MIN];
  assert.equal(tierEtaFromHistory('standard', junk).source, 'default');
});

test('ETA rounding is human and never zero minutes', () => {
  assert.equal(etaMinutesFromMs(0), 1);
  assert.equal(etaMinutesFromMs(1_000), 1, 'a sub-minute median still reads as 1 minute');
  assert.equal(etaMinutesFromMs(89_000), 1);
  assert.equal(etaMinutesFromMs(91_000), 2);
  assert.equal(etaMinutesFromMs(11.6 * MIN), 12);
  // Even 30 runs of 20 seconds each never produce "0 minutes".
  const fast = tierEtaFromHistory('standard', runs(0.4));
  assert.equal(fast.minutes, 1);
  assert.ok(fast.seconds >= 60);
});

test('remaining time is clamped monotonic: a later, larger ETA can only pull it down', () => {
  // Plain countdown against a fixed total.
  assert.equal(monotonicRemainingSec({ totalSec: 240, elapsedSec: 0 }), 240);
  assert.equal(monotonicRemainingSec({ totalSec: 240, elapsedSec: 180 }), 60);
  assert.equal(monotonicRemainingSec({ totalSec: 240, elapsedSec: 999 }), 0, 'never negative');

  // The reported bug: at 3:00 elapsed the standard anchor says 60s left, then the
  // poll reports the 12-minute professional tier. The number must stay at 60s.
  const before = monotonicRemainingSec({ totalSec: 240, elapsedSec: 180 });
  const after = monotonicRemainingSec({ totalSec: 720, elapsedSec: 181, previous: before });
  assert.equal(before, 60);
  assert.ok(after <= before, `remaining jumped back up: ${before} → ${after}`);

  // Walk a whole run with the ETA doubling halfway through: never increases.
  let prev: number | null = null;
  for (let t = 0; t <= 900; t++) {
    const total = t < 300 ? 240 : 720;
    const cur: number = monotonicRemainingSec({ totalSec: total, elapsedSec: t, previous: prev });
    if (prev != null) assert.ok(cur <= prev, `countdown went up at t=${t}: ${prev} → ${cur}`);
    prev = cur;
  }
  assert.equal(prev, 0);
});

test('ETA subtitle reads naturally in all three languages', () => {
  assert.equal(etaSubtitle('en', 4), 'About 4 minutes');
  assert.equal(etaSubtitle('zh', 4), '约 4 分钟');
  assert.equal(etaSubtitle('es', 4), 'Unos 4 minutos');
  assert.equal(etaSubtitle('en', 12), 'About 12 minutes');
  assert.equal(etaSubtitle('zh', 12), '约 12 分钟');
  assert.equal(etaSubtitle('es', 12), 'Unos 12 minutos');
  // Singular, and never "0 minutes".
  assert.equal(etaSubtitle('en', 1), 'About 1 minute');
  assert.equal(etaSubtitle('es', 1), 'Alrededor de 1 minuto');
  for (const lang of LOCALES) assert.ok(/[1-9]/.test(etaSubtitle(lang, 0)), `${lang} showed a zero ETA`);
  // No Chinese leaks into the English or Spanish copy.
  for (const lang of ['en', 'es'] as const) assert.ok(!/[一-鿿]/.test(etaSubtitle(lang, 7)));
});
