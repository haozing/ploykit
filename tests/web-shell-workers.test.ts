import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import { createScopedRunsApi } from '../apps/host-next/lib/capability-providers';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';
import {
  drainHostWorker,
  enqueueHostDemoJob,
  evaluateHostWorkerAlerts,
  getHostWorkerStatus,
  runHostWorkerLoop,
} from '../apps/host-next/lib/worker';

test('M6 host worker enqueues and drains a runtime-store job', async () => {
  const hostRuntime = await getHostRuntime();
  const run = await enqueueHostDemoJob(createDemoHostSession());
  const workerId = `web-shell-worker-${Date.now().toString(36)}`;
  const result = await drainHostWorker({ session: createDemoHostSession(), limit: 5, workerId });
  const deliveries = await hostRuntime.runtimeStore.store.listDeliveries({
    productId: 'demo-product',
    workerId,
  });
  const workers = await hostRuntime.runtimeStore.store.listWorkers({
    productId: 'demo-product',
    workerId,
  });

  assert.equal(run.status, 'queued');
  assert.equal(result.failed, 0);
  assert.equal(result.deadLettered, 0);
  assert.ok(result.processed >= 1);
  assert.ok(deliveries.some((delivery) => delivery.kind === 'job' && delivery.runId === run.id));
  assert.ok(deliveries.some((delivery) => delivery.kind === 'worker'));
  assert.equal(workers[0]?.workerId, workerId);
  assert.equal(workers[0]?.queueProfile, 'jobs-events-webhooks-email');
  assert.ok((workers[0]?.processed ?? 0) >= 1);
});

test('M6 host scoped runs API preserves owner metadata and module scope', async () => {
  const store = createInMemoryRuntimeStore();
  const session = createDemoHostSession();
  const contract = { id: 'runs-demo' } as Parameters<typeof createScopedRunsApi>[0]['contract'];
  const api = createScopedRunsApi({ contract, store, session });
  const run = await api.create({
    kind: 'manual',
    name: 'sync',
    input: { stage: 'queued' },
  });
  const progressed = await api.updateProgress(run.id, 135);
  await api.appendLog(run.id, 'info', 'Progress persisted.');
  const fetched = await api.get(run.id);
  const listed = await api.list({ name: 'sync' });
  const otherModuleApi = createScopedRunsApi({
    contract: { id: 'other-module' } as Parameters<typeof createScopedRunsApi>[0]['contract'],
    store,
    session,
  });

  assert.equal((run.input as { ownerId?: string }).ownerId, session.userId);
  assert.equal(progressed.progress, 100);
  assert.equal(fetched?.logs[0]?.message, 'Progress persisted.');
  assert.equal(listed.length, 1);
  assert.equal(await otherModuleApi.get(run.id), null);
  await assert.rejects(() => otherModuleApi.updateProgress(run.id, 10), /MODULE_RUN_NOT_FOUND/);
});

test('M6 host worker loop can run as a bounded production daemon iteration', async () => {
  await enqueueHostDemoJob(createDemoHostSession());
  const result = await runHostWorkerLoop({
    session: createDemoHostSession(),
    limit: 5,
    maxIterations: 1,
  });

  assert.equal(result.iterations, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.deadLettered, 0);
  assert.ok(result.processed >= 1);
  assert.ok(result.workerId.length > 0);
  assert.ok(result.durationMs >= 0);
  assert.ok(result.queueLagMs >= 0);
});

test('K6 host worker status reports heartbeat and queue lag', async () => {
  const status = await getHostWorkerStatus();
  const alerts = evaluateHostWorkerAlerts({
    heartbeatAt: new Date('2026-05-20T00:00:00.000Z').toISOString(),
    queue: {
      queued: 0,
      processing: 0,
      failed: 1,
      deadLettered: 1,
      oldestPendingAt: new Date('2026-05-19T23:50:00.000Z').toISOString(),
      lagMs: 600_000,
    },
    thresholds: {
      heartbeatStaleMs: 120_000,
      queueLagMs: 300_000,
      deadLettered: 0,
    },
    now: new Date('2026-05-20T00:01:00.000Z').getTime(),
  });

  assert.ok(status.workerId.length > 0);
  assert.ok(status.queue.queued >= 0);
  assert.ok(status.queue.lagMs >= 0);
  assert.ok(Array.isArray(status.alerts));
  assert.deepEqual(
    alerts.map((alert) => alert.code),
    ['worker.queue.lag', 'worker.queue.dead_letters', 'worker.queue.failed_messages']
  );
});
