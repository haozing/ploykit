import { randomBytes } from 'node:crypto';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeMembership,
  ProductScopeWorkspace,
} from '@/lib/module-runtime/scope/product-scope-types';
import type {
  RuntimeStoreHostUser,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { getHostRuntime } from './create-host';
import { defaultProductId } from './default-scope';
import {
  ensureHostProductScopeSeeded,
  invalidateHostProductScopeCache,
} from './product-scope';

type WorkspaceRole = ProductScopeMembership['role'];
type WorkspaceCreationPolicy = 'admin_only' | 'authenticated' | 'product_member';

const elevatedWorkspaceRoles = new Set<WorkspaceRole>(['owner', 'admin']);

function workspaceCreationPolicy(): WorkspaceCreationPolicy {
  const raw = (
    process.env.PLOYKIT_WORKSPACE_CREATION_POLICY ??
    process.env.PLOYKIT_WORKSPACE_CREATE_POLICY ??
    'admin_only'
  ).toLowerCase();
  return raw === 'authenticated' || raw === 'product_member' || raw === 'admin_only'
    ? raw
    : 'admin_only';
}

async function storeWithSeed() {
  const hostRuntime = await getHostRuntime();
  await ensureHostProductScopeSeeded(hostRuntime.runtimeStore.store);
  return hostRuntime.runtimeStore.store;
}

function userIdFromSession(session: ModuleHostSession): string {
  const userId = session.userId ?? session.user?.id;
  if (!userId) {
    throw new Error('HOST_USER_REQUIRED');
  }
  return userId;
}

function canManageWorkspace(session: ModuleHostSession, membership?: ProductScopeMembership | null) {
  return session.user?.role === 'admin' || Boolean(membership && elevatedWorkspaceRoles.has(membership.role));
}

async function currentMembership(session: ModuleHostSession, workspaceId: string) {
  const store = await storeWithSeed();
  const memberships = await store.listMemberships({
    workspaceId,
    userId: userIdFromSession(session),
  });
  return memberships.find((membership) => membership.status === 'active') ?? null;
}

async function workspaceAccessContext(session: ModuleHostSession, workspaceId: string) {
  const store = await storeWithSeed();
  const workspace = (await store.listProductScopeWorkspaces({ workspaceId }))[0];
  if (!workspace) {
    throw new Error('WORKSPACE_NOT_FOUND');
  }
  const memberships = await store.listMemberships({
    workspaceId,
    userId: userIdFromSession(session),
  });
  const membership = memberships.find((item) => item.status === 'active') ?? null;
  return { store, workspace, membership };
}

async function auditScope(
  session: ModuleHostSession,
  workspaceId: string | null | undefined,
  type: string,
  metadata: Record<string, unknown>
) {
  const store = await storeWithSeed();
  await store.recordAudit({
    productId:
      typeof metadata.productId === 'string'
        ? metadata.productId
        : defaultProductId(session.productId),
    workspaceId,
    actorId: session.actorId ?? session.userId ?? session.user?.id,
    type,
    metadata,
  });
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function notifyWorkspaceManagers(
  workspaceId: string,
  type: string,
  payload: Record<string, unknown>
) {
  const store = await storeWithSeed();
  const memberships = await store.listMemberships({ workspaceId });
  const managers = memberships.filter(
    (membership) => membership.status === 'active' && elevatedWorkspaceRoles.has(membership.role)
  );
  for (const membership of managers) {
    const user = await store.getHostUser(membership.userId);
    if (!user) {
      continue;
    }
    const notifications = metadataRecord(user.metadata.productScopeNotifications);
    const events = Array.isArray(notifications.events) ? notifications.events : [];
    await store.upsertHostUser({
      ...user,
      metadata: {
        ...user.metadata,
        productScopeNotifications: {
          ...notifications,
          events: [
            {
              id: `${type}:${workspaceId}:${Date.now()}`,
              type,
              workspaceId,
              createdAt: new Date().toISOString(),
              payload,
            },
            ...events,
          ].slice(0, 50),
        },
      },
    });
  }
}

export async function getCurrentProductScope(session: ModuleHostSession) {
  const store = await storeWithSeed();
  const [products, workspaces, memberships] = await Promise.all([
    store.listProductScopeProducts(),
    store.listProductScopeWorkspaces(),
    store.listMemberships({ productId: session.productId, userId: userIdFromSession(session) }),
  ]);
  const allMemberships = session.user?.role === 'admin'
    ? await store.listMemberships()
    : await store.listMemberships({ userId: userIdFromSession(session) });
  const activeMemberships = allMemberships.filter((membership) => membership.status === 'active');
  return {
    product: products.find((product) => product.id === session.productId) ?? null,
    workspace: workspaces.find((workspace) => workspace.id === session.workspaceId) ?? null,
    products: products.filter((product) =>
      activeMemberships.some((membership) => membership.productId === product.id)
    ),
    workspaces: workspaces.filter((workspace) =>
      activeMemberships.some((membership) => membership.workspaceId === workspace.id)
    ),
    membership:
      memberships.find(
        (membership) =>
          membership.workspaceId === session.workspaceId && membership.status === 'active'
      ) ?? null,
  };
}

export async function switchCurrentWorkspace(session: ModuleHostSession, workspaceId: string) {
  const store = await storeWithSeed();
  const memberships = await store.listMemberships({
    workspaceId,
    userId: userIdFromSession(session),
  });
  const membership = memberships.find((item) => item.status === 'active');
  if (!membership) {
    throw new Error('WORKSPACE_MEMBERSHIP_REQUIRED');
  }
  const user = await store.getHostUser(userIdFromSession(session));
  if (!user) {
    throw new Error('HOST_USER_NOT_FOUND');
  }
  const workspace = (await store.listProductScopeWorkspaces({
    productId: membership.productId,
    workspaceId,
  }))[0];
  if (!workspace) {
    throw new Error('WORKSPACE_NOT_FOUND');
  }
  const nextUser: RuntimeStoreHostUser = await store.upsertHostUser({
    ...user,
    productId: membership.productId,
    workspaceId,
    workspaceRole: membership.role,
    metadata: {
      ...user.metadata,
      lastWorkspaceSwitchAt: new Date().toISOString(),
    },
  });
  await auditScope(session, workspaceId, 'host.product_scope.workspace_switched', {
    userId: nextUser.id,
    productId: membership.productId,
    workspaceId,
  });
  invalidateHostProductScopeCache();
  return getCurrentProductScope({
    ...session,
    productId: membership.productId,
    workspaceId,
    workspaceRole: membership.role,
  });
}

export async function listProductScopeProducts(session: ModuleHostSession) {
  const store = await storeWithSeed();
  const [products, memberships] = await Promise.all([
    store.listProductScopeProducts(),
    session.user?.role === 'admin'
      ? store.listMemberships()
      : store.listMemberships({ userId: userIdFromSession(session) }),
  ]);
  const activeProductIds = new Set(
    memberships
      .filter((membership) => membership.status === 'active')
      .map((membership) => membership.productId)
  );
  return products.filter((product) => activeProductIds.has(product.id));
}

export async function listProductScopeWorkspaces(session: ModuleHostSession, productId?: string) {
  const store = await storeWithSeed();
  const [workspaces, memberships] = await Promise.all([
    store.listProductScopeWorkspaces({ productId }),
    session.user?.role === 'admin'
      ? store.listMemberships({ productId })
      : store.listMemberships({ productId, userId: userIdFromSession(session) }),
  ]);
  const activeWorkspaceIds = new Set(
    memberships
      .filter((membership) => membership.status === 'active')
      .map((membership) => membership.workspaceId)
  );
  return workspaces.filter((workspace) => activeWorkspaceIds.has(workspace.id));
}

export async function createProductScopeWorkspace(
  session: ModuleHostSession,
  input: { productId: string; name: string; slug: string }
): Promise<ProductScopeWorkspace> {
  const store = await storeWithSeed();
  const policy = workspaceCreationPolicy();
  const userId = userIdFromSession(session);
  if (session.user?.role !== 'admin') {
    if (policy === 'admin_only') {
      throw new Error('PRODUCT_ADMIN_REQUIRED');
    }
    if (policy === 'product_member') {
      const memberships = await store.listMemberships({
        productId: input.productId,
        userId,
      });
      if (!memberships.some((membership) => membership.status === 'active')) {
        throw new Error('PRODUCT_MEMBERSHIP_REQUIRED');
      }
    }
  }
  const workspace = await store.upsertProductScopeWorkspace({
    id: `${input.productId}-${input.slug}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
    productId: input.productId,
    name: input.name,
    slug: input.slug,
  });
  await store.upsertMembership({
    productId: workspace.productId,
    workspaceId: workspace.id,
    userId,
    role: 'owner',
    status: 'active',
  });
  await auditScope(session, workspace.id, 'host.product_scope.workspace_created', {
    productId: workspace.productId,
    workspaceId: workspace.id,
  });
  invalidateHostProductScopeCache();
  return workspace;
}

export async function listProductScopeDomainAliases(session: ModuleHostSession) {
  const store = await storeWithSeed();
  const aliases = await store.listProductScopeDomainAliases();
  if (session.user?.role === 'admin') {
    return aliases;
  }
  const memberships = await store.listMemberships({ userId: userIdFromSession(session) });
  const manageableWorkspaces = new Set(
    memberships
      .filter((membership) => membership.status === 'active' && elevatedWorkspaceRoles.has(membership.role))
      .map((membership) => `${membership.productId}:${membership.workspaceId}`)
  );
  return aliases.filter((alias) =>
    alias.workspaceId
      ? manageableWorkspaces.has(`${alias.productId}:${alias.workspaceId}`)
      : memberships.some(
          (membership) =>
            membership.status === 'active' &&
            membership.productId === alias.productId &&
            elevatedWorkspaceRoles.has(membership.role)
        )
  );
}

export async function upsertProductScopeDomainAlias(
  session: ModuleHostSession,
  input: { hostname: string; productId: string; workspaceId?: string }
): Promise<ProductScopeDomainAlias> {
  const store = await storeWithSeed();
  let membership: ProductScopeMembership | null = null;
  if (input.workspaceId) {
    const workspace = (await store.listProductScopeWorkspaces({ workspaceId: input.workspaceId }))[0];
    if (!workspace) {
      throw new Error('WORKSPACE_NOT_FOUND');
    }
    if (workspace.productId !== input.productId) {
      throw new Error('WORKSPACE_PRODUCT_MISMATCH');
    }
    membership = await currentMembership(session, input.workspaceId);
  }
  if (session.user?.role !== 'admin') {
    if (!canManageWorkspace(session, membership) || membership?.productId !== input.productId) {
      throw new Error('WORKSPACE_ADMIN_REQUIRED');
    }
  }
  const alias = await store.upsertProductScopeDomainAlias({
    hostname: input.hostname.trim().toLowerCase(),
    productId: input.productId,
    workspaceId: input.workspaceId,
  });
  await auditScope(session, input.workspaceId ?? session.workspaceId ?? null, 'host.product_scope.domain_alias_upserted', {
    hostname: alias.hostname,
    productId: alias.productId,
    workspaceId: alias.workspaceId,
  });
  invalidateHostProductScopeCache();
  return alias;
}

export async function listWorkspaceMembers(session: ModuleHostSession, workspaceId: string) {
  const { store, workspace, membership } = await workspaceAccessContext(session, workspaceId);
  if (!membership && session.user?.role !== 'admin') {
    throw new Error('WORKSPACE_MEMBERSHIP_REQUIRED');
  }
  const [memberships, users] = await Promise.all([
    store.listMemberships({ productId: workspace.productId, workspaceId }),
    store.listHostUsers({ productId: workspace.productId }),
  ]);
  return memberships.map((member) => ({
    ...member,
    user: users.find((user) => user.id === member.userId)
      ? {
          id: member.userId,
          email: users.find((user) => user.id === member.userId)?.email,
          role: users.find((user) => user.id === member.userId)?.role,
          status: users.find((user) => user.id === member.userId)?.status,
        }
      : null,
  }));
}

export async function upsertWorkspaceMember(
  session: ModuleHostSession,
  workspaceId: string,
  input: { userId: string; role: WorkspaceRole; status?: ProductScopeMembership['status'] }
) {
  const { store, workspace, membership } = await workspaceAccessContext(session, workspaceId);
  if (!canManageWorkspace(session, membership)) {
    throw new Error('WORKSPACE_ADMIN_REQUIRED');
  }
  const member = await store.upsertMembership({
    productId: workspace.productId,
    workspaceId,
    userId: input.userId,
    role: input.role,
    status: input.status ?? 'active',
  });
  await auditScope(session, workspaceId, 'host.product_scope.member_upserted', {
    productId: workspace.productId,
    userId: input.userId,
    role: input.role,
    status: member.status,
  });
  invalidateHostProductScopeCache();
  return member;
}

export async function listWorkspaceInvitations(session: ModuleHostSession, workspaceId: string) {
  const { store, workspace, membership } = await workspaceAccessContext(session, workspaceId);
  if (!canManageWorkspace(session, membership)) {
    throw new Error('WORKSPACE_ADMIN_REQUIRED');
  }
  return store.listProductScopeInvites({ productId: workspace.productId, workspaceId });
}

export async function createWorkspaceInvitation(
  session: ModuleHostSession,
  workspaceId: string,
  input: { email: string; role: WorkspaceRole }
): Promise<ProductScopeInvite> {
  const { store, workspace, membership } = await workspaceAccessContext(session, workspaceId);
  if (!canManageWorkspace(session, membership)) {
    throw new Error('WORKSPACE_ADMIN_REQUIRED');
  }
  const invite = await store.upsertProductScopeInvite({
    id: `invite-${randomBytes(8).toString('hex')}`,
    productId: workspace.productId,
    workspaceId,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    status: 'pending',
    token: randomBytes(18).toString('base64url'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    invitedBy: userIdFromSession(session),
  });
  await auditScope(session, workspaceId, 'host.product_scope.invite_created', {
    productId: workspace.productId,
    email: invite.email,
    role: invite.role,
  });
  invalidateHostProductScopeCache();
  return invite;
}

export async function updateWorkspaceInvitation(
  session: ModuleHostSession,
  workspaceId: string,
  input: { token: string; action: 'accept' | 'revoke' | 'expire' }
) {
  const { store, workspace, membership } = await workspaceAccessContext(session, workspaceId);
  const invites = await store.listProductScopeInvites({
    productId: workspace.productId,
    workspaceId,
    token: input.token,
  });
  const invite = invites[0];
  if (!invite) {
    throw new Error('INVITE_NOT_FOUND');
  }

  if (input.action === 'accept') {
    const user = await store.getHostUser(userIdFromSession(session));
    if (!user || (user.email !== invite.email && session.user?.role !== 'admin')) {
      throw new Error('INVITE_ACCEPT_FORBIDDEN');
    }
    const accepted = await store.upsertProductScopeInvite({
      ...invite,
      status: 'accepted',
      acceptedBy: user.id,
    });
    await store.upsertMembership({
      productId: invite.productId,
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role,
      status: 'active',
    });
    await auditScope(session, workspaceId, 'host.product_scope.invite_accepted', {
      productId: invite.productId,
      token: invite.token,
      userId: user.id,
    });
    await notifyWorkspaceManagers(invite.workspaceId, 'host.product_scope.invite_accepted', {
      email: invite.email,
      acceptedBy: user.id,
    });
    invalidateHostProductScopeCache();
    return accepted;
  }

  if (!canManageWorkspace(session, membership)) {
    throw new Error('WORKSPACE_ADMIN_REQUIRED');
  }
  const status = input.action === 'revoke' ? 'revoked' : 'expired';
  const updated = await store.upsertProductScopeInvite({
    ...invite,
    status,
  });
  await auditScope(session, workspaceId, `host.product_scope.invite_${status}`, {
    productId: invite.productId,
    token: invite.token,
  });
  invalidateHostProductScopeCache();
  return updated;
}
