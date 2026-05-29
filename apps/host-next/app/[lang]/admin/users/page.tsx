import type { RuntimeStoreHostUserRole, RuntimeStoreHostUserStatus } from '@/lib/module-runtime';
import { AdminUsersOperationsPage } from '@host/components/admin/AdminPages';
import {
  getHostIdentityOperationsView,
  setHostUserRole,
  setHostUserStatus,
} from '@host/lib/identity-operations';
import { createAdminAction } from '@host/lib/admin-action';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

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

const updateUserStatusAction = createAdminAction({
  id: 'users.list.updateStatus',
  parse: (formData) => ({
    userId: readRequiredFormString(formData, 'userId'),
    status: readUserStatus(formData),
    reason: String(formData.get('reason') ?? 'Admin users operation'),
  }),
  run: async ({ session, input }) =>
    setHostUserStatus(session, input.userId, input.status, input.reason),
  revalidate: () => ['/admin/users', '/admin/settings'],
  audit: {
    metadata: ({ input }) => ({
      userId: input.userId,
      status: input.status,
      reason: input.reason,
    }),
  },
});

const updateUserRoleAction = createAdminAction({
  id: 'users.list.updateRole',
  parse: (formData) => ({
    userId: readRequiredFormString(formData, 'userId'),
    role: readUserRole(formData),
    reason: String(formData.get('reason') ?? 'Admin role operation'),
  }),
  run: async ({ session, input }) => setHostUserRole(session, input.userId, input.role, input.reason),
  revalidate: () => ['/admin/users', '/admin/settings'],
  audit: {
    metadata: ({ input }) => ({
      userId: input.userId,
      role: input.role,
      reason: input.reason,
    }),
  },
});

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/users');
  const query = await readAdminTableQuery(searchParams);
  const view = await getHostIdentityOperationsView();
  return (
    <AdminUsersOperationsPage
      lang={lang}
      users={view.users}
      updateUserStatusAction={updateUserStatusAction}
      updateUserRoleAction={updateUserRoleAction}
      query={query}
    />
  );
}
