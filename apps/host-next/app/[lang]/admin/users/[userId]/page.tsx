import type { RuntimeStoreHostUserRole, RuntimeStoreHostUserStatus } from '@/lib/module-runtime';
import { AdminUserDetailOperationsPage } from '@host/components/admin/AdminPages';
import {
  getHostIdentityUserDetail,
  requestHostUserPasswordReset,
  revokeHostUserSession,
  setHostUserRole,
  setHostUserStatus,
} from '@host/lib/identity-operations';
import { createAdminAction } from '@host/lib/admin-action';
import { revalidateLocalizedPaths } from '@host/lib/request-context';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import type { SupportedLanguage } from '@host/lib/i18n';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

function readUserStatus(formData: FormData): RuntimeStoreHostUserStatus {
  const status = readRequiredFormString(formData, 'status');
  if (
    status === 'active' ||
    status === 'suspended' ||
    status === 'deleted' ||
    status === 'pending-verification'
  ) {
    return status;
  }
  throw new Error(`ADMIN_USER_STATUS_UNSUPPORTED: ${status}`);
}

function readUserRole(formData: FormData): RuntimeStoreHostUserRole {
  const role = readRequiredFormString(formData, 'role');
  if (role === 'admin' || role === 'user') {
    return role;
  }
  throw new Error(`ADMIN_USER_ROLE_UNSUPPORTED: ${role}`);
}

function revalidateUserDetail(lang: SupportedLanguage, userId: string) {
  revalidateLocalizedPaths(lang, ['/admin/users', `/admin/users/${userId}`, '/admin/audit']);
}

const updateUserStatusAction = createAdminAction({
  id: 'users.updateStatus',
  parse: (formData) => ({
    userId: readRequiredFormString(formData, 'userId'),
    status: readUserStatus(formData),
    reason: String(formData.get('reason') ?? 'Admin user detail operation'),
  }),
  run: ({ session, input }) =>
    setHostUserStatus(session, input.userId, input.status, input.reason),
  revalidate: ({ input }) => ['/admin/users', `/admin/users/${input.userId}`, '/admin/audit'],
  audit: {
    metadata: ({ input }) => ({
      targetUserId: input.userId,
      status: input.status,
      reason: input.reason,
    }),
  },
});

const updateUserRoleAction = createAdminAction({
  id: 'users.updateRole',
  parse: (formData) => ({
    userId: readRequiredFormString(formData, 'userId'),
    role: readUserRole(formData),
    reason: String(formData.get('reason') ?? 'Admin user detail role operation'),
  }),
  run: ({ session, input }) => setHostUserRole(session, input.userId, input.role, input.reason),
  revalidate: ({ input }) => ['/admin/users', `/admin/users/${input.userId}`, '/admin/audit'],
  audit: {
    metadata: ({ input }) => ({
      targetUserId: input.userId,
      role: input.role,
      reason: input.reason,
    }),
  },
});

const requestPasswordResetAction = createAdminAction({
  id: 'users.passwordReset',
  parse: (formData) => ({
    userId: readRequiredFormString(formData, 'userId'),
    reason: String(formData.get('reason') ?? 'Admin password reset operation'),
  }),
  run: ({ session, input }) =>
    requestHostUserPasswordReset(session, input.userId, input.reason),
  revalidate: ({ input }) => ['/admin/users', `/admin/users/${input.userId}`, '/admin/audit'],
  audit: {
    metadata: ({ input }) => ({
      targetUserId: input.userId,
      reason: input.reason,
    }),
  },
});

const revokeSessionAction = createAdminAction({
  id: 'users.revokeSession',
  parse: (formData) => ({
    userId: readRequiredFormString(formData, 'userId'),
    sessionId: readRequiredFormString(formData, 'sessionId'),
    reason: String(formData.get('reason') ?? 'Admin session revoke operation'),
  }),
  run: ({ session, input }) =>
    revokeHostUserSession(session, input.userId, input.sessionId, input.reason),
  revalidate: ({ input }) => ['/admin/users', `/admin/users/${input.userId}`, '/admin/audit'],
  audit: {
    metadata: ({ input }) => ({
      targetUserId: input.userId,
      targetSessionId: input.sessionId,
      reason: input.reason,
    }),
  },
});

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<LanguageRouteParams & { userId: string }>;
}) {
  const routeParams = await params;
  const [lang] = await readLanguageAndRequireAdmin(Promise.resolve(routeParams), '/admin/users');
  const detail = await getHostIdentityUserDetail(routeParams.userId);
  return (
    <AdminUserDetailOperationsPage
      lang={lang}
      detail={detail}
      updateUserStatusAction={updateUserStatusAction}
      updateUserRoleAction={updateUserRoleAction}
      requestPasswordResetAction={requestPasswordResetAction}
      revokeSessionAction={revokeSessionAction}
    />
  );
}
