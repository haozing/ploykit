import assert from 'node:assert/strict';
import test from 'node:test';
import moduleDefinition from '../module';

test('__MODULE_ID__ module template has a valid id', () => {
  assert.equal(moduleDefinition.id, '__MODULE_ID__');
});
