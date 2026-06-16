import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission, validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ AI/RAG template declares provider and cost guard contracts', () => {
  assert.equal(moduleDefinition.id, '__MODULE_ID__');
  assert.ok(moduleDefinition.permissions.includes(Permission.AiGenerate));
  assert.ok(moduleDefinition.permissions.includes(Permission.AiEmbed));
  assert.ok(moduleDefinition.permissions.includes(Permission.RagRead));
  assert.ok(moduleDefinition.permissions.includes(Permission.RagWrite));
  assert.ok(moduleDefinition.permissions.includes(Permission.CreditsConsume));
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.commercial?.credits?.amount, 1);
  assert.equal(moduleDefinition.actions?.ask?.commercial?.credits?.amount, 1);
  assert.deepEqual(
    validateModuleDefinition(moduleDefinition).filter(
      (diagnostic) => diagnostic.code !== 'MODULE_ID_INVALID'
    ),
    []
  );
});
