import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runReleaseCandidateGate } from '../src/lib/module-runtime';

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-rc-gate-'));
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function providerInvocationEvidence() {
  return {
    domainEvidence: {
      providerInvocationLedger: {
        invocations: 6,
        successful: 6,
        failed: 0,
        operations: ['contextPack', 'delete', 'embedText', 'generateText', 'index', 'search'],
        kinds: ['ai', 'rag'],
        ragSources: 1,
        ragChunks: 2,
        connectorInvocations: 1,
      },
    },
  };
}

function workerSoakEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: true,
    checkedAt: '2026-05-23T00:00:00.000Z',
    enqueued: 3,
    drain: {
      iterations: 1,
      processed: 3,
      failed: 0,
      deadLettered: 0,
    },
    deliveryLedger: {
      records: 4,
      delivered: 4,
      failed: 0,
      deadLettered: 0,
      workerRecords: 1,
      workers: 3,
    },
    workerRegistry: {
      workers: 1,
      activeWorkers: 1,
      errorWorkers: 0,
      latestHeartbeatAt: '2026-05-23T00:00:00.000Z',
    },
    ...overrides,
  };
}

const FIXTURE_MODULE_ID = 'fixture-module';
const FIXTURE_MODULE_ROUTE_PATHS = [
  '/dashboard/fixture-module',
  '/dashboard/fixture-module/items',
  '/dashboard/fixture-module/items/demo-item',
  '/dashboard/fixture-module/runs',
  '/dashboard/fixture-module/runs/demo-run',
  '/dashboard/fixture-module/operators',
  '/dashboard/fixture-module/operators/demo-operator',
  '/dashboard/fixture-module/pools',
  '/dashboard/fixture-module/diagnostics',
  '/dashboard/fixture-module/api',
  '/dashboard/fixture-module/webhooks',
  '/dashboard/fixture-module/scheduler',
  '/dashboard/fixture-module/storage',
  '/dashboard/fixture-module/security',
  '/dashboard/fixture-module/usage',
  '/dashboard/fixture-module/enterprise',
];

function fixtureModuleRouteChecks() {
  return ['desktop', 'mobile'].flatMap((viewport) =>
    FIXTURE_MODULE_ROUTE_PATHS.map((routePath) => ({ id: `${viewport}:${routePath}`, ok: true }))
  );
}

const FIXTURE_MODULE_P2_BROWSER_CHECKS = [
  ...fixtureModuleRouteChecks().map((check) => check.id),
  'p2-interactive-routes',
  'p2-action-submissions',
  'p2-filter-submissions',
  'p2-copy-controls',
  'p2-confirmation-flows',
];

function fixtureModuleP2BrowserEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-26T00:00:00.000Z',
    checks: FIXTURE_MODULE_P2_BROWSER_CHECKS.map((id) => ({ id, ok: true })),
    ...overrides,
  };
}

const FIXTURE_MODULE_CORE_E2E_CHECKS = [
  'core-reachable',
  'admin-signed-service-auth',
  'admin-signed-service-rejects-invalid-signature',
  'core-meta',
  'ploykit-host-runtime-seed',
  'ploykit-host-dashboard-api-smoke',
  'ploykit-files-core-asset-e2e',
  'ploykit-background-validator-first-success-e2e',
  'ploykit-runtime-admin-flow',
  'project-create-and-tenant-binding',
  'cross-tenant-project-access-blocked',
  'resource-pool-lifecycle',
  'item-type-create-update-contract',
  'api-token-one-time-display',
  'integration-key-one-time-display-and-audit',
  'webhook-endpoint-lifecycle',
  'schedule-lifecycle',
  'admin-run-operator-success-assets-events-logs',
  'failed-run-retry-cancel',
  'external-run-idempotency-list-detail-cancel',
  'external-run-operator-success-callback-delivery-retry',
  'encrypted-payload-result-passthrough',
  'usage-daily-quota-exceeded',
  'metrics-root-surface',
  'one-time-secret-redaction-evidence',
  'cleanup-revoke-and-delete',
];

const FIXTURE_MODULE_CORE_VERIFICATION_CHECKS = [
  'core-unit-test-all',
  'core-static-analysis',
  'core-concurrency-check',
  'core-database-integration',
  'core-container-image-build',
];

function fixtureModuleCoreE2eEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: true,
    skipped: false,
    baseUrl: 'http://localhost:8080',
    checkedAt: '2026-05-26T00:00:00.000Z',
    checks: FIXTURE_MODULE_CORE_E2E_CHECKS.map((id) => ({ id, ok: true })),
    ...overrides,
  };
}

function fixtureModuleCoreVerificationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-26T00:00:00.000Z',
    checks: FIXTURE_MODULE_CORE_VERIFICATION_CHECKS.map((id) => ({ id, ok: true })),
    ...overrides,
  };
}

function writeModuleQualityManifest(root: string) {
  const routes = FIXTURE_MODULE_ROUTE_PATHS.map((routePath) => ({
    path: routePath,
    auth: true,
    contains: 'Fixture Module',
  }));
  writeJson(path.join(root, 'src', 'lib', 'module-map.manifest.json'), {
    modules: [
      {
        id: FIXTURE_MODULE_ID,
        name: 'Fixture Module',
        quality: {
          routes: {
            browser: routes,
            accessibility: routes,
          },
          evidence: [
            {
              id: 'fixture-module-core-e2e',
              title: 'Fixture Module Core E2E',
              runtimeDir: 'modules/fixture-module/core-e2e',
              required: true,
              command: {
                script: 'module:evidence',
              },
              checks: FIXTURE_MODULE_CORE_E2E_CHECKS,
            },
            {
              id: 'fixture-module-p2-browser',
              title: 'Fixture Module P2 browser evidence',
              runtimeDir: 'modules/fixture-module/p2-browser',
              required: true,
              command: {
                script: 'module:evidence',
              },
              checks: FIXTURE_MODULE_P2_BROWSER_CHECKS,
            },
            {
              id: 'fixture-module-core-verification',
              title: 'Fixture Module Core verification evidence',
              runtimeDir: 'modules/fixture-module/core-verification',
              required: true,
              command: {
                script: 'module:evidence',
              },
              checks: FIXTURE_MODULE_CORE_VERIFICATION_CHECKS,
            },
          ],
        },
      },
    ],
  });
}

test('P21 RC gate rejects formal legacy runtime entries', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const legacyFactory = `${'define'}${'Plugin'}`;
  const legacySdk = `${'@ploykit'}/${'plugin-sdk'}`;
  fs.writeFileSync(
    path.join(root, 'src', 'bad.ts'),
    `import { ${legacyFactory} } from '${legacySdk}';\n`
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: ['src'],
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.scannedFiles, 1);
  assert.ok(result.diagnostics.some((item) => item.code === 'RC_LEGACY_DEFINE_FACTORY'));
  assert.ok(result.diagnostics.some((item) => item.code === 'RC_LEGACY_SDK_IMPORT'));
});

test('P21 RC gate allows cleanup documentation but fails explicit failed checks', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const legacyStorage = `${'ctx'}.${'storage'}`;
  fs.writeFileSync(
    path.join(root, 'docs', 'cleanup.md'),
    `cleanup: do not use ${legacyStorage}; use Data v2.\nnever move ${'plugin'}-${'runtime'} into v2.\n`
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: ['docs'],
    requiredChecks: { 'web-shell': false },
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.checks.find((item) => item.id === 'web-shell')?.status, 'failed');
  assert.ok(result.checks.some((item) => item.id === 'browser-matrix'));
  assert.ok(result.checks.some((item) => item.id === 'data-safety-matrix'));
});

test('P21 RC gate allows old PloyKit inventory documents as historical context', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', 'old-ploykit-inventory.zh-CN.md'),
    [
      '| `/api/plugins/{...slug}` | legacy inventory only |',
      '- `src/lib/plugin-runtime/files/**`',
    ].join('\n')
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: ['docs'],
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 0);
});

test('P21 RC gate reads provider matrix evidence with local depth and AI/RAG smoke', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, '.runtime', 'provider-matrix'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'provider-matrix', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: true,
      checkedAt: '2026-05-21T00:00:00.000Z',
      ...providerInvocationEvidence(),
      checks: [
        { id: 'local-provider-depth', ok: true },
        { id: 'ai-rag-local', ok: true },
      ],
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'provider-live-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const providerCheck = result.checks.find((item) => item.id === 'provider-live-matrix');

  assert.equal(result.ok, false);
  assert.equal(providerCheck?.status, 'passed');
  assert.match(providerCheck?.evidence ?? '', /local-provider-depth/);
  assert.match(providerCheck?.evidence ?? '', /ai-rag-local/);
});

test('P21 RC gate fails required provider matrix without local depth smoke', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, '.runtime', 'provider-matrix'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'provider-matrix', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: true,
      checkedAt: '2026-05-21T00:00:00.000Z',
      ...providerInvocationEvidence(),
      checks: [
        { id: 's3-compatible-storage', ok: true },
        { id: 'ai-rag-local', ok: true },
      ],
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'provider-live-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const providerCheck = result.checks.find((item) => item.id === 'provider-live-matrix');

  assert.equal(result.ok, false);
  assert.equal(providerCheck?.status, 'failed');
  assert.match(providerCheck?.evidence ?? '', /local-provider-depth evidence is missing/);
});

test('P21 RC gate fails required provider matrix without AI/RAG local smoke', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, '.runtime', 'provider-matrix'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'provider-matrix', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: true,
      checkedAt: '2026-05-21T00:00:00.000Z',
      ...providerInvocationEvidence(),
      checks: [
        { id: 'local-provider-depth', ok: true },
        { id: 's3-compatible-storage', ok: true },
      ],
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'provider-live-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const providerCheck = result.checks.find((item) => item.id === 'provider-live-matrix');

  assert.equal(result.ok, false);
  assert.equal(providerCheck?.status, 'failed');
  assert.match(providerCheck?.evidence ?? '', /ai-rag-local evidence is missing/);
});

test('P21 RC gate rejects non-required provider matrix for strict evidence', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, '.runtime', 'provider-matrix'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'provider-matrix', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: false,
      checkedAt: '2026-05-21T00:00:00.000Z',
      ...providerInvocationEvidence(),
      checks: [
        { id: 'local-provider-depth', ok: true },
        { id: 'ai-rag-local', ok: true },
      ],
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'provider-live-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const providerCheck = result.checks.find((item) => item.id === 'provider-live-matrix');

  assert.equal(result.ok, false);
  assert.equal(providerCheck?.status, 'failed');
  assert.match(providerCheck?.evidence ?? '', /--required/);
});

test('P21 RC gate reads runtime store Postgres strict evidence', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, '.runtime', 'runtime-store-postgres'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'runtime-store-postgres', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: true,
      profile: 'local-postgres',
      checkedAt: '2026-05-21T00:00:00.000Z',
      checks: [
        { id: 'runtime-stores-verify', ok: true },
        { id: 'runtime-stores-tests', ok: true },
      ],
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'runtime-stores': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const runtimeCheck = result.checks.find((item) => item.id === 'runtime-stores');

  assert.equal(result.ok, false);
  assert.equal(runtimeCheck?.status, 'passed');
  assert.match(runtimeCheck?.evidence ?? '', /local-postgres/);
});

test('P21 RC gate fails runtime store strict evidence when local Postgres report is missing', () => {
  const root = createTempProject();

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'runtime-stores': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const runtimeCheck = result.checks.find((item) => item.id === 'runtime-stores');

  assert.equal(result.ok, false);
  assert.equal(runtimeCheck?.status, 'failed');
  assert.match(runtimeCheck?.evidence ?? '', /host:postgres-local-smoke/);
});

test('P21 RC gate reads worker soak strict evidence', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, '.runtime', 'worker-soak'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'worker-soak', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: true,
      checkedAt: '2026-05-21T00:00:00.000Z',
      enqueued: 3,
      drain: {
        iterations: 1,
        processed: 3,
        failed: 0,
        deadLettered: 0,
      },
      deliveryLedger: {
        records: 4,
        delivered: 4,
        failed: 0,
        deadLettered: 0,
        workerRecords: 1,
        workers: 3,
      },
      workerRegistry: {
        workers: 1,
        activeWorkers: 1,
        errorWorkers: 0,
        latestHeartbeatAt: '2026-05-21T00:00:00.000Z',
      },
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'worker-soak': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const workerCheck = result.checks.find((item) => item.id === 'worker-soak');

  assert.equal(result.ok, false);
  assert.equal(workerCheck?.status, 'passed');
  assert.match(workerCheck?.evidence ?? '', /3\/3/);
});

test('P21 RC gate reads host product smoke evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'host-smoke', 'latest.json'), {
    ok: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    baseUrl: 'http://localhost:3000',
    checks: [
      { id: 'site-home', ok: true },
      { id: 'admin-modules', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'host-product-smoke': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const hostSmokeCheck = result.checks.find((item) => item.id === 'host-product-smoke');

  assert.equal(result.ok, false);
  assert.equal(hostSmokeCheck?.status, 'passed');
  assert.match(hostSmokeCheck?.evidence ?? '', /2 checks/);
});

test('P21 RC gate reads web shell evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'web-shell', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    summary: { tests: 42, pass: 42, fail: 0, skipped: 0 },
    checks: [{ id: 'test:web-shell', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'web-shell': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const webShellCheck = result.checks.find((item) => item.id === 'web-shell');

  assert.equal(result.ok, false);
  assert.equal(webShellCheck?.status, 'passed');
  assert.match(webShellCheck?.evidence ?? '', /42 tests/);
});

test('P21 RC gate rejects non-required browser matrix for strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'browser-matrix', 'latest.json'), {
    ok: true,
    required: false,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    checks: [{ id: 'desktop:/zh/admin', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'browser-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const browserCheck = result.checks.find((item) => item.id === 'browser-matrix');

  assert.equal(result.ok, false);
  assert.equal(browserCheck?.status, 'failed');
  assert.match(browserCheck?.evidence ?? '', /--required/);
});

test('P21 RC gate rejects browser matrix without module-declared route coverage', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(path.join(root, '.runtime', 'browser-matrix', 'latest.json'), {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    checks: [{ id: 'desktop:/zh/admin', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'browser-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const browserCheck = result.checks.find((item) => item.id === 'browser-matrix');

  assert.equal(result.ok, false);
  assert.equal(browserCheck?.status, 'failed');
  assert.match(browserCheck?.evidence ?? '', /module-declared route evidence/);
});

test('P21 RC gate reads accessibility smoke with module-declared route coverage', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(path.join(root, '.runtime', 'accessibility-smoke', 'latest.json'), {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    checks: fixtureModuleRouteChecks(),
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'accessibility-smoke': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const accessibilityCheck = result.checks.find((item) => item.id === 'accessibility-smoke');

  assert.equal(result.ok, false);
  assert.equal(accessibilityCheck?.status, 'passed');
  assert.match(accessibilityCheck?.evidence ?? '', /Accessibility smoke passed/);
});

test('P21 RC gate rejects accessibility smoke without module-declared route coverage', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(path.join(root, '.runtime', 'accessibility-smoke', 'latest.json'), {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    checks: [{ id: 'desktop:/zh/docs', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'accessibility-smoke': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const accessibilityCheck = result.checks.find((item) => item.id === 'accessibility-smoke');

  assert.equal(result.ok, false);
  assert.equal(accessibilityCheck?.status, 'failed');
  assert.match(accessibilityCheck?.evidence ?? '', /module-declared route evidence/);
});

test('P21 RC gate reads strict module-declared core E2E evidence', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-e2e', 'latest.json'),
    fixtureModuleCoreE2eEvidence()
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'p2-browser', 'latest.json'),
    fixtureModuleP2BrowserEvidence()
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-verification', 'latest.json'),
    fixtureModuleCoreVerificationEvidence()
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'module-quality': true },
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  const coreCheck = result.checks.find((item) => item.id === 'module-quality');

  assert.equal(result.ok, false);
  assert.equal(coreCheck?.status, 'passed');
  assert.match(coreCheck?.evidence ?? '', /fixture-module:fixture-module-core-e2e/);
  assert.match(coreCheck?.evidence ?? '', /fixture-module:fixture-module-p2-browser/);
  assert.match(coreCheck?.evidence ?? '', /fixture-module:fixture-module-core-verification/);
});

test('P21 RC gate rejects non-required module-declared core E2E evidence for strict gate', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-e2e', 'latest.json'),
    fixtureModuleCoreE2eEvidence({ required: false })
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'p2-browser', 'latest.json'),
    fixtureModuleP2BrowserEvidence()
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-verification', 'latest.json'),
    fixtureModuleCoreVerificationEvidence()
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'module-quality': true },
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  const coreCheck = result.checks.find((item) => item.id === 'module-quality');

  assert.equal(result.ok, false);
  assert.equal(coreCheck?.status, 'failed');
  assert.match(coreCheck?.evidence ?? '', /--required/);
});

test('P21 RC gate rejects module-declared core E2E evidence missing required flow checks', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-e2e', 'latest.json'),
    fixtureModuleCoreE2eEvidence({
      checks: FIXTURE_MODULE_CORE_E2E_CHECKS.filter((id) => id !== 'usage-daily-quota-exceeded').map(
        (id) => ({ id, ok: true })
      ),
    })
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'p2-browser', 'latest.json'),
    fixtureModuleP2BrowserEvidence()
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-verification', 'latest.json'),
    fixtureModuleCoreVerificationEvidence()
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'module-quality': true },
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  const coreCheck = result.checks.find((item) => item.id === 'module-quality');

  assert.equal(result.ok, false);
  assert.equal(coreCheck?.status, 'failed');
  assert.match(coreCheck?.evidence ?? '', /usage-daily-quota-exceeded/);
});

test('P21 RC gate rejects module-declared P2 browser evidence missing interaction checks', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-e2e', 'latest.json'),
    fixtureModuleCoreE2eEvidence()
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'p2-browser', 'latest.json'),
    fixtureModuleP2BrowserEvidence({
      checks: FIXTURE_MODULE_P2_BROWSER_CHECKS.filter((id) => id !== 'p2-confirmation-flows').map(
        (id) => ({ id, ok: true })
      ),
    })
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-verification', 'latest.json'),
    fixtureModuleCoreVerificationEvidence()
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'module-quality': true },
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  const coreCheck = result.checks.find((item) => item.id === 'module-quality');

  assert.equal(result.ok, false);
  assert.equal(coreCheck?.status, 'failed');
  assert.match(coreCheck?.evidence ?? '', /p2-confirmation-flows/);
});

test('P21 RC gate rejects module-declared core verification evidence missing required checks', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-e2e', 'latest.json'),
    fixtureModuleCoreE2eEvidence()
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'p2-browser', 'latest.json'),
    fixtureModuleP2BrowserEvidence()
  );
  writeJson(
    path.join(root, '.runtime', 'modules', FIXTURE_MODULE_ID, 'core-verification', 'latest.json'),
    fixtureModuleCoreVerificationEvidence({
      checks: FIXTURE_MODULE_CORE_VERIFICATION_CHECKS.filter((id) => id !== 'core-static-analysis').map(
        (id) => ({ id, ok: true })
      ),
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'module-quality': true },
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  const coreCheck = result.checks.find((item) => item.id === 'module-quality');

  assert.equal(result.ok, false);
  assert.equal(coreCheck?.status, 'failed');
  assert.match(coreCheck?.evidence ?? '', /core-static-analysis/);
});

test('P21 RC gate blocks pending required module quality evidence', () => {
  const root = createTempProject();
  writeModuleQualityManifest(root);

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  const coreCheck = result.checks.find((item) => item.id === 'module-quality');

  assert.equal(result.ok, false);
  assert.equal(coreCheck?.status, 'pending');
  assert.match(coreCheck?.evidence ?? '', /Run npm run module:evidence/);
});

test('P21 RC gate reads product presentation manifest evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'product-presentation-manifest.json'), {
    kind: 'ploykit.product-presentation.manifest',
    checkedAt: '2026-05-23T00:00:00.000Z',
    product: { id: 'test-product', supportedLanguages: ['zh', 'en'] },
    pages: {
      'site.home': { moduleId: 'white-label-site-demo', enabled: true },
    },
    diagnostics: [],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'product-presentation-kernel': true },
    now: () => new Date('2026-05-23T00:00:00.000Z'),
  });
  const presentationCheck = result.checks.find(
    (item) => item.id === 'product-presentation-kernel'
  );

  assert.equal(result.ok, false);
  assert.equal(presentationCheck?.status, 'passed');
  assert.match(presentationCheck?.evidence ?? '', /test-product/);
});

test('P21 RC gate fails product presentation manifest with diagnostics', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'product-presentation-manifest.json'), {
    kind: 'ploykit.product-presentation.manifest',
    checkedAt: '2026-05-23T00:00:00.000Z',
    product: { id: 'test-product', supportedLanguages: ['zh', 'en'] },
    pages: {},
    diagnostics: [
      {
        severity: 'error',
        code: 'PRESENTATION_LEGACY_CONFIG_PRESENT',
        path: 'product-composition.config.json',
      },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'product-presentation-kernel': true },
    now: () => new Date('2026-05-23T00:00:00.000Z'),
  });
  const presentationCheck = result.checks.find(
    (item) => item.id === 'product-presentation-kernel'
  );

  assert.equal(result.ok, false);
  assert.equal(presentationCheck?.status, 'failed');
  assert.match(presentationCheck?.evidence ?? '', /PRESENTATION_LEGACY_CONFIG_PRESENT/);
});

test('P21 RC gate reads production adapter evidence from provider, store and worker reports', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'provider-matrix', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    ...providerInvocationEvidence(),
    checks: [
      { id: 'local-provider-depth', ok: true },
      { id: 'ai-rag-local', ok: true },
    ],
  });
  writeJson(path.join(root, '.runtime', 'runtime-store-postgres', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    profile: 'local-postgres',
    checks: [{ id: 'runtime-stores-verify', ok: true }],
  });
  writeJson(path.join(root, '.runtime', 'worker-soak', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    enqueued: 2,
    drain: { iterations: 1, processed: 2, failed: 0, deadLettered: 0 },
    deliveryLedger: {
      records: 3,
      delivered: 3,
      failed: 0,
      deadLettered: 0,
      workerRecords: 1,
      workers: 2,
    },
    workerRegistry: {
      workers: 1,
      activeWorkers: 1,
      errorWorkers: 0,
      latestHeartbeatAt: '2026-05-21T00:00:00.000Z',
    },
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'production-adapters': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const adaptersCheck = result.checks.find((item) => item.id === 'production-adapters');

  assert.equal(result.ok, false);
  assert.equal(adaptersCheck?.status, 'passed');
  assert.match(adaptersCheck?.evidence ?? '', /provider matrix, runtime store, worker soak, and delivery ledger/);
});

test('P9 RC gate reads delivery ledger and worker registry strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'worker-soak', 'latest.json'), workerSoakEvidence());

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'delivery-ledger': true },
    now: () => new Date('2026-05-23T00:00:00.000Z'),
  });
  const deliveryCheck = result.checks.find((item) => item.id === 'delivery-ledger');

  assert.equal(result.ok, false);
  assert.equal(deliveryCheck?.status, 'passed');
  assert.match(deliveryCheck?.evidence ?? '', /worker registry/);
});

test('P9 RC gate fails delivery ledger strict evidence without persisted worker registry', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'worker-soak', 'latest.json'), workerSoakEvidence({
    workerRegistry: {
      workers: 0,
      activeWorkers: 0,
      errorWorkers: 0,
    },
  }));

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'delivery-ledger': true },
    now: () => new Date('2026-05-23T00:00:00.000Z'),
  });
  const deliveryCheck = result.checks.find((item) => item.id === 'delivery-ledger');

  assert.equal(result.ok, false);
  assert.equal(deliveryCheck?.status, 'failed');
  assert.match(deliveryCheck?.evidence ?? '', /workers=0/);
});

test('P9 RC gate reads commercial domain strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'billing-reconcile', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    productId: 'billing-reconcile-product',
    workspaceId: 'billing-reconcile-workspace',
    userId: 'billing-reconcile-user',
    domainEvidence: {
      commercialDomain: {
        orders: 2,
        paidOrders: 1,
        invoices: 1,
        subscriptions: 1,
        catalogItems: 2,
        billingAccount: true,
        revenueBuckets: 1,
      },
    },
    checks: [{ id: 'billing-commercial-domain-evidence', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'commercial-domain': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const commercialCheck = result.checks.find((item) => item.id === 'commercial-domain');

  assert.equal(result.ok, false);
  assert.equal(commercialCheck?.status, 'passed');
  assert.match(commercialCheck?.evidence ?? '', /revenue buckets/);
});

test('P9 RC gate reads provider invocation ledger strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'ai-rag-local', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    domainEvidence: {
      providerInvocationLedger: {
        invocations: 6,
        successful: 6,
        failed: 0,
        operations: ['contextPack', 'delete', 'embedText', 'generateText', 'index', 'search'],
        kinds: ['ai', 'rag'],
        ragSources: 1,
        ragChunks: 2,
        connectorInvocations: 1,
      },
    },
    checks: [{ id: 'ai-provider-runtime', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'provider-invocation-ledger': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const providerCheck = result.checks.find((item) => item.id === 'provider-invocation-ledger');

  assert.equal(result.ok, false);
  assert.equal(providerCheck?.status, 'passed');
  assert.match(providerCheck?.evidence ?? '', /generateText/);
  assert.match(providerCheck?.evidence ?? '', /RAG sources/);
});

test('P21 RC gate reads data safety and security operation evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'data-safety', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    checks: [
      { id: 'route-security-catalog', ok: true },
      { id: 'legacy-runtime-scan', ok: true },
      { id: 'secret-redaction-smoke', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: {
      'data-safety-matrix': true,
      'security-operations': true,
    },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.find((item) => item.id === 'data-safety-matrix')?.status, 'passed');
  assert.equal(result.checks.find((item) => item.id === 'security-operations')?.status, 'passed');
});

test('P21 RC gate reads unified drift strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'drift-check', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'unified-drift-check',
    policy: {
      warningBlocks: false,
      errorBlocks: true,
    },
    summary: {
      total: 2,
      blocking: 0,
      errors: 0,
      warnings: 2,
      domains: ['catalog', 'module-map'],
    },
    findings: [
      {
        id: 'module-map:warning',
        domain: 'module-map',
        severity: 'warning',
        blocking: false,
        message: 'module map has a freshness warning',
      },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'drift-check-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const driftCheck = result.checks.find((item) => item.id === 'drift-check-matrix');

  assert.equal(result.ok, false);
  assert.equal(driftCheck?.status, 'passed');
  assert.match(driftCheck?.evidence ?? '', /unified drift check passed/i);
});

test('P21 RC gate rejects non-required unified drift evidence for strict gate', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'drift-check', 'latest.json'), {
    ok: true,
    required: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'unified-drift-check',
    policy: {
      warningBlocks: false,
      errorBlocks: true,
    },
    summary: {
      total: 0,
      blocking: 0,
      errors: 0,
      warnings: 0,
      domains: [],
    },
    findings: [],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'drift-check-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const driftCheck = result.checks.find((item) => item.id === 'drift-check-matrix');

  assert.equal(result.ok, false);
  assert.equal(driftCheck?.status, 'failed');
  assert.match(driftCheck?.evidence ?? '', /drift:check -- --required/i);
});

test('P21 RC gate reads backup/restore strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'backup-restore', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'runtime-store-semantic-snapshot',
    checks: [{ id: 'runtime-store-semantic-snapshot', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'backup-restore-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const backupCheck = result.checks.find((item) => item.id === 'backup-restore-matrix');

  assert.equal(result.ok, false);
  assert.equal(backupCheck?.status, 'passed');
  assert.match(backupCheck?.evidence ?? '', /runtime-store-semantic-snapshot/);
});

test('P21 RC gate rejects non-required backup/restore evidence for strict gate', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'backup-restore', 'latest.json'), {
    ok: true,
    required: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'runtime-store-semantic-snapshot',
    checks: [{ id: 'runtime-store-semantic-snapshot', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'backup-restore-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const backupCheck = result.checks.find((item) => item.id === 'backup-restore-matrix');

  assert.equal(result.ok, false);
  assert.equal(backupCheck?.status, 'failed');
  assert.match(backupCheck?.evidence ?? '', /--required/);
});

test('P21 RC gate reads upgrade migration strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'upgrade-migration', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'runtime-store-upgrade-migration-static',
    checks: [
      { id: 'sequential-runtime-migrations', ok: true },
      { id: 'idempotent-runtime-migrations', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'upgrade-migration-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const upgradeCheck = result.checks.find((item) => item.id === 'upgrade-migration-matrix');

  assert.equal(result.ok, false);
  assert.equal(upgradeCheck?.status, 'passed');
  assert.match(upgradeCheck?.evidence ?? '', /runtime-store-upgrade-migration-static/);
});

test('P21 RC gate rejects failed upgrade migration evidence for strict gate', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'upgrade-migration', 'latest.json'), {
    ok: false,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'runtime-store-upgrade-migration-static',
    checks: [
      { id: 'sequential-runtime-migrations', ok: true },
      { id: 'non-destructive-runtime-migrations', ok: false },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'upgrade-migration-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const upgradeCheck = result.checks.find((item) => item.id === 'upgrade-migration-matrix');

  assert.equal(result.ok, false);
  assert.equal(upgradeCheck?.status, 'failed');
  assert.match(upgradeCheck?.evidence ?? '', /non-destructive-runtime-migrations/);
});

test('P21 RC gate reads chaos strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'chaos', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'runtime-store-queue-chaos-local',
    checks: [
      { id: 'queue-concurrency-drain', ok: true },
      { id: 'expired-lease-reclaim', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'chaos-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const chaosCheck = result.checks.find((item) => item.id === 'chaos-matrix');

  assert.equal(result.ok, false);
  assert.equal(chaosCheck?.status, 'passed');
  assert.match(chaosCheck?.evidence ?? '', /runtime-store-queue-chaos-local/);
});

test('P21 RC gate rejects non-required chaos evidence for strict gate', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'chaos', 'latest.json'), {
    ok: true,
    required: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'runtime-store-queue-chaos-local',
    checks: [{ id: 'queue-concurrency-drain', ok: true }],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'chaos-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const chaosCheck = result.checks.find((item) => item.id === 'chaos-matrix');

  assert.equal(result.ok, false);
  assert.equal(chaosCheck?.status, 'failed');
  assert.match(chaosCheck?.evidence ?? '', /--required/);
});

test('P21 RC gate reads module contract and demo product module reports', () => {
  const root = createTempProject();
  for (const moduleId of ['public-tools-demo', 'shop-demo']) {
    fs.mkdirSync(path.join(root, 'modules', moduleId), { recursive: true });
    fs.writeFileSync(path.join(root, 'modules', moduleId, 'module.ts'), '');
    writeJson(path.join(root, '.runtime', 'module-test-reports', `${moduleId}.json`), {
      success: true,
      moduleRoot: `modules/${moduleId}`,
      checkedAt: '2026-05-21T00:00:00.000Z',
      steps: [{ name: 'doctor', ok: true }],
    });
  }

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: {
      'module-contract': true,
      'demo-products': true,
    },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.find((item) => item.id === 'module-contract')?.status, 'passed');
  assert.equal(result.checks.find((item) => item.id === 'demo-products')?.status, 'passed');
});

test('P21 RC gate reads documentation presence evidence', () => {
  const root = createTempProject();
  for (const docPath of [
    'README.md',
    'docs/README.zh-CN.md',
    'docs/deployment.zh-CN.md',
    'docs/module-development.zh-CN.md',
    'docs/operations.zh-CN.md',
    'docs/security-model.zh-CN.md',
    'docs/release-candidate-checklist.zh-CN.md',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, docPath)), { recursive: true });
    fs.writeFileSync(path.join(root, docPath), '# doc\n');
  }

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { documentation: true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const documentationCheck = result.checks.find((item) => item.id === 'documentation');

  assert.equal(result.ok, false);
  assert.equal(documentationCheck?.status, 'passed');
  assert.match(documentationCheck?.evidence ?? '', /release-candidate-checklist/);
});

test('P21 RC gate rejects non-required worker soak for strict evidence', () => {
  const root = createTempProject();
  fs.mkdirSync(path.join(root, '.runtime', 'worker-soak'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'worker-soak', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: false,
      checkedAt: '2026-05-21T00:00:00.000Z',
      enqueued: 3,
      drain: {
        iterations: 1,
        processed: 3,
        failed: 0,
        deadLettered: 0,
      },
    })
  );

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'worker-soak': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const workerCheck = result.checks.find((item) => item.id === 'worker-soak');

  assert.equal(result.ok, false);
  assert.equal(workerCheck?.status, 'failed');
  assert.match(workerCheck?.evidence ?? '', /--required/);
});
