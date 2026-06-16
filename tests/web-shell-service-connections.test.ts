import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import {
  applyAdminServiceConnectionLogRetention,
  createAdminServiceConnection,
  getAdminServiceConnectionsView,
  rotateAdminServiceConnectionSecret,
  setAdminServiceConnectionStatus,
  testAdminServiceConnection,
  updateAdminServiceConnectionPolicy,
} from '../apps/host-next/lib/admin-service-connections';
import { createHostServiceConnectionsApi } from '../apps/host-next/lib/capability-providers';

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
