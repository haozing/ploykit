import Link from 'next/link';
import type { ReactNode } from 'react';
import { Activity, Download, Search, ShieldAlert } from 'lucide-react';
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
  DetailDrawer,
  Input,
  Pagination,
  Select,
  Switch,
  Toast,
} from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { SearchCommandPalette } from '@host/components/admin/search/SearchCommandPalette';
import {
  ActionQueue,
  ActionPanel,
  AdminPanel,
  ActorPill,
  FilterBar,
  FactList,
  GroupedTimelineList,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatRelativeTime } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminAuditCopy, getAdminSearchCopy } from '@host/lib/admin-copy';
import {
  getAdminSearchQuickCommands,
  getAdminSearchResultDetail,
  getAdminSearchResultHref,
  getAdminSearchTypeLabel,
  getAdminSearchTypeOptions,
  getAdminSearchUiCopy,
  type AdminSearchResult,
} from '@host/lib/admin-search-model';
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

export function AdminAuditOperationsPage({
  lang,
  snapshot,
  auditLogs: auditLogSource,
  applyAuditRetentionAction,
  query,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsSnapshot;
  auditLogs?: RuntimeStoreAuditRecord[];
  applyAuditRetentionAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminAuditCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const showAudit = tableQuery.type.length === 0 || tableQuery.type === 'audit';
  const showUsage = tableQuery.type.length === 0 || tableQuery.type === 'usage';
  const sourceAuditLogs = auditLogSource ?? snapshot.recent.auditLogs;
  const auditStatusText = (record: RuntimeStoreAuditRecord) =>
    [
      compactJson(record.metadata),
      record.type,
      record.integrity?.category,
      record.integrity?.risk,
      record.integrity?.resourceType,
      record.integrity?.resourceId,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  const auditLogs = sourceAuditLogs.filter(
    (record) =>
      matchesTextSearch(tableQuery.q, [
        record.id,
        record.type,
        record.actorId ?? 'system',
        record.moduleId ?? 'host',
        record.productId,
        record.workspaceId ?? '',
        record.integrity?.category ?? '',
        record.integrity?.risk ?? '',
        record.integrity?.resourceType ?? '',
        record.integrity?.resourceId ?? '',
        record.integrity?.correlationId ?? '',
        record.integrity?.recordHash ?? '',
        compactJson(record.metadata, 160),
        record.createdAt,
      ]) &&
      (!tableQuery.status || auditStatusText(record).includes(tableQuery.status.toLowerCase())) &&
      (!tableQuery.type || record.type.includes(tableQuery.type) || tableQuery.type === 'audit')
  );
  const usageRecords = snapshot.recent.usageRecords.filter((record) =>
    matchesTextSearch(tableQuery.q, [
      record.id,
      record.meter,
      record.moduleId,
      record.quantity,
      record.unit ?? '',
      record.createdAt,
    ])
  );
  const visibleCount = (showAudit ? auditLogs.length : 0) + (showUsage ? usageRecords.length : 0);
  const totalCount = sourceAuditLogs.length + snapshot.recent.usageRecords.length;
  const exportParams = new URLSearchParams();
  exportParams.set('format', 'csv');
  exportParams.set('limit', '200');
  const jsonExportParams = new URLSearchParams(exportParams);
  jsonExportParams.set('format', 'json');
  if (tableQuery.q) {
    exportParams.set('q', tableQuery.q);
    jsonExportParams.set('q', tableQuery.q);
  }
  if (tableQuery.status) {
    exportParams.set('status', tableQuery.status);
    jsonExportParams.set('status', tableQuery.status);
  }
  if (tableQuery.from) {
    exportParams.set('from', tableQuery.from);
    jsonExportParams.set('from', tableQuery.from);
  }
  if (tableQuery.to) {
    exportParams.set('to', tableQuery.to);
    jsonExportParams.set('to', tableQuery.to);
  }
  if (tableQuery.type && tableQuery.type !== 'usage' && tableQuery.type !== 'audit') {
    exportParams.set('type', tableQuery.type);
    jsonExportParams.set('type', tableQuery.type);
  }
  const pageSize = tableQuery.pageSize || 20;
  const auditTotalPages = Math.max(1, Math.ceil(auditLogs.length / pageSize));
  const auditPage = Math.min(Math.max(tableQuery.page || 1, 1), auditTotalPages);
  const pageStart = (auditPage - 1) * pageSize;
  const pagedAuditLogs = auditLogs.slice(pageStart, pageStart + pageSize);
  const actionStats = auditLogs.reduce<Record<string, number>>((acc, record) => {
    const action = record.type.split('.').slice(0, 3).join('.');
    acc[action] = (acc[action] ?? 0) + 1;
    return acc;
  }, {});
  const isFailureAudit = (record: RuntimeStoreAuditRecord) =>
    record.integrity?.risk === 'medium' ||
    ['failed', 'denied', 'blocked', 'error'].some((token) =>
      compactJson(record.metadata).toLowerCase().includes(token)
    );
  const isDangerousAudit = (record: RuntimeStoreAuditRecord) =>
    record.integrity?.risk === 'high' ||
    ['delete', 'revoke', 'archive', 'discard', 'disable', 'retention'].some((token) =>
      record.type.includes(token)
    );
  const auditActorType = (record: RuntimeStoreAuditRecord) => {
    const actor = (record.actorId ?? '').toLowerCase();
    if (!actor || actor === 'system') {
      return 'system' as const;
    }
    if (record.type.startsWith('admin.') || actor.startsWith('admin') || actor.includes('admin')) {
      return 'admin' as const;
    }
    if (actor.includes('worker') || record.type.includes('worker')) {
      return 'worker' as const;
    }
    if (actor.startsWith('module:') || record.moduleId) {
      return 'module' as const;
    }
    if (actor.includes('@') || actor.startsWith('user')) {
      return 'user' as const;
    }
    return 'unknown' as const;
  };
  const auditActionLabel = (record: RuntimeStoreAuditRecord) => {
    if (isFailureAudit(record)) {
      return 'failed';
    }
    if (record.type.includes('delete') || record.type.includes('discard')) {
      return 'destructive';
    }
    if (record.type.includes('revoke') || record.type.includes('disable')) {
      return 'access';
    }
    if (record.type.includes('archive') || record.type.includes('retention')) {
      return 'retention';
    }
    if (record.type.includes('billing') || record.type.includes('payment')) {
      return 'commerce';
    }
    if (record.integrity?.category === 'commercial') {
      return 'commerce';
    }
    return 'operation';
  };
  const auditActionFamily = (record: RuntimeStoreAuditRecord) => {
    const label = auditActionLabel(record);
    if (label === 'failed') {
      return {
        label: 'Failure',
        detail: 'The record includes failed, denied, blocked, or error metadata.',
        status: 'failed',
        tone: 'danger' as const,
      };
    }
    if (label === 'destructive') {
      return {
        label: 'Destructive',
        detail: 'Delete or discard action; review impact and actor before cleanup.',
        status: 'sensitive',
        tone: 'warning' as const,
      };
    }
    if (label === 'access') {
      return {
        label: 'Access change',
        detail: 'Permission, entitlement, or disable/revoke action.',
        status: 'sensitive',
        tone: 'warning' as const,
      };
    }
    if (label === 'retention') {
      return {
        label: 'Retention',
        detail: 'Retention, archive, or evidence lifecycle policy action.',
        status: 'retention',
        tone: 'warning' as const,
      };
    }
    if (label === 'commerce') {
      return {
        label: 'Commerce',
        detail: 'Billing, payment, order, or settlement operation.',
        status: 'commerce',
        tone: 'neutral' as const,
      };
    }
    return {
      label: 'Operation',
      detail: 'Routine host, module, or product operation.',
      status: 'operation',
      tone: 'neutral' as const,
    };
  };
  const actorStats = auditLogs.reduce<Record<string, number>>((acc, record) => {
    const type = auditActorType(record);
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  const familyStats = auditLogs.reduce<Record<string, number>>((acc, record) => {
    const family = auditActionFamily(record).label;
    acc[family] = (acc[family] ?? 0) + 1;
    return acc;
  }, {});
  const failureCount = auditLogs.filter(isFailureAudit).length;
  const dangerousActions = auditLogs.filter(isDangerousAudit).length;
  const auditReviewItems = [
    failureCount > 0
      ? {
          key: 'audit-failures',
          title: adminInlineText(lang, 'Failed or denied operations'),
          description:
            lang === 'zh'
              ? `${failureCount} 条审计记录包含失败、拒绝、阻塞或错误元数据。清理前请复核操作者、范围和影响。`
              : `${failureCount} audit records include failed, denied, blocked, or error metadata. Review actor, scope, and impact before cleanup.`,
          actionLabel: adminInlineText(lang, 'Review audit'),
          href: localizedPath(lang, '/admin/audit?status=failed'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    dangerousActions > 0
      ? {
          key: 'dangerous-actions',
          title: adminInlineText(lang, 'Dangerous actions observed'),
          description:
            lang === 'zh'
              ? `${dangerousActions} 条记录涉及删除、撤销、归档、丢弃、禁用或保留策略操作。`
              : `${dangerousActions} records involve delete, revoke, archive, discard, disable, or retention operations.`,
          actionLabel: adminInlineText(lang, 'Review actions'),
          href: localizedPath(lang, '/admin/audit'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const focusAudit =
    pagedAuditLogs.find(isDangerousAudit) ??
    pagedAuditLogs.find(isFailureAudit) ??
    pagedAuditLogs[0] ??
    auditLogs[0] ??
    null;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/api/admin/audit?${exportParams.toString()}`}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {copy.exportCsv}
          </Link>
          <Link
            href={`/api/admin/audit?${jsonExportParams.toString()}`}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {copy.exportJson}
          </Link>
        </div>
        <StatGrid>
          <StatCard
            label={adminInlineText(lang, 'Audit Actions')}
            value={String(auditLogs.length)}
            helper={adminInlineText(lang, 'value_visible_6a947562', { value1: visibleCount })}
            tone="blue"
            icon={Activity}
          />
          <StatCard
            label={adminInlineText(lang, 'Failures')}
            value={String(failureCount)}
            helper={adminInlineText(lang, 'Failed, denied, blocked, or error')}
            tone={failureCount > 0 ? 'red' : 'neutral'}
            icon={ShieldAlert}
          />
          <StatCard
            label={adminInlineText(lang, 'Dangerous')}
            value={String(dangerousActions)}
            helper={adminInlineText(lang, 'Delete, revoke, archive, discard')}
            tone={dangerousActions > 0 ? 'amber' : 'neutral'}
            icon={ShieldAlert}
          />
          <StatCard
            label={adminInlineText(lang, 'Usage Records')}
            value={String(usageRecords.length)}
            helper={adminInlineText(lang, 'Operational usage traces')}
            icon={Search}
          />
        </StatGrid>
        {auditReviewItems.length > 0 ? (
          <ActionQueue
            lang={lang}
            title={adminInlineText(lang, 'Security review')}
            description={adminInlineText(
              lang,
              'High-signal audit records are promoted before the full event timeline.'
            )}
            status="warning"
            items={auditReviewItems}
          />
        ) : null}
        {focusAudit ? (
          <DetailDrawer
            open
            title={adminInlineText(lang, 'Audit detail')}
            description={`${focusAudit.type} · ${focusAudit.id}`}
            className="mb-5"
            actions={[
              <Link
                key="search"
                href={localizedPath(lang, `/admin/search?q=${encodeURIComponent(focusAudit.id)}`)}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Search')}
              </Link>,
              <Link
                key="module"
                href={localizedPath(
                  lang,
                  `/admin/modules?q=${encodeURIComponent(focusAudit.moduleId ?? '')}`
                )}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Module')}
              </Link>,
              <Link
                key="user"
                href={localizedPath(
                  lang,
                  `/admin/users?q=${encodeURIComponent(focusAudit.actorId ?? '')}`
                )}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Actor')}
              </Link>,
            ]}
          >
            <FactList
              lang={lang}
              density="compact"
              items={[
                { label: 'Audit ID', value: focusAudit.id, copyValue: focusAudit.id, mono: true },
                { label: 'Type', value: focusAudit.type },
                { label: 'Actor', value: focusAudit.actorId ?? 'system' },
                { label: 'Module', value: focusAudit.moduleId ?? 'host' },
                { label: 'Product', value: focusAudit.productId },
                { label: 'Workspace', value: focusAudit.workspaceId ?? 'global' },
                { label: 'Risk', value: focusAudit.integrity?.risk ?? 'unknown' },
                { label: 'Category', value: focusAudit.integrity?.category ?? 'none' },
                { label: 'Resource', value: focusAudit.integrity?.resourceType ?? 'none' },
                {
                  label: 'Resource ID',
                  value: focusAudit.integrity?.resourceId ?? 'none',
                  mono: true,
                },
                {
                  label: 'Correlation',
                  value: focusAudit.integrity?.correlationId ?? 'none',
                  mono: true,
                },
                {
                  label: 'Record hash',
                  value: focusAudit.integrity?.recordHash ?? 'none',
                  mono: true,
                },
                { label: 'Created', value: focusAudit.createdAt },
              ]}
            />
            <div className="mt-4 rounded-admin-md border border-admin-border bg-admin-bg/45">
              <div className="border-b border-admin-border px-3 py-2 text-xs font-semibold uppercase text-admin-text-subtle">
                {adminInlineText(lang, 'Metadata')}
              </div>
              <pre className="max-h-56 overflow-auto break-all p-3 text-xs leading-5 text-admin-text-muted">
                {JSON.stringify(redactSensitive(focusAudit.metadata), null, 2)}
              </pre>
            </div>
          </DetailDrawer>
        ) : null}
        {applyAuditRetentionAction ? (
          <ActionPanel
            title={adminInlineText(lang, 'Audit retention')}
            description={adminInlineText(
              lang,
              'Apply audit retention policy. The policy action itself is written back to audit.'
            )}
            tone="warning"
            actions={
              <form
                action={applyAuditRetentionAction}
                className="flex flex-wrap items-center gap-2"
              >
                <Input
                  name="retentionDays"
                  placeholder="90"
                  aria-label={adminInlineText(lang, 'Retention days')}
                  className="h-9 w-24"
                />
                <Select
                  name="mode"
                  defaultValue="archive"
                  aria-label={adminInlineText(lang, 'Retention mode')}
                  className="h-9 w-44"
                >
                  <option value="archive">{adminInlineText(lang, 'Archive marker')}</option>
                  <option value="hide-before-cutoff">
                    {adminInlineText(lang, 'Hide before cutoff')}
                  </option>
                  <option value="delete">{adminInlineText(lang, 'Delete policy marker')}</option>
                </Select>
                <Input
                  name="reason"
                  placeholder={adminInlineText(lang, 'reason')}
                  aria-label={adminInlineText(lang, 'Retention reason')}
                  className="h-9 w-40"
                />
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(lang, '确认应用 Audit retention policy？')}
                >
                  {adminInlineText(lang, 'Apply')}
                </ConfirmSubmitButton>
              </form>
            }
          />
        ) : null}
        <AdminPanel
          title={adminInlineText(lang, 'Audit timeline')}
          description={adminInlineText(
            lang,
            'Filter security and usage evidence by actor, module, meter, scope, or metadata.'
          )}
          contentClassName="p-0"
        >
          <FilterBar
            lang={lang}
            embedded
            searchValue={tableQuery.q}
            searchPlaceholder="搜索审计类型、Actor、模块或 meter"
            filterName="type"
            filterValue={tableQuery.type}
            filterLabel="记录"
            filterOptions={recordTypeOptions}
            resetHref={localizedPath(lang, '/admin/audit')}
          />
          <div className="px-4 py-3 sm:px-5">
            <FilterResultHint lang={lang} visible={visibleCount} total={totalCount} />
          </div>
          <DataTable
            className="rounded-none border-x-0 shadow-none"
            columns={adminInlineColumns(lang, ['Group', 'Count'])}
            rows={[
              ...Object.entries(actorStats).map(([actor, count]) => [
                `actor:${actor}`,
                String(count),
              ]),
              ...Object.entries(familyStats).map(([family, count]) => [
                `family:${family}`,
                String(count),
              ]),
              ...Object.entries(actionStats).map(([action, count]) => [action, String(count)]),
            ]}
          />
          {showAudit ? (
            <div className="px-4 py-4 sm:px-5">
              <GroupedTimelineList
                lang={lang}
                items={pagedAuditLogs.map((record) => {
                  const family = auditActionFamily(record);
                  const integritySummary = record.integrity
                    ? ` · ${record.integrity.category}/${record.integrity.risk}/${record.integrity.recordHash.slice(0, 19)}`
                    : '';
                  return {
                    key: record.id,
                    group: record.createdAt.slice(0, 10),
                    title: (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ActorPill
                          actorId={record.actorId}
                          actorType={auditActorType(record)}
                          tone={
                            family.tone === 'danger'
                              ? 'danger'
                              : family.tone === 'warning'
                                ? 'warning'
                                : 'neutral'
                          }
                        />
                        <StatusBadge
                          lang={lang}
                          value={family.status}
                          label={family.label}
                          tone={family.tone}
                        />
                        <span className="min-w-0 truncate">{record.type}</span>
                      </span>
                    ),
                    description: `${family.detail} ${compactJson(record.metadata, 220)}${integritySummary}`,
                    meta: `${record.productId}/${record.workspaceId ?? 'global'}/${record.moduleId ?? 'host'} · ${record.createdAt}`,
                    status:
                      family.tone === 'danger' || family.tone === 'warning'
                        ? family.status
                        : undefined,
                    statusTone:
                      family.tone === 'danger' || family.tone === 'warning'
                        ? family.tone
                        : undefined,
                    tone:
                      family.tone === 'danger'
                        ? 'danger'
                        : family.tone === 'warning'
                          ? 'warning'
                          : 'primary',
                  };
                })}
                empty={adminInlineText(lang, 'No audit records match this filter.')}
              />
            </div>
          ) : null}
          {showAudit ? (
            <Pagination
              page={auditPage}
              totalPages={auditTotalPages}
              previousHref={
                auditPage > 1
                  ? adminListHref(lang, '/admin/audit', tableQuery, auditPage - 1)
                  : undefined
              }
              nextHref={
                auditPage < auditTotalPages
                  ? adminListHref(lang, '/admin/audit', tableQuery, auditPage + 1)
                  : undefined
              }
            />
          ) : null}
          {showUsage ? (
            <DataTable
              className="rounded-none border-x-0 border-b-0 shadow-none"
              columns={adminInlineColumns(lang, ['Meter', 'Module', 'Quantity'])}
              rows={usageRecords.map((record) => [
                record.meter,
                record.moduleId,
                String(record.quantity),
              ])}
            />
          ) : null}
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}

export function AdminSearchOperationsPage({
  lang,
  results,
  query,
}: {
  lang: SupportedLanguage;
  results: AdminPagedResult<AdminSearchResult>;
  query?: AdminTableQuery;
}) {
  const copy = getAdminSearchCopy(lang);
  const searchCopy = getAdminSearchUiCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const categories = Array.from(
    results.items.reduce(
      (acc, item) => acc.set(item.type, (acc.get(item.type) ?? 0) + 1),
      new Map<string, number>()
    )
  );
  const groupedResults = categories.map(([type]) => ({
    type,
    label: getAdminSearchTypeLabel(lang, type),
    items: results.items.filter((item) => item.type === type),
  }));
  const quickSearches = [
    tableQuery.q,
    ...categories.map(([type]) => type),
    'users',
    'runs',
    'files',
    'orders',
    'modules',
    'outbox',
  ]
    .filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
    )
    .slice(0, 8);
  const searchTotalPages = Math.max(1, Math.ceil(results.page.total / results.page.limit));
  const searchPage = Math.min(
    Math.max(Math.floor(results.page.offset / results.page.limit) + 1, 1),
    searchTotalPages
  );
  return (
    <WorkspaceShell
      lang={lang}
      title={copy.title}
      subtitle={copy.subtitle}
      nav={adminNav}
      actions={
        <Link
          href="#global-search-panel"
          className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
        >
          {adminInlineText(lang, 'jump_to_search_panel_8493feeb')}
        </Link>
      }
    >
      <StatGrid className="xl:grid-cols-3">
        <StatCard
          label={adminInlineText(lang, 'Results')}
          value={String(results.items.length)}
          helper={adminInlineText(lang, 'value_total_matches_84f4f25f', {
            value1: results.page.total,
          })}
          tone="blue"
          icon={Search}
        />
        <StatCard
          label={adminInlineText(lang, 'Categories')}
          value={String(categories.length)}
          helper={
            categories.map(([type]) => getAdminSearchTypeLabel(lang, type)).join(', ') ||
            adminInlineText(lang, 'none')
          }
          icon={Activity}
        />
        <StatCard
          label={adminInlineText(lang, 'Query')}
          value={tableQuery.q || adminInlineText(lang, 'empty_5c14a56d')}
          helper={adminInlineText(lang, 'Global lookup')}
          tone={tableQuery.q ? 'amber' : 'neutral'}
          icon={Search}
        />
      </StatGrid>
      <SearchCommandPalette
        lang={lang}
        basePath={localizedPath(lang, '/admin/search')}
        currentQuery={tableQuery.q}
        quickSearches={quickSearches}
        commands={getAdminSearchQuickCommands(lang)}
        placeholder={searchCopy.placeholder}
        submitLabel={searchCopy.submit}
        ariaLabel={searchCopy.queryLabel}
      />
      <AdminPanel
        id="global-search-panel"
        title={adminInlineText(lang, 'Global search')}
        description={adminInlineText(
          lang,
          'Results are grouped by object type so search does not feel like a raw dump.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          searchValue={tableQuery.q}
          searchPlaceholder={searchCopy.placeholder}
          filterName="type"
          filterValue={tableQuery.type}
          filterLabel={searchCopy.typeLabel}
          filterOptions={getAdminSearchTypeOptions(lang)}
          resetHref={localizedPath(lang, '/admin/search')}
        />
        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-admin-border px-4 py-3 sm:px-5">
            {categories.map(([type, count]) => (
              <span
                key={type}
                className="rounded-full border border-admin-border bg-admin-bg px-2.5 py-1 text-xs font-semibold text-admin-text-muted"
              >
                {getAdminSearchTypeLabel(lang, type)} · {count}
              </span>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 p-4 sm:p-5">
          {groupedResults.length > 0 ? (
            groupedResults.map((group) => (
              <section
                key={group.type}
                className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-bg/45"
              >
                <div className="flex items-center justify-between gap-3 border-b border-admin-border bg-admin-surface-muted px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
                    {group.label}
                  </span>
                  <span className="text-xs font-semibold text-admin-text-muted">
                    {group.items.length}
                  </span>
                </div>
                <div className="divide-y divide-admin-border">
                  {group.items.map((item) => (
                    <Link
                      key={`${item.type}:${item.id}`}
                      href={getAdminSearchResultHref(lang, item)}
                      className="flex min-w-0 items-center justify-between gap-3 px-3 py-3 transition hover:bg-admin-surface-muted"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-admin-text">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-admin-text-muted">
                          {getAdminSearchResultDetail(lang, item)}
                        </span>
                        <span className="mt-1 block text-[11px] text-admin-text-muted">
                          {[
                            item.updatedAt
                              ? `${adminInlineText(lang, 'Updated')} ${formatRelativeTime(item.updatedAt, lang)}`
                              : null,
                            item.risk
                              ? `${adminInlineText(lang, 'Risk')} ${adminInlineText(lang, item.risk)}`
                              : null,
                            item.matchedFields?.length
                              ? `${adminInlineText(lang, 'Matched')} ${item.matchedFields.join(', ')}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || adminInlineText(lang, 'No extra evidence')}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                          {item.type}:{item.id}
                        </span>
                      </span>
                      <StatusBadge
                        lang={lang}
                        value={item.status ?? item.type}
                        label={
                          item.status
                            ? adminInlineText(lang, item.status)
                            : getAdminSearchTypeLabel(lang, item.type)
                        }
                        tone="neutral"
                      />
                    </Link>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <EmptyState
              title={
                tableQuery.q
                  ? adminInlineText(lang, 'no_search_results_3b8d6a21')
                  : adminInlineText(lang, 'search_across_admin_objects_8aa9cb52')
              }
            >
              {tableQuery.q
                ? adminInlineText(lang, 'no_admin_search_matches_body_793e79e5')
                : adminInlineText(lang, 'admin_search_empty_body_e63fc734')}
            </EmptyState>
          )}
        </div>
        {searchTotalPages > 1 ? (
          <Pagination
            page={searchPage}
            totalPages={searchTotalPages}
            previousHref={
              searchPage > 1
                ? adminListHref(lang, '/admin/search', tableQuery, searchPage - 1)
                : undefined
            }
            nextHref={
              searchPage < searchTotalPages
                ? adminListHref(lang, '/admin/search', tableQuery, searchPage + 1)
                : undefined
            }
          />
        ) : null}
      </AdminPanel>
    </WorkspaceShell>
  );
}
