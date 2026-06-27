import assert from 'node:assert/strict';
import test from 'node:test';
import mod from '../module';

test('public-tool-smoke contract declares public page and anonymous API', () => {
  assert.equal(mod.id, 'public-tool-smoke');
  assert.equal('contractVersion' in mod, false);
  assert.equal('routes' in mod, false);
  assert.equal(mod.pages?.[0]?.area, 'site');
  assert.equal(mod.pages?.[0]?.auth, 'public');
  assert.ok(mod.pages?.[0]?.publicAliases?.includes('/tools/json'));
  assert.equal(mod.apis?.[0]?.auth, 'public');
  assert.ok(mod.apis?.[0]?.anonymousPolicy);
});
