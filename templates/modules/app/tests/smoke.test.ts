import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ app template uses clean page manifest', () => {
  assert.equal(moduleDefinition.pages?.[0]?.id, '__MODULE_ID__.home');
  assert.equal(moduleDefinition.pages?.[0]?.frame, 'workspace');
  assert.deepEqual(validateModuleDefinition(moduleDefinition), []);
});
