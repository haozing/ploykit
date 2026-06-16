import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHostSessionCookie,
  ensureHostIdentitySeeded,
  getHostAuthAdapter,
} from '../apps/host-next/lib/auth';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';
import {
  getHostIdentityUserDetail,
  requestHostUserPasswordReset,
  revokeHostUserSession,
  setHostUserRole,
  setHostUserStatus,
} from '../apps/host-next/lib/identity-operations';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';
import { createHostRequest } from '../apps/host-next/lib/paths';
import { GET as getAdminAuditApi } from '../apps/host-next/app/api/admin/audit/route';
import { GET as searchAdminApi } from '../apps/host-next/app/api/admin/search/route';

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

test('X3 admin APIs reject non-admin sessions through capability guard', async () => {
  await seedDemoHostIdentity();
  const userCookie = createHostSessionCookie('demo-user').split(';')[0]!;
  const response = await searchAdminApi(
    createHostRequest('/api/admin/search?q=demo', { headers: { cookie: userCookie } })
  );

  assert.equal(response.status, 403);
});

test('R2 admin audit API exports protected CSV evidence', async () => {
  await seedDemoHostIdentity();
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
