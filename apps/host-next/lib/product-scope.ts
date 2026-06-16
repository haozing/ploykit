import {
  applyProductScopeToSession,
  resolveProductScope,
  type ProductScopeResolution,
} from '@/lib/module-runtime/scope/product-scope-resolver';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeMembership,
  ProductScopeProduct,
  ProductScopeSnapshot,
  ProductScopeWorkspace,
} from '@/lib/module-runtime/scope/product-scope-types';
import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';
import { resolveHostSessionFromRequest } from './auth';
import { getHostRuntime } from './create-host';
import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
  DEFAULT_PRODUCT_SCOPE_SNAPSHOT,
} from './default-scope';
import {
  cachedDashboardProductScopeResolution,
  cachedDashboardProductScopeSnapshot,
  invalidateDashboardShellCache,
} from './dashboard-shell-cache';

export const HOST_PRODUCT_SCOPE_COOKIE = 'ploykit_product_scope';

const seedPromises = new WeakMap<RuntimeStore, Promise<void>>();

function parseCookieHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }
  for (const part of header.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (!name) {
      continue;
    }
    cookies.set(name, decodeURIComponent(valueParts.join('=') ?? ''));
  }
  return cookies;
}

function encodeProductScopeCookieValue(input: {
  productId: string;
  workspaceId: string;
}): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
}

function decodeProductScopeCookieValue(value: string | undefined): {
  productId: string;
  workspaceId: string;
} | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).productId === 'string' &&
      typeof (parsed as Record<string, unknown>).workspaceId === 'string'
    ) {
      return parsed as { productId: string; workspaceId: string };
    }
  } catch {
    return null;
  }
  return null;
}

export function createProductScopeCookie(input: {
  productId: string;
  workspaceId: string;
}): string {
  const maxAgeSeconds = 365 * 24 * 60 * 60;
  const cookie = [
    `${HOST_PRODUCT_SCOPE_COOKIE}=${encodeURIComponent(encodeProductScopeCookieValue(input))}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === 'production') {
    cookie.push('Secure');
  }
  return cookie.join('; ');
}

function readProductScopeCookie(request: Request): {
  productId: string;
  workspaceId: string;
} | null {
  return decodeProductScopeCookieValue(
    parseCookieHeader(request.headers.get('cookie')).get(HOST_PRODUCT_SCOPE_COOKIE)
  );
}

function defaultSnapshot(): ProductScopeSnapshot {
  return DEFAULT_PRODUCT_SCOPE_SNAPSHOT;
}

async function seedProductScope(store: RuntimeStore): Promise<void> {
  const snapshot = defaultSnapshot();
  const [existingProducts, existingWorkspaces, existingMemberships, existingAliases, existingInvites] =
    await Promise.all([
      store.listProductScopeProducts(),
      store.listProductScopeWorkspaces(),
      store.listMemberships(),
      store.listProductScopeDomainAliases(),
      store.listProductScopeInvites(),
    ]);
  const existingProductIds = new Set(existingProducts.map((product) => product.id));
  const existingWorkspaceIds = new Set(existingWorkspaces.map((workspace) => workspace.id));
  const existingMembershipKeys = new Set(
    existingMemberships.map(
      (membership) =>
        `${membership.productId}:${membership.workspaceId}:${membership.userId}`
    )
  );
  const existingAliasHostnames = new Set(
    existingAliases.map((alias) => alias.hostname.toLowerCase())
  );
  const existingInviteTokens = new Set(existingInvites.map((invite) => invite.token));

  for (const product of snapshot.products) {
    if (!existingProductIds.has(product.id)) {
      await store.upsertProductScopeProduct(product);
    }
  }
  for (const workspace of snapshot.workspaces) {
    if (!existingWorkspaceIds.has(workspace.id)) {
      await store.upsertProductScopeWorkspace(workspace);
    }
  }
  for (const membership of snapshot.memberships) {
    const key = `${membership.productId}:${membership.workspaceId}:${membership.userId}`;
    if (!existingMembershipKeys.has(key)) {
      await store.upsertMembership(membership);
    }
  }
  for (const alias of snapshot.domainAliases) {
    if (!existingAliasHostnames.has(alias.hostname.toLowerCase())) {
      await store.upsertProductScopeDomainAlias(alias);
    }
  }
  for (const invite of snapshot.invites) {
    if (!existingInviteTokens.has(invite.token)) {
      await store.upsertProductScopeInvite(invite);
    }
  }

  const existingAudit = await store.listAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    type: 'host.product_scope.seeded',
  });
  if (existingAudit.length === 0) {
    await store.recordAudit({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      actorId: 'system',
      type: 'host.product_scope.seeded',
      metadata: {
        products: snapshot.products.map((product) => product.id),
        workspaces: snapshot.workspaces.map((workspace) => workspace.id),
      },
    });
  }
}

export async function ensureHostProductScopeSeeded(store: RuntimeStore): Promise<void> {
  let promise = seedPromises.get(store);
  if (!promise) {
    promise = seedProductScope(store).catch((error) => {
      seedPromises.delete(store);
      throw error;
    });
    seedPromises.set(store, promise);
  }

  await promise;
}

function membershipToProductScope(membership: {
  id: string;
  productId: string;
  workspaceId: string;
  userId: string;
  role: ProductScopeMembership['role'];
  status: ProductScopeMembership['status'];
}): ProductScopeMembership {
  return {
    id: membership.id,
    productId: membership.productId,
    workspaceId: membership.workspaceId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
  };
}

export async function getHostProductScopeSnapshot(): Promise<ProductScopeSnapshot> {
  return cachedDashboardProductScopeSnapshot(async () => {
    const hostRuntime = await getHostRuntime();
    const store = hostRuntime.runtimeStore.store;
    await ensureHostProductScopeSeeded(store);
    const [products, workspaces, memberships, invites, domainAliases] = await Promise.all([
      store.listProductScopeProducts(),
      store.listProductScopeWorkspaces(),
      store.listMemberships(),
      store.listProductScopeInvites(),
      store.listProductScopeDomainAliases(),
    ]);

    return {
      version: 1,
      products: products as ProductScopeProduct[],
      workspaces: workspaces as ProductScopeWorkspace[],
      memberships: memberships.map(membershipToProductScope),
      invites: invites as ProductScopeInvite[],
      domainAliases: domainAliases as ProductScopeDomainAlias[],
    };
  });
}

export async function resolveDemoProductScope(request: Request): Promise<ProductScopeResolution> {
  const session = await resolveHostSessionFromRequest(request);
  return cachedDashboardProductScopeResolution(request, session, async () => {
    const snapshot = await getHostProductScopeSnapshot();
    return resolveProductScope({
      snapshot,
      request,
      session,
      workspaceOverride: readProductScopeCookie(request) ?? undefined,
    });
  });
}

export async function createScopedDemoHostSession(request: Request) {
  const resolution = await resolveDemoProductScope(request);
  return applyProductScopeToSession(await resolveHostSessionFromRequest(request), resolution);
}

export async function listDemoWorkspaces(productId: string) {
  const snapshot = await getHostProductScopeSnapshot();
  return snapshot.workspaces.filter((workspace) => workspace.productId === productId);
}

export function invalidateHostProductScopeCache(): void {
  invalidateDashboardShellCache('product-scope');
}
