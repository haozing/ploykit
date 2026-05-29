import assert from 'node:assert/strict';
import test from 'node:test';
import moduleDefinition from '../module';

test('__MODULE_ID__ crud template declares data', () => {
  assert.ok(moduleDefinition.data?.tables?.notes);
});
