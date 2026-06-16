import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runReleaseCandidateGate } from '../src/lib/module-runtime/release/rc-gate';
import { createTempProject, writeJson } from './release-candidate-fixtures';

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

test('P9 RC gate reads files storage domain strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'files-cleanup', 'latest.json'), {
    ok: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    file: {
      id: 'file-cleaned',
      status: 'deleted',
      objectDeleted: true,
    },
    cleanup: {
      matched: 1,
      cleanedFileIds: ['file-cleaned'],
      auditId: 'audit-cleanup',
    },
    storage: {
      mode: 'local',
      durable: true,
    },
  });
  writeJson(path.join(root, '.runtime', 'files-reconcile', 'latest.json'), {
    ok: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    checks: [
      { id: 'ready-object-present', ok: true },
      { id: 'deleted-object-present-detected', ok: true },
      { id: 'missing-active-object-detected', ok: true },
      { id: 'orphan-object-detected', ok: true },
    ],
    report: {
      checkedFiles: 3,
      issues: 3,
      presentObjects: 2,
      missingObjects: 1,
      deletedObjectsPresent: 1,
      missingActiveObjects: 1,
      orphanObjects: 1,
      orphanBytes: 28,
    },
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'files-storage-domain': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const filesCheck = result.checks.find((item) => item.id === 'files-storage-domain');

  assert.equal(result.ok, false);
  assert.equal(filesCheck?.status, 'passed');
  assert.match(filesCheck?.evidence ?? '', /deleted-object, missing-object, and orphan-object/);
});

test('P9 RC gate fails files storage domain without reconcile evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'files-cleanup', 'latest.json'), {
    ok: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    file: {
      id: 'file-cleaned',
      status: 'deleted',
      objectDeleted: true,
    },
    cleanup: {
      matched: 1,
      cleanedFileIds: ['file-cleaned'],
      auditId: 'audit-cleanup',
    },
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'files-storage-domain': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const filesCheck = result.checks.find((item) => item.id === 'files-storage-domain');

  assert.equal(result.ok, false);
  assert.equal(filesCheck?.status, 'failed');
  assert.match(filesCheck?.evidence ?? '', /host:files-reconcile-smoke/);
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

test('P9 RC gate reads AI/RAG policy strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'ai-rag-policy', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    profile: 'local-ai-rag-policy',
    domainEvidence: {
      aiRagPolicy: {
        budgetDeniesMissingCredits: true,
        successfulCostCommitted: true,
        failedProviderReservationReleased: true,
        anonymousRateLimitRequired: true,
        anonymousHighCostForbidden: true,
      },
    },
    checks: [
      { id: 'ai-budget-denies-missing-credits', ok: true },
      { id: 'ai-budget-commits-successful-cost', ok: true },
      { id: 'ai-budget-releases-failed-provider-reservation', ok: true },
      { id: 'anonymous-public-api-requires-rate-limit-policy', ok: true },
      { id: 'anonymous-public-api-forbids-high-cost-commercial-actions', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'ai-rag-policy': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const policyCheck = result.checks.find((item) => item.id === 'ai-rag-policy');

  assert.equal(result.ok, false);
  assert.equal(policyCheck?.status, 'passed');
  assert.match(policyCheck?.evidence ?? '', /budget guard, quota accounting/);
});

test('P9 RC gate rejects AI/RAG policy evidence missing anonymous fail-closed signal', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'ai-rag-policy', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    profile: 'local-ai-rag-policy',
    domainEvidence: {
      aiRagPolicy: {
        budgetDeniesMissingCredits: true,
        successfulCostCommitted: true,
        failedProviderReservationReleased: true,
        anonymousRateLimitRequired: true,
        anonymousHighCostForbidden: false,
      },
    },
    checks: [
      { id: 'ai-budget-denies-missing-credits', ok: true },
      { id: 'ai-budget-commits-successful-cost', ok: true },
      { id: 'ai-budget-releases-failed-provider-reservation', ok: true },
      { id: 'anonymous-public-api-requires-rate-limit-policy', ok: true },
      { id: 'anonymous-public-api-forbids-high-cost-commercial-actions', ok: false },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'ai-rag-policy': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const policyCheck = result.checks.find((item) => item.id === 'ai-rag-policy');

  assert.equal(result.ok, false);
  assert.equal(policyCheck?.status, 'failed');
  assert.match(policyCheck?.evidence ?? '', /anonymousHighCostForbidden/);
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

test('P21 RC gate reads Postgres physical restore strict evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'postgres-physical-restore', 'latest.json'), {
    ok: true,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'postgres-pg-dump-restore-local',
    checks: [
      { id: 'pg-dump-created', ok: true },
      { id: 'pg-restore-applied', ok: true },
      { id: 'restore-runtime-data-fingerprint', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'postgres-physical-restore-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const restoreCheck = result.checks.find((item) => item.id === 'postgres-physical-restore-matrix');

  assert.equal(result.ok, false);
  assert.equal(restoreCheck?.status, 'passed');
  assert.match(restoreCheck?.evidence ?? '', /postgres-pg-dump-restore-local/);
});

test('P21 RC gate rejects failed Postgres physical restore evidence for strict gate', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'postgres-physical-restore', 'latest.json'), {
    ok: false,
    required: true,
    checkedAt: '2026-05-21T00:00:00.000Z',
    mode: 'postgres-pg-dump-restore-local',
    checks: [
      { id: 'pg-dump-created', ok: true },
      { id: 'restore-runtime-data-fingerprint', ok: false },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'postgres-physical-restore-matrix': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const restoreCheck = result.checks.find((item) => item.id === 'postgres-physical-restore-matrix');

  assert.equal(result.ok, false);
  assert.equal(restoreCheck?.status, 'failed');
  assert.match(restoreCheck?.evidence ?? '', /restore-runtime-data-fingerprint/);
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
