/*
 * Fill this smoke script with a real PloyKit runtime + real service check before
 * release claims. Mock evidence is not enough for signing, tenant isolation,
 * idempotency, quota, one-time token, lease/retry, or state-machine behavior.
 */

console.log(JSON.stringify({
  ok: false,
  module: '__MODULE_ID__',
  check: 'service-backed-live-smoke',
  message: 'Implement this script against the real service before release.',
}));
