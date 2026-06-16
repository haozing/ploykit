import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import test from 'node:test';
import {
  createInMemoryRuntimeStore,
  readRuntimeStoreMigrations,
  RUNTIME_STORE_REQUIRED_INDEXES,
} from '../src/lib/module-runtime';

test('runtime store CLI plan uses the shared runtime migration manifest', () => {
  const result = childProcess.spawnSync(process.execPath, ['scripts/runtime-stores.mjs', 'plan'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: '', POSTGRES_URL: '' },
  });
  const body = JSON.parse(result.stdout) as {
    ok: boolean;
    mode: string;
    expected: number;
    migrations: { id: string; checksum: string }[];
  };
  const sharedMigrations = readRuntimeStoreMigrations();

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'plan');
  assert.equal(body.expected, sharedMigrations.length);
  assert.deepEqual(
    body.migrations.map((migration) => migration.id),
    sharedMigrations.map((migration) => migration.id)
  );
});

test('P13 memory runtime store keeps idempotent records and scope query shape', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (prefix) => `${prefix}_1`,
  });
  const run = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    kind: 'job',
    name: 'sync',
    idempotencyKey: 'sync-1',
  });
  const sameRun = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    kind: 'job',
    name: 'sync',
    idempotencyKey: 'sync-1',
  });
  await store.appendRunLog(run.id, 'info', 'started', {
    requestId: 'req-1',
    authorization: 'Bearer secret',
  });
  await store.recordAudit({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    actorId: 'user-1',
    type: 'module.secret.redaction',
    metadata: { apiKey: 'secret', secretConfigured: true },
  });
  await store.recordAudit({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    actorId: 'user-1',
    type: 'admin.identity.updated',
    metadata: {
      email: 'person@example.com',
      taxId: 'TAX-123',
      bodyText: '{"raw":true}',
      nested: {
        note: 'Contact person@example.com with questions',
        authorization: 'Bearer secret',
      },
      payload: { userId: 'user-1' },
    },
  });
  await store.recordUsage({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    meter: 'action.call',
    idempotencyKey: 'usage-1',
  });
  await store.upsertProductScopeProduct({
    id: 'product-a',
    name: 'Product A',
    profile: 'explicit-workspace',
    defaultWorkspaceId: 'workspace-a',
  });
  await store.upsertProductScopeWorkspace({
    id: 'workspace-a',
    productId: 'product-a',
    name: 'Workspace A',
    slug: 'workspace-a',
  });
  await store.upsertProductScopeDomainAlias({
    hostname: 'team.localhost',
    productId: 'product-a',
    workspaceId: 'workspace-a',
  });
  await store.upsertProductScopeInvite({
    id: 'invite-1',
    productId: 'product-a',
    workspaceId: 'workspace-a',
    email: 'new@example.com',
    role: 'editor',
    status: 'pending',
    token: 'invite-token',
    expiresAt: '2026-06-01T00:00:00.000Z',
    invitedBy: 'user-1',
  });

  assert.equal(sameRun.id, run.id);
  assert.equal((await store.getRun(run.id))?.logs.length, 1);
  assert.equal((await store.getRun(run.id))?.logs[0]?.metadata?.authorization, '[REDACTED]');
  const auditRecords = await store.listAudit({ productId: 'product-a' });
  assert.deepEqual(auditRecords[0]?.metadata, {
    apiKey: '[REDACTED]',
    secretConfigured: true,
  });
  assert.equal(auditRecords[0]?.integrity?.category, 'module');
  assert.equal(auditRecords[0]?.integrity?.risk, 'low');
  assert.match(auditRecords[0]?.integrity?.recordHash ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(auditRecords[1]?.metadata, {
    email: '[REDACTED]',
    taxId: '[REDACTED]',
    bodyText: '[REDACTED]',
    nested: {
      note: 'Contact [REDACTED_EMAIL] with questions',
      authorization: '[REDACTED]',
    },
    payload: '[REDACTED]',
  });
  assert.equal(auditRecords[1]?.integrity?.previousHash, auditRecords[0]?.integrity?.recordHash);
  assert.equal((await store.listUsage({ productId: 'product-a' })).length, 1);
  assert.equal((await store.listProductScopeProducts({ productId: 'product-a' })).length, 1);
  assert.equal(
    (await store.listProductScopeDomainAliases({ hostname: 'team.localhost' })).length,
    1
  );
  assert.equal(
    (await store.listProductScopeInvites({ token: 'invite-token' }))[0]?.status,
    'pending'
  );
});

test('memory runtime store can create runs with stable ids', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-24T00:00:00.000Z'),
  });
  const run = await store.createRun({
    id: 'run_stable_demo',
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    kind: 'manual',
    name: 'stable-demo',
    idempotencyKey: 'stable-demo',
  });
  const duplicate = await store.createRun({
    id: 'run_stable_demo',
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    kind: 'manual',
    name: 'stable-demo',
    idempotencyKey: 'stable-demo',
  });

  assert.equal(run.id, 'run_stable_demo');
  assert.equal(duplicate.id, run.id);
  assert.equal((await store.getRun('run_stable_demo'))?.name, 'stable-demo');
  await assert.rejects(
    () =>
      store.createRun({
        id: 'run_stable_demo',
        productId: 'product-a',
        workspaceId: 'workspace-a',
        moduleId: 'hello',
        kind: 'manual',
        name: 'conflict',
      }),
    /RUNTIME_STORE_RUN_ID_CONFLICT/
  );
});

test('memory runtime store keeps risk events and blocks scoped and idempotent', async () => {
  let id = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-06-16T00:00:00.000Z'),
    createId: (prefix) => `${prefix}_${++id}`,
  });

  await store.recordRiskEvent({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'checkout',
    subjectType: 'user',
    subjectId: 'user-1',
    type: 'checkout.velocity',
    severity: 'high',
    source: 'risk-engine',
    sourceId: 'risk-event-1',
    metadata: { ip: '127.0.0.1' },
  });
  await store.recordRiskEvent({
    productId: 'product-a',
    workspaceId: 'workspace-b',
    moduleId: 'checkout',
    subjectType: 'user',
    subjectId: 'user-1',
    type: 'checkout.velocity',
    severity: 'low',
    source: 'risk-engine',
    sourceId: 'risk-event-2',
  });

  const scopedEvents = await store.listRiskEvents({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'checkout',
    subjectType: 'user',
    subjectId: 'user-1',
    type: 'checkout.velocity',
    severity: 'high',
    source: 'risk-engine',
    sourceId: 'risk-event-1',
  });
  assert.equal(scopedEvents.length, 1);
  assert.deepEqual(scopedEvents[0]?.metadata, { ip: '127.0.0.1' });

  const block = await store.upsertRiskBlock({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    subjectType: 'user',
    subjectId: 'user-1',
    scope: 'checkout',
    reason: 'manual review',
    idempotencyKey: 'block-1',
    metadata: { first: true },
  });
  const replayedBlock = await store.upsertRiskBlock({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    subjectType: 'user',
    subjectId: 'user-1',
    scope: 'checkout',
    reason: 'should not replace idempotent result',
    idempotencyKey: 'block-1',
    metadata: { replayed: true },
  });
  const updatedBlock = await store.upsertRiskBlock({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    subjectType: 'user',
    subjectId: 'user-1',
    scope: 'checkout',
    reason: 'manual review updated',
    metadata: { second: true },
  });

  assert.equal(replayedBlock.id, block.id);
  assert.equal(replayedBlock.reason, 'manual review');
  assert.deepEqual(replayedBlock.metadata, { first: true });
  assert.equal(updatedBlock.id, block.id);
  assert.equal(updatedBlock.reason, 'manual review updated');
  assert.deepEqual(updatedBlock.metadata, { first: true, second: true });
  assert.equal(
    (
      await store.listRiskBlocks({
        productId: 'product-a',
        workspaceId: 'workspace-a',
        subjectType: 'user',
        subjectId: 'user-1',
        scope: 'checkout',
      })
    ).length,
    1
  );
});

test('runtime store scopes run and outbox idempotency by workspace', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-24T00:00:00.000Z'),
    createId: (prefix) => `${prefix}_${++nextId}`,
  });
  const runA = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    kind: 'job',
    name: 'sync',
    idempotencyKey: 'sync-1',
  });
  const runADuplicate = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    kind: 'job',
    name: 'sync',
    idempotencyKey: 'sync-1',
  });
  const runB = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-b',
    moduleId: 'hello',
    kind: 'job',
    name: 'sync',
    idempotencyKey: 'sync-1',
  });
  const outboxA = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    name: 'job:hello:sync',
    payload: { runId: runA.id },
    idempotencyKey: 'sync-1',
  });
  const outboxADuplicate = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    name: 'job:hello:sync',
    payload: { runId: runA.id },
    idempotencyKey: 'sync-1',
  });
  const outboxB = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-b',
    moduleId: 'hello',
    name: 'job:hello:sync',
    payload: { runId: runB.id },
    idempotencyKey: 'sync-1',
  });

  assert.equal(runADuplicate.id, runA.id);
  assert.notEqual(runB.id, runA.id);
  assert.equal(outboxADuplicate.id, outboxA.id);
  assert.notEqual(outboxB.id, outboxA.id);
});

test('runtime store scopes webhook receipt idempotency by workspace', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-24T00:00:00.000Z'),
    createId: (prefix) => `${prefix}_${++nextId}`,
  });
  const receiptA = await store.createWebhookReceipt({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    webhookName: 'echo',
    path: '/hello-webhook',
    method: 'POST',
    idempotencyKey: 'wh-1',
  });
  const duplicateA = await store.createWebhookReceipt({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    webhookName: 'echo',
    path: '/hello-webhook',
    method: 'POST',
    idempotencyKey: 'wh-1',
  });
  const receiptB = await store.createWebhookReceipt({
    productId: 'product-a',
    workspaceId: 'workspace-b',
    moduleId: 'hello',
    webhookName: 'echo',
    path: '/hello-webhook',
    method: 'POST',
    idempotencyKey: 'wh-1',
  });
  const nullWorkspaceReceipt = await store.createWebhookReceipt({
    productId: 'product-a',
    moduleId: 'hello',
    webhookName: 'echo',
    path: '/hello-webhook',
    method: 'POST',
    idempotencyKey: 'wh-1',
  });
  const nullWorkspaceDuplicate = await store.createWebhookReceipt({
    productId: 'product-a',
    moduleId: 'hello',
    webhookName: 'echo',
    path: '/hello-webhook',
    method: 'POST',
    idempotencyKey: 'wh-1',
  });

  assert.equal(duplicateA.id, receiptA.id);
  assert.notEqual(receiptB.id, receiptA.id);
  assert.notEqual(nullWorkspaceReceipt.id, receiptA.id);
  assert.notEqual(nullWorkspaceReceipt.id, receiptB.id);
  assert.equal(nullWorkspaceDuplicate.id, nullWorkspaceReceipt.id);
  assert.equal(
    (
      await store.findWebhookReceiptByIdempotencyKey(
        'product-a',
        'workspace-a',
        'hello',
        'echo',
        'wh-1'
      )
    )?.id,
    receiptA.id
  );
  assert.equal(
    (
      await store.findWebhookReceiptByIdempotencyKey(
        'product-a',
        'workspace-b',
        'hello',
        'echo',
        'wh-1'
      )
    )?.id,
    receiptB.id
  );
  assert.equal(
    (await store.findWebhookReceiptByIdempotencyKey('product-a', null, 'hello', 'echo', 'wh-1'))
      ?.id,
    nullWorkspaceReceipt.id
  );
});

test('X9 memory runtime store persists notifications and delivery logs', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-20T00:00:00.000Z'),
    createId: (() => {
      let nextId = 0;
      return (prefix: string) => `${prefix}_${++nextId}`;
    })(),
  });
  const notification = await store.createNotification({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    userId: 'user-1',
    title: 'Task finished',
    source: 'task',
    category: 'tasks',
    idempotencyKey: 'run-1:succeeded',
  });
  const duplicate = await store.createNotification({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    userId: 'user-1',
    title: 'Task finished again',
    source: 'task',
    category: 'tasks',
    idempotencyKey: 'run-1:succeeded',
  });
  await store.recordNotificationDelivery({
    notificationId: notification.id,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    userId: 'user-1',
    channel: 'inApp',
    provider: 'in-app',
    status: 'delivered',
  });
  await store.markNotificationsRead({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    userId: 'user-1',
  });

  assert.equal(duplicate.id, notification.id);
  assert.equal((await store.listNotifications({ userId: 'user-1', status: 'read' })).length, 1);
  assert.equal((await store.listNotificationDeliveries({ productId: 'product-a' })).length, 1);
});

test('P6 memory runtime store records delivery ledger and worker registry', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-20T00:00:00.000Z'),
    createId: (() => {
      let nextId = 0;
      return (prefix: string) => `${prefix}_${++nextId}`;
    })(),
  });

  const outbox = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    name: 'job:hello:sync',
    payload: { runId: 'run-1' },
  });
  await store.recordDelivery({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    kind: 'job',
    source: 'job:hello:sync',
    target: 'hello',
    status: 'delivered',
    attempts: 1,
    outboxId: outbox.id,
    runId: 'run-1',
    workerId: 'worker-a',
    correlationId: 'corr-1',
    metadata: { secret: 'sk-test-redacted' },
  });
  await store.upsertWorkerHeartbeat({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    workerId: 'worker-a',
    profile: 'default',
    queueProfile: 'jobs-events-webhooks',
    status: 'running',
    processed: 1,
  });

  const deliveries = await store.listDeliveries({
    productId: 'product-a',
    kind: 'job',
    workerId: 'worker-a',
  });
  const workers = await store.listWorkers({ productId: 'product-a', workerId: 'worker-a' });

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.outboxId, outbox.id);
  assert.equal(deliveries[0]?.runId, 'run-1');
  assert.equal(deliveries[0]?.correlationId, 'corr-1');
  assert.equal(workers.length, 1);
  assert.equal(workers[0]?.processed, 1);
  assert.equal(workers[0]?.queueProfile, 'jobs-events-webhooks');
});

test('P13 memory runtime store reclaims expired outbox leases', async () => {
  let currentTime = new Date('2026-05-19T00:00:00.000Z');
  const store = createInMemoryRuntimeStore({
    now: () => currentTime,
    createId: (prefix) => `${prefix}_lease`,
  });

  const outbox = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'hello',
    name: 'hello.expired-lease',
    payload: { ok: true },
    idempotencyKey: 'evt-expired-lease',
  });
  const firstClaim = await store.claimOutbox({
    productId: 'product-a',
    name: 'hello.expired-lease',
    limit: 1,
    leaseOwner: 'worker-a',
    leaseMs: 1000,
  });

  currentTime = new Date('2026-05-19T00:00:02.000Z');
  const secondClaim = await store.claimOutbox({
    productId: 'product-a',
    name: 'hello.expired-lease',
    limit: 1,
    leaseOwner: 'worker-b',
    leaseMs: 1000,
  });

  assert.equal(firstClaim[0]?.id, outbox.id);
  assert.equal(secondClaim[0]?.id, outbox.id);
  assert.equal(secondClaim[0]?.leaseOwner, 'worker-b');
  assert.equal(secondClaim[0]?.attempts, 2);
});

test('P13 runtime store required index audit documents core query domains', () => {
  const byDomain = RUNTIME_STORE_REQUIRED_INDEXES.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.domain] = (acc[entry.domain] ?? 0) + 1;
    return acc;
  }, {});

  for (const domain of [
    'runs',
    'outbox',
    'worker',
    'webhooks',
    'commercial',
    'provider',
    'rag',
    'identity',
    'risk',
    'settings',
  ]) {
    assert.ok(byDomain[domain] > 0, `expected index audit coverage for ${domain}`);
  }

  assert.ok(
    RUNTIME_STORE_REQUIRED_INDEXES.some(
      (entry) => entry.index === 'module_runs_idempotency_idx' && entry.unique
    )
  );
  assert.ok(
    RUNTIME_STORE_REQUIRED_INDEXES.some(
      (entry) => entry.index === 'module_risk_blocks_scope_uidx' && entry.unique
    )
  );
  assert.ok(
    RUNTIME_STORE_REQUIRED_INDEXES.every(
      (entry) => entry.table && entry.query && entry.columns.length > 0
    )
  );
});
