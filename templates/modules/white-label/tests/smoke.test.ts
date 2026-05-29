import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission, validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ white-label template declares presentation contract', () => {
  assert.equal(moduleDefinition.id, '__MODULE_ID__');
  assert.ok(moduleDefinition.permissions.includes(Permission.SurfaceOverride));
  assert.ok(moduleDefinition.permissions.includes(Permission.ThemeWrite));
  assert.equal(moduleDefinition.presentation?.whiteLabel, true);
  assert.deepEqual(moduleDefinition.presentation?.replaces, ['host.page:site.home']);
  assert.deepEqual(
    validateModuleDefinition(moduleDefinition).filter(
      (diagnostic) => diagnostic.code !== 'MODULE_ID_INVALID'
    ),
    []
  );
});
