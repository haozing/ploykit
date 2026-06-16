import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission, validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ billing-aware template declares commercial guards', () => {
  assert.equal(moduleDefinition.id, '__MODULE_ID__');
  assert.ok(moduleDefinition.permissions.includes(Permission.BillingRead));
  assert.ok(moduleDefinition.permissions.includes(Permission.CreditsRead));
  assert.ok(moduleDefinition.permissions.includes(Permission.CreditsConsume));
  assert.ok(moduleDefinition.permissions.includes(Permission.UsageWrite));
  assert.deepEqual(moduleDefinition.routes?.dashboard?.[0]?.commercial?.entitlements, ['pro']);
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.commercial?.credits?.amount, 1);
  assert.deepEqual(moduleDefinition.actions?.run_paid_tool?.commercial?.entitlements, ['pro']);
  assert.equal(moduleDefinition.actions?.run_paid_tool?.commercial?.credits?.amount, 1);
  assert.deepEqual(
    validateModuleDefinition(moduleDefinition).filter(
      (diagnostic) => diagnostic.code !== 'MODULE_ID_INVALID'
    ),
    []
  );
});
