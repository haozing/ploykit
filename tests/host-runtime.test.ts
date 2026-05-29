import assert from 'node:assert/strict';
import test from 'node:test';
import {
  action,
  createTestingModuleContext,
  defineApi,
  defineModule,
  Permission,
  table,
  text,
  type ModuleContext,
} from '@ploykit/module-sdk';
import {
  checkModuleMapHealth,
  createModuleHost,
  createModuleRuntimeHostSnapshot,
  type ModuleDataPostgresExecutor,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';
import {
  createCapabilityDescriptorRegistry,
  createModuleJobRunner,
  type CapabilityDescriptor,
} from '../src/lib/module-capabilities';

interface TestMessage {
  id: string;
  message: string;
}

const testModule = defineModule({
  id: 'host-test',
  name: 'Host Test Module',
  version: '0.1.0',
  permissions: [
    Permission.DataDocumentRead,
    Permission.DataDocumentWrite,
    Permission.SurfaceContribute,
  ],
  data: {
    version: 1,
    documents: {
      test_messages: {
        scope: 'user',
        fields: {
          message: 'string',
        },
      },
    },
  },
  routes: {
    site: [
      {
        path: '/tools/host-test',
        component: './pages/PublicToolPage',
        metadata: './loaders/public-tool-metadata',
        auth: 'public',
        cache: {
          strategy: 'public',
          revalidateSeconds: 300,
          tags: ['host-test'],
        },
        publicAliases: ['/public-host-test'],
      },
    ],
    dashboard: [
      {
        path: '/dashboard/:slug',
        component: './pages/DashboardPage',
        loader: './loaders/dashboard-state',
        metadata: './loaders/dashboard-metadata',
        auth: 'auth',
      },
    ],
    api: [
      {
        path: '/state',
        handler: './api/state',
        auth: 'auth',
        methods: ['GET'],
      },
      {
        path: '/machine-state',
        handler: './api/machine-state',
        auth: 'auth',
        machineAuth: 'apiKey',
        methods: ['GET'],
      },
      {
        path: '/hybrid-state',
        handler: './api/hybrid-state',
        auth: 'auth',
        machineAuth: 'user-or-apiKey',
        methods: ['GET'],
      },
    ],
  },
  actions: {
    writeMessage: {
      handler: './actions/write-message',
      auth: 'auth',
    },
  },
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/Widget',
      priority: 5,
      visibility: { mode: 'permission', permission: Permission.DataDocumentRead },
    },
  },
});

const artifact: ModuleMapArtifact = {
  kind: 'source',
  modules: {
    'host-test': {
      module: async () => ({ default: testModule }),
      apis: {
        'api/state': async () => ({
          default: defineApi({
            async get(ctx) {
              const messages = ctx.data.document<TestMessage>('test_messages');
              await messages.insert({ message: 'from-api' });
              return ctx.json({
                ok: true,
                count: await messages.count(),
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              });
            },
          }),
        }),
        'api/machine-state': async () => ({
          default: defineApi({
            get(ctx) {
              return ctx.json({
                ok: true,
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              });
            },
          }),
        }),
        'api/hybrid-state': async () => ({
          default: defineApi({
            get(ctx) {
              return ctx.json({
                ok: true,
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              });
            },
          }),
        }),
      },
      actions: {
        'actions/write-message': async () => ({
          default: action<ModuleContext, { message: string }, Record<string, unknown>>(
            async (ctx, input) => {
              const messages = ctx.data.document<TestMessage>('test_messages');
              await messages.insert({ message: input.message });
              return {
                ok: true,
                count: await messages.count(),
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              };
            }
          ),
        }),
      },
      pages: {
        'pages/DashboardPage': async () => ({
          default: function DashboardPage() {
            return { view: 'dashboard' };
          },
        }),
        'pages/PublicToolPage': async () => ({
          default: function PublicToolPage() {
            return { view: 'public-tool' };
          },
        }),
      },
      loaders: {
        'loaders/dashboard-state': async () => ({
          default: (ctx: ModuleContext) => ({
            slug: ctx.request.params.slug,
            userId: ctx.user?.id ?? null,
          }),
        }),
        'loaders/dashboard-metadata': async () => ({
          default: (ctx: ModuleContext) => ({
            title: `Dashboard ${ctx.request.params.slug}`,
          }),
        }),
        'loaders/public-tool-metadata': async () => ({
          default: () => ({
            title: 'Host Test Tool',
            description: 'Host runtime public tool fixture.',
          }),
        }),
      },
      surfaces: {
        'surfaces/Widget': async () => ({ default: function Widget() {} }),
      },
    },
  },
};

test('createModuleHost dispatches API routes with resolved session and ctx.data', async () => {
  const host = await createModuleHost({
    artifact,
    resolveSession: async () => ({
      user: { id: 'user_1', role: 'user' },
      permissions: [Permission.DataDocumentRead, Permission.DataDocumentWrite],
      data: {
        productId: 'product_1',
        userId: 'user_1',
        actorId: 'user_1',
      },
    }),
    createDataApi(input) {
      return createTestingModuleContext({ moduleId: input.contract.id }).data;
    },
  });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/state', { method: 'GET' }),
    pathname: '/state',
  });
  const body = (await response.json()) as {
    ok: boolean;
    count: number;
    moduleId: string;
    userId: string | null;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    count: 1,
    moduleId: 'host-test',
    userId: 'user_1',
  });
});

test('createModuleHost executes actions with resolved session and ctx.data', async () => {
  const host = await createModuleHost({
    artifact,
    resolveSession: async () => ({
      user: { id: 'user_2', role: 'user' },
      permissions: [Permission.DataDocumentRead, Permission.DataDocumentWrite],
      data: {
        productId: 'product_1',
        userId: 'user_2',
        actorId: 'user_2',
      },
    }),
    createDataApi(input) {
      return createTestingModuleContext({ moduleId: input.contract.id }).data;
    },
  });

  const result = await host.executeAction<{ message: string }, Record<string, unknown>>({
    moduleId: 'host-test',
    name: 'writeMessage',
    input: { message: 'from-action' },
  });

  assert.deepEqual(result, {
    ok: true,
    count: 1,
    moduleId: 'host-test',
    userId: 'user_2',
  });
});

test('createModuleHost mounts descriptor registered capability extensions', async () => {
  const descriptor: CapabilityDescriptor<'diagnostics', { ping(): string }> = {
    name: 'diagnostics',
    ctxKey: 'diagnostics',
    permissions: [],
  };
  const registry = createCapabilityDescriptorRegistry().register(descriptor);
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'host-test': {
          module: async () => ({ default: testModule }),
          actions: {
            'actions/write-message': async () => ({
              default: action<ModuleContext, { message: string }, Record<string, unknown>>(
                async (ctx) => {
                  const diagnostics = ctx.extensions.diagnostics as { ping(): string };
                  return {
                    ok: true,
                    value: diagnostics.ping(),
                    moduleId: ctx.module.id,
                  };
                }
              ),
            }),
          },
        },
      },
    },
    resolveSession: async () => ({
      user: { id: 'user_descriptor', role: 'user' },
      permissions: [],
    }),
    capabilities: {
      registry,
      providers: {
        diagnostics: {
          ping() {
            return 'pong';
          },
        },
      },
    },
  });

  const result = await host.executeAction<{ message: string }, Record<string, unknown>>({
    moduleId: 'host-test',
    name: 'writeMessage',
    input: { message: 'from-descriptor' },
  });

  assert.deepEqual(result, {
    ok: true,
    value: 'pong',
    moduleId: 'host-test',
  });
});

test('createModuleHost enforces descriptor registered capability permissions', async () => {
  const descriptor: CapabilityDescriptor<'egressDiagnostics', { ping(): string }> = {
    name: 'egressDiagnostics',
    ctxKey: 'egressDiagnostics',
    permissions: [Permission.ExternalHttp],
  };
  const registry = createCapabilityDescriptorRegistry().register(descriptor);
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'host-test': {
          module: async () => ({ default: testModule }),
          actions: {
            'actions/write-message': async () => ({
              default: action<ModuleContext, { message: string }, Record<string, unknown>>(
                async (ctx) => {
                  const diagnostics = ctx.extensions.egressDiagnostics as { ping(): string };
                  return { value: diagnostics.ping() };
                }
              ),
            }),
          },
        },
      },
    },
    resolveSession: async () => ({
      user: { id: 'user_descriptor', role: 'user' },
      permissions: [Permission.ExternalHttp],
    }),
    capabilities: {
      registry,
      providers: {
        egressDiagnostics: {
          ping() {
            return 'pong';
          },
        },
      },
    },
  });

  await assert.rejects(
    () =>
      host.executeAction<{ message: string }, Record<string, unknown>>({
        moduleId: 'host-test',
        name: 'writeMessage',
        input: { message: 'from-descriptor' },
      }),
    /MODULE_CAPABILITY_PERMISSION_NOT_DECLARED/
  );
});

test('createModuleHost mounts configured Data v2 for background jobs', async () => {
  const dataSessions: Array<{
    productId?: string;
    workspaceId?: string;
    userId?: string;
    actorId?: string;
  }> = [];
  const backgroundDataModule = defineModule({
    id: 'background-data-test',
    name: 'Background Data Test',
    version: '0.1.0',
    permissions: [Permission.DataSqlRead],
    data: {
      version: 1,
      tables: {
        items: table({
          scope: 'workspace',
          columns: {
            title: text().notNull(),
          },
        }),
      },
      migrations: {
        mode: 'generated',
        dir: './migrations',
      },
    },
    jobs: {
      inspect: {
        handler: './jobs/inspect',
      },
    },
  });
  const database: ModuleDataPostgresExecutor = {
    async query() {
      throw new Error('DATABASE_SHOULD_NOT_BE_QUERIED');
    },
  };
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'background-data-test': {
          module: async () => ({ default: backgroundDataModule }),
          jobs: {
            'jobs/inspect': async () => ({
              default: async (ctx: ModuleContext) => ({
                ref: ctx.data.tableRef('items').text,
                userId: ctx.user?.id ?? null,
              }),
            }),
          },
        },
      },
    },
    data: {
      database,
      session({ hostSession }) {
        dataSessions.push({
          productId: hostSession.productId,
          workspaceId: hostSession.workspaceId,
          userId: hostSession.userId,
          actorId: hostSession.actorId,
        });
        return {
          productId: hostSession.productId ?? 'product_bg',
          workspaceId: hostSession.workspaceId ?? null,
          userId: hostSession.userId ?? hostSession.user?.id ?? null,
          actorId: hostSession.actorId ?? hostSession.user?.id ?? null,
        };
      },
    },
  });
  const runner = createModuleJobRunner(host.runtime, {
    session: {
      user: { id: 'user_bg', role: 'user' },
      productId: 'product_bg',
      workspaceId: 'workspace_bg',
      userId: 'user_bg',
      actorId: 'user_bg',
      permissions: [Permission.DataSqlRead],
    },
  });

  const result = await runner.runJob<undefined, { ref: string; userId: string | null }>({
    moduleId: 'background-data-test',
    name: 'inspect',
  });

  assert.equal(result.run.status, 'succeeded');
  assert.deepEqual(result.result, {
    ref: '"public"."mod_background_data_test__items"',
    userId: 'user_bg',
  });
  assert.deepEqual(dataSessions, [
    {
      productId: 'product_bg',
      workspaceId: 'workspace_bg',
      userId: 'user_bg',
      actorId: 'user_bg',
    },
  ]);
});

test('createModuleHost enforces action confirmation, idempotency and timeout metadata', async () => {
  const actionPolicyModule = defineModule({
    id: 'action-policy-test',
    name: 'Action Policy Test',
    version: '0.1.0',
    actions: {
      destroy: {
        handler: './actions/destroy',
        auth: 'auth',
        sideEffect: 'destructive',
        confirmation: { required: true, fallbackMessage: 'Destroy everything?' },
      },
      bill: {
        handler: './actions/bill',
        auth: 'auth',
        sideEffect: 'billing',
        confirmation: { required: true, fallbackMessage: 'Bill account?' },
        idempotency: { required: true, keyFrom: 'request' },
      },
      slow: {
        handler: './actions/slow',
        auth: 'auth',
        timeoutMs: 5,
      },
    },
  });
  const host = await createModuleHost({
    artifact: {
      kind: 'source',
      modules: {
        'action-policy-test': {
          module: async () => ({ default: actionPolicyModule }),
          actions: {
            'actions/destroy': async () => ({
              default: action(async () => ({ ok: true })),
            }),
            'actions/bill': async () => ({
              default: action(async () => ({ charged: true })),
            }),
            'actions/slow': async () => ({
              default: action(async () => {
                await new Promise((resolve) => setTimeout(resolve, 25));
                return { ok: true };
              }),
            }),
          },
        },
      },
    },
  });
  const session = { user: { id: 'user_action', role: 'user' as const } };

  await assert.rejects(
    () => host.executeAction({ moduleId: 'action-policy-test', name: 'destroy', session }),
    /MODULE_ACTION_CONFIRMATION_REQUIRED/
  );
  assert.deepEqual(
    await host.executeAction({
      moduleId: 'action-policy-test',
      name: 'destroy',
      session,
      confirmed: true,
    }),
    { ok: true }
  );

  await assert.rejects(
    () =>
      host.executeAction({
        moduleId: 'action-policy-test',
        name: 'bill',
        session,
        confirmed: true,
      }),
    /MODULE_ACTION_IDEMPOTENCY_KEY_REQUIRED/
  );
  assert.deepEqual(
    await host.executeAction({
      moduleId: 'action-policy-test',
      name: 'bill',
      session,
      confirmed: true,
      idempotencyKey: 'bill-1',
    }),
    { charged: true }
  );

  await assert.rejects(
    () => host.executeAction({ moduleId: 'action-policy-test', name: 'slow', session }),
    /MODULE_ACTION_TIMEOUT/
  );
});

test('createModuleHost resolves page routes with loader data and metadata', async () => {
  const host = await createModuleHost({ artifact });

  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/dashboard/alpha', { method: 'GET' }),
    pathname: '/dashboard/alpha',
    session: {
      user: { id: 'user_3', role: 'user' },
    },
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.ok, true);
  assert.equal(result.page.moduleId, 'host-test');
  assert.deepEqual(result.page.params, { slug: 'alpha' });
  assert.deepEqual(result.page.loaderData, { slug: 'alpha', userId: 'user_3' });
  assert.deepEqual(result.page.metadata, { title: 'Dashboard alpha' });
  assert.deepEqual((result.page.component as () => unknown)(), { view: 'dashboard' });
});

test('createModuleHost resolves public aliases for site routes', async () => {
  const host = await createModuleHost({ artifact });

  const result = await host.resolvePageRoute({
    kind: 'site',
    request: new Request('http://localhost/public-host-test', { method: 'GET' }),
    pathname: '/public-host-test',
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.page.route.path, '/tools/host-test');
  assert.equal(result.page.params.publicAlias, undefined);
  assert.deepEqual((result.page.component as () => unknown)(), { view: 'public-tool' });
});

test('createModuleHost rejects machine API routes without an API key', async () => {
  const host = await createModuleHost({ artifact });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/machine-state', { method: 'GET' }),
    pathname: '/machine-state',
  });
  const body = (await response.json()) as { code: string };

  assert.equal(response.status, 401);
  assert.equal(body.code, 'MODULE_API_KEY_REQUIRED');
});

test('createModuleHost dispatches machine API routes through host API key verifier', async () => {
  const host = await createModuleHost({
    artifact,
    verifyApiKey(input) {
      assert.equal(input.apiKey, 'secret_1');
      assert.equal(input.moduleId, 'host-test');
      return {
        ok: true,
        user: { id: 'machine_user_1', role: 'user' },
      };
    },
  });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/machine-state', {
      method: 'GET',
      headers: {
        authorization: 'Bearer secret_1',
      },
    }),
    pathname: '/machine-state',
  });
  const body = (await response.json()) as {
    ok: boolean;
    moduleId: string;
    userId: string | null;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    moduleId: 'host-test',
    userId: 'machine_user_1',
  });
});

test('createModuleHost allows user-or-apiKey routes with an existing user session', async () => {
  const host = await createModuleHost({ artifact });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/hybrid-state', { method: 'GET' }),
    pathname: '/hybrid-state',
    session: {
      user: { id: 'session_user_1', role: 'user' },
      userId: 'session_user_1',
      permissions: [],
      authKind: 'user',
    },
  });
  const body = (await response.json()) as {
    ok: boolean;
    moduleId: string;
    userId: string | null;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    moduleId: 'host-test',
    userId: 'session_user_1',
  });
});

test('createModuleHost allows user-or-apiKey routes with an API key session', async () => {
  const host = await createModuleHost({
    artifact,
    verifyApiKey() {
      return {
        ok: true,
        session: {
          user: null,
          authKind: 'apiKey',
          apiKeyId: 'api_key_test',
          subject: { type: 'workspace', id: 'workspace_test' },
          permissions: [],
        },
      };
    },
  });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/hybrid-state', {
      method: 'GET',
      headers: {
        'x-api-key': 'secret_2',
      },
    }),
    pathname: '/hybrid-state',
  });
  const body = (await response.json()) as {
    ok: boolean;
    moduleId: string;
    userId: string | null;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    moduleId: 'host-test',
    userId: null,
  });
});

test('createModuleHost preserves auth boundaries for API routes and resolves surfaces', async () => {
  const host = await createModuleHost({ artifact });

  const response = await host.dispatchApiRoute({
    request: new Request('http://localhost/api/modules/state', { method: 'GET' }),
    pathname: '/state',
  });

  assert.equal(response.status, 401);
  assert.deepEqual(
    await host.resolvePageRoute({
      kind: 'dashboard',
      request: new Request('http://localhost/dashboard/alpha', { method: 'GET' }),
      pathname: '/dashboard/alpha',
    }),
    {
      ok: false,
      status: 401,
      code: 'MODULE_PAGE_AUTH_REQUIRED',
      message: 'Authentication is required.',
    }
  );
  assert.equal(host.resolveSurfaceContributions('dashboard.home:widgets').length, 0);
  assert.equal(
    host.resolveSurfaceContributions('dashboard.home:widgets', {
      session: {
        user: { id: 'user_4', role: 'user' },
        permissions: [Permission.DataDocumentRead],
      },
    }).length,
    1
  );
  assert.equal(host.getContract('host-test')?.id, 'host-test');
});

test('runtime host snapshot explains mounted capabilities and module map health', async () => {
  const host = await createModuleHost({ artifact });
  const snapshot = createModuleRuntimeHostSnapshot(host.runtime, {
    generatedAt: '2026-01-01T00:00:00.000Z',
    productScope: {
      productId: 'product_1',
      workspaceId: 'workspace_1',
      profile: 'test',
    },
  });
  const health = checkModuleMapHealth({
    artifact,
    contracts: host.runtime.contracts,
  });

  assert.equal(snapshot.mountedCapabilities.modules, 1);
  assert.equal(snapshot.mountedCapabilities.routes, 6);
  assert.equal(snapshot.mountedCapabilities.actions, 1);
  assert.equal(snapshot.routeResolution.some((route) => route.source === 'publicAlias'), true);
  assert.equal(snapshot.productScope?.profile, 'test');
  assert.equal(health.ok, false);
  assert.ok(health.issues.some((issue) => issue.kind === 'missing-release-metadata'));
});
