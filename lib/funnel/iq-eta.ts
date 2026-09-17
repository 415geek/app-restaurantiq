/**
 * 分档 ETA + monotonic countdown for the paid-report wait screen (评审 Spec §4.7 P1-f).
 *
 * The two tiers are minutes apart — the standard pass skips deep research and
 * dual-model verification, the professional one runs both — so one generic
 * "3–5 minutes" was wrong for everybody. The number shown is the **P50 of the
 * last 30 completed runs of the same tier**, measured wall-clock (that is what
 * the visitor actually waits), with the static defaults standing in until there
 * is that much history: a median over three runs is noise, and an ETA that
 * swings between page loads is worse than a slightly stale one.
 *
 * Everything here is pure; the history comes from the job rows
 * (`iqRecentGenerationDurationsMs`, migration 0008 columns).
 */

import type { Locale } from '@/lib/i18n/locale';

export type EtaTier = 'standard' | 'professional';
export type EtaSource = 'p50' | 'default';
export type TierEta = { seconds: number; minutes: number; source: EtaSource };

/** Spec figures: standard ≈ 4 min, professional (360°) ≈ 12 min. */
export const ETA_DEFAULT_MINUTES: Record<EtaTier, number> = { standard: 4, professional: 12 };

/** Fewer completed runs than this and the static default is used instead of the median. */
export const ETA_MIN_SAMPLES = 30;
/** Only the newest N runs of a tier feed the median, so an old slow build ages out. */
export const ETA_SAMPLE_WINDOW = 30;

/** Runs outside this band are worker crashes or clock skew, not waits anyone sat through. */
const MIN_SAMPLE_MS = 15_000;
const MAX_SAMPLE_MS = 60 * 60_000;

export function etaTier(mode: string | null | undefined): EtaTier {
  return mode === 'professional' ? 'professional' : 'standard';
}

/** Lower median (the 15th of 30 sorted samples); null when there is nothing to take it from. */
export function p50(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid] + sorted[mid + 1]) / 2;
}

/** Never "0 minutes": the wait screen only exists because the work takes minutes. */
export function etaMinutesFromMs(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * The ETA to show for a tier. `durationsMs` are completed runs of THAT tier,
 * newest first; anything beyond the window is ignored.
 */
export function tierEtaFromHistory(mode: string | null | undefined, durationsMs: readonly number[]): TierEta {
  const tier = etaTier(mode);
  const usable = durationsMs.filter((v) => Number.isFinite(v) && v >= MIN_SAMPLE_MS && v <= MAX_SAMPLE_MS).slice(0, ETA_SAMPLE_WINDOW);
  const median = usable.length >= ETA_MIN_SAMPLES ? p50(usable) : null;
  if (median == null) {
    const minutes = ETA_DEFAULT_MINUTES[tier];
    return { seconds: minutes * 60, minutes, source: 'default' };
  }
  const minutes = etaMinutesFromMs(median);
  return { seconds: minutes * 60, minutes, source: 'p50' };
}

/**
 * §4.7: the remaining time may never grow during one generation — the old bug
 * had it jump from 1 minute back to 2+ when a slower tier ETA arrived mid-run.
 * A newer (or larger) ETA can only pull the number DOWN; `previous` is the last
 * value this visitor was shown.
 */
export function monotonicRemainingSec(input: {
  totalSec: number;
  elapsedSec: number;
  previous?: number | null;
}): number {
  const raw = Math.max(0, Math.round(input.totalSec - input.elapsedSec));
  const prev = input.previous;
  if (prev == null || !Number.isFinite(prev)) return raw;
  return Math.min(Math.max(0, Math.round(prev)), raw);
}

const ETA_COPY: Record<Locale, (minutes: number) => string> = {
  en: (m) => (m === 1 ? 'About 1 minute' : `About ${m} minutes`),
  zh: (m) => `约 ${m} 分钟`,
  es: (m) => (m === 1 ? 'Alrededor de 1 minuto' : `Unos ${m} minutos`),
};

/** "About 4 minutes" / 「约 4 分钟」 / "Unos 12 minutos" for the wait-screen subtitle. */
export function etaSubtitle(lang: Locale, minutes: number): string {
  return ETA_COPY[lang](Math.max(1, Math.round(minutes)));
}
