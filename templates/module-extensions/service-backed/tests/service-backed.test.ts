import assert from 'node:assert/strict';
import test from 'node:test';

test('__MODULE_ID__ service-backed extension declares a signed service client contract', async () => {
  const modulePath = '../module';
  const moduleDefinition = (await import(modulePath)).default;

  assert.equal(moduleDefinition.contractVersion, 2);
  assert.equal(moduleDefinition.serviceRequirements?.serviceCore?.kind, 'signed-http');
  assert.ok(moduleDefinition.serviceRequirements?.serviceCore?.operations?.request);
  assert.ok(moduleDefinition.routes?.api?.some((route: { path?: string }) => route.path === '/service/status'));
  assert.ok(moduleDefinition.actions?.callService);
});
