import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runReleaseCandidateGate } from '../src/lib/module-runtime/release/rc-gate';
import {
  createTempProject,
  providerInvocationEvidence,
  workerSoakEvidence,
  writeJson,
} from './release-candidate-fixtures';

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

test('P21 RC gate reads dashboard transition strict repeat evidence', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'dashboard-transition-smoke', 'latest.json'), {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    summary: {
      repeat: 3,
      injectAnchor: true,
      transitions: 8,
      resetTransitions: 2,
      transitionDocumentNavigations: 0,
      hydrationErrors: 0,
      p95Ms: 246,
      appFramePresent: true,
      clientTransitionMarkerPresent: true,
      injectedAnchorInAppFrame: true,
    },
    checks: [
      { id: 'shell:app-frame', ok: true },
      { id: 'shell:client-transition-marker', ok: true },
      { id: 'shell:injected-anchor-frame', ok: true },
      { id: 'transition:document-navigation', ok: true },
      { id: 'transition:hydration', ok: true },
      { id: 'transition:p95', ok: true },
      { id: 'transition:1:/zh/dashboard->/zh/dashboard/workspaces', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'dashboard-transition-smoke': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const transitionCheck = result.checks.find((item) => item.id === 'dashboard-transition-smoke');

  assert.equal(result.ok, false);
  assert.equal(transitionCheck?.status, 'passed');
  assert.match(transitionCheck?.evidence ?? '', /repeat=3/);
  assert.match(transitionCheck?.evidence ?? '', /injectAnchor=true/);
  assert.match(transitionCheck?.evidence ?? '', /appFramePresent=true/);
  assert.match(transitionCheck?.evidence ?? '', /clientTransitionMarkerPresent=true/);
  assert.match(transitionCheck?.evidence ?? '', /injectedAnchorInAppFrame=true/);
  assert.match(transitionCheck?.evidence ?? '', /document navigations=0/);
});

test('P21 RC gate rejects dashboard transition smoke without repeat soak coverage', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'dashboard-transition-smoke', 'latest.json'), {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    summary: {
      repeat: 1,
      injectAnchor: true,
      transitions: 2,
      resetTransitions: 0,
      transitionDocumentNavigations: 0,
      hydrationErrors: 0,
      p95Ms: 240,
      appFramePresent: true,
      clientTransitionMarkerPresent: true,
      injectedAnchorInAppFrame: true,
    },
    checks: [
      { id: 'shell:app-frame', ok: true },
      { id: 'shell:client-transition-marker', ok: true },
      { id: 'shell:injected-anchor-frame', ok: true },
      { id: 'transition:document-navigation', ok: true },
      { id: 'transition:hydration', ok: true },
      { id: 'transition:p95', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'dashboard-transition-smoke': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const transitionCheck = result.checks.find((item) => item.id === 'dashboard-transition-smoke');

  assert.equal(result.ok, false);
  assert.equal(transitionCheck?.status, 'failed');
  assert.match(transitionCheck?.evidence ?? '', /repeat>=3/);
  assert.match(transitionCheck?.evidence ?? '', /reset transitions/);
});

test('P21 RC gate rejects dashboard transition smoke without injected anchor coverage', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'dashboard-transition-smoke', 'latest.json'), {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    summary: {
      repeat: 3,
      injectAnchor: false,
      transitions: 8,
      resetTransitions: 2,
      transitionDocumentNavigations: 0,
      hydrationErrors: 0,
      p95Ms: 246,
      appFramePresent: true,
      clientTransitionMarkerPresent: true,
      injectedAnchorInAppFrame: true,
    },
    checks: [
      { id: 'shell:app-frame', ok: true },
      { id: 'shell:client-transition-marker', ok: true },
      { id: 'transition:document-navigation', ok: true },
      { id: 'transition:hydration', ok: true },
      { id: 'transition:p95', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'dashboard-transition-smoke': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const transitionCheck = result.checks.find((item) => item.id === 'dashboard-transition-smoke');

  assert.equal(result.ok, false);
  assert.equal(transitionCheck?.status, 'failed');
  assert.match(transitionCheck?.evidence ?? '', /injectAnchor=true required/);
});

test('P21 RC gate rejects dashboard transition smoke without AppFrame client-transition markers', () => {
  const root = createTempProject();
  writeJson(path.join(root, '.runtime', 'dashboard-transition-smoke', 'latest.json'), {
    ok: true,
    required: true,
    skipped: false,
    checkedAt: '2026-05-21T00:00:00.000Z',
    summary: {
      repeat: 3,
      injectAnchor: true,
      transitions: 8,
      resetTransitions: 2,
      transitionDocumentNavigations: 0,
      hydrationErrors: 0,
      p95Ms: 246,
      appFramePresent: false,
      clientTransitionMarkerPresent: false,
      injectedAnchorInAppFrame: false,
    },
    checks: [
      { id: 'shell:app-frame', ok: false },
      { id: 'shell:client-transition-marker', ok: false },
      { id: 'shell:injected-anchor-frame', ok: false },
      { id: 'transition:document-navigation', ok: true },
      { id: 'transition:hydration', ok: true },
      { id: 'transition:p95', ok: true },
    ],
  });

  const result = runReleaseCandidateGate({
    projectRoot: root,
    targets: [],
    requiredChecks: { 'dashboard-transition-smoke': true },
    now: () => new Date('2026-05-21T00:00:00.000Z'),
  });
  const transitionCheck = result.checks.find((item) => item.id === 'dashboard-transition-smoke');

  assert.equal(result.ok, false);
  assert.equal(transitionCheck?.status, 'failed');
  assert.match(transitionCheck?.evidence ?? '', /appFramePresent=true required/);
  assert.match(transitionCheck?.evidence ?? '', /clientTransitionMarkerPresent=true required/);
  assert.match(transitionCheck?.evidence ?? '', /injectedAnchorInAppFrame=true required/);
  assert.match(transitionCheck?.evidence ?? '', /shell:app-frame check missing or failed/);
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
  const presentationCheck = result.checks.find((item) => item.id === 'product-presentation-kernel');

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
  const presentationCheck = result.checks.find((item) => item.id === 'product-presentation-kernel');

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
  assert.match(
    adaptersCheck?.evidence ?? '',
    /provider matrix, runtime store, worker soak, and delivery ledger/
  );
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
  writeJson(
    path.join(root, '.runtime', 'worker-soak', 'latest.json'),
    workerSoakEvidence({
      workerRegistry: {
        workers: 0,
        activeWorkers: 0,
        errorWorkers: 0,
      },
    })
  );

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
