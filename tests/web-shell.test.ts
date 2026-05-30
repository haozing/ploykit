import {
  createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import {
  createInMemoryRuntimeStore,
} from '../src/lib/module-runtime';
import {
  COMMERCIAL_ORDER_STATUS_EVENT_NAME,
  createMemoryModuleFileStorage,
} from '../src/lib/module-capabilities';
import {
  archiveHostBillingPlan,
  createHostCommercialRuntimeFromStore,
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  getHostCommercialRuntime,
  loadHostBillingCatalog,
  syncHostBillingSkuToStripe,
  upsertHostBillingPlan,
  upsertHostBillingSku,
  verifyStripeWebhookSignature,
} from '../apps/host-next/lib/commercial-provider';
import {
  drainHostEmailOutbox,
  enqueueHostEmail,
  getHostEmailProviderStatus,
  sendHostEmail,
} from '../apps/host-next/lib/email-provider';
import {
  createHostBillingPortal,
  getHostBillingOverview,
  getHostBillingTaxProfile,
} from '../apps/host-next/lib/billing-api';
import {
  applyAdminAuditRetention,
  bulkUpdateAdminFiles,
  cleanupAdminDeletedFiles,
  deleteAdminFile,
  getAdminFileDetailView,
  getAdminCommercialView,
  getAdminFilesView,
  getAdminHostSettingsView,
  getAdminModuleDetail,
  getAdminModuleDevConsoleView,
  getAdminOperationsView,
  getAdminOutboxDetail,
  getAdminRunDetail,
  updateAdminHostSettings,
} from '../apps/host-next/lib/admin-operations';
import { retryAdminWebhookReceipt } from '../apps/host-next/lib/admin-delivery';
import {
  applyAdminServiceConnectionLogRetention,
  createAdminServiceConnection,
  getAdminServiceConnectionsView,
  rotateAdminServiceConnectionSecret,
  setAdminServiceConnectionStatus,
  testAdminServiceConnection,
  updateAdminServiceConnectionPolicy,
} from '../apps/host-next/lib/admin-service-connections';
import { getAdminAnalytics, listAdminEntitlements } from '../apps/host-next/lib/admin-api';
import {
  getHostCapabilitiesForSession,
  HOST_ROLES,
  USER_MODULE_PERMISSIONS,
} from '../apps/host-next/lib/rbac';
import { getAdminProviderStatusView } from '../apps/host-next/lib/admin-provider-status';
import { getAdminWorkerStatusView } from '../apps/host-next/lib/admin-worker-status';
import {
  createHostServiceConnectionsApi,
  createScopedRunsApi,
} from '../apps/host-next/lib/capability-providers';
import {
  authenticateHostUser,
  createRuntimeStoreHostAuthAdapter,
  createHostPasswordHash,
  createHostSessionCookie,
  createHostSessionCookieForSession,
  getHostAuthAdapter,
  ensureHostIdentitySeeded,
  HOST_AUTH_COOKIE,
  resolveHostSessionFromCookieHeader,
  verifyHostPassword,
} from '../apps/host-next/lib/auth';
import {
  getHostIdentityUserDetail,
  requestHostUserPasswordReset,
  revokeHostUserSession,
  setHostUserRole,
  setHostUserStatus,
} from '../apps/host-next/lib/identity-operations';
import { resolveHostRequestSession } from '../apps/host-next/lib/auth-session';
import {
  auditAdminRegistry,
  findAdminPageRegistryEntry,
  getAdminRegistryEntries,
} from '../apps/host-next/lib/admin-route-registry';
import { auditAdminShellRegistry } from '../apps/host-next/lib/admin-shell-audit';
import {
  createHostFileRuntimeFromParts,
  resolveHostFileQuotaPolicy,
  resolveHostFileStorageConfig,
  uploadHostUserFile,
} from '../apps/host-next/lib/files';
import { getHostRuntime, getHostRuntimeHealth } from '../apps/host-next/lib/create-host';
import { baseHostSettings, mergeHostSettings } from '../apps/host-next/lib/host-settings';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';
import { runHostConfigDoctor } from '../apps/host-next/lib/config-doctor';
import { createDemoHostSession, getModuleHost } from '../apps/host-next/lib/module-host';
import { resolvePublicNavigation } from '../apps/host-next/lib/site-navigation';
import { ensureHostProductScopeSeeded } from '../apps/host-next/lib/product-scope';
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  upsertWorkspaceMember,
} from '../apps/host-next/lib/product-scope-api';
import { auditDiscoveredHostApiRoutes } from '../apps/host-next/lib/route-security-audit';
import {
  checkHostRouteSecurity,
  getHostRouteCatalog,
  getHostRouteSecurityEntry,
  resetHostSecurityRateLimiter,
} from '../apps/host-next/lib/security';
import {
  createHostRequest,
  dashboardHref,
  hostBaseUrl,
  modulePathFromSegments,
  requestUrl,
} from '../apps/host-next/lib/paths';
import {
  assertHostRuntimeStoreConfig,
  DEFAULT_LOCAL_DATABASE_URL,
  getHostRuntimeStore,
  resolveHostRuntimeStoreConfig,
} from '../apps/host-next/lib/runtime-store';
import { getUserSaasSnapshot } from '../apps/host-next/lib/saas-operations';
import {
  drainHostWorker,
  enqueueHostDemoJob,
  evaluateHostWorkerAlerts,
  getHostWorkerStatus,
  runHostWorkerLoop,
} from '../apps/host-next/lib/worker';
import {
  GET as getUserProfile,
  PATCH as patchUserProfile,
} from '../apps/host-next/app/api/user/profile/route';
import { POST as changeUserPassword } from '../apps/host-next/app/api/user/profile/password/route';
import { GET as getUserRole } from '../apps/host-next/app/api/user/role/route';
import { POST as registerUserApi } from '../apps/host-next/app/api/auth/register/route';
import { POST as requestPasswordResetApi } from '../apps/host-next/app/api/auth/password-reset/request/route';
import { GET as getCurrentProductScope } from '../apps/host-next/app/api/product-scope/current/route';
import { GET as getProductScopeProducts } from '../apps/host-next/app/api/product-scope/products/route';
import { GET as getProductScopeWorkspaces } from '../apps/host-next/app/api/product-scope/workspaces/route';
import { GET as getProductScopeDomainAliases } from '../apps/host-next/app/api/product-scope/domain-aliases/route';
import { POST as switchProductScopeWorkspace } from '../apps/host-next/app/api/product-scope/switch/route';
import { GET as getNotificationsUnread } from '../apps/host-next/app/api/notifications/unread/route';
import { GET as getNotificationsHistory } from '../apps/host-next/app/api/notifications/history/route';
import { PATCH as updateNotificationPreferences } from '../apps/host-next/app/api/notifications/preferences/route';
import { POST as markNotificationsReadAll } from '../apps/host-next/app/api/notifications/read-all/route';
import { POST as markNotificationRead } from '../apps/host-next/app/api/notifications/[notificationId]/read/route';
import { GET as getBillingOrders } from '../apps/host-next/app/api/billing/orders/route';
import { GET as getAdminAuditApi } from '../apps/host-next/app/api/admin/audit/route';
import {
  GET as getAdminProvidersApi,
  POST as recordAdminProvidersAuditApi,
} from '../apps/host-next/app/api/admin/providers/route';
import { POST as loginUserApi } from '../apps/host-next/app/api/auth/login/route';
import { GET as getAdminWorkersApi } from '../apps/host-next/app/api/admin/workers/route';
import { GET as searchAdminApi } from '../apps/host-next/app/api/admin/search/route';
import { PATCH as patchAdminEntitlements } from '../apps/host-next/app/api/admin/entitlements/route';
import {
  GET as listDeadLettersApi,
  POST as bulkDeadLettersApi,
} from '../apps/host-next/app/api/admin/outbox/dead-letters/route';
import { POST as receiveModuleWebhook } from '../apps/host-next/app/api/module-webhooks/[...path]/route';
import { POST as submitContactApi } from '../apps/host-next/app/api/contact/route';
import sitemap from '../apps/host-next/app/sitemap';

type WebShellTestCallback = (context: unknown) => void | Promise<void>;
type WebShellTestOptions = Record<string, unknown>;
type WebShellTestRunner = {
  (name: string, fn: WebShellTestCallback): void;
  (name: string, options: WebShellTestOptions, fn: WebShellTestCallback): void;
};

const runNodeTest = nodeTest as unknown as WebShellTestRunner;
let webShellTestQueue: Promise<void> = Promise.resolve();

function sameOriginHeader(): string {
  return new URL(hostBaseUrl()).origin;
}

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

test('P10 path helpers map Next catch-all segments to module routes', () => {
  assert.equal(modulePathFromSegments(undefined), '/');
  assert.equal(modulePathFromSegments([]), '/');
  assert.equal(modulePathFromSegments(['hello']), '/hello');
  assert.equal(dashboardHref('/'), '/dashboard');
  assert.equal(dashboardHref('/hello'), '/dashboard/hello');
  assert.equal(dashboardHref('hello'), '/dashboard/hello');
  assert.equal(
    requestUrl(
      '/zh/dashboard',
      new Request('http://localhost:3000/api/auth/login', {
        headers: { host: '127.0.0.1:3000' },
      })
    ).toString(),
    'http://127.0.0.1:3000/zh/dashboard'
  );
});

test('P10 host shell resolves dashboard module page through the real host factory', async () => {
  const host = await getModuleHost();
  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    pathname: '/hello',
    request: createHostRequest('/dashboard/hello'),
    session: createDemoHostSession(),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.page.moduleId, 'hello');
    assert.equal(result.page.kind, 'dashboard');
  }
});

test('P10 host shell dispatches module API routes with a demo host session', async () => {
  const host = await getModuleHost();
  const response = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/hello'),
    pathname: '/hello',
    session: createDemoHostSession(),
  });
  const body = (await response.json()) as { ok: boolean; moduleId: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.moduleId, 'hello');
});

test('K1 host module API resolves request cookie sessions without a demo override', async () => {
  const host = await getModuleHost();
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const response = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/hello', {
      headers: { cookie },
    }),
    pathname: '/hello',
  });
  const body = (await response.json()) as { ok: boolean; moduleId: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.moduleId, 'hello');
});

test('P20 capability demo API and action receive AI/RAG host capabilities', async () => {
  const host = await getModuleHost();
  const apiResponse = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/capability-demo/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'What does the demo cover?' }),
      headers: { 'content-type': 'application/json' },
    }),
    pathname: '/capability-demo/ask',
    session: createDemoHostSession(),
  });
  const apiBody = (await apiResponse.json()) as {
    ok: boolean;
    result: { text: string; model: string };
  };

  assert.equal(apiResponse.status, 200);
  assert.equal(apiBody.ok, true);
  assert.equal(apiBody.result.model, 'static-text');
  assert.match(apiBody.result.text, /demo-ai:/);

  const actionResult = await host.executeAction<
    { question: string },
    { text: string; model: string }
  >({
    moduleId: 'capability-demo',
    name: 'ask',
    input: { question: 'Which capabilities are mounted?' },
    session: createDemoHostSession(),
  });

  assert.equal(actionResult.model, 'static-text');
  assert.match(actionResult.text, /demo-ai:/);
});

test('M5 public tools demo formats JSON and text through public module APIs', async () => {
  const host = await getModuleHost();
  const response = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/public-tools/format-json', {
      method: 'POST',
      body: JSON.stringify({ source: '{"ok":true}' }),
      headers: { 'content-type': 'application/json' },
    }),
    pathname: '/public-tools/format-json',
  });
  const body = (await response.json()) as { ok: boolean; output: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.output, /"ok": true/);

  const textResponse = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/public-tools/text-utils', {
      method: 'POST',
      body: JSON.stringify({ source: 'PloyKit Text Tools', operation: 'slugify' }),
      headers: { 'content-type': 'application/json' },
    }),
    pathname: '/public-tools/text-utils',
  });
  const textBody = (await textResponse.json()) as {
    ok: boolean;
    output: string;
    stats: { words: number };
  };

  assert.equal(textResponse.status, 200);
  assert.equal(textBody.ok, true);
  assert.equal(textBody.output, 'ploykit-text-tools');
  assert.equal(textBody.stats.words, 3);
});

test('X10 demo modules expose page, API and action paths through the host runtime', async () => {
  const host = await getModuleHost();
  const session = createDemoHostSession();
  const demoPages = [
    ['cms-demo', '/cms-demo'],
    ['cms-demo', '/cms-demo/notes'],
    ['shop-demo', '/shop-demo'],
    ['shop-demo', '/shop-demo/billing'],
    ['capability-demo', '/capability-demo'],
    ['capability-demo', '/capability-demo/workflow'],
    ['ai-rag-demo', '/ai-rag-demo'],
  ] as const;

  for (const [moduleId, pathname] of demoPages) {
    const result = await host.resolvePageRoute({
      kind: 'dashboard',
      pathname,
      request: createHostRequest(`/dashboard${pathname}`),
      session,
    });
    assert.equal(result.ok, true, moduleId);
    if (result.ok) {
      assert.equal(result.page.moduleId, moduleId);
    }
  }

  const jobStatus = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/capability-demo/workflow/status'),
    pathname: '/capability-demo/workflow/status',
    session,
  });
  const billingStatus = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/shop-demo/billing/status'),
    pathname: '/shop-demo/billing/status',
    session,
  });
  const aiResponse = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/ai-rag-demo/ask', {
      method: 'POST',
      body: JSON.stringify({
        question: 'What is X10 proving?',
        source: 'X10 proves demo product modules and the developer platform.',
      }),
      headers: { 'content-type': 'application/json' },
    }),
    pathname: '/ai-rag-demo/ask',
    session,
  });
  assert.equal(jobStatus.status, 200);
  assert.equal(billingStatus.status, 200);
  assert.equal(aiResponse.status, 200);
  assert.equal(((await aiResponse.json()) as { ok: boolean }).ok, true);

  const publicToolAction = await host.executeAction<
    { source: string },
    { ok: boolean; output: string }
  >({
    moduleId: 'public-tools-demo',
    name: 'formatSample',
    input: { source: '{"guard":true}' },
    session,
  });
  const billingAction = await host.executeAction<unknown, { ok: boolean; upgrade?: string }>({
    moduleId: 'shop-demo',
    name: 'runPaidTool',
    session,
  });

  assert.equal(publicToolAction.ok, true);
  assert.match(publicToolAction.output, /"guard": true/);
  assert.equal(billingAction.ok, false);
  assert.equal(billingAction.upgrade, '/zh/dashboard/billing');

  const devConsole = await getAdminModuleDevConsoleView();
  assert.ok(devConsole.snapshot.modules.some((module) => module.id === 'cms-demo'));
  assert.ok(devConsole.snapshot.modules.some((module) => module.id === 'capability-demo'));
  assert.ok(devConsole.report.templates.some((template) => template.id === 'ai-rag'));
  assert.ok(devConsole.bundle.modules.some((module) => module.id === 'shop-demo'));

  const whiteLabelDetail = await getAdminModuleDetail('white-label-site-demo');
  assert.ok(whiteLabelDetail.contract?.risk.highRiskPermissions.some((permission) => permission.value === 'surface.override'));
  assert.ok(whiteLabelDetail.contract?.risk.presentationOverrides.includes('surface:host.page:site.home'));
  assert.equal(whiteLabelDetail.contract?.data.migrationMode, undefined);
});

test('R3 host sitemap includes public product pages and module aliases', async () => {
  const entries = await sitemap();
  const urls = entries.map((entry) => entry.url);

  assert.ok(urls.some((url) => url.endsWith('/zh/pricing')));
  assert.ok(urls.some((url) => url.endsWith('/zh/contact')));
  assert.ok(urls.some((url) => url.endsWith('/zh/docs')));
  assert.ok(urls.some((url) => url.endsWith('/en/pricing')));
  assert.ok(urls.some((url) => url.endsWith('/public-tools')));
  assert.ok(urls.some((url) => url.endsWith('/tools/json')));
  assert.ok(urls.some((url) => url.endsWith('/cms-demo')));
  assert.ok(urls.some((url) => url.endsWith('/blog')));
  assert.ok(urls.some((url) => url.endsWith('/shop-demo')));
  assert.ok(urls.some((url) => url.endsWith('/shop')));
});

test('R3 public navigation merges module site header and footer contributions', async () => {
  const navigation = await resolvePublicNavigation('zh');
  const englishNavigation = await resolvePublicNavigation('en');

  assert.ok(
    navigation.headerItems.some((item) => item.href === '/dashboard' && item.label === '工作台')
  );
  assert.ok(
    navigation.footerItems.some((item) => item.href === '/contact' && item.label === '支持')
  );
  assert.ok(
    englishNavigation.headerItems.some(
      (item) => item.href === '/dashboard' && item.label === 'Dashboard'
    )
  );
  assert.ok(
    englishNavigation.footerItems.some(
      (item) => item.href === '/contact' && item.label === 'Support'
    )
  );
});

test('X10 capability workflow writes runtime-store job result, webhook receipt and outbox', async () => {
  const session = createDemoHostSession();
  const run = await enqueueHostDemoJob(session, {
    moduleId: 'capability-demo',
    name: 'generate_report',
    input: { title: 'X10 workflow', content: 'Evidence path.' },
  });
  const drained = await drainHostWorker({ session, limit: 10 });
  const hostRuntime = await getHostRuntime();
  const storedRun = await hostRuntime.runtimeStore.store.getRun(run.id);

  assert.equal(storedRun?.status, 'succeeded');
  assert.equal(drained.failed, 0);
  assert.equal(drained.deadLettered, 0);

  const runDetail = await getAdminRunDetail(run.id);
  assert.ok(runDetail.deliveries.some((delivery) => delivery.kind === 'job' && delivery.runId === run.id));
  assert.ok(runDetail.artifacts.some((artifact) => artifact.runId === run.id));
  assert.ok(runDetail.outbox.some((record) => (record.payload as { runId?: string }).runId === run.id));

  const webhookResponse = await receiveModuleWebhook(
    createHostRequest('/api/module-webhooks/capability-demo/workflow/webhook', {
      method: 'POST',
      body: JSON.stringify({ source: 'x10-test' }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `x10-webhook-${Date.now()}`,
      },
    }),
    {
      params: Promise.resolve({ path: ['capability-demo', 'workflow', 'webhook'] }),
    }
  );
  const webhookBody = (await webhookResponse.json()) as {
    ok: boolean;
    receipt: { id: string; moduleId: string; status: string };
  };
  const receipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: 'demo-product',
    moduleId: 'capability-demo',
  });
  const outbox = await hostRuntime.runtimeStore.store.listOutbox({
    productId: 'demo-product',
    namePrefix: 'webhook:capability-demo:workflow',
  });

  assert.equal(webhookResponse.status, 200);
  assert.equal(webhookBody.ok, true);
  assert.equal(webhookBody.receipt.moduleId, 'capability-demo');
  assert.ok(receipts.some((receipt) => receipt.webhookName === 'workflow'));
  assert.ok(outbox.some((record) => record.moduleId === 'capability-demo'));

  const webhookDrain = await drainHostWorker({ session, limit: 10 });
  const processedReceipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: 'demo-product',
    moduleId: 'capability-demo',
    status: 'processed',
  });

  assert.equal(webhookDrain.failed, 0);
  assert.equal(webhookDrain.deadLettered, 0);
  assert.ok(webhookDrain.processed >= 1);
  assert.ok(processedReceipts.some((receipt) => receipt.id === webhookBody.receipt.id));

  const processedWebhookOutbox = webhookDrain.records.find((record) =>
    record.name.startsWith('webhook:capability-demo:workflow')
  );
  assert.ok(processedWebhookOutbox);
  const unrelatedReceipt = await hostRuntime.runtimeStore.store.createWebhookReceipt({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'capability-demo',
    webhookName: 'workflow',
    path: '/capability-demo/workflow/webhook',
    method: 'POST',
    idempotencyKey: `x10-unrelated-${Date.now()}`,
    bodyText: JSON.stringify({ source: 'unrelated-detail-check' }),
  });
  const outboxDetail = await getAdminOutboxDetail(processedWebhookOutbox.id);
  assert.equal(outboxDetail.receipts.some((receipt) => receipt.id === webhookBody.receipt.id), true);
  assert.equal(outboxDetail.receipts.some((receipt) => receipt.id === unrelatedReceipt.id), false);
  assert.ok(outboxDetail.deliveries.some((delivery) => delivery.outboxId === processedWebhookOutbox.id));

  const replay = await retryAdminWebhookReceipt(
    { user: { id: 'demo-admin', role: 'admin' as const }, actorId: 'demo-admin' },
    webhookBody.receipt.id,
    'web-shell receipt replay'
  );
  const replayOutbox = await hostRuntime.runtimeStore.store.listOutbox({
    productId: 'demo-product',
    namePrefix: 'webhook:capability-demo:workflow',
  });

  assert.equal(replay.receipt.status, 'received');
  assert.ok(replayOutbox.some((record) => record.id === replay.outbox.id));
  assert.equal((replay.outbox.payload as { bodyDigest?: string }).bodyDigest, webhookBody.receipt.id ? outboxDetail.receipts[0]?.bodyDigest : undefined);
});

test('K4 module webhook route enforces signed secret readiness and body limits', async () => {
  const secretKeys = [
    'PLOYKIT_MODULE_WEBHOOK_SECRET',
    'PLOYKIT_MODULE_WEBHOOK_SECRET_CAPABILITY_DEMO',
    'PLOYKIT_MODULE_WEBHOOK_SECRET_CAPABILITY_DEMO_INGEST',
  ];
  const previous = new Map(secretKeys.map((key) => [key, process.env[key]]));
  const body = JSON.stringify({ source: 'signed-route-test' });
  const idempotencyKey = `signed-route-${Date.now()}`;

  try {
    for (const key of secretKeys) {
      delete process.env[key];
    }
    const missingSecret = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/capability-demo/webhook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-ploykit-signature': 'sha256=invalid',
        },
      }),
      {
        params: Promise.resolve({ path: ['capability-demo', 'webhook'] }),
      }
    );

    process.env.PLOYKIT_MODULE_WEBHOOK_SECRET_CAPABILITY_DEMO_INGEST = 'cap-secret';
    const signature = `sha256=${createHmac('sha256', 'cap-secret').update(body).digest('hex')}`;
    const accepted = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/capability-demo/webhook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-ploykit-signature': signature,
        },
      }),
      {
        params: Promise.resolve({ path: ['capability-demo', 'webhook'] }),
      }
    );
    const githubHeaderBody = JSON.stringify({ source: 'github-header-test' });
    const githubHeaderSignature = `sha256=${createHmac('sha256', 'cap-secret')
      .update(githubHeaderBody)
      .digest('hex')}`;
    const acceptedGithubHeader = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/capability-demo/webhook', {
        method: 'POST',
        body: githubHeaderBody,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `${idempotencyKey}-github`,
          'x-hub-signature-256': githubHeaderSignature,
        },
      }),
      {
        params: Promise.resolve({ path: ['capability-demo', 'webhook'] }),
      }
    );
    const tooLarge = await receiveModuleWebhook(
      createHostRequest('/api/module-webhooks/capability-demo/workflow/webhook', {
        method: 'POST',
        body: '{}',
        headers: {
          'content-type': 'application/json',
          'content-length': String(1024 * 1024 + 1),
        },
      }),
      {
        params: Promise.resolve({ path: ['capability-demo', 'workflow', 'webhook'] }),
      }
    );

    assert.equal(missingSecret.status, 401);
    assert.equal(accepted.status, 200);
    assert.equal(acceptedGithubHeader.status, 200);
    assert.equal(tooLarge.status, 413);
    assert.equal(((await accepted.json()) as { receipt: { status: string } }).receipt.status, 'received');
    assert.equal(
      ((await acceptedGithubHeader.json()) as { receipt: { status: string } }).receipt.status,
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

test('M2 host auth adapter resolves seeded admin sessions from the auth cookie', async () => {
  const user = await authenticateHostUser('admin@example.com', 'Admin@123456');
  assert.ok(user);

  const cookie = createHostSessionCookie(user.id);
  const session = await resolveHostSessionFromCookieHeader(cookie);

  assert.equal(session.user?.id, 'demo-admin');
  assert.equal(session.user?.role, 'admin');
  assert.equal(session.productId, 'demo-product');
  assert.equal(session.workspaceId, 'demo-workspace');
});

test('M2 host auth adapter returns anonymous sessions without a valid cookie', async () => {
  const session = await resolveHostSessionFromCookieHeader(null);

  assert.equal(session.user, null);
});

test('M2 host auth adapter rejects unsigned or tampered session cookies', async () => {
  const validCookiePair = createHostSessionCookie('demo-admin').split(';')[0]!;
  const tamperedCookiePair = validCookiePair.replace(
    /.$/,
    validCookiePair.endsWith('a') ? 'b' : 'a'
  );
  const unsigned = await resolveHostSessionFromCookieHeader(`${HOST_AUTH_COOKIE}=demo-admin`);
  const tampered = await resolveHostSessionFromCookieHeader(tamperedCookiePair);

  assert.equal(unsigned.user, null);
  assert.equal(tampered.user, null);
});

test('K2 host identity seed stores users, roles and password hashes in runtime store', async () => {
  const store = createInMemoryRuntimeStore();
  await ensureHostIdentitySeeded(store);
  const admin = await store.findHostUserByEmail('admin@example.com');
  const users = await store.listHostUsers({ productId: 'demo-product' });
  const memberships = await store.listMemberships({ productId: 'demo-product' });

  assert.equal(admin?.id, 'demo-admin');
  assert.equal(admin?.role, 'admin');
  assert.equal(admin?.status, 'active');
  assert.equal(verifyHostPassword('Admin@123456', admin?.passwordHash ?? ''), true);
  assert.equal(users.length, 2);
  assert.ok(memberships.some((membership) => membership.userId === 'demo-admin'));
});

test('K2 host identity status disables session resolution', async () => {
  const hash = createHostPasswordHash('Temp@123456', 'temp-seed');
  assert.equal(verifyHostPassword('Temp@123456', hash), true);
  assert.equal(verifyHostPassword('wrong', hash), false);

  const store = createInMemoryRuntimeStore();
  await store.upsertHostUser({
    id: 'blocked-user',
    email: 'blocked@example.com',
    passwordHash: hash,
    role: 'user',
    status: 'active',
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    workspaceRole: 'viewer',
    metadata: {},
  });
  await store.updateHostUserStatus('blocked-user', 'suspended', { reason: 'test' });
  const blocked = await store.findHostUserByEmail('blocked@example.com');

  assert.equal(blocked?.status, 'suspended');
});

test('X3 auth login redirects with the browser host so host-only cookies survive', async () => {
  resetHostSecurityRateLimiter();
  const response = await loginUserApi(
    new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        referer: 'http://127.0.0.1:3000/zh/login',
      },
      body: new URLSearchParams({
        email: 'admin@example.com',
        password: 'Admin@123456',
        next: '/zh/dashboard',
      }),
    })
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'http://127.0.0.1:3000/zh/dashboard');
  assert.match(response.headers.get('set-cookie') ?? '', /ploykit_session=/);
});

test('K1 host session bridge exposes request-cookie resolution source', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const resolved = await resolveHostRequestSession(
    createHostRequest('/api/auth/session', {
      headers: { cookie },
    })
  );

  assert.equal(resolved.source, 'request-cookie');
  assert.equal(resolved.session.user?.id, 'demo-admin');
});

test('X2 host user APIs expose profile, role and guarded password operations', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const profileResponse = await getUserProfile(
    createHostRequest('/api/user/profile', { headers: { cookie } })
  );
  const profileBody = (await profileResponse.json()) as {
    ok: boolean;
    data: { profile: { email: string } };
  };

  assert.equal(profileResponse.status, 200);
  assert.equal(profileBody.ok, true);
  assert.equal(profileBody.data.profile.email, 'admin@example.com');

  const patchedResponse = await patchUserProfile(
    createHostRequest('/api/user/profile', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Demo Admin', timezone: 'Asia/Hong_Kong' }),
    })
  );
  const patchedBody = (await patchedResponse.json()) as {
    ok: boolean;
    data: { profile: { displayName?: string; timezone?: string } };
  };

  assert.equal(patchedResponse.status, 200);
  assert.equal(patchedBody.data.profile.displayName, 'Demo Admin');
  assert.equal(patchedBody.data.profile.timezone, 'Asia/Hong_Kong');

  const roleResponse = await getUserRole(
    createHostRequest('/api/user/role', { headers: { cookie } })
  );
  const roleBody = (await roleResponse.json()) as {
    ok: boolean;
    data: { role: { role: string; workspaceRole: string } };
  };

  assert.equal(roleResponse.status, 200);
  assert.equal(roleBody.data.role.role, 'admin');
  assert.equal(roleBody.data.role.workspaceRole, 'owner');

  const badPasswordResponse = await changeUserPassword(
    createHostRequest('/api/user/profile/password', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'NewPass@123' }),
    })
  );

  assert.equal(badPasswordResponse.status, 400);

  const runtimeStore = await getHostRuntimeStore();
  const passwordUser = await runtimeStore.store.upsertHostUser({
    id: `password-user-${Date.now()}`,
    email: `password-user-${Date.now()}@example.com`,
    passwordHash: createHostPasswordHash('Current@123'),
    role: 'user',
    status: 'active',
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: 'demo-workspace',
    workspaceRole: 'editor',
    permissions: [],
    metadata: {},
  });
  const adapter = await getHostAuthAdapter();
  const otherSession = await adapter.createSession(passwordUser, { userAgent: 'other' });
  const passwordUserWithOtherSession = await runtimeStore.store.getHostUser(passwordUser.id);
  assert.ok(passwordUserWithOtherSession);
  const currentSession = await adapter.createSession(passwordUserWithOtherSession, {
    userAgent: 'current',
  });
  const passwordChangeResponse = await changeUserPassword(
    createHostRequest('/api/user/profile/password', {
      method: 'POST',
      headers: {
        cookie: currentSession.cookie.split(';')[0]!,
        'content-type': 'application/json',
        origin: sameOriginHeader(),
      },
      body: JSON.stringify({ currentPassword: 'Current@123', newPassword: 'Changed@123' }),
    })
  );
  assert.equal(passwordChangeResponse.status, 200);
  assert.equal((await adapter.resolveSession(currentSession.cookie)).user?.id, passwordUser.id);
  assert.equal((await adapter.resolveSession(otherSession.cookie)).user, null);
});

test('X2 scope, notification, billing and admin APIs run through route handlers', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const scopeResponse = await getCurrentProductScope(
    createHostRequest('/api/product-scope/current', { headers: { cookie } })
  );
  const scopeBody = (await scopeResponse.json()) as {
    ok: boolean;
    data: { scope: { workspace: { id: string } | null } };
  };

  assert.equal(scopeResponse.status, 200);
  assert.equal(scopeBody.data.scope.workspace?.id, 'demo-workspace');

  const unreadResponse = await getNotificationsUnread(
    createHostRequest('/api/notifications/unread', { headers: { cookie } })
  );
  const unreadBody = (await unreadResponse.json()) as {
    ok: boolean;
    data: { unread: number };
  };
  assert.equal(unreadResponse.status, 200);
  assert.ok(unreadBody.data.unread >= 0);

  const readAllResponse = await markNotificationsReadAll(
    createHostRequest('/api/notifications/read-all', {
      method: 'POST',
      headers: { cookie },
    })
  );
  assert.equal(readAllResponse.status, 200);

  const ordersResponse = await getBillingOrders(
    createHostRequest('/api/billing/orders', { headers: { cookie } })
  );
  const ordersBody = (await ordersResponse.json()) as {
    ok: boolean;
    data: { orders: { sku: string }[] };
  };
  assert.equal(ordersResponse.status, 200);
  assert.ok(ordersBody.data.orders.some((order) => order.sku === 'demo-pro-monthly'));

  const searchRequestId = `web-shell-search-${Date.now()}`;
  const searchResponse = await searchAdminApi(
    createHostRequest('/api/admin/search?q=demo', {
      headers: { cookie, 'x-request-id': searchRequestId },
    })
  );
  const searchBody = (await searchResponse.json()) as {
    ok: boolean;
    data: {
      items: {
        type: string;
        capabilityRequired?: string;
        risk?: string;
        status?: string;
      }[];
      page: { total: number; limit: number; offset: number };
    };
  };
  assert.equal(searchResponse.status, 200);
  assert.ok(searchBody.data.items.length > 0);
  assert.ok(searchBody.data.items.every((item) => item.capabilityRequired));
  assert.ok(searchBody.data.items.every((item) => item.risk));
  assert.equal(searchBody.data.page.offset, 0);

  const pagedSearchResponse = await searchAdminApi(
    createHostRequest('/api/admin/search?q=demo&limit=1&offset=1', {
      headers: { cookie, 'x-request-id': `${searchRequestId}-page` },
    })
  );
  const pagedSearchBody = (await pagedSearchResponse.json()) as {
    ok: boolean;
    data: {
      items: { type: string; capabilityRequired?: string; risk?: string }[];
      page: { total: number; limit: number; offset: number };
    };
  };
  assert.equal(pagedSearchResponse.status, 200);
  assert.equal(pagedSearchBody.data.items.length, 1);
  assert.equal(pagedSearchBody.data.page.limit, 1);
  assert.equal(pagedSearchBody.data.page.offset, 1);
  assert.ok(pagedSearchBody.data.page.total > 1);

  const discoverySearchResponse = await searchAdminApi(
    createHostRequest('/api/admin/search', {
      headers: { cookie, 'x-request-id': `${searchRequestId}-empty` },
    })
  );
  const discoverySearchBody = (await discoverySearchResponse.json()) as {
    ok: boolean;
    data: {
      items: unknown[];
      page: { total: number };
    };
  };
  assert.equal(discoverySearchResponse.status, 200);
  assert.equal(discoverySearchBody.data.items.length, 0);
  assert.equal(discoverySearchBody.data.page.total, 0);

  const hostRuntime = await getHostRuntime();
  const searchAudit = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    type: 'admin.search.queried',
  });
  const searchAuditRecord = searchAudit.find((record) => record.metadata.requestId === searchRequestId);
  assert.ok(searchAuditRecord);
  assert.equal(searchAuditRecord.metadata.q, undefined);
  assert.equal(searchAuditRecord.metadata.qLength, 4);
  assert.match(String(searchAuditRecord.metadata.qHash), /^sha256:[a-f0-9]{64}$/);
  assert.equal(searchAuditRecord.metadata.resultCount, searchBody.data.items.length);
  assert.equal(searchAuditRecord.metadata.total, searchBody.data.page.total);

  const providersResponse = await getAdminProvidersApi(
    createHostRequest('/api/admin/providers', { headers: { cookie } })
  );
  const providersBody = (await providersResponse.json()) as {
    ok: boolean;
    data: {
      providerStatus: {
        providersTotal: number;
        providers: { id: string; status: string; evidenceStatus: string }[];
      };
    };
  };
  assert.equal(providersResponse.status, 200);
  assert.ok(providersBody.data.providerStatus.providersTotal >= 5);
  assert.ok(
    providersBody.data.providerStatus.providers.some((provider) => provider.id === 'files')
  );

  const providerAuditResponse = await recordAdminProvidersAuditApi(
    createHostRequest('/api/admin/providers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'web-shell provider diagnostics audit' }),
    })
  );
  const providerAuditBody = (await providerAuditResponse.json()) as {
    ok: boolean;
    data: {
      auditId: string;
      providerStatus: { providersTotal: number; providers: { failureDetails: unknown[] }[] };
    };
  };
  assert.equal(providerAuditResponse.status, 200);
  assert.match(providerAuditBody.data.auditId, /^audit_/);
  assert.equal(
    providerAuditBody.data.providerStatus.providersTotal,
    providersBody.data.providerStatus.providersTotal
  );

  const workersResponse = await getAdminWorkersApi(
    createHostRequest('/api/admin/workers', { headers: { cookie } })
  );
  const workersBody = (await workersResponse.json()) as {
    ok: boolean;
    data: {
      workerStatus: {
        workerId: string;
        queue: { queued: number; deadLettered: number };
        soak: { status: string };
      };
    };
  };
  assert.equal(workersResponse.status, 200);
  assert.ok(workersBody.data.workerStatus.workerId.length > 0);
  assert.ok(workersBody.data.workerStatus.queue.queued >= 0);
});

test('X6 admin entitlement API can override entitlement status with audit', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const grant = await hostRuntime.runtimeStore.store.grantEntitlement({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    entitlement: `override.demo.${Date.now()}`,
    planId: 'demo-pro',
    source: 'test',
    idempotencyKey: `override-demo-${Date.now()}`,
  });

  const response = await patchAdminEntitlements(
    createHostRequest('/api/admin/entitlements', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'override',
        entitlementId: grant.id,
        status: 'expired',
        reason: 'test override',
      }),
    })
  );
  const body = (await response.json()) as {
    ok: boolean;
    data: { grant: { id: string; status: string; metadata: Record<string, unknown> } };
  };
  const audit = await hostRuntime.runtimeStore.store.listAudit({
    productId: 'demo-product',
    type: 'commercial.entitlement.overridden',
  });

  assert.equal(response.status, 200);
  assert.equal(body.data.grant.id, grant.id);
  assert.equal(body.data.grant.status, 'expired');
  assert.equal(body.data.grant.metadata.overrideReason, 'test override');
  assert.ok(audit.some((record) => record.metadata.entitlementId === grant.id));
});

test('A8 admin entitlement views normalize expiry and paginate the ledger', async () => {
  const hostRuntime = await getHostRuntime();
  const suffix = `${Date.now()}`;
  const planId = `demo-plan-${suffix}`;
  const entitlementBase = `pagination.demo.${suffix}`;

  await hostRuntime.runtimeStore.store.grantEntitlement({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    entitlement: `${entitlementBase}.active`,
    planId,
    source: 'test',
    idempotencyKey: `pagination-active-${suffix}`,
  });
  await hostRuntime.runtimeStore.store.grantEntitlement({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    entitlement: `${entitlementBase}.expired`,
    planId,
    source: 'test',
    expiresAt: '2000-01-01T00:00:00.000Z',
    idempotencyKey: `pagination-expired-${suffix}`,
  });

  const commercial = await getAdminCommercialView();
  const activeGrant = commercial.entitlements.find((grant) => grant.entitlement === `${entitlementBase}.active`);
  const expiredGrant = commercial.entitlements.find((grant) => grant.entitlement === `${entitlementBase}.expired`);
  assert.equal(activeGrant?.status, 'active');
  assert.equal(expiredGrant?.status, 'expired');
  assert.equal(commercial.planSubscribers[planId], 1);

  const paged = await listAdminEntitlements({ q: entitlementBase, limit: 1, offset: 1 });
  assert.equal(paged.page.total, 2);
  assert.equal(paged.page.limit, 1);
  assert.equal(paged.page.offset, 1);
  assert.equal(paged.items.length, 1);
  assert.equal(paged.statusCounts.active, 1);
  assert.equal(paged.statusCounts.expired, 1);
  assert.equal(paged.statusCounts.revoked, 0);

  const snapshot = await getUserSaasSnapshot(createDemoHostSession());
  const snapshotGrant = snapshot.entitlements.find((item) => item.entitlement === `${entitlementBase}.expired`);
  assert.equal(snapshotGrant?.status, 'expired');
});

test('A8 admin commercial view redacts commercial secret metadata', async () => {
  const hostRuntime = await getHostRuntime();
  const suffix = `${Date.now()}`;
  const codeHash = `redeem_code_hash_${suffix}`;

  await hostRuntime.runtimeStore.store.upsertRedeemCode({
    productId: 'demo-product',
    code: codeHash,
    entitlement: `redaction.demo.${suffix}`,
    creditsUnit: 'credit',
    maxRedemptions: 1,
    metadata: {
      batchId: `redaction-${suffix}`,
      rawCode: 'PLAIN-REDEEM-CODE',
      codeHash,
      bind: { email: 'buyer@example.com' },
      contactHash: 'contact-hash',
      contactMasked: 'b***@example.com',
    },
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: 'demo-product',
    type: 'commercial.redeem_code.attempt',
    metadata: {
      codeHash,
      ok: false,
      reason: 'email_binding_mismatch',
      subject: { type: 'user', id: 'demo-admin' },
      email: 'buyer@example.com',
      contactHash: 'contact-hash',
      contactMasked: 'b***@example.com',
    },
  });
  await hostRuntime.runtimeStore.store.createApiKey({
    id: `api_key_redaction_${suffix}`,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'public-tools-demo',
    name: 'Redaction key',
    prefix: `pk_redact_${suffix}`.slice(0, 24),
    keyHash: 'stored-key-hash',
    ownerSubjectType: 'workspace',
    ownerSubjectId: 'demo-workspace',
    metadata: {
      apiKey: 'pk_live_secret',
      ownerEmail: 'owner@example.com',
      publicLabel: 'keep me',
    },
  });

  const commercial = await getAdminCommercialView();
  const code = commercial.redeemCodes.find((record) => record.codeHashPrefix === codeHash.slice(0, 12));
  const attempt = commercial.redeemAttempts.find(
    (record) => record.codeHashPrefix === codeHash.slice(0, 12)
  );
  const apiKey = commercial.apiKeys.find((record) => record.id === `api_key_redaction_${suffix}`);

  assert.equal(code?.metadata.rawCode, '[REDACTED]');
  assert.equal(code?.metadata.codeHash, '[REDACTED]');
  assert.equal((code?.metadata.bind as Record<string, unknown> | undefined)?.email, '[REDACTED]');
  assert.equal(code?.metadata.contactHash, '[REDACTED]');
  assert.equal(code?.metadata.contactMasked, 'b***@example.com');
  assert.equal(attempt?.metadata.codeHash, '[REDACTED]');
  assert.equal(attempt?.metadata.email, '[REDACTED]');
  assert.equal(attempt?.metadata.contactHash, '[REDACTED]');
  assert.equal(apiKey?.metadata.apiKey, '[REDACTED]');
  assert.equal(apiKey?.metadata.ownerEmail, '[REDACTED]');
  assert.equal(apiKey?.metadata.publicLabel, 'keep me');
  assert.equal(apiKey ? 'keyHash' in apiKey : true, false);
});

test('X9 notifications are store-backed, readable and honor preferences', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const sku = `x9-muted-${Date.now()}`;
  const previousEmailProvider = process.env.PLOYKIT_EMAIL_PROVIDER;
  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };
  process.env.PLOYKIT_EMAIL_PROVIDER = 'log';

  try {
    const disabledResponse = await updateNotificationPreferences(
      createHostRequest('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ billing: false }),
      })
    );
    assert.equal(disabledResponse.status, 200);

    const order = await hostRuntime.runtimeStore.store.createCommercialOrder({
      productId: 'demo-product',
      workspaceId: 'demo-workspace',
      userId: 'demo-admin',
      sku,
      amount: 0,
      currency: 'USD',
      provider: 'local',
      idempotencyKey: sku,
    });
    await hostRuntime.runtimeStore.store.updateCommercialOrderStatus(order.id, 'paid');

    const mutedHistoryResponse = await getNotificationsHistory(
      createHostRequest('/api/notifications/history', { headers: { cookie } })
    );
    const mutedHistory = (await mutedHistoryResponse.json()) as {
      ok: boolean;
      data: { notifications: { id: string; title: string; status: string }[] };
    };
    const skippedDeliveries = await hostRuntime.runtimeStore.store.listNotificationDeliveries({
      productId: 'demo-product',
      userId: 'demo-admin',
      status: 'skipped',
    });
    assert.equal(mutedHistoryResponse.status, 200);
    assert.equal(
      mutedHistory.data.notifications.some((item) => item.title.includes(sku)),
      false
    );
    assert.ok(skippedDeliveries.some((item) => item.reason === 'disabled_by_preferences'));

    const enabledResponse = await updateNotificationPreferences(
      createHostRequest('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ billing: true, email: true }),
      })
    );
    assert.equal(enabledResponse.status, 200);

    const run = await hostRuntime.runtimeStore.store.createRun({
      productId: 'demo-product',
      workspaceId: 'demo-workspace',
      moduleId: 'public-tools-demo',
      kind: 'manual',
      name: 'x9-notification-task',
      idempotencyKey: `x9-notification-task:${Date.now()}`,
    });
    await hostRuntime.runtimeStore.store.updateRunStatus(run.id, 'succeeded', { progress: 100 });

    const historyResponse = await getNotificationsHistory(
      createHostRequest('/api/notifications/history', { headers: { cookie } })
    );
    const history = (await historyResponse.json()) as {
      ok: boolean;
      data: { notifications: { id: string; runId?: string; status: string }[] };
    };
    const taskNotification = history.data.notifications.find((item) => item.runId === run.id);
    assert.ok(taskNotification);

    const emailDeliveries = await hostRuntime.runtimeStore.store.listNotificationDeliveries({
      productId: 'demo-product',
      userId: 'demo-admin',
      provider: 'email-log',
    });
    assert.ok(emailDeliveries.some((item) => item.notificationId === taskNotification.id));

    const readResponse = await markNotificationRead(
      createHostRequest(`/api/notifications/${taskNotification.id}/read`, {
        method: 'POST',
        headers: { cookie },
      }),
      { params: Promise.resolve({ notificationId: taskNotification.id }) }
    );
    const readBody = (await readResponse.json()) as {
      ok: boolean;
      data: { notification: { status: string } };
    };
    assert.equal(readResponse.status, 200);
    assert.equal(readBody.data.notification.status, 'read');
  } finally {
    restoreEnv('PLOYKIT_EMAIL_PROVIDER', previousEmailProvider);
  }
});

test('X9 host email provider supports signed webhook adapter contract', async () => {
  const status = getHostEmailProviderStatus({
    PLOYKIT_EMAIL_PROVIDER: 'webhook',
    PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/send',
    PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
  });
  assert.equal(status.mode, 'webhook');
  assert.equal(status.webhookConfigured, true);
  assert.equal(status.webhookSecretConfigured, true);

  let requestBody = '';
  let signature = '';
  const correlationId = `email-webhook-success-${Date.now()}`;
  const result = await sendHostEmail(
    {
      to: 'user@example.com',
      subject: 'Welcome',
      text: 'Hello from PloyKit',
      metadata: { notificationId: 'notification-1' },
      correlationId,
    },
    {
      env: {
        PLOYKIT_EMAIL_PROVIDER: 'webhook',
        PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/send',
        PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
      },
      fetch: async (_input, init) => {
        requestBody = String(init?.body ?? '');
        signature = String((init?.headers as Record<string, string>)['x-ploykit-email-signature']);
        return new Response('{}', {
          status: 202,
          headers: { 'x-ploykit-provider-ref': 'msg_1' },
        });
      },
    }
  );
  const hostRuntime = await getHostRuntime();
  const invocations = await hostRuntime.runtimeStore.store.listProviderInvocations({
    productId: DEFAULT_HOST_PRODUCT_ID,
    providerId: 'email-webhook',
    kind: 'email',
    operation: 'send',
  });

  assert.equal(result.status, 'delivered');
  assert.equal(result.provider, 'email-webhook');
  assert.equal(result.providerRef, 'msg_1');
  assert.match(requestBody, /user@example.com/);
  assert.equal(signature.length, 64);
  assert.ok(
    invocations.some(
      (record) =>
        record.correlationId === correlationId &&
        record.status === 'succeeded' &&
        record.metadata.providerRef === 'msg_1'
    )
  );
});

test('K7 host email webhook retries retryable failures and records attempts', async () => {
  let attempts = 0;
  const result = await sendHostEmail(
    {
      to: 'retry@example.com',
      subject: 'Retry',
      text: 'Retry delivery',
    },
    {
      env: {
        PLOYKIT_EMAIL_PROVIDER: 'webhook',
        PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/retry',
        PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
        PLOYKIT_EMAIL_RETRY_ATTEMPTS: '2',
        PLOYKIT_EMAIL_RETRY_BACKOFF_MS: '0',
      },
      fetch: async () => {
        attempts += 1;
        return new Response('{}', {
          status: attempts === 1 ? 503 : 202,
          headers: attempts === 2 ? { 'x-ploykit-provider-ref': 'msg_retry' } : undefined,
        });
      },
    }
  );
  const metadata = result.metadata as { attempts?: number } | undefined;

  assert.equal(attempts, 2);
  assert.equal(result.status, 'delivered');
  assert.equal(result.providerRef, 'msg_retry');
  assert.equal(metadata?.attempts, 2);
});

test('K7 host email webhook failures are visible in provider invocation evidence', async () => {
  const correlationId = `email-webhook-failure-${Date.now()}`;
  const result = await sendHostEmail(
    {
      to: 'failure@example.com',
      subject: 'Failure',
      text: 'Failure delivery',
      correlationId,
    },
    {
      env: {
        PLOYKIT_EMAIL_PROVIDER: 'webhook',
        PLOYKIT_EMAIL_WEBHOOK_URL: 'https://mail.example/failure',
        PLOYKIT_EMAIL_WEBHOOK_SECRET: 'secret',
        PLOYKIT_EMAIL_RETRY_ATTEMPTS: '1',
        PLOYKIT_EMAIL_RETRY_BACKOFF_MS: '0',
      },
      fetch: async () => new Response('{}', { status: 503 }),
    }
  );
  const hostRuntime = await getHostRuntime();
  const invocations = await hostRuntime.runtimeStore.store.listProviderInvocations({
    productId: DEFAULT_HOST_PRODUCT_ID,
    providerId: 'email-webhook',
    kind: 'email',
    operation: 'send',
    status: 'failed',
  });
  const invocation = invocations.find((record) => record.correlationId === correlationId);

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'webhook_status_503');
  assert.equal(invocation?.error?.code, 'webhook_status_503');
  assert.equal(invocation?.metadata.deliveryStatus, 'failed');
});

test('P6 host email outbox worker sends queued email and records delivery ledger', async () => {
  const hostRuntime = await getHostRuntime();
  const emailId = `email-outbox-${Date.now()}`;
  const queued = await enqueueHostEmail(
    {
      to: 'queued@example.com',
      subject: 'Queued delivery',
      text: 'Queued email body',
      emailId,
      correlationId: `corr-${emailId}`,
    },
    {
      idempotencyKey: emailId,
      maxAttempts: 2,
    }
  );
  const result = await drainHostEmailOutbox({
    leaseOwner: 'email-worker-test',
    env: {
      PLOYKIT_EMAIL_PROVIDER: 'log',
    },
  });
  const deliveries = await hostRuntime.runtimeStore.store.listDeliveries({
    productId: DEFAULT_HOST_PRODUCT_ID,
    kind: 'email',
    emailId,
  });

  assert.equal(result.processed, 1);
  assert.equal(result.records[0]?.id, queued.id);
  assert.equal(result.records[0]?.status, 'processed');
  assert.equal(deliveries.some((delivery) => delivery.outboxId === queued.id), true);
  assert.equal(deliveries[0]?.status, 'delivered');
});

test('X9 auth transactional routes use the host email provider contract', async () => {
  const previousProvider = process.env.PLOYKIT_EMAIL_PROVIDER;
  const previousWebhookUrl = process.env.PLOYKIT_EMAIL_WEBHOOK_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAuthSecret = process.env.PLOYKIT_AUTH_SECRET;
  const previousFetch = globalThis.fetch;
  const sentSubjects: string[] = [];
  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  process.env.PLOYKIT_EMAIL_PROVIDER = 'webhook';
  process.env.PLOYKIT_EMAIL_WEBHOOK_URL = 'https://mail.example/send';
  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { subject?: string };
    sentSubjects.push(payload.subject ?? '');
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  try {
    const email = `route-email-${Date.now()}@example.com`;
    const registerResponse = await registerUserApi(
      createHostRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'RouteEmail@123', displayName: 'Route Email' }),
      })
    );
    assert.equal(registerResponse.status, 200);

    const resetResponse = await requestPasswordResetApi(
      createHostRequest('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );
    assert.equal(resetResponse.status, 200);
    assert.deepEqual(sentSubjects, ['Verify your PloyKit account', 'Reset your PloyKit password']);

    restoreEnv('NODE_ENV', 'production');
    restoreEnv('PLOYKIT_AUTH_SECRET', 'test-production-auth-secret');
    const productionResetResponse = await requestPasswordResetApi(
      createHostRequest('/api/auth/password-reset/request', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: sameOriginHeader(),
        },
        body: JSON.stringify({ email: 'admin@example.com' }),
      })
    );
    const productionResetBody = (await productionResetResponse.json()) as {
      ok: boolean;
      data: { sent: boolean; resetToken?: string };
    };
    assert.equal(productionResetResponse.status, 200);
    assert.equal(productionResetBody.data.sent, true);
    assert.equal('resetToken' in productionResetBody.data, false);
    assert.deepEqual(sentSubjects, [
      'Verify your PloyKit account',
      'Reset your PloyKit password',
      'Reset your PloyKit password',
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('PLOYKIT_AUTH_SECRET', previousAuthSecret);
    restoreEnv('PLOYKIT_EMAIL_PROVIDER', previousProvider);
    restoreEnv('PLOYKIT_EMAIL_WEBHOOK_URL', previousWebhookUrl);
  }
});

test('X3 host auth adapter supports registration, verification, sessions and reset', async () => {
  const store = createInMemoryRuntimeStore();
  await ensureHostIdentitySeeded(store);
  const adapter = createRuntimeStoreHostAuthAdapter(store);
  const registered = await adapter.register({
    email: 'new-user@example.com',
    password: 'NewUser@123',
    displayName: 'New User',
  });

  assert.equal(registered.user.status, 'pending-verification');
  assert.equal(await adapter.authenticate('new-user@example.com', 'NewUser@123'), null);

  const verified = await adapter.verifyEmail(registered.emailVerificationToken);
  assert.equal(verified.status, 'active');
  const authenticated = await adapter.authenticate('new-user@example.com', 'NewUser@123');
  assert.ok(authenticated);

  const createdSession = await adapter.createSession(authenticated);
  const resolved = await adapter.resolveSession(createdSession.cookie);
  assert.equal(resolved.user?.id, authenticated.id);
  assert.equal((await adapter.listSessions(authenticated.id)).length, 1);

  await adapter.revokeSession(authenticated.id, createdSession.session.id);
  const revoked = await adapter.resolveSession(createdSession.cookie);
  assert.equal(revoked.user, null);

  const reset = await adapter.requestPasswordReset('new-user@example.com');
  assert.equal(reset.sent, true);
  assert.ok(reset.resetToken);
  await adapter.resetPassword(reset.resetToken, 'Changed@123');
  assert.equal(await adapter.authenticate('new-user@example.com', 'NewUser@123'), null);
  assert.ok(await adapter.authenticate('new-user@example.com', 'Changed@123'));
});

test('X3 signed session cookie falls back when memory store has no session table entry', async () => {
  const store = createInMemoryRuntimeStore();
  await ensureHostIdentitySeeded(store);
  const adapter = createRuntimeStoreHostAuthAdapter(store);
  const cookie = createHostSessionCookieForSession('demo-admin', 'external-session').split(';')[0]!;

  const resolved = await adapter.resolveSession(cookie);
  assert.equal(resolved.user?.id, 'demo-admin');
});

test('X3 admin APIs reject non-admin sessions through capability guard', async () => {
  const userCookie = createHostSessionCookie('demo-user').split(';')[0]!;
  const response = await searchAdminApi(
    createHostRequest('/api/admin/search?q=demo', { headers: { cookie: userCookie } })
  );

  assert.equal(response.status, 403);
});

test('R2 admin audit API exports protected CSV evidence', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const bulkType = `admin.audit.bulk.${Date.now().toString(36)}`;
  for (let index = 0; index < 15; index += 1) {
    await hostRuntime.runtimeStore.store.recordAudit({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: 'demo-workspace',
      moduleId: 'web-shell',
      actorId: 'demo-admin',
      type: `${bulkType}.${index}`,
      metadata: {
        bulkIndex: index,
        email: 'bulk@example.com',
        bodyText: '{"raw":true}',
        payload: { unsafe: true },
      },
    });
  }
  const response = await getAdminAuditApi(
    createHostRequest(`/api/admin/audit?format=csv&limit=20&q=${bulkType}&type=${bulkType}`, {
      headers: { cookie },
    })
  );
  const body = await response.text();
  const jsonExport = await getAdminAuditApi(
    createHostRequest(`/api/admin/audit?format=json&limit=20&q=${bulkType}&type=${bulkType}`, {
      headers: { cookie },
    })
  );
  const exportBody = (await jsonExport.json()) as {
    items: Array<{
      type: string;
      metadata: Record<string, unknown>;
      integrity?: { recordHash?: string };
    }>;
    page: { total: number };
  };
  const auditAfter = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    type: 'admin.audit.exported',
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(body, /^id,type,actorId,productId,workspaceId,moduleId,createdAt,metadata/);
  assert.match(body, /recordHash/);
  assert.equal(body.includes('bulk@example.com'), false);
  assert.equal(jsonExport.status, 200);
  assert.equal(exportBody.items.length, 15);
  assert.equal(exportBody.page.total, 15);
  assert.ok(exportBody.items.every((item) => item.type.startsWith(bulkType)));
  assert.ok(exportBody.items.every((item) => item.metadata.email === '[REDACTED]'));
  assert.ok(exportBody.items.every((item) => item.metadata.bodyText === '[REDACTED]'));
  assert.match(exportBody.items[0]?.integrity?.recordHash ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.ok(
    auditAfter.some(
      (record) =>
        record.metadata.format === 'json' &&
        record.metadata.q === bulkType &&
        record.metadata.resultCount === 15 &&
        record.integrity?.category === 'admin'
    )
  );
});

test('R2 admin user detail exposes session and password reset audit trail', async () => {
  const adminSession = createDemoHostSession();
  const adapter = await getHostAuthAdapter();
  const before = await getHostIdentityUserDetail('demo-user');
  assert.ok(before.user);
  assert.equal(before.user.passwordHash, '[REDACTED]');
  assert.equal(JSON.stringify(before.user.metadata).includes('token'), false);

  const rawUser = await (await getHostRuntime()).runtimeStore.store.getHostUser('demo-user');
  assert.ok(rawUser);
  const created = await adapter.createSession(rawUser, { userAgent: 'web-shell-r2' });
  const withSession = await getHostIdentityUserDetail('demo-user');
  assert.ok(withSession.sessions.some((session) => session.id === created.session.id));

  const reset = await requestHostUserPasswordReset(adminSession, 'demo-user', 'web-shell reset');
  assert.equal(reset.sent, true);

  await revokeHostUserSession(adminSession, 'demo-user', created.session.id, 'web-shell revoke');
  const after = await getHostIdentityUserDetail('demo-user');
  assert.equal(
    after.sessions.some((session) => session.id === created.session.id),
    false
  );
  assert.ok(
    after.audit.some((record) => record.type === 'host.identity.password_reset.requested_by_admin')
  );
  assert.ok(after.audit.some((record) => record.type === 'host.identity.session.revoked_by_admin'));
});

test('R2 admin identity operations protect the acting and last admin account', async () => {
  const adminSession = createDemoHostSession();

  await assert.rejects(
    () => setHostUserStatus(adminSession, 'demo-admin', 'suspended', 'self suspend'),
    /HOST_IDENTITY_SELF_STATUS_FORBIDDEN/
  );
  await assert.rejects(
    () => setHostUserStatus(adminSession, 'demo-admin', 'deleted', 'self delete'),
    /HOST_IDENTITY_SELF_STATUS_FORBIDDEN/
  );
  await assert.rejects(
    () => setHostUserRole(adminSession, 'demo-admin', 'user', 'self downgrade'),
    /HOST_IDENTITY_SELF_ROLE_FORBIDDEN/
  );
});

test('X8 admin dead-letter API bulk replays records', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const outbox = await hostRuntime.runtimeStore.store.enqueueOutbox({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'hello',
    name: `x8.dead-letter.${Date.now()}`,
    payload: { ok: false },
  });
  await hostRuntime.runtimeStore.store.markOutbox(outbox.id, 'dead_letter', 'x8 test');

  const dryRunResponse = await bulkDeadLettersApi(
    createHostRequest('/api/admin/outbox/dead-letters', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'replay', dryRun: true, outboxIds: [outbox.id] }),
    })
  );
  const dryRunBody = (await dryRunResponse.json()) as {
    ok: boolean;
    data: {
      action: string;
      matched: number;
      selected: number;
      impact: { byStatus: Record<string, number>; byKind: Record<string, number> };
      records: { id: string; status: string }[];
    };
  };
  const afterDryRun = (
    await hostRuntime.runtimeStore.store.listOutbox({
      productId: 'demo-product',
      status: 'dead_letter',
    })
  ).find((record) => record.id === outbox.id);

  assert.equal(dryRunResponse.status, 200);
  assert.equal(dryRunBody.data.action, 'replay');
  assert.equal(dryRunBody.data.selected, 1);
  assert.equal(dryRunBody.data.impact.byStatus.dead_letter, 1);
  assert.equal(dryRunBody.data.impact.byKind.other, 1);
  assert.equal(dryRunBody.data.records[0]?.id, outbox.id);
  assert.equal(afterDryRun?.status, 'dead_letter');

  const response = await bulkDeadLettersApi(
    createHostRequest('/api/admin/outbox/dead-letters', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'replay', outboxIds: [outbox.id] }),
    })
  );
  const body = (await response.json()) as {
    ok: boolean;
    data: { processed: number; records: { id: string; status: string }[] };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data.processed, 1);
  assert.equal(body.data.records[0].id, outbox.id);
  assert.equal(body.data.records[0].status, 'queued');
});

test('X8 admin dead-letter API lists all dead-letter records beyond the snapshot window', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const prefix = `x8.dead-letter.list.${Date.now()}`;

  for (let index = 0; index < 12; index += 1) {
    await hostRuntime.runtimeStore.store.enqueueOutbox({
      productId: 'demo-product',
      workspaceId: 'demo-workspace',
      moduleId: 'hello',
      name: `${prefix}.queued.${index}`,
      payload: { index },
    });
  }

  const target = await hostRuntime.runtimeStore.store.enqueueOutbox({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'hello',
    name: `${prefix}.dead-letter`,
    payload: { ok: false },
  });
  await hostRuntime.runtimeStore.store.markOutbox(target.id, 'dead_letter', 'x8 list test');

  const response = await listDeadLettersApi(
    createHostRequest(`/api/admin/outbox/dead-letters?q=${encodeURIComponent(prefix)}&limit=20`, {
      headers: { cookie },
    })
  );
  const body = (await response.json()) as {
    ok: boolean;
    data: { items: { id: string; status: string }[]; page: { total: number; offset: number; limit: number } };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data.page.total, 1);
  assert.equal(body.data.items[0]?.id, target.id);
  assert.equal(body.data.items[0]?.status, 'dead_letter');
});

test('X8 admin dead-letter API defaults discard and archive actions to dead-letter records', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const prefix = `x8.dead-letter.defaults.${Date.now()}`;

  const discardTarget = await hostRuntime.runtimeStore.store.enqueueOutbox({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'hello',
    name: `${prefix}.discard`,
    payload: { ok: false },
  });
  await hostRuntime.runtimeStore.store.markOutbox(discardTarget.id, 'dead_letter', 'x8 discard test');

  const archiveTarget = await hostRuntime.runtimeStore.store.enqueueOutbox({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'hello',
    name: `${prefix}.archive`,
    payload: { ok: false },
  });
  await hostRuntime.runtimeStore.store.markOutbox(archiveTarget.id, 'dead_letter', 'x8 archive test');

  const discardResponse = await bulkDeadLettersApi(
    createHostRequest('/api/admin/outbox/dead-letters', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'discard', outboxIds: [discardTarget.id] }),
    })
  );
  const discardBody = (await discardResponse.json()) as {
    ok: boolean;
    data: { processed: number; records: { id: string; status: string }[] };
  };

  assert.equal(discardResponse.status, 200);
  assert.equal(discardBody.data.processed, 1);
  assert.equal(discardBody.data.records[0]?.id, discardTarget.id);
  assert.equal(discardBody.data.records[0]?.status, 'dead_letter');

  const archiveResponse = await bulkDeadLettersApi(
    createHostRequest('/api/admin/outbox/dead-letters', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'archive', outboxIds: [archiveTarget.id] }),
    })
  );
  const archiveBody = (await archiveResponse.json()) as {
    ok: boolean;
    data: { processed: number; records: { id: string; status: string }[] };
  };

  assert.equal(archiveResponse.status, 200);
  assert.equal(archiveBody.data.processed, 1);
  assert.equal(archiveBody.data.records[0]?.id, archiveTarget.id);
  assert.equal(archiveBody.data.records[0]?.status, 'archived');
});

test('X4 product scope APIs switch across products and expose domain aliases', async () => {
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const switchResponse = await switchProductScopeWorkspace(
    createHostRequest('/api/product-scope/switch', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'team-main' }),
    })
  );
  const switchBody = (await switchResponse.json()) as {
    ok: boolean;
    data: { scope: { product: { id: string } | null; workspace: { id: string } | null } };
  };

  assert.equal(switchResponse.status, 200);
  assert.equal(switchBody.data.scope.product?.id, 'team-product');
  assert.equal(switchBody.data.scope.workspace?.id, 'team-main');

  const productsResponse = await getProductScopeProducts(
    createHostRequest('/api/product-scope/products', { headers: { cookie } })
  );
  const productsBody = (await productsResponse.json()) as {
    ok: boolean;
    data: { products: { id: string }[] };
  };
  assert.equal(productsResponse.status, 200);
  assert.ok(productsBody.data.products.some((product) => product.id === 'team-product'));

  const workspacesResponse = await getProductScopeWorkspaces(
    createHostRequest('/api/product-scope/workspaces?productId=team-product', {
      headers: { cookie },
    })
  );
  const workspacesBody = (await workspacesResponse.json()) as {
    ok: boolean;
    data: { workspaces: { id: string }[] };
  };
  assert.equal(workspacesResponse.status, 200);
  assert.ok(workspacesBody.data.workspaces.some((workspace) => workspace.id === 'team-lab'));

  const aliasesResponse = await getProductScopeDomainAliases(
    createHostRequest('/api/product-scope/domain-aliases', { headers: { cookie } })
  );
  const aliasesBody = (await aliasesResponse.json()) as {
    ok: boolean;
    data: { aliases: { hostname: string; workspaceId?: string }[] };
  };
  assert.equal(aliasesResponse.status, 200);
  assert.ok(aliasesBody.data.aliases.some((alias) => alias.hostname === 'team.localhost'));
});

test('X4 workspace management uses the target workspace product scope', async () => {
  const hostRuntime = await getHostRuntime();
  const store = hostRuntime.runtimeStore.store;
  const suffix = Date.now();
  const productId = `rbac-product-${suffix}`;
  const workspaceId = `${productId}-workspace`;
  const managerId = `${productId}-manager`;
  const memberId = `${productId}-member`;

  await store.upsertProductScopeProduct({
    id: productId,
    name: 'RBAC Scope Product',
    profile: 'explicit-workspace',
    defaultWorkspaceId: workspaceId,
  });
  await store.upsertProductScopeWorkspace({
    id: workspaceId,
    productId,
    name: 'RBAC Scope Workspace',
    slug: `rbac-${suffix}`,
  });
  await store.upsertHostUser({
    id: managerId,
    email: `${managerId}@example.com`,
    passwordHash: createHostPasswordHash('Manager@123'),
    role: 'user',
    status: 'active',
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: 'demo-workspace',
    workspaceRole: 'viewer',
    permissions: [],
    metadata: {},
  });
  await store.upsertHostUser({
    id: memberId,
    email: `${memberId}@example.com`,
    passwordHash: createHostPasswordHash('Member@123'),
    role: 'user',
    status: 'active',
    productId,
    workspaceId,
    workspaceRole: 'viewer',
    permissions: [],
    metadata: {},
  });
  await store.upsertMembership({
    productId,
    workspaceId,
    userId: managerId,
    role: 'admin',
    status: 'active',
  });

  const staleProductSession = {
    user: { id: managerId, role: 'user' as const },
    userId: managerId,
    actorId: managerId,
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: 'demo-workspace',
    workspaceRole: 'viewer' as const,
    permissions: [],
  };
  const invitation = await createWorkspaceInvitation(staleProductSession, workspaceId, {
    email: `${memberId}@example.com`,
    role: 'editor',
  });
  const member = await upsertWorkspaceMember(staleProductSession, workspaceId, {
    userId: memberId,
    role: 'editor',
  });
  const [invitations, members] = await Promise.all([
    listWorkspaceInvitations(staleProductSession, workspaceId),
    listWorkspaceMembers(staleProductSession, workspaceId),
  ]);

  assert.equal(invitation.productId, productId);
  assert.equal(member.productId, productId);
  assert.ok(invitations.some((item) => item.id === invitation.id));
  assert.ok(members.some((item) => item.userId === memberId));
});

test('X4 workspace scope isolates files, runs and commercial ledgers', async () => {
  const store = createInMemoryRuntimeStore();
  const storage = createMemoryModuleFileStorage();
  const sessionA = {
    ...createDemoHostSession(),
    userId: 'user-a',
    productId: 'demo-product',
    workspaceId: 'workspace-a',
  };
  const sessionB = {
    ...createDemoHostSession(),
    userId: 'user-a',
    productId: 'demo-product',
    workspaceId: 'workspace-b',
  };
  const filesA = createHostFileRuntimeFromParts({ store, storage, session: sessionA }).forModule(
    'scope-test'
  );
  const filesB = createHostFileRuntimeFromParts({ store, storage, session: sessionB }).forModule(
    'scope-test'
  );
  const uploadA = await filesA.createUpload({ name: 'a.json', purpose: 'source' });
  const uploadB = await filesB.createUpload({ name: 'b.json', purpose: 'source' });
  const readyA = await filesA.completeUpload(uploadA.file.id, { content: '{"a":true}' });
  const readyB = await filesB.completeUpload(uploadB.file.id, { content: '{"b":true}' });

  assert.equal((await filesA.list()).length, 1);
  assert.equal(await filesA.read(readyB.id), null);
  await assert.rejects(() => filesA.createSignedUrl(readyB.id));
  assert.match(await filesB.createSignedUrl(readyB.id), /\/api\/media\//);
  assert.equal(await filesB.read(readyA.id), null);

  await store.createRun({
    productId: 'demo-product',
    workspaceId: 'workspace-a',
    moduleId: 'scope-test',
    kind: 'manual',
    name: 'run-a',
    input: {},
  });
  await store.createRun({
    productId: 'demo-product',
    workspaceId: 'workspace-b',
    moduleId: 'scope-test',
    kind: 'manual',
    name: 'run-b',
    input: {},
  });
  const runsA = await store.listRuns({ productId: 'demo-product', workspaceId: 'workspace-a' });
  assert.deepEqual(
    runsA.map((run) => run.name),
    ['run-a']
  );

  const commercialA = createHostCommercialRuntimeFromStore({
    store,
    productId: 'demo-product',
    workspaceId: 'workspace-a',
  });
  const commercialB = createHostCommercialRuntimeFromStore({
    store,
    productId: 'demo-product',
    workspaceId: 'workspace-b',
  });
  await commercialA.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: 'local-a',
    userId: 'user-a',
    sku: 'demo-pro-monthly',
    amount: 100,
    currency: 'USD',
  });
  await commercialB.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: 'local-b',
    userId: 'user-a',
    sku: 'demo-enterprise-monthly',
    amount: 200,
    currency: 'USD',
  });

  const ordersA = await commercialA.admin.listOrders({ userId: 'user-a' });
  const ordersB = await commercialB.admin.listOrders({ userId: 'user-a' });
  assert.deepEqual(
    ordersA.map((order) => order.sku),
    ['demo-pro-monthly']
  );
  assert.deepEqual(
    ordersB.map((order) => order.sku),
    ['demo-enterprise-monthly']
  );
});

test('K1 host runtime health reports the current composition root', async () => {
  const health = await getHostRuntimeHealth();

  assert.equal(health.auth.mode, 'runtime-store-signed-cookie');
  assert.equal(health.productScope.mode, 'runtime-store');
  assert.equal(health.catalog.mode, 'runtime-store');
  assert.equal(health.worker.mode, 'runtime-store-loop');
  assert.equal(health.security.routeCatalog, 'configured');
});

test('K3 host product scope seed preserves existing operator state', async () => {
  const store = createInMemoryRuntimeStore();
  await store.upsertProductScopeProduct({
    id: 'demo-product',
    name: 'Operator Product',
    profile: 'explicit-workspace',
    defaultWorkspaceId: 'demo-workspace',
  });
  await store.upsertProductScopeWorkspace({
    id: 'demo-workspace',
    productId: 'demo-product',
    name: 'Operator Workspace',
    slug: 'operator-workspace',
  });
  await store.upsertMembership({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    role: 'viewer',
    status: 'disabled',
  });
  await store.upsertProductScopeDomainAlias({
    hostname: 'demo.localhost',
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
  });
  await store.upsertProductScopeInvite({
    id: 'invite-custom',
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    email: 'operator@example.com',
    role: 'viewer',
    status: 'revoked',
    token: 'invite-demo-token',
    expiresAt: '2026-06-01T00:00:00.000Z',
    invitedBy: 'operator',
  });

  await ensureHostProductScopeSeeded(store);

  assert.equal(
    (await store.listProductScopeProducts({ productId: 'demo-product' }))[0]?.name,
    'Operator Product'
  );
  assert.equal(
    (await store.listProductScopeWorkspaces({ workspaceId: 'demo-workspace' }))[0]?.slug,
    'operator-workspace'
  );
  assert.equal((await store.listMemberships({ userId: 'demo-admin' }))[0]?.status, 'disabled');
  assert.equal(
    (await store.listProductScopeDomainAliases({ hostname: 'demo.localhost' }))[0]?.workspaceId,
    'demo-workspace'
  );
  assert.equal(
    (await store.listProductScopeInvites({ token: 'invite-demo-token' }))[0]?.status,
    'revoked'
  );
});

test('K5 admin catalog seed preserves persisted module state', async () => {
  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.upsertCatalogState({
    productId: 'demo-product',
    moduleId: 'hello',
    status: 'disabled',
    bundleId: 'operator',
    required: false,
    scopeProfile: 'explicit-workspace',
  });

  try {
    await getAdminOperationsView();
    const helloState = (
      await hostRuntime.runtimeStore.store.listCatalogStates({ productId: 'demo-product' })
    ).find((state) => state.moduleId === 'hello');

    assert.equal(helloState?.status, 'disabled');
    assert.equal(helloState?.bundleId, 'operator');
    assert.equal(helloState?.required, false);
    assert.equal(helloState?.scopeProfile, 'explicit-workspace');
  } finally {
    await hostRuntime.runtimeStore.store.upsertCatalogState({
      productId: 'demo-product',
      moduleId: 'hello',
      status: 'enabled',
      bundleId: 'demo',
      required: true,
      scopeProfile: 'hidden-default',
    });
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
  assert.equal(findAdminPageRegistryEntry('/admin/modules/white-label-site-demo')?.id, 'module.detail');
  assert.equal(findAdminPageRegistryEntry('/admin/runs/run_demo')?.id, 'run.detail');
  assert.equal(findAdminPageRegistryEntry('/admin/webhooks/outbox_demo')?.id, 'webhook.detail');
  assert.equal(findAdminPageRegistryEntry('/admin/webhooks')?.capability, 'admin.webhooks.read');
  assert.equal(findAdminPageRegistryEntry('/admin/service-connections')?.capability, 'admin.serviceConnections.read');
  assert.equal(findAdminPageRegistryEntry('/admin/module-dev-console')?.capability, 'admin.devConsole.read');
  assert.equal(findAdminPageRegistryEntry('/admin/settings')?.capability, 'admin.settings.read');
  assert.ok(adminEntries.some((entry) => entry.kind === 'api' && entry.id === 'revenue.reconcile' && entry.capability === 'billing.write'));
  assert.ok(adminEntries.some((entry) => entry.kind === 'api' && entry.id === 'serviceConnections' && entry.capability === 'admin.serviceConnections.read'));
  assert.ok(adminEntries.some((entry) => entry.kind === 'action' && entry.id === 'settings.update' && entry.capability === 'admin.settings.write'));
  assert.ok(adminEntries.some((entry) => entry.kind === 'action' && entry.id === 'webhooks.retryOutbox' && entry.capability === 'admin.webhooks.write'));
  assert.ok(adminEntries.some((entry) => entry.kind === 'action' && entry.id === 'entitlements.grant' && entry.capability === 'billing.write'));
  assert.ok(HOST_ROLES.every((role) => !('system' in role)));
  assert.deepEqual(HOST_ROLES.find((role) => role.id === 'user')?.modulePermissions, USER_MODULE_PERMISSIONS);

  const ownerCapabilities = getHostCapabilitiesForSession({
    user: { id: 'workspace-owner', role: 'user' },
    workspaceRole: 'owner',
    permissions: [],
  });
  assert.ok(ownerCapabilities.includes('workspace.manage'));
  assert.equal(ownerCapabilities.includes('admin.access'), false);
  assert.equal(ownerCapabilities.includes('billing.write'), false);

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

test('X11 config doctor exposes route, provider, metrics and retention readiness', async () => {
  const report = await runHostConfigDoctor({ projectRoot: process.cwd() });

  assert.equal(report.routeSecurity.ok, true);
  assert.equal(report.metrics.routeCatalogEntries, getHostRouteCatalog().length);
  assert.ok(report.metrics.providersTotal >= 5);
  assert.ok(report.providerReadiness.some((provider) => provider.id === 'security'));
  assert.match(report.retention.files, /expiresAt/);
});

test('X11 admin provider status merges config doctor and provider matrix evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-provider-status-'));
  fs.mkdirSync(path.join(root, '.runtime', 'provider-matrix'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'provider-matrix', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: false,
      checkedAt: '2026-05-21T00:00:00.000Z',
      checks: [
        { id: 'provider-config:files', ok: true, detail: { mode: 'local' } },
        {
          id: 'provider-config:billing',
          ok: false,
          detail: {
            mode: 'stripe',
            requiredMissing: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_DEMO_PRO_MONTHLY'],
          },
          error: 'Missing required provider env: STRIPE_SECRET_KEY, STRIPE_PRICE_DEMO_PRO_MONTHLY',
        },
        {
          id: 'local-provider-depth',
          ok: true,
          detail: {
            checks: [
              { id: 'local-storage-put', ok: true },
              { id: 'local-billing-ledger-reconcile', ok: true },
            ],
            artifacts: { report: 'local-provider-smoke/smoke.json' },
          },
        },
      ],
    })
  );

  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.recordProviderInvocation({
    productId: DEFAULT_HOST_PRODUCT_ID,
    providerId: 'stripe',
    kind: 'payment',
    operation: 'checkout',
    status: 'failed',
    error: new Error('stripe unavailable'),
  });
  const status = await getAdminProviderStatusView({ projectRoot: root });
  const files = status.providers.find((provider) => provider.id === 'files');
  const billing = status.providers.find((provider) => provider.id === 'billing');

  assert.equal(status.matrix.exists, true);
  assert.equal(status.matrix.localDepth.ok, true);
  assert.equal(status.matrix.localDepth.checks, 2);
  assert.equal(files?.evidenceStatus, 'passed');
  assert.ok(
    files?.operations.some((operation) => operation.command?.includes('host:files-reconcile-smoke'))
  );
  assert.equal(billing?.evidenceStatus, 'failed');
  assert.ok(billing?.failureDetails.some((detail) => detail.missing.includes('STRIPE_SECRET_KEY')));
  assert.ok(billing?.failureTimeline.some((item) => item.error === 'stripe unavailable'));
  assert.ok(
    billing?.operations.some((operation) =>
      operation.command?.includes('host:stripe-smoke -- --required')
    )
  );
  assert.ok(status.providers.some((provider) => provider.id === 'security'));
});

test('X11 admin worker status merges queue status and worker soak evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-worker-status-'));
  fs.mkdirSync(path.join(root, '.runtime', 'worker-soak'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.runtime', 'worker-soak', 'latest.json'),
    JSON.stringify({
      ok: true,
      required: false,
      checkedAt: '2026-05-21T00:00:00.000Z',
      durationMs: 25,
      enqueued: 2,
      drain: {
        iterations: 1,
        processed: 2,
        failed: 0,
        deadLettered: 0,
        queueLagMs: 0,
      },
      worker: {
        alerts: [],
      },
      artifacts: { report: 'worker-soak/soak.json' },
    })
  );

  const status = await getAdminWorkerStatusView({
    projectRoot: root,
    workerStatus: {
      workerId: 'worker-test',
      heartbeatAt: '2026-05-21T00:00:00.000Z',
      lastDrainAt: '2026-05-21T00:00:01.000Z',
      lastDurationMs: 25,
      lastResult: { processed: 2, failed: 0, deadLettered: 0, durationMs: 25 },
      queue: {
        queued: 0,
        processing: 0,
        failed: 0,
        deadLettered: 0,
        oldestPendingAt: null,
        lagMs: 0,
      },
      thresholds: {
        heartbeatStaleMs: 120_000,
        queueLagMs: 300_000,
        deadLettered: 0,
      },
      alerts: [],
    },
  });

  assert.equal(status.status, 'ready');
  assert.equal(status.soak.exists, true);
  assert.equal(status.soak.status, 'passed');
  assert.equal(status.soak.processed, 2);
  assert.equal(status.queue.deadLettered, 0);
});

test('A4 service connection inventory records tests, status changes and secret rotation', async () => {
  const adminSession = {
    user: { id: 'demo-admin', role: 'admin' as const },
    actorId: 'demo-admin',
  };
  const before = await getAdminServiceConnectionsView();
  const connection =
    before.connections.find((item) => item.id === 'host:ai') ?? before.connections[0];

  assert.ok(connection);
  await testAdminServiceConnection(adminSession, connection.id, 'web-shell test');
  await setAdminServiceConnectionStatus(
    adminSession,
    connection.id,
    'disabled',
    'web-shell disable'
  );
  await rotateAdminServiceConnectionSecret(
    adminSession,
    connection.id,
    'env:WEB_SHELL_ROTATED_SECRET',
    'web-shell rotate'
  );
  const customConnectionId = `custom:web-shell-${Date.now()}`;
  await createAdminServiceConnection(adminSession, {
    connectionId: customConnectionId,
    service: 'web-shell-api',
    provider: 'custom-http',
    baseUrl: 'https://api.example.test',
    authType: 'basic',
    secretSource: 'env:WEB_SHELL_BASIC_SECRET',
    timeoutMs: 1500,
    retry: '1 attempt / none',
    maxResponseBytes: 4096,
    healthCheck: '/health',
    actorClaims: 'system:web-shell-test',
    reason: 'web-shell create connection',
  });
  await updateAdminServiceConnectionPolicy(adminSession, {
    connectionId: customConnectionId,
    baseUrl: 'https://api.example.test/v2',
    authType: 'apiKey',
    secretSource: 'env:WEB_SHELL_API_KEY',
    timeoutMs: 2500,
    retry: '3 attempts / linear',
    maxResponseBytes: 8192,
    healthCheck: '/ready',
    actorClaims: 'workspace:web-shell',
    reason: 'web-shell update connection',
  });
  const healthCheckUrls: string[] = [];
  await testAdminServiceConnection(adminSession, customConnectionId, 'web-shell http health', {
    fetchImpl: (async (input) => {
      healthCheckUrls.push(String(input));
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  });

  const after = await getAdminServiceConnectionsView();
  const updated = after.connections.find((item) => item.id === connection.id);
  const custom = after.connections.find((item) => item.id === customConnectionId);

  assert.equal(updated?.status, 'disabled');
  assert.equal(custom?.source, 'custom');
  assert.equal(custom?.authType, 'apiKey');
  assert.equal(custom?.baseUrl, 'https://api.example.test/v2');
  assert.equal(custom?.secretSource, 'env:WEB_SHELL_API_KEY');
  assert.equal(custom?.timeoutMs, 2500);
  assert.equal(custom?.retry, '3 attempts / linear');
  assert.equal(custom?.maxResponseBytes, 8192);
  assert.equal(custom?.healthCheck, '/ready');
  assert.equal(custom?.actorClaims, 'workspace:web-shell');
  assert.deepEqual(healthCheckUrls, ['https://api.example.test/v2/ready']);
  assert.equal(custom?.lastError, undefined);

  const hostRuntime = await getHostRuntime();
  const contract = hostRuntime.moduleHost.runtime.contracts[0]!;
  let fetchAttempts = 0;
  const connectorUrls: string[] = [];
  const connectorApi = createHostServiceConnectionsApi({
    contract,
    store: hostRuntime.runtimeStore.store,
    session: adminSession,
    fetchImpl: (async (input) => {
      fetchAttempts += 1;
      connectorUrls.push(String(input));
      return new Response(fetchAttempts === 1 ? 'retry' : 'ok', {
        status: fetchAttempts === 1 ? 503 : 200,
      });
    }) as typeof fetch,
  });
  const connectorConfig = await connectorApi.get<Record<string, unknown>>(customConnectionId);
  assert.equal(connectorConfig?.timeoutMs, 2500);
  const connectorResult = await connectorApi.invoke<
    unknown,
    { status: number; attempts: number; body: string }
  >(customConnectionId, 'fetch', { path: '/ping' });
  assert.equal(connectorResult.status, 200);
  assert.equal(connectorResult.attempts, 2);
  assert.equal(connectorResult.body, 'ok');
  assert.deepEqual(connectorUrls, [
    'https://api.example.test/v2/ping',
    'https://api.example.test/v2/ping',
  ]);
  const connectorInvocationLedger = await hostRuntime.runtimeStore.store.listProviderInvocations({
    productId: DEFAULT_HOST_PRODUCT_ID,
    kind: 'connector',
  });
  assert.ok(
    connectorInvocationLedger.some(
      (record) =>
        record.serviceConnectionId === customConnectionId &&
        record.operation === 'fetch' &&
        record.status === 'succeeded' &&
        record.target === 'https://api.example.test/v2/ping' &&
        record.metadata.responseStatus === 200
    )
  );
  const testedConnection = await hostRuntime.runtimeStore.store.getServiceConnection(
    DEFAULT_HOST_PRODUCT_ID,
    customConnectionId
  );
  assert.equal(testedConnection?.health.result, 'succeeded');
  assert.equal(testedConnection?.health.connectorKind, 'http');

  const notFoundConnectorApi = createHostServiceConnectionsApi({
    contract,
    store: hostRuntime.runtimeStore.store,
    session: adminSession,
    fetchImpl: (async (input) =>
      new Response(`missing:${String(input)}`, {
        status: 404,
      })) as typeof fetch,
  });
  const notFoundResult = await notFoundConnectorApi.invoke<
    unknown,
    { status: number; attempts: number; body: string }
  >(customConnectionId, 'fetch', { path: '/missing' });
  assert.equal(notFoundResult.status, 404);
  assert.equal(notFoundResult.body, 'missing:https://api.example.test/v2/missing');
  await assert.rejects(
    () =>
      connectorApi.invoke(customConnectionId, 'fetch', {
        url: 'https://api.example.test/admin',
      }),
    /MODULE_CONNECTOR_EGRESS_PATH_DENIED/
  );
  await updateAdminServiceConnectionPolicy(adminSession, {
    connectionId: customConnectionId,
    baseUrl: 'http://127.0.0.1:9999/private',
    reason: 'web-shell verify private network guard',
  });
  await assert.rejects(
    () => connectorApi.invoke(customConnectionId, 'fetch', { path: '/health' }),
    /MODULE_CONNECTOR_PRIVATE_NETWORK_DENIED/
  );
  await updateAdminServiceConnectionPolicy(adminSession, {
    connectionId: customConnectionId,
    baseUrl: 'https://api.example.test/v2',
    reason: 'web-shell restore connector base url',
  });
  const failedConnectorInvocationLedger =
    await hostRuntime.runtimeStore.store.listProviderInvocations({
      productId: DEFAULT_HOST_PRODUCT_ID,
      kind: 'connector',
      status: 'failed',
    });
  assert.ok(
    failedConnectorInvocationLedger.some(
      (record) =>
        record.serviceConnectionId === customConnectionId &&
        record.target === 'https://api.example.test/v2/missing' &&
        record.error?.code === 'MODULE_CONNECTOR_UPSTREAM_404'
    )
  );
  assert.ok(
    failedConnectorInvocationLedger.some(
      (record) =>
        record.serviceConnectionId === customConnectionId &&
        record.error?.message.includes('PRIVATE_NETWORK_DENIED')
    )
  );

  await updateAdminServiceConnectionPolicy(adminSession, {
    connectionId: customConnectionId,
    maxResponseBytes: 1024,
    reason: 'web-shell shrink response limit',
  });
  const limitedConnectorApi = createHostServiceConnectionsApi({
    contract,
    store: hostRuntime.runtimeStore.store,
    session: adminSession,
    fetchImpl: (async () =>
      new Response('x'.repeat(1025), {
        status: 200,
      })) as typeof fetch,
  });
  await assert.rejects(
    () => limitedConnectorApi.invoke(customConnectionId, 'fetch', { path: '/too-large' }),
    /MODULE_CONNECTOR_RESPONSE_TOO_LARGE/
  );

  await setAdminServiceConnectionStatus(
    adminSession,
    customConnectionId,
    'disabled',
    'web-shell disable custom'
  );
  await assert.rejects(
    () => connectorApi.invoke(customConnectionId, 'fetch', { path: '/blocked' }),
    /MODULE_CONNECTOR_DISABLED/
  );
  const invokedView = await getAdminServiceConnectionsView();
  assert.ok(invokedView.callLogs.some((record) => record.type === 'admin.connection.invoked'));

  await applyAdminServiceConnectionLogRetention(adminSession, {
    retentionDays: 0,
    reason: 'web-shell retention',
  });
  const retained = await getAdminServiceConnectionsView();
  assert.ok(retained.retention.hiddenCount >= 1);
  assert.ok(
    retained.callLogs.some((record) => record.type === 'admin.connection.retention_applied')
  );
  assert.ok(
    retained.callLogs.every(
      (record) =>
        record.type === 'admin.connection.retention_applied' ||
        !retained.retention.cutoff ||
        record.createdAt > retained.retention.cutoff
    )
  );
  assert.ok(after.callLogs.some((record) => record.type === 'admin.connection.tested'));
  assert.ok(after.callLogs.some((record) => record.type === 'admin.connection.secret_rotated'));
  assert.ok(after.callLogs.some((record) => record.type === 'admin.connection.created'));
  assert.ok(after.callLogs.some((record) => record.type === 'admin.connection.updated'));
  assert.ok(
    after.callLogs.every(
      (record) => !JSON.stringify(record.metadata).includes('WEB_SHELL_ROTATED_SECRET')
    )
  );
});

test('M3 host runtime store config defaults to memory without database configuration', () => {
  const config = resolveHostRuntimeStoreConfig({});

  assert.equal(config.mode, 'memory');
  assert.equal(config.databaseUrl, null);
  assert.equal(config.databaseUrlConfigured, false);
});

test('M3 host runtime store config supports explicit local Postgres mode', () => {
  const config = resolveHostRuntimeStoreConfig({
    PLOYKIT_RUNTIME_STORE: 'postgres',
  });

  assert.equal(config.mode, 'postgres');
  assert.equal(config.databaseUrl, DEFAULT_LOCAL_DATABASE_URL);
  assert.equal(config.databaseUrlConfigured, false);
});

test('M3 host runtime store config uses DATABASE_URL as Postgres trigger', () => {
  const config = resolveHostRuntimeStoreConfig({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
  });

  assert.equal(config.mode, 'postgres');
  assert.equal(config.databaseUrl, 'postgres://user:pass@localhost:5432/app');
  assert.equal(config.databaseUrlConfigured, true);
});

test('M3 host runtime store rejects non-durable production fallbacks', () => {
  assert.throws(
    () =>
      assertHostRuntimeStoreConfig(resolveHostRuntimeStoreConfig({}), {
        NODE_ENV: 'production',
      }),
    /PLOYKIT_RUNTIME_STORE_PRODUCTION_MEMORY_FORBIDDEN/
  );
  assert.throws(
    () =>
      assertHostRuntimeStoreConfig(resolveHostRuntimeStoreConfig({ PLOYKIT_RUNTIME_STORE: 'postgres' }), {
        NODE_ENV: 'production',
      }),
    /PLOYKIT_RUNTIME_STORE_PRODUCTION_DEFAULT_DATABASE_FORBIDDEN/
  );
  assert.doesNotThrow(() =>
    assertHostRuntimeStoreConfig(
      resolveHostRuntimeStoreConfig({
        PLOYKIT_RUNTIME_STORE: 'postgres',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
      }),
      { NODE_ENV: 'production' }
    )
  );
});

test('M6 user SaaS snapshot seeds credits, entitlements, orders and tasks', async () => {
  const snapshot = await getUserSaasSnapshot(createDemoHostSession());

  assert.equal(snapshot.creditBalance.balance, 117);
  assert.equal(snapshot.entitlements[0]?.entitlement, 'public-tools.pro');
  assert.equal(snapshot.orders[0]?.status, 'paid');
  assert.ok(snapshot.tasks.some((run) => run.moduleId === 'public-tools-demo'));
});

test('M6 host file runtime stores file metadata and object content', async () => {
  const store = createInMemoryRuntimeStore();
  const storage = createMemoryModuleFileStorage();
  const files = createHostFileRuntimeFromParts({
    store,
    storage,
    session: createDemoHostSession(),
  }).forModule('public-tools-demo');
  const upload = await files.createUpload({
    name: 'sample.json',
    purpose: 'source',
    contentType: 'application/json',
  });
  const ready = await files.completeUpload(upload.file.id, { content: '{"ok":true}' });
  const listed = await files.list();

  assert.equal(ready.status, 'ready');
  assert.equal(listed.length, 1);
  assert.match(await files.createSignedUrl(ready.id), /\/api\/media\//);
});

test('M6 host file storage config defaults to local durable storage', () => {
  const config = resolveHostFileStorageConfig({});

  assert.equal(config.mode, 'local');
  assert.match(config.rootDir, /\.runtime[\\/]files$/);
});

test('M6 host file storage config resolves S3-compatible production settings', () => {
  const config = resolveHostFileStorageConfig({
    PLOYKIT_FILE_STORAGE: 's3',
    S3_BUCKET: 'ploykit-files',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'ap-east-1',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
  });

  assert.equal(config.mode, 's3');
  assert.equal(config.s3Configured, true);
  assert.equal(config.s3?.bucket, 'ploykit-files');
  assert.equal(config.s3?.region, 'ap-east-1');
});

test('X12 host file quota policy supports plan-aware overrides', async () => {
  const env = {
    PLOYKIT_FILE_USER_QUOTA_BYTES: '100',
    PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES: '500',
    PLOYKIT_FILE_MODULE_QUOTA_BYTES: '300',
    PLOYKIT_FILE_PLAN_QUOTAS_JSON: JSON.stringify({
      'demo-pro': {
        perUserBytes: 200,
        perWorkspaceBytes: 800,
      },
    }),
  };
  const session = {
    ...createDemoHostSession(),
    plan: 'demo-pro',
    plans: ['demo-pro'],
  };

  assert.deepEqual(resolveHostFileQuotaPolicy(createDemoHostSession(), env), {
    perUserBytes: 100,
    perWorkspaceBytes: 500,
    perModuleBytes: 300,
    policySource: 'global',
  });
  assert.deepEqual(resolveHostFileQuotaPolicy(session, env), {
    planId: 'demo-pro',
    perUserBytes: 200,
    perWorkspaceBytes: 800,
    perModuleBytes: 300,
    policySource: 'plan',
  });

  const previousUserQuota = process.env.PLOYKIT_FILE_USER_QUOTA_BYTES;
  const previousWorkspaceQuota = process.env.PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES;
  const previousModuleQuota = process.env.PLOYKIT_FILE_MODULE_QUOTA_BYTES;
  const previousPlanQuotas = process.env.PLOYKIT_FILE_PLAN_QUOTAS_JSON;
  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };
  try {
    process.env.PLOYKIT_FILE_USER_QUOTA_BYTES = env.PLOYKIT_FILE_USER_QUOTA_BYTES;
    process.env.PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES = env.PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES;
    process.env.PLOYKIT_FILE_MODULE_QUOTA_BYTES = env.PLOYKIT_FILE_MODULE_QUOTA_BYTES;
    process.env.PLOYKIT_FILE_PLAN_QUOTAS_JSON = env.PLOYKIT_FILE_PLAN_QUOTAS_JSON;
    const runtime = createHostFileRuntimeFromParts({
      store: createInMemoryRuntimeStore(),
      storage: createMemoryModuleFileStorage(),
      session,
    });
    const upload = await runtime.forModule('public-tools-demo').createUpload({
      name: 'plan-quota.txt',
      purpose: 'source',
      sizeBytes: 150,
      contentType: 'text/plain',
    });
    const ready = await runtime
      .forModule('public-tools-demo')
      .completeUpload(upload.file.id, { content: 'x'.repeat(150), sizeBytes: 150 });

    assert.equal(ready.sizeBytes, 150);
  } finally {
    restoreEnv('PLOYKIT_FILE_USER_QUOTA_BYTES', previousUserQuota);
    restoreEnv('PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES', previousWorkspaceQuota);
    restoreEnv('PLOYKIT_FILE_MODULE_QUOTA_BYTES', previousModuleQuota);
    restoreEnv('PLOYKIT_FILE_PLAN_QUOTAS_JSON', previousPlanQuotas);
  }
});

test('M6 host commercial provider applies local paid checkout benefits', async () => {
  const store = createInMemoryRuntimeStore();
  const commercial = createHostCommercialRuntimeFromStore({
    store,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
  });

  const result = await commercial.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: 'local-test',
    userId: 'demo-admin',
    sku: 'demo-pro-monthly',
    amount: 1200,
    currency: 'USD',
  });
  const balance = await commercial.forModule('public-tools-demo').credits.balance('demo-admin');
  const orderEvents = await store.listOutbox({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    name: `event:${COMMERCIAL_ORDER_STATUS_EVENT_NAME}`,
  });
  const orderEventPayload = orderEvents[0]?.payload as { status?: string } | undefined;

  assert.equal(result.order.status, 'paid');
  assert.equal(result.entitlements[0]?.entitlement, 'public-tools.pro');
  assert.equal(balance.balance, 1000);
  assert.equal(orderEvents.length, 1);
  assert.equal(orderEvents[0]?.moduleId, null);
  assert.equal(orderEventPayload?.status, 'paid');

  const brokenPaidOrder = await store.createCommercialOrder({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    sku: 'demo-pro-monthly',
    amount: 1200,
    currency: 'USD',
    provider: 'local',
    providerRef: 'local-repair',
  });
  await store.updateCommercialOrderStatus(brokenPaidOrder.id, 'paid');
  const repaired = await commercial.provider.reconcilePaidOrderBenefits({
    userId: 'demo-admin',
  });

  assert.equal(repaired.repaired, 1);
  assert.equal(
    (await commercial.forModule('public-tools-demo').credits.balance('demo-admin')).balance,
    2000
  );
});

test('X6 host billing overview exposes subscriptions, invoices, payment methods and tax profile', async () => {
  await ensureHostIdentitySeeded((await getHostRuntime()).runtimeStore.store);
  const overview = await getHostBillingOverview(createDemoHostSession());

  assert.equal(overview.catalog.skus[0]?.id, 'demo-pro-monthly');
  assert.ok(Array.isArray(overview.subscriptions));
  assert.ok(Array.isArray(overview.invoices));
  assert.ok(Array.isArray(overview.paymentMethods));
  assert.equal(overview.provider.mode === 'local' || overview.provider.mode === 'stripe', true);
});

test('A7 admin billing catalog changes feed runtime entitlements and user billing', async () => {
  const session = createDemoHostSession();
  await ensureHostIdentitySeeded((await getHostRuntime()).runtimeStore.store);
  const suffix = Date.now().toString(36);
  const planId = `ops-pro-${suffix}`;
  const skuId = `ops-pro-monthly-${suffix}`;

  await upsertHostBillingPlan(session, {
    id: planId,
    name: 'Ops Pro',
    entitlements: ['ops.pro'],
    features: ['priority runs', 'workspace billing'],
    limits: { credits: 777, seats: 5 },
  });
  await upsertHostBillingSku(session, {
    id: skuId,
    name: 'Ops Pro Monthly',
    planId,
    amount: 1500,
    currency: 'USD',
    interval: 'month',
    credits: 777,
    entitlements: ['ops.extra'],
    stripePriceId: `price_${suffix}`,
  });

  const runtime = await getHostCommercialRuntime(session);
  const paid = await runtime.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: `local:${skuId}`,
    userId: 'demo-admin',
    sku: skuId,
    amount: 1500,
    currency: 'USD',
  });
  const billing = runtime.forModule('web-shell').billing;
  const credits = await runtime.forModule('web-shell').credits.balance('demo-admin');
  const overview = await getHostBillingOverview(session);
  const hostRuntime = await getHostRuntime();
  const billingViewUserId = `billing-view-${suffix}`;
  const billingViewInvoiceId = `invoice-${billingViewUserId}`;
  const billingViewSubscriptionId = `subscription-${billingViewUserId}`;
  await hostRuntime.runtimeStore.store.upsertHostUser({
    id: billingViewUserId,
    email: `${billingViewUserId}@example.com`,
    passwordHash: createHostPasswordHash('BillingView@123'),
    role: 'user',
    status: 'active',
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    workspaceRole: 'editor',
    permissions: [],
    metadata: {},
  });
  await hostRuntime.runtimeStore.store.upsertBillingAccount({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    providerCustomers: { stripe: `cus_${suffix}` },
    paymentMethods: [
      {
        id: `pm_${suffix}`,
        provider: 'stripe',
        type: 'card',
        label: 'Stripe card',
        status: 'active',
        last4: '4242',
      },
    ],
    metadata: { source: 'test' },
  });
  await hostRuntime.runtimeStore.store.upsertInvoice({
    id: billingViewInvoiceId,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    orderId: null,
    subscriptionId: null,
    number: `PK-20260524-${suffix.slice(-6)}`,
    status: 'open',
    subtotal: 2500,
    discount: 0,
    tax: 0,
    total: 2500,
    refunded: 0,
    fee: 0,
    net: 2500,
    currency: 'USD',
    provider: 'stripe',
    providerRef: `pi_${suffix}`,
    taxSnapshot: { country: 'DE' },
    lines: [{ sku: 'billing-view', quantity: 1 }],
    metadata: { source: 'test' },
  });
  await hostRuntime.runtimeStore.store.upsertSubscription({
    id: billingViewSubscriptionId,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    planId,
    status: 'past_due',
    provider: 'stripe',
    providerRef: `sub_${suffix}`,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    renewalStrategy: 'provider',
    metadata: { entitlement: `billing.${suffix}` },
  });
  await hostRuntime.runtimeStore.store.upsertTaxProfile({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    status: 'validated',
    jurisdiction: 'DE',
    validationStatus: 'valid',
    profile: {
      company: 'Billing View Ltd',
      country: 'DE',
      taxId: 'DE12345678',
    },
    evidence: { source: 'test' },
    metadata: { source: 'test' },
  });
  await hostRuntime.runtimeStore.store.upsertTaxProfile({
    productId: 'demo-product',
    workspaceId: null,
    userId: billingViewUserId,
    status: 'validated',
    jurisdiction: 'FR',
    validationStatus: 'valid',
    profile: {
      company: 'Wrong Scope Ltd',
      country: 'FR',
      taxId: 'FR00000000',
    },
    evidence: { source: 'test-null-scope' },
    metadata: { source: 'test-null-scope' },
  });
  const resolvedTaxProfile = await getHostBillingTaxProfile({
    user: { id: billingViewUserId, role: 'user' },
    userId: billingViewUserId,
    actorId: billingViewUserId,
    productId: 'demo-product',
    workspaceRole: 'editor',
    permissions: [],
  } as any);
  const commercialView = await getAdminCommercialView();
  const syncResult = await syncHostBillingSkuToStripe(session, skuId);

  assert.equal(paid.order.status, 'paid');
  assert.ok(paid.entitlements.some((grant) => grant.entitlement === 'ops.pro'));
  assert.ok(paid.entitlements.some((grant) => grant.entitlement === 'ops.extra'));
  assert.equal(await billing.hasEntitlement('demo-admin', 'ops.pro'), true);
  assert.ok(credits.balance >= 777);
  assert.ok(overview.catalog.plans.some((plan) => plan.id === planId));
  assert.ok(overview.subscriptions.some((subscription) => subscription.planId === planId));
  assert.equal(resolvedTaxProfile.country, 'DE');
  assert.equal(resolvedTaxProfile.taxId, 'DE12345678');
  assert.ok(
    commercialView.paymentMethods.some(
      (method) => method.userId === billingViewUserId && method.provider === 'stripe' && method.last4 === '4242'
    )
  );
  assert.ok(
    commercialView.invoices.some(
      (invoice) => invoice.id === billingViewInvoiceId && invoice.status === 'open' && invoice.orderId === ''
    )
  );
  assert.ok(
    commercialView.subscriptions.some(
      (subscription) =>
        subscription.id === billingViewSubscriptionId &&
        subscription.status === 'past_due' &&
        subscription.source === 'stripe'
    )
  );
  assert.ok(
    commercialView.taxProfiles.some(
      (profile) =>
        profile.userId === billingViewUserId &&
        profile.company === 'Billing View Ltd' &&
        profile.country === 'DE' &&
        profile.taxIdMasked === '***5678'
    )
  );
  const previousStripeSecret = process.env.STRIPE_SECRET_KEY;
  const previousStripePrice = process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY;
  const previousFetch = globalThis.fetch;
  const portalCalls: { input: string; body: URLSearchParams }[] = [];
  process.env.STRIPE_SECRET_KEY = 'sk_test_portal';
  process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY = `price_${suffix}`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    portalCalls.push({
      input: String(input),
      body: new URLSearchParams(String(init?.body ?? '')),
    });
    return Response.json({ id: 'bps_test', url: 'https://billing.stripe.test/session' });
  }) as typeof fetch;
  try {
    const portal = await createHostBillingPortal({
      user: { id: billingViewUserId, role: 'user' },
      userId: billingViewUserId,
      actorId: billingViewUserId,
      productId: 'demo-product',
      workspaceId: 'demo-workspace',
      workspaceRole: 'editor',
      permissions: [],
    } as any);
    assert.equal(portal.provider, 'stripe');
    assert.equal(portal.url, 'https://billing.stripe.test/session');
    assert.equal(portalCalls[0]?.input, 'https://api.stripe.com/v1/billing_portal/sessions');
    assert.equal(portalCalls[0]?.body.get('customer'), `cus_${suffix}`);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStripeSecret === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = previousStripeSecret;
    }
    if (previousStripePrice === undefined) {
      delete process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY;
    } else {
      process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY = previousStripePrice;
    }
  }
  assert.ok(commercialView.featureMatrix.some((row) => row.capability === 'ops.pro'));
  assert.equal(syncResult.sku.id, skuId);

  await archiveHostBillingPlan(session, planId, 'test cleanup');
  const catalogAfterArchive = await loadHostBillingCatalog(
    (await getHostRuntime()).runtimeStore.store,
    'demo-product'
  );
  assert.equal(catalogAfterArchive.plans.find((plan) => plan.id === planId)?.status, 'archived');
});

test('M6 Stripe webhook signature verifier accepts valid signatures', () => {
  const body = '{"type":"checkout.session.completed"}';
  const secret = 'whsec_test';
  const timestamp = 1779199200;
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  assert.equal(
    verifyStripeWebhookSignature({
      body,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      secret,
      now: () => new Date(timestamp * 1000),
    }),
    true
  );
});

test('M6 Stripe checkout client creates a test-mode checkout request shape', async () => {
  const calls: { input: string | URL; init?: RequestInit }[] = [];
  const result = await createStripeCheckoutSession(
    {
      orderId: 'order_test',
      userId: 'demo-admin',
      sku: 'demo-pro-monthly',
      planId: 'demo-pro',
      mode: 'subscription',
    },
    {
      env: {
        PLOYKIT_HOST_URL: 'http://localhost:3000',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PRICE_DEMO_PRO_MONTHLY: 'price_test_123',
      },
      fetch: async (input, init) => {
        calls.push({ input, init });
        return Response.json({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
        });
      },
    }
  );
  const body = calls[0]?.init?.body as URLSearchParams;
  const headers = new Headers(calls[0]?.init?.headers);

  assert.equal(result.id, 'cs_test_123');
  assert.equal(calls[0]?.input, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(headers.get('authorization'), 'Bearer sk_test_123');
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('line_items[0][price]'), 'price_test_123');
  assert.equal(body.get('metadata[orderId]'), 'order_test');
  assert.equal(body.get('metadata[userId]'), 'demo-admin');
  assert.equal(body.get('metadata[planId]'), 'demo-pro');
  assert.equal(body.get('subscription_data[metadata][orderId]'), 'order_test');
  assert.equal(body.get('subscription_data[metadata][userId]'), 'demo-admin');
  assert.equal(body.get('subscription_data[metadata][sku]'), 'demo-pro-monthly');
  assert.equal(body.get('subscription_data[metadata][planId]'), 'demo-pro');
});

test('R4 Stripe billing portal client creates a test-mode portal request shape', async () => {
  const calls: { input: string | URL; init?: RequestInit }[] = [];
  const result = await createStripeBillingPortalSession(
    {
      customerId: 'cus_test',
      returnUrl: 'http://localhost:3000/zh/dashboard/billing',
    },
    {
      env: {
        STRIPE_SECRET_KEY: 'sk_test_123',
        PLOYKIT_HOST_URL: 'http://localhost:3000',
      },
      fetch: async (input, init) => {
        calls.push({ input, init });
        return Response.json({ id: 'bps_test', url: 'https://billing.stripe.test/session' });
      },
    }
  );
  const body = calls[0]?.init?.body as URLSearchParams;

  assert.equal(result.id, 'bps_test');
  assert.equal(String(calls[0]?.input), 'https://api.stripe.com/v1/billing_portal/sessions');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(body.get('customer'), 'cus_test');
  assert.equal(body.get('return_url'), 'http://localhost:3000/zh/dashboard/billing');
});

test('M6 host worker enqueues and drains a runtime-store job', async () => {
  const hostRuntime = await getHostRuntime();
  const run = await enqueueHostDemoJob(createDemoHostSession());
  const workerId = `web-shell-worker-${Date.now().toString(36)}`;
  const result = await drainHostWorker({ session: createDemoHostSession(), limit: 5, workerId });
  const deliveries = await hostRuntime.runtimeStore.store.listDeliveries({
    productId: 'demo-product',
    workerId,
  });
  const workers = await hostRuntime.runtimeStore.store.listWorkers({
    productId: 'demo-product',
    workerId,
  });

  assert.equal(run.status, 'queued');
  assert.equal(result.failed, 0);
  assert.equal(result.deadLettered, 0);
  assert.ok(result.processed >= 1);
  assert.ok(deliveries.some((delivery) => delivery.kind === 'job' && delivery.runId === run.id));
  assert.ok(deliveries.some((delivery) => delivery.kind === 'worker'));
  assert.equal(workers[0]?.workerId, workerId);
  assert.equal(workers[0]?.queueProfile, 'jobs-events-webhooks-email');
  assert.ok((workers[0]?.processed ?? 0) >= 1);
});

test('M6 host scoped runs API preserves owner metadata and module scope', async () => {
  const store = createInMemoryRuntimeStore();
  const session = createDemoHostSession();
  const contract = { id: 'runs-demo' } as Parameters<typeof createScopedRunsApi>[0]['contract'];
  const api = createScopedRunsApi({ contract, store, session });
  const run = await api.create({
    kind: 'manual',
    name: 'sync',
    input: { stage: 'queued' },
  });
  const progressed = await api.updateProgress(run.id, 135);
  await api.appendLog(run.id, 'info', 'Progress persisted.');
  const fetched = await api.get(run.id);
  const listed = await api.list({ name: 'sync' });
  const otherModuleApi = createScopedRunsApi({
    contract: { id: 'other-module' } as Parameters<typeof createScopedRunsApi>[0]['contract'],
    store,
    session,
  });

  assert.equal((run.input as { ownerId?: string }).ownerId, session.userId);
  assert.equal(progressed.progress, 100);
  assert.equal(fetched?.logs[0]?.message, 'Progress persisted.');
  assert.equal(listed.length, 1);
  assert.equal(await otherModuleApi.get(run.id), null);
  await assert.rejects(() => otherModuleApi.updateProgress(run.id, 10), /MODULE_RUN_NOT_FOUND/);
});

test('M6 host worker loop can run as a bounded production daemon iteration', async () => {
  await enqueueHostDemoJob(createDemoHostSession());
  const result = await runHostWorkerLoop({
    session: createDemoHostSession(),
    limit: 5,
    maxIterations: 1,
  });

  assert.equal(result.iterations, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.deadLettered, 0);
  assert.ok(result.processed >= 1);
  assert.ok(result.workerId.length > 0);
  assert.ok(result.durationMs >= 0);
  assert.ok(result.queueLagMs >= 0);
});

test('K6 host worker status reports heartbeat and queue lag', async () => {
  const status = await getHostWorkerStatus();
  const alerts = evaluateHostWorkerAlerts({
    heartbeatAt: new Date('2026-05-20T00:00:00.000Z').toISOString(),
    queue: {
      queued: 0,
      processing: 0,
      failed: 1,
      deadLettered: 1,
      oldestPendingAt: new Date('2026-05-19T23:50:00.000Z').toISOString(),
      lagMs: 600_000,
    },
    thresholds: {
      heartbeatStaleMs: 120_000,
      queueLagMs: 300_000,
      deadLettered: 0,
    },
    now: new Date('2026-05-20T00:01:00.000Z').getTime(),
  });

  assert.ok(status.workerId.length > 0);
  assert.ok(status.queue.queued >= 0);
  assert.ok(status.queue.lagMs >= 0);
  assert.ok(Array.isArray(status.alerts));
  assert.deepEqual(
    alerts.map((alert) => alert.code),
    ['worker.queue.lag', 'worker.queue.dead_letters', 'worker.queue.failed_messages']
  );
});

test('A10 host settings source metadata keeps env configured fields locked', () => {
  const base = baseHostSettings({
    PLOYKIT_SITE_NAME: 'Env Site',
    PLOYKIT_EMAIL_FROM: 'Env Sender <env@example.com>',
  } as unknown as NodeJS.ProcessEnv);
  const merged = mergeHostSettings(base, {
    siteName: 'Store Site',
    fromEmail: 'store@example.com',
    timezone: 'UTC',
  });
  const siteNameField = merged.fields.find((field) => field.key === 'siteName');
  const timezoneField = merged.fields.find((field) => field.key === 'timezone');

  assert.equal(merged.siteName, 'Env Site');
  assert.equal(merged.fromEmail, 'env@example.com');
  assert.equal(merged.timezone, 'UTC');
  assert.equal(merged.fieldSources.siteName, 'env');
  assert.equal(merged.fieldSources.fromEmail, 'env');
  assert.equal(merged.fieldSources.timezone, 'store');
  assert.equal(siteNameField?.editable, false);
  assert.equal(timezoneField?.editable, true);
});

test('A8/A9 admin analytics, edge access and audit retention expose operational evidence', async () => {
  const session = createDemoHostSession();
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const jsonExport = await getAdminAuditApi(
    createHostRequest('/api/admin/audit?format=json&limit=5', {
      headers: { cookie },
    })
  );
  const exportBody = (await jsonExport.json()) as { items: unknown[] };
  await new Promise((resolve) => setTimeout(resolve, 20));
  const analytics = await getAdminAnalytics({ range: '90d' });
  await applyAdminAuditRetention(session, {
    retentionDays: 30,
    mode: 'archive',
    reason: 'web-shell retention test',
  });
  const hostRuntime = await getHostRuntime();
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({ productId: 'demo-product' });

  assert.equal(jsonExport.status, 200);
  assert.match(jsonExport.headers.get('content-disposition') ?? '', /\.json"/);
  assert.ok(Array.isArray(exportBody.items));
  assert.ok(typeof analytics.revenueMetrics.mrr === 'number');
  assert.ok(typeof analytics.growthMetrics.signups === 'number');
  assert.ok(typeof analytics.usagePatterns.peak === 'number');
  assert.ok(Array.isArray(analytics.cohorts));
  assert.ok(Array.isArray(analytics.edgeAccessLogs));
  assert.ok(
    auditLogs.some(
      (record) =>
        record.type === 'admin.audit.retention_applied' &&
        record.metadata.reason === 'web-shell retention test'
    )
  );
});

test('A10/A11 admin files and host settings perform durable mutations with audit-backed policy', async () => {
  const session = createDemoHostSession();
  const hostRuntime = await getHostRuntime();
  const suffix = Date.now().toString(36);
  const file = await hostRuntime.runtimeStore.store.createFile({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'web-shell',
    ownerId: 'demo-admin',
    name: `ops-${suffix}.txt`,
    purpose: 'source',
    status: 'ready',
    visibility: 'private',
    contentType: 'text/plain',
    sizeBytes: 42,
    storageKey: `ops/${suffix}.txt`,
    metadata: { folder: 'ops' },
  });

  const archivedFiles = await bulkUpdateAdminFiles(session, {
    fileIds: [file.id],
    action: 'archive',
    reason: 'web-shell bulk archive test',
  });
  const filesView = await getAdminFilesView();
  const settings = await updateAdminHostSettings(session, {
    siteName: 'PloyKit Ops',
    supportEmail: 'support@example.com',
    defaultLocale: 'zh',
    timezone: 'Asia/Hong_Kong',
    requireEmailVerification: true,
    sessionMaxAgeDays: 7,
    passwordMinLength: 8,
    emailProvider: 'log',
    fromEmail: 'ops-no-reply@example.com',
    fromName: 'PloyKit Ops',
    digestFrequency: 'daily',
  });
  const savedSettings = await getAdminHostSettingsView();
  await assert.rejects(
    () => updateAdminHostSettings(session, { emailProvider: 'smtp' }),
    /ADMIN_SETTINGS_INVALID:emailProvider/
  );
  await assert.rejects(
    () => updateAdminHostSettings(session, { fromEmail: 'not-an-email' }),
    /ADMIN_SETTINGS_INVALID:fromEmail/
  );
  await assert.rejects(
    () => updateAdminHostSettings(session, { timezone: 'Mars/Base' }),
    /ADMIN_SETTINGS_INVALID:timezone/
  );
  await assert.rejects(
    () => updateAdminHostSettings(session, { sessionMaxAgeDays: 366 }),
    /ADMIN_SETTINGS_INVALID:sessionMaxAgeDays/
  );
  const emailResult = await sendHostEmail({
    to: 'ops@example.com',
    subject: 'Settings smoke',
    text: 'settings smoke',
    emailId: `settings-smoke-${suffix}`,
    correlationId: `settings-smoke-${suffix}`,
    metadata: { source: 'web-shell-test' },
  });
  const emailMetadata = emailResult.metadata as { from?: string } | undefined;
  const emailDeliveries = await hostRuntime.runtimeStore.store.listDeliveries({
    productId: 'demo-product',
    kind: 'email',
    correlationId: `settings-smoke-${suffix}`,
  });
  const refreshedHealth = await getHostRuntimeHealth();
  const settingsAudit = await hostRuntime.runtimeStore.store.listAudit({
    productId: 'demo-product',
    type: 'admin.settings.updated',
  });
  const latestSettingsAudit = [...settingsAudit]
    .reverse()
    .find((record) => record.metadata.version === savedSettings.version);
  const settingsDiff = latestSettingsAudit?.metadata.diff as
    | Array<{ key: string; next?: unknown; requiresRestart?: boolean }>
    | undefined;
  const fromEmailField = savedSettings.fields.find((field) => field.key === 'fromEmail');

  assert.equal(archivedFiles[0]?.status, 'archived');
  assert.equal(filesView.files.find((item) => item.id === file.id)?.status, 'archived');
  assert.equal(settings.siteName, 'PloyKit Ops');
  assert.equal(savedSettings.source, 'admin-override');
  assert.equal(savedSettings.fieldSources.fromEmail, 'admin-override');
  assert.equal(fromEmailField?.source, 'admin-override');
  assert.equal(fromEmailField?.requiresRestart, false);
  assert.equal(savedSettings.digestFrequency, 'daily');
  assert.equal(emailResult.provider, 'email-log');
  assert.equal(emailMetadata?.from, 'PloyKit Ops <ops-no-reply@example.com>');
  assert.equal(refreshedHealth.providers.email.from, 'PloyKit Ops <ops-no-reply@example.com>');
  assert.equal(emailDeliveries[0]?.emailId, `settings-smoke-${suffix}`);
  assert.equal(emailDeliveries[0]?.status, 'delivered');
  assert.ok(latestSettingsAudit);
  assert.equal('settings' in latestSettingsAudit.metadata, false);
  assert.equal(latestSettingsAudit.metadata.requiresRestart, false);
  assert.ok(settingsDiff?.some((item) => item.key === 'fromEmail' && item.next === '[REDACTED_EMAIL]'));
});

test('D22 admin file detail reports storage object and cleanup drilldown', async () => {
  const session = createDemoHostSession();
  const uploaded = await uploadHostUserFile(session, {
    moduleId: 'web-shell',
    name: `detail-${Date.now().toString(36)}.txt`,
    purpose: 'source',
    contentType: 'text/plain',
    content: 'admin file detail smoke',
  });

  const readyDetail = await getAdminFileDetailView(uploaded.file.id);
  assert.equal(readyDetail.storageObject?.status, 'present');
  assert.equal(readyDetail.storageObject?.sizeBytes, 'admin file detail smoke'.length);
  assert.equal(readyDetail.access?.mediaGateway, 'signed');
  assert.equal(readyDetail.cleanup?.eligible, false);
  assert.equal(readyDetail.cleanup?.physicalObjectPresent, true);

  await deleteAdminFile(session, uploaded.file.id);
  const deletedDetail = await getAdminFileDetailView(uploaded.file.id);
  assert.equal(deletedDetail.file?.status, 'deleted');
  assert.equal(deletedDetail.access?.mediaGateway, 'blocked');
  assert.equal(deletedDetail.cleanup?.eligible, true);
  assert.equal(deletedDetail.storageObject?.status, 'present');

  await cleanupAdminDeletedFiles(session);
  const cleanedDetail = await getAdminFileDetailView(uploaded.file.id);
  assert.equal(cleanedDetail.storageObject?.status, 'missing');
  assert.equal(cleanedDetail.cleanup?.physicalObjectPresent, false);
  assert.ok(cleanedDetail.cleanup?.latestCleanupAt);
  const cleanupAudit = cleanedDetail.audit.find(
    (record) => record.type === 'admin.file.cleanup_deleted'
  );
  assert.ok(cleanupAudit);
  assert.deepEqual(cleanupAudit.metadata.fileIds, [uploaded.file.id]);

  const filesView = await getAdminFilesView();
  assert.equal(filesView.reconcile.command, 'npm run host:files-reconcile-smoke');
  assert.ok(typeof filesView.reconcile.issues === 'number');
});
