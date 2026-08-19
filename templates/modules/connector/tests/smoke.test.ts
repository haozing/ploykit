import assert from 'node:assert/strict';
import test from 'node:test';
import moduleDefinition from '../module';

test('__MODULE_ID__ connector template declares sync job', () => {
  assert.equal(moduleDefinition.pages?.[0]?.id, '__MODULE_ID__.connector');
  assert.equal(moduleDefinition.pages?.[0]?.component, './pages/ConnectorPage.tsx');
  assert.ok(moduleDefinition.jobs?.sync);
});
