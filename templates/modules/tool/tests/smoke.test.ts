import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ tool template declares action and API schema', () => {
  assert.equal(moduleDefinition.pages?.[0]?.id, '__MODULE_ID__.tool');
  assert.ok(moduleDefinition.actions?.runTool.input);
  assert.ok(moduleDefinition.apis?.[0]?.input);
  assert.deepEqual(validateModuleDefinition(moduleDefinition), []);
});
