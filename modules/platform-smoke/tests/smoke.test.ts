import assert from 'node:assert/strict';
import test from 'node:test';
import mod from '../module';

test('platform-smoke contract uses only current surfaces', () => {
  assert.equal(mod.id, 'platform-smoke');
  assert.equal('contractVersion' in mod, false);
  assert.equal('routes' in mod, false);
  assert.equal(mod.pages?.length, 1);
  assert.equal(mod.apis?.length, 1);
  assert.ok(mod.actions?.ping);
  assert.ok(mod.jobs?.generate_report);
  assert.ok(mod.webhooks?.workflow);
});
