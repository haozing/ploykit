import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity,
  Box,
  CircleCheck,
  Clock3,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import {
  adminNav,
  EmptyState,
  FormField,
  StatCard,
  WorkspaceShell,
} from '@host/components/ProductShell';
import { HostPageSlot } from '@host/components/layout/HostPageSlot';
import {
  ConfirmSubmitButton,
  DataTable,
  DetailDrawer,
  Input,
  Pagination,
  Select,
  Switch,
  Toast,
} from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  AdvancedFilterPanel,
  ActionQueue,
  ActionPanel,
  AdminPanel,
  CodeBlockPanel,
  EntityListItem,
  FactList,
  FilterBar,
  HealthRowList,
  MoreActionMenu,
  SegmentedWorkspace,
  TimelineList,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatBytes } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import {
  getAdminRunDetailCopy,
  getAdminRunsCopy,
  getAdminServiceConnectionsCopy,
  getAdminWebhookDetailCopy,
  getAdminWebhooksCopy,
} from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  AdminOperationsSnapshot,
  AdminOutboxBulkPreview,
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

function adminRelatedHref(
  lang: SupportedLanguage,
  path: string,
  params: Record<string, string | undefined | null>
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) {
      searchParams.set(key, trimmed);
    }
  }
  const search = searchParams.toString();
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

const userStatusRoleOptions = [
  { value: 'active', label: 'Active' },
  { value: 'pending-verification', label: 'Pending verification' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Deleted' },
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

function connectionCorrelationKey(
  connection: AdminServiceConnectionsView['connections'][number]
): string {
  return connection.moduleId ?? connection.service ?? connection.id;
}

function outboxKind(record: { name: string }): 'job' | 'event' | 'webhook' | 'email' | 'other' {
  if (record.name.startsWith('job:')) {
    return 'job';
  }
  if (record.name.startsWith('event:')) {
    return 'event';
  }
  if (record.name.startsWith('webhook:')) {
    return 'webhook';
  }
  if (record.name.startsWith('email:')) {
    return 'email';
  }
  return 'other';
}

export function AdminServiceConnectionsOperationsPage({
  lang,
  connections,
  testConnectionAction,
  updateConnectionStatusAction,
  createConnectionAction,
  updateConnectionPolicyAction,
  applyLogRetentionAction,
  rotateConnectionSecretAction,
  query,
}: {
  lang: SupportedLanguage;
  connections: AdminServiceConnectionsView;
  testConnectionAction?: AdminFormAction;
  updateConnectionStatusAction?: AdminFormAction;
  createConnectionAction?: AdminFormAction;
  updateConnectionPolicyAction?: AdminFormAction;
  applyLogRetentionAction?: AdminFormAction;
  rotateConnectionSecretAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminServiceConnectionsCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const moduleOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.moduleId ?? 'host')
  );
  const serviceOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.service)
  );
  const workspaceOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.workspaceId ?? 'global')
  );
  const environmentOptions = uniqueSelectOptions(
    connections.connections.map((connection) => connection.environment)
  );
  const filteredConnections = connections.connections.filter(
    (connection) =>
      matchesTextSearch(tableQuery.q, [
        connection.id,
        connection.moduleId ?? 'host',
        connection.service,
        connection.provider,
        connection.environment,
        connection.workspaceId ?? '',
        connection.status,
        connection.detail,
      ]) &&
      matchesExactFilter(tableQuery.moduleId, connection.moduleId ?? 'host') &&
      matchesExactFilter(tableQuery.service, connection.service) &&
      matchesExactFilter(tableQuery.status, connection.status) &&
      matchesExactFilter(tableQuery.workspace, connection.workspaceId ?? 'global') &&
      matchesExactFilter(tableQuery.environment, connection.environment)
  );
  const connectionReviewItems = [
    connections.summary.blocked > 0
      ? {
          key: 'blocked-connections',
          title: 'Blocked service connections',
          description: `${connections.summary.blocked} connections cannot be used. Check provider readiness, secret source, and required configuration before production traffic.`,
          actionLabel: 'Filter blocked',
          href: localizedPath(lang, '/admin/service-connections?status=blocked'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
    connections.summary.warning > 0
      ? {
          key: 'warning-connections',
          title: 'Connections need review',
          description: `${connections.summary.warning} connections are degraded or missing optional readiness evidence.`,
          actionLabel: 'Filter warning',
          href: localizedPath(lang, '/admin/service-connections?status=warning'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    !connections.configDoctor.ok
      ? {
          key: 'config-doctor',
          title: 'Configuration doctor is blocked',
          description: `${connections.configDoctor.diagnostics.length} diagnostics need attention before service readiness can be trusted.`,
          actionLabel: 'Review diagnostics',
          href: localizedPath(lang, '/admin/settings'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const focusConnection =
    filteredConnections.find((connection) => connection.status === 'blocked') ??
    filteredConnections.find((connection) => connection.status === 'warning') ??
    filteredConnections[0] ??
    connections.connections[0] ??
    null;
  const focusCorrelationKey = focusConnection ? connectionCorrelationKey(focusConnection) : '';
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Ready')}
          value={String(connections.summary.ready)}
          helper={adminInlineText(lang, 'Healthy providers')}
          tone="green"
          icon={CircleCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Warning')}
          value={String(connections.summary.warning)}
          helper={adminInlineText(lang, 'Needs readiness review')}
          tone={connections.summary.warning > 0 ? 'amber' : 'neutral'}
          icon={TriangleAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Blocked')}
          value={String(connections.summary.blocked)}
          helper={adminInlineText(lang, 'Cannot serve traffic')}
          tone={connections.summary.blocked > 0 ? 'red' : 'neutral'}
          icon={ShieldAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Disabled')}
          value={String(connections.summary.disabled)}
          helper={adminInlineText(lang, 'Intentionally inactive')}
          tone={connections.summary.disabled > 0 ? 'amber' : 'neutral'}
          icon={Clock3}
        />
      </StatGrid>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Config Doctor')}
          value={connections.configDoctor.ok ? 'ready' : 'blocked'}
          helper={adminInlineText(lang, 'Host configuration evidence')}
          tone={connections.configDoctor.ok ? 'green' : 'red'}
          icon={Activity}
        />
        <StatCard
          label={adminInlineText(lang, 'Route Catalog')}
          value={`${connections.configDoctor.metrics.routeCatalogEntries}/${connections.configDoctor.metrics.apiRoutesDiscovered}`}
          helper={adminInlineText(lang, 'Declared / discovered')}
          icon={Box}
        />
        <StatCard
          label={adminInlineText(lang, 'Providers')}
          value={`${connections.configDoctor.metrics.providersReady}/${connections.configDoctor.metrics.providersTotal}`}
          helper={adminInlineText(lang, 'Ready / total')}
          tone={
            connections.configDoctor.metrics.providersReady ===
            connections.configDoctor.metrics.providersTotal
              ? 'green'
              : 'amber'
          }
          icon={PackageCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Call Logs')}
          value={String(connections.callLogs.length)}
          helper={adminInlineText(lang, 'Recent operations')}
          icon={RotateCcw}
        />
      </StatGrid>
      {connectionReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Service readiness')}
          description={adminInlineText(
            lang,
            'Connections that affect production readiness are promoted before the provider matrix.'
          )}
          status="warning"
          items={connectionReviewItems}
        />
      ) : null}
      {focusConnection ? (
        <DetailDrawer
          open
          title={adminInlineText(lang, 'Connection detail')}
          description={`${focusConnection.service} · ${focusConnection.provider}`}
          className="mb-5"
          actions={[
            <Link
              key="runs"
              href={adminRelatedHref(lang, '/admin/runs', { q: focusCorrelationKey })}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Runs')}
            </Link>,
            <Link
              key="jobs"
              href={adminRelatedHref(lang, '/admin/runs', { q: focusCorrelationKey, type: 'job' })}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Jobs')}
            </Link>,
            <Link
              key="audit"
              href={adminRelatedHref(lang, '/admin/audit', { q: focusConnection.id })}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Audit')}
            </Link>,
            <Link
              key="settings"
              href={localizedPath(lang, '/admin/settings')}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Settings')}
            </Link>,
            <Link
              key="webhooks"
              href={adminRelatedHref(lang, '/admin/webhooks', { q: focusCorrelationKey })}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Webhooks')}
            </Link>,
          ]}
        >
          <FactList
            lang={lang}
            density="compact"
            items={[
              {
                label: 'Connection ID',
                value: focusConnection.id,
                copyValue: focusConnection.id,
                mono: true,
              },
              { label: 'Service', value: focusConnection.service },
              { label: 'Provider', value: focusConnection.provider },
              { label: 'Environment', value: focusConnection.environment },
              {
                label: 'Scope',
                value: `${focusConnection.ownerType}/${focusConnection.scopeType}`,
              },
              { label: 'Workspace', value: focusConnection.workspaceId ?? 'global' },
              { label: 'Status', value: focusConnection.status },
              { label: 'Impact', value: focusConnection.required ? 'required' : 'optional' },
              { label: 'Last check', value: focusConnection.lastTestAt ?? 'not checked' },
              { label: 'Policy updated', value: focusConnection.policyUpdatedAt ?? 'not updated' },
              { label: 'Last error', value: focusConnection.lastError ?? 'none' },
              { label: 'Detail', value: focusConnection.detail },
            ]}
          />
        </DetailDrawer>
      ) : null}
      {focusConnection ? (
        <AdminPanel
          title={adminInlineText(lang, 'Related operations')}
          description={adminInlineText(
            lang,
            'related_links_use_the_connection_id_module_id_or_ser_72aa3ac2'
          )}
        >
          <HealthRowList
            lang={lang}
            items={[
              {
                key: 'connection-related-runs',
                title: 'Runs',
                detail: adminInlineText(
                  lang,
                  'inspect_runs_that_share_the_module_or_service_correl_28b78544'
                ),
                meta: focusCorrelationKey,
                status: 'linked',
                statusTone: 'info',
                tone: 'info',
                href: adminRelatedHref(lang, '/admin/runs', { q: focusCorrelationKey }),
              },
              {
                key: 'connection-related-jobs',
                title: 'Jobs',
                detail: adminInlineText(
                  lang,
                  'jobs_do_not_have_a_standalone_admin_route_yet_the_li_efdc32a1'
                ),
                meta: 'type=job',
                status: 'run-kind',
                statusTone: 'info',
                tone: 'primary',
                href: adminRelatedHref(lang, '/admin/runs', {
                  q: focusCorrelationKey,
                  type: 'job',
                }),
              },
              {
                key: 'connection-related-webhooks',
                title: 'Webhooks',
                detail: adminInlineText(
                  lang,
                  'inspect_outbox_receipt_and_dead_letter_records_for_t_228f29e7'
                ),
                meta: focusConnection.moduleId ?? focusConnection.service,
                status: 'linked',
                statusTone: 'info',
                tone: 'primary',
                href: adminRelatedHref(lang, '/admin/webhooks', { q: focusCorrelationKey }),
              },
              {
                key: 'connection-related-audit',
                title: 'Audit',
                detail: adminInlineText(
                  lang,
                  'search_policy_test_rotation_and_retention_audit_by_c_974bef4c'
                ),
                meta: focusConnection.id,
                status: 'linked',
                statusTone: 'info',
                tone: 'neutral',
                href: adminRelatedHref(lang, '/admin/audit', { q: focusConnection.id }),
              },
            ]}
          />
        </AdminPanel>
      ) : null}
      {createConnectionAction ||
      updateConnectionPolicyAction ||
      applyLogRetentionAction ||
      rotateConnectionSecretAction ? (
        <details className="rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
            {adminInlineText(lang, 'Connection maintenance')}
          </summary>
          <section className="connection-policy-grid border-t border-admin-border p-4">
            {createConnectionAction ? (
              <form
                action={createConnectionAction}
                className="rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card grid gap-4"
              >
                <div>
                  <h2>{adminInlineText(lang, 'Create Connection')}</h2>
                  <p>
                    {adminInlineText(
                      lang,
                      '声明一个自定义 provider 连接，secret 只能填写 env 或 encrypted 引用。'
                    )}
                  </p>
                </div>
                <Input
                  name="connectionId"
                  placeholder={adminInlineText(lang, 'custom:crm-api')}
                  aria-label={adminInlineText(lang, 'Connection ID')}
                  required
                />
                <Input
                  name="service"
                  placeholder={adminInlineText(lang, 'crm-api')}
                  aria-label={adminInlineText(lang, 'Service')}
                  required
                />
                <Input
                  name="provider"
                  placeholder={adminInlineText(lang, 'custom-http')}
                  aria-label={adminInlineText(lang, 'Provider')}
                  required
                />
                <Input
                  name="baseUrl"
                  placeholder={adminInlineText(lang, 'https://api.example.com')}
                  aria-label={adminInlineText(lang, 'Base URL')}
                  required
                />
                <Select
                  name="authType"
                  defaultValue="apiKey"
                  aria-label={adminInlineText(lang, 'Auth type')}
                >
                  {connectionAuthTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {adminInlineText(lang, option.label)}
                    </option>
                  ))}
                </Select>
                <Input
                  name="secretSource"
                  placeholder={adminInlineText(lang, 'env:CRM_API_KEY')}
                  aria-label={adminInlineText(lang, 'Secret source')}
                />
                <textarea
                  name="secretRefs"
                  placeholder={adminInlineText(
                    lang,
                    'bearertoken_env_service_bearer_token_hmacsecret_env__a8f7b281'
                  )}
                  aria-label={adminInlineText(lang, 'Secret refs JSON')}
                  className="min-h-24 rounded-admin-md border border-admin-border bg-admin-elevated px-3 py-2 text-sm text-admin-text shadow-admin-inset outline-none transition focus:border-admin-primary"
                />
                <Select
                  name="ownerType"
                  defaultValue="workspace"
                  aria-label={adminInlineText(lang, 'Owner type')}
                >
                  {connectionOwnerTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {adminInlineText(lang, option.label)}
                    </option>
                  ))}
                </Select>
                <Select
                  name="scopeType"
                  defaultValue="workspace"
                  aria-label={adminInlineText(lang, 'Scope type')}
                >
                  {connectionScopeTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {adminInlineText(lang, option.label)}
                    </option>
                  ))}
                </Select>
                <Input
                  name="workspaceId"
                  placeholder={adminInlineText(lang, 'default-workspace')}
                  aria-label={adminInlineText(lang, 'Workspace ID')}
                />
                <Input
                  name="environment"
                  placeholder={adminInlineText(lang, 'development')}
                  aria-label={adminInlineText(lang, 'Environment')}
                />
                <Input
                  name="timeoutMs"
                  placeholder="8000"
                  aria-label={adminInlineText(lang, 'Timeout milliseconds')}
                />
                <Input
                  name="retry"
                  placeholder={adminInlineText(lang, '2 attempts / exponential')}
                  aria-label={adminInlineText(lang, 'Retry policy')}
                />
                <Input
                  name="maxResponseBytes"
                  placeholder="524288"
                  aria-label={adminInlineText(lang, 'Max response bytes')}
                />
                <Input
                  name="healthCheck"
                  placeholder={adminInlineText(lang, '/health or provider readiness')}
                  aria-label={adminInlineText(lang, 'Health check')}
                />
                <Input
                  name="actorClaims"
                  placeholder={adminInlineText(lang, 'system')}
                  aria-label={adminInlineText(lang, 'Actor claims')}
                />
                <Input
                  name="reason"
                  placeholder={adminInlineText(lang, 'reason')}
                  aria-label={adminInlineText(lang, 'Create connection reason')}
                />
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(lang, '确认创建自定义 service connection？')}
                >
                  {adminInlineText(lang, 'Create')}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {updateConnectionPolicyAction ? (
              <form
                action={updateConnectionPolicyAction}
                className="rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card grid gap-4"
              >
                <div>
                  <h2>{adminInlineText(lang, 'Update Policy')}</h2>
                  <p>
                    {adminInlineText(
                      lang,
                      '覆盖连接策略；空字段保持当前值，secret source 不接收明文。'
                    )}
                  </p>
                </div>
                <Select name="connectionId" aria-label={adminInlineText(lang, 'Connection')}>
                  {connections.connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.id}
                    </option>
                  ))}
                </Select>
                <Input
                  name="baseUrl"
                  placeholder={adminInlineText(lang, 'baseUrl')}
                  aria-label={adminInlineText(lang, 'Base URL')}
                />
                <Select
                  name="authType"
                  defaultValue=""
                  aria-label={adminInlineText(lang, 'Auth type')}
                >
                  <option value="">{adminInlineText(lang, 'Keep current')}</option>
                  {connectionAuthTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {adminInlineText(lang, option.label)}
                    </option>
                  ))}
                </Select>
                <Input
                  name="secretSource"
                  placeholder={adminInlineText(lang, 'env:NAME')}
                  aria-label={adminInlineText(lang, 'Secret source')}
                />
                <textarea
                  name="secretRefs"
                  placeholder={adminInlineText(
                    lang,
                    'bearertoken_env_service_bearer_token_hmacsecret_env__a8f7b281'
                  )}
                  aria-label={adminInlineText(lang, 'Secret refs JSON')}
                  className="min-h-24 rounded-admin-md border border-admin-border bg-admin-elevated px-3 py-2 text-sm text-admin-text shadow-admin-inset outline-none transition focus:border-admin-primary"
                />
                <Input
                  name="timeoutMs"
                  placeholder={adminInlineText(lang, 'timeoutMs')}
                  aria-label={adminInlineText(lang, 'Timeout milliseconds')}
                />
                <Input
                  name="retry"
                  placeholder={adminInlineText(lang, 'retry policy')}
                  aria-label={adminInlineText(lang, 'Retry policy')}
                />
                <Input
                  name="maxResponseBytes"
                  placeholder={adminInlineText(lang, 'maxResponseBytes')}
                  aria-label={adminInlineText(lang, 'Max response bytes')}
                />
                <Input
                  name="healthCheck"
                  placeholder={adminInlineText(lang, 'health check')}
                  aria-label={adminInlineText(lang, 'Health check')}
                />
                <Input
                  name="actorClaims"
                  placeholder={adminInlineText(lang, 'actor claims')}
                  aria-label={adminInlineText(lang, 'Actor claims')}
                />
                <Input
                  name="reason"
                  placeholder={adminInlineText(lang, 'reason')}
                  aria-label={adminInlineText(lang, 'Update connection reason')}
                />
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(lang, '确认更新 service connection policy？')}
                >
                  {adminInlineText(lang, 'Update Policy')}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {rotateConnectionSecretAction ? (
              <form
                action={rotateConnectionSecretAction}
                className="rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card grid gap-4"
              >
                <div>
                  <h2>{adminInlineText(lang, 'Secret rotation wizard')}</h2>
                  <p>
                    {adminInlineText(
                      lang,
                      'Rotate by pointing the connection at a new env or encrypted secret reference. Plaintext secrets are never entered here.'
                    )}
                  </p>
                </div>
                <FactList
                  lang={lang}
                  density="compact"
                  items={[
                    {
                      label: 'Step 1',
                      value: adminInlineText(
                        lang,
                        'choose_the_connection_that_will_read_a_new_secret_re_09c104d3'
                      ),
                    },
                    {
                      label: 'Step 2',
                      value: adminInlineText(
                        lang,
                        'enter_env_name_after_the_secret_is_provisioned_as_an_ab33c040'
                      ),
                    },
                    {
                      label: 'Step 3',
                      value: adminInlineText(
                        lang,
                        'run_test_from_the_provider_matrix_and_verify_audit_e_4c9b8122'
                      ),
                    },
                  ]}
                />
                <Select name="connectionId" aria-label={adminInlineText(lang, 'Connection')}>
                  {connections.connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.id} · {connection.service}
                    </option>
                  ))}
                </Select>
                <Input
                  name="secretSource"
                  placeholder={adminInlineText(lang, 'env:NEW_SECRET')}
                  aria-label={adminInlineText(lang, 'Secret source')}
                  required
                />
                <Input
                  name="reason"
                  placeholder={adminInlineText(lang, 'rotation reason')}
                  aria-label={adminInlineText(lang, 'Rotation reason')}
                  required
                />
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-1.5 text-xs font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(
                    lang,
                    '确认轮换该 service connection secret reference？请确认新 secret 已在环境或密文存储中就绪。'
                  )}
                >
                  {adminInlineText(lang, 'Rotate secret')}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {applyLogRetentionAction ? (
              <form
                action={applyLogRetentionAction}
                className="rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card grid gap-4"
              >
                <div>
                  <h2>{adminInlineText(lang, 'Call Log Retention')}</h2>
                  <p>
                    {adminInlineText(
                      lang,
                      '按保留天数隐藏旧 connection call logs，并写入 retention audit。'
                    )}
                  </p>
                </div>
                <Input
                  name="retentionDays"
                  placeholder="30"
                  aria-label={adminInlineText(lang, 'Retention days')}
                />
                <Input
                  name="reason"
                  placeholder={adminInlineText(lang, 'reason')}
                  aria-label={adminInlineText(lang, 'Retention reason')}
                />
                <div className="text-sm text-admin-text-muted">
                  {adminInlineText(lang, 'hidden')} {connections.retention.hiddenCount} ·{' '}
                  {adminInlineText(lang, 'visible')} {connections.retention.visibleCount}
                  {connections.retention.cutoff ? ` · cutoff ${connections.retention.cutoff}` : ''}
                </div>
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(
                    lang,
                    '确认应用 connection call log retention？旧日志会从当前运营视图隐藏。'
                  )}
                >
                  {adminInlineText(lang, 'Apply Retention')}
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </section>
        </details>
      ) : null}
      <form
        method="get"
        className="grid gap-3 rounded-admin-md border border-admin-border bg-admin-surface p-4 shadow-admin-card"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Search')}</span>
            <Input
              type="search"
              name="q"
              defaultValue={tableQuery.q}
              placeholder={adminInlineText(lang, '搜索连接、provider 或缺口说明')}
              aria-label={adminInlineText(lang, '搜索连接、provider 或缺口说明')}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Status')}</span>
            <Select
              name="status"
              defaultValue={tableQuery.status}
              aria-label={adminInlineText(lang, 'Status')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {connectionStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {adminInlineText(lang, option.label)}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="submit"
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Filter')}
            </button>
            <Link
              href={localizedPath(lang, '/admin/service-connections')}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Clear')}
            </Link>
          </div>
        </div>
        <AdvancedFilterPanel
          lang={lang}
          defaultOpen={Boolean(
            tableQuery.moduleId ||
            tableQuery.service ||
            tableQuery.workspace ||
            tableQuery.environment
          )}
          description={adminInlineText(
            lang,
            '模块、服务、工作区和环境属于二级筛选，只在排查供应商绑定时展开。'
          )}
        >
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Module')}</span>
            <Select
              name="moduleId"
              defaultValue={tableQuery.moduleId}
              aria-label={adminInlineText(lang, 'Module')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {moduleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Service')}</span>
            <Select
              name="service"
              defaultValue={tableQuery.service}
              aria-label={adminInlineText(lang, 'Service')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {serviceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Workspace')}</span>
            <Select
              name="workspace"
              defaultValue={tableQuery.workspace}
              aria-label={adminInlineText(lang, 'Workspace')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {workspaceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{adminInlineText(lang, 'Environment')}</span>
            <Select
              name="environment"
              defaultValue={tableQuery.environment}
              aria-label={adminInlineText(lang, 'Environment')}
            >
              <option value="">{adminInlineText(lang, 'All')}</option>
              {environmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
        </AdvancedFilterPanel>
      </form>
      <FilterResultHint
        lang={lang}
        visible={filteredConnections.length}
        total={connections.connections.length}
      />
      <DataTable
        className="hidden xl:block"
        columns={adminInlineColumns(lang, [
          'Connection',
          'Provider',
          'Scope',
          'Status',
          'Policy',
          'Impact',
          'Evidence',
          'Action',
        ])}
        rows={filteredConnections.map((connection) => {
          const evidenceState = connection.lastTestAt
            ? adminInlineText(lang, 'recent')
            : connection.lastError
              ? adminInlineText(lang, 'needs review')
              : adminInlineText(lang, 'stale');
          return [
            <span key={`${connection.id}:connection`}>
              {connection.service}
              <span className="text-sm text-admin-text-muted">
                {connection.moduleId ?? 'host'} · {connection.environment}
              </span>
            </span>,
            <span key={`${connection.id}:provider`}>
              {connection.provider}
              <span className="text-sm text-admin-text-muted">{connection.baseUrl}</span>
            </span>,
            `${connection.ownerType}/${connection.scopeType} · ${connection.workspaceId ?? 'global'}`,
            <span key={`${connection.id}:status`}>
              <StatusBadge lang={lang} value={connection.status} />
              <span className="text-sm text-admin-text-muted">
                {adminInlineText(lang, connection.required ? 'required' : 'optional')}
              </span>
            </span>,
            <span key={`${connection.id}:policy`}>
              {connection.authType} · {connection.secretSource}
              {Object.keys(connection.secretRefs).length > 0
                ? ` · refs: ${Object.keys(connection.secretRefs).join(', ')}`
                : ''}
              <span className="text-sm text-admin-text-muted">
                {connection.timeoutMs}ms · {connection.retry} · max{' '}
                {formatBytes(connection.maxResponseBytes, lang)}
              </span>
              <span className="text-sm text-admin-text-muted">
                {connection.healthCheck} · actor {connection.actorClaims ?? 'system'}
              </span>
            </span>,
            <span key={`${connection.id}:impact`} className="text-sm text-admin-text-muted">
              {connection.required
                ? adminInlineText(lang, 'required')
                : adminInlineText(lang, 'optional')}
              {connection.ownerType !== 'system' ? ` · ${connection.ownerType}` : ''}
            </span>,
            <span key={`${connection.id}:evidence`} className="text-sm text-admin-text-muted">
              {evidenceState} · {connection.lastTestAt ?? connection.policyUpdatedAt ?? 'never'}
              {connection.lastError ? ` · ${connection.lastError}` : ''}
            </span>,
            <div key={`${connection.id}:actions`} className="flex flex-wrap items-center gap-2">
              <Link
                href={adminRelatedHref(lang, '/admin/runs', {
                  q: connectionCorrelationKey(connection),
                })}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              >
                {adminInlineText(lang, 'Runs')}
              </Link>
              <Link
                href={adminRelatedHref(lang, '/admin/webhooks', {
                  q: connectionCorrelationKey(connection),
                })}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              >
                {adminInlineText(lang, 'Webhooks')}
              </Link>
              {testConnectionAction ? (
                <form action={testConnectionAction} className="inline-flex">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input type="hidden" name="reason" value="Manual Admin service connection test" />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(lang, 'test_connection_value_c12dd6aa', {
                      value1: connection.service,
                    })}
                  >
                    {adminInlineText(lang, 'Test')}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
              {updateConnectionStatusAction ? (
                <form action={updateConnectionStatusAction} className="inline-flex">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={connection.status === 'disabled' ? 'active' : 'disabled'}
                  />
                  <input
                    type="hidden"
                    name="reason"
                    value={`Admin ${connection.status === 'disabled' ? 'enabled' : 'disabled'} connection ${connection.id}`}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(lang, 'value_connection_value_61324463', {
                      value1: connection.status === 'disabled' ? 'Enable' : 'Disable',
                      value2: connection.service,
                    })}
                  >
                    {adminInlineText(lang, connection.status === 'disabled' ? 'Enable' : 'Disable')}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
              {rotateConnectionSecretAction ? (
                <form action={rotateConnectionSecretAction} className="inline-flex">
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input
                    type="hidden"
                    name="secretSource"
                    value={`${connection.secretSource}:rotated`}
                  />
                  <input type="hidden" name="reason" value="Admin secret source rotation" />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(
                      lang,
                      'rotate_the_secret_source_for_value_the_plaintext_sec_39b4e1e8',
                      { value1: connection.service }
                    )}
                  >
                    {adminInlineText(lang, 'Rotate')}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>,
          ];
        })}
      />
      <div className="grid gap-1 xl:hidden">
        {filteredConnections.map((connection) => (
          <EntityListItem
            key={connection.id}
            href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(connection.id)}`)}
            title={connection.service}
            subtitle={connection.provider}
            status={connection.status}
            detail={`${connection.ownerType}/${connection.scopeType} · ${connection.required ? 'required' : 'optional'} · ${connection.lastTestAt ?? connection.policyUpdatedAt ?? 'never'}`}
            meta={connection.id}
            icon={Activity}
            density="compact"
            tone={
              connection.status === 'blocked'
                ? 'danger'
                : connection.status === 'warning'
                  ? 'warning'
                  : 'primary'
            }
          />
        ))}
      </div>
      <AdminPanel
        title={adminInlineText(lang, 'Provider readiness')}
        description={adminInlineText(
          lang,
          'Config doctor provider checks are presented as operational health rows.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={connections.configDoctor.providerReadiness.map((provider) => ({
            key: provider.id,
            title: provider.id,
            detail: provider.detail,
            meta: provider.mode,
            status: provider.status,
            tone:
              provider.status === 'ready'
                ? 'success'
                : provider.status === 'blocked'
                  ? 'danger'
                  : 'warning',
          }))}
          empty={adminInlineText(lang, 'No provider readiness checks.')}
        />
      </AdminPanel>
      <AdminPanel
        title={adminInlineText(lang, 'Connection call timeline')}
        description={adminInlineText(
          lang,
          'Recent connection operations grouped by actor and metadata.'
        )}
      >
        <TimelineList
          lang={lang}
          items={connections.callLogs.map((record) => ({
            key: record.id,
            title: record.type.replace('admin.connection.', ''),
            description: compactJson(record.metadata, 220),
            meta: record.actorId ?? 'system',
            tone: record.type.includes('failed')
              ? 'danger'
              : record.type.includes('rotate')
                ? 'warning'
                : 'primary',
          }))}
          empty={adminInlineText(lang, 'No connection operation logs yet.')}
        />
      </AdminPanel>
      {connections.configDoctor.diagnostics.length > 0 ? (
        <AdminPanel
          title={adminInlineText(lang, 'Config diagnostics')}
          description={adminInlineText(lang, 'Only unresolved diagnostics are shown here.')}
          contentClassName="p-0"
        >
          <DataTable
            className="rounded-none border-x-0 shadow-none"
            columns={adminInlineColumns(lang, ['Severity', 'Code', 'Fix'])}
            rows={connections.configDoctor.diagnostics.map((item) => [
              item.severity,
              item.code,
              item.fix ?? item.message,
            ])}
          />
        </AdminPanel>
      ) : null}
    </WorkspaceShell>
  );
}

export function AdminRunsOperationsPage({
  lang,
  snapshot,
  requeueRunAction,
  cancelRunAction,
  query,
  headerActions,
  mainBefore,
  mainAfter,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsViewSnapshot;
  requeueRunAction: AdminFormAction;
  cancelRunAction: AdminFormAction;
  query?: AdminTableQuery;
  headerActions?: ReactNode;
  mainBefore?: ReactNode;
  mainAfter?: ReactNode;
}) {
  const copy = getAdminRunsCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const allRuns = snapshot.records.runs;
  const filteredRuns = allRuns.filter(
    (run) =>
      matchesTextSearch(tableQuery.q, [
        run.id,
        run.name,
        run.moduleId,
        run.workspaceId ?? '',
        run.kind,
        run.status,
        run.progress,
        run.error?.code,
        run.error?.message,
      ]) &&
      matchesExactFilter(tableQuery.status, run.status) &&
      matchesExactFilter(tableQuery.type, run.kind)
  );
  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / tableQuery.pageSize));
  const page = Math.min(Math.max(tableQuery.page, 1), totalPages);
  const pageStart = (page - 1) * tableQuery.pageSize;
  const runs = filteredRuns.slice(pageStart, pageStart + tableQuery.pageSize);
  const countByStatus = (status: string) => allRuns.filter((run) => run.status === status).length;
  const waitingExternal = allRuns.filter((run) =>
    runWaitingExternalReason(run).startsWith('waiting external')
  ).length;
  const failedRuns = allRuns.filter((run) => run.status === 'failed');
  const blockedRuns = allRuns.filter(
    (run) => run.status === 'failed' || runWaitingExternalReason(run).startsWith('waiting external')
  );
  const actionItems = blockedRuns.slice(0, 4).map((run) => {
    const reason = runWaitingExternalReason(run);
    return {
      key: run.id,
      title: run.name,
      description: `${run.moduleId} · ${reason}`,
      actionLabel: copy.openRun,
      href: localizedPath(lang, `/admin/runs/${run.id}`),
      status: run.status,
      tone: run.status === 'failed' ? ('danger' as const) : ('warning' as const),
      meta: run.workspaceId ?? 'product',
    };
  });

  return (
    <WorkspaceShell
      lang={lang}
      title={copy.title}
      subtitle={copy.subtitle}
      nav={adminNav}
      actions={
        headerActions ? <HostPageSlot slotId="header.actions">{headerActions}</HostPageSlot> : null
      }
    >
      <HostPageSlot slotId="main.before">{mainBefore}</HostPageSlot>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Running')}
          value={String(countByStatus('running'))}
          helper={adminInlineText(lang, 'Currently executing')}
          tone="blue"
          icon={Activity}
        />
        <StatCard
          label={adminInlineText(lang, 'Queued')}
          value={String(countByStatus('queued'))}
          helper={adminInlineText(lang, 'Waiting for worker capacity')}
          icon={Clock3}
        />
        <StatCard
          label={adminInlineText(lang, 'Failed')}
          value={String(failedRuns.length)}
          helper={adminInlineText(lang, 'Requires inspection')}
          tone={failedRuns.length > 0 ? 'red' : 'neutral'}
          icon={TriangleAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Waiting External')}
          value={String(waitingExternal)}
          helper={adminInlineText(lang, 'Provider, secret, quota, or rate limit')}
          tone={waitingExternal > 0 ? 'amber' : 'neutral'}
          icon={RotateCcw}
        />
      </StatGrid>

      {actionItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Execution review')}
          description={adminInlineText(
            lang,
            'Runs that are failed or waiting on external systems are promoted here before the full history.'
          )}
          status="warning"
          items={actionItems}
        />
      ) : null}

      <AdminPanel
        title={adminInlineText(lang, 'Queue lanes')}
        description={adminInlineText(
          lang,
          'A run queue should read like an operations tool: which lane is blocked, why, and what happens next.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'running',
              title: 'Running',
              detail: 'Worker is currently executing these runs.',
              meta: `${countByStatus('running')} active`,
              status: countByStatus('running') > 0 ? 'active' : 'clear',
              statusTone: countByStatus('running') > 0 ? 'info' : 'success',
              tone: countByStatus('running') > 0 ? 'info' : 'success',
            },
            {
              key: 'queued',
              title: 'Queued',
              detail: 'Waiting for worker capacity or dependency slots.',
              meta: `${countByStatus('queued')} waiting`,
              status: countByStatus('queued') > 0 ? 'waiting' : 'clear',
              statusTone: countByStatus('queued') > 0 ? 'warning' : 'success',
              tone: countByStatus('queued') > 0 ? 'warning' : 'success',
            },
            {
              key: 'failed',
              title: 'Failed',
              detail: 'Inspect logs and requeue only after the error reason is understood.',
              meta: `${failedRuns.length} failed`,
              status: failedRuns.length > 0 ? 'review' : 'clear',
              statusTone: failedRuns.length > 0 ? 'danger' : 'success',
              tone: failedRuns.length > 0 ? 'danger' : 'success',
              href:
                failedRuns.length > 0
                  ? localizedPath(lang, '/admin/runs?status=failed')
                  : undefined,
            },
            {
              key: 'external',
              title: 'Waiting external',
              detail:
                'Provider, secret, quota, or rate limit evidence should be fixed outside the run itself.',
              meta: `${waitingExternal} blocked`,
              status: waitingExternal > 0 ? 'blocked' : 'clear',
              statusTone: waitingExternal > 0 ? 'warning' : 'success',
              tone: waitingExternal > 0 ? 'warning' : 'success',
            },
          ]}
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Run history')}
        description={adminInlineText(
          lang,
          'Search execution records by run id, module, workspace, status, progress, or error text.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索运行 ID、名称、模块、workspace、错误或状态"
          filterValue={tableQuery.status}
          filterOptions={runStatusOptions}
          resetHref={localizedPath(lang, '/admin/runs')}
        />
        {tableQuery.type ? (
          <div className="flex items-center gap-2 border-b border-admin-border bg-admin-bg/35 px-4 py-2 text-xs text-admin-text-muted sm:px-5">
            <span>{adminInlineText(lang, 'Kind')}</span>
            <StatusBadge lang={lang} value={tableQuery.type} tone="info" />
          </div>
        ) : null}
        <div className="px-4 py-3 sm:px-5">
          <FilterResultHint lang={lang} visible={filteredRuns.length} total={allRuns.length} />
        </div>
        {runs.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <ActionPanel
              title={adminInlineText(lang, 'No runs match this filter')}
              description={adminInlineText(
                lang,
                'clear_the_filter_return_to_modules_or_inspect_webhoo_bf318195'
              )}
              tone="warning"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={localizedPath(lang, '/admin/runs')}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Clear filters')}
                  </Link>
                  <Link
                    href={localizedPath(lang, '/admin/modules')}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Open modules')}
                  </Link>
                  <Link
                    href={localizedPath(lang, '/admin/webhooks')}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Open webhooks')}
                  </Link>
                </div>
              }
            />
          </div>
        ) : null}
        <div className="hidden xl:block">
          <DataTable
            className="rounded-none border-x-0 border-b-0 shadow-none"
            columns={adminInlineColumns(lang, [
              'Run',
              'Module',
              'Workspace',
              'Status',
              'Progress',
              'Updated',
              'Next',
              'Action',
            ])}
            rows={runs.map((run) => [
              <div key={`${run.id}:run`} className="min-w-0">
                <Link
                  href={localizedPath(lang, `/admin/runs/${run.id}`)}
                  className="block truncate font-semibold text-admin-primary hover:underline"
                >
                  {run.name}
                </Link>
                <div className="mt-1 truncate text-xs text-admin-text-muted">{run.id}</div>
              </div>,
              run.moduleId,
              run.workspaceId ?? 'product',
              <StatusBadge key={`${run.id}:status`} lang={lang} value={run.status} />,
              `${run.progress}% · ${run.attempt}/${run.maxAttempts}`,
              <span key={`${run.id}:updated`} className="text-xs text-admin-text-muted">
                {run.updatedAt}
              </span>,
              <span key={`${run.id}:next`} className="text-xs text-admin-text-muted">
                {runWaitingExternalReason(run)}
              </span>,
              <div key={`${run.id}:actions`} className="flex flex-wrap items-center gap-2">
                <form action={cancelRunAction} className="inline-flex">
                  <input type="hidden" name="runId" value={run.id} />
                  <input
                    type="hidden"
                    name="reason"
                    value={`Canceled from Admin Runs. Previous status: ${run.status}.`}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={!runCanCancel(run.status)}
                    confirmation={adminInlineText(lang, 'cancel_run_value_168aaf4e', {
                      value1: run.name,
                    })}
                  >
                    {adminInlineText(lang, 'Cancel')}
                  </ConfirmSubmitButton>
                </form>
                <form action={requeueRunAction} className="inline-flex">
                  <input type="hidden" name="runId" value={run.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={!runCanRequeue(run.status)}
                    confirmation={adminInlineText(lang, 'requeue_run_value_ed01ac7b', {
                      value1: run.name,
                    })}
                  >
                    {adminInlineText(lang, 'Requeue')}
                  </ConfirmSubmitButton>
                </form>
              </div>,
            ])}
            empty={adminInlineText(lang, 'No runs match this filter.')}
            minWidthClass="min-w-[1120px]"
          />
        </div>
        <div className="grid gap-1 px-2 py-2 xl:hidden">
          {runs.length > 0 ? (
            runs.map((run) => (
              <EntityListItem
                key={run.id}
                href={localizedPath(lang, `/admin/runs/${run.id}`)}
                title={run.name}
                subtitle={`${run.moduleId} · ${run.workspaceId ?? 'product'}`}
                status={run.status}
                detail={`${run.progress}% · ${runWaitingExternalReason(run)}`}
                meta={`${run.attempt}/${run.maxAttempts}`}
                icon={Activity}
                tone={
                  run.status === 'failed' ? 'danger' : run.status === 'running' ? 'info' : 'primary'
                }
              />
            ))
          ) : (
            <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
              {adminInlineText(lang, 'No runs match this filter.')}
            </div>
          )}
        </div>
      </AdminPanel>
      <Pagination
        page={page}
        totalPages={totalPages}
        previousHref={
          page > 1 ? adminListHref(lang, '/admin/runs', tableQuery, page - 1) : undefined
        }
        nextHref={
          page < totalPages ? adminListHref(lang, '/admin/runs', tableQuery, page + 1) : undefined
        }
      />
      <HostPageSlot slotId="main.after">{mainAfter}</HostPageSlot>
    </WorkspaceShell>
  );
}

export function AdminRunDetailOperationsPage({
  lang,
  detail,
  requeueRunAction,
  cancelRunAction,
  mainBefore,
  mainAfter,
  side,
}: {
  lang: SupportedLanguage;
  detail: AdminRunDetailView;
  requeueRunAction: AdminFormAction;
  cancelRunAction: AdminFormAction;
  mainBefore?: ReactNode;
  mainAfter?: ReactNode;
  side?: ReactNode;
}) {
  const copy = getAdminRunDetailCopy(lang);
  const run = detail.run;
  const correlationId =
    run?.idempotencyKey ??
    run?.costRef ??
    detail.outbox
      .map((record) => record.metadata.correlationId ?? record.metadata.causationId)
      .find(Boolean)
      ?.toString() ??
    run?.id ??
    'none';
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {run ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <HostPageSlot slotId="main.before">{mainBefore}</HostPageSlot>
            <StatGrid>
              <StatCard
                label={adminInlineText(lang, 'Status')}
                value={run.status}
                tone={run.status === 'failed' ? 'red' : 'blue'}
              />
              <StatCard label={adminInlineText(lang, 'Progress')} value={`${run.progress}%`} />
              <StatCard
                label={adminInlineText(lang, 'Attempts')}
                value={`${run.attempt}/${run.maxAttempts}`}
                tone="amber"
              />
              <StatCard
                label={adminInlineText(lang, 'Next')}
                value={runWaitingExternalReason(run)}
                tone={runWaitingExternalReason(run).startsWith('waiting') ? 'amber' : 'blue'}
              />
            </StatGrid>

            <ActionPanel
              title={run.name}
              description={`${run.moduleId} · ${run.kind} · correlation ${correlationId}`}
              tone={
                run.status === 'failed'
                  ? 'danger'
                  : runCanCancel(run.status)
                    ? 'warning'
                    : 'neutral'
              }
              actions={
                <>
                  <form action={cancelRunAction} className="inline-flex">
                    <input type="hidden" name="runId" value={run.id} />
                    <input
                      type="hidden"
                      name="reason"
                      value={`Canceled from Admin Run Detail. Previous status: ${run.status}.`}
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-4 py-2 text-sm font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={!runCanCancel(run.status)}
                      confirmation={adminInlineText(lang, 'cancel_run_value_168aaf4e', {
                        value1: run.name,
                      })}
                    >
                      {adminInlineText(lang, 'Cancel')}
                    </ConfirmSubmitButton>
                  </form>
                  <form action={requeueRunAction} className="inline-flex">
                    <input type="hidden" name="runId" value={run.id} />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={!runCanRequeue(run.status)}
                      confirmation={adminInlineText(lang, 'requeue_run_value_ed01ac7b', {
                        value1: run.name,
                      })}
                    >
                      {adminInlineText(lang, 'Requeue')}
                    </ConfirmSubmitButton>
                  </form>
                </>
              }
            />

            <AdminPanel
              title={adminInlineText(lang, 'Runbook and escalation')}
              description={adminInlineText(
                lang,
                'Module, webhook, service, and audit links are visible before raw logs so failed runs have a clear next stop.'
              )}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={localizedPath(lang, `/admin/modules/${encodeURIComponent(run.moduleId)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Module')}
                  </Link>
                  <Link
                    href={localizedPath(
                      lang,
                      `/admin/webhooks?q=${encodeURIComponent(run.moduleId)}`
                    )}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Webhooks')}
                  </Link>
                  <Link
                    href={localizedPath(
                      lang,
                      `/admin/service-connections?q=${encodeURIComponent(run.moduleId)}`
                    )}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Service')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(run.id)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Audit')}
                  </Link>
                </div>
              }
            >
              <FactList
                lang={lang}
                density="compact"
                className="md:grid-cols-2"
                items={[
                  { label: 'Runbook', value: `modules/${run.moduleId}/README.md`, mono: true },
                  {
                    label: 'Escalation',
                    value: runWaitingExternalReason(run),
                    tone: runWaitingExternalReason(run).startsWith('waiting')
                      ? 'warning'
                      : 'neutral',
                  },
                  {
                    label: 'Module renderer slot',
                    value: 'host.page:admin.run-detail:main.before',
                    mono: true,
                  },
                  {
                    label: 'Side renderer slot',
                    value: 'host.page:admin.run-detail:side',
                    mono: true,
                  },
                ]}
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Execution timeline')}
              description={adminInlineText(
                lang,
                'Logs are shown as an event stream so failures can be scanned without reading raw payloads.'
              )}
            >
              <TimelineList
                lang={lang}
                items={run.logs.map((log, index) => ({
                  key: `${log.at}:${index}`,
                  title: log.message,
                  description: log.metadata ? compactJson(log.metadata, 180) : undefined,
                  meta: `${log.level} · ${log.at}`,
                  tone:
                    log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : 'primary',
                }))}
                empty={adminInlineText(lang, 'No logs recorded.')}
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Linked evidence')}
              description={adminInlineText(
                lang,
                'Outbox, delivery ledger, files, usage and audit records are grouped below the timeline.'
              )}
              contentClassName="grid gap-4"
            >
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Event / Outbox', 'Status', 'Attempts / Error'])}
                rows={
                  detail.outbox.length > 0
                    ? detail.outbox.map((record) => [
                        record.name,
                        <StatusBadge key={record.id} lang={lang} value={record.status} />,
                        `${record.attempts} · ${record.error?.message ?? 'ok'}`,
                      ])
                    : [['-', '-', '0']]
                }
                minWidthClass="min-w-[760px]"
                density="compact"
              />
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, [
                  'Delivery',
                  'Status',
                  'Worker / Attempts',
                  'Error / Retry',
                ])}
                rows={
                  detail.deliveries.length > 0
                    ? detail.deliveries.map((record) => [
                        `${record.kind} · ${record.source}`,
                        <StatusBadge key={record.id} lang={lang} value={record.status} />,
                        `${record.workerId ?? 'no worker'} · ${record.attempts}`,
                        record.error?.message ?? record.nextRetryAt ?? 'ok',
                      ])
                    : [['-', '-', 'no worker', 'No run-linked delivery ledger records']]
                }
                minWidthClass="min-w-[820px]"
                density="compact"
              />
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, [
                  'File / Artifact',
                  'Status',
                  'Purpose / Size',
                  'Storage',
                ])}
                rows={
                  detail.files.length + detail.artifacts.length > 0
                    ? [
                        ...detail.files.map((file) => [
                          file.name,
                          <StatusBadge key={file.id} lang={lang} value={file.status} />,
                          `${file.purpose} · ${file.sizeBytes} bytes`,
                          file.storageKey,
                        ]),
                        ...detail.artifacts.map((artifact) => [
                          artifact.name,
                          <StatusBadge key={artifact.id} lang={lang} value="artifact" />,
                          `${artifact.kind} · in-memory artifact`,
                          artifact.path,
                        ]),
                      ]
                    : [['-', '-', 'No run-linked files or artifacts', '-']]
                }
                minWidthClass="min-w-[820px]"
                density="compact"
              />
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Usage Meter', 'Quantity', 'Source'])}
                rows={
                  detail.usage.length > 0
                    ? detail.usage.map((record) => [
                        record.meter,
                        `${record.quantity} ${record.unit ?? 'count'}`,
                        compactJson(record.metadata, 160),
                      ])
                    : [['-', '0', 'No run-linked usage records']]
                }
                minWidthClass="min-w-[740px]"
                density="compact"
              />
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Audit', 'Actor', 'Metadata'])}
                rows={
                  detail.audit.length > 0
                    ? detail.audit.map((record) => [
                        record.type,
                        record.actorId ?? 'system',
                        compactJson(record.metadata, 160),
                      ])
                    : [['-', 'system', 'No run-linked audit records']]
                }
                minWidthClass="min-w-[740px]"
                density="compact"
              />
            </AdminPanel>

            <div className="grid gap-5 xl:grid-cols-3">
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Input')}
                description={adminInlineText(lang, 'Redacted execution input.')}
                value={JSON.stringify(redactSensitive(run.input ?? {}), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Result')}
                description={adminInlineText(lang, 'Redacted execution output.')}
                value={JSON.stringify(redactSensitive(run.result ?? {}), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Error')}
                description={adminInlineText(lang, 'Failure evidence when present.')}
                value={JSON.stringify(redactSensitive(run.error ?? {}), null, 2)}
              />
            </div>
            <HostPageSlot slotId="main.after">{mainAfter}</HostPageSlot>
          </div>

          <div className="grid gap-5 xl:sticky xl:top-24 xl:self-start">
            <HostPageSlot slotId="side">{side}</HostPageSlot>
            <DetailDrawer
              open
              title={adminInlineText(lang, 'Run snapshot')}
              description={run.id}
              actions={
                <CopyButton
                  value={run.id}
                  label={adminInlineText(lang, 'Copy ID')}
                  copiedLabel={adminInlineText(lang, 'Copied ID')}
                />
              }
            >
              <FactList
                lang={lang}
                items={[
                  { label: 'Run ID', value: run.id, copyValue: run.id, mono: true },
                  { label: 'Workspace', value: run.workspaceId ?? 'product', mono: true },
                  {
                    label: 'Correlation',
                    value: correlationId,
                    copyValue: correlationId,
                    mono: true,
                  },
                  { label: 'Idempotency', value: run.idempotencyKey ?? 'none', mono: true },
                  { label: 'Cost Ref', value: run.costRef ?? 'none', mono: true },
                  { label: 'Created', value: run.createdAt },
                  { label: 'Started', value: run.startedAt ?? 'not started' },
                  { label: 'Completed', value: run.completedAt ?? 'not completed' },
                  { label: 'Cancel Requested', value: run.cancelRequestedAt ?? 'not requested' },
                  { label: 'Updated', value: run.updatedAt },
                ]}
              />
            </DetailDrawer>
          </div>
        </div>
      ) : (
        <EmptyState title={copy.missingTitle}>{copy.missingBody}</EmptyState>
      )}
    </WorkspaceShell>
  );
}

export function AdminWebhooksOperationsPage({
  lang,
  snapshot,
  workerStatus,
  retryOutboxAction,
  discardOutboxAction,
  archiveOutboxAction,
  bulkReplayDeadLettersAction,
  bulkDiscardFailedOutboxAction,
  bulkArchiveProcessedOutboxAction,
  retryWebhookReceiptAction,
  bulkRetryFailedReceiptsAction,
  drainWorkerAction,
  bulkOutboxPreviews,
  query,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsSnapshot;
  workerStatus: AdminWorkerStatusView;
  bulkOutboxPreviews?: {
    replayDeadLetters: AdminOutboxBulkPreview;
    discardFailed: AdminOutboxBulkPreview;
    archiveProcessed: AdminOutboxBulkPreview;
  };
  retryOutboxAction: AdminFormAction;
  discardOutboxAction: AdminFormAction;
  archiveOutboxAction: AdminFormAction;
  bulkReplayDeadLettersAction: AdminFormAction;
  bulkDiscardFailedOutboxAction: AdminFormAction;
  bulkArchiveProcessedOutboxAction: AdminFormAction;
  retryWebhookReceiptAction: AdminFormAction;
  bulkRetryFailedReceiptsAction: AdminFormAction;
  drainWorkerAction: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminWebhooksCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const operationToast = operationResultToast(lang, tableQuery);
  const deadLetters = snapshot.recent.outbox.filter((record) => record.status === 'dead_letter');
  const failedOutbox = snapshot.recent.outbox.filter((record) => record.status === 'failed');
  const processedOutbox = snapshot.recent.outbox.filter((record) => record.status === 'processed');
  const retryableReceipts = snapshot.recent.webhookReceipts.filter(
    (record) => record.status === 'failed'
  );
  const outboxByKind = snapshot.recent.outbox.reduce<
    Record<'job' | 'event' | 'webhook' | 'email' | 'other', number>
  >(
    (acc, record) => {
      acc[outboxKind(record)] += 1;
      return acc;
    },
    { job: 0, event: 0, webhook: 0, email: 0, other: 0 }
  );
  const previewRows: ReactNode[][] = bulkOutboxPreviews
    ? (
        [
          [adminInlineText(lang, 'Replay Dead Letters'), bulkOutboxPreviews.replayDeadLetters],
          [adminInlineText(lang, 'Discard Failed'), bulkOutboxPreviews.discardFailed],
          [adminInlineText(lang, 'Archive Processed'), bulkOutboxPreviews.archiveProcessed],
        ] as [string, AdminOutboxBulkPreview][]
      ).map(([label, value]) => [
        label,
        `${value.selected}/${value.matched}`,
        Object.entries(value.impact.byModule)
          .map(([moduleId, count]) => `${moduleId}:${count}`)
          .join(', ') || 'none',
        value.impact.oldestCreatedAt ?? 'none',
      ])
    : [];
  const replayDeadLettersDisabled = bulkOutboxPreviews
    ? bulkOutboxPreviews.replayDeadLetters.selected === 0
    : workerStatus.queue.deadLettered === 0 && deadLetters.length === 0;
  const discardFailedOutboxDisabled = bulkOutboxPreviews
    ? bulkOutboxPreviews.discardFailed.selected === 0
    : failedOutbox.length === 0;
  const archiveProcessedOutboxDisabled = bulkOutboxPreviews
    ? bulkOutboxPreviews.archiveProcessed.selected === 0
    : processedOutbox.length === 0;
  const workerAlertTone = workerStatus.alerts.some((alert) => alert.severity === 'error')
    ? 'red'
    : workerStatus.alerts.length > 0
      ? 'amber'
      : 'blue';
  const outbox = snapshot.recent.outbox.filter(
    (record) =>
      matchesTextSearch(tableQuery.q, [
        record.id,
        record.name,
        record.moduleId ?? 'host',
        record.status,
        record.attempts,
      ]) && matchesExactFilter(tableQuery.status, record.status)
  );
  const receipts = snapshot.recent.webhookReceipts.filter(
    (receipt) =>
      matchesTextSearch(tableQuery.q, [
        receipt.id,
        receipt.webhookName,
        receipt.moduleId,
        receipt.status,
        receipt.method,
        receipt.path,
      ]) && matchesExactFilter(tableQuery.status, receipt.status)
  );
  const deliveryReviewItems = [
    ...deadLetters.slice(0, 2).map((record) => ({
      key: `dead:${record.id}`,
      title: record.name,
      description: `${record.moduleId ?? 'host'} delivery is in dead letter state after ${record.attempts} attempts.`,
      actionLabel: 'Open outbox',
      href: localizedPath(lang, `/admin/webhooks/${record.id}`),
      status: record.status,
      tone: 'danger' as const,
    })),
    ...failedOutbox.slice(0, 2).map((record) => ({
      key: `failed:${record.id}`,
      title: record.name,
      description: `${record.moduleId ?? 'host'} delivery failed and can be retried or discarded after inspection.`,
      actionLabel: 'Inspect failure',
      href: localizedPath(lang, `/admin/webhooks/${record.id}`),
      status: record.status,
      tone: 'danger' as const,
    })),
    ...retryableReceipts.slice(0, 2).map((receipt) => ({
      key: `receipt:${receipt.id}`,
      title: receipt.webhookName,
      description: `${receipt.method} ${receipt.path} failed for ${receipt.moduleId}. Retry only after checking signature and payload evidence.`,
      actionLabel: 'Review receipt',
      href: localizedPath(lang, '/admin/webhooks'),
      status: receipt.status,
      tone: 'warning' as const,
    })),
  ].slice(0, 4);

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-4">
        {operationToast}
        <StatGrid>
          <StatCard
            label={adminInlineText(lang, 'Outbox')}
            value={String(snapshot.counts.outbox)}
            helper={adminInlineText(lang, 'Delivery records')}
            tone="blue"
            icon={Activity}
          />
          <StatCard
            label={adminInlineText(lang, 'Dead Letters')}
            value={String(workerStatus.queue.deadLettered)}
            helper={adminInlineText(lang, 'Requires replay or discard')}
            tone={workerStatus.queue.deadLettered > 0 ? 'red' : 'neutral'}
            icon={TriangleAlert}
          />
          <StatCard
            label={adminInlineText(lang, 'Receipts')}
            value={String(snapshot.counts.webhookReceipts)}
            helper={adminInlineText(lang, 'Inbound webhook attempts')}
            icon={RotateCcw}
          />
          <StatCard
            label={adminInlineText(lang, 'Worker Alerts')}
            value={String(workerStatus.alerts.length)}
            helper={`${workerStatus.queue.lagMs}ms lag`}
            tone={workerAlertTone}
            icon={Clock3}
          />
        </StatGrid>

        {deliveryReviewItems.length > 0 ? (
          <ActionQueue
            lang={lang}
            title={adminInlineText(lang, 'Delivery review')}
            description={adminInlineText(
              lang,
              'Dead letters, failed deliveries, and retryable webhook receipts are promoted before full queue history.'
            )}
            status="warning"
            items={deliveryReviewItems}
          />
        ) : null}

        <AdminPanel
          title={adminInlineText(lang, 'Worker status')}
          description={`${workerStatus.workerId} · heartbeat ${workerStatus.heartbeatAt ?? 'missing'} · lag ${workerStatus.queue.lagMs}ms`}
        >
          {previewRows.length > 0 ? (
            <div className="mb-4 overflow-hidden rounded-admin-md border border-admin-border">
              <DataTable
                className="rounded-none border-0 shadow-none"
                columns={adminInlineColumns(lang, [
                  'Bulk action',
                  'Dry-run impact',
                  'Modules',
                  'Oldest',
                ])}
                rows={previewRows}
                density="compact"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <form action={drainWorkerAction} className="inline-flex">
              <input type="hidden" name="limit" value="25" />
              <ConfirmSubmitButton
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                confirmation={adminInlineText(
                  lang,
                  'trigger_worker_drain_now_this_run_processes_up_to_25_b9e93a1b'
                )}
              >
                {adminInlineText(lang, 'drain_25_worker_records_39239903')}
              </ConfirmSubmitButton>
            </form>
            <form action={bulkReplayDeadLettersAction} className="inline-flex">
              <input type="hidden" name="limit" value="50" />
              <Input
                className="h-8 w-32"
                name="reason"
                placeholder={adminInlineText(lang, 'Reason')}
                aria-label={adminInlineText(lang, 'Replay reason')}
              />
              <ConfirmSubmitButton
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                disabled={replayDeadLettersDisabled}
                confirmation={adminInlineText(lang, '确认批量重放当前 dead-letter outbox？')}
              >
                {adminInlineText(lang, 'Replay Dead Letters')}
              </ConfirmSubmitButton>
            </form>
            <form action={bulkDiscardFailedOutboxAction} className="inline-flex">
              <input type="hidden" name="limit" value="50" />
              <Input
                className="h-8 w-32"
                name="reason"
                placeholder={adminInlineText(lang, 'Reason')}
                aria-label={adminInlineText(lang, 'Discard reason')}
              />
              <ConfirmSubmitButton
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                disabled={discardFailedOutboxDisabled}
                confirmation={adminInlineText(lang, '确认批量丢弃当前 failed outbox？')}
              >
                {adminInlineText(lang, 'Discard Failed')}
              </ConfirmSubmitButton>
            </form>
            <form action={bulkArchiveProcessedOutboxAction} className="inline-flex">
              <input type="hidden" name="limit" value="50" />
              <Input
                className="h-8 w-32"
                name="reason"
                placeholder={adminInlineText(lang, 'Reason')}
                aria-label={adminInlineText(lang, 'Archive reason')}
              />
              <ConfirmSubmitButton
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                disabled={archiveProcessedOutboxDisabled}
                confirmation={adminInlineText(lang, '确认批量归档当前 processed outbox？')}
              >
                {adminInlineText(lang, 'Archive Processed')}
              </ConfirmSubmitButton>
            </form>
            <form action={bulkRetryFailedReceiptsAction} className="inline-flex">
              <input type="hidden" name="limit" value="50" />
              <Input
                className="h-8 w-32"
                name="reason"
                placeholder={adminInlineText(lang, 'Reason')}
                aria-label={adminInlineText(lang, 'Receipt retry reason')}
              />
              <ConfirmSubmitButton
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                disabled={retryableReceipts.length === 0}
                confirmation={adminInlineText(lang, '确认批量重试当前 failed webhook receipts？')}
              >
                {adminInlineText(lang, 'Retry Failed Receipts')}
              </ConfirmSubmitButton>
            </form>
          </div>
        </AdminPanel>
        <AdminPanel
          title={adminInlineText(lang, 'Worker drain scope')}
          description={adminInlineText(
            lang,
            'this_drain_action_is_the_host_worker_drain_not_webho_d7cb8a14'
          )}
        >
          <HealthRowList
            lang={lang}
            items={[
              {
                key: 'worker-scope-jobs',
                title: 'Jobs',
                detail: 'job:* outbox records and job run records.',
                meta: `${outboxByKind.job} recent`,
                status: outboxByKind.job > 0 ? 'queued' : 'clear',
                statusTone: outboxByKind.job > 0 ? 'warning' : 'success',
                tone: outboxByKind.job > 0 ? 'warning' : 'success',
                href: adminRelatedHref(lang, '/admin/runs', { type: 'job' }),
              },
              {
                key: 'worker-scope-events',
                title: 'Events',
                detail: 'event:* outbox records and subscriber delivery ledger.',
                meta: `${outboxByKind.event} recent`,
                status: outboxByKind.event > 0 ? 'queued' : 'clear',
                statusTone: outboxByKind.event > 0 ? 'warning' : 'success',
                tone: outboxByKind.event > 0 ? 'warning' : 'success',
                href: adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' }),
              },
              {
                key: 'worker-scope-webhooks',
                title: 'Webhooks',
                detail: 'webhook:* outbox records, receipts, and dead letters.',
                meta: `${outboxByKind.webhook} recent`,
                status: outboxByKind.webhook > 0 ? 'queued' : 'clear',
                statusTone: outboxByKind.webhook > 0 ? 'warning' : 'success',
                tone: outboxByKind.webhook > 0 ? 'warning' : 'success',
                href: adminRelatedHref(lang, '/admin/webhooks', { q: 'webhook:' }),
              },
              {
                key: 'worker-scope-email',
                title: 'Email',
                detail: 'email:* outbox records handled by the same worker drain.',
                meta: `${outboxByKind.email} recent`,
                status: outboxByKind.email > 0 ? 'queued' : 'clear',
                statusTone: outboxByKind.email > 0 ? 'warning' : 'success',
                tone: outboxByKind.email > 0 ? 'warning' : 'success',
                href: adminRelatedHref(lang, '/admin/webhooks', { q: 'email:' }),
              },
            ]}
          />
        </AdminPanel>
        <AdminPanel
          title={adminInlineText(lang, 'Queue pulse')}
          description={adminInlineText(
            lang,
            'Worker pressure is shown as lanes first; delivery tables stay focused on records.'
          )}
        >
          <HealthRowList
            lang={lang}
            items={[
              {
                key: 'queued',
                title: 'Queued outbox',
                detail: 'Pending deliveries waiting for worker drain.',
                meta: `${workerStatus.queue.queued} queued`,
                status: workerStatus.queue.queued > 0 ? 'waiting' : 'clear',
                statusTone: workerStatus.queue.queued > 0 ? 'warning' : 'success',
                tone: workerStatus.queue.queued > 0 ? 'warning' : 'success',
              },
              {
                key: 'processing',
                title: 'Processing',
                detail: `Heartbeat ${workerStatus.heartbeatAt ?? 'missing'}; last drain ${workerStatus.lastDrainAt ?? 'never'}.`,
                meta: `${workerStatus.queue.processing} active`,
                status: workerStatus.queue.processing > 0 ? 'active' : 'idle',
                statusTone: workerStatus.queue.processing > 0 ? 'info' : 'neutral',
                tone: workerStatus.queue.processing > 0 ? 'info' : 'neutral',
              },
              {
                key: 'failed',
                title: 'Failed deliveries',
                detail: 'Retry or discard only after checking provider and payload evidence.',
                meta: `${workerStatus.queue.failed} failed`,
                status: workerStatus.queue.failed > 0 ? 'review' : 'clear',
                statusTone: workerStatus.queue.failed > 0 ? 'danger' : 'success',
                tone: workerStatus.queue.failed > 0 ? 'danger' : 'success',
              },
              {
                key: 'dead-letter',
                title: 'Dead letters',
                detail: workerStatus.queue.oldestPendingAt
                  ? `Oldest pending item: ${workerStatus.queue.oldestPendingAt}.`
                  : 'No stuck pending delivery is currently recorded.',
                meta: `${workerStatus.queue.deadLettered} dead`,
                status: workerStatus.queue.deadLettered > 0 ? 'blocked' : 'clear',
                statusTone: workerStatus.queue.deadLettered > 0 ? 'danger' : 'success',
                tone: workerStatus.queue.deadLettered > 0 ? 'danger' : 'success',
              },
              {
                key: 'alerts',
                title: 'Worker alerts',
                detail:
                  workerStatus.alerts.length > 0
                    ? workerStatus.alerts
                        .map((alert) => `${alert.code}: ${alert.message}`)
                        .join(' · ')
                    : 'No worker pressure alerts.',
                meta: `${workerStatus.queue.lagMs}ms lag`,
                status: workerStatus.alerts.length > 0 ? 'warning' : 'clear',
                statusTone: workerStatus.alerts.length > 0 ? 'warning' : 'success',
                tone: workerStatus.alerts.length > 0 ? 'warning' : 'success',
              },
            ]}
          />
        </AdminPanel>
        <SegmentedWorkspace
          lang={lang}
          title={adminInlineText(lang, 'Delivery lanes')}
          description={adminInlineText(
            lang,
            'Outbox, receipts, and dead letters are split into separate lanes so the review queue does not blur delivery states together.'
          )}
          sections={[
            {
              key: 'webhook-outbox-lane',
              label: 'Outbox',
              count: outbox.length,
              content: (
                <DataTable
                  className="shadow-none"
                  columns={adminInlineColumns(lang, ['Outbox', 'Status', 'Module', 'Updated'])}
                  rows={outbox
                    .slice(0, 6)
                    .map((record) => [
                      record.name,
                      <StatusBadge key={`${record.id}:status`} lang={lang} value={record.status} />,
                      record.moduleId ?? 'host',
                      record.updatedAt,
                    ])}
                  minWidthClass="min-w-[720px]"
                  density="compact"
                />
              ),
            },
            {
              key: 'webhook-receipts-lane',
              label: 'Receipts',
              count: receipts.length,
              content: (
                <DataTable
                  className="shadow-none"
                  columns={adminInlineColumns(lang, ['Receipt', 'Status', 'Module', 'Path'])}
                  rows={receipts
                    .slice(0, 6)
                    .map((receipt) => [
                      receipt.webhookName,
                      <StatusBadge
                        key={`${receipt.id}:status`}
                        lang={lang}
                        value={receipt.status}
                      />,
                      receipt.moduleId,
                      `${receipt.method} ${receipt.path}`,
                    ])}
                  minWidthClass="min-w-[720px]"
                  density="compact"
                />
              ),
            },
            {
              key: 'webhook-dead-letters-lane',
              label: 'Dead letters',
              count: deadLetters.length,
              content: (
                <DataTable
                  className="shadow-none"
                  columns={adminInlineColumns(lang, ['Outbox', 'Module', 'Attempts', 'Error'])}
                  rows={deadLetters
                    .slice(0, 6)
                    .map((record) => [
                      record.name,
                      record.moduleId ?? 'host',
                      String(record.attempts),
                      record.error?.message ?? 'dead letter',
                    ])}
                  minWidthClass="min-w-[720px]"
                  density="compact"
                />
              ),
            },
          ]}
        />
        <AdminPanel
          title={adminInlineText(lang, 'Delivery records')}
          description={adminInlineText(
            lang,
            'Search outbox and receipt records together. Row actions stay compact; payload evidence lives in detail.'
          )}
          contentClassName="p-0"
        >
          <FilterBar
            lang={lang}
            embedded
            searchValue={tableQuery.q}
            searchPlaceholder="搜索 outbox、receipt、模块、路径或状态"
            filterValue={tableQuery.status}
            filterOptions={outboxStatusOptions}
            resetHref={localizedPath(lang, '/admin/webhooks')}
          />
          <div className="px-4 py-3 sm:px-5">
            <FilterResultHint
              lang={lang}
              visible={outbox.length + receipts.length}
              total={snapshot.recent.outbox.length + snapshot.recent.webhookReceipts.length}
            />
          </div>
          <DataTable
            title={adminInlineText(lang, 'Outbox')}
            description={adminInlineText(
              lang,
              'Queued, processed, failed, and dead-letter delivery records.'
            )}
            className="rounded-none border-x-0 shadow-none"
            columns={adminInlineColumns(lang, ['Outbox', 'Module', 'Status', 'Attempts', 'Action'])}
            rows={outbox.map((record) => [
              <div key={`${record.id}:outbox`} className="min-w-0">
                <Link
                  href={localizedPath(lang, `/admin/webhooks/${record.id}`)}
                  className="block truncate font-semibold text-admin-primary hover:underline"
                >
                  {record.name}
                </Link>
                <div className="mt-1 truncate text-xs text-admin-text-muted">{record.id}</div>
              </div>,
              record.moduleId ?? 'host',
              <StatusBadge key={`${record.id}:status`} lang={lang} value={record.status} />,
              String(record.attempts),
              <div key={`${record.id}:actions`} className="flex justify-end">
                <MoreActionMenu label={adminInlineText(lang, 'Actions')}>
                  <Link
                    href={localizedPath(lang, `/admin/runs?q=${encodeURIComponent(record.id)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Runs')}
                  </Link>
                  <Link
                    href={adminRelatedHref(lang, '/admin/runs', {
                      q: record.moduleId ?? record.name,
                      type: 'job',
                    })}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Jobs')}
                  </Link>
                  <Link
                    href={adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' })}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Events')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Audit')}
                  </Link>
                  <form
                    action={retryOutboxAction}
                    className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                  >
                    <input type="hidden" name="outboxId" value={record.id} />
                    <Input
                      className="h-8 w-full"
                      name="reason"
                      placeholder={adminInlineText(lang, 'Retry reason')}
                      aria-label={adminInlineText(lang, 'Retry reason')}
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={record.status === 'queued' || record.status === 'archived'}
                      confirmation={adminInlineText(lang, 'retry_outbox_value_d2601a72', {
                        value1: record.name,
                      })}
                    >
                      {adminInlineText(lang, 'Retry')}
                    </ConfirmSubmitButton>
                  </form>
                  <form
                    action={discardOutboxAction}
                    className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                  >
                    <input type="hidden" name="outboxId" value={record.id} />
                    <Input
                      className="h-8 w-full"
                      name="reason"
                      placeholder={adminInlineText(lang, 'Discard reason')}
                      aria-label={adminInlineText(lang, 'Discard reason')}
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={record.status === 'dead_letter' || record.status === 'archived'}
                      confirmation={adminInlineText(lang, 'discard_outbox_value_2d809397', {
                        value1: record.name,
                      })}
                    >
                      {adminInlineText(lang, 'Discard')}
                    </ConfirmSubmitButton>
                  </form>
                  <form
                    action={archiveOutboxAction}
                    className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                  >
                    <input type="hidden" name="outboxId" value={record.id} />
                    <Input
                      className="h-8 w-full"
                      name="reason"
                      placeholder={adminInlineText(lang, 'Archive reason')}
                      aria-label={adminInlineText(lang, 'Archive reason')}
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={record.status === 'archived'}
                      confirmation={adminInlineText(lang, 'archive_outbox_value_7c8a928b', {
                        value1: record.name,
                      })}
                    >
                      {adminInlineText(lang, 'Archive')}
                    </ConfirmSubmitButton>
                  </form>
                </MoreActionMenu>
              </div>,
            ])}
            empty={adminInlineText(lang, 'No outbox records match this filter.')}
            minWidthClass="min-w-[900px]"
          />
          <DataTable
            title={adminInlineText(lang, 'Webhook receipts')}
            description={adminInlineText(
              lang,
              'Inbound receipt status by module, method, and path.'
            )}
            className="rounded-none border-x-0 border-b-0 shadow-none"
            columns={adminInlineColumns(lang, [
              'Receipt',
              'Module',
              'Status',
              'Method',
              'Path',
              'Action',
            ])}
            rows={receipts.map((receipt) => [
              receipt.webhookName,
              receipt.moduleId,
              <StatusBadge key={`${receipt.id}:status`} lang={lang} value={receipt.status} />,
              receipt.method,
              <span key={`${receipt.id}:path`} className="max-w-64 truncate text-admin-text-muted">
                {receipt.path}
              </span>,
              <div key={`${receipt.id}:action`} className="flex flex-wrap justify-end gap-2">
                <Link
                  href={localizedPath(lang, `/admin/runs?q=${encodeURIComponent(receipt.id)}`)}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Runs')}
                </Link>
                <Link
                  href={adminRelatedHref(lang, '/admin/runs', { q: receipt.moduleId, type: 'job' })}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Jobs')}
                </Link>
                <Link
                  href={adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' })}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Events')}
                </Link>
                <Link
                  href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(receipt.id)}`)}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Audit')}
                </Link>
                <form action={retryWebhookReceiptAction} className="inline-flex">
                  <input type="hidden" name="receiptId" value={receipt.id} />
                  <Input
                    className="h-8 w-32"
                    name="reason"
                    placeholder={adminInlineText(lang, 'Reason')}
                    aria-label={adminInlineText(lang, 'Receipt retry reason')}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={
                      receipt.status === 'received' ||
                      receipt.status === 'processing' ||
                      receipt.status === 'processed'
                    }
                    confirmation={adminInlineText(lang, 'retry_webhook_receipt_value_dee92adb', {
                      value1: receipt.webhookName,
                    })}
                  >
                    {adminInlineText(lang, 'Retry')}
                  </ConfirmSubmitButton>
                </form>
              </div>,
            ])}
            empty={adminInlineText(lang, 'No webhook receipts match this filter.')}
            minWidthClass="min-w-[900px]"
          />
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}

export function AdminWebhookDetailOperationsPage({
  lang,
  detail,
  retryOutboxAction,
  discardOutboxAction,
  archiveOutboxAction,
  retryWebhookReceiptAction,
  query,
}: {
  lang: SupportedLanguage;
  detail: AdminOutboxDetailView;
  retryOutboxAction: AdminFormAction;
  discardOutboxAction: AdminFormAction;
  archiveOutboxAction: AdminFormAction;
  retryWebhookReceiptAction: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminWebhookDetailCopy(lang);
  const outbox = detail.outbox;
  const tableQuery = cleanTableQuery(query);
  const operationToast = operationResultToast(lang, tableQuery);
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {outbox ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            {operationToast}
            <StatGrid className="xl:grid-cols-3">
              <StatCard
                label={adminInlineText(lang, 'Status')}
                value={outbox.status}
                tone={
                  outbox.status === 'dead_letter' || outbox.status === 'failed' ? 'red' : 'blue'
                }
              />
              <StatCard
                label={adminInlineText(lang, 'Attempts')}
                value={String(outbox.attempts)}
                tone={outbox.attempts > 0 ? 'amber' : 'blue'}
              />
              <StatCard
                label={adminInlineText(lang, 'Module')}
                value={outbox.moduleId ?? 'host'}
                tone="amber"
              />
            </StatGrid>

            <ActionPanel
              title={outbox.name}
              description={`Delivery action for ${outbox.moduleId ?? 'host'} outbox record.`}
              tone={
                outbox.status === 'dead_letter' || outbox.status === 'failed' ? 'danger' : 'neutral'
              }
              actions={
                <>
                  <form
                    action={retryOutboxAction}
                    className="inline-flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="outboxId" value={outbox.id} />
                    <Input
                      name="reason"
                      placeholder={adminInlineText(lang, 'Reason')}
                      aria-label={adminInlineText(lang, 'Retry reason')}
                      className="h-9 w-36"
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={outbox.status === 'queued' || outbox.status === 'archived'}
                      confirmation={adminInlineText(lang, 'retry_outbox_value_d2601a72', {
                        value1: outbox.name,
                      })}
                    >
                      {adminInlineText(lang, 'Retry')}
                    </ConfirmSubmitButton>
                  </form>
                  <form
                    action={discardOutboxAction}
                    className="inline-flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="outboxId" value={outbox.id} />
                    <Input
                      name="reason"
                      placeholder={adminInlineText(lang, 'Reason')}
                      aria-label={adminInlineText(lang, 'Discard reason')}
                      className="h-9 w-36"
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-4 py-2 text-sm font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={outbox.status === 'dead_letter' || outbox.status === 'archived'}
                      confirmation={adminInlineText(lang, 'discard_outbox_value_2d809397', {
                        value1: outbox.name,
                      })}
                    >
                      {adminInlineText(lang, 'Discard')}
                    </ConfirmSubmitButton>
                  </form>
                  <form
                    action={archiveOutboxAction}
                    className="inline-flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="outboxId" value={outbox.id} />
                    <Input
                      name="reason"
                      placeholder={adminInlineText(lang, 'Reason')}
                      aria-label={adminInlineText(lang, 'Archive reason')}
                      className="h-9 w-36"
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={outbox.status === 'archived'}
                      confirmation={adminInlineText(lang, 'archive_outbox_value_7c8a928b', {
                        value1: outbox.name,
                      })}
                    >
                      {adminInlineText(lang, 'Archive')}
                    </ConfirmSubmitButton>
                  </form>
                </>
              }
            />

            <AdminPanel
              title={adminInlineText(lang, 'Related operations')}
              description={adminInlineText(
                lang,
                'outbox_detail_keeps_runs_jobs_events_service_and_aud_9d9d5900'
              )}
            >
              <HealthRowList
                lang={lang}
                items={[
                  {
                    key: 'outbox-related-runs',
                    title: 'Runs',
                    detail:
                      'Run records linked by outbox id, run id, module id, or correlation metadata.',
                    meta: outbox.id,
                    status: 'linked',
                    statusTone: 'info',
                    tone: 'info',
                    href: adminRelatedHref(lang, '/admin/runs', { q: outbox.id }),
                  },
                  {
                    key: 'outbox-related-jobs',
                    title: 'Jobs',
                    detail:
                      'Job execution is currently represented by run kind and job:* outbox records.',
                    meta: outbox.moduleId ?? 'host',
                    status: outboxKind(outbox) === 'job' ? 'current' : 'run-kind',
                    statusTone: 'info',
                    tone: 'primary',
                    href: adminRelatedHref(lang, '/admin/runs', {
                      q: outbox.moduleId ?? outbox.name,
                      type: 'job',
                    }),
                  },
                  {
                    key: 'outbox-related-events',
                    title: 'Events',
                    detail:
                      'Event delivery uses event:* outbox records and subscriber delivery ledger.',
                    meta: outboxKind(outbox) === 'event' ? outbox.name : 'event:*',
                    status: outboxKind(outbox) === 'event' ? 'current' : 'outbox-kind',
                    statusTone: 'info',
                    tone: outboxKind(outbox) === 'event' ? 'warning' : 'neutral',
                    href: adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' }),
                  },
                  {
                    key: 'outbox-related-service',
                    title: 'Service',
                    detail: 'Provider and secret readiness for the module or host service.',
                    meta: outbox.moduleId ?? 'host',
                    status: 'linked',
                    statusTone: 'info',
                    tone: 'neutral',
                    href: adminRelatedHref(lang, '/admin/service-connections', {
                      q: outbox.moduleId ?? outbox.name,
                    }),
                  },
                  {
                    key: 'outbox-related-audit',
                    title: 'Audit',
                    detail:
                      'Replay, discard, archive, receipt retry, and worker drain audit records.',
                    meta: outbox.id,
                    status: 'linked',
                    statusTone: 'info',
                    tone: 'neutral',
                    href: adminRelatedHref(lang, '/admin/audit', { q: outbox.id }),
                  },
                ]}
              />
            </AdminPanel>

            <div className="grid gap-5 lg:grid-cols-3">
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Payload')}
                description={adminInlineText(lang, 'Redacted delivery payload.')}
                value={JSON.stringify(redactSensitive(outbox.payload), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Metadata')}
                description={adminInlineText(lang, 'Redacted delivery metadata.')}
                value={JSON.stringify(redactSensitive(outbox.metadata), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Error')}
                description={adminInlineText(lang, 'Delivery failure evidence.')}
                value={JSON.stringify(redactSensitive(outbox.error ?? {}), null, 2)}
              />
            </div>

            <AdminPanel
              title={adminInlineText(lang, 'Webhook receipts')}
              description={adminInlineText(
                lang,
                'Retry is available only for receipts that are not already processing or processed.'
              )}
              contentClassName="p-0"
            >
              <DataTable
                className="rounded-none border-x-0 shadow-none"
                columns={adminInlineColumns(lang, [
                  'Webhook',
                  'Status',
                  'Attempts',
                  'Signature',
                  'Path',
                  'Error',
                  'Retry',
                ])}
                rows={
                  detail.receipts.length > 0
                    ? detail.receipts.map((receipt) => [
                        receipt.webhookName,
                        <StatusBadge
                          key={`${receipt.id}:status`}
                          lang={lang}
                          value={receipt.status}
                        />,
                        String(receipt.attempts),
                        receipt.signature ? 'present' : 'none',
                        `${receipt.method} ${receipt.path}`,
                        receipt.error?.message ?? '-',
                        <form
                          key={`${receipt.id}:retry`}
                          action={retryWebhookReceiptAction}
                          className="inline-flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="receiptId" value={receipt.id} />
                          <input type="hidden" name="outboxId" value={outbox.id} />
                          <Input
                            name="reason"
                            placeholder={adminInlineText(lang, 'Reason')}
                            aria-label={adminInlineText(lang, 'Receipt retry reason')}
                            className="h-8 w-32"
                          />
                          <ConfirmSubmitButton
                            type="submit"
                            className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                            disabled={
                              receipt.status === 'received' ||
                              receipt.status === 'processing' ||
                              receipt.status === 'processed'
                            }
                            confirmation={adminInlineText(
                              lang,
                              'retry_webhook_receipt_value_dee92adb',
                              { value1: receipt.webhookName }
                            )}
                          >
                            {adminInlineText(lang, 'Retry')}
                          </ConfirmSubmitButton>
                        </form>,
                      ])
                    : [['-', '-', '-', '-', 'No related receipts', '-', '-']]
                }
                minWidthClass="min-w-[980px]"
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Delivery ledger')}
              description={adminInlineText(
                lang,
                'Worker delivery history for this outbox and linked receipt.'
              )}
              contentClassName="p-0"
            >
              <DataTable
                className="rounded-none border-x-0 shadow-none"
                columns={adminInlineColumns(lang, [
                  'Kind / Source',
                  'Status',
                  'Attempts',
                  'Worker',
                  'Error / Retry',
                ])}
                rows={
                  detail.deliveries.length > 0
                    ? detail.deliveries.map((record) => [
                        `${record.kind} · ${record.source}`,
                        <StatusBadge key={record.id} lang={lang} value={record.status} />,
                        String(record.attempts),
                        record.workerId ?? 'no worker',
                        record.error?.message ?? record.nextRetryAt ?? 'ok',
                      ])
                    : [['-', '-', '0', 'no worker', 'No delivery ledger records for this outbox']]
                }
                minWidthClass="min-w-[920px]"
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Audit timeline')}
              description={adminInlineText(
                lang,
                'Delivery operations and replay changes for this outbox record.'
              )}
            >
              <TimelineList
                lang={lang}
                items={detail.audit.map((record) => ({
                  key: record.id,
                  title: record.type,
                  description: compactJson(record.metadata, 180),
                  meta: `${record.actorId ?? 'system'} · ${record.createdAt}`,
                  tone: record.type.includes('discard')
                    ? 'danger'
                    : record.type.includes('retry')
                      ? 'warning'
                      : 'primary',
                }))}
                empty={adminInlineText(lang, 'No related audit events.')}
              />
            </AdminPanel>
          </div>

          <DetailDrawer
            open
            title={adminInlineText(lang, 'Outbox snapshot')}
            description={outbox.id}
            actions={
              <CopyButton
                value={outbox.id}
                label={adminInlineText(lang, 'Copy ID')}
                copiedLabel={adminInlineText(lang, 'Copied ID')}
              />
            }
            className="xl:sticky xl:top-24 xl:self-start"
          >
            <FactList
              lang={lang}
              items={[
                { label: 'Outbox ID', value: outbox.id, copyValue: outbox.id, mono: true },
                { label: 'Name', value: outbox.name },
                { label: 'Module', value: outbox.moduleId ?? 'host', mono: true },
                { label: 'Status', value: outbox.status },
                { label: 'Attempts', value: String(outbox.attempts) },
                { label: 'Created', value: outbox.createdAt },
                { label: 'Updated', value: outbox.updatedAt },
              ]}
            />
          </DetailDrawer>
        </div>
      ) : (
        <EmptyState title={copy.missingTitle}>{copy.missingBody}</EmptyState>
      )}
    </WorkspaceShell>
  );
}
