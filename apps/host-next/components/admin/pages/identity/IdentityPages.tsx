import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldCheck, UserCheck, UserRoundX, Users } from 'lucide-react';
import {
  adminNav,
  EmptyState,
  FormField,
  StatCard,
  WorkspaceShell,
} from '@host/components/ProductShell';
import {
  ConfirmSubmitButton,
  DataTable,
  Input,
  Pagination,
  Select,
  Switch,
  Toast,
} from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  ActionQueue,
  AdminPanel,
  EvidenceSection,
  EntityListItem,
  FactList,
  PermissionMatrix,
  StatGrid,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatRelativeTime } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminRbacCopy, getAdminUserDetailCopy, getAdminUsersCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  AdminOperationsSnapshot,
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeMembership,
  ProductScopeProduct,
  ProductScopeWorkspace,
  RuntimeStoreAuditRecord,
  RuntimeStoreCommercialOrder,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreFileRecord,
  RuntimeStoreHostUser,
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreNotificationRecord,
  RuntimeStoreUsageRecord,
} from '@/lib/module-runtime';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import type { HostBillingOverview } from '@host/lib/billing-api';
import type { HostConfigDoctorReport } from '@host/lib/config-doctor';
import type { HostFileQuotaStatus, HostFileStorageStatus } from '@host/lib/files';
import type { HostRuntimeHealth } from '@host/lib/host-health';
import type { HostIdentityUserDetailView } from '@host/lib/identity-operations';
import type { HostRuntimeStoreStatus } from '@host/lib/runtime-store';
import type { HostAuthSessionRecord } from '@host/lib/auth';
import type { HostUserPreferences, HostUserProfile } from '@host/lib/user-api';
import type { UserSaasSnapshot } from '@host/lib/saas-operations';
import type {
  AdminCommercialView,
  AdminFileDetailView,
  AdminHostSettingsView,
  AdminModuleDevConsoleView,
  AdminModuleDetailView,
  AdminOperationsViewSnapshot,
  AdminOutboxDetailView,
  AdminRunDetailView,
  AdminServiceConnectionsView,
} from '@host/lib/admin-operations';

type AdminFormAction = (formData: FormData) => void | Promise<void>;
type ProductScopeMemberRow = ProductScopeMembership & {
  user: {
    id: string;
    email?: string;
    role?: string;
    status?: string;
  } | null;
};

interface ProductScopePageScope {
  product: ProductScopeProduct | null;
  workspace: ProductScopeWorkspace | null;
  products: ProductScopeProduct[];
  workspaces: ProductScopeWorkspace[];
  membership: ProductScopeMembership | null;
}

interface AdminPagedResult<T> {
  items: T[];
  page: {
    total: number;
    offset: number;
    limit: number;
  };
}

interface UserAuthSummary {
  emailVerifiedAt?: string;
  verificationMailAt?: string;
  lastSessionAt?: string;
  sessionCount: number;
  adminEditedAt?: string;
  adminEditedBy?: string;
}

interface AdminSearchResult {
  type: string;
  id: string;
  label: string;
}

interface AdminWorkerStatusView {
  workerId: string;
  heartbeatAt: string | null;
  lastDrainAt: string | null;
  queue: {
    queued: number;
    processing: number;
    failed: number;
    deadLettered: number;
    oldestPendingAt: string | null;
    lagMs: number;
  };
  alerts: {
    code: string;
    severity: 'warning' | 'error';
    message: string;
    metric: string;
    threshold: number;
    value: number;
  }[];
}

function EmptyTableRow({ colSpan, lang = 'zh' }: { colSpan: number; lang?: SupportedLanguage }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <span className="text-sm text-admin-text-muted">{adminInlineText(lang, 'No records')}</span>
      </td>
    </tr>
  );
}

function cleanTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

function operationResultToast(lang: SupportedLanguage, query: Required<AdminTableQuery>) {
  if (!query.operation) {
    return null;
  }
  const tone =
    query.outcome === 'warning'
      ? adminInlineText(lang, 'Warning')
      : adminInlineText(lang, 'Completed');
  const skippedParts = [
    query.failed > 0 ? `${adminInlineText(lang, 'failed')} ${query.failed}` : null,
    query.deadLettered > 0
      ? `${adminInlineText(lang, 'dead-lettered')} ${query.deadLettered}`
      : null,
    query.skipped > 0 ? `${adminInlineText(lang, 'skipped')} ${query.skipped}` : null,
  ].filter(Boolean);
  return (
    <Toast title={`${tone}: ${query.operation}`}>
      {adminInlineText(lang, 'matched')} {query.matched} · {adminInlineText(lang, 'processed')}{' '}
      {query.processed}
      {skippedParts.length > 0 ? ` · ${skippedParts.join(' · ')}` : ''}
    </Toast>
  );
}

function adminListHref(
  lang: SupportedLanguage,
  path: string,
  query: Required<AdminTableQuery>,
  page: number
): string {
  const params = new URLSearchParams();
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.role) {
    params.set('role', query.role);
  }
  if (query.type) {
    params.set('type', query.type);
  }
  if (query.moduleId) {
    params.set('moduleId', query.moduleId);
  }
  if (query.service) {
    params.set('service', query.service);
  }
  if (query.workspace) {
    params.set('workspace', query.workspace);
  }
  if (query.environment) {
    params.set('environment', query.environment);
  }
  if (query.range) {
    params.set('range', query.range);
  }
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  if (query.owner) {
    params.set('owner', query.owner);
  }
  if (query.mime) {
    params.set('mime', query.mime);
  }
  if (query.provider) {
    params.set('provider', query.provider);
  }
  if (query.path) {
    params.set('path', query.path);
  }
  if (query.minSize) {
    params.set('minSize', String(query.minSize));
  }
  if (query.maxSize) {
    params.set('maxSize', String(query.maxSize));
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  if (query.pageSize !== 20) {
    params.set('pageSize', String(query.pageSize));
  }
  const search = params.toString();
  return `${localizedPath(lang, path)}${search ? `?${search}` : ''}`;
}

function matchesTextSearch(query: string, values: readonly unknown[]): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

function userAuthSummary(user: RuntimeStoreHostUser): UserAuthSummary {
  const metadata = user.metadata as Record<string, unknown>;
  const auth = metadata.auth;
  const authRecord =
    auth && typeof auth === 'object' && !Array.isArray(auth)
      ? (auth as Record<string, unknown>)
      : {};
  const sessions = Array.isArray(authRecord.sessions)
    ? authRecord.sessions.filter((item): item is HostAuthSessionRecord =>
        Boolean(
          item &&
          typeof item === 'object' &&
          typeof (item as HostAuthSessionRecord).id === 'string' &&
          typeof (item as HostAuthSessionRecord).createdAt === 'string' &&
          typeof (item as HostAuthSessionRecord).expiresAt === 'string'
        )
      )
    : [];
  const mailLog = Array.isArray(authRecord.mailLog)
    ? authRecord.mailLog.filter((item): item is { type: string; createdAt: string } => {
        const entry = item as Record<string, unknown>;
        return Boolean(
          entry && typeof entry.type === 'string' && typeof entry.createdAt === 'string'
        );
      })
    : [];
  const verificationMail = mailLog.find((entry) => entry.type === 'email-verification');
  return {
    emailVerifiedAt:
      typeof authRecord.emailVerifiedAt === 'string' ? authRecord.emailVerifiedAt : undefined,
    verificationMailAt: verificationMail?.createdAt,
    lastSessionAt: sessions
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt,
    sessionCount: sessions.length,
    adminEditedAt: typeof metadata.roleUpdatedBy === 'string' ? user.updatedAt : undefined,
    adminEditedBy: typeof metadata.roleUpdatedBy === 'string' ? metadata.roleUpdatedBy : undefined,
  };
}

function userVerificationState(lang: SupportedLanguage, user: RuntimeStoreHostUser) {
  const summary = userAuthSummary(user);
  if (summary.emailVerifiedAt) {
    return adminInlineText(lang, 'verified_7fc41e1e');
  }
  if (user.status === 'pending-verification') {
    return adminInlineText(lang, 'pending_verification_78fb9c4d');
  }
  return adminInlineText(lang, 'unverified_96e125d2');
}

function userReviewReason(lang: SupportedLanguage, user: RuntimeStoreHostUser) {
  const summary = userAuthSummary(user);
  if (user.status === 'pending-verification' && !summary.verificationMailAt) {
    return adminInlineText(lang, 'verification_mail_missing_eeb3fb6e');
  }
  if (summary.adminEditedAt) {
    return adminInlineText(lang, 'admin_change_4f6e3686');
  }
  if (user.status === 'pending-verification') {
    return adminInlineText(lang, 'pending_verification_7d1aa2f3');
  }
  return adminInlineText(lang, 'clear_d6cc40bc');
}

function matchesExactFilter(filter: string, value: unknown): boolean {
  return filter.length === 0 || String(value ?? '') === filter;
}

function uniqueSelectOptions(values: readonly unknown[]) {
  return [...new Set(values.map((value) => String(value ?? '')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

function FilterResultHint({
  lang,
  visible,
  total,
}: {
  lang: SupportedLanguage;
  visible: number;
  total: number;
}) {
  if (visible === total) {
    return null;
  }
  return (
    <p className="muted">
      {adminInlineText(lang, 'current_filter_shows_value_value_records_ffd8ee7a', {
        value1: visible,
        value2: total,
      })}
    </p>
  );
}

const moduleStatusOptions = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'error', label: 'Error' },
  { value: 'not_installed', label: 'Not installed' },
] as const;

const userStatusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'pending-verification', label: 'Pending verification' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Deleted' },
] as const;

const userRoleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
] as const;

const runStatusOptions = [
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancel_requested', label: 'Cancel requested' },
  { value: 'canceled', label: 'Canceled' },
] as const;

const outboxStatusOptions = [
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
  { value: 'dead_letter', label: 'Dead letter' },
  { value: 'archived', label: 'Archived' },
  { value: 'received', label: 'Received' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'rejected', label: 'Rejected' },
] as const;

const connectionStatusOptions = [
  { value: 'ready', label: 'Ready' },
  { value: 'warning', label: 'Warning' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'disabled', label: 'Disabled' },
] as const;

const connectionAuthTypeOptions = [
  { value: 'none', label: 'None' },
  { value: 'apiKey', label: 'API key' },
  { value: 'basic', label: 'Basic' },
  { value: 'oauth', label: 'OAuth' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'env', label: 'Env' },
] as const;

const connectionOwnerTypeOptions = [
  { value: 'system', label: 'System' },
  { value: 'module', label: 'Module' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'user', label: 'User' },
] as const;

const connectionScopeTypeOptions = [
  { value: 'global', label: 'Global' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'user', label: 'User' },
] as const;

const meteringStatusOptions = [
  { value: 'authorized', label: 'Authorized' },
  { value: 'committed', label: 'Committed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'voided', label: 'Voided' },
] as const;

const fileStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'uploading', label: 'Uploading' },
  { value: 'ready', label: 'Ready' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'quarantined', label: 'Quarantined' },
] as const;

const recordTypeOptions = [
  { value: 'audit', label: 'Audit' },
  { value: 'usage', label: 'Usage' },
] as const;

const commercialTypeOptions = [
  { value: 'orders', label: 'Orders' },
  { value: 'entitlements', label: 'Entitlements' },
  { value: 'credits', label: 'Credits' },
] as const;

function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function joinOrNone(values: readonly string[], fallback = 'none'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

function runCanCancel(status: string): boolean {
  return status === 'queued' || status === 'running';
}

function runCanRequeue(status: string): boolean {
  return status === 'failed' || status === 'canceled';
}

function runWaitingExternalReason(run: {
  status: string;
  error?: { code?: string; message?: string };
}) {
  const text = `${run.error?.code ?? ''} ${run.error?.message ?? ''}`.toLowerCase();
  if (
    run.status === 'failed' &&
    ['provider', 'secret', 'stripe', 's3', 'email', 'webhook', 'rate', 'quota', 'external'].some(
      (token) => text.includes(token)
    )
  ) {
    return 'waiting external: provider / secret / quota';
  }
  if (run.status === 'cancel_requested') {
    return 'waiting worker acknowledgement';
  }
  if (run.status === 'queued') {
    return 'waiting worker slot';
  }
  if (run.status === 'running') {
    return 'running';
  }
  if (run.status === 'failed') {
    return run.error?.message ?? 'failed; inspect logs';
  }
  return 'no action required';
}

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
  const copy = getAdminUsersCopy(lang);
  const tableQuery = cleanTableQuery(query);
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
        <form
          method="get"
          className="flex flex-col gap-3 border-b border-admin-border bg-admin-bg/35 px-4 py-3 sm:px-5 lg:flex-row lg:items-end"
        >
          <label className="grid flex-1 gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'Search')}
            </span>
            <Input
              type="search"
              name="q"
              defaultValue={tableQuery.q}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchPlaceholder}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text sm:w-52">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'account_status_17cc03e7')}
            </span>
            <Select
              name="status"
              defaultValue={tableQuery.status}
              aria-label={adminInlineText(lang, 'account_status_17cc03e7')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {userStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {adminInlineText(lang, option.label)}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text sm:w-52">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'host_role_4848d385')}
            </span>
            <Select
              name="role"
              defaultValue={tableQuery.role}
              aria-label={adminInlineText(lang, 'host_role_4848d385')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {userRoleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {adminInlineText(lang, option.label)}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Filter')}
            </button>
            {tableQuery.q || tableQuery.status || tableQuery.role ? (
              <Link
                href={localizedPath(lang, '/admin/users')}
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Clear')}
              </Link>
            ) : null}
          </div>
        </form>
        <div className="px-4 py-3 sm:px-5">
          <FilterResultHint lang={lang} visible={filteredUsers.length} total={users.length} />
        </div>
        <div className="hidden lg:block">
          <DataTable
            className="rounded-none border-x-0 border-b-0 shadow-none"
            columns={adminInlineColumns(lang, [
              'User',
              'Access',
              'Status',
              'Verification',
              'Activity',
              'Created / Updated',
              'Action',
            ])}
            rows={pageUsers.map((user) => {
              const summary = userAuthSummary(user);
              return [
                <div key={`${user.id}:user`} className="min-w-0">
                  <Link
                    href={localizedPath(lang, `/admin/users/${user.id}`)}
                    className="block truncate font-semibold text-admin-primary hover:underline"
                  >
                    {user.email ?? user.id}
                  </Link>
                  <div className="mt-1 truncate text-xs text-admin-text-muted">{user.id}</div>
                </div>,
                <div key={`${user.id}:access`}>
                  <span className="font-medium text-admin-text">
                    {adminInlineText(lang, user.role)}
                  </span>
                  <div className="mt-1 text-xs text-admin-text-muted">
                    {adminInlineText(lang, user.workspaceRole)}
                  </div>
                </div>,
                <StatusBadge key={`${user.id}:status`} lang={lang} value={user.status} />,
                <div key={`${user.id}:verification`} className="grid gap-1">
                  <span className="text-sm text-admin-text">
                    {userVerificationState(lang, user)}
                  </span>
                  <span className="text-xs text-admin-text-muted">
                    {summary.emailVerifiedAt
                      ? `${adminInlineText(lang, 'verified_95165cf5')} ${formatRelativeTime(summary.emailVerifiedAt, lang)}`
                      : summary.verificationMailAt
                        ? `${adminInlineText(lang, 'mail_9e08b3fd')} ${formatRelativeTime(summary.verificationMailAt, lang)}`
                        : adminInlineText(lang, 'no_mail_record_8b6c8250')}
                  </span>
                </div>,
                <div key={`${user.id}:activity`} className="grid gap-1">
                  <span className="text-sm text-admin-text">
                    {summary.lastSessionAt
                      ? `${adminInlineText(lang, 'last_session_b422e3c7')} ${formatRelativeTime(summary.lastSessionAt, lang)}`
                      : adminInlineText(lang, 'no_sessions_b30fd382')}
                  </span>
                  <span className="text-xs text-admin-text-muted">
                    {adminInlineText(lang, 'value_sessions_40272bb0', {
                      value1: summary.sessionCount,
                    })}
                  </span>
                </div>,
                <div key={`${user.id}:timestamps`} className="grid gap-1">
                  <span className="text-sm text-admin-text">
                    {formatRelativeTime(user.createdAt, lang)}
                  </span>
                  <span className="text-xs text-admin-text-muted">
                    {adminInlineText(lang, 'updated_value_ac1856f8', {
                      value1: formatRelativeTime(user.updatedAt, lang),
                    })}
                  </span>
                </div>,
                <div key={`${user.id}:action`} className="flex flex-wrap gap-2">
                  <Link
                    href={localizedPath(lang, `/admin/users/${user.id}`)}
                    className="text-xs font-semibold text-admin-primary hover:underline"
                  >
                    {copy.openDetail}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/billing?q=${encodeURIComponent(user.id)}`)}
                    className="text-xs font-semibold text-admin-primary hover:underline"
                  >
                    {adminInlineText(lang, 'orders_ca187bf2')}
                  </Link>
                  <Link
                    href={localizedPath(
                      lang,
                      `/admin/entitlements?q=${encodeURIComponent(user.id)}`
                    )}
                    className="text-xs font-semibold text-admin-primary hover:underline"
                  >
                    {adminInlineText(lang, 'entitlements_2ca17dc5')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(user.id)}`)}
                    className="text-xs font-semibold text-admin-primary hover:underline"
                  >
                    {adminInlineText(lang, 'audit_de9bcda7')}
                  </Link>
                </div>,
              ];
            })}
            empty={copy.empty}
            minWidthClass="min-w-[1240px]"
          />
        </div>
        <div className="grid gap-2 px-2 py-2 lg:hidden">
          {pageUsers.length > 0 ? (
            pageUsers.map((user) => {
              const summary = userAuthSummary(user);
              return (
                <div
                  key={user.id}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/40 p-2"
                >
                  <EntityListItem
                    lang={lang}
                    href={localizedPath(lang, `/admin/users/${user.id}`)}
                    title={user.email ?? user.id}
                    subtitle={`${adminInlineText(lang, user.role)} · ${adminInlineText(lang, user.workspaceRole)}`}
                    status={user.status}
                    detail={[
                      userVerificationState(lang, user),
                      summary.lastSessionAt
                        ? formatRelativeTime(summary.lastSessionAt, lang)
                        : null,
                      `${formatRelativeTime(user.createdAt, lang)} / ${formatRelativeTime(user.updatedAt, lang)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    meta={user.workspaceId}
                    avatar={
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-admin-primary-soft text-xs font-semibold text-admin-primary ring-1 ring-admin-primary/15">
                        {(user.email ?? user.id).slice(0, 2).toUpperCase()}
                      </span>
                    }
                  />
                  <div className="flex flex-wrap gap-2 px-3 pb-2">
                    <Link
                      href={localizedPath(lang, `/admin/billing?q=${encodeURIComponent(user.id)}`)}
                      className="text-xs font-semibold text-admin-primary hover:underline"
                    >
                      {adminInlineText(lang, 'orders_ca187bf2')}
                    </Link>
                    <Link
                      href={localizedPath(
                        lang,
                        `/admin/entitlements?q=${encodeURIComponent(user.id)}`
                      )}
                      className="text-xs font-semibold text-admin-primary hover:underline"
                    >
                      {adminInlineText(lang, 'entitlements_2ca17dc5')}
                    </Link>
                    <Link
                      href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(user.id)}`)}
                      className="text-xs font-semibold text-admin-primary hover:underline"
                    >
                      {adminInlineText(lang, 'audit_de9bcda7')}
                    </Link>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
              {copy.empty}
            </div>
          )}
        </div>
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

export function AdminUserDetailOperationsPage({
  lang,
  detail,
  updateUserStatusAction,
  updateUserRoleAction,
  requestPasswordResetAction,
  revokeSessionAction,
}: {
  lang: SupportedLanguage;
  detail: HostIdentityUserDetailView;
  updateUserStatusAction: AdminFormAction;
  updateUserRoleAction: AdminFormAction;
  requestPasswordResetAction: AdminFormAction;
  revokeSessionAction: AdminFormAction;
}) {
  const copy = getAdminUserDetailCopy(lang);
  const { user, sessions, audit } = detail;
  const authSummary = user ? userAuthSummary(user) : null;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {user ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <StatGrid>
              <StatCard
                label={copy.role}
                value={user.role}
                tone="blue"
                helper={user.workspaceRole}
                icon={ShieldCheck}
              />
              <StatCard
                label={copy.status}
                value={user.status}
                tone={user.status === 'active' ? 'green' : 'amber'}
                helper={copy.currentState}
                icon={UserCheck}
              />
              <StatCard
                label={copy.workspace}
                value={user.workspaceId}
                helper={user.productId}
                icon={Users}
              />
              <StatCard
                label={copy.sessions}
                value={String(sessions.length)}
                helper={copy.auditRecords(audit.length)}
                icon={UserCheck}
              />
            </StatGrid>

            <AdminPanel
              title={copy.actionsTitle}
              description={copy.actionsDescription}
              contentClassName="grid gap-4"
            >
              <section className="grid gap-4 lg:grid-cols-2">
                <form
                  action={updateUserStatusAction}
                  className="grid gap-4 rounded-admin-md border border-admin-border bg-admin-bg/45 p-4"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-admin-text">{copy.accountStatus}</h3>
                    <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                      {copy.accountStatusHint}
                    </p>
                  </div>
                  <input type="hidden" name="userId" value={user.id} />
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.status}</span>
                    <Select name="status" defaultValue={user.status}>
                      <option value="active">{adminInlineText(lang, 'active')}</option>
                      <option value="suspended">{adminInlineText(lang, 'suspended')}</option>
                      <option value="pending-verification">
                        {adminInlineText(lang, 'pending-verification')}
                      </option>
                      <option value="deleted">{adminInlineText(lang, 'deleted')}</option>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.reason}</span>
                    <Input
                      name="reason"
                      defaultValue="Admin user detail operation"
                      maxLength={200}
                    />
                  </label>
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={copy.updateStatusConfirm(user.email)}
                  >
                    {copy.updateStatus}
                  </ConfirmSubmitButton>
                </form>

                <form
                  action={updateUserRoleAction}
                  className="grid gap-4 rounded-admin-md border border-admin-border bg-admin-bg/45 p-4"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-admin-text">{copy.hostRole}</h3>
                    <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                      {copy.hostRoleHint}
                    </p>
                  </div>
                  <input type="hidden" name="userId" value={user.id} />
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.role}</span>
                    <Select name="role" defaultValue={user.role}>
                      <option value="user">{adminInlineText(lang, 'user')}</option>
                      <option value="admin">{adminInlineText(lang, 'admin')}</option>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.reason}</span>
                    <Input
                      name="reason"
                      defaultValue="Admin user detail role operation"
                      maxLength={200}
                    />
                  </label>
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={copy.updateRoleConfirm(user.email)}
                  >
                    {copy.updateRole}
                  </ConfirmSubmitButton>
                </form>
              </section>

              <form
                action={requestPasswordResetAction}
                className="flex flex-col gap-4 rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="reason" value="Admin password reset operation" />
                <div>
                  <h3 className="text-sm font-semibold text-admin-text">{copy.passwordReset}</h3>
                  <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                    {copy.passwordResetHint}
                  </p>
                </div>
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={copy.sendResetConfirm(user.email)}
                >
                  {copy.sendReset}
                </ConfirmSubmitButton>
              </form>
            </AdminPanel>

            <AdminPanel
              title={copy.diagnosticsTitle}
              description={copy.diagnosticsDescription}
              contentClassName="grid gap-3"
            >
              <EvidenceSection
                title={copy.activeSessions}
                description={copy.activeSessionsDescription}
              >
                <DataTable
                  className="rounded-none border-x-0 shadow-none"
                  columns={copy.sessionColumns}
                  rows={sessions.map((session) => [
                    session.id,
                    session.userAgent ?? 'unknown',
                    session.createdAt,
                    session.expiresAt,
                    <form key={session.id} action={revokeSessionAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input type="hidden" name="reason" value="Admin session revoke operation" />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        confirmation={copy.revokeConfirm(user.email, session.id)}
                      >
                        {copy.revoke}
                      </ConfirmSubmitButton>
                    </form>,
                  ])}
                  empty={copy.noSessions}
                  minWidthClass="min-w-[860px]"
                />
              </EvidenceSection>

              <EvidenceSection title={copy.auditTitle} description={copy.auditDescription}>
                <TimelineList
                  lang={lang}
                  items={audit.map((record) => ({
                    key: record.id,
                    title: record.type,
                    description: compactJson(record.metadata, 180),
                    meta: `${record.actorId ?? 'system'} · ${record.createdAt}`,
                    tone:
                      record.type.includes('revoke') || record.type.includes('suspend')
                        ? 'warning'
                        : 'primary',
                  }))}
                  empty={copy.noAudit}
                />
              </EvidenceSection>

              <EvidenceSection title={copy.metadata} description={copy.metadataDescription}>
                <pre className="max-h-[360px] overflow-auto rounded-admin-sm bg-admin-bg p-3 text-xs leading-5 text-admin-text-muted">
                  {JSON.stringify(user.metadata, null, 2)}
                </pre>
              </EvidenceSection>
            </AdminPanel>
          </div>

          <AdminPanel
            title={copy.drawerTitle}
            description={user.email ?? user.id}
            action={<CopyButton value={user.id} label={copy.copyId} />}
            className="xl:sticky xl:top-24 xl:self-start"
            contentClassName="grid gap-4"
          >
            <FactList
              lang={lang}
              items={[
                { label: 'ID', value: user.id, copyValue: user.id, mono: true },
                { label: 'Email', value: user.email, copyValue: user.email },
                { label: 'Product', value: user.productId, mono: true },
                { label: 'Workspace', value: user.workspaceId, mono: true },
                { label: 'Created', value: user.createdAt },
                { label: 'Updated', value: user.updatedAt },
                { label: 'Email verification', value: userVerificationState(lang, user) },
                { label: 'Verification mail', value: authSummary?.verificationMailAt ?? 'none' },
                { label: 'Last session', value: authSummary?.lastSessionAt ?? 'none' },
                {
                  label: 'Admin change',
                  value: authSummary?.adminEditedBy
                    ? `${authSummary.adminEditedBy} · ${userReviewReason(lang, user)}`
                    : 'none',
                },
              ]}
            />
            <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-3">
              <h3 className="text-sm font-semibold text-admin-text">{copy.reviewRule}</h3>
              <p className="mt-1 text-sm leading-6 text-admin-text-muted">{copy.reviewRuleBody}</p>
            </div>
          </AdminPanel>
        </div>
      ) : (
        <EmptyState
          title={copy.missingTitle}
          actionHref={localizedPath(lang, '/admin/users')}
          actionLabel={copy.back}
        >
          {copy.missingBody}
        </EmptyState>
      )}
    </WorkspaceShell>
  );
}

export function AdminRbacOperationsPage({
  lang,
  roles,
  permissions,
  users = [],
  query,
}: {
  lang: SupportedLanguage;
  roles: readonly {
    id: string;
    label: string;
    builtIn: boolean;
    capabilities: readonly string[];
    modulePermissions: readonly string[];
  }[];
  permissions: {
    hostCapabilities: readonly { id: string; label: string }[];
    modulePermissions: readonly { value: string }[];
  };
  users?: readonly RuntimeStoreHostUser[];
  query?: AdminTableQuery;
}) {
  const copy = getAdminRbacCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const systemRoles = roles.filter((role) => role.builtIn).length;
  const adminRole = roles.find((role) => role.id === 'admin');
  const totalCapabilities = roles.reduce((sum, role) => sum + role.capabilities.length, 0);
  const totalModulePermissions = roles.reduce(
    (sum, role) => sum + role.modulePermissions.length,
    0
  );
  const highRiskAuthorizationCount = (role: (typeof roles)[number]) => {
    const hostRisk = role.capabilities.filter(
      (capability) =>
        capability.includes('write') ||
        capability.includes('manage') ||
        capability === 'admin.users.manage' ||
        capability === 'admin.settings.write'
    ).length;
    const moduleRisk = role.modulePermissions.filter((permission) =>
      /write|delete|manage|admin|billing/i.test(permission)
    ).length;
    return hostRisk + moduleRisk;
  };
  const membersByRole = users.reduce<Record<string, number>>((acc, user) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});
  const matrixRoles = roles.map((role) => ({
    ...role,
    id: role.id,
    label: role.label,
    builtIn: role.builtIn,
    capabilities: role.capabilities,
    modulePermissions: role.modulePermissions,
  }));
  const matrixPermissions = [
    ...permissions.hostCapabilities.map((capability) => ({
      id: capability.id,
      label: capability.label,
      group: 'host' as const,
      category: `Host · ${capability.id.split(/[.:_-]/)[0].replace(/\b\w/g, (value) => value.toUpperCase())}`,
      description: copy.hostCoverage,
    })),
    ...permissions.modulePermissions.map((permission) => ({
      id: permission.value,
      label: permission.value,
      group: 'module' as const,
      category: `Module · ${permission.value.split(/[.:_-]/)[0].replace(/\b\w/g, (value) => value.toUpperCase())}`,
      description: copy.moduleCoverage,
    })),
  ];
  const filteredMatrixPermissions = matrixPermissions.filter(
    (permission) =>
      matchesTextSearch(tableQuery.q, [
        permission.id,
        permission.label,
        permission.category,
        permission.description,
      ]) &&
      (!tableQuery.type || permission.group === tableQuery.type)
  );
  const diffLeft = roles.find((role) => role.id === 'admin') ?? roles[0];
  const diffRight = roles.find((role) => role.id === 'user') ?? roles[1] ?? diffLeft;
  const permissionDiffRows = filteredMatrixPermissions.map((permission) => {
    const leftGranted =
      permission.group === 'host'
        ? diffLeft?.capabilities.includes(permission.id)
        : diffLeft?.modulePermissions.includes(permission.id);
    const rightGranted =
      permission.group === 'host'
        ? diffRight?.capabilities.includes(permission.id)
        : diffRight?.modulePermissions.includes(permission.id);
    return [
      <span key={`${permission.id}:permission`} className="block min-w-0">
        <span className="block truncate font-semibold text-admin-text">{permission.label}</span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
          {permission.id}
        </span>
      </span>,
      leftGranted ? adminInlineText(lang, 'yes') : '-',
      rightGranted ? adminInlineText(lang, 'yes') : '-',
      leftGranted === rightGranted
        ? adminInlineText(lang, 'same_c8958a49')
        : adminInlineText(lang, 'diff_f5d65d73'),
    ];
  });
  const coverageTimeline = [
    {
      key: 'roles',
      title: copy.roleSnapshot,
      description: copy.roleSnapshotDescription(roles.length, systemRoles),
      meta: copy.roleSnapshotMeta(totalCapabilities, totalModulePermissions),
      tone: 'primary' as const,
    },
    {
      key: 'host',
      title: copy.hostInventory,
      description: copy.hostInventoryDescription(permissions.hostCapabilities.length),
      meta: copy.currentMatrix,
      tone: 'info' as const,
    },
    {
      key: 'module',
      title: copy.moduleInventory,
      description: copy.moduleInventoryDescription(permissions.modulePermissions.length),
      meta: copy.currentMatrix,
      tone: 'success' as const,
    },
  ];
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={copy.roles}
          value={String(roles.length)}
          helper={copy.systemRoles(systemRoles)}
          tone="blue"
          icon={ShieldCheck}
        />
        <StatCard
          label={copy.capabilities}
          value={String(permissions.hostCapabilities.length)}
          helper={copy.assigned(totalCapabilities)}
          icon={UserCheck}
        />
        <StatCard
          label={copy.modulePermissions}
          value={String(permissions.modulePermissions.length)}
          helper={copy.assigned(totalModulePermissions)}
          icon={Users}
        />
        <StatCard
          label={copy.customRoles}
          value={String(roles.length - systemRoles)}
          helper={copy.productAccess}
          icon={ShieldCheck}
        />
      </StatGrid>

      <AdminPanel
        title={copy.roleManagementTitle}
        description={copy.roleManagementDescription}
        contentClassName="p-0"
      >
        <DataTable
          className="rounded-none border-x-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'Role',
            'Type',
            'Members',
            'Capabilities',
            'High-risk',
            'Module permissions',
            'Status',
          ])}
          rows={roles.map((role) => [
            role.label,
            role.builtIn ? copy.systemRole : copy.customRole,
            String(membersByRole[role.id] ?? 0),
            String(role.capabilities.length),
            String(highRiskAuthorizationCount(role)),
            String(role.modulePermissions.length),
            <StatusBadge
              key={role.id}
              lang={lang}
              value={role.builtIn ? 'system' : 'custom'}
              label={role.builtIn ? copy.systemRole : copy.customRole}
              tone={role.builtIn ? 'info' : 'success'}
            />,
          ])}
          empty={copy.empty}
          minWidthClass="min-w-[980px]"
        />
        {adminRole && adminRole.modulePermissions.length === 0 ? (
          <div className="border-t border-admin-border px-4 py-3 text-sm leading-6 text-admin-text-muted sm:px-5">
            {adminInlineText(lang, 'admin_has_0_module_permissions_by_design_host_admins_fec4e732')}
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel
        title={copy.panelTitle}
        description={copy.panelDescription}
        contentClassName="grid gap-4"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">
              {copy.systemRolesLabel}
            </span>
            <strong className="mt-1 block text-sm text-admin-text">{systemRoles}</strong>
          </div>
          <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">
              {copy.hostAssignments}
            </span>
            <strong className="mt-1 block text-sm text-admin-text">{totalCapabilities}</strong>
          </div>
          <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">
              {copy.moduleAssignments}
            </span>
            <strong className="mt-1 block text-sm text-admin-text">{totalModulePermissions}</strong>
          </div>
        </div>
        <form
          method="get"
          className="grid gap-3 rounded-admin-md border border-admin-border bg-admin-bg/45 p-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end"
        >
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'permission_search_43af6a5b')}
            </span>
            <Input
              type="search"
              name="q"
              defaultValue={tableQuery.q}
              placeholder={adminInlineText(
                lang,
                'search_capability_permission_or_category_e4548dae'
              )}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'scope_2e8dbfee')}
            </span>
            <Select
              name="type"
              defaultValue={tableQuery.type}
              aria-label={adminInlineText(lang, 'permission_scope_44e7a957')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              <option value="host">{adminInlineText(lang, 'host_capabilities_e1480ad4')}</option>
              <option value="module">{adminInlineText(lang, 'module_permissions_628742dc')}</option>
            </Select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Filter')}
            </button>
            {tableQuery.q || tableQuery.type ? (
              <Link
                href={localizedPath(lang, '/admin/rbac')}
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted"
              >
                {adminInlineText(lang, 'Clear')}
              </Link>
            ) : null}
          </div>
        </form>
        <EvidenceSection
          title={copy.coverageEvidenceTitle}
          description={copy.coverageEvidenceDescription}
        >
          <PermissionMatrix
            lang={lang}
            roles={matrixRoles}
            permissions={filteredMatrixPermissions}
          />
        </EvidenceSection>
        <EvidenceSection
          title={adminInlineText(lang, 'permission_diff_view_116b636d')}
          description={adminInlineText(
            lang,
            'compares_admin_and_user_roles_by_default_filters_app_e1d91d4a'
          )}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, [
              'Permission',
              diffLeft?.label ?? 'Left',
              diffRight?.label ?? 'Right',
              'Diff',
            ])}
            rows={permissionDiffRows}
            empty={adminInlineText(lang, 'no_permissions_match_this_filter_598e3d56')}
            minWidthClass="min-w-[760px]"
          />
        </EvidenceSection>
        <TimelineList lang={lang} items={coverageTimeline} empty={copy.empty} />
      </AdminPanel>
    </WorkspaceShell>
  );
}
