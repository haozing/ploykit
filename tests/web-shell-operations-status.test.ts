import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getAdminProviderStatusView } from '../apps/host-next/lib/admin-provider-status';
import { getAdminWorkerStatusView } from '../apps/host-next/lib/admin-worker-status';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';

test('X11 admin provider status merges config doctor and provider matrix evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-provider-status-'));
  fs.mkdirSync(path.join(root, '.runtime', 'provider-matrix'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'provider-matrix', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: false,
      checkedAt: '2026-05-21T00:00:00.000Z',
      checks: [
        { id: 'provider-config:files', ok: true, detail: { mode: 'local' } },
        {
          id: 'provider-config:billing',
          ok: false,
          detail: {
            mode: 'stripe',
            requiredMissing: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_DEMO_PRO_MONTHLY'],
          },
          error: 'Missing required provider env: STRIPE_SECRET_KEY, STRIPE_PRICE_DEMO_PRO_MONTHLY',
        },
        {
          id: 'local-provider-depth',
          ok: true,
          detail: {
            checks: [
              { id: 'local-storage-put', ok: true },
              { id: 'local-billing-ledger-reconcile', ok: true },
            ],
            artifacts: { report: 'local-provider-smoke/smoke.json' },
          },
        },
      ],
    })
  );

  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.recordProviderInvocation({
    productId: DEFAULT_HOST_PRODUCT_ID,
    providerId: 'stripe',
    kind: 'payment',
    operation: 'checkout',
    status: 'failed',
    error: new Error('stripe unavailable'),
  });
  const status = await getAdminProviderStatusView({ projectRoot: root });
  const files = status.providers.find((provider) => provider.id === 'files');
  const billing = status.providers.find((provider) => provider.id === 'billing');

  assert.equal(status.matrix.exists, true);
  assert.equal(status.matrix.localDepth.ok, true);
  assert.equal(status.matrix.localDepth.checks, 2);
  assert.equal(files?.evidenceStatus, 'passed');
  assert.ok(
    files?.operations.some((operation) => operation.command?.includes('host:files-reconcile-smoke'))
  );
  assert.equal(billing?.evidenceStatus, 'failed');
  assert.ok(billing?.failureDetails.some((detail) => detail.missing.includes('STRIPE_SECRET_KEY')));
  assert.ok(billing?.failureTimeline.some((item) => item.error === 'stripe unavailable'));
  assert.ok(
    billing?.operations.some((operation) =>
      operation.command?.includes('host:stripe-smoke -- --required')
    )
  );
  assert.ok(status.providers.some((provider) => provider.id === 'security'));
});

test('X11 admin worker status merges queue status and worker soak evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-worker-status-'));
  fs.mkdirSync(path.join(root, '.runtime', 'worker-soak'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'worker-soak', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: false,
      checkedAt: '2026-05-21T00:00:00.000Z',
      durationMs: 25,
      enqueued: 2,
      drain: {
        iterations: 1,
        processed: 2,
        failed: 0,
        deadLettered: 0,
        queueLagMs: 0,
      },
      worker: {
        alerts: [],
      },
      artifacts: { report: 'worker-soak/soak.json' },
    })
  );

  const status = await getAdminWorkerStatusView({
    projectRoot: root,
    workerStatus: {
      workerId: 'worker-test',
      heartbeatAt: '2026-05-21T00:00:00.000Z',
      lastDrainAt: '2026-05-21T00:00:01.000Z',
      lastDurationMs: 25,
      lastResult: { processed: 2, failed: 0, deadLettered: 0, durationMs: 25 },
      queue: {
        queued: 0,
        processing: 0,
        failed: 0,
        deadLettered: 0,
        oldestPendingAt: null,
        lagMs: 0,
      },
      thresholds: {
        heartbeatStaleMs: 120_000,
        queueLagMs: 300_000,
        deadLettered: 0,
      },
      alerts: [],
    },
  });

  assert.equal(status.status, 'ready');
  assert.equal(status.soak.exists, true);
  assert.equal(status.soak.status, 'passed');
  assert.equal(status.soak.processed, 2);
  assert.equal(status.queue.deadLettered, 0);
});
