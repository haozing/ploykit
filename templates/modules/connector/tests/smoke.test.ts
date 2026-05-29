import assert from 'node:assert/strict';
import test from 'node:test';
import moduleDefinition from '../module';

test('__MODULE_ID__ connector template declares sync job', () => {
  assert.ok(moduleDefinition.jobs?.sync);
});
