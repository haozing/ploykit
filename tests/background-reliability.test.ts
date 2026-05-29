import {
  createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule,
  Permission,
  type ModuleContext } from '@ploykit/module-sdk';
import {
  createInMemoryRuntimeStore,
  createModuleRuntimeHost,
  createRuntimeStoreQueue,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';
import {
  createRuntimeStoreEventBus,
  createRuntimeStoreJobRunner,
  createRuntimeStoreWebhookGateway,
  createRuntimeStoreWebhookRunner,
  createRuntimeTaskCenter,
} from '../src/lib/module-capabilities';

const reliableModule = defineModule({
  id: 'reliable-test',
  name: 'Reliable Test',
  version: '0.1.0',
  permissions: [Permission.EventsEmit, Permission.EventsSubscribe],
  jobs: {
    report: {
      handler: './jobs/report',
      retries: 1,
    },
  },
  events: {
    publishes: ['reliable.reported'],
    subscribes: {
      'reliable.reported': './events/reported',
    },
  },
});

const failingModule = defineModule({
  id: 'reliable-failing',
  name: 'Reliable Failing',
  version: '0.1.0',
  permissions: [Permission.EventsSubscribe],
  events: {
    subscribes: {
      'reliable.reported': './events/fail',
    },
  },
});

const webhookRunnerModule = defineModule({
  id: 'webhook-runner-test',
  name: 'Webhook Runner Test',
  version: '0.1.0',
  permissions: [Permission.WebhookReceive],
  webhooks: {
    inbound: {
      path: '/inbound',
      handler: './webhooks/inbound',
      methods: ['POST'],
      signature: 'none',
    },
  },
});

function createStore() {
  let nextId = 0;
  return createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (prefix) => `${prefix}_${++nextId}`,
  });
}

test('P17 runtime store queue retries failures, dead letters and supports replay', async () => {
  const store = createStore();
  const queue = createRuntimeStoreQueue({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  const message = await queue.enqueue({
    name: 'sync',
    payload: { ok: true },
    idempotencyKey: 'sync-1',
    maxAttempts: 2,
  });

  const first = await queue.drain({
    handler: () => {
      throw new Error('boom');
    },
  });
  const second = await queue.drain({
    handler: () => {
      throw new Error('boom');
    },
  });

  assert.equal(first.failed, 1);
  assert.equal(second.deadLettered, 1);
  assert.equal((await queue.list({ status: 'dead_letter' }))[0].id, message.id);
  assert.equal((await queue.replay(message.id)).status, 'queued');
});

test('X8 runtime store queue respects retry backoff, priority and lease reclaim', async () => {
  let now = new Date('2026-05-19T00:00:00.000Z');
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => now,
    createId: (prefix) => `${prefix}_${++nextId}`,
  });
  const queue = createRuntimeStoreQueue({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });

  const low = await queue.enqueue({ name: 'sync', payload: { order: 'low' }, priority: 1 });
  const high = await queue.enqueue({ name: 'sync', payload: { order: 'high' }, priority: 10 });
  const claimed = await store.claimOutbox({
    productId: 'product-a',
    limit: 1,
    leaseOwner: 'worker-a',
    leaseMs: 1000,
  });
  assert.equal(claimed[0].id, high.id);
  assert.equal(claimed[0].leaseOwner, 'worker-a');

  now = new Date('2026-05-19T00:00:02.000Z');
  const reclaimed = await store.claimOutbox({
    productId: 'product-a',
    limit: 1,
    leaseOwner: 'worker-b',
    leaseMs: 1000,
  });
  assert.equal(reclaimed[0].id, high.id);
  assert.equal(reclaimed[0].leaseOwner, 'worker-b');

  await store.markOutbox(high.id, 'processed');
  const failed = await queue.drain({
    retryBackoffMs: 60_000,
    handler: () => {
      throw new Error('temporary');
    },
  });
  assert.equal(failed.failed, 1);
  assert.equal(failed.records[0].id, low.id);
  assert.ok(failed.records[0].scheduledAt);

  const blocked = await queue.drain({
    handler: () => undefined,
  });
  assert.equal(blocked.records.length, 0);
});

test('P17 runtime store queue drains and lists only its workspace scope', async () => {
  const store = createStore();
  const queueA = createRuntimeStoreQueue({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  const queueB = createRuntimeStoreQueue({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-b',
  });
  const messageA = await queueA.enqueue({ name: 'sync', payload: { workspace: 'a' } });
  const messageB = await queueB.enqueue({ name: 'sync', payload: { workspace: 'b' } });

  const drained = await queueA.drain({
    handler: () => undefined,
  });

  assert.deepEqual(
    drained.records.map((record) => record.id),
    [messageA.id]
  );
  assert.deepEqual(
    (await queueA.list()).map((record) => record.id),
    [messageA.id]
  );
  assert.deepEqual(
    (await queueB.list()).map((record) => record.id),
    [messageB.id]
  );
  assert.deepEqual(
    (await queueB.list({ status: 'queued' })).map((record) => record.id),
    [messageB.id]
  );
});

test('P6 runtime store queue supports retry policy registry and permanent quarantine', async () => {
  let now = new Date('2026-05-19T00:00:00.000Z');
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => now,
    createId: (prefix) => `${prefix}_${++nextId}`,
  });
  const queue = createRuntimeStoreQueue({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });

  await queue.enqueue({
    name: 'policy:temporary',
    payload: {},
    maxAttempts: 4,
  });
  const temporary = await queue.drain({
    retryPolicy: {
      id: 'exponential',
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
      maxAttempts: 4,
      permanentErrorPatterns: ['do_not_retry'],
    },
    handler: () => {
      throw new Error('temporary_provider_failure');
    },
  });
  assert.equal(temporary.failed, 1);
  assert.equal(temporary.records[0]?.status, 'failed');
  assert.match(temporary.records[0]?.scheduledAt ?? '', /^\d{4}-\d{2}-\d{2}T/);

  now = new Date('2026-05-19T00:00:02.000Z');
  await queue.enqueue({
    name: 'policy:poison',
    payload: {},
    maxAttempts: 4,
  });
  const poison = await queue.drain({
    name: 'policy:poison',
    retryPolicy: {
      id: 'fixed',
      baseDelayMs: 1000,
      maxAttempts: 4,
      permanentErrorPatterns: ['do_not_retry'],
    },
    handler: () => {
      throw new Error('do_not_retry_invalid_payload');
    },
  });
  assert.equal(poison.deadLettered, 1);
  assert.equal(poison.records[0]?.status, 'dead_letter');
  assert.equal(poison.records[0]?.scheduledAt, undefined);

  now = new Date('2026-05-19T00:00:04.000Z');
  await queue.enqueue({
    name: 'policy:metadata',
    payload: {},
    retryPolicy: {
      id: 'linear',
      baseDelayMs: 1000,
      maxAttempts: 4,
      permanentErrorPatterns: ['do_not_retry'],
    },
  });
  const metadataPolicy = await queue.drain({
    name: 'policy:metadata',
    handler: () => {
      throw new Error('do_not_retry_config');
    },
  });
  assert.equal(metadataPolicy.deadLettered, 1);
  assert.equal(metadataPolicy.records[0]?.status, 'dead_letter');
});

test('P6 runtime store event bus records subscriber delivery and skips delivered subscribers', async () => {
  const seen: unknown[] = [];
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'reliable-test': {
        module: async () => ({ default: reliableModule }),
        events: {
          'events/reported': async () => ({
            default: async (_ctx: ModuleContext, event: { payload: unknown }) => {
              seen.push(event.payload);
            },
          }),
        },
      },
      'reliable-failing': {
        module: async () => ({ default: failingModule }),
        events: {
          'events/fail': async () => ({
            default: async () => {
              throw new Error('subscriber failed');
            },
          }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);
  const store = createStore();
  const bus = createRuntimeStoreEventBus(host, {
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });

  await bus.publish({
    moduleId: 'reliable-test',
    name: 'reliable.reported',
    payload: { ok: true },
    idempotencyKey: 'event-1',
    maxAttempts: 2,
  });
  const first = await bus.drain();
  const second = await bus.drain();
  const deliveries = await store.listDeliveries({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    kind: 'event',
  });

  assert.equal(first.failed, 1);
  assert.equal(second.deadLettered, 1);
  assert.deepEqual(seen, [{ ok: true }]);
  assert.equal((await bus.queue.list({ status: 'dead_letter' })).length, 1);
  assert.equal(deliveries.filter((record) => record.status === 'delivered').length, 1);
  assert.equal(deliveries.filter((record) => record.status === 'skipped').length, 1);
  assert.equal(deliveries.filter((record) => record.status === 'failed').length, 1);
  assert.equal(deliveries.filter((record) => record.status === 'dead_letter').length, 1);
  assert.equal(
    deliveries.filter((record) => record.target === 'reliable-test:events/reported').length,
    2
  );
  assert.equal(
    deliveries.filter((record) => record.target === 'reliable-failing:events/fail').length,
    2
  );
  assert.equal(second.handlers.find((handler) => handler.moduleId === 'reliable-test')?.skipped, true);
});

test('runtime store event bus only drains event records', async () => {
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'reliable-test': {
        module: async () => ({ default: reliableModule }),
        events: {
          'events/reported': async () => ({ default: async () => undefined }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);
  const store = createStore();
  const bus = createRuntimeStoreEventBus(host, {
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });

  await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'reliable-test',
    name: 'job:reliable-test:report',
    payload: {},
  });
  await bus.publish({
    moduleId: 'reliable-test',
    name: 'reliable.reported',
    payload: { ok: true },
  });
  const result = await bus.drain();

  assert.equal(result.processed, 1);
  assert.equal((await store.listOutbox({ productId: 'product-a', namePrefix: 'job:' }))[0].status, 'queued');
});

test('P17 runtime store webhook gateway deduplicates delivery and can replay receipts', async () => {
  const store = createStore();
  const gateway = createRuntimeStoreWebhookGateway({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    secretResolver: () => 'secret',
  });
  const bodyText = JSON.stringify({ value: 1 });
  const signature = `sha256=${createHmac('sha256', 'secret').update(bodyText).digest('hex')}`;

  const first = await gateway.receive({
    moduleId: 'reliable-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText,
    idempotencyKey: 'delivery-1',
    signature,
    signatureProvider: 'hmac-sha256',
  });
  const duplicate = await gateway.receive({
    moduleId: 'reliable-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText,
    idempotencyKey: 'delivery-1',
    signature,
    signatureProvider: 'hmac-sha256',
  });
  const replayed = await gateway.replay(first.receipt.id);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(replayed.status, 'received');
  assert.equal((await gateway.queue.list({ name: 'webhook:reliable-test:inbound' })).length, 2);
});

test('P17 runtime store webhook gateway rejects missing or unsupported signature providers', async () => {
  const store = createStore();
  const bodyText = JSON.stringify({ value: 1 });
  const signature = `sha256=${createHmac('sha256', 'secret').update(bodyText).digest('hex')}`;
  const missingSecretGateway = createRuntimeStoreWebhookGateway({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });

  const missingSecret = await missingSecretGateway.receive({
    moduleId: 'reliable-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText,
    idempotencyKey: 'delivery-secret-missing',
    signature,
    signatureProvider: 'hmac-sha256',
  });
  const configuredGateway = createRuntimeStoreWebhookGateway({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    secretResolver: () => 'secret',
  });
  const acceptedRetry = await configuredGateway.receive({
    moduleId: 'reliable-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText,
    idempotencyKey: 'delivery-secret-missing',
    signature,
    signatureProvider: 'hmac-sha256',
  });
  const unsupported = await configuredGateway.receive({
    moduleId: 'reliable-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText,
    idempotencyKey: 'delivery-unsupported-provider',
    signature,
    signatureProvider: 'ed25519',
  });

  assert.equal(missingSecret.receipt.status, 'rejected');
  assert.equal(missingSecret.receipt.error?.message, 'Webhook secret is not configured.');
  assert.equal(acceptedRetry.receipt.status, 'received');
  assert.equal(unsupported.receipt.status, 'rejected');
  assert.match(unsupported.receipt.error?.message ?? '', /not supported/);
  assert.equal((await configuredGateway.queue.list({ name: 'webhook:reliable-test:inbound' })).length, 1);
});

test('P17 runtime store webhook gateway verifies GitHub and Stripe signatures', async () => {
  const store = createStore();
  const gateway = createRuntimeStoreWebhookGateway({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    secretResolver: () => 'secret',
  });
  const bodyText = JSON.stringify({ value: 1 });
  const githubSignature = `sha256=${createHmac('sha256', 'secret').update(bodyText).digest('hex')}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const stripeSignature = `t=${timestamp},v1=${createHmac('sha256', 'secret')
    .update(`${timestamp}.${bodyText}`)
    .digest('hex')}`;

  const github = await gateway.receive({
    moduleId: 'reliable-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText,
    idempotencyKey: 'delivery-github-signature',
    signature: githubSignature,
    signatureProvider: 'github',
  });
  const stripe = await gateway.receive({
    moduleId: 'reliable-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText,
    idempotencyKey: 'delivery-stripe-signature',
    signature: stripeSignature,
    signatureProvider: 'stripe',
  });

  assert.equal(github.receipt.status, 'received');
  assert.equal(stripe.receipt.status, 'received');
  assert.equal((await gateway.queue.list({ name: 'webhook:reliable-test:inbound' })).length, 2);
});

test('runtime store webhook runner replays persisted body and headers', async () => {
  const seen: unknown[] = [];
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'webhook-runner-test': {
        module: async () => ({ default: webhookRunnerModule }),
        webhooks: {
          'webhooks/inbound': async () => ({
            default: async (
              _ctx: ModuleContext,
              event: { request: Request; json<T = unknown>(): Promise<T> }
            ) => {
              seen.push({
                body: await event.json(),
                providerEvent: event.request.headers.get('x-provider-event'),
              });
              return { ok: true };
            },
          }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);
  const store = createStore();
  const gateway = createRuntimeStoreWebhookGateway({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  const runner = createRuntimeStoreWebhookRunner(host, {
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    session: { user: { id: 'admin', role: 'admin' } },
  });
  const received = await gateway.receive({
    moduleId: 'webhook-runner-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
    bodyText: JSON.stringify({ source: 'runner-test' }),
    headers: {
      'content-type': 'application/json',
      'x-provider-event': 'evt_runner_1',
    },
    idempotencyKey: 'runner-delivery-1',
    signatureProvider: 'none',
  });

  const result = await runner.drain();
  await gateway.replay(received.receipt.id);
  const replayResult = await runner.drain();
  const receipt = (
    await store.listWebhookReceipts({
      productId: 'product-a',
      moduleId: 'webhook-runner-test',
    })
  ).find((candidate) => candidate.id === received.receipt.id);

  assert.equal(result.processed, 1);
  assert.equal(replayResult.processed, 1);
  assert.deepEqual(seen, [
    {
      body: { source: 'runner-test' },
      providerEvent: 'evt_runner_1',
    },
    {
      body: { source: 'runner-test' },
      providerEvent: 'evt_runner_1',
    },
  ]);
  assert.equal(receipt?.status, 'processed');
  assert.equal(receipt?.bodyDigest?.startsWith('sha256:'), true);
});

test('P17 runtime store job runner persists runs and task center can cancel queued work', async () => {
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'reliable-test': {
        module: async () => ({ default: reliableModule }),
        jobs: {
          'jobs/report': async () => ({
            default: async (_ctx: ModuleContext, input: { title: string }) => ({
              title: input.title,
            }),
          }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);
  const store = createStore();
  const runner = createRuntimeStoreJobRunner(host, {
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  const taskCenter = createRuntimeTaskCenter(store);
  const run = await runner.enqueueJob({
    moduleId: 'reliable-test',
    name: 'report',
    input: { title: 'May' },
    ownerId: 'user-1',
    idempotencyKey: 'job-1',
  });
  await runner.enqueueJob({
    moduleId: 'reliable-test',
    name: 'report',
    input: { title: 'System' },
    idempotencyKey: 'job-system',
  });

  await assert.rejects(
    () =>
      taskCenter.requestCancel({
        session: { user: { id: 'user-2', role: 'user' } },
        runId: run.id,
      }),
    /MODULE_TASK_FORBIDDEN/
  );
  await assert.rejects(
    () =>
      taskCenter.retry({
        session: { user: { id: 'user-2', role: 'user' } },
        runId: run.id,
      }),
    /MODULE_TASK_FORBIDDEN/
  );

  await taskCenter.requestCancel({
    session: { user: { id: 'user-1', role: 'user' } },
    runId: run.id,
  });
  await runner.drain();
  const visible = await taskCenter.list({
    session: { user: { id: 'user-1', role: 'user' } },
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  const hiddenFromOtherUser = await taskCenter.list({
    session: { user: { id: 'user-2', role: 'user' } },
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });

  assert.equal((await store.getRun(run.id))?.status, 'canceled');
  assert.equal(visible.length, 1);
  assert.equal(hiddenFromOtherUser.length, 0);
});
