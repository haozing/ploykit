import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule, page } from '@ploykit/module-sdk';
import {
  countMissingRequiredModuleRequirements,
  createAdminOperationsCenter,
  createInMemoryRuntimeStore,
  createModuleRuntimeHost,
  normalizeModuleRuntimeContract,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';

const moduleDefinition = defineModule({
  id: 'admin-test',
  name: 'Admin Test',
  version: '1.0.0',
  pages: [
    page({
      id: 'admin-test.home',
      area: 'dashboard',
      path: '/admin-test',
      frame: 'workspace',
      component: './pages/Home',
      auth: 'auth',
    }),
  ],
});

const artifact: ModuleMapArtifact = {
  kind: 'source',
  modules: {
    'admin-test': {
      rootDir: 'modules/admin-test',
      module: async () => ({ default: moduleDefinition }),
      pages: { 'pages/Home': async () => ({ default: () => 'home' }) },
      apis: {},
      actions: {},
      surfaces: {},
      lifecycle: {},
      jobs: {},
      events: {},
      webhooks: {},
    },
  },
};

test('P14 admin operations snapshot aggregates runtime store and host records', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });
  const run = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    kind: 'manual',
    name: 'sync',
  });
  await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'admin.event',
    payload: {},
  });
  await store.createWebhookReceipt({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    webhookName: 'inbound',
    path: '/inbound',
    method: 'POST',
  });
  await store.recordAudit({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    type: 'admin.audit',
  });
  await store.recordUsage({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    meter: 'admin.view',
  });

  const admin = createAdminOperationsCenter({ host, store });
  const snapshot = await admin.snapshot({ productId: 'product-a' });

  assert.equal(snapshot.counts.modules, 1);
  assert.equal(snapshot.counts.routes, 1);
  assert.equal(snapshot.counts.runs, 1);
  assert.equal(snapshot.counts.outbox, 1);
  assert.equal(snapshot.counts.webhookReceipts, 1);
  assert.equal(snapshot.counts.auditLogs, 1);
  assert.equal(snapshot.counts.usageRecords, 1);
  assert.equal(snapshot.recent.runs[0]?.id, run.id);
});

test('P14 admin operations require admin session for dangerous actions', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore();
  const admin = createAdminOperationsCenter({ host, store });

  await assert.rejects(() =>
    admin.disableModule({ user: { id: 'user-1', role: 'user' } }, 'product-a', 'admin-test')
  );

  const state = await admin.disableModule(
    { user: { id: 'admin-1', role: 'admin' }, actorId: 'admin-1' },
    'product-a',
    'admin-test'
  );
  const enabled = await admin.enableModule(
    { user: { id: 'admin-1', role: 'admin' }, actorId: 'admin-1' },
    'product-a',
    'admin-test'
  );
  const audit = await store.listAudit({ moduleId: 'admin-test' });

  assert.equal(state.status, 'disabled');
  assert.equal(enabled.status, 'enabled');
  assert.equal(audit.length, 2);
  assert.equal(audit[0]?.metadata.previousStatus, undefined);
  assert.equal(audit[0]?.metadata.nextStatus, 'disabled');
  assert.deepEqual(audit[0]?.metadata.impact, {
    activeRuns: 0,
    pendingOutbox: 0,
    failedWebhookReceipts: 0,
  });
  await assert.rejects(
    () =>
      admin.enableModule(
        { user: { id: 'admin-1', role: 'admin' }, actorId: 'admin-1' },
        'product-a',
        'missing-module'
      ),
    /ADMIN_MODULE_NOT_FOUND/
  );
});

test('P14 admin outbox operations audit previous and next status', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore();
  const admin = createAdminOperationsCenter({ host, store });
  const session = { user: { id: 'admin-1', role: 'admin' as const }, actorId: 'admin-1' };
  const outbox = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'job:admin-test:sync',
    payload: {},
  });

  await admin.discardOutbox(session, outbox.id, 'verified failure');
  await admin.retryOutbox(session, outbox.id, 'retry after fix');
  await admin.archiveOutbox(session, outbox.id, 'archive evidence');

  const audit = await store.listAudit({ productId: 'product-a', moduleId: 'admin-test' });

  assert.equal(audit[0]?.metadata.previousStatus, 'queued');
  assert.equal(audit[0]?.metadata.nextStatus, 'dead_letter');
  assert.equal(audit[1]?.metadata.previousStatus, 'dead_letter');
  assert.equal(audit[1]?.metadata.nextStatus, 'queued');
  assert.equal(audit[2]?.metadata.previousStatus, 'queued');
  assert.equal(audit[2]?.metadata.nextStatus, 'archived');
  await assert.rejects(() => admin.retryOutbox(session, 'missing-outbox'), /ADMIN_OUTBOX_NOT_FOUND/);
});

test('P14 admin module status preserves catalog metadata and guards required modules', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore();
  const admin = createAdminOperationsCenter({ host, store });
  const session = { user: { id: 'admin-1', role: 'admin' as const }, actorId: 'admin-1' };

  await store.upsertCatalogState({
    productId: 'product-a',
    moduleId: 'admin-test',
    status: 'enabled',
    bundleId: 'operator',
    required: true,
    scopeProfile: 'explicit-workspace',
    diagnostics: [
      {
        severity: 'warning',
        code: 'TEST_WARNING',
        message: 'keep me',
        path: 'module.ts',
      },
    ],
  });

  await assert.rejects(
    () => admin.disableModule(session, 'product-a', 'admin-test'),
    /ADMIN_MODULE_REQUIRED_STATUS_FORBIDDEN/
  );

  await store.upsertCatalogState({
    productId: 'product-a',
    moduleId: 'admin-test',
    status: 'enabled',
    bundleId: 'operator',
    required: false,
    scopeProfile: 'explicit-workspace',
    diagnostics: [
      {
        severity: 'warning',
        code: 'TEST_WARNING',
        message: 'keep me',
        path: 'module.ts',
      },
    ],
  });

  const disabled = await admin.disableModule(session, 'product-a', 'admin-test');
  const audit = await store.listAudit({ productId: 'product-a', moduleId: 'admin-test' });

  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.bundleId, 'operator');
  assert.equal(disabled.required, false);
  assert.equal(disabled.scopeProfile, 'explicit-workspace');
  assert.equal(disabled.diagnostics?.[0]?.code, 'TEST_WARNING');
  assert.equal(audit.at(-1)?.metadata.previousStatus, 'enabled');
  assert.equal(audit.at(-1)?.metadata.nextStatus, 'disabled');
  assert.equal(audit.at(-1)?.metadata.bundleId, 'operator');
});

test('P14 admin required requirement gaps follow active service and resource records', async () => {
  const requiredDefinition = defineModule({
    id: 'required-admin-test',
    name: 'Required Admin Test',
    version: '1.0.0',
    serviceRequirements: {
      ai: {
        required: true,
        provider: 'openai',
      },
    },
    resourceBindings: {
      bucket: {
        kind: 's3-bucket',
        required: true,
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(requiredDefinition);
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });

  assert.equal(countMissingRequiredModuleRequirements({ contract }), 2);

  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId: `${contract.id}:service:ai`,
    service: 'ai',
    provider: 'openai',
    status: 'active',
    health: {
      status: 'ready',
    },
  });
  await store.upsertResourceBinding({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    name: 'bucket',
    kind: 's3-bucket',
    value: {
      bucket: 'demo',
    },
    status: 'active',
  });

  assert.equal(
    countMissingRequiredModuleRequirements({
      contract,
      serviceConnections: await store.listServiceConnections({ productId: 'product-a' }),
      resourceBindings: await store.listResourceBindings({ productId: 'product-a' }),
    }),
    0
  );

  await store.touchServiceConnection('product-a', `${contract.id}:service:ai`, {
    health: {
      status: 'blocked',
    },
  });

  assert.equal(
    countMissingRequiredModuleRequirements({
      contract,
      serviceConnections: await store.listServiceConnections({ productId: 'product-a' }),
      resourceBindings: await store.listResourceBindings({ productId: 'product-a' }),
    }),
    1
  );
});

test('M6 admin operations can retry and discard outbox records with audit', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore();
  const admin = createAdminOperationsCenter({ host, store });
  const session = { user: { id: 'admin-1', role: 'admin' as const }, actorId: 'admin-1' };
  const outbox = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'admin.event',
    payload: {},
  });

  await store.markOutbox(outbox.id, 'failed', 'temporary failure');
  const retried = await admin.retryOutbox(session, outbox.id);
  const discarded = await admin.discardOutbox(session, outbox.id, 'operator discard');
  const archived = await admin.archiveOutbox(session, outbox.id, 'operator archive');
  const audit = await store.listAudit({ productId: 'product-a' });

  assert.equal(retried.status, 'queued');
  assert.equal(discarded.status, 'dead_letter');
  assert.equal(archived.status, 'archived');
  assert.deepEqual(
    audit.map((record) => record.type),
    ['admin.outbox.retried', 'admin.outbox.discarded', 'admin.outbox.archived']
  );
});

test('A4 admin operations can cancel and requeue runs with audit', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-20T00:00:00.000Z'),
  });
  const admin = createAdminOperationsCenter({ host, store });
  const session = { user: { id: 'admin-1', role: 'admin' as const }, actorId: 'admin-1' };
  const queued = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    kind: 'job',
    name: 'queued-job',
  });
  const failed = await store.createRun({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    kind: 'job',
    name: 'failed-job',
  });
  await store.updateRunStatus(failed.id, 'failed', {
    error: { code: 'FAILED', message: 'boom' },
  });

  const canceled = await admin.cancelRun(session, queued.id, 'operator cancel');
  const requeued = await admin.requeueRun(session, failed.id);
  const audit = await store.listAudit({ productId: 'product-a' });

  assert.equal(canceled.status, 'cancel_requested');
  assert.ok(canceled.cancelRequestedAt);
  assert.equal(requeued.status, 'queued');
  assert.deepEqual(
    audit.map((record) => record.type),
    ['admin.run.cancel_requested', 'admin.run.requeued']
  );
  await assert.rejects(() => admin.requeueRun(session, queued.id), /ADMIN_RUN_REQUEUE_FORBIDDEN/);
});

test('X8 admin operations can bulk replay dead letters with audit', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore();
  const admin = createAdminOperationsCenter({ host, store });
  const session = { user: { id: 'admin-1', role: 'admin' as const }, actorId: 'admin-1' };
  const first = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'admin.event.one',
    payload: {},
  });
  const second = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'admin.event.two',
    payload: {},
  });
  await store.markOutbox(first.id, 'dead_letter', 'exhausted');
  await store.markOutbox(second.id, 'dead_letter', 'exhausted');

  const replayed = await admin.bulkRetryOutbox(session, {
    productId: 'product-a',
    status: 'dead_letter',
    limit: 10,
  });
  const audit = await store.listAudit({ productId: 'product-a' });

  assert.equal(replayed.matched, 2);
  assert.equal(replayed.processed, 2);
  assert.deepEqual(
    replayed.records.map((record) => record.status),
    ['queued', 'queued']
  );
  assert.equal(audit.filter((record) => record.type === 'admin.outbox.retried').length, 2);
});

test('X8 admin outbox bulk preview reports impact without mutating records', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [normalizeModuleRuntimeContract(moduleDefinition)],
  });
  const store = createInMemoryRuntimeStore();
  const admin = createAdminOperationsCenter({ host, store });
  const session = { user: { id: 'admin-1', role: 'admin' as const }, actorId: 'admin-1' };
  const first = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'webhook:admin-test:first',
    payload: {},
  });
  const second = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'job:admin-test:second',
    payload: {},
  });
  const unrelated = await store.enqueueOutbox({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'admin-test',
    name: 'admin.event.failed',
    payload: {},
  });
  await store.markOutbox(first.id, 'dead_letter', 'preview first');
  await store.markOutbox(second.id, 'dead_letter', 'preview second');
  await store.markOutbox(unrelated.id, 'failed', 'preview unrelated');

  const preview = await admin.previewBulkOutbox(session, {
    action: 'replay',
    productId: 'product-a',
    status: 'dead_letter',
    limit: 1,
  });
  const afterPreview = await store.listOutbox({ productId: 'product-a', status: 'dead_letter' });

  assert.equal(preview.action, 'replay');
  assert.equal(preview.matched, 2);
  assert.equal(preview.selected, 1);
  assert.equal(preview.limit, 1);
  assert.equal(preview.impact.byStatus.dead_letter, 1);
  assert.equal(preview.impact.byModule['admin-test'], 1);
  assert.equal(preview.records.length, 1);
  assert.equal(afterPreview.length, 2);
  assert.ok(afterPreview.every((record) => record.status === 'dead_letter'));
});
