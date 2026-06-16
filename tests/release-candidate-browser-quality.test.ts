import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runReleaseCandidateGate } from '../src/lib/module-runtime/release/rc-gate';
import {
  createTempProject,
  fixtureModuleCoreE2eEvidence,
  fixtureModuleCoreVerificationEvidence,
  fixtureModuleP2BrowserEvidence,
  fixtureModuleRouteChecks,
  FIXTURE_MODULE_CORE_E2E_CHECKS,
  FIXTURE_MODULE_CORE_VERIFICATION_CHECKS,
  FIXTURE_MODULE_ID,
  FIXTURE_MODULE_P2_BROWSER_CHECKS,
  writeJson,
  writeModuleQualityManifest,
} from './release-candidate-fixtures';

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
      checks: FIXTURE_MODULE_CORE_E2E_CHECKS.filter(
        (id) => id !== 'usage-daily-quota-exceeded'
      ).map((id) => ({ id, ok: true })),
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
      checks: FIXTURE_MODULE_CORE_VERIFICATION_CHECKS.filter(
        (id) => id !== 'core-static-analysis'
      ).map((id) => ({ id, ok: true })),
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
