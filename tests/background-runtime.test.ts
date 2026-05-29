import {
  createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule,
  Permission,
  type ModuleContext } from '@ploykit/module-sdk';
import {
  createModuleRuntimeHost,
  runModuleLifecycleHook,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';
import {
  createInMemoryModuleArtifactRuntime,
  createInMemoryModuleNotificationRuntime,
  createModuleEventBus,
  createModuleJobRunner,
  createModuleWebhookGateway,
} from '../src/lib/module-capabilities';

const backgroundModule = defineModule({
  id: 'background-test',
  name: 'Background Test',
  version: '0.1.0',
  permissions: [
    Permission.ArtifactsWrite,
    Permission.NotificationsSend,
    Permission.EventsEmit,
    Permission.EventsSubscribe,
    Permission.WebhookReceive,
  ],
  jobs: {
    report: {
      handler: './jobs/report',
      retries: 1,
      timeoutMs: 5000,
    },
  },
  events: {
    publishes: ['background.reported'],
    subscribes: {
      'background.reported': './events/reported',
    },
  },
  webhooks: {
    inbound: {
      path: '/inbound/:source',
      handler: './webhooks/inbound',
      methods: ['POST'],
      signature: 'hmac-sha256',
    },
  },
  lifecycle: {
    install: './lifecycle/install',
  },
});

const failingSubscriberModule = defineModule({
  id: 'failing-subscriber',
  name: 'Failing Subscriber',
  version: '0.1.0',
  permissions: [Permission.EventsSubscribe],
  events: {
    subscribes: {
      'background.reported': './events/fail',
    },
  },
});

test('job runner executes module jobs and records run output', async () => {
  const artifacts = createInMemoryModuleArtifactRuntime();
  const notifications = createInMemoryModuleNotificationRuntime();
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'background-test': {
        module: async () => ({ default: backgroundModule }),
        jobs: {
          'jobs/report': async () => ({
            default: async (ctx: ModuleContext, input: { title: string }, run: { id: string }) => {
              const output = await ctx.artifacts.write({
                name: 'report',
                kind: 'json',
                runId: run.id,
                path: `runs/${run.id}/report.json`,
                content: { title: input.title },
              });
              await ctx.notifications.send({
                userId: ctx.user?.id ?? 'system',
                title: 'Report ready',
                runId: run.id,
              });
              return { artifactId: output.id };
            },
          }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);
  const runner = createModuleJobRunner(host, {
    session: {
      user: { id: 'user_1', role: 'user' },
      permissions: [Permission.ArtifactsWrite, Permission.NotificationsSend],
    },
    capabilities: {
      artifacts: artifacts.forModule,
      notifications: notifications.forModule,
    },
  });

  const result = await runner.runJob<{ title: string }, { artifactId: string }>({
    moduleId: 'background-test',
    name: 'report',
    input: { title: 'May report' },
  });

  assert.equal(result.run.status, 'succeeded');
  assert.equal(result.run.progress, 100);
  assert.equal((await artifacts.forModule('background-test').list()).length, 1);
  assert.equal((await notifications.forModule('background-test').list()).length, 1);
  assert.ok(result.result?.artifactId);
});

test('event bus drains subscribers with error isolation', async () => {
  const seen: unknown[] = [];
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'background-test': {
        module: async () => ({ default: backgroundModule }),
        events: {
          'events/reported': async () => ({
            default: async (_ctx: ModuleContext, event: { payload: unknown }) => {
              seen.push(event.payload);
            },
          }),
        },
      },
      'failing-subscriber': {
        module: async () => ({ default: failingSubscriberModule }),
        events: {
          'events/fail': async () => ({
            default: async () => {
              throw new Error('subscriber failed');
            },
          }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);
  const bus = createModuleEventBus(host);

  await bus.publish({
    moduleId: 'background-test',
    name: 'background.reported',
    payload: { ok: true },
  });
  const result = await bus.drain();

  assert.equal(result.failed, 1);
  assert.deepEqual(seen, [{ ok: true }]);
  assert.equal(result.handlers.length, 2);
  assert.equal(bus.outbox.list({ status: 'failed' }).length, 1);
});

test('webhook gateway verifies hmac signatures and deduplicates receipts', async () => {
  let calls = 0;
  const secret = 'test-secret';
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'background-test': {
        module: async () => ({ default: backgroundModule }),
        webhooks: {
          'webhooks/inbound': async () => ({
            default: async (ctx: ModuleContext, event: { json<T = unknown>(): Promise<T> }) => {
              calls += 1;
              return ctx.json({ ok: true, payload: await event.json() });
            },
          }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);
  const gateway = createModuleWebhookGateway(host, {
    secretResolver: () => secret,
  });
  const body = JSON.stringify({ value: 1 });
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const request = () =>
    new Request('http://localhost/inbound/github', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'delivery_1',
        'x-hub-signature-256': signature,
      },
      body,
    });

  const first = await gateway.dispatch({ request: request(), moduleId: 'background-test' });
  const duplicate = await gateway.dispatch({ request: request(), moduleId: 'background-test' });

  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(calls, 1);
  assert.equal(((await duplicate.json()) as { duplicate: boolean }).duplicate, true);
});

test('lifecycle runner invokes declared install hooks', async () => {
  const installed: string[] = [];
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'background-test': {
        module: async () => ({ default: backgroundModule }),
        lifecycle: {
          'lifecycle/install': async () => ({
            default: async (ctx: ModuleContext) => {
              installed.push(ctx.module.id);
              return { ok: true };
            },
          }),
        },
      },
    },
  };
  const host = await createModuleRuntimeHost(artifact);

  const result = await runModuleLifecycleHook(host, {
    moduleId: 'background-test',
    hook: 'install',
  });

  assert.equal(result.skipped, false);
  assert.deepEqual(installed, ['background-test']);
});
