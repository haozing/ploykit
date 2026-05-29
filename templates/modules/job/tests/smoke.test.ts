import assert from 'node:assert/strict';
import test from 'node:test';
import moduleDefinition from '../module';

test('__MODULE_ID__ job template declares generate_report', () => {
  assert.ok(moduleDefinition.jobs?.generate_report);
});
