import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import {
  createHostPasswordHash,
  createHostSessionCookie,
  ensureHostIdentitySeeded,
  getHostAuthAdapter,
} from '../apps/host-next/lib/auth';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';
import { createHostRequest, hostBaseUrl } from '../apps/host-next/lib/paths';
import { getHostRuntimeStore } from '../apps/host-next/lib/runtime-store';
import {
  GET as getUserProfile,
  PATCH as patchUserProfile,
} from '../apps/host-next/app/api/user/profile/route';
import { POST as changeUserPassword } from '../apps/host-next/app/api/user/profile/password/route';
import { GET as getUserRole } from '../apps/host-next/app/api/user/role/route';
import { GET as getCurrentProductScope } from '../apps/host-next/app/api/product-scope/current/route';
import { GET as getNotificationsUnread } from '../apps/host-next/app/api/notifications/unread/route';
import { POST as markNotificationsReadAll } from '../apps/host-next/app/api/notifications/read-all/route';
import { GET as getBillingOrders } from '../apps/host-next/app/api/billing/orders/route';
import {
  GET as getAdminProvidersApi,
  POST as recordAdminProvidersAuditApi,
} from '../apps/host-next/app/api/admin/providers/route';
import { GET as getAdminWorkersApi } from '../apps/host-next/app/api/admin/workers/route';
import { GET as searchAdminApi } from '../apps/host-next/app/api/admin/search/route';

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

test('X2 host user APIs expose profile, role and guarded password operations', async () => {
  await seedDemoHostIdentity();
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
  const suffix = Date.now();
  const passwordUser = await runtimeStore.store.upsertHostUser({
    id: `password-user-${suffix}`,
    email: `password-user-${suffix}@example.com`,
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
  await seedDemoHostIdentity();
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
  const searchAuditRecord = searchAudit.find(
    (record) => record.metadata.requestId === searchRequestId
  );
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
