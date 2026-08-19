import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk';

test('module UI context exposes only the clean host surface', () => {
  const context = createTestingModuleContext();
  assert.ok(context.data);
  assert.ok(context.files);
  assert.ok(context.ai);
  assert.ok(context.rag);
  assert.ok(context.commercial);
  assert.equal('extensions' in context, false);
  assert.equal('http' in context, false);
  assert.equal('artifacts' in context, false);
});
