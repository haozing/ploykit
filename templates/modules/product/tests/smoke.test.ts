import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ product template declares product, white-label, and Data v2 contracts', () => {
  assert.equal(moduleDefinition.product?.kind, 'product');
  assert.deepEqual(moduleDefinition.product?.requiredShells, ['site', 'dashboard', 'admin']);
  assert.equal(moduleDefinition.presentation?.whiteLabel, true);
  assert.ok(moduleDefinition.presentation?.replaces?.includes('host.page:site.home'));
  assert.ok(moduleDefinition.data?.tables?.notes);
  assert.equal(moduleDefinition.routes?.site?.length, 1);
  assert.equal(moduleDefinition.routes?.dashboard?.length, 1);
  assert.equal(moduleDefinition.routes?.admin?.length, 1);
  assert.ok(moduleDefinition.routes?.api?.some((route) => route.path === '/notes'));
  assert.deepEqual(
    validateModuleDefinition(moduleDefinition).filter(
      (diagnostic) =>
        diagnostic.code !== 'MODULE_ID_INVALID' &&
        diagnostic.code !== 'MODULE_SYSTEM_PERMISSION_CONTEXT_BOUND'
    ),
    []
  );
});
