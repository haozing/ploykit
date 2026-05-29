import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import test from 'node:test';
import { Pool } from 'pg';
import {
  createInMemoryRuntimeStore,
  createPgModuleDataExecutor,
  createPostgresRuntimeStore,
  readRuntimeStoreMigrations,
  verifyRuntimeStoreSchema,
} from '../src/lib/module-runtime';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';

async function databaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function resetRuntimeTables(pool: Pool): Promise<void> {
  await pool.query(`
    drop table if exists module_provider_invocations cascade;
    drop table if exists module_revenue_buckets cascade;
    drop table if exists module_tax_profiles cascade;
    drop table if exists module_subscriptions cascade;
    drop table if exists module_invoices cascade;
    drop table if exists module_billing_accounts cascade;
    drop table if exists module_commercial_catalog cascade;
    drop table if exists module_worker_registry cascade;
    drop table if exists module_delivery_ledger cascade;
    drop table if exists module_notification_deliveries cascade;
    drop table if exists module_notifications cascade;
    drop table if exists module_product_scope_memberships cascade;
    drop table if exists module_product_scope_invites cascade;
    drop table if exists module_product_scope_domain_aliases cascade;
    drop table if exists module_product_scope_workspaces cascade;
    drop table if exists module_product_scope_products cascade;
    drop table if exists module_host_users cascade;
    drop table if exists module_catalog_states cascade;
    drop table if exists module_redeem_redemptions cascade;
    drop table if exists module_redeem_codes cascade;
    drop table if exists module_commercial_orders cascade;
    drop table if exists module_commercial_entitlements cascade;
    drop table if exists module_files cascade;
    drop table if exists module_credit_ledger cascade;
    drop table if exists module_metering_ledger cascade;
    drop table if exists module_usage_records cascade;
    drop table if exists module_audit_logs cascade;
    drop table if exists module_webhook_receipts cascade;
    drop table if exists module_outbox cascade;
    drop table if exists module_run_logs cascade;
    drop table if exists module_runs cascade;
  `);
}

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
  assert.equal((await store.listProductScopeDomainAliases({ hostname: 'team.localhost' })).length, 1);
  assert.equal((await store.listProductScopeInvites({ token: 'invite-token' }))[0]?.status, 'pending');
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

test('P13 Postgres runtime store persists runs, outbox, receipts, audit, usage and catalog state', async (t) => {
  if (!(await databaseReachable())) {
    t.skip(`Postgres is not reachable at ${DATABASE_URL}. Start it with npm run db:up.`);
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const executor = createPgModuleDataExecutor(pool);
  try {
    await resetRuntimeTables(pool);
    let nextId = 0;
    const store = createPostgresRuntimeStore({
      database: executor,
      createId: (prefix) => `${prefix}_p13_${++nextId}`,
    });
    await store.ensureSchema?.();
    const schema = await verifyRuntimeStoreSchema(executor);
    assert.equal(schema.ok, true);
    assert.deepEqual(schema.missing, []);
    assert.deepEqual(schema.columnIssues, []);
    assert.deepEqual(schema.indexIssues, []);
    assert.deepEqual(schema.migrationIssues, []);
    const migration = (
      await pool.query<{ id: string; checksum: string }>(
        `select id, checksum from module_runtime_migrations order by id asc limit 1`
      )
    ).rows[0]!;
    await pool.query(`update module_runtime_migrations set checksum = 'checksum-drift' where id = $1`, [
      migration.id,
    ]);
    const drift = await verifyRuntimeStoreSchema(executor);
    assert.equal(drift.ok, false);
    assert.ok(drift.migrationIssues.includes(`${migration.id}:checksum`));
    await pool.query(`update module_runtime_migrations set checksum = $2 where id = $1`, [
      migration.id,
      migration.checksum,
    ]);

    const run = await store.createRun({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      kind: 'job',
      name: 'sync',
      input: { ok: true },
      idempotencyKey: 'run-1',
    });
    const duplicateRun = await store.createRun({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      kind: 'job',
      name: 'sync',
      idempotencyKey: 'run-1',
    });
    const crossWorkspaceRun = await store.createRun({
      productId: 'product-a',
      workspaceId: 'workspace-b',
      moduleId: 'hello',
      kind: 'job',
      name: 'sync',
      idempotencyKey: 'run-1',
    });
    await store.appendRunLog(run.id, 'info', 'persisted');
    await store.updateRunStatus(run.id, 'succeeded', { progress: 100, result: { ok: true } });
    const outbox = await store.enqueueOutbox({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      name: 'hello.greeted',
      payload: { message: 'hi' },
      idempotencyKey: 'evt-1',
    });
    const crossWorkspaceOutbox = await store.enqueueOutbox({
      productId: 'product-a',
      workspaceId: 'workspace-b',
      moduleId: 'hello',
      name: 'hello.greeted',
      payload: { message: 'hi-b' },
      idempotencyKey: 'evt-1',
    });
    await store.markOutbox(outbox.id, 'processed');
    await store.enqueueOutbox({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      name: 'hello.retry',
      payload: { ok: false },
      idempotencyKey: 'evt-retry-1',
    });
    const claimedOutbox = await store.claimOutbox({
      productId: 'product-a',
      name: 'hello.retry',
      limit: 1,
    });
    assert.equal(claimedOutbox[0].status, 'processing');
    assert.equal(claimedOutbox[0].attempts, 1);
    await store.markOutbox(claimedOutbox[0].id, 'dead_letter', 'exhausted');
    const expiredLease = await store.enqueueOutbox({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      name: 'hello.expired-lease',
      payload: { ok: true },
      idempotencyKey: 'evt-expired-lease',
    });
    const firstExpiredLeaseClaim = await store.claimOutbox({
      productId: 'product-a',
      name: 'hello.expired-lease',
      limit: 1,
      leaseOwner: 'worker-a',
      leaseMs: 1000,
    });
    await pool.query("update module_outbox set lease_expires_at = now() - interval '1 second' where id = $1", [
      expiredLease.id,
    ]);
    const reclaimedExpiredLease = await store.claimOutbox({
      productId: 'product-a',
      name: 'hello.expired-lease',
      limit: 1,
      leaseOwner: 'worker-b',
      leaseMs: 1000,
    });
    assert.equal(firstExpiredLeaseClaim[0]?.id, expiredLease.id);
    assert.equal(reclaimedExpiredLease[0]?.id, expiredLease.id);
    assert.equal(reclaimedExpiredLease[0]?.leaseOwner, 'worker-b');
    assert.equal(reclaimedExpiredLease[0]?.attempts, 2);
    assert.notEqual(crossWorkspaceRun.id, run.id);
    assert.notEqual(crossWorkspaceOutbox.id, outbox.id);
    await store.recordDelivery({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      kind: 'job',
      source: 'job:hello:sync',
      target: 'hello',
      status: 'dead_letter',
      attempts: 2,
      outboxId: claimedOutbox[0].id,
      errorCategory: 'RUNTIME_STORE_ERROR',
      error: 'exhausted',
    });
    await store.upsertWorkerHeartbeat({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      workerId: 'worker-postgres',
      status: 'running',
      processed: 1,
    });
    const receipt = await store.createWebhookReceipt({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      webhookName: 'echo',
      path: '/hello-webhook',
      method: 'POST',
      idempotencyKey: 'wh-1',
    });
    await store.markWebhookReceipt(receipt.id, 'processed');
    await store.recordAudit({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      actorId: 'user-1',
      type: 'module.run.succeeded',
      metadata: { runId: run.id },
    });
    await store.recordUsage({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      meter: 'job.run',
      quantity: 1,
      idempotencyKey: 'usage-1',
    });
    const notification = await store.createNotification({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      userId: 'user-1',
      title: 'Job finished',
      source: 'task',
      category: 'tasks',
      runId: run.id,
      idempotencyKey: 'notification-1',
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
    await store.recordProviderInvocation({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      providerId: 'host-ai-static',
      kind: 'ai',
      operation: 'generateText',
      status: 'succeeded',
      model: 'static-text',
      usage: { inputTokens: 2, outputTokens: 3 },
      cost: { credits: 1, unit: 'credit' },
      latencyMs: 5,
    });
    assert.equal((await store.listDeliveries({ productId: 'product-a' })).length, 1);
    assert.equal((await store.listWorkers({ productId: 'product-a' }))[0]?.workerId, 'worker-postgres');
    await store.markNotificationRead(notification.id);
    const file = await store.createFile({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      actorId: 'user-1',
      name: 'report.txt',
      purpose: 'result',
      contentType: 'text/plain',
      storageKey: 'product-a/workspace-a/hello/report.txt',
    });
    await store.updateFile(file.id, {
      status: 'ready',
      sizeBytes: 5,
      checksum: 'sha256:test',
    });
    await store.upsertCatalogState({
      productId: 'product-a',
      moduleId: 'hello',
      status: 'enabled',
      bundleId: 'demo',
      required: true,
    });
    await store.upsertMembership({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      userId: 'user-1',
      role: 'owner',
      status: 'active',
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

    const nextStore = createPostgresRuntimeStore({ database: executor });
    assert.equal(duplicateRun.id, run.id);
    assert.equal((await nextStore.getRun(run.id))?.status, 'succeeded');
    assert.equal((await nextStore.getRun(run.id))?.logs.length, 1);
    assert.equal((await nextStore.listOutbox({ status: 'processed' })).length, 1);
    assert.equal((await nextStore.listOutbox({ status: 'dead_letter' })).length, 1);
    assert.equal(
      (await nextStore.findWebhookReceiptByIdempotencyKey('product-a', 'hello', 'echo', 'wh-1'))
        ?.status,
      'processed'
    );
    assert.equal((await nextStore.listAudit({ type: 'module.run.succeeded' })).length, 1);
    assert.equal((await nextStore.listUsage({ meter: 'job.run' })).length, 1);
    assert.equal(
      (
        await nextStore.listProviderInvocations({
          productId: 'product-a',
          providerId: 'host-ai-static',
        })
      )[0]?.operation,
      'generateText'
    );
    assert.equal((await nextStore.listNotifications({ userId: 'user-1', status: 'read' })).length, 1);
    assert.equal((await nextStore.listNotificationDeliveries({ productId: 'product-a' })).length, 1);
    assert.equal((await nextStore.getFile(file.id))?.checksum, 'sha256:test');
    assert.equal((await nextStore.listCatalogStates({ productId: 'product-a' })).length, 1);
    assert.equal((await nextStore.listMemberships({ userId: 'user-1' })).length, 1);
    assert.equal((await nextStore.listProductScopeProducts({ productId: 'product-a' })).length, 1);
    assert.equal((await nextStore.listProductScopeWorkspaces({ productId: 'product-a' })).length, 1);
    assert.equal((await nextStore.listProductScopeDomainAliases({ hostname: 'team.localhost' })).length, 1);
    assert.equal((await nextStore.listProductScopeInvites({ token: 'invite-token' }))[0]?.status, 'pending');
  } finally {
    await pool.end();
  }
});

test('P13 Postgres runtime store keeps null workspace filters exact across platform domains', async (t) => {
  if (!(await databaseReachable())) {
    t.skip(`Postgres is not reachable at ${DATABASE_URL}. Start it with npm run db:up.`);
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const executor = createPgModuleDataExecutor(pool);
  try {
    await resetRuntimeTables(pool);
    let nextId = 0;
    const store = createPostgresRuntimeStore({
      database: executor,
      createId: (prefix) => `${prefix}_scope_${++nextId}`,
    });
    await store.ensureSchema?.();

    const scopedRun = await store.createRun({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      kind: 'job',
      name: 'scoped',
      idempotencyKey: 'run-scoped',
    });
    const nullRun = await store.createRun({
      productId: 'scope-product',
      moduleId: 'hello',
      kind: 'job',
      name: 'null-scope',
      idempotencyKey: 'run-null',
    });
    assert.deepEqual(
      (await store.listRuns({ productId: 'scope-product', workspaceId: null })).map((run) => run.id),
      [nullRun.id]
    );
    assert.deepEqual(
      (await store.listRuns({ productId: 'scope-product', workspaceId: 'workspace-a' })).map(
        (run) => run.id
      ),
      [scopedRun.id]
    );

    await store.enqueueOutbox({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      name: 'scope.test',
      payload: {},
      idempotencyKey: 'outbox-scoped',
    });
    const nullOutbox = await store.enqueueOutbox({
      productId: 'scope-product',
      moduleId: 'hello',
      name: 'scope.test',
      payload: {},
      idempotencyKey: 'outbox-null',
    });
    assert.deepEqual(
      (await store.listOutbox({ productId: 'scope-product', workspaceId: null })).map(
        (record) => record.id
      ),
      [nullOutbox.id]
    );
    assert.deepEqual(
      (await store.claimOutbox({ productId: 'scope-product', workspaceId: null, limit: 10 })).map(
        (record) => record.id
      ),
      [nullOutbox.id]
    );

    await store.createNotification({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      userId: 'user-1',
      title: 'scoped',
      idempotencyKey: 'notification-scoped',
    });
    const nullNotification = await store.createNotification({
      productId: 'scope-product',
      moduleId: 'hello',
      userId: 'user-1',
      title: 'null scope',
      idempotencyKey: 'notification-null',
    });
    assert.deepEqual(
      (await store.listNotifications({ productId: 'scope-product', workspaceId: null })).map(
        (record) => record.id
      ),
      [nullNotification.id]
    );
    assert.deepEqual(
      (
        await store.markNotificationsRead({
          productId: 'scope-product',
          workspaceId: null,
          userId: 'user-1',
        })
      ).map((record) => record.id),
      [nullNotification.id]
    );

    const nullWorker = await store.upsertWorkerHeartbeat({
      productId: 'scope-product',
      workerId: 'worker-a',
      processed: 1,
    });
    const updatedNullWorker = await store.upsertWorkerHeartbeat({
      productId: 'scope-product',
      workerId: 'worker-a',
      processed: 2,
    });
    await store.upsertWorkerHeartbeat({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      workerId: 'worker-a',
      processed: 3,
    });
    assert.equal(updatedNullWorker.id, nullWorker.id);
    assert.equal(
      (await store.listWorkers({ productId: 'scope-product', workspaceId: null }))[0]?.processed,
      2
    );

    const nullCatalog = await store.upsertCommercialCatalogItem({
      productId: 'scope-product',
      kind: 'sku',
      itemId: 'sku-basic',
      value: { credits: 1 },
    });
    const updatedNullCatalog = await store.upsertCommercialCatalogItem({
      productId: 'scope-product',
      kind: 'sku',
      itemId: 'sku-basic',
      value: { credits: 2 },
    });
    await store.upsertCommercialCatalogItem({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      kind: 'sku',
      itemId: 'sku-basic',
      value: { credits: 3 },
    });
    assert.equal(updatedNullCatalog.id, nullCatalog.id);
    assert.deepEqual(
      (await store.listCommercialCatalogItems({ productId: 'scope-product', workspaceId: null })).map(
        (record) => record.id
      ),
      [nullCatalog.id]
    );

    const nullBillingAccount = await store.upsertBillingAccount({
      productId: 'scope-product',
      userId: 'user-1',
      customerProfile: { name: 'Null Scope' },
    });
    const updatedNullBillingAccount = await store.upsertBillingAccount({
      productId: 'scope-product',
      userId: 'user-1',
      customerProfile: { company: 'Null Scope Inc.' },
    });
    await store.upsertBillingAccount({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      userId: 'user-1',
      customerProfile: { name: 'Workspace Scope' },
    });
    assert.equal(updatedNullBillingAccount.id, nullBillingAccount.id);
    assert.equal(
      (await store.getBillingAccount('scope-product', 'user-1', null))?.id,
      nullBillingAccount.id
    );

    await store.recordProviderInvocation({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      providerId: 'provider-a',
      kind: 'ai',
      operation: 'generate',
      status: 'succeeded',
    });
    const nullProviderInvocation = await store.recordProviderInvocation({
      productId: 'scope-product',
      moduleId: 'hello',
      providerId: 'provider-a',
      kind: 'ai',
      operation: 'generate',
      status: 'succeeded',
    });
    assert.deepEqual(
      (await store.listProviderInvocations({ productId: 'scope-product', workspaceId: null })).map(
        (record) => record.id
      ),
      [nullProviderInvocation.id]
    );

    await store.upsertRagSource({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      sourceId: 'source-1',
      status: 'indexed',
    });
    const nullRagSource = await store.upsertRagSource({
      productId: 'scope-product',
      moduleId: 'hello',
      sourceId: 'source-1',
      status: 'indexed',
    });
    await store.upsertRagChunk({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      sourceId: 'source-1',
      chunkIndex: 0,
      content: 'scoped chunk',
      embedding: [0.1],
    });
    const nullRagChunk = await store.upsertRagChunk({
      productId: 'scope-product',
      moduleId: 'hello',
      sourceId: 'source-1',
      chunkIndex: 0,
      content: 'null chunk',
      embedding: [0.2],
    });
    assert.deepEqual(
      (await store.listRagSources({ productId: 'scope-product', workspaceId: null })).map(
        (record) => record.id
      ),
      [nullRagSource.id]
    );
    assert.deepEqual(
      (await store.listRagChunks({ productId: 'scope-product', workspaceId: null })).map(
        (record) => record.id
      ),
      [nullRagChunk.id]
    );
    assert.equal(
      await store.deleteRagChunksBySource({
        productId: 'scope-product',
        workspaceId: null,
        moduleId: 'hello',
        sourceId: 'source-1',
      }),
      1
    );
    assert.equal(
      (await store.listRagChunks({ productId: 'scope-product', workspaceId: 'workspace-a' })).length,
      1
    );

    await store.createFile({
      productId: 'scope-product',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      name: 'scoped.txt',
      purpose: 'result',
      storageKey: 'workspace-a/scoped.txt',
    });
    const nullFile = await store.createFile({
      productId: 'scope-product',
      moduleId: 'hello',
      name: 'null.txt',
      purpose: 'result',
      storageKey: 'null.txt',
    });
    assert.deepEqual(
      (await store.listFiles({ productId: 'scope-product', workspaceId: null })).map(
        (record) => record.id
      ),
      [nullFile.id]
    );
  } finally {
    await pool.end();
  }
});
