import assert from 'node:assert/strict';
import test from 'node:test';
import moduleDefinition from '../module';

test('__MODULE_ID__ signed service template declares runtime-managed service policy', () => {
  assert.equal(moduleDefinition.contractVersion, 2);
  assert.equal(moduleDefinition.serviceRequirements?.signedAdmin?.kind, 'signed-http');
  assert.ok(moduleDefinition.serviceRequirements?.signedAdmin?.operations?.['admin.request']);
});
