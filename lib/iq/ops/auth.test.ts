import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, isOpsAuthorized } from './auth';

function req(headers: Record<string, string>): Pick<Request, 'headers'> {
  return { headers: new Headers(headers) };
}

const verifyWorker = (h: string | null) => h === 'worker-ok';

test('ops auth: bearer token must match CRON_SECRET exactly', () => {
  const deps = { cronSecret: 's3cret', verifyWorker };
  assert.equal(isOpsAuthorized(req({ authorization: 'Bearer s3cret' }), deps), true);
  assert.equal(isOpsAuthorized(req({ Authorization: 'bearer s3cret' }), deps), true);
  assert.equal(isOpsAuthorized(req({ authorization: 'Bearer s3cret2' }), deps), false);
  assert.equal(isOpsAuthorized(req({ authorization: 'Bearer s3cre' }), deps), false);
  assert.equal(isOpsAuthorized(req({ authorization: 's3cret' }), deps), false);
  assert.equal(isOpsAuthorized(req({}), deps), false);
});

test('ops auth: bearer path is disabled without CRON_SECRET, worker secret still works', () => {
  const deps = { cronSecret: null, verifyWorker };
  assert.equal(isOpsAuthorized(req({ authorization: 'Bearer ' }), deps), false);
  assert.equal(isOpsAuthorized(req({ authorization: 'Bearer anything' }), deps), false);
  assert.equal(isOpsAuthorized(req({ 'x-iq-worker-secret': 'worker-ok' }), deps), true);
  assert.equal(isOpsAuthorized(req({ 'x-iq-worker-secret': 'worker-no' }), deps), false);
  assert.equal(isOpsAuthorized(req({ 'x-iq-worker-secret': '' }), deps), false);
});

test('ops auth: empty cron secret never matches an empty bearer', () => {
  assert.equal(isOpsAuthorized(req({ authorization: 'Bearer ' }), { cronSecret: '', verifyWorker: () => false }), false);
  assert.equal(bearerToken('Bearer  abc '), 'abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(null), null);
});

test('ops auth: default deps read CRON_SECRET from env and reject the worker path without a secret', () => {
  const prev = { cron: process.env.CRON_SECRET, worker: process.env.IQ_WORKER_SECRET, seed: process.env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    process.env.CRON_SECRET = 'env-secret';
    delete process.env.IQ_WORKER_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(isOpsAuthorized(req({ authorization: 'Bearer env-secret' })), true);
    assert.equal(isOpsAuthorized(req({ authorization: 'Bearer nope' })), false);
    assert.equal(isOpsAuthorized(req({ 'x-iq-worker-secret': 'x' })), false);
    process.env.IQ_WORKER_SECRET = 'w0rker';
    assert.equal(isOpsAuthorized(req({ 'x-iq-worker-secret': 'w0rker' })), true);
  } finally {
    if (prev.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev.cron;
    if (prev.worker === undefined) delete process.env.IQ_WORKER_SECRET;
    else process.env.IQ_WORKER_SECRET = prev.worker;
    if (prev.seed === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prev.seed;
  }
});
