import assert from 'node:assert/strict';
import test from 'node:test';
import { createModuleDiagnostic, defineModule } from '@ploykit/module-sdk';
import {
  createDeveloperPlatformReport,
  createModuleDevConsoleSnapshot,
  normalizeModuleRuntimeContract,
  presentModuleDiagnostics,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';

test('P20 diagnostics presenter groups severity and produces AI repair prompt without old plugin terms as instructions', () => {
  const diagnostics = [
    createModuleDiagnostic({
      severity: 'error',
      code: 'MODULE_ROUTE_HANDLER_MISSING',
      message: 'Missing handler.',
      path: 'routes.api.0.handler',
      fix: 'Add a local handler path.',
    }),
    createModuleDiagnostic({
      severity: 'warning',
      code: 'MODULE_PERMISSION_UNUSED',
      message: 'Unused permission.',
      path: 'permissions.0',
    }),
  ];
  const presented = presentModuleDiagnostics({ moduleId: 'demo', diagnostics });

  assert.equal(presented.errors.length, 1);
  assert.equal(presented.warnings.length, 1);
  assert.match(presented.aiFixPrompt, /ctx capabilities only/);
  assert.match(presented.aiFixPrompt, /MODULE_ROUTE_HANDLER_MISSING/);
});

test('P20 developer platform report exposes templates and modules with errors', () => {
  const moduleDefinition = defineModule({
    id: 'demo',
    name: 'Demo',
    version: '0.1.0',
  });
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      demo: {
        module: async () => ({ default: moduleDefinition }),
        runtimeContract: normalizeModuleRuntimeContract(moduleDefinition),
      },
    },
  };
  const diagnostics = [
    createModuleDiagnostic({
      severity: 'error',
      code: 'DEMO_ERROR',
      message: 'broken',
      path: 'module.id',
      fix: 'Fix the demo.',
    }),
  ];
  const snapshot = createModuleDevConsoleSnapshot({
    artifact,
    diagnosticsByModule: { demo: diagnostics },
    now: () => new Date('2026-05-19T00:00:00.000Z'),
  });
  const report = createDeveloperPlatformReport({
    snapshot,
    diagnosticsByModule: { demo: diagnostics },
  });

  assert.equal(report.modulesWithErrors[0], 'demo');
  assert.ok(report.templates.some((template) => template.id === 'billing-aware'));
  assert.ok(report.templates.some((template) => template.id === 'ai-rag'));
  assert.ok(report.templates.some((template) => template.id === 'signed-service'));
  assert.ok(report.templates.some((template) => template.id === 'product-app'));
  assert.match(report.aiFixPrompts.demo, /DEMO_ERROR/);
});
