import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-rc-gate-'));
}

export function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

export function providerInvocationEvidence() {
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

export function workerSoakEvidence(overrides: Record<string, unknown> = {}) {
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

export const FIXTURE_MODULE_ID = 'fixture-module';

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

export function fixtureModuleRouteChecks() {
  return ['desktop', 'mobile'].flatMap((viewport) =>
    FIXTURE_MODULE_ROUTE_PATHS.map((routePath) => ({ id: `${viewport}:${routePath}`, ok: true }))
  );
}

export const FIXTURE_MODULE_P2_BROWSER_CHECKS = [
  ...fixtureModuleRouteChecks().map((check) => check.id),
  'p2-interactive-routes',
  'p2-action-submissions',
  'p2-filter-submissions',
  'p2-copy-controls',
  'p2-confirmation-flows',
];

export function fixtureModuleP2BrowserEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-26T00:00:00.000Z',
    checks: FIXTURE_MODULE_P2_BROWSER_CHECKS.map((id) => ({ id, ok: true })),
    ...overrides,
  };
}

export const FIXTURE_MODULE_CORE_E2E_CHECKS = [
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

export const FIXTURE_MODULE_CORE_VERIFICATION_CHECKS = [
  'core-unit-test-all',
  'core-static-analysis',
  'core-concurrency-check',
  'core-database-integration',
  'core-container-image-build',
];

export function fixtureModuleCoreE2eEvidence(overrides: Record<string, unknown> = {}) {
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

export function fixtureModuleCoreVerificationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-26T00:00:00.000Z',
    checks: FIXTURE_MODULE_CORE_VERIFICATION_CHECKS.map((id) => ({ id, ok: true })),
    ...overrides,
  };
}

export function writeModuleQualityManifest(root: string) {
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
