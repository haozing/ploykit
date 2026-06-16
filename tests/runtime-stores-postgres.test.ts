import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import {
  createPgModuleDataExecutor,
  createPostgresRuntimeStore,
  RUNTIME_STORE_REQUIRED_INDEXES,
  verifyRuntimeStoreSchema,
} from '../src/lib/module-runtime';
import {
  resetRuntimeTables,
  RUNTIME_STORE_POSTGRES_DATABASE_URL,
  runtimeStorePostgresReachable,
} from './runtime-stores-postgres-helpers';

test('P13 Postgres runtime store persists runs, outbox, receipts, audit, usage and catalog state', async (t) => {
  if (!(await runtimeStorePostgresReachable())) {
    t.skip(
      `Postgres is not reachable at ${RUNTIME_STORE_POSTGRES_DATABASE_URL}. Start it with npm run db:up.`
    );
    return;
  }

  const pool = new Pool({ connectionString: RUNTIME_STORE_POSTGRES_DATABASE_URL });
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
    assert.equal(schema.indexAudit.required, RUNTIME_STORE_REQUIRED_INDEXES.length);
    assert.equal(schema.indexAudit.present, RUNTIME_STORE_REQUIRED_INDEXES.length);
    assert.deepEqual(schema.indexAudit.missing, []);
    assert.ok(schema.indexAudit.domains.commercial.required > 0);
    assert.equal(
      schema.indexAudit.domains.commercial.present,
      schema.indexAudit.domains.commercial.required
    );
    assert.deepEqual(schema.migrationIssues, []);
    const migration = (
      await pool.query<{ id: string; checksum: string }>(
        `select id, checksum from module_runtime_migrations order by id asc limit 1`
      )
    ).rows[0]!;
    await pool.query(
      `update module_runtime_migrations set checksum = 'checksum-drift' where id = $1`,
      [migration.id]
    );
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
    await pool.query(
      "update module_outbox set lease_expires_at = now() - interval '1 second' where id = $1",
      [expiredLease.id]
    );
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
    const duplicateReceipt = await store.createWebhookReceipt({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      webhookName: 'echo',
      path: '/hello-webhook',
      method: 'POST',
      idempotencyKey: 'wh-1',
    });
    const crossWorkspaceReceipt = await store.createWebhookReceipt({
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
    assert.equal(duplicateReceipt.id, receipt.id);
    assert.notEqual(crossWorkspaceReceipt.id, receipt.id);
    assert.notEqual(nullWorkspaceReceipt.id, receipt.id);
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
    assert.equal(
      (await store.listWorkers({ productId: 'product-a' }))[0]?.workerId,
      'worker-postgres'
    );
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
    const apiKey = await store.createApiKey({
      id: 'api-key-1',
      productId: 'product-a',
      workspaceId: 'workspace-a',
      moduleId: 'hello',
      name: 'Worker key',
      prefix: 'pk_test',
      keyHash: 'hash-test-1',
      ownerSubjectType: 'workspace',
      ownerSubjectId: 'workspace-a',
      permissions: ['files.read'],
    });
    await store.updateApiKey(apiKey.id, {
      lastUsedAt: '2026-06-01T00:00:00.000Z',
      metadata: { rotated: false },
    });
    await store.upsertHostUser({
      id: 'host-user-1',
      email: 'USER@example.com',
      passwordHash: 'hash:user',
      role: 'admin',
      status: 'active',
      productId: 'product-a',
      workspaceId: 'workspace-a',
      workspaceRole: 'owner',
      metadata: { seeded: true },
    });
    await store.updateHostUserStatus('host-user-1', 'suspended', { reason: 'contract-test' });

    const nextStore = createPostgresRuntimeStore({ database: executor });
    assert.equal(duplicateRun.id, run.id);
    assert.equal((await nextStore.getRun(run.id))?.status, 'succeeded');
    assert.equal((await nextStore.getRun(run.id))?.logs.length, 1);
    assert.equal((await nextStore.listOutbox({ status: 'processed' })).length, 1);
    assert.equal((await nextStore.listOutbox({ status: 'dead_letter' })).length, 1);
    assert.equal(
      (
        await nextStore.findWebhookReceiptByIdempotencyKey(
          'product-a',
          'workspace-a',
          'hello',
          'echo',
          'wh-1'
        )
      )?.status,
      'processed'
    );
    assert.equal(
      (
        await nextStore.findWebhookReceiptByIdempotencyKey(
          'product-a',
          'workspace-b',
          'hello',
          'echo',
          'wh-1'
        )
      )?.id,
      crossWorkspaceReceipt.id
    );
    assert.equal(
      (
        await nextStore.findWebhookReceiptByIdempotencyKey(
          'product-a',
          null,
          'hello',
          'echo',
          'wh-1'
        )
      )?.id,
      nullWorkspaceReceipt.id
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
    assert.equal(
      (await nextStore.listNotifications({ userId: 'user-1', status: 'read' })).length,
      1
    );
    assert.equal(
      (await nextStore.listNotificationDeliveries({ productId: 'product-a' })).length,
      1
    );
    assert.equal((await nextStore.getFile(file.id))?.checksum, 'sha256:test');
    assert.equal((await nextStore.listCatalogStates({ productId: 'product-a' })).length, 1);
    assert.equal((await nextStore.listMemberships({ userId: 'user-1' })).length, 1);
    assert.equal((await nextStore.listProductScopeProducts({ productId: 'product-a' })).length, 1);
    assert.equal(
      (await nextStore.listProductScopeWorkspaces({ productId: 'product-a' })).length,
      1
    );
    assert.equal(
      (await nextStore.listProductScopeDomainAliases({ hostname: 'team.localhost' })).length,
      1
    );
    assert.equal(
      (await nextStore.listProductScopeInvites({ token: 'invite-token' }))[0]?.status,
      'pending'
    );
    assert.equal(
      (await nextStore.findApiKeyByHash({ keyHash: 'hash-test-1', prefix: 'pk_test' }))?.id,
      apiKey.id
    );
    assert.equal(
      (await nextStore.getApiKey({ id: apiKey.id }))?.lastUsedAt,
      '2026-06-01T00:00:00.000Z'
    );
    assert.equal((await nextStore.listApiKeys({ productId: 'product-a' })).length, 1);
    assert.equal((await nextStore.findHostUserByEmail('user@example.com'))?.id, 'host-user-1');
    assert.equal((await nextStore.getHostUser('host-user-1'))?.status, 'suspended');
    assert.equal((await nextStore.listHostUsers({ productId: 'product-a' })).length, 1);
  } finally {
    await pool.end();
  }
});
