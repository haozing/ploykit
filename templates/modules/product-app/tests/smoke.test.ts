import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ product-app template declares site, console, and admin product pages', () => {
  assert.equal(moduleDefinition.product?.kind, 'product');
  assert.deepEqual(moduleDefinition.product?.requiredShells, ['site', 'dashboard', 'admin']);
  assert.equal(moduleDefinition.routes?.site?.length, 1);
  assert.equal(moduleDefinition.routes?.dashboard?.length, 1);
  assert.equal(moduleDefinition.routes?.admin?.length, 1);
  assert.ok(Array.isArray(moduleDefinition.navigation));
  assert.deepEqual(
    validateModuleDefinition(moduleDefinition).filter(
      (diagnostic) => diagnostic.code !== 'MODULE_ID_INVALID'
    ),
    []
  );
});
