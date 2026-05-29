import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk';
import moduleDefinition from '../module';
import formatSample from '../actions/format-sample';

test('public-tools-demo declares public APIs and a guarded action', () => {
  assert.equal(moduleDefinition.id, 'public-tools-demo');
  assert.equal(moduleDefinition.routes?.api?.length, 4);
  assert.equal(moduleDefinition.routes?.site?.[0]?.metadata, './loaders/public-tools-metadata');
  assert.deepEqual(moduleDefinition.routes?.site?.[0]?.publicAliases, ['/tools/json', '/tools/csv']);
  assert.equal(moduleDefinition.actions?.formatSample.commercial?.credits?.amount, 1);
});

test('public-tools-demo guarded action formats JSON and records usage', async () => {
  const result = await formatSample.run(
    createTestingModuleContext({ moduleId: 'public-tools-demo' }),
    { source: '{"ok":true}' }
  );

  assert.equal(result.ok, true);
  assert.match(result.output, /"ok": true/);
});
