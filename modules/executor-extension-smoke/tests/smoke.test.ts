import assert from 'node:assert/strict';
import test from 'node:test';
import mod from '../module';
import executorProvider from '../capabilities/executor';
import readExecutorHealth from '../admin/executor-health.read';

test('executor-extension-smoke declares a minimal trusted extension contract', () => {
  assert.equal(mod.id, 'executor-extension-smoke');
  assert.equal(mod.kind, 'host-extension');
  assert.ok(mod.provides?.capabilities?.executor);
  assert.ok(mod.provides?.adminResources?.executorHealth);
});

test('executor-extension-smoke provider and admin operation expose health', async () => {
  assert.deepEqual(executorProvider.api.ping({ message: 'ok' }), {
    ok: true,
    message: 'ok',
  });
  const result = await readExecutorHealth(undefined, {
    module: { id: 'executor-extension-smoke', version: '0.1.0' },
  } as never);
  assert.deepEqual(result, {
    ok: true,
    moduleId: 'executor-extension-smoke',
    version: '0.1.0',
    capability: 'executor',
  });
});
