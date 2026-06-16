import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import {
  authenticateHostUser,
  createHostPasswordHash,
  createHostSessionCookie,
  ensureHostIdentitySeeded,
  HOST_AUTH_COOKIE,
  resolveHostSessionFromCookieHeader,
  verifyHostPassword,
} from '../apps/host-next/lib/auth';
import { resolveHostRequestSession } from '../apps/host-next/lib/auth-session';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { createHostRequest } from '../apps/host-next/lib/paths';
import { resetHostSecurityRateLimiter } from '../apps/host-next/lib/security';
import { POST as loginUserApi } from '../apps/host-next/app/api/auth/login/route';

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

test('M2 host auth adapter resolves seeded admin sessions from the auth cookie', async () => {
  await seedDemoHostIdentity();
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
  await seedDemoHostIdentity(store);
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

test('K2 host identity seed is disabled by default and blocks demo users in production', async () => {
  const store = createInMemoryRuntimeStore();
  const previousDemoUsers = process.env.PLOYKIT_ENABLE_DEMO_USERS;
  const previousBootstrapEmail = process.env.PLOYKIT_BOOTSTRAP_ADMIN_EMAIL;
  const previousBootstrapPassword = process.env.PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD;
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    delete process.env.PLOYKIT_ENABLE_DEMO_USERS;
    delete process.env.PLOYKIT_BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD;
    await ensureHostIdentitySeeded(store);
    assert.equal(await store.findHostUserByEmail('admin@example.com'), null);
    assert.equal(await store.findHostUserByEmail('user@example.com'), null);

    process.env.PLOYKIT_ENABLE_DEMO_USERS = 'true';
    restoreEnvValue('NODE_ENV', 'production');
    await assert.rejects(
      () => ensureHostIdentitySeeded(store),
      /PLOYKIT_DEMO_USERS_PRODUCTION_FORBIDDEN/
    );
  } finally {
    restoreEnvValue('PLOYKIT_ENABLE_DEMO_USERS', previousDemoUsers);
    restoreEnvValue('PLOYKIT_BOOTSTRAP_ADMIN_EMAIL', previousBootstrapEmail);
    restoreEnvValue('PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD', previousBootstrapPassword);
    restoreEnvValue('NODE_ENV', previousNodeEnv);
  }
});

test('K2 host identity bootstrap creates only an explicit admin account', async () => {
  const store = createInMemoryRuntimeStore();
  const previousDemoUsers = process.env.PLOYKIT_ENABLE_DEMO_USERS;
  const previousBootstrapEmail = process.env.PLOYKIT_BOOTSTRAP_ADMIN_EMAIL;
  const previousBootstrapPassword = process.env.PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD;

  try {
    delete process.env.PLOYKIT_ENABLE_DEMO_USERS;
    process.env.PLOYKIT_BOOTSTRAP_ADMIN_EMAIL = 'Owner@Example.com';
    process.env.PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD = 'Bootstrap@123456';
    await ensureHostIdentitySeeded(store);

    const owner = await store.findHostUserByEmail('owner@example.com');
    const demoAdmin = await store.findHostUserByEmail('admin@example.com');
    const demoUser = await store.findHostUserByEmail('user@example.com');

    assert.equal(owner?.id, 'bootstrap-admin');
    assert.equal(owner?.role, 'admin');
    assert.equal(owner?.status, 'active');
    assert.equal(verifyHostPassword('Bootstrap@123456', owner?.passwordHash ?? ''), true);
    assert.equal(demoAdmin, null);
    assert.equal(demoUser, null);
  } finally {
    restoreEnvValue('PLOYKIT_ENABLE_DEMO_USERS', previousDemoUsers);
    restoreEnvValue('PLOYKIT_BOOTSTRAP_ADMIN_EMAIL', previousBootstrapEmail);
    restoreEnvValue('PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD', previousBootstrapPassword);
  }
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
  await seedDemoHostIdentity();
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
  await seedDemoHostIdentity();
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const resolved = await resolveHostRequestSession(
    createHostRequest('/api/auth/session', {
      headers: { cookie },
    })
  );

  assert.equal(resolved.source, 'request-cookie');
  assert.equal(resolved.session.user?.id, 'demo-admin');
});
