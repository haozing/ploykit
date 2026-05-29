import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleModuleActionPost,
  type ModuleActionExecuteInput,
  type ModuleActionRouteDependencies,
} from '../apps/host-next/lib/module-action-route';

function actionContext(moduleId = 'fixture-module', name = 'saveSettings') {
  return {
    params: Promise.resolve({ moduleId, name }),
  };
}

function dependencies(
  onExecute: (input: ModuleActionExecuteInput) => Promise<unknown> | unknown
): ModuleActionRouteDependencies {
  return {
    async getModuleHost() {
      return {
        async executeAction(input) {
          return onExecute(input);
        },
      };
    },
    async checkHostRouteSecurity() {
      return null;
    },
  };
}

test('module action route parses form submissions and redirects after success', async () => {
  const actionInputs: ModuleActionExecuteInput[] = [];
  const formData = new URLSearchParams({
    name: 'Production',
    count: '42',
    tags: 'blue, green',
    enabled: 'on',
    metadata: '{"tier":"pro"}',
    _numberFields: 'count',
    _arrayFields: 'tags',
    _booleanFields: 'enabled,archived',
    _jsonFields: 'metadata',
    _confirmed: 'on',
    _idempotencyKey: 'form-key-1',
    _next: '/dashboard/fixture-module?workspace=workspace_1',
  });
  const response = await handleModuleActionPost(
    new Request('http://localhost/api/module-actions/fixture-module/saveSettings', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'http://localhost/dashboard/fixture-module',
      },
      body: formData,
    }),
    actionContext(),
    dependencies((input) => {
      actionInputs.push(input);
      return { saved: true };
    })
  );

  const location = response.headers.get('location');
  const actionInput = actionInputs[0];
  assert.equal(response.status, 303);
  assert.equal(location, 'http://localhost/dashboard/fixture-module?workspace=workspace_1&moduleAction=ok');
  assert.equal(actionInputs.length, 1);
  assert.equal(actionInput.moduleId, 'fixture-module');
  assert.equal(actionInput.name, 'saveSettings');
  assert.equal(actionInput.confirmed, true);
  assert.equal(actionInput.idempotencyKey, 'form-key-1');
  assert.deepEqual(actionInput.input, {
    name: 'Production',
    count: 42,
    tags: ['blue', 'green'],
    enabled: true,
    archived: false,
    metadata: { tier: 'pro' },
  });
});

test('module action route returns a structured error for invalid JSON request bodies', async () => {
  let actionCalled = false;
  const response = await handleModuleActionPost(
    new Request('http://localhost/api/module-actions/fixture-module/saveSettings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"broken"',
    }),
    actionContext(),
    dependencies(() => {
      actionCalled = true;
      return { saved: true };
    })
  );
  const body = (await response.json()) as { ok: boolean; code: string; message: string };

  assert.equal(actionCalled, false);
  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    ok: false,
    code: 'MODULE_ACTION_PAYLOAD_INVALID',
    message: 'MODULE_ACTION_PAYLOAD_INVALID: Invalid JSON request body.',
  });
});

test('module action route redirects form payload parse errors through the form completion path', async () => {
  let actionCalled = false;
  const formData = new URLSearchParams({
    metadata: '{"broken"',
    _jsonFields: 'metadata',
    _next: '/dashboard/fixture-module',
  });
  const response = await handleModuleActionPost(
    new Request('http://localhost/api/module-actions/fixture-module/saveSettings', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'http://localhost/dashboard/fallback',
      },
      body: formData,
    }),
    actionContext(),
    dependencies(() => {
      actionCalled = true;
      return { saved: true };
    })
  );

  assert.equal(actionCalled, false);
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    'http://localhost/dashboard/fallback?moduleAction=error&moduleActionCode=MODULE_ACTION_PAYLOAD_INVALID'
  );
});
