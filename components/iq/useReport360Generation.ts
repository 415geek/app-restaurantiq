'use client';

/**
 * Shared 360° generation state for the report page.
 *
 *   - Report360Panel (model not generated yet): `pollOnMount` + `autoKick` —
 *     polls GET /api/iq/report360/:id, kicks POST once when not ready, and
 *     calls `onReady` when the model lands.
 *   - Report360Footer (document on screen): idle until `regenerate()` forces a
 *     new model (POST ?force=1) and then polls until `generated_at` changes.
 *
 * After a forced regen the old model stays `ready` until overwritten, so a
 * status whose generated_at equals the one we asked to replace is reported as
 * not ready (≤ REGEN_MAX_TICKS polls ≈ 6 min, then `timeoutMessage`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Report360Status = {
  ready: boolean;
  tier: string | null;
  generated_at: string | null;
  cost_usd: number | null;
  total: number | null;
  verdict: string | null;
  migration_needed?: boolean;
  precheck_reasons?: string[];
};

const REGEN_MAX_TICKS = 60;
const POLL_MS = 6_000;
const MIGRATION_POLL_MS = 30_000;

type Options = {
  reportId: string;
  /** Poll from mount (the not-ready panel). The footer polls only after `regenerate()`. */
  pollOnMount?: boolean;
  /** Start generation when the first poll says the model is missing. */
  autoKick?: boolean;
  /** Fired once a fresh model is ready (a status observed while polling). */
  onReady?: (status: Report360Status) => void;
  failedMessage: string;
  timeoutMessage: string;
};

export function useReport360Generation({ reportId, pollOnMount = false, autoKick = false, onReady, failedMessage, timeoutMessage }: Options) {
  const [status, setStatus] = useState<Report360Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(pollOnMount);
  const [error, setError] = useState<string | null>(null);
  const [pollRun, setPollRun] = useState(pollOnMount ? 1 : 0);
  const kicked = useRef(false);
  /** generated_at of the model we asked to replace; null when not regenerating. */
  const regenFrom = useRef<string | null>(null);
  const regenTicks = useRef(0);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const fetchStatus = useCallback(async (): Promise<Report360Status | null> => {
    try {
      const res = await fetch(`/api/iq/report360/${encodeURIComponent(reportId)}`, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as Report360Status;
    } catch {
      return null;
    }
  }, [reportId]);

  const kick = useCallback(
    async (force: boolean): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/iq/report360/${encodeURIComponent(reportId)}${force ? '?force=1' : ''}`, { method: 'POST' });
        if (!res.ok && res.status !== 202) {
          setError(failedMessage);
          return false;
        }
        return true;
      } catch {
        setError(failedMessage);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reportId, failedMessage],
  );

  /** Force a regeneration and poll until a newer model lands (then `onReady`). */
  const regenerate = useCallback(async (): Promise<boolean> => {
    const before = status?.generated_at ?? (await fetchStatus())?.generated_at ?? null;
    const ok = await kick(true);
    if (!ok) return false;
    regenFrom.current = before;
    regenTicks.current = 0;
    setStatus((s) => (s ? { ...s, ready: false } : s));
    setGenerating(true);
    setPollRun((k) => k + 1);
    return true;
  }, [status, fetchStatus, kick]);

  useEffect(() => {
    if (pollRun === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      const j = await fetchStatus();
      if (stopped) return;
      if (j) {
        const stale = regenFrom.current != null && j.ready && j.generated_at === regenFrom.current;
        if (stale && regenTicks.current >= REGEN_MAX_TICKS) {
          // The new model never landed: keep the current document, report the timeout.
          regenFrom.current = null;
          setStatus(j);
          setGenerating(false);
          setError(timeoutMessage);
          return;
        }
        if (stale) {
          regenTicks.current += 1;
          setStatus({ ...j, ready: false });
        } else {
          regenFrom.current = null;
          setStatus(j);
          if (j.ready) {
            setGenerating(false);
            onReadyRef.current?.(j);
            return;
          }
          if (autoKick && !j.migration_needed && !kicked.current) {
            kicked.current = true;
            await kick(false);
            if (stopped) return;
          }
        }
      }
      timer = setTimeout(tick, j?.migration_needed ? MIGRATION_POLL_MS : POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollRun, fetchStatus, kick, autoKick, timeoutMessage]);

  return { status, busy, generating, error, regenerate };
}
