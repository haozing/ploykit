import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import {
  createModuleRouteManifest,
  loadModuleRuntimeContracts,
} from '../src/lib/module-runtime';
import { MODULE_MAP_ARTIFACT } from '../src/lib/module-map';
import { Permission } from '../src/module-sdk';
import { POST as submitContactApi } from '../apps/host-next/app/api/contact/route';
import { POST as receiveModuleWebhook } from '../apps/host-next/app/api/module-webhooks/[...path]/route';
import { auditAdminRegistry, findAdminPageRegistryEntry, getAdminRegistryEntries } from '../apps/host-next/lib/admin-route-registry';
import { auditAdminShellRegistry } from '../apps/host-next/lib/admin-shell-audit';
import { applyModuleSelfServiceSessionPermissions } from '../apps/host-next/lib/create-host';
import { runHostConfigDoctor } from '../apps/host-next/lib/config-doctor';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';
import { createHostRequest, hostBaseUrl } from '../apps/host-next/lib/paths';
import { auditDiscoveredHostApiRoutes } from '../apps/host-next/lib/route-security-audit';
import {
  checkHostRouteSecurity,
  getHostRouteCatalog,
  getHostRouteSecurityEntry,
  resetHostSecurityRateLimiter,
} from '../apps/host-next/lib/security';
import {
  getHostCapabilitiesForSession,
  HOST_ROLES,
  USER_MODULE_PERMISSIONS,
} from '../apps/host-next/lib/rbac';

type WebShellTestCallback = (context: unknown) => void | Promise<void>;
type WebShellTestOptions = Record<string, unknown>;
type WebShellTestRunner = {
  (name: string, fn: WebShellTestCallback): void;
  (name: string, options: WebShellTestOptions, fn: WebShellTestCallback): void;
};

const runNodeTest = nodeTest as unknown as WebShellTestRunner;
let webShellTestQueue: Promise<void> = Promise.resolve();

const test: WebShellTestRunner = ((
  name: string,
  optionsOrFn: WebShellTestOptions | WebShellTestCallback,
  maybeFn?: WebShellTestCallback
) => {
  const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn;
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;

  if (!fn) {
    throw new Error(`WEB_SHELL_TEST_CALLBACK_MISSING: ${name}`);
  }

  const queued = async (context: unknown) => {
    const run = webShellTestQueue.then(() => fn(context));
    webShellTestQueue = run.then(
      () => undefined,
      () => undefined
    );
    await run;
  };

  const testOptions = { ...(options ?? {}), concurrency: false };

  if (options) {
    runNodeTest(name, testOptions, queued);
  } else {
    runNodeTest(name, testOptions, queued);
  }
}) as WebShellTestRunner;

function sameOriginHeader(): string {
  return new URL(hostBaseUrl()).origin;
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    Reflect.set(process.env, name, value);
  }
}

test('R1 contact API accepts public requests through the route security catalog', async () => {
  resetHostSecurityRateLimiter();
  const response = await submitContactApi(
    createHostRequest('/api/contact', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: sameOriginHeader(),
      },
      body: JSON.stringify({
        name: 'PloyKit Operator',
        email: 'operator@example.com',
        company: 'PloyKit',
        message: 'Need help deploying a production module host.',
      }),
    })
  );
  const payload = (await response.json()) as {
    ok: boolean;
    data?: { contactId?: string; email?: { provider?: string; status?: string } };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.data?.contactId ?? '', /^contact_/);
  assert.equal(payload.data?.email?.provider, 'email-log');
});

test('K4 module webhook route enforces signed secret readiness and body limits', async () => {
  const secretKeys = [
    'PLOYKIT_MODULE_WEBHOOK_SECRET',
    'PLOYKIT_MODULE_WEBHOOK_SECRET_PLATFORM_SMOKE',
    'PLOYKIT_MODULE_WEBHOOK_SECRET_PLATFORM_SMOKE_INGEST',
    'PLOYKIT_MODULE_WEBHOOK_SECRET_DEV_HMAC_SHA256_PLATFORM_CONN',
  ];
  const previous = new Map(secretKeys.map((key) => [key, process.env[key]]));
  const body = JSON.stringify({ source: 'signed-route-test' });
  const idempotencyKey = `signed-route-${Date.now()}`;

  try {
    for (const key of secretKeys) {
      delete process.env[key];
    }
    const missingSecret = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/platform-smoke/webhook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-ploykit-signature': 'sha256=invalid',
        },
      }),
      {
        params: Promise.resolve({ path: ['platform-smoke', 'webhook'] }),
      }
    );

    process.env.PLOYKIT_MODULE_WEBHOOK_SECRET_PLATFORM_SMOKE_INGEST = 'platform-secret';
    const signature = `sha256=${createHmac('sha256', 'platform-secret').update(body).digest('hex')}`;
    const accepted = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/platform-smoke/webhook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-ploykit-signature': signature,
        },
      }),
      {
        params: Promise.resolve({ path: ['platform-smoke', 'webhook'] }),
      }
    );
    const githubHeaderBody = JSON.stringify({ source: 'github-header-test' });
    const githubHeaderSignature = `sha256=${createHmac('sha256', 'platform-secret')
      .update(githubHeaderBody)
      .digest('hex')}`;
    const acceptedGithubHeader = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/platform-smoke/webhook', {
        method: 'POST',
        body: githubHeaderBody,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `${idempotencyKey}-github`,
          'x-hub-signature-256': githubHeaderSignature,
        },
      }),
      {
        params: Promise.resolve({ path: ['platform-smoke', 'webhook'] }),
      }
    );
    process.env.PLOYKIT_MODULE_WEBHOOK_SECRET_DEV_HMAC_SHA256_PLATFORM_CONN = 'connection-secret';
    const connectionBody = JSON.stringify({ source: 'connection-secret-test' });
    const connectionSignature = `sha256=${createHmac('sha256', 'connection-secret')
      .update(connectionBody)
      .digest('hex')}`;
    const acceptedConnectionSecret = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/platform-smoke/webhook?connection=platform-conn', {
        method: 'POST',
        body: connectionBody,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `${idempotencyKey}-connection`,
          'x-ploykit-signature': connectionSignature,
          'x-ploykit-connection-slug': 'platform-conn',
        },
      }),
      {
        params: Promise.resolve({ path: ['platform-smoke', 'webhook'] }),
      }
    );
    const tooLarge = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/platform-smoke/workflow/webhook', {
        method: 'POST',
        body: '{}',
        headers: {
          'content-type': 'application/json',
          'content-length': String(1024 * 1024 + 1),
        },
      }),
      {
        params: Promise.resolve({ path: ['platform-smoke', 'workflow', 'webhook'] }),
      }
    );

    assert.equal(missingSecret.status, 401);
    assert.equal(accepted.status, 200);
    assert.equal(acceptedGithubHeader.status, 200);
    assert.equal(acceptedConnectionSecret.status, 200);
    assert.equal(tooLarge.status, 413);
    assert.equal(
      ((await accepted.json()) as { receipt: { status: string } }).receipt.status,
      'received'
    );
    assert.equal(
      ((await acceptedGithubHeader.json()) as { receipt: { status: string } }).receipt.status,
      'received'
    );
    assert.equal(
      ((await acceptedConnectionSecret.json()) as { receipt: { status: string } }).receipt.status,
      'received'
    );
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('K4 host security catalog covers main routes and blocks cross-origin mutations', async () => {
  resetHostSecurityRateLimiter();
  const routes = getHostRouteCatalog().map((route) => route.id);
  assert.ok(routes.includes('module.action'));
  assert.ok(routes.includes('module.webhook'));
  assert.ok(routes.includes('contact.submit'));
  assert.ok(routes.includes('files.collection'));
  assert.ok(routes.includes('files.item'));
  assert.ok(routes.includes('billing.checkout'));
  assert.ok(routes.includes('worker.drain'));
  assert.ok(routes.includes('user.profile'));
  assert.ok(routes.includes('productScope.current'));
  assert.ok(routes.includes('productScope.products'));
  assert.ok(routes.includes('productScope.workspaces'));
  assert.ok(routes.includes('productScope.domainAliases'));
  assert.ok(routes.includes('notifications.read'));
  assert.ok(routes.includes('notifications.readAll'));
  assert.ok(routes.includes('admin.search'));
  assert.ok(routes.includes('admin.revenue.reconcile'));
  assert.ok(routes.includes('admin.entitlements.read'));
  assert.ok(routes.includes('admin.entitlements.write'));
  assert.ok(routes.includes('admin.providers.read'));
  assert.ok(routes.includes('admin.providers.write'));
  assert.ok(routes.includes('admin.outbox.deadLetters.write'));
  assert.ok(routes.includes('auth.register'));
  assert.ok(routes.includes('auth.session'));
  assert.ok(routes.includes('auth.sessions'));
  assert.ok(routes.includes('media.file'));

  const audit = auditDiscoveredHostApiRoutes(process.cwd());
  assert.equal(audit.ok, true);
  assert.equal(audit.missingCatalogRoutes.length, 0);
  assert.equal(audit.mutationRoutesWithoutCsrf.length, 0);
  assert.equal(audit.mutationRoutesWithoutOriginGuard.length, 0);

  const adminAudit = auditAdminRegistry();
  const adminEntries = getAdminRegistryEntries();
  const adminKeys = adminEntries.map((entry) => `${entry.kind}:${entry.id}`);
  assert.equal(adminAudit.ok, true);
  assert.ok(adminKeys.includes('api:security.catalog'));
  assert.ok(adminKeys.includes('api:entitlements.write'));
  assert.ok(adminKeys.includes('action:users.updateStatus'));
  assert.ok(adminKeys.includes('action:webhooks.bulkReplayDeadLetters'));
  assert.ok(adminKeys.includes('action:serviceConnections.rotateSecret'));
  assert.equal(
    findAdminPageRegistryEntry('/admin/modules/platform-smoke')?.id,
    'module.detail'
  );
  assert.equal(findAdminPageRegistryEntry('/admin/runs/run_demo')?.id, 'run.detail');
  assert.equal(findAdminPageRegistryEntry('/admin/webhooks/outbox_demo')?.id, 'webhook.detail');
  assert.equal(findAdminPageRegistryEntry('/admin/webhooks')?.capability, 'admin.webhooks.read');
  assert.equal(
    findAdminPageRegistryEntry('/admin/service-connections')?.capability,
    'admin.serviceConnections.read'
  );
  assert.equal(
    findAdminPageRegistryEntry('/admin/module-dev-console')?.capability,
    'admin.devConsole.read'
  );
  assert.equal(findAdminPageRegistryEntry('/admin/settings')?.capability, 'admin.settings.read');
  assert.ok(
    adminEntries.some(
      (entry) =>
        entry.kind === 'api' &&
        entry.id === 'revenue.reconcile' &&
        entry.capability === 'billing.write'
    )
  );
  assert.ok(
    adminEntries.some(
      (entry) =>
        entry.kind === 'api' &&
        entry.id === 'serviceConnections' &&
        entry.capability === 'admin.serviceConnections.read'
    )
  );
  assert.ok(
    adminEntries.some(
      (entry) =>
        entry.kind === 'action' &&
        entry.id === 'settings.update' &&
        entry.capability === 'admin.settings.write'
    )
  );
  assert.ok(
    adminEntries.some(
      (entry) =>
        entry.kind === 'action' &&
        entry.id === 'webhooks.retryOutbox' &&
        entry.capability === 'admin.webhooks.write'
    )
  );
  assert.ok(
    adminEntries.some(
      (entry) =>
        entry.kind === 'action' &&
        entry.id === 'entitlements.grant' &&
        entry.capability === 'billing.write'
    )
  );
  assert.ok(HOST_ROLES.every((role) => !('system' in role)));
  assert.deepEqual(
    HOST_ROLES.find((role) => role.id === 'user')?.modulePermissions,
    USER_MODULE_PERMISSIONS
  );

  const ownerCapabilities = getHostCapabilitiesForSession({
    user: { id: 'workspace-owner', role: 'user' },
    workspaceRole: 'owner',
    permissions: [],
  });
  assert.ok(ownerCapabilities.includes('workspace.manage'));
  assert.equal(ownerCapabilities.includes('admin.access'), false);
  assert.equal(ownerCapabilities.includes('billing.write'), false);

  const baseModuleSession = {
    user: { id: 'self-service-user', role: 'user' as const },
    userId: 'self-service-user',
    permissions: USER_MODULE_PERMISSIONS,
    data: null,
  };
  const moduleContracts = await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT);
  const moduleRoutes = createModuleRouteManifest(moduleContracts);
  const platformDashboardContract = moduleContracts.find((contract) =>
    contract.pages.some((page) => page.area === 'dashboard' && page.path === '/platform-smoke')
  );
  assert.ok(platformDashboardContract);
  const platformDashboardSession = applyModuleSelfServiceSessionPermissions(
    baseModuleSession,
    {
      operation: 'page',
      routeKind: 'dashboard',
      pathname: '/platform-smoke',
    },
    moduleContracts,
    moduleRoutes
  );
  for (const permission of platformDashboardContract.permissions) {
    assert.ok(platformDashboardSession.permissions?.includes(permission));
  }
  const unrelatedDashboardSession = applyModuleSelfServiceSessionPermissions(
    baseModuleSession,
    {
      operation: 'page',
      routeKind: 'dashboard',
      pathname: '/does-not-match-a-module',
    },
    moduleContracts,
    moduleRoutes
  );
  assert.equal(unrelatedDashboardSession.permissions?.includes(Permission.ServicesInvoke), false);
  assert.equal(
    unrelatedDashboardSession.permissions?.includes(Permission.ResourceBindingsRead),
    false
  );

  const adminShellAudit = auditAdminShellRegistry(process.cwd());
  assert.equal(adminShellAudit.ok, true);
  assert.equal(adminShellAudit.pageRoutesMissingRegistry.length, 0);
  assert.equal(adminShellAudit.registryPagesWithoutFiles.length, 0);
  assert.equal(adminShellAudit.apiRoutesMissingRegistry.length, 0);
  assert.equal(adminShellAudit.registryApisWithoutFiles.length, 0);
  assert.equal(adminShellAudit.navRoutesMissingRegistry.length, 0);
  assert.equal(adminShellAudit.navRoutesMissingCapability.length, 0);
  assert.equal(adminShellAudit.actionDefinitionsMissingRegistry.length, 0);
  assert.equal(adminShellAudit.registryActionsWithoutDefinitions.length, 0);
  assert.equal(adminShellAudit.duplicateActionDefinitions.length, 0);
  assert.equal(adminShellAudit.manualActionContexts.length, 0);

  assert.equal(getHostRouteSecurityEntry('admin.search').rateLimit?.kind, 'machine');
  assert.equal(getHostRouteSecurityEntry('admin.providers.read').rateLimit?.kind, 'machine');
  assert.equal(getHostRouteSecurityEntry('admin.providers.write').rateLimit?.kind, 'public');
  assert.equal(getHostRouteSecurityEntry('admin.resources.read').rateLimit?.kind, 'machine');
  assert.equal(getHostRouteSecurityEntry('admin.resources.execute').rateLimit?.kind, 'high-cost');
  assert.equal(getHostRouteSecurityEntry('admin.entitlements.write').rateLimit?.kind, 'public');
  assert.equal(getHostRouteSecurityEntry('admin.revenue.reconcile').rateLimit?.kind, 'high-cost');

  const wrongMethodResponse = await checkHostRouteSecurity(
    createHostRequest('/api/admin/entitlements', { method: 'POST' }),
    'admin.entitlements.read',
    { session: createDemoHostSession() }
  );
  assert.equal(wrongMethodResponse?.status, 405);

  const response = await checkHostRouteSecurity(
    createHostRequest('/api/files', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example.com',
      },
    }),
    'files.collection',
    { session: createDemoHostSession() }
  );

  assert.equal(response?.status, 403);

  const previousNodeEnv = process.env.NODE_ENV;
  try {
    restoreEnvValue('NODE_ENV', 'production');
    const missingOriginResponse = await checkHostRouteSecurity(
      createHostRequest('/api/files', { method: 'POST' }),
      'files.collection',
      { session: createDemoHostSession() }
    );
    assert.equal(missingOriginResponse?.status, 403);
    assert.equal(
      ((await missingOriginResponse?.json()) as { code: string } | undefined)?.code,
      'HOST_ORIGIN_REQUIRED'
    );
  } finally {
    restoreEnvValue('NODE_ENV', previousNodeEnv);
  }

  const loopbackAliasResponse = await checkHostRouteSecurity(
    new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        referer: 'http://127.0.0.1:3000/zh/login',
      },
    }),
    'auth.login'
  );

  assert.equal(loopbackAliasResponse, null);
});

test('X11 config doctor exposes route, provider, metrics and retention readiness', async () => {
  const report = await runHostConfigDoctor({ projectRoot: process.cwd() });

  assert.equal(report.routeSecurity.ok, true);
  assert.equal(report.metrics.routeCatalogEntries, getHostRouteCatalog().length);
  assert.ok(report.metrics.providersTotal >= 5);
  assert.ok(report.providerReadiness.some((provider) => provider.id === 'security'));
  assert.match(report.retention.files, /expiresAt/);
});

test('X11 config doctor requires production retention windows', async () => {
  const report = await runHostConfigDoctor({
    projectRoot: process.cwd(),
    required: true,
    env: { ...process.env, PLOYKIT_AUDIT_RETENTION_DAYS: '', PLOYKIT_RUN_LOG_RETENTION_DAYS: '' },
  });
  const codes = report.diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(codes.includes('HOST_AUDIT_RETENTION_REQUIRED'));
  assert.ok(codes.includes('HOST_RUN_LOG_RETENTION_REQUIRED'));
});
