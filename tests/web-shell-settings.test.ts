import assert from 'node:assert/strict';
import test from 'node:test';
import { baseHostSettings, mergeHostSettings } from '../apps/host-next/lib/host-settings';

test('A10 host settings source metadata keeps env configured fields locked', () => {
  const base = baseHostSettings({
    PLOYKIT_SITE_NAME: 'Env Site',
    PLOYKIT_EMAIL_FROM: 'Env Sender <env@example.com>',
  } as unknown as NodeJS.ProcessEnv);
  const merged = mergeHostSettings(base, {
    siteName: 'Store Site',
    fromEmail: 'store@example.com',
    timezone: 'UTC',
  });
  const siteNameField = merged.fields.find((field) => field.key === 'siteName');
  const timezoneField = merged.fields.find((field) => field.key === 'timezone');

  assert.equal(merged.siteName, 'Env Site');
  assert.equal(merged.fromEmail, 'env@example.com');
  assert.equal(merged.timezone, 'UTC');
  assert.equal(merged.fieldSources.siteName, 'env');
  assert.equal(merged.fieldSources.fromEmail, 'env');
  assert.equal(merged.fieldSources.timezone, 'store');
  assert.equal(siteNameField?.editable, false);
  assert.equal(timezoneField?.editable, true);
});
