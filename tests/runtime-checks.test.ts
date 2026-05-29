import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInMemoryRuntimeStore,
  runRuntimeChecks,
  runRuntimeMatrix,
} from '../src/lib/module-runtime';
import {
  createMemoryModuleFileStorage,
} from '../src/lib/module-capabilities';
import { loadRuntimeConfig } from '../src/lib/runtime-config';

test('P18 runtime checks report config, drift, queue, webhook and billing diagnostics', async () => {
  const store = createInMemoryRuntimeStore({
    createId: (() => {
      let nextId = 0;
      return (prefix: string) => `${prefix}_${++nextId}`;
    })(),
  });
  const outbox = await store.enqueueOutbox({
    productId: 'product-a',
    name: 'failing',
    payload: {},
  });
  await store.markOutbox(outbox.id, 'dead_letter', 'exhausted');

  const result = await runRuntimeChecks({
    config: loadRuntimeConfig({}),
    store,
    productId: 'product-a',
    storage: createMemoryModuleFileStorage(),
    moduleMapFresh: false,
    catalogFresh: false,
    webhookSecretsConfigured: false,
    billingProviderConfigured: false,
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((item) => item.code).slice(0, 4), [
    'RUNTIME_CONFIG_DATABASE_URL_REQUIRED',
    'RUNTIME_CONFIG_HOST_URL_REQUIRED',
    'RUNTIME_CONFIG_AUTH_PROVIDER_INVALID',
    'RUNTIME_QUEUE_DEAD_LETTERS',
  ]);
  assert.ok(result.diagnostics.some((item) => item.code === 'RUNTIME_MODULE_MAP_DRIFT'));
  assert.ok(result.diagnostics.some((item) => item.code === 'RUNTIME_WEBHOOK_SECRET_MISSING'));
});

test('P18 runtime checks include detailed module map health issues', async () => {
  const result = await runRuntimeChecks({
    moduleMapHealth: {
      ok: false,
      buildId: 'test-build',
      generatedAt: '2026-05-19T00:00:00.000Z',
      modules: 1,
      issues: [
        {
          moduleId: 'hello',
          kind: 'source-hash-drift',
          message: 'Module "hello" source hash differs from generated module map.',
          expected: 'old',
          actual: 'new',
        },
      ],
    },
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics[0], {
    severity: 'error',
    code: 'RUNTIME_MODULE_MAP_DRIFT',
    message: 'Module "hello" source hash differs from generated module map.',
    path: 'module-map.hello.source-hash-drift',
    fix: 'Run npm run modules:scan.',
  });
});

test('P18 runtime checks fail production memory runtime store', async () => {
  const result = await runRuntimeChecks({
    config: loadRuntimeConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
      PLOYKIT_HOST_URL: 'https://app.example.com',
      PLOYKIT_AUTH_PROVIDER: 'host',
    }),
    storage: createMemoryModuleFileStorage(),
    status: {
      store: {
        mode: 'memory',
        durable: false,
        databaseUrlConfigured: false,
      },
      providers: {
        files: 'local',
        billing: 'local',
        email: 'log',
        ai: 'static',
        rag: 'memory-vector',
      },
    },
    environment: 'production',
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.status.store, {
    mode: 'memory',
    durable: false,
    databaseUrlConfigured: false,
  });
  assert.deepEqual(result.status.providers, {
    files: 'local',
    billing: 'local',
    email: 'log',
    ai: 'static',
    rag: 'memory-vector',
  });
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === 'RUNTIME_STORE_MEMORY_MODE' && item.severity === 'error'
    )
  );
});

test('P18 runtime checks warn on development memory runtime store', async () => {
  const result = await runRuntimeChecks({
    config: loadRuntimeConfig({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
      PLOYKIT_HOST_URL: 'https://app.example.com',
      PLOYKIT_AUTH_PROVIDER: 'host',
    }),
    storage: createMemoryModuleFileStorage(),
    status: {
      store: {
        mode: 'memory',
        durable: false,
        databaseUrlConfigured: false,
      },
    },
    environment: 'development',
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === 'RUNTIME_STORE_MEMORY_MODE' && item.severity === 'warning'
    )
  );
});

test('P18 runtime matrix aggregates pass/fail checks with diagnostics', async () => {
  const matrix = await runRuntimeMatrix([
    { name: 'security', run: () => ({ ok: true }) },
    {
      name: 'backup-restore',
      run: () => ({
        ok: false,
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'BACKUP_RESTORE_FAILED',
            message: 'restore mismatch',
            path: 'backup',
          },
        ],
      }),
    },
  ]);

  assert.equal(matrix.ok, false);
  assert.equal(matrix.checks[1].diagnostics[0].code, 'BACKUP_RESTORE_FAILED');
});
