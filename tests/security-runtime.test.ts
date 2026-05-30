import assert from 'node:assert/strict';
import test from 'node:test';
import {
  action,
  createTestingModuleContext,
  defineApi,
  defineModule,
  Permission,
  type CommercialSubject,
  type ModuleContext,
  type ModuleDataApi,
  type ModuleDataDocument,
  } from '@ploykit/module-sdk';
import {
  createModuleHost,
  createRuntimeStoreModuleResourceBindingsApi,
  createStaticModuleConfigApi,
  createStaticModuleSecretsApi,
  createStaticModuleServicesApi,
  createInMemoryRuntimeStore,
  guardModuleContextCapabilities,
  normalizeModuleRuntimeContract,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';
import {
  createServiceInvocationRuntime,
} from '../src/lib/module-capabilities';

let secureApiLoadCount = 0;
let missingPermissionApiLoadCount = 0;
let paidActionLoadCount = 0;

const securityModule = defineModule({
  id: 'security-test',
  name: 'Security Test Module',
  version: '0.1.0',
  permissions: [
    Permission.DataDocumentRead,
    Permission.DataTableRead,
    Permission.SurfaceContribute,
    Permission.ConfigRead,
    Permission.SecretsRead,
    Permission.AuditWrite,
    Permission.CreditsConsume,
  ],
  config: {
    feature: {
      type: 'string',
    },
    token: {
      type: 'string',
      secret: true,
    },
  },
  routes: {
    dashboard: [
      {
        path: '/paid',
        component: './pages/PaidPage',
        auth: 'auth',
        commercial: {
          entitlements: ['pro'],
        },
      },
    ],
    api: [
      {
        path: '/secure',
        handler: './api/secure',
        auth: 'auth',
        permissions: [Permission.DataDocumentRead],
      },
      {
        path: '/missing-permission',
        handler: './api/missing-permission',
        auth: 'auth',
        permissions: [Permission.DataTableRead],
      },
      {
        path: '/capabilities',
        handler: './api/capabilities',
        auth: 'auth',
      },
    ],
  },
  actions: {
    paidAction: {
      handler: './actions/paid-action',
      auth: 'auth',
      commercial: {
        entitlements: ['pro'],
      },
    },
  },
  navigation: [
    {
      location: 'dashboard.sidebar',
      fallbackLabel: 'Paid',
      path: '/paid',
      requires: {
        entitlements: ['pro'],
        serviceConnections: ['github'],
        scopeRoles: ['owner'],
      },
    },
  ],
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/SecureWidget',
      permissions: [Permission.SurfaceContribute],
      visibility: {
        mode: 'permission',
        permission: Permission.DataDocumentRead,
      },
    },
  },
});

const artifact: ModuleMapArtifact = {
  kind: 'source',
  modules: {
    'security-test': {
      module: async () => ({ default: securityModule }),
      apis: {
        'api/secure': async () => {
          secureApiLoadCount += 1;
          return {
            default: defineApi({
              get(ctx) {
                return ctx.json({
                  ok: true,
                  productId: ctx.scope.productId,
                  workspaceId: ctx.scope.workspaceId,
                });
              },
            }),
          };
        },
        'api/missing-permission': async () => {
          missingPermissionApiLoadCount += 1;
          return {
            default: defineApi({
              get(ctx) {
                return ctx.json({ ok: true });
              },
            }),
          };
        },
        'api/capabilities': async () => ({
          default: defineApi({
            async get(ctx) {
              const feature = await ctx.config.require<string>('feature');
              const token = await ctx.secrets.require('token');
              await ctx.audit.record('capabilities.read', { feature });
              return ctx.json({
                ok: true,
                feature,
                tokenLength: token.length,
              });
            },
          }),
        }),
      },
      actions: {
        'actions/paid-action': async () => {
          paidActionLoadCount += 1;
          return {
            default: action<ModuleContext, undefined, { ok: true }>(async () => ({ ok: true })),
          };
        },
      },
      pages: {
        'pages/PaidPage': async () => ({
          default: function PaidPage() {
            return { view: 'paid' };
          },
        }),
      },
      surfaces: {
        'surfaces/SecureWidget': async () => ({ default: function SecureWidget() {} }),
      },
    },
  },
};

test('P4 permission guard denies API routes before loading handlers', async () => {
  secureApiLoadCount = 0;
  const host = await createModuleHost({ artifact });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/secure', { method: 'GET' }),
    pathname: '/secure',
    session: {
      user: { id: 'user_1', role: 'user' },
      permissions: [],
    },
  });
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 403);
  assert.equal(body.code, 'MODULE_API_PERMISSION_DENIED');
  assert.equal(secureApiLoadCount, 0);
});

test('P4 permission guard allows API routes with permission and injects scope', async () => {
  secureApiLoadCount = 0;
  const host = await createModuleHost({ artifact });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/secure', { method: 'GET' }),
    pathname: '/secure',
    session: {
      user: { id: 'user_2', role: 'user' },
      productId: 'product_1',
      workspaceId: 'workspace_1',
      permissions: [Permission.DataDocumentRead],
    },
  });
  const body = (await response.json()) as {
    ok: boolean;
    productId: string | null;
    workspaceId: string | null;
  };

  assert.equal(response.status, 200);
  assert.equal(secureApiLoadCount, 1);
  assert.deepEqual(body, {
    ok: true,
    productId: 'product_1',
    workspaceId: 'workspace_1',
  });
});

test('P4 contract validation rejects entry permissions missing from module contract', async () => {
  missingPermissionApiLoadCount = 0;
  const invalidModule = defineModule({
    id: 'entry-permission-test',
    name: 'Entry Permission Test',
    version: '0.1.0',
    routes: {
      api: [
        {
          path: '/entry-permission',
          handler: './api/entry-permission',
          auth: 'auth',
          permissions: [Permission.DataTableRead],
        },
      ],
    },
  });

  await assert.rejects(
    () =>
      createModuleHost({
        artifact: {
          kind: 'source',
          modules: {
            'entry-permission-test': {
              module: async () => ({ default: invalidModule }),
              apis: {
                'api/entry-permission': async () => {
                  missingPermissionApiLoadCount += 1;
                  return { default: defineApi({ get: (ctx) => ctx.json({ ok: true }) }) };
                },
              },
            },
          },
        },
      }),
    /MODULE_ENTRY_PERMISSION_NOT_DECLARED/
  );
  assert.equal(missingPermissionApiLoadCount, 0);
});

test('P4 commercial guard applies to pages and actions', async () => {
  paidActionLoadCount = 0;
  const host = await createModuleHost({ artifact });

  const deniedPage = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/paid', { method: 'GET' }),
    pathname: '/paid',
    session: {
      user: { id: 'user_4', role: 'user' },
    },
  });

  assert.deepEqual(deniedPage, {
    ok: false,
    status: 403,
    code: 'MODULE_PAGE_ENTITLEMENT_REQUIRED',
    message: 'Required entitlement is missing.',
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'security-test',
        name: 'paidAction',
        session: {
          user: { id: 'user_4', role: 'user' },
        },
      }),
    /MODULE_ACTION_ENTITLEMENT_REQUIRED/
  );
  assert.equal(paidActionLoadCount, 0);

  const allowedPage = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/paid', { method: 'GET' }),
    pathname: '/paid',
    session: {
      user: { id: 'user_5', role: 'user' },
      entitlements: ['pro'],
    },
  });

  assert.equal(allowedPage.ok, true);
});

test('P4 surface and navigation guards filter unavailable contributions', async () => {
  const host = await createModuleHost({ artifact });

  assert.equal(host.resolveSurfaceContributions('dashboard.home:widgets').length, 0);
  assert.equal(host.resolveNavigation('dashboard.sidebar').length, 0);

  assert.equal(
    host.resolveSurfaceContributions('dashboard.home:widgets', {
      session: {
        user: { id: 'user_6', role: 'user' },
        permissions: [Permission.DataDocumentRead],
      },
    }).length,
    1
  );

  assert.equal(
    host.resolveNavigation('dashboard.sidebar', {
      session: {
        user: { id: 'user_7', role: 'user' },
        entitlements: ['pro'],
        serviceConnections: ['github'],
        workspaceRole: 'owner',
      },
    }).length,
    1
  );
});

test('P4 host capabilities are injected into module context', async () => {
  const auditEvents: Record<string, unknown>[] = [];
  const host = await createModuleHost({
    artifact,
    capabilities: {
      config: createStaticModuleConfigApi({ feature: 'enabled' }),
      secrets: createStaticModuleSecretsApi({ token: 'secret-token' }),
      audit: {
        async record(type, metadata) {
          auditEvents.push({ type, metadata });
        },
      },
    },
  });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/capabilities', { method: 'GET' }),
    pathname: '/capabilities',
    session: {
      user: { id: 'user_8', role: 'user' },
      permissions: [Permission.ConfigRead, Permission.SecretsRead, Permission.AuditWrite],
    },
  });
  const body = (await response.json()) as {
    ok: boolean;
    feature: string;
    tokenLength: number;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    feature: 'enabled',
    tokenLength: 12,
  });
  assert.deepEqual(auditEvents, [
    {
      type: 'capabilities.read',
      metadata: { feature: 'enabled' },
    },
  ]);
});

test('runtime capability guard restricts connectors to declared services', async () => {
  const connectorModule = defineModule({
    id: 'connector-guard-test',
    name: 'Connector Guard Test',
    version: '0.1.0',
    permissions: [Permission.ConnectorsRead, Permission.ConnectorsInvoke],
    serviceRequirements: {
      github: {
        provider: 'http',
      },
    },
  });
  const context = createTestingModuleContext({ moduleId: connectorModule.id });
  const guarded = guardModuleContextCapabilities({
    context,
    contract: normalizeModuleRuntimeContract(connectorModule),
    session: {
      user: { id: 'user_connector', role: 'user' },
      permissions: [Permission.ConnectorsRead, Permission.ConnectorsInvoke],
    },
  });

  await assert.rejects(
    () => guarded.connectors.get('stripe'),
    /MODULE_CAPABILITY_SERVICE_NOT_DECLARED/
  );
  await assert.rejects(
    () => guarded.connectors.invoke('stripe', 'fetch', {}),
    /MODULE_CAPABILITY_SERVICE_NOT_DECLARED/
  );
  assert.equal(await guarded.connectors.get('github'), null);
});

test('runtime capability guard scopes resource binding writes to declared workspace bindings', async () => {
  const bindingModule = defineModule({
    id: 'resource-binding-write-test',
    name: 'Resource Binding Write Test',
    version: '0.1.0',
    permissions: [Permission.ResourceBindingsRead, Permission.ResourceBindingsWrite],
    resourceBindings: {
      workspaceConfig: {
        kind: 'demo.workspace',
        required: false,
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(bindingModule);
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-29T00:00:00.000Z'),
  });
  const resourceBindings = createRuntimeStoreModuleResourceBindingsApi({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
    actorId: 'actor-a',
  });
  const context = {
    ...createTestingModuleContext({ moduleId: contract.id }),
    resourceBindings,
  };

  const ownerGuarded = guardModuleContextCapabilities({
    context,
    contract,
    session: {
      user: { id: 'user_binding_owner', role: 'user' },
      permissions: [Permission.ResourceBindingsRead],
      productId: 'product-a',
      workspaceId: 'workspace-a',
      workspaceRole: 'owner',
      actorId: 'actor-a',
    },
  });
  const ownerUpsert = ownerGuarded.resourceBindings.upsert;
  assert.ok(ownerUpsert);

  const value = await ownerUpsert(
    'workspaceConfig',
    { remoteAccountId: 'acct_123' },
    { kind: 'demo.workspace', metadata: { source: 'test' } }
  );

  assert.deepEqual(value, { remoteAccountId: 'acct_123' });
  assert.deepEqual(await ownerGuarded.resourceBindings.get('workspaceConfig'), {
    remoteAccountId: 'acct_123',
  });

  const records = await store.listResourceBindings({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: contract.id,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.name, 'workspaceConfig');
  assert.equal(records[0]?.updatedBy, 'actor-a');
  assert.deepEqual(records[0]?.value, { remoteAccountId: 'acct_123' });

  const audit = await store.listAudit({ productId: 'product-a', type: 'host.resource_binding.upserted' });
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.workspaceId, 'workspace-a');
  assert.equal(audit[0]?.moduleId, contract.id);
  assert.equal(audit[0]?.metadata.name, 'workspaceConfig');

  await assert.rejects(
    () => ownerUpsert('otherConfig', { remoteAccountId: 'acct_456' }),
    /MODULE_CAPABILITY_RESOURCE_BINDING_NOT_DECLARED/
  );
  await assert.rejects(
    () => ownerUpsert('workspaceConfig', { token: 'plain-secret' }),
    /MODULE_RESOURCE_BINDING_SECRET_VALUE_DENIED/
  );

  const viewerGuarded = guardModuleContextCapabilities({
    context,
    contract,
    session: {
      user: { id: 'user_binding_viewer', role: 'user' },
      permissions: [Permission.ResourceBindingsRead],
      productId: 'product-a',
      workspaceId: 'workspace-a',
      workspaceRole: 'viewer',
      actorId: 'actor-b',
    },
  });
  const viewerUpsert = viewerGuarded.resourceBindings.upsert;
  assert.ok(viewerUpsert);

  await assert.rejects(
    () => viewerUpsert('workspaceConfig', { remoteAccountId: 'acct_789' }),
    /MODULE_CAPABILITY_PERMISSION_DENIED/
  );
});

test('runtime services.invoke keeps legacy two-argument service calls for v1 contracts', async () => {
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
    contractVersion: 2,
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
  const serializedMetadata = JSON.stringify(invocations[0]?.metadata);
  assert.ok(!serializedMetadata.includes('input-token'));
  assert.ok(!serializedMetadata.includes('upstream-token'));
  assert.ok(!serializedMetadata.includes('bearer-secret'));
});

test('runtime services.invoke enforces operation policy before dispatch', async () => {
  const serviceModule = defineModule({
    contractVersion: 2,
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
    contractVersion: 2,
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
    contractVersion: 2,
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

test('runtime capability guard denies declared capability when session permissions are absent', async () => {
  const guardModule = defineModule({
    id: 'session-permission-test',
    name: 'Session Permission Test',
    version: '0.1.0',
    permissions: [Permission.AuditWrite],
    actions: {
      recordAudit: {
        handler: './actions/record-audit',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'session-permission-test': {
          module: async () => ({ default: guardModule }),
          actions: {
            'actions/record-audit': async () => ({
              default: action(async (ctx: ModuleContext) => {
                await ctx.audit.record('session.permission.test', {});
              }),
            }),
          },
        },
      },
    },
    capabilities: {
      audit: {
        async record() {
          throw new Error('AUDIT_SHOULD_NOT_RECORD');
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'session-permission-test',
        name: 'recordAudit',
        session: {
          user: { id: 'user_8b', role: 'user' },
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_DENIED/
  );
});

test('runtime capability guard fails closed when audit provider is not mounted', async () => {
  const auditModule = defineModule({
    id: 'audit-unmounted-test',
    name: 'Audit Unmounted Test',
    version: '0.1.0',
    permissions: [Permission.AuditWrite],
    actions: {
      recordAudit: {
        handler: './actions/record-audit',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'audit-unmounted-test': {
          module: async () => ({ default: auditModule }),
          actions: {
            'actions/record-audit': async () => ({
              default: action(async (ctx: ModuleContext) => {
                await ctx.audit.record('audit.unmounted.test', {});
                return { ok: true };
              }),
            }),
          },
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'audit-unmounted-test',
        name: 'recordAudit',
        session: {
          user: { id: 'user_8c', role: 'user' },
          permissions: [Permission.AuditWrite],
        },
      }),
    /MODULE_CAPABILITY_UNAVAILABLE: ctx\.audit\.record is not mounted/
  );
});

test('runtime capability guard protects notification reads separately from sends', async () => {
  const notificationModule = defineModule({
    id: 'notification-read-test',
    name: 'Notification Read Test',
    version: '0.1.0',
    permissions: [Permission.NotificationsSend],
    actions: {
      listNotifications: {
        handler: './actions/list-notifications',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'notification-read-test': {
          module: async () => ({ default: notificationModule }),
          actions: {
            'actions/list-notifications': async () => ({
              default: action(async (ctx: ModuleContext) => ctx.notifications.list()),
            }),
          },
        },
      },
    },
    capabilities: {
      notifications: {
        async send(input) {
          return {
            id: 'notification-1',
            moduleId: 'notification-read-test',
            userId: input.userId,
            channel: input.channel ?? 'inApp',
            title: input.title,
            status: 'unread',
            metadata: {},
            createdAt: '2026-01-01T00:00:00.000Z',
          };
        },
        async list() {
          throw new Error('NOTIFICATIONS_SHOULD_NOT_LIST');
        },
        async markRead() {
          throw new Error('NOTIFICATIONS_SHOULD_NOT_MARK_READ');
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'notification-read-test',
        name: 'listNotifications',
        session: {
          user: { id: 'user_8c', role: 'user' },
          permissions: [Permission.NotificationsRead],
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_NOT_DECLARED/
  );
});

test('runtime capability guard blocks undeclared permissions and cross-user credit consumption', async () => {
  const guardedModule = defineModule({
    id: 'capability-guard-test',
    name: 'Capability Guard Test',
    version: '0.1.0',
    permissions: [Permission.CreditsConsume],
    actions: {
      writeArtifact: {
        handler: './actions/write-artifact',
        auth: 'auth',
      },
      consumeOtherCredits: {
        handler: './actions/consume-other-credits',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'capability-guard-test': {
          module: async () => ({ default: guardedModule }),
          actions: {
            'actions/write-artifact': async () => ({
              default: action(async (ctx: ModuleContext) => {
                await ctx.artifacts.write({
                  name: 'blocked',
                  kind: 'json',
                  path: 'blocked.json',
                  content: {},
                });
              }),
            }),
            'actions/consume-other-credits': async () => ({
              default: action(async (ctx: ModuleContext) => {
                return ctx.credits.consume({
                  userId: 'other-user',
                  amount: 1,
                });
              }),
            }),
          },
        },
      },
    },
    capabilities: {
      artifacts: {
        async write() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
        async writeText() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
        async read() {
          return null;
        },
        async readText() {
          return null;
        },
        async updateMetadata() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
        async list() {
          return [];
        },
        async tree() {
          return [];
        },
        async delete() {
          throw new Error('ARTIFACT_SHOULD_NOT_WRITE');
        },
      },
      credits: {
        async balance(input: string | { subject: CommercialSubject; unit?: string }) {
          const subject = typeof input === 'string' ? { type: 'user' as const, id: input } : input.subject;
          return {
            subject,
            userId: subject.type === 'user' ? subject.id : undefined,
            unit: typeof input === 'string' ? 'credit' : (input.unit ?? 'credit'),
            balance: 10,
          };
        },
        async grant(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: input.amount };
        },
        async consume(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: 9 };
        },
        async adjust(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: input.amount };
        },
        async refund(input) {
          return { userId: input.userId, unit: input.unit ?? 'credit', balance: input.amount };
        },
        async reserve(input) {
          return {
            id: 'test-reservation',
            subject: input.subject ?? { type: 'user', id: input.userId ?? 'test-user' },
            amountReserved: input.amount,
            amountCommitted: 0,
            unit: input.unit ?? 'credit',
            status: 'reserved',
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
        async commitReservation() {
          return { userId: 'test-user', unit: 'credit', balance: 9 };
        },
        async releaseReservation() {
          return { userId: 'test-user', unit: 'credit', balance: 10 };
        },
        async revokeBySource() {
          return { revoked: 0 };
        },
        async listLedger() {
          return [];
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'capability-guard-test',
        name: 'writeArtifact',
        session: {
          user: { id: 'user_9', role: 'user' },
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_NOT_DECLARED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'capability-guard-test',
        name: 'consumeOtherCredits',
        session: {
          user: { id: 'user_9', role: 'user' },
          permissions: [Permission.CreditsConsume],
          userId: 'user_9',
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
});

test('runtime capability guard applies inside data transactions', async () => {
  let wrote = false;
  const transactionGuardModule = defineModule({
    id: 'transaction-guard-test',
    name: 'Transaction Guard Test',
    version: '0.1.0',
    permissions: [Permission.DataTransaction],
    actions: {
      transact: {
        handler: './actions/transact',
        auth: 'auth',
      },
    },
  });
  const unused = async () => {
    throw new Error('DATA_STUB_UNUSED');
  };
  let data: ModuleDataApi;
  data = {
    document<TRecord = Record<string, unknown>>(): ModuleDataDocument<TRecord> {
      return {
        findMany: unused,
        findOne: unused,
        findById: unused,
        async insert(input) {
          wrote = true;
          return { id: 'doc-1', ...input } as TRecord;
        },
        insertMany: unused,
        insertIfAbsent: unused,
        upsert: unused,
        update: unused,
        updateWhere: unused,
        delete: unused,
        claim: unused,
        count: unused,
        exists: unused,
      };
    },
    table() {
      throw new Error('DATA_TABLE_UNUSED');
    },
    async transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
      return callback(data);
    },
    tableRef() {
      return { text: 'unused', values: [] };
    },
    viewRef() {
      return { text: 'unused', values: [] };
    },
    sql: {
      query: unused,
      execute: unused,
    },
  } satisfies ModuleDataApi;
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'transaction-guard-test': {
          module: async () => ({ default: transactionGuardModule }),
          actions: {
            'actions/transact': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.data.transaction((tx) => tx.document('items').insert({ title: 'blocked' }))
              ),
            }),
          },
        },
      },
    },
    createDataApi: () => data,
  });

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'transaction-guard-test',
        name: 'transact',
        session: {
          user: { id: 'user_10', role: 'user' },
          permissions: [Permission.DataTransaction],
        },
      }),
    /MODULE_CAPABILITY_PERMISSION_NOT_DECLARED/
  );
  assert.equal(wrote, false);
});

test('runtime capability guard protects subject-scoped entitlements, redeem codes, and risk', async () => {
  const guardedModule = defineModule({
    id: 'subject-commercial-guard-test',
    name: 'Subject Commercial Guard Test',
    version: '0.1.0',
    permissions: [
      Permission.EntitlementsRead,
      Permission.EntitlementsWrite,
      Permission.CreditsConsume,
      Permission.CreditsWrite,
      Permission.RedeemCodesRedeem,
      Permission.RiskRead,
    ],
    actions: {
      ownEntitlement: {
        handler: './actions/own-entitlement',
        auth: 'auth',
      },
      otherRedeem: {
        handler: './actions/other-redeem',
        auth: 'auth',
      },
      otherRisk: {
        handler: './actions/other-risk',
        auth: 'auth',
      },
      revokeOtherEntitlement: {
        handler: './actions/revoke-other-entitlement',
        auth: 'auth',
      },
      expireEntitlements: {
        handler: './actions/expire-entitlements',
        auth: 'auth',
      },
      commitOtherReservation: {
        handler: './actions/commit-other-reservation',
        auth: 'auth',
      },
      revokeOtherCreditSource: {
        handler: './actions/revoke-other-credit-source',
        auth: 'auth',
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'subject-commercial-guard-test': {
          module: async () => ({ default: guardedModule }),
          actions: {
            'actions/own-entitlement': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.entitlements.has({
                  subject: { type: 'user', id: 'user_subject_1' },
                  entitlement: 'pro',
                })
              ),
            }),
            'actions/other-redeem': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.redeemCodes.redeem({
                  code: 'CODE',
                  subject: { type: 'user', id: 'other-user' },
                })
              ),
            }),
            'actions/other-risk': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.risk.check({ subject: { type: 'workspace', id: 'other-workspace' } })
              ),
            }),
            'actions/revoke-other-entitlement': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.entitlements.revoke({ id: 'entitlement_other' })
              ),
            }),
            'actions/expire-entitlements': async () => ({
              default: action(async (ctx: ModuleContext) => ctx.entitlements.expire()),
            }),
            'actions/commit-other-reservation': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.credits.commitReservation({ reservationId: 'reservation_other' })
              ),
            }),
            'actions/revoke-other-credit-source': async () => ({
              default: action(async (ctx: ModuleContext) =>
                ctx.credits.revokeBySource({ source: 'order', sourceId: 'order_other' })
              ),
            }),
          },
        },
      },
    },
    capabilities: {
      entitlements: {
        async has() {
          return true;
        },
        async list() {
          return [
            {
              id: 'entitlement_other',
              subject: { type: 'user', id: 'other-user' },
              userId: 'other-user',
              entitlement: 'pro',
              source: 'test',
              status: 'active',
              metadata: {},
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ];
        },
        async grant() {
          throw new Error('ENTITLEMENT_WRITE_UNUSED');
        },
        async revoke() {
          throw new Error('ENTITLEMENT_WRITE_UNUSED');
        },
        async override() {
          throw new Error('ENTITLEMENT_WRITE_UNUSED');
        },
        async expire() {
          return { expired: 0 };
        },
      },
      credits: {
        async balance() {
          return {
            subject: { type: 'user', id: 'other-user' },
            userId: 'other-user',
            unit: 'credit',
            balance: 0,
          };
        },
        async grant() {
          throw new Error('CREDIT_WRITE_UNUSED');
        },
        async consume() {
          throw new Error('CREDIT_CONSUME_UNUSED');
        },
        async adjust() {
          throw new Error('CREDIT_WRITE_UNUSED');
        },
        async refund() {
          throw new Error('CREDIT_WRITE_UNUSED');
        },
        async reserve() {
          throw new Error('CREDIT_CONSUME_UNUSED');
        },
        async commitReservation() {
          throw new Error('CREDIT_COMMIT_SHOULD_NOT_RUN');
        },
        async releaseReservation() {
          throw new Error('CREDIT_RELEASE_SHOULD_NOT_RUN');
        },
        async revokeBySource() {
          throw new Error('CREDIT_REVOKE_SHOULD_NOT_RUN');
        },
        async listLedger() {
          return [
            {
              id: 'credit_other',
              subject: { type: 'user', id: 'other-user' },
              amount: -1,
              unit: 'credit',
              direction: 'reserve',
              status: 'reserved',
              reason: 'reserve',
              source: 'order',
              sourceId: 'order_other',
              reservationId: 'reservation_other',
              metadata: {},
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ];
        },
      },
      redeemCodes: {
        async createBatch() {
          throw new Error('REDEEM_WRITE_UNUSED');
        },
        async redeem() {
          return { ok: true };
        },
        async freeze() {
          return { frozen: 0 };
        },
        async revoke() {
          throw new Error('REDEEM_WRITE_UNUSED');
        },
        async list() {
          return [];
        },
        async listRedemptions() {
          return [];
        },
      },
      risk: {
        async record() {
          throw new Error('RISK_WRITE_UNUSED');
        },
        async block() {
          return { blocked: true };
        },
        async check() {
          return { ok: true };
        },
      },
    },
  });

  await assert.equal(
    await host.executeAction({
      moduleId: 'subject-commercial-guard-test',
      name: 'ownEntitlement',
      session: {
        user: { id: 'user_subject_1', role: 'user' },
        userId: 'user_subject_1',
        permissions: [Permission.EntitlementsRead],
      },
    }),
    true
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'otherRedeem',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.RedeemCodesRedeem],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'revokeOtherEntitlement',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.EntitlementsWrite],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'expireEntitlements',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.EntitlementsWrite],
        },
      }),
    /MODULE_CAPABILITY_BULK_COMMERCIAL_WRITE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'commitOtherReservation',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.CreditsConsume],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'revokeOtherCreditSource',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          permissions: [Permission.CreditsWrite],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'subject-commercial-guard-test',
        name: 'otherRisk',
        session: {
          user: { id: 'user_subject_1', role: 'user' },
          userId: 'user_subject_1',
          workspaceId: 'workspace_subject_1',
          permissions: [Permission.RiskRead],
        },
      }),
    /MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED/
  );
});
