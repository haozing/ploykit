import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostSessionCookie, ensureHostIdentitySeeded } from '../apps/host-next/lib/auth';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { createHostRequest } from '../apps/host-next/lib/paths';
import {
  GET as listDeadLettersApi,
  POST as bulkDeadLettersApi,
} from '../apps/host-next/app/api/admin/outbox/dead-letters/route';

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

test('X8 admin dead-letter API bulk replays records', async () => {
  await seedDemoHostIdentity();
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
  await seedDemoHostIdentity();
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
    data: {
      items: { id: string; status: string }[];
      page: { total: number; offset: number; limit: number };
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data.page.total, 1);
  assert.equal(body.data.items[0]?.id, target.id);
  assert.equal(body.data.items[0]?.status, 'dead_letter');
});

test('X8 admin dead-letter API defaults discard and archive actions to dead-letter records', async () => {
  await seedDemoHostIdentity();
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
  await hostRuntime.runtimeStore.store.markOutbox(
    discardTarget.id,
    'dead_letter',
    'x8 discard test'
  );

  const archiveTarget = await hostRuntime.runtimeStore.store.enqueueOutbox({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'hello',
    name: `${prefix}.archive`,
    payload: { ok: false },
  });
  await hostRuntime.runtimeStore.store.markOutbox(
    archiveTarget.id,
    'dead_letter',
    'x8 archive test'
  );

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
