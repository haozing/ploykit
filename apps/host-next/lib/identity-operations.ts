import type {
  ModuleHostSession,
  RuntimeStoreAuditRecord,
  RuntimeStoreHostUser,
  RuntimeStoreHostUserRole,
  RuntimeStoreHostUserStatus,
} from '@/lib/module-runtime';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import { ensureHostIdentitySeeded, getHostAuthAdapter, type HostAuthSessionRecord } from './auth';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from './default-scope';
import { sendHostEmail } from './email-provider';
import { DEFAULT_LANGUAGE, localizedPath } from './i18n';
import { hostBaseUrl } from './paths';

export interface HostIdentityOperationsView {
  users: RuntimeStoreHostUser[];
}

export interface HostIdentityUserDetailView {
  user: RuntimeStoreHostUser | null;
  sessions: HostAuthSessionRecord[];
  audit: RuntimeStoreAuditRecord[];
}

function requireAdmin(session: ModuleHostSession): string {
  if (session.user?.role !== 'admin') {
    throw new Error('HOST_IDENTITY_ADMIN_REQUIRED');
  }
  return session.actorId ?? session.userId ?? session.user.id;
}

function auditTouchesUser(record: RuntimeStoreAuditRecord, user: RuntimeStoreHostUser): boolean {
  const metadata = record.metadata;
  return (
    record.actorId === user.id ||
    metadata.userId === user.id ||
    metadata.targetUserId === user.id ||
    metadata.email === user.email ||
    metadata.targetEmail === user.email
  );
}

function sessionTargetsUser(session: ModuleHostSession, userId: string): boolean {
  return session.userId === userId || session.actorId === userId || session.user?.id === userId;
}

function adminSafeUser(user: RuntimeStoreHostUser): RuntimeStoreHostUser {
  return {
    ...user,
    passwordHash: '[REDACTED]',
    metadata: redactSensitive(user.metadata),
  };
}

function adminSafeAudit(record: RuntimeStoreAuditRecord): RuntimeStoreAuditRecord {
  return {
    ...record,
    metadata: redactSensitive(record.metadata),
  };
}

async function countActiveAdmins(productId: string): Promise<number> {
  const hostRuntime = await getHostRuntime();
  const users = await hostRuntime.runtimeStore.store.listHostUsers({ productId });
  return users.filter((user) => user.role === 'admin' && user.status === 'active').length;
}

export async function getHostIdentityOperationsView(): Promise<HostIdentityOperationsView> {
  const hostRuntime = await getHostRuntime();
  await ensureHostIdentitySeeded(hostRuntime.runtimeStore.store);
  return {
    users: (
      await hostRuntime.runtimeStore.store.listHostUsers({
        productId: DEFAULT_HOST_PRODUCT_ID,
      })
    ).map(adminSafeUser),
  };
}

export async function getHostIdentityUserDetail(
  userId: string
): Promise<HostIdentityUserDetailView> {
  const hostRuntime = await getHostRuntime();
  await ensureHostIdentitySeeded(hostRuntime.runtimeStore.store);
  const user = await hostRuntime.runtimeStore.store.getHostUser(userId);
  if (!user) {
    return { user: null, sessions: [], audit: [] };
  }

  const [sessions, audit] = await Promise.all([
    (await getHostAuthAdapter()).listSessions(user.id),
    hostRuntime.runtimeStore.store.listAudit({ productId: user.productId }),
  ]);
  return {
    user: adminSafeUser(user),
    sessions,
    audit: audit.filter((record) => auditTouchesUser(record, user)).slice(0, 50).map(adminSafeAudit),
  };
}

export async function setHostUserStatus(
  session: ModuleHostSession,
  userId: string,
  status: RuntimeStoreHostUserStatus,
  reason = 'Updated by admin'
) {
  const actorId = requireAdmin(session);
  const hostRuntime = await getHostRuntime();
  await ensureHostIdentitySeeded(hostRuntime.runtimeStore.store);
  const existing = await hostRuntime.runtimeStore.store.getHostUser(userId);
  if (!existing) {
    throw new Error(`HOST_IDENTITY_USER_NOT_FOUND: ${userId}`);
  }
  if (sessionTargetsUser(session, userId) && status !== 'active') {
    throw new Error('HOST_IDENTITY_SELF_STATUS_FORBIDDEN');
  }
  if (
    existing.role === 'admin' &&
    existing.status === 'active' &&
    status !== 'active' &&
    (await countActiveAdmins(existing.productId)) <= 1
  ) {
    throw new Error('HOST_IDENTITY_LAST_ADMIN_FORBIDDEN');
  }
  const user = await hostRuntime.runtimeStore.store.updateHostUserStatus(userId, status, {
    reason,
    actorId,
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: user.productId,
    workspaceId: user.workspaceId,
    actorId,
    type: 'host.identity.user_status.updated',
    metadata: {
      userId,
      previousStatus: existing.status,
      nextStatus: status,
      reason,
    },
  });
  return user;
}

export async function requestHostUserPasswordReset(
  session: ModuleHostSession,
  userId: string,
  reason = 'Requested by admin'
) {
  const actorId = requireAdmin(session);
  const hostRuntime = await getHostRuntime();
  await ensureHostIdentitySeeded(hostRuntime.runtimeStore.store);
  const user = await hostRuntime.runtimeStore.store.getHostUser(userId);
  if (!user) {
    throw new Error(`HOST_IDENTITY_USER_NOT_FOUND: ${userId}`);
  }
  const result = await (await getHostAuthAdapter()).requestPasswordReset(user.email);
  if (result.sent && result.resetToken) {
    const resetUrl = new URL(localizedPath(DEFAULT_LANGUAGE, '/reset-password'), hostBaseUrl());
    resetUrl.searchParams.set('token', result.resetToken);
    await sendHostEmail({
      to: user.email,
      subject: 'Reset your PloyKit password',
      text: `Open this link to reset your password:\n\n${resetUrl.toString()}`,
      metadata: { source: 'admin.passwordReset', userId: user.id },
      productId: user.productId,
      workspaceId: user.workspaceId ?? DEFAULT_HOST_WORKSPACE_ID,
      actorId,
    });
  }
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: user.productId,
    workspaceId: user.workspaceId,
    actorId,
    type: 'host.identity.password_reset.requested_by_admin',
    metadata: {
      targetUserId: user.id,
      targetEmail: user.email,
      sent: result.sent,
      deliveryRequested: Boolean(result.resetToken),
      reason,
    },
  });
  return { sent: result.sent };
}

export async function revokeHostUserSession(
  session: ModuleHostSession,
  userId: string,
  sessionId: string,
  reason = 'Revoked by admin'
) {
  const actorId = requireAdmin(session);
  const hostRuntime = await getHostRuntime();
  await ensureHostIdentitySeeded(hostRuntime.runtimeStore.store);
  const user = await hostRuntime.runtimeStore.store.getHostUser(userId);
  if (!user) {
    throw new Error(`HOST_IDENTITY_USER_NOT_FOUND: ${userId}`);
  }
  await (await getHostAuthAdapter()).revokeSession(user.id, sessionId);
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: user.productId,
    workspaceId: user.workspaceId,
    actorId,
    type: 'host.identity.session.revoked_by_admin',
    metadata: {
      targetUserId: user.id,
      sessionId,
      reason,
    },
  });
}

export async function setHostUserRole(
  session: ModuleHostSession,
  userId: string,
  role: RuntimeStoreHostUserRole,
  reason = 'Updated by admin'
) {
  const actorId = requireAdmin(session);
  const hostRuntime = await getHostRuntime();
  await ensureHostIdentitySeeded(hostRuntime.runtimeStore.store);
  const existing = await hostRuntime.runtimeStore.store.getHostUser(userId);
  if (!existing) {
    throw new Error(`HOST_IDENTITY_USER_NOT_FOUND: ${userId}`);
  }
  if (existing.role === 'admin' && role !== 'admin') {
    if (sessionTargetsUser(session, userId)) {
      throw new Error('HOST_IDENTITY_SELF_ROLE_FORBIDDEN');
    }
    if (existing.status === 'active' && (await countActiveAdmins(existing.productId)) <= 1) {
      throw new Error('HOST_IDENTITY_LAST_ADMIN_FORBIDDEN');
    }
  }
  const user = await hostRuntime.runtimeStore.store.upsertHostUser({
    ...existing,
    role,
    workspaceRole: role === 'admin' ? 'owner' : existing.workspaceRole,
    permissions: role === 'admin' ? undefined : existing.permissions,
    metadata: {
      ...existing.metadata,
      roleUpdatedBy: actorId,
      roleUpdatedReason: reason,
    },
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: user.productId,
    workspaceId: user.workspaceId,
    actorId,
    type: 'host.identity.user_role.updated',
    metadata: {
      userId,
      previousRole: existing.role,
      nextRole: role,
      reason,
    },
  });
  return user;
}
