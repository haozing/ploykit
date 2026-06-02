import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  createInMemoryModuleConnectorOperations,
  createInMemoryModuleRunRuntime,
  createInMemoryRuntimeAuditLog,
  createModuleAdminRuntime,
  createRuntimeLogger,
  redactSensitive,
} from '../src/lib/module-runtime';
import {
  createInMemoryModuleCommercialRuntime,
  createModuleHttpApi,
} from '../src/lib/module-capabilities';
import { loadRuntimeConfig } from '../src/lib/runtime-config';

test('runtime config reports missing production inputs without fallback', () => {
  const result = loadRuntimeConfig({});

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    [
      'RUNTIME_CONFIG_DATABASE_URL_REQUIRED',
      'RUNTIME_CONFIG_HOST_URL_REQUIRED',
      'RUNTIME_CONFIG_AUTH_PROVIDER_INVALID',
    ]
  );
});

test('runtime config loads explicit production inputs', () => {
  const result = loadRuntimeConfig({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
    PLOYKIT_HOST_URL: 'https://app.example.com',
    PLOYKIT_AUTH_PROVIDER: 'host',
    PLOYKIT_RUNTIME_FLAGS: 'jobs=true,webhooks=false',
  });

  assert.equal(result.ok, true);
  assert.equal(result.config?.runtimeFlags.jobs, true);
  assert.equal(result.config?.runtimeFlags.webhooks, false);
});

test('runtime config accepts POSTGRES_URL as database fallback', () => {
  const result = loadRuntimeConfig({
    POSTGRES_URL: 'postgres://user:pass@localhost:5432/app',
    PLOYKIT_HOST_URL: 'https://app.example.com',
    PLOYKIT_AUTH_PROVIDER: 'host',
  });

  assert.equal(result.ok, true);
  assert.equal(result.config?.databaseUrl, 'postgres://user:pass@localhost:5432/app');
});

test('runtime config rejects reserved OIDC provider until an adapter exists', () => {
  const result = loadRuntimeConfig({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
    PLOYKIT_HOST_URL: 'https://app.example.com',
    PLOYKIT_AUTH_PROVIDER: 'oidc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.code, 'RUNTIME_CONFIG_AUTH_PROVIDER_INVALID');
});

test('observability redacts secrets from logs and connector records', () => {
  const logger = createRuntimeLogger({
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  logger.info('webhook received', {
    token: 'secret-token',
    nested: { webhookSignature: 'sig' },
  });
  const connectorOps = createInMemoryModuleConnectorOperations(
    () => new Date('2026-01-01T00:00:00.000Z')
  );
  const connectorRecord = connectorOps.record({
    moduleId: 'prod-test',
    connector: 'stripe',
    operation: 'charge',
    status: 'succeeded',
    durationMs: 12,
    request: { authorization: 'Bearer secret' },
    response: { cardNumber: '4111111111111111' },
  });

  assert.deepEqual(logger.records[0].metadata, {
    token: '[REDACTED]',
    nested: { webhookSignature: '[REDACTED]' },
  });
  assert.deepEqual(connectorRecord.request, { authorization: '[REDACTED]' });
  assert.deepEqual(connectorRecord.response, { cardNumber: '[REDACTED]' });
  assert.deepEqual(redactSensitive({ apiKey: 'x' }), { apiKey: '[REDACTED]' });
});

test('module http runtime enforces egress origin, method, and body size', async () => {
  const calls: string[] = [];
  const http = createModuleHttpApi({
    moduleId: 'prod-test',
    allowedOrigins: ['https://api.example.com'],
    allowedMethods: ['POST'],
    maxBodyBytes: 10,
    resolveHost: async () => ['203.0.113.10'],
    fetchImpl: async (input) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return Response.json({ ok: true });
    },
  });

  assert.equal(
    (await http.fetch('https://api.example.com/run', { method: 'POST', body: 'ok' })).status,
    200
  );
  await assert.rejects(() => http.fetch('https://evil.example.com/run', { method: 'POST' }));
  await assert.rejects(() => http.fetch('https://api.example.com/run', { method: 'GET' }));
  await assert.rejects(() =>
    http.fetch('https://api.example.com/run', { method: 'POST', body: 'too-large-body' })
  );
  await assert.rejects(() =>
    http.fetch(
      new Request('https://api.example.com/run', {
        method: 'POST',
        body: 'request-body-too-large',
        duplex: 'half',
      } as RequestInit)
    )
  );
  assert.equal(calls.length, 1);
});

test('module http runtime blocks sensitive headers, private networks, redirects, response size and timeout', async () => {
  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['127.0.0.1'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['::ffff:127.0.0.1'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['not-an-ip-address'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run', {
      headers: { authorization: 'Bearer secret' },
    })
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      redirect: 'follow-same-origin',
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example.com/next' },
        }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      maxResponseBytes: 4,
      fetchImpl: async () => new Response('too large'),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      timeoutMs: 10,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      timeoutMs: 10,
      resolveHost: async () => new Promise<readonly string[]>(() => undefined),
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );
});

test('module http runtime pins default transport to validated DNS addresses', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        host: request.headers.host,
        url: request.url,
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);
    const port = (address as AddressInfo).port;

    const http = createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: [`http://api.example.com:${port}`],
      allowPrivateNetwork: true,
      resolveHost: async () => ['127.0.0.1'],
    });

    const response = await http.fetch(`http://api.example.com:${port}/run?ok=1`);
    const body = (await response.json()) as { host: string; url: string };

    assert.equal(response.status, 200);
    assert.equal(body.host, `api.example.com:${port}`);
    assert.equal(body.url, '/run?ok=1');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('commercial runtime supports idempotent usage, metering, credits, and commerce', async () => {
  const commercial = createInMemoryModuleCommercialRuntime();
  const moduleCommercial = commercial.forModule('prod-test');
  const usage = await moduleCommercial.usage.record({
    meter: 'api.call',
    idempotencyKey: 'usage_1',
  });
  const usageDuplicate = await moduleCommercial.usage.record({
    meter: 'api.call',
    idempotencyKey: 'usage_1',
  });
  const authorization = await moduleCommercial.metering.authorize({
    meter: 'generation',
    quantity: 2,
    idempotencyKey: 'meter_1',
  });
  const committed = await moduleCommercial.metering.commit(authorization.id);
  await moduleCommercial.credits.grant({ userId: 'user_1', amount: 10 });
  const balance = await moduleCommercial.credits.consume({ userId: 'user_1', amount: 3 });
  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user_1',
    sku: 'credits_10',
    amount: 1000,
    currency: 'USD',
    idempotencyKey: 'checkout_1',
  });

  assert.equal(usage.id, usageDuplicate.id);
  assert.equal(committed.status, 'committed');
  assert.equal(balance.balance, 7);
  assert.equal((await moduleCommercial.commerce.getOrder(checkout.id))?.id, checkout.id);
  assert.equal(commercial.listUsage().length, 1);
});

test('commercial runtime keeps legacy redeem code redemptions isolated by code', async () => {
  const commercial = createInMemoryModuleCommercialRuntime({
    redeemCodes: {
      CODE_A: 'feature.a',
      CODE_B: 'feature.b',
    },
  });
  const moduleCommercial = commercial.forModule('prod-test');

  const first = await moduleCommercial.redeemCodes.redeem({
    code: 'CODE_A',
    subject: { type: 'user', id: 'user_1' },
  });
  const second = await moduleCommercial.redeemCodes.redeem({
    code: 'CODE_B',
    subject: { type: 'user', id: 'user_1' },
  });

  assert.equal(first.ok, true);
  assert.equal(first.entitlement, 'feature.a');
  assert.equal(second.ok, true);
  assert.equal(second.entitlement, 'feature.b');
});

test('commercial runtime derives expired redeem code status from expiresAt', async () => {
  const commercial = createInMemoryModuleCommercialRuntime({
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  const moduleCommercial = commercial.forModule('prod-test');
  const batch = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    maxRedemptions: 1,
    expiresAt: '2025-01-01T00:00:00.000Z',
  });

  assert.equal((await moduleCommercial.redeemCodes.list({ status: 'expired' })).length, 1);
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: batch.codes[0]?.metadata.rawCode as string,
        subject: { type: 'user', id: 'user_1' },
      })
    ).ok,
    false
  );
});

test('admin runtime exposes operational records for host admin surfaces', async () => {
  const runs = createInMemoryModuleRunRuntime();
  const audit = createInMemoryRuntimeAuditLog({ moduleId: 'prod-test' });
  const commercial = createInMemoryModuleCommercialRuntime();
  runs.createRun({ moduleId: 'prod-test', kind: 'manual', name: 'sync' });
  await audit.record('prod.audit', { secret: 'hidden' });
  await commercial.forModule('prod-test').usage.record({ meter: 'api.call' });

  const admin = createModuleAdminRuntime({ runs, audit, commercial });

  assert.equal(admin.listRuns({ moduleId: 'prod-test' }).length, 1);
  assert.equal(admin.listAuditLogs({ moduleId: 'prod-test' }).length, 1);
  assert.equal(admin.listUsage().length, 1);
});
