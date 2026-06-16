import assert from 'node:assert/strict';
import test from 'node:test';

test('__MODULE_ID__ background extension declares job and enqueue action', async () => {
  const modulePath = '../module';
  const moduleDefinition = (await import(modulePath)).default;

  assert.ok(moduleDefinition.jobs?.generate_report);
  assert.ok(moduleDefinition.actions?.enqueueReport);
});
