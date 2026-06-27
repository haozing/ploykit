import assert from 'node:assert/strict';
import test from 'node:test';
import mod from '../module';

test('resource-smoke contract uses Data v2 and business resources only', () => {
  assert.equal(mod.id, 'resource-smoke');
  assert.equal('contractVersion' in mod, false);
  assert.equal('routes' in mod, false);
  assert.ok(mod.resources?.notes);
  assert.ok(mod.data?.documents?.user_notes);
  assert.ok(mod.data?.tables?.workspace_notes);
  assert.equal(mod.pages?.length, 4);
  assert.equal(mod.apis?.length, 1);
});
