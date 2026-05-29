import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk';
import moduleDefinition from '../module';
import ping from '../actions/ping';

test('hello declares the minimal runtime capability surface', () => {
  assert.equal(moduleDefinition.id, 'hello');
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.path, '/hello');
  assert.equal(moduleDefinition.routes?.api?.[0]?.path, '/hello');
  assert.ok(moduleDefinition.data?.tables?.hello_posts);
  assert.ok(moduleDefinition.surfaces?.['dashboard.home:widgets']);
  assert.ok(moduleDefinition.webhooks?.echo);
});

test('hello ping action receives a typed module context', async () => {
  const result = await ping.run(createTestingModuleContext({ moduleId: 'hello' }), {});

  assert.equal(result.ok, true);
  assert.equal(result.moduleId, 'hello');
});
