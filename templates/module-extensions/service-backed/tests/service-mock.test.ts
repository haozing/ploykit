import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk/testing';
import callService from '../actions/call-service';

test('__MODULE_ID__ service-backed extension can run against a fixture service handler', async () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'status.ok.json'), 'utf8')
  );
  const ctx = createTestingModuleContext({
    moduleId: '__MODULE_ID__',
    request: {
      id: 'test-request',
      correlationId: 'test-correlation',
    },
    serviceHandlers: {
      'serviceCore.request': async ({ request }) => ({
        ...fixture,
        request,
      }),
    },
  });

  const result = (await callService.run(ctx, {})) as unknown as {
    ok: boolean;
    request: { path: string; method: string };
  };

  assert.equal(result.ok, true);
  assert.equal(result.request.path, '/v1/status');
  assert.equal(result.request.method, 'GET');
});
