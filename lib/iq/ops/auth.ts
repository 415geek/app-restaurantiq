/**
 * Auth for /api/iq/ops. Two callers are allowed:
 *   1. Vercel Cron — sends `Authorization: Bearer ${CRON_SECRET}` when the
 *      CRON_SECRET env var is set on the project.
 *   2. Ops / the report worker — sends `x-iq-worker-secret` (same secret the
 *      full-report worker uses; see lib/funnel/iq-report-job.ts).
 * Both comparisons are constant-time. Without CRON_SECRET the bearer path is
 * simply disabled (never "accept anything").
 */
import { timingSafeEqual } from 'node:crypto';
import { envValue } from '@/lib/env-value';
import { verifyWorkerSecret } from '@/lib/funnel/iq-report-job';

export interface OpsAuthDeps {
  /** Expected cron secret; `null` disables the bearer path. Defaults to env CRON_SECRET. */
  cronSecret?: string | null;
  /** Worker-secret verifier. Defaults to verifyWorkerSecret. */
  verifyWorker?: (header: string | null) => boolean;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m ? m[1].trim() : null;
}

export function isOpsAuthorized(req: Pick<Request, 'headers'>, deps: OpsAuthDeps = {}): boolean {
  const cronSecret = deps.cronSecret === undefined ? envValue('CRON_SECRET') : deps.cronSecret;
  const verifyWorker = deps.verifyWorker ?? verifyWorkerSecret;

  const token = bearerToken(req.headers.get('authorization'));
  if (cronSecret && token && safeEqual(token, cronSecret)) return true;

  const worker = req.headers.get('x-iq-worker-secret');
  if (worker && verifyWorker(worker)) return true;

  return false;
}
