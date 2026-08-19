import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext, defineModule, Permission } from '@ploykit/module-sdk';
import {
  createInMemoryRuntimeStore,
  createStaticModuleServicesApi,
  guardModuleContextCapabilities,
  normalizeModuleRuntimeContract,
} from '../src/lib/module-runtime';
import { createServiceInvocationRuntime } from '../src/lib/module-capabilities';

test('runtime services.invoke keeps two-argument service calls for simple providers', async () => {
  const serviceModule = defineModule({
    id: 'legacy-service-test',
    name: 'Legacy Service Test',
    version: '0.1.0',
    permissions: [Permission.ServicesInvoke],
    serviceRequirements: {
      ai: {
        provider: 'ai',
      },
    },
  });
  const calls: unknown[] = [];
  const context = {
    ...createTestingModuleContext({ moduleId: serviceModule.id }),
    services: createStaticModuleServicesApi({
      ai(input: unknown) {
        calls.push(input);
        return { ok: true, input };
      },
    }),
  };
  const guarded = guardModuleContextCapabilities({
    context,
    contract: normalizeModuleRuntimeContract(serviceModule),
    session: {
      user: { id: 'user_service', role: 'user' },
      permissions: [Permission.ServicesInvoke],
    },
  });

  const result = await guarded.services.invoke('ai', { prompt: 'hello' });

  assert.deepEqual(calls, [{ prompt: 'hello' }]);
  assert.deepEqual(result, { ok: true, input: { prompt: 'hello' } });
});

test('runtime services.invoke signs, redacts, and records privileged service calls', async () => {
  const serviceModule = defineModule({
    id: 'signed-service-test',
    name: 'Signed Service Test',
    version: '0.1.0',
    permissions: [Permission.ServicesInvoke],
    serviceRequirements: {
      signedAdmin: {
        required: true,
        provider: 'signed-api',
        kind: 'signed-http',
        connection: {
          baseUrl: 'https://signed-api.example',
          egress: ['https://signed-api.example'],
          retry: { attempts: 1 },
        },
        secrets: {
          bearerToken: { required: true },
          hmacSecret: { required: true },
        },
        claims: {
          requestId: '${ctx.request.id}',
          workspaceId: '${ctx.scope.workspaceId}',
          remoteAccountId: '${resource.signedWorkspace.remoteAccountId}',
          workflowId: '${input.workflowId}',
        },
        operations: {
          'admin.request': {
            method: 'POST',
            input: {
              allow: ['path', 'method', 'json'],
              claimsAllow: ['workflowId'],
            },
            auth: {
              type: 'bearer',
              secret: 'bearerToken',
            },
            signing: {
              type: 'hmac-sha256',
              secret: 'hmacSecret',
              header: 'x-module-signature',
              timestampHeader: 'x-module-timestamp',
              claimsHeader: 'x-module-claims',
            },
            request: {
              body: 'json',
              allowHeaders: ['content-type'],
            },
            response: {
              body: 'json',
            },
            audit: {
              event: 'signed.admin.requested',
            },
            redaction: {
              request: ['json.token'],
              response: ['headers.set-cookie', 'json.token'],
              error: ['message'],
            },
          },
        },
      },
    },
    resourceBindings: {
      signedWorkspace: {
        kind: 'signed.workspace',
        required: true,
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(serviceModule);
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId: `${contract.id}:service:signedAdmin`,
    service: 'signedAdmin',
    provider: 'signed-api',
    status: 'active',
    config: {
      baseUrl: 'https://signed-api.example',
    },
    secretRefs: {
      bearerToken: 'secret://bearer',
      hmacSecret: 'secret://hmac',
    },
    health: {
      status: 'ready',
    },
  });
  await store.upsertResourceBinding({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    name: 'signedWorkspace',
    kind: 'signed.workspace',
    value: {
      remoteAccountId: 'acct_123',
    },
  });

  let capturedRequest: { url: string; headers: Headers; body: string | null } | undefined;
  const services = createServiceInvocationRuntime({
    contract,
    store,
    session: {
      user: { id: 'user-a', role: 'user' },
      permissions: [Permission.ServicesInvoke],
      productId: 'product-a',
      workspaceId: 'workspace-a',
      actorId: 'actor-a',
    },
    request: {
      id: 'req-service-1',
      correlationId: 'corr-service-1',
      method: 'POST',
      path: '/api/test',
    },
    privateNetworkResolver: async () => ['203.0.113.10'],
    secretResolver(ref) {
      return ref === 'secret://bearer' ? 'bearer-secret' : 'hmac-secret';
    },
    async fetchImpl(url, init) {
      capturedRequest = {
        url: url.toString(),
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : null,
      };
      return new Response(JSON.stringify({ ok: true, token: 'upstream-token' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=secret',
        },
      });
    },
  });

  const result = (await services.invoke('signedAdmin', 'admin.request', {
    path: '/v1/runs',
    method: 'POST',
    workflowId: 'wf_1',
    json: {
      items: [undefined, 'kept'],
      optional: undefined,
      token: 'input-token',
    },
  })) as { ok: boolean };

  assert.equal(result.ok, true);
  const requestJson = JSON.parse(capturedRequest!.body!);
  assert.deepEqual(requestJson.items, [null, 'kept']);
  assert.equal('optional' in requestJson, false);
  assert.equal('workflowId' in requestJson, false);
  assert.equal(capturedRequest?.url, 'https://signed-api.example/v1/runs');
  assert.equal(capturedRequest?.headers.get('authorization'), 'Bearer bearer-secret');
  assert.ok(capturedRequest?.headers.get('x-module-signature'));
  const claims = JSON.parse(
    Buffer.from(capturedRequest!.headers.get('x-module-claims')!, 'base64url').toString()
  );
  assert.equal(claims.requestId, 'req-service-1');
  assert.equal(claims.remoteAccountId, 'acct_123');
  assert.equal(claims.workflowId, 'wf_1');

  const invocations = await store.listProviderInvocations({ productId: 'product-a' });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]?.kind, 'service');
  assert.equal(invocations[0]?.status, 'succeeded');
  const usage = await store.listUsage({
    productId: 'product-a',
    moduleId: contract.id,
    meter: 'egress.call',
  });
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.quantity, 1);
  assert.equal(usage[0]?.metadata.service, 'signedAdmin');
  assert.equal(usage[0]?.metadata.operation, 'admin.request');
  const serializedMetadata = JSON.stringify(invocations[0]?.metadata);
  assert.ok(!serializedMetadata.includes('input-token'));
  assert.ok(!serializedMetadata.includes('upstream-token'));
  assert.ok(!serializedMetadata.includes('bearer-secret'));
});

test('runtime services.invoke keeps required warning connections callable', async () => {
  const serviceModule = defineModule({
    id: 'service-warning-test',
    name: 'Service Warning Test',
    version: '0.1.0',
    permissions: [Permission.ServicesInvoke],
    serviceRequirements: {
      adminApi: {
        required: true,
        provider: 'admin-api',
        kind: 'signed-http',
        connection: {
          baseUrl: 'https://admin.example',
          egress: ['https://admin.example'],
        },
        operations: {
          call: {
            method: 'GET',
            auth: { type: 'none' },
            signing: { type: 'none' },
            request: { body: 'none' },
            response: { body: 'json' },
          },
        },
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(serviceModule);
  const store = createInMemoryRuntimeStore();
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId: `${contract.id}:service:adminApi`,
    service: 'adminApi',
    provider: 'admin-api',
    status: 'active',
    config: { baseUrl: 'https://admin.example' },
    health: { status: 'warning', lastError: 'HTTP 400' },
  });
  let called = false;
  const services = createServiceInvocationRuntime({
    contract,
    store,
    session: {
      user: null,
      productId: 'product-a',
      workspaceId: 'workspace-a',
      permissions: [Permission.ServicesInvoke],
    },
    request: { id: 'req-warning', correlationId: 'corr-warning', method: 'GET', path: '/test' },
    privateNetworkResolver: async () => ['203.0.113.10'],
    async fetchImpl() {
      called = true;
      return Response.json({ ok: true });
    },
  });

  const result = (await services.invoke('adminApi', 'call', {})) as { ok: boolean };

  assert.equal(called, true);
  assert.equal(result.ok, true);
  assert.equal(
    (await store.getServiceConnection('product-a', `${contract.id}:service:adminApi`))?.health
      .status,
    'ready'
  );
});

test('runtime services.invoke does not dispatch blocked or disabled signed-service connections', async () => {
  const serviceModule = defineModule({
    id: 'service-blocked-disabled-test',
    name: 'Service Blocked Disabled Test',
    version: '0.1.0',
    permissions: [Permission.ServicesInvoke],
    serviceRequirements: {
      adminApi: {
        required: true,
        provider: 'admin-api',
        kind: 'signed-http',
        connection: {
          baseUrl: 'https://admin.example',
          egress: ['https://admin.example'],
        },
        operations: {
          call: {
            method: 'GET',
            auth: { type: 'none' },
            signing: { type: 'none' },
            request: { body: 'none' },
            response: { body: 'json' },
          },
        },
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(serviceModule);
  const store = createInMemoryRuntimeStore();
  const connectionId = `${contract.id}:service:adminApi`;
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId,
    service: 'adminApi',
    provider: 'admin-api',
    status: 'active',
    config: { baseUrl: 'https://admin.example' },
    health: { status: 'blocked', lastError: 'missing required HMAC secret' },
  });
  let dispatches = 0;
  const services = createServiceInvocationRuntime({
    contract,
    store,
    session: {
      user: null,
      productId: 'product-a',
      workspaceId: 'workspace-a',
      permissions: [Permission.ServicesInvoke],
    },
    request: {
      id: 'req-blocked-disabled',
      correlationId: 'corr-blocked-disabled',
      method: 'GET',
      path: '/test',
    },
    privateNetworkResolver: async () => ['203.0.113.10'],
    async fetchImpl() {
      dispatches += 1;
      return Response.json({ ok: true });
    },
  });

  await assert.rejects(
    () => services.invoke('adminApi', 'call', {}),
    /MODULE_SERVICE_CONNECTION_NOT_READY/
  );
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId,
    service: 'adminApi',
    provider: 'admin-api',
    status: 'blocked',
    config: { baseUrl: 'https://admin.example' },
    health: { status: 'ready' },
  });
  await assert.rejects(
    () => services.invoke('adminApi', 'call', {}),
    /MODULE_SERVICE_CONNECTION_BLOCKED/
  );
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId,
    service: 'adminApi',
    provider: 'admin-api',
    status: 'disabled',
    config: { baseUrl: 'https://admin.example' },
    health: { status: 'ready' },
  });
  await assert.rejects(
    () => services.invoke('adminApi', 'call', {}),
    /MODULE_SERVICE_CONNECTION_DISABLED/
  );
  assert.equal(dispatches, 0);
});

test('runtime services.invoke enforces operation policy before dispatch', async () => {
  const serviceModule = defineModule({
    id: 'service-policy-test',
    name: 'Service Policy Test',
    version: '0.1.0',
    permissions: [Permission.ServicesInvoke],
    serviceRequirements: {
      adminApi: {
        required: true,
        provider: 'admin-api',
        kind: 'signed-http',
        connection: {
          baseUrl: 'https://admin.example',
          egress: ['https://admin.example'],
        },
        operations: {
          call: {
            method: 'POST',
            input: {
              allow: ['method', 'json', 'body', 'headers'],
            },
            auth: { type: 'none' },
            signing: { type: 'none' },
            request: {
              body: 'json',
              allowHeaders: ['content-type', 'x-denied'],
              denyHeaders: ['x-denied'],
            },
            response: { body: 'json' },
          },
        },
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(serviceModule);
  const store = createInMemoryRuntimeStore();
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId: `${contract.id}:service:adminApi`,
    service: 'adminApi',
    provider: 'admin-api',
    status: 'active',
    config: { baseUrl: 'https://admin.example' },
    health: { status: 'ready' },
  });
  const services = createServiceInvocationRuntime({
    contract,
    store,
    session: {
      user: null,
      productId: 'product-a',
      workspaceId: 'workspace-a',
      permissions: [Permission.ServicesInvoke],
    },
    request: { id: 'req-policy', correlationId: 'corr-policy', method: 'POST', path: '/test' },
    privateNetworkResolver: async () => ['203.0.113.10'],
    async fetchImpl() {
      throw new Error('fetch should not run');
    },
  });

  await assert.rejects(
    () => services.invoke('adminApi', 'call', { method: 'DELETE', json: {} }),
    /MODULE_SERVICE_METHOD_DENIED/
  );
  assert.equal(
    (await store.getServiceConnection('product-a', `${contract.id}:service:adminApi`))?.health
      .status,
    'ready'
  );
  await assert.rejects(
    () => services.invoke('adminApi', 'call', { body: 'not-json' }),
    /MODULE_SERVICE_REQUEST_BODY_DENIED/
  );
  assert.equal(
    (await store.getServiceConnection('product-a', `${contract.id}:service:adminApi`))?.health
      .status,
    'ready'
  );
  await assert.rejects(
    () => services.invoke('adminApi', 'call', { json: {}, headers: { 'x-denied': '1' } }),
    /MODULE_SERVICE_HEADER_DENIED/
  );
  assert.equal(
    (await store.getServiceConnection('product-a', `${contract.id}:service:adminApi`))?.health
      .status,
    'ready'
  );
});

test('runtime services.invoke isolates workspace-scoped connections', async () => {
  const serviceModule = defineModule({
    id: 'service-workspace-test',
    name: 'Service Workspace Test',
    version: '0.1.0',
    permissions: [Permission.ServicesInvoke],
    serviceRequirements: {
      adminApi: {
        required: true,
        provider: 'admin-api',
        kind: 'signed-http',
        connection: {
          baseUrl: 'https://admin.example',
          egress: ['https://admin.example'],
        },
        operations: {
          call: {
            method: 'GET',
            auth: { type: 'none' },
            signing: { type: 'none' },
            request: { body: 'none' },
            response: { body: 'json' },
          },
        },
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(serviceModule);
  const store = createInMemoryRuntimeStore();
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId: `${contract.id}:service:adminApi`,
    service: 'adminApi',
    provider: 'admin-api',
    status: 'active',
    config: { baseUrl: 'https://admin.example' },
    health: { status: 'ready' },
  });
  const services = createServiceInvocationRuntime({
    contract,
    store,
    session: {
      user: null,
      productId: 'product-a',
      workspaceId: 'workspace-b',
      permissions: [Permission.ServicesInvoke],
    },
    request: { id: 'req-workspace', correlationId: 'corr-workspace', method: 'GET', path: '/test' },
    async fetchImpl() {
      throw new Error('fetch should not run');
    },
  });

  await assert.rejects(
    () => services.invoke('adminApi', 'call', {}),
    /MODULE_SERVICE_CONNECTION_MISSING/
  );
});

test('runtime services.invoke denies DNS-resolved private egress and oversized responses', async () => {
  const serviceModule = defineModule({
    id: 'service-egress-test',
    name: 'Service Egress Test',
    version: '0.1.0',
    permissions: [Permission.ServicesInvoke],
    serviceRequirements: {
      adminApi: {
        required: true,
        provider: 'admin-api',
        kind: 'signed-http',
        connection: {
          baseUrl: 'https://admin.example',
          egress: ['https://admin.example'],
          maxResponseBytes: 8,
        },
        operations: {
          call: {
            method: 'GET',
            auth: { type: 'none' },
            signing: { type: 'none' },
            request: { body: 'none' },
            response: { body: 'text' },
          },
        },
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(serviceModule);
  const store = createInMemoryRuntimeStore();
  await store.upsertServiceConnection({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    connectionId: `${contract.id}:service:adminApi`,
    service: 'adminApi',
    provider: 'admin-api',
    status: 'active',
    config: { baseUrl: 'https://admin.example' },
    health: { status: 'ready' },
  });

  const privateServices = createServiceInvocationRuntime({
    contract,
    store,
    session: {
      user: null,
      productId: 'product-a',
      workspaceId: 'workspace-a',
      permissions: [Permission.ServicesInvoke],
    },
    request: { id: 'req-egress', correlationId: 'corr-egress', method: 'GET', path: '/test' },
    privateNetworkResolver: async () => ['10.0.0.5'],
    async fetchImpl() {
      throw new Error('fetch should not run');
    },
  });
  await assert.rejects(
    () => privateServices.invoke('adminApi', 'call', {}),
    /MODULE_SERVICE_PRIVATE_NETWORK_DENIED/
  );
  await store.touchServiceConnection('product-a', `${contract.id}:service:adminApi`, {
    health: { status: 'ready' },
  });

  const oversizedServices = createServiceInvocationRuntime({
    contract,
    store,
    session: {
      user: null,
      productId: 'product-a',
      workspaceId: 'workspace-a',
      permissions: [Permission.ServicesInvoke],
    },
    request: { id: 'req-size', correlationId: 'corr-size', method: 'GET', path: '/test' },
    privateNetworkResolver: async () => ['203.0.113.10'],
    async fetchImpl() {
      return new Response('this response is too large', { status: 200 });
    },
  });
  await assert.rejects(
    () => oversizedServices.invoke('adminApi', 'call', {}),
    /MODULE_SERVICE_RESPONSE_TOO_LARGE/
  );
});
