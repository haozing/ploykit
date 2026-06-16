import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import { createMemoryModuleFileStorage } from '../src/lib/module-capabilities';
import { createHostCommercialRuntimeFromStore } from '../apps/host-next/lib/commercial-provider';
import { createHostSessionCookie, createHostPasswordHash, ensureHostIdentitySeeded } from '../apps/host-next/lib/auth';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';
import { createHostFileRuntimeFromParts } from '../apps/host-next/lib/files';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';
import { createHostRequest } from '../apps/host-next/lib/paths';
import { ensureHostProductScopeSeeded } from '../apps/host-next/lib/product-scope';
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  upsertWorkspaceMember,
} from '../apps/host-next/lib/product-scope-api';
import { GET as getProductScopeProducts } from '../apps/host-next/app/api/product-scope/products/route';
import { GET as getProductScopeWorkspaces } from '../apps/host-next/app/api/product-scope/workspaces/route';
import { GET as getProductScopeDomainAliases } from '../apps/host-next/app/api/product-scope/domain-aliases/route';
import { POST as switchProductScopeWorkspace } from '../apps/host-next/app/api/product-scope/switch/route';

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

test('X4 product scope APIs switch across products and expose domain aliases', async () => {
  await seedDemoHostIdentity();
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
