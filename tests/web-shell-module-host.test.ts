import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdminModuleDetail } from '../apps/host-next/lib/admin-module-operations';
import { getAdminModuleDevConsoleView } from '../apps/host-next/lib/admin-module-dev-console';
import {
  getAdminOutboxDetail,
  retryAdminWebhookReceipt,
} from '../apps/host-next/lib/admin-delivery';
import { getAdminRunDetail } from '../apps/host-next/lib/admin-runs';
import { createHostSessionCookie, ensureHostIdentitySeeded } from '../apps/host-next/lib/auth';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { createDemoHostSession, getModuleHost } from '../apps/host-next/lib/module-host';
import { createHostRequest } from '../apps/host-next/lib/paths';
import { drainHostWorker, enqueueHostDemoJob } from '../apps/host-next/lib/worker';
import { POST as receiveModuleWebhook } from '../apps/host-next/app/api/module-webhooks/[...path]/route';

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    Reflect.set(process.env, name, value);
  }
}

async function withDemoHostUsers<T>(run: () => T | Promise<T>): Promise<T> {
  const previousDemoUsers = process.env.PLOYKIT_ENABLE_DEMO_USERS;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.PLOYKIT_ENABLE_DEMO_USERS = 'true';
  if (process.env.NODE_ENV === 'production') {
    restoreEnvValue('NODE_ENV', 'test');
  }
  try {
    return await run();
  } finally {
    restoreEnvValue('PLOYKIT_ENABLE_DEMO_USERS', previousDemoUsers);
    restoreEnvValue('NODE_ENV', previousNodeEnv);
  }
}

async function seedDemoHostIdentity(
  store?: Parameters<typeof ensureHostIdentitySeeded>[0]
): Promise<void> {
  const targetStore = store ?? (await getHostRuntime()).runtimeStore.store;
  await withDemoHostUsers(() => ensureHostIdentitySeeded(targetStore));
}

test('P10 host shell resolves dashboard module page through the real host factory', async () => {
  const host = await getModuleHost();
  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    pathname: '/platform-smoke',
    request: createHostRequest('/dashboard/platform-smoke'),
    session: createDemoHostSession(),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.page.moduleId, 'platform-smoke');
    assert.equal(result.page.kind, 'dashboard');
  }
});

test('P10 host shell dispatches module API routes with a demo host session', async () => {
  const host = await getModuleHost();
  const response = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/platform-smoke/ping'),
    pathname: '/platform-smoke/ping',
    session: createDemoHostSession(),
  });
  const body = (await response.json()) as { ok: boolean; module_id: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.module_id, 'platform-smoke');
});

test('K1 host module API resolves request cookie sessions without a demo override', async () => {
  const host = await getModuleHost();
  await seedDemoHostIdentity();
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const response = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/platform-smoke/ping', {
      headers: { cookie },
    }),
    pathname: '/platform-smoke/ping',
  });
  const body = (await response.json()) as { ok: boolean; module_id: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.module_id, 'platform-smoke');
});

test('P20 platform smoke API and action receive host runtime context', async () => {
  const host = await getModuleHost();
  const apiResponse = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/platform-smoke/ping'),
    pathname: '/platform-smoke/ping',
    session: createDemoHostSession(),
  });
  const apiBody = (await apiResponse.json()) as {
    ok: boolean;
    module_id: string;
  };

  assert.equal(apiResponse.status, 200);
  assert.equal(apiBody.ok, true);
  assert.equal(apiBody.module_id, 'platform-smoke');

  const actionResult = await host.executeAction<
    { request_id?: string },
    { ok: boolean; module_id: string }
  >({
    moduleId: 'platform-smoke',
    name: 'ping',
    input: { request_id: 'web-shell' },
    session: createDemoHostSession(),
  });

  assert.equal(actionResult.ok, true);
  assert.equal(actionResult.module_id, 'platform-smoke');
});

test('M5 public tool smoke formats JSON through a public module API', async () => {
  const host = await getModuleHost();
  const response = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/public-tool-smoke/format-json', {
      method: 'POST',
      body: JSON.stringify({ source: '{"ok":true}' }),
      headers: { 'content-type': 'application/json' },
    }),
    pathname: '/public-tool-smoke/format-json',
  });
  const body = (await response.json()) as { ok: boolean; output: string };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.output, /"ok": true/);
});

test('X10 smoke modules expose page, API and action paths through the host runtime', async () => {
  const host = await getModuleHost();
  const session = createDemoHostSession();
  const dashboardPages = [
    ['platform-smoke', '/platform-smoke'],
    ['resource-smoke', '/resource-smoke'],
    ['resource-smoke', '/resource-smoke/new'],
  ] as const;

  for (const [moduleId, pathname] of dashboardPages) {
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

  const publicToolPage = await host.resolvePageRoute({
    kind: 'site',
    pathname: '/public-tool-smoke',
    request: createHostRequest('/public-tool-smoke'),
  });
  assert.equal(publicToolPage.ok, true, 'public-tool-smoke');
  if (publicToolPage.ok) {
    assert.equal(publicToolPage.page.moduleId, 'public-tool-smoke');
  }

  const platformStatus = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/platform-smoke/ping'),
    pathname: '/platform-smoke/ping',
    session,
  });
  const resourceStatus = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/resource-smoke/notes'),
    pathname: '/resource-smoke/notes',
    session,
  });
  const publicToolResponse = await host.dispatchApiRoute({
    request: createHostRequest('/api/modules/public-tool-smoke/format-json', {
      method: 'POST',
      body: JSON.stringify({ source: '{"guard":true}' }),
      headers: { 'content-type': 'application/json' },
    }),
    pathname: '/public-tool-smoke/format-json',
    session,
  });
  assert.equal(platformStatus.status, 200);
  assert.equal(resourceStatus.status, 200);
  assert.equal(publicToolResponse.status, 200);
  assert.equal(((await publicToolResponse.json()) as { ok: boolean }).ok, true);

  const publicToolAction = await host.executeAction<
    { source: string },
    { ok: boolean; output: string }
  >({
    moduleId: 'public-tool-smoke',
    name: 'formatSample',
    input: { source: '{"guard":true}' },
    session,
  });
  const platformAction = await host.executeAction<
    { request_id?: string },
    { ok: boolean; module_id: string }
  >({
    moduleId: 'platform-smoke',
    name: 'ping',
    input: { request_id: 'x10' },
    session,
  });

  assert.equal(publicToolAction.ok, true);
  assert.match(publicToolAction.output, /"guard": true/);
  assert.equal(platformAction.ok, true);
  assert.equal(platformAction.module_id, 'platform-smoke');

  const devConsole = await getAdminModuleDevConsoleView();
  assert.ok(devConsole.snapshot.modules.some((module) => module.id === 'platform-smoke'));
  assert.ok(devConsole.snapshot.modules.some((module) => module.id === 'resource-smoke'));
  assert.ok(devConsole.snapshot.modules.some((module) => module.id === 'public-tool-smoke'));
  assert.ok(devConsole.report.templates.some((template) => template.id === 'app'));
  assert.ok(devConsole.bundle.modules.some((module) => module.id === 'resource-smoke'));

  const resourceDetail = await getAdminModuleDetail('resource-smoke');
  assert.equal(resourceDetail.contract?.data.migrationMode, 'generated');
});

test('X10 platform smoke workflow writes runtime-store job result, webhook receipt and outbox', async () => {
  const session = createDemoHostSession();
  const run = await enqueueHostDemoJob(session, {
    moduleId: 'platform-smoke',
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
  assert.ok(
    runDetail.deliveries.some((delivery) => delivery.kind === 'job' && delivery.runId === run.id)
  );
  assert.ok(runDetail.artifacts.some((artifact) => artifact.runId === run.id));
  assert.ok(
    runDetail.outbox.some((record) => (record.payload as { runId?: string }).runId === run.id)
  );

  const webhookResponse = await receiveModuleWebhook(
    createHostRequest('/api/module-webhooks/platform-smoke/workflow/webhook', {
      method: 'POST',
      body: JSON.stringify({ source: 'x10-test' }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `x10-webhook-${Date.now()}`,
      },
    }),
    {
      params: Promise.resolve({ path: ['platform-smoke', 'workflow', 'webhook'] }),
    }
  );
  const webhookBody = (await webhookResponse.json()) as {
    ok: boolean;
    receipt: { id: string; moduleId: string; status: string };
  };
  const receipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: 'demo-product',
    moduleId: 'platform-smoke',
  });
  const outbox = await hostRuntime.runtimeStore.store.listOutbox({
    productId: 'demo-product',
    namePrefix: 'webhook:platform-smoke:workflow',
  });

  assert.equal(webhookResponse.status, 200);
  assert.equal(webhookBody.ok, true);
  assert.equal(webhookBody.receipt.moduleId, 'platform-smoke');
  assert.ok(receipts.some((receipt) => receipt.webhookName === 'workflow'));
  assert.ok(outbox.some((record) => record.moduleId === 'platform-smoke'));

  const webhookDrain = await drainHostWorker({ session, limit: 10 });
  const processedReceipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: 'demo-product',
    moduleId: 'platform-smoke',
    status: 'processed',
  });

  assert.equal(webhookDrain.failed, 0);
  assert.equal(webhookDrain.deadLettered, 0);
  assert.ok(webhookDrain.processed >= 1);
  assert.ok(processedReceipts.some((receipt) => receipt.id === webhookBody.receipt.id));

  const processedWebhookOutbox = webhookDrain.records.find((record) =>
    record.name.startsWith('webhook:platform-smoke:workflow')
  );
  assert.ok(processedWebhookOutbox);
  const unrelatedReceipt = await hostRuntime.runtimeStore.store.createWebhookReceipt({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'platform-smoke',
    webhookName: 'workflow',
    path: '/platform-smoke/workflow/webhook',
    method: 'POST',
    idempotencyKey: `x10-unrelated-${Date.now()}`,
    bodyText: JSON.stringify({ source: 'unrelated-detail-check' }),
  });
  const outboxDetail = await getAdminOutboxDetail(processedWebhookOutbox.id);
  assert.equal(
    outboxDetail.receipts.some((receipt) => receipt.id === webhookBody.receipt.id),
    true
  );
  assert.equal(
    outboxDetail.receipts.some((receipt) => receipt.id === unrelatedReceipt.id),
    false
  );
  assert.ok(
    outboxDetail.deliveries.some((delivery) => delivery.outboxId === processedWebhookOutbox.id)
  );

  const replay = await retryAdminWebhookReceipt(
    { user: { id: 'demo-admin', role: 'admin' as const }, actorId: 'demo-admin' },
    webhookBody.receipt.id,
    'web-shell receipt replay'
  );
  const replayOutbox = await hostRuntime.runtimeStore.store.listOutbox({
    productId: 'demo-product',
    namePrefix: 'webhook:platform-smoke:workflow',
  });

  assert.equal(replay.receipt.status, 'received');
  assert.ok(replayOutbox.some((record) => record.id === replay.outbox.id));
  assert.equal(
    (replay.outbox.payload as { bodyDigest?: string }).bodyDigest,
    webhookBody.receipt.id ? outboxDetail.receipts[0]?.bodyDigest : undefined
  );
});
