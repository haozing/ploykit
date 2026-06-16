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
  await seedDemoHostIdentity();
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
  assert.ok(
    whiteLabelDetail.contract?.risk.highRiskPermissions.some(
      (permission) => permission.value === 'surface.override'
    )
  );
  assert.ok(
    whiteLabelDetail.contract?.risk.presentationOverrides.includes('surface:host.page:site.home')
  );
  assert.equal(whiteLabelDetail.contract?.data.migrationMode, undefined);
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
  assert.ok(
    runDetail.deliveries.some((delivery) => delivery.kind === 'job' && delivery.runId === run.id)
  );
  assert.ok(runDetail.artifacts.some((artifact) => artifact.runId === run.id));
  assert.ok(
    runDetail.outbox.some((record) => (record.payload as { runId?: string }).runId === run.id)
  );

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
    namePrefix: 'webhook:capability-demo:workflow',
  });

  assert.equal(replay.receipt.status, 'received');
  assert.ok(replayOutbox.some((record) => record.id === replay.outbox.id));
  assert.equal(
    (replay.outbox.payload as { bodyDigest?: string }).bodyDigest,
    webhookBody.receipt.id ? outboxDetail.receipts[0]?.bodyDigest : undefined
  );
});
