import { ShieldCheck, UserCheck, UserRoundX, Users } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { Pagination } from '@host/components/ui';
import { ActionQueue, AdminPanel, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminUsersCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreHostUser } from '@/lib/module-runtime';
import {
  adminListHref,
  cleanIdentityTableQuery,
  matchesExactFilter,
  matchesTextSearch,
  userAuthSummary,
} from './IdentityPageModel';
import { FilterResultHint, type AdminFormAction } from './UsersDirectoryModel';
import { UsersDirectoryFilters } from './UsersDirectoryFilters';
import { UsersDirectoryRecords } from './UsersDirectoryRecords';

export function AdminUsersOperationsPage({
  lang,
  users,
  updateUserStatusAction,
  updateUserRoleAction,
  query,
}: {
  lang: SupportedLanguage;
  users: readonly RuntimeStoreHostUser[];
  updateUserStatusAction: AdminFormAction;
  updateUserRoleAction: AdminFormAction;
  query?: AdminTableQuery;
}) {
  void updateUserStatusAction;
  void updateUserRoleAction;

  const copy = getAdminUsersCopy(lang);
  const tableQuery = cleanIdentityTableQuery(query);
  const filteredUsers = users.filter(
    (user) =>
      matchesTextSearch(tableQuery.q, [
        user.id,
        user.email,
        user.role,
        user.status,
        user.workspaceId,
        user.workspaceRole,
      ]) &&
      matchesExactFilter(tableQuery.status, user.status) &&
      matchesExactFilter(tableQuery.role, user.role)
  );
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const suspendedUsers = users.filter((user) => user.status === 'suspended').length;
  const adminUsers = users.filter((user) => user.role === 'admin').length;
  const pendingUsers = users.filter((user) => user.status === 'pending-verification').length;
  const verificationMailIssues = users.filter(
    (user) => user.status === 'pending-verification' && !userAuthSummary(user).verificationMailAt
  );
  const adminChangedUsers = users.filter((user) => Boolean(userAuthSummary(user).adminEditedAt));
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / tableQuery.pageSize));
  const page = Math.min(Math.max(tableQuery.page, 1), totalPages);
  const pageStart = (page - 1) * tableQuery.pageSize;
  const pageUsers = filteredUsers.slice(pageStart, pageStart + tableQuery.pageSize);
  const reviewItems = [
    suspendedUsers > 0
      ? {
          key: 'suspended-users',
          title: copy.suspendedTitle,
          description: copy.suspendedDescription(suspendedUsers),
          actionLabel: copy.reviewUsers,
          href: localizedPath(lang, '/admin/users?status=suspended'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    pendingUsers > 0
      ? {
          key: 'pending-users',
          title: copy.pendingTitle,
          description: copy.pendingDescription(pendingUsers),
          actionLabel: copy.filterPending,
          href: localizedPath(lang, '/admin/users?status=pending-verification'),
          status: 'pending',
          tone: 'info' as const,
        }
      : null,
    verificationMailIssues.length > 0
      ? {
          key: 'verification-mail-issues',
          title: adminInlineText(lang, 'verification_mail_missing_b5785888'),
          description: adminInlineText(
            lang,
            'value_pending_accounts_have_no_visible_email_verific_a35c816b',
            { value1: verificationMailIssues.length }
          ),
          actionLabel: adminInlineText(lang, 'view_pending_1836a271'),
          href: localizedPath(lang, '/admin/users?status=pending-verification'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    adminChangedUsers.length > 0
      ? {
          key: 'admin-changes',
          title: adminInlineText(lang, 'admin_changes_f42c9853'),
          description: adminInlineText(
            lang,
            'value_users_carry_roleupdatedby_roleupdatedreason_me_822e988c',
            { value1: adminChangedUsers.length }
          ),
          actionLabel: adminInlineText(lang, 'review_changes_a3c66d43'),
          href: localizedPath(lang, '/admin/audit?type=host.identity.user_role.updated'),
          status: 'review',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={copy.totalUsers}
          value={String(users.length)}
          helper={copy.visible(filteredUsers.length)}
          tone="blue"
          icon={Users}
        />
        <StatCard
          label={copy.active}
          value={String(activeUsers)}
          helper={copy.activeHelper(
            users.length > 0 ? Math.round((activeUsers / users.length) * 100) : 0
          )}
          tone="green"
          icon={UserCheck}
        />
        <StatCard
          label={copy.suspended}
          value={String(suspendedUsers)}
          helper={copy.suspendedHelper}
          tone={suspendedUsers > 0 ? 'amber' : 'neutral'}
          icon={UserRoundX}
        />
        <StatCard
          label={copy.admins}
          value={String(adminUsers)}
          helper={copy.adminsHelper}
          tone="blue"
          icon={ShieldCheck}
        />
      </StatGrid>

      {reviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={copy.reviewTitle}
          description={copy.reviewDescription}
          status="warning"
          items={reviewItems}
        />
      ) : null}

      <AdminPanel
        title={copy.directoryTitle}
        description={copy.directoryDescription}
        contentClassName="p-0"
      >
        <UsersDirectoryFilters lang={lang} tableQuery={tableQuery} />
        <div className="px-4 py-3 sm:px-5">
          <FilterResultHint lang={lang} visible={filteredUsers.length} total={users.length} />
        </div>
        <UsersDirectoryRecords lang={lang} pageUsers={pageUsers} />
      </AdminPanel>

      <Pagination
        page={page}
        totalPages={totalPages}
        previousHref={
          page > 1 ? adminListHref(lang, '/admin/users', tableQuery, page - 1) : undefined
        }
        nextHref={
          page < totalPages ? adminListHref(lang, '/admin/users', tableQuery, page + 1) : undefined
        }
      />
    </WorkspaceShell>
  );
}
