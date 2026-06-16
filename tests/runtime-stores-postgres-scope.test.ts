import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { createPgModuleDataExecutor, createPostgresRuntimeStore } from '../src/lib/module-runtime';
import {
  resetRuntimeTables,
  RUNTIME_STORE_POSTGRES_DATABASE_URL,
  runtimeStorePostgresReachable,
} from './runtime-stores-postgres-helpers';

test('P13 Postgres runtime store keeps null workspace filters exact across platform domains', async (t) => {
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
      (await store.listRuns({ productId: 'scope-product', workspaceId: null })).map(
        (run) => run.id
      ),
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
      (
        await store.listCommercialCatalogItems({ productId: 'scope-product', workspaceId: null })
      ).map((record) => record.id),
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
      (await store.listRagChunks({ productId: 'scope-product', workspaceId: 'workspace-a' }))
        .length,
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
