import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleModuleActionPost,
  type ModuleActionExecuteInput,
  type ModuleActionRouteDependencies,
} from '../apps/host-next/lib/module-action-route';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';

function actionContext(moduleId = 'fixture-module', name = 'saveSettings') {
  return {
    params: Promise.resolve({ moduleId, name }),
  };
}

function dependencies(
  onExecute: (input: ModuleActionExecuteInput) => Promise<unknown> | unknown,
  overrides: Partial<ModuleActionRouteDependencies> = {}
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
    ...overrides,
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

test('module action route replays completed idempotent responses and rejects payload conflicts', async () => {
  let id = 0;
  let calls = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (prefix) => `${prefix}_${++id}`,
  });
  const deps = dependencies(
    () => {
      calls += 1;
      return { charged: calls };
    },
    {
      async getRuntimeStore() {
        return store;
      },
      idempotencyScope: { productId: 'product-a', environmentId: 'dev', workspaceId: 'workspace-a' },
    }
  );

  const request = (amount: number) =>
    new Request('http://localhost/api/module-actions/fixture-module/charge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'charge-key-1',
      },
      body: JSON.stringify({ amount }),
    });

  const first = await handleModuleActionPost(request(10), actionContext('fixture-module', 'charge'), deps);
  const replay = await handleModuleActionPost(request(10), actionContext('fixture-module', 'charge'), deps);
  const conflict = await handleModuleActionPost(
    request(20),
    actionContext('fixture-module', 'charge'),
    deps
  );

  assert.equal(calls, 1);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, result: { charged: 1 } });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('x-ploykit-idempotency-replay'), 'true');
  assert.deepEqual(await replay.json(), { ok: true, result: { charged: 1 } });
  assert.equal(conflict.status, 400);
  assert.equal(((await conflict.json()) as { code: string }).code, 'MODULE_ACTION_IDEMPOTENCY_CONFLICT');
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

test('module action route returns module business error envelopes without details', async () => {
  const response = await handleModuleActionPost(
    new Request('http://localhost/api/module-actions/public-tool-smoke/formatSample', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sku: '' }),
    }),
    actionContext('public-tool-smoke', 'formatSample'),
    dependencies(() => ({
      ok: false,
      code: 'PUBLIC_TOOL_INPUT_REQUIRED',
      message: 'Input is required.',
      details: { rawInput: { source: '' }, secret: 'do-not-return' },
    }))
  );
  const body = (await response.json()) as {
    ok: boolean;
    code: string;
    message: string;
    details?: unknown;
  };

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    ok: false,
    code: 'PUBLIC_TOOL_INPUT_REQUIRED',
    message: 'Input is required.',
  });
  assert.equal(body.details, undefined);
});

test('module action route redacts non-allowlisted thrown module errors', async () => {
  const response = await handleModuleActionPost(
    new Request('http://localhost/api/module-actions/public-tool-smoke/formatSample', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sku: '' }),
    }),
    actionContext('public-tool-smoke', 'formatSample'),
    dependencies(() => {
      throw new Error('PUBLIC_TOOL_INPUT_REQUIRED: raw input source=""');
    })
  );
  const body = (await response.json()) as { ok: boolean; code: string; message: string };

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    ok: false,
    code: 'MODULE_ACTION_ROUTE_ERROR',
    message: 'Module action failed.',
  });
});
