import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ dashboard template declares localized navigation', () => {
  assert.ok(moduleDefinition.navigation);
  assert.equal(moduleDefinition.i18n?.strict, true);
  assert.deepEqual(moduleDefinition.resources?.locales, {
    zh: './locales/zh.json',
    en: './locales/en.json',
  });
  assert.equal(
    Array.isArray(moduleDefinition.navigation)
      ? moduleDefinition.navigation[0]?.labelKey
      : moduleDefinition.navigation?.labelKey,
    'nav.dashboard'
  );
  assert.deepEqual(
    validateModuleDefinition(moduleDefinition).filter(
      (diagnostic) => diagnostic.code !== 'MODULE_ID_INVALID'
    ),
    []
  );
});
