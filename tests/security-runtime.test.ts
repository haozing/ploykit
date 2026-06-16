import assert from 'node:assert/strict';
import test from 'node:test';
import {
  action,
  defineApi,
  defineModule,
  Permission,
  type ModuleContext,
} from '@ploykit/module-sdk';
import {
  createModuleHost,
  createStaticModuleConfigApi,
  createStaticModuleSecretsApi,
} from '../src/lib/module-runtime';
import {
  getSecurityFixtureLoadCounts,
  resetSecurityFixtureLoadCounts,
  securityArtifact,
} from './security-runtime-fixtures';

test('P4 permission guard denies API routes before loading handlers', async () => {
  resetSecurityFixtureLoadCounts();
  const host = await createModuleHost({ artifact: securityArtifact });

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
  assert.equal(getSecurityFixtureLoadCounts().secureApi, 0);
});

test('P4 permission guard allows API routes with permission and injects scope', async () => {
  resetSecurityFixtureLoadCounts();
  const host = await createModuleHost({ artifact: securityArtifact });

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
  assert.equal(getSecurityFixtureLoadCounts().secureApi, 1);
  assert.deepEqual(body, {
    ok: true,
    productId: 'product_1',
    workspaceId: 'workspace_1',
  });
});

test('P4 contract validation rejects entry permissions missing from module contract', async () => {
  let missingPermissionApiLoadCount = 0;
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
  resetSecurityFixtureLoadCounts();
  const host = await createModuleHost({ artifact: securityArtifact });

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
  assert.equal(getSecurityFixtureLoadCounts().paidAction, 0);

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
  const host = await createModuleHost({ artifact: securityArtifact });

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
    artifact: securityArtifact,
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
