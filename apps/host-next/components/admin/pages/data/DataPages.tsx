import Link from 'next/link';
import type { ReactNode } from 'react';
import { Archive, Database, FileWarning, FolderOpen } from 'lucide-react';
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
import {
  AdvancedFilterPanel,
  ActionQueue,
  ActionPanel,
  AdminPanel,
  ChartPanel,
  CodeBlockPanel,
  EntityListItem,
  EvidenceSection,
  FactList,
  FilterBar,
  MoreActionMenu,
  TimelineList,
  SegmentedWorkspace,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatBytes } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import {
  getAdminAnalyticsCopy,
  getAdminFileDetailCopy,
  getAdminFilesCopy,
  getAdminUsageCopy,
} from '@host/lib/admin-copy';
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
  AdminFileStorageReconcileReport,
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

export function AdminUsageOperationsPage({
  lang,
  usage,
  metering,
  query,
}: {
  lang: SupportedLanguage;
  usage: AdminPagedResult<RuntimeStoreUsageRecord>;
  metering: AdminPagedResult<RuntimeStoreMeteringLedgerEntry>;
  query?: AdminTableQuery;
}) {
  const copy = getAdminUsageCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const usageTotal = usage.items.reduce((sum, record) => sum + record.quantity, 0);
  const meteringTotal = metering.items.reduce((sum, record) => sum + record.quantity, 0);
  const committed = metering.items.filter((record) => record.status === 'committed').length;
  const openMetering = metering.items.filter((record) => record.status !== 'committed');
  const usageMedian =
    usage.items.length > 0
      ? ([...usage.items].sort((left, right) => left.quantity - right.quantity)[
          Math.floor(usage.items.length / 2)
        ]?.quantity ?? 0)
      : 0;
  const abnormalUsage = usage.items.filter(
    (record) => record.quantity < 0 || (usageMedian > 0 && record.quantity > usageMedian * 5)
  );
  const planContext = usage.items
    .map((record) => record.metadata.planId ?? record.metadata.plan ?? record.metadata.sku)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const quotaContext = usage.items
    .map((record) => record.metadata.quota ?? record.metadata.limit ?? record.metadata.credits)
    .filter((value) => value !== undefined && value !== null);
  const usageReviewItems = [
    openMetering.length > 0
      ? {
          key: 'open-metering',
          title: adminInlineText(lang, 'open_metering_records_95a992f4'),
          description: adminInlineText(
            lang,
            'value_metering_records_are_not_committed_refunded_vo_5c9787fb',
            { value1: openMetering.length }
          ),
          actionLabel: adminInlineText(lang, 'review_metering_20a2765f'),
          href: localizedPath(lang, '/admin/usage?status=authorized'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    abnormalUsage.length > 0
      ? {
          key: 'abnormal-usage',
          title: adminInlineText(lang, 'abnormal_usage_244b13b9'),
          description: adminInlineText(
            lang,
            'value_usage_records_are_negative_or_above_5x_the_med_fb589824',
            { value1: abnormalUsage.length }
          ),
          actionLabel: adminInlineText(lang, 'review_usage_28a975f1'),
          href: localizedPath(lang, '/admin/usage'),
          status: 'review',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const usageTrend = usage.items.slice(0, 7).reverse();
  const meteringTrend = metering.items.slice(0, 7).reverse();
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Usage Records')}
          value={String(usage.page.total)}
          tone="blue"
        />
        <StatCard label={adminInlineText(lang, 'Usage Quantity')} value={String(usageTotal)} />
        <StatCard
          label={adminInlineText(lang, 'Meter Records')}
          value={String(metering.page.total)}
          tone="amber"
        />
        <StatCard label={adminInlineText(lang, 'Committed')} value={String(committed)} />
      </StatGrid>
      {usageReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'usage_review_9c908708')}
          description={adminInlineText(
            lang,
            'overages_anomalies_and_open_metering_are_promoted_be_14532b42'
          )}
          status="warning"
          items={usageReviewItems}
        />
      ) : null}
      <AdminPanel
        title={adminInlineText(lang, 'quota_credits_plan_context_0cf34cc2')}
        description={adminInlineText(
          lang,
          'quota_credits_and_plan_context_is_derived_from_usage_44a1516a'
        )}
      >
        <FactList
          lang={lang}
          density="compact"
          items={[
            {
              label: 'Plans / SKUs',
              value:
                planContext.slice(0, 4).join(', ') || adminInlineText(lang, 'no_metadata_9c6a99e4'),
            },
            {
              label: 'Quota / credits',
              value:
                quotaContext.slice(0, 4).map(String).join(', ') ||
                adminInlineText(lang, 'no_metadata_9c6a99e4'),
            },
            { label: 'Open metering', value: String(openMetering.length) },
            { label: 'Abnormal usage', value: String(abnormalUsage.length) },
          ]}
        />
      </AdminPanel>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel
          title={adminInlineText(lang, 'Usage trend')}
          description={adminInlineText(
            lang,
            'Recent usage quantities by record order. Empty states stay explicit.'
          )}
          values={usageTrend.map((record) => record.quantity)}
          labels={usageTrend.map((record) => record.meter)}
          stats={[
            {
              key: 'total',
              label: 'Usage quantity',
              value: usageTotal,
              detail: `${usage.items.length} loaded`,
              tone: 'info',
            },
            {
              key: 'meters',
              label: 'Meters',
              value: new Set(usage.items.map((record) => record.meter)).size,
              detail: 'unique meters',
              tone: 'neutral',
            },
            {
              key: 'modules',
              label: 'Modules',
              value: new Set(usage.items.map((record) => record.moduleId)).size,
              detail: 'usage sources',
              tone: 'success',
            },
          ]}
          empty={adminInlineText(lang, 'No usage records in this window.')}
        />
        <ChartPanel
          title={adminInlineText(lang, 'Metering ledger')}
          description={adminInlineText(
            lang,
            'Authorized, committed, refunded, and voided records by quantity.'
          )}
          values={meteringTrend.map((record) => record.quantity)}
          labels={meteringTrend.map((record) => record.status)}
          stats={[
            {
              key: 'metering',
              label: 'Metering quantity',
              value: meteringTotal,
              detail: `${metering.items.length} loaded`,
              tone: 'info',
            },
            {
              key: 'committed',
              label: 'Committed',
              value: committed,
              detail: 'recognized usage',
              tone: 'success',
            },
            {
              key: 'open',
              label: 'Open records',
              value: metering.items.length - committed,
              detail: 'not committed',
              tone: metering.items.length - committed > 0 ? 'warning' : 'neutral',
            },
          ]}
          tone="warning"
          empty={adminInlineText(lang, 'No metering records in this window.')}
        />
      </div>
      <AdminPanel
        title={adminInlineText(lang, 'Usage records')}
        description={adminInlineText(
          lang,
          'Filter usage and metering by meter, module, state, product scope, or metadata.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索 meter、模块、状态或用量"
          filterValue={tableQuery.status}
          filterOptions={meteringStatusOptions}
          resetHref={localizedPath(lang, '/admin/usage')}
        />
        <DataTable
          className="hidden rounded-none border-x-0 shadow-none xl:block"
          columns={adminInlineColumns(lang, [
            'Meter',
            'Module',
            'Workspace',
            'Quantity',
            'Unit',
            'Status',
            'Source',
            'Action',
          ])}
          rows={metering.items.map((record) => [
            record.meter,
            <Link
              key={`${record.id}:module`}
              href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
              className="font-semibold text-admin-primary hover:underline"
            >
              {record.moduleId}
            </Link>,
            record.workspaceId ?? 'global',
            String(record.quantity),
            record.unit ?? 'count',
            <StatusBadge key={record.id} lang={lang} value={record.status} />,
            compactJson(record.metadata, 140),
            <div key={`${record.id}:action`} className="flex flex-wrap gap-2">
              <Link
                href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`)}
                className="text-xs font-semibold text-admin-primary hover:underline"
              >
                {adminInlineText(lang, 'audit_de9bcda7')}
              </Link>
              <Link
                href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
                className="text-xs font-semibold text-admin-primary hover:underline"
              >
                {adminInlineText(lang, 'module_46c34f61')}
              </Link>
            </div>,
          ])}
        />
        <DataTable
          className="hidden rounded-none border-x-0 border-b-0 shadow-none xl:block"
          columns={adminInlineColumns(lang, [
            'Usage',
            'Module',
            'Quantity',
            'Unit',
            'Source',
            'Created',
            'Action',
          ])}
          rows={usage.items.map((record) => [
            record.meter,
            <Link
              key={`${record.id}:module`}
              href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
              className="font-semibold text-admin-primary hover:underline"
            >
              {record.moduleId}
            </Link>,
            String(record.quantity),
            record.unit ?? 'count',
            compactJson(record.metadata, 140),
            record.createdAt,
            <div key={`${record.id}:action`} className="flex flex-wrap gap-2">
              <Link
                href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`)}
                className="text-xs font-semibold text-admin-primary hover:underline"
              >
                {adminInlineText(lang, 'audit_de9bcda7')}
              </Link>
              <Link
                href={localizedPath(lang, `/admin/modules/${record.moduleId}`)}
                className="text-xs font-semibold text-admin-primary hover:underline"
              >
                {adminInlineText(lang, 'module_46c34f61')}
              </Link>
            </div>,
          ])}
        />
        <div className="grid gap-2 px-2 py-2 xl:hidden">
          {[
            ...metering.items.map((record) => ({
              key: `meter:${record.id}`,
              href: localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`),
              title: record.meter,
              subtitle: `${record.moduleId} · ${record.workspaceId ?? 'global'}`,
              status: record.status,
              detail: `${record.quantity} ${record.unit ?? 'count'} · ${compactJson(record.metadata, 80)}`,
              meta: record.updatedAt,
            })),
            ...usage.items.map((record) => ({
              key: `usage:${record.id}`,
              href: localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`),
              title: record.meter,
              subtitle: `${record.moduleId} · ${record.workspaceId ?? 'global'}`,
              status: 'usage',
              detail: `${record.quantity} ${record.unit ?? 'count'} · ${compactJson(record.metadata, 80)}`,
              meta: record.createdAt,
            })),
          ].map((item) => (
            <EntityListItem
              lang={lang}
              key={item.key}
              href={item.href}
              title={item.title}
              subtitle={item.subtitle}
              status={item.status}
              detail={item.detail}
              meta={item.meta}
              icon={Database}
              tone={item.status === 'committed' || item.status === 'usage' ? 'primary' : 'warning'}
            />
          ))}
        </div>
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function AdminAnalyticsOperationsPage({
  lang,
  analytics,
  query,
}: {
  lang: SupportedLanguage;
  analytics: {
    range: { label: string; from: string; to: string };
    counts: Record<string, number>;
    revenueMetrics: Record<string, number>;
    growthMetrics: Record<string, number>;
    churnMetrics: {
      churnCount: number;
      churnRate: number;
      lostMrr: number;
      reasons: Record<string, number>;
    };
    usagePatterns: {
      byModule: Record<string, number>;
      byMeter: Record<string, number>;
      peak: number;
      median: number;
    };
    timeSeries: {
      date: string;
      usageQuantity: number;
      revenueAmount: number;
      signups: number;
      failedRuns: number;
      failedWebhooks: number;
      deadLetters: number;
      p95LatencyMs: number;
    }[];
    usageTrends: { date: string; quantity: number }[];
    cohorts: {
      cohort: string;
      size: number;
      retained: number;
      retentionRate: number;
      revenue: number;
    }[];
    reliability: {
      failedRuns: number;
      failedWebhooks: number;
      deadLetters: number;
      p50LatencyMs: number;
      p95LatencyMs: number;
      warnings: string[];
    };
    edgeAccessLogs: {
      route: string;
      status: number;
      ipHash: string;
      latencyMs: number;
      userAgent: string;
      createdAt: string;
    }[];
    store: HostRuntimeStoreStatus;
  };
  query?: AdminTableQuery;
}) {
  const copy = getAdminAnalyticsCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const countEntries = Object.entries(analytics.counts);
  const revenueEntries = Object.entries(analytics.revenueMetrics);
  const growthEntries = Object.entries(analytics.growthMetrics);
  const timeSeries = analytics.timeSeries.slice(-14);
  const zeroBuckets = analytics.timeSeries.filter(
    (point) =>
      point.usageQuantity === 0 &&
      point.revenueAmount === 0 &&
      point.signups === 0 &&
      point.failedRuns === 0 &&
      point.failedWebhooks === 0 &&
      point.deadLetters === 0
  ).length;
  const failureBuckets = analytics.timeSeries.filter(
    (point) => point.failedRuns + point.failedWebhooks + point.deadLetters > 0
  ).length;
  const peakUsageBucket = analytics.timeSeries.reduce(
    (best, point) => (point.usageQuantity > best.usageQuantity ? point : best),
    analytics.timeSeries[0] ?? {
      date: '-',
      usageQuantity: 0,
      revenueAmount: 0,
      signups: 0,
      failedRuns: 0,
      failedWebhooks: 0,
      deadLetters: 0,
      p95LatencyMs: 0,
    }
  );
  const peakRevenueBucket = analytics.timeSeries.reduce(
    (best, point) => (point.revenueAmount > best.revenueAmount ? point : best),
    analytics.timeSeries[0] ?? peakUsageBucket
  );
  const reliabilityBlocked =
    analytics.reliability.failedRuns > 0 ||
    analytics.reliability.failedWebhooks > 0 ||
    analytics.reliability.deadLetters > 0 ||
    analytics.reliability.p95LatencyMs > 1000;
  const insight = reliabilityBlocked
    ? {
        title: adminInlineText(lang, 'auto_insight_reliability_needs_attention_09a3d973'),
        description: adminInlineText(
          lang,
          'the_selected_window_has_value_failed_runs_value_fail_f487384c',
          {
            value1: analytics.reliability.failedRuns,
            value2: analytics.reliability.failedWebhooks,
            value3: analytics.reliability.deadLetters,
            value4: analytics.reliability.p95LatencyMs,
          }
        ),
        tone: 'warning' as const,
        href: localizedPath(lang, '/admin/runs?status=failed'),
        label: adminInlineText(lang, 'review_reliability_396baa87'),
      }
    : {
        title: adminInlineText(lang, 'auto_insight_business_signals_are_safe_to_watch_d9c28e22'),
        description: adminInlineText(
          lang,
          'revenue_value_mrr_value_signups_value_no_blocking_re_02b73db6',
          {
            value1: analytics.revenueMetrics.revenue ?? 0,
            value2: analytics.revenueMetrics.mrr ?? 0,
            value3: analytics.growthMetrics.signups ?? 0,
          }
        ),
        tone: 'success' as const,
        href: localizedPath(lang, '/admin/revenue'),
        label: adminInlineText(lang, 'view_revenue_7f0cbea9'),
      };
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Users')}
          value={String(analytics.counts.users ?? 0)}
          tone="blue"
        />
        <StatCard
          label={adminInlineText(lang, 'Revenue')}
          value={String(analytics.revenueMetrics.revenue ?? 0)}
          tone="green"
        />
        <StatCard
          label={adminInlineText(lang, 'MRR')}
          value={String(analytics.revenueMetrics.mrr ?? 0)}
        />
        <StatCard
          label={adminInlineText(lang, 'Signups')}
          value={String(analytics.growthMetrics.signups ?? 0)}
          tone="amber"
        />
      </StatGrid>
      <AdminPanel
        title={adminInlineText(lang, 'Analytics range')}
        description={adminInlineText(lang, 'current_window_value_value_to_value_13de8835', {
          value1: analytics.range.label,
          value2: analytics.range.from,
          value3: analytics.range.to,
        })}
      >
        <form
          method="get"
          className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
        >
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'Range')}
            </span>
            <Select
              name="range"
              defaultValue={tableQuery.range || '7d'}
              aria-label={adminInlineText(lang, 'Analytics range')}
            >
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
              <option value="90d">90d</option>
              <option value="custom">{adminInlineText(lang, 'Custom')}</option>
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'From')}
            </span>
            <Input
              name="from"
              defaultValue={tableQuery.from}
              placeholder="2026-05-01"
              aria-label={adminInlineText(lang, 'From date')}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'To')}
            </span>
            <Input
              name="to"
              defaultValue={tableQuery.to}
              placeholder="2026-05-21"
              aria-label={adminInlineText(lang, 'To date')}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Apply')}
            </button>
            <Link
              href={localizedPath(lang, '/admin/analytics')}
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Reset')}
            </Link>
          </div>
        </form>
      </AdminPanel>
      <ActionPanel
        title={insight.title}
        description={insight.description}
        tone={insight.tone}
        actions={
          <Link
            href={insight.href}
            className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10"
          >
            {insight.label}
          </Link>
        }
      />
      <SegmentedWorkspace
        lang={lang}
        title={adminInlineText(lang, 'analysis_views_f7340f73')}
        description={adminInlineText(
          lang,
          'business_commerce_reliability_and_evidence_are_separ_364feb1f'
        )}
        sections={[
          {
            key: 'analytics-business',
            label: adminInlineText(lang, 'business_6da818a9'),
            count: analytics.counts.users ?? 0,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'users_69bf3219'),
                    value: String(analytics.counts.users ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'signups_2fa7c6ad'),
                    value: String(analytics.growthMetrics.signups ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'activation_16b8b06e'),
                    value: String(analytics.growthMetrics.activation ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'usage_peak_b0c4c213'),
                    value: String(analytics.usagePatterns.peak),
                  },
                ]}
              />
            ),
          },
          {
            key: 'analytics-commerce',
            label: adminInlineText(lang, 'commerce_ffe5812b'),
            count: analytics.revenueMetrics.revenue ?? 0,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'revenue_baf4d829'),
                    value: String(analytics.revenueMetrics.revenue ?? 0),
                  },
                  { label: 'MRR', value: String(analytics.revenueMetrics.mrr ?? 0) },
                  {
                    label: adminInlineText(lang, 'refunds_6c3fe602'),
                    value: String(analytics.revenueMetrics.refunds ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'failed_payments_117d8ce7'),
                    value: String(analytics.revenueMetrics.failedPayments ?? 0),
                  },
                ]}
              />
            ),
          },
          {
            key: 'analytics-reliability',
            label: adminInlineText(lang, 'reliability_d2bd47cb'),
            count: analytics.reliability.warnings.length,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'runs_ff5c2c65'),
                    value: String(analytics.counts.runs ?? 0),
                    helper: adminInlineText(lang, 'value_failed_8bc4fc14', {
                      value1: analytics.reliability.failedRuns,
                    }),
                  },
                  {
                    label: adminInlineText(lang, 'p95_latency_c097fedb'),
                    value: `${analytics.reliability.p95LatencyMs}ms`,
                  },
                  {
                    label: adminInlineText(lang, 'failed_webhooks_b9eea8b8'),
                    value: String(analytics.reliability.failedWebhooks),
                  },
                  {
                    label: adminInlineText(lang, 'dead_letters_9b0b049c'),
                    value: String(analytics.reliability.deadLetters),
                  },
                ]}
              />
            ),
          },
          {
            key: 'analytics-evidence',
            label: adminInlineText(lang, 'evidence_c6edabc1'),
            count: analytics.timeSeries.length,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'returned_buckets_cd1b4074'),
                    value: String(analytics.timeSeries.length),
                  },
                  {
                    label: adminInlineText(lang, 'empty_buckets_a96e49b1'),
                    value: String(zeroBuckets),
                  },
                  {
                    label: adminInlineText(lang, 'failure_buckets_120b5c32'),
                    value: String(failureBuckets),
                  },
                  { label: adminInlineText(lang, 'store_48d0d80a'), value: analytics.store.mode },
                ]}
              />
            ),
          },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartPanel
          title={adminInlineText(lang, 'Usage trend')}
          description={adminInlineText(
            lang,
            'Daily usage quantity from the server-side analytics time series.'
          )}
          values={timeSeries.map((point) => point.usageQuantity)}
          labels={timeSeries.map((point) => point.date.slice(5))}
          axisLabel={adminInlineText(lang, 'Usage Quantity')}
          legend={[
            {
              key: 'usage',
              label: adminInlineText(lang, 'Usage'),
              value: timeSeries.reduce((sum, point) => sum + point.usageQuantity, 0),
              tone: 'primary',
            },
            {
              key: 'peak',
              label: adminInlineText(lang, 'Peak'),
              value: analytics.usagePatterns.peak,
              tone: 'info',
            },
          ]}
          drilldownHref={localizedPath(lang, '/admin/usage')}
          drilldownLabel={adminInlineText(lang, 'usage_detail_2fc7505c')}
          stats={[
            {
              key: 'peak',
              label: adminInlineText(lang, 'Peak'),
              value: analytics.usagePatterns.peak,
              detail: adminInlineText(lang, 'selected range'),
              tone: 'info',
            },
            {
              key: 'median',
              label: adminInlineText(lang, 'Median'),
              value: analytics.usagePatterns.median,
              detail: adminInlineText(lang, 'selected range'),
              tone: 'neutral',
            },
            {
              key: 'warnings',
              label: adminInlineText(lang, 'Warnings'),
              value: analytics.reliability.warnings.length,
              detail: adminInlineText(lang, 'reliability notices'),
              tone: analytics.reliability.warnings.length > 0 ? 'warning' : 'success',
            },
          ]}
          empty={adminInlineText(lang, 'No usage trend in selected range.')}
        />
        <ChartPanel
          title={adminInlineText(lang, 'Revenue metrics')}
          description={adminInlineText(
            lang,
            'Daily paid revenue amount from the selected analytics window.'
          )}
          values={timeSeries.map((point) => point.revenueAmount)}
          labels={timeSeries.map((point) => point.date.slice(5))}
          axisLabel={adminInlineText(lang, 'Amount')}
          legend={[
            {
              key: 'revenue',
              label: adminInlineText(lang, 'Revenue'),
              value: timeSeries.reduce((sum, point) => sum + point.revenueAmount, 0),
              tone: 'success' as const,
            },
            {
              key: 'mrr',
              label: 'MRR',
              value: analytics.revenueMetrics.mrr ?? 0,
              tone: 'info' as const,
            },
          ]}
          drilldownHref={localizedPath(lang, '/admin/revenue')}
          drilldownLabel={adminInlineText(lang, 'revenue_detail_fbd90eb8')}
          tone="success"
          empty={adminInlineText(lang, 'No revenue metrics in selected range.')}
        />
        <ChartPanel
          title={adminInlineText(lang, 'Growth metrics')}
          description={adminInlineText(
            lang,
            'Daily signups from the selected analytics window, with growth metrics kept as summary evidence.'
          )}
          values={timeSeries.map((point) => point.signups)}
          labels={timeSeries.map((point) => point.date.slice(5))}
          axisLabel={adminInlineText(lang, 'growth_signal_eff6215c')}
          legend={growthEntries
            .slice(0, 3)
            .map(([key, value]) => ({
              key,
              label: key,
              value:
                key.includes('Rate') || key.includes('conversion')
                  ? `${Math.round(value * 100)}%`
                  : value,
              tone: 'info' as const,
            }))}
          drilldownHref={localizedPath(lang, '/admin/users')}
          drilldownLabel={adminInlineText(lang, 'user_detail_89e53ea2')}
          tone="info"
          empty={adminInlineText(lang, 'No growth metrics in selected range.')}
        />
      </div>
      <AdminPanel
        title={adminInlineText(lang, 'data_quality_bucket_coverage_f54e6f7e')}
        description={adminInlineText(
          lang,
          'the_server_returns_a_complete_date_bucket_series_so__a2f1e1a7'
        )}
      >
        <FactList
          lang={lang}
          className="md:grid-cols-2 xl:grid-cols-4"
          density="compact"
          items={[
            { label: 'Returned buckets', value: String(analytics.timeSeries.length) },
            { label: 'Charted buckets', value: String(timeSeries.length) },
            { label: 'Empty buckets', value: String(zeroBuckets) },
            { label: 'Failure buckets', value: String(failureBuckets) },
            {
              label: 'Peak usage day',
              value: `${peakUsageBucket.date} · ${peakUsageBucket.usageQuantity}`,
            },
            {
              label: 'Peak revenue day',
              value: `${peakRevenueBucket.date} · ${peakRevenueBucket.revenueAmount}`,
            },
            { label: 'Range source', value: analytics.range.label },
            { label: 'Storage', value: analytics.store.mode },
          ]}
        />
      </AdminPanel>
      <AdminPanel
        title={adminInlineText(lang, 'Analytics evidence')}
        description={adminInlineText(
          lang,
          'Detailed tables are collapsed by domain so the analytics page reads as charts first and evidence second.'
        )}
        contentClassName="grid gap-3"
      >
        {[
          {
            key: 'revenue',
            title: adminInlineText(lang, 'revenue_metrics_aa36b65c'),
            table: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, ['Revenue', 'Value'])}
                rows={Object.entries(analytics.revenueMetrics).map(([key, value]) => [
                  key,
                  String(value),
                ])}
              />
            ),
          },
          {
            key: 'growth',
            title: adminInlineText(lang, 'growth_metrics_a21d5394'),
            table: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, ['Growth', 'Value'])}
                rows={Object.entries(analytics.growthMetrics).map(([key, value]) => [
                  key,
                  key.includes('Rate') || key.includes('conversion')
                    ? `${Math.round(value * 100)}%`
                    : String(value),
                ])}
              />
            ),
          },
          {
            key: 'churn',
            title: adminInlineText(lang, 'churn_metrics_b185bbde'),
            table: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, ['Churn', 'Value'])}
                rows={[
                  [
                    adminInlineText(lang, 'churn_count_493d6b47'),
                    String(analytics.churnMetrics.churnCount),
                  ],
                  [
                    adminInlineText(lang, 'churn_rate_6fdfbbf2'),
                    `${Math.round(analytics.churnMetrics.churnRate * 100)}%`,
                  ],
                  [
                    adminInlineText(lang, 'lost_mrr_eebadbfc'),
                    String(analytics.churnMetrics.lostMrr),
                  ],
                  [
                    adminInlineText(lang, 'reasons_c5a997d3'),
                    compactJson(analytics.churnMetrics.reasons),
                  ],
                ]}
              />
            ),
          },
          {
            key: 'usage',
            title: adminInlineText(lang, 'usage_buckets_and_patterns_a4df314b'),
            table: (
              <div className="grid gap-3">
                <DataTable
                  className="shadow-none"
                  density="compact"
                  columns={adminInlineColumns(lang, [
                    'Date',
                    'Usage',
                    'Revenue',
                    'Signups',
                    'Failures',
                  ])}
                  rows={
                    analytics.timeSeries.length > 0
                      ? analytics.timeSeries.map((point) => [
                          point.date,
                          String(point.usageQuantity),
                          String(point.revenueAmount),
                          String(point.signups),
                          `${point.failedRuns + point.failedWebhooks + point.deadLetters}`,
                        ])
                      : [
                          [
                            '-',
                            adminInlineText(lang, 'no_time_series_in_selected_range_56ae138e'),
                            '-',
                            '-',
                            '-',
                          ],
                        ]
                  }
                />
                <DataTable
                  className="shadow-none"
                  density="compact"
                  columns={adminInlineColumns(lang, ['Usage Pattern', 'Value'])}
                  rows={[
                    [adminInlineText(lang, 'peak_260c49fd'), String(analytics.usagePatterns.peak)],
                    [
                      adminInlineText(lang, 'median_a9f38fa8'),
                      String(analytics.usagePatterns.median),
                    ],
                    [
                      adminInlineText(lang, 'by_module_621de414'),
                      compactJson(analytics.usagePatterns.byModule),
                    ],
                    [
                      adminInlineText(lang, 'by_meter_83b123cb'),
                      compactJson(analytics.usagePatterns.byMeter),
                    ],
                  ]}
                />
              </div>
            ),
          },
          {
            key: 'cohort',
            title: adminInlineText(lang, 'cohorts_6f28f2cb'),
            table: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, [
                  'Cohort',
                  'Size',
                  'Retained',
                  'Retention',
                  'Revenue',
                ])}
                rows={analytics.cohorts.map((cohort) => [
                  cohort.cohort,
                  String(cohort.size),
                  String(cohort.retained),
                  `${Math.round(cohort.retentionRate * 100)}%`,
                  String(cohort.revenue),
                ])}
              />
            ),
          },
          {
            key: 'reliability',
            title: adminInlineText(lang, 'reliability_and_edge_access_fd695592'),
            table: (
              <div className="grid gap-3">
                <DataTable
                  className="shadow-none"
                  density="compact"
                  columns={adminInlineColumns(lang, ['Reliability', 'Value'])}
                  rows={[
                    [
                      adminInlineText(lang, 'failed_runs_ce3c4150'),
                      String(analytics.reliability.failedRuns),
                    ],
                    [
                      adminInlineText(lang, 'failed_webhooks_dcf27f1c'),
                      String(analytics.reliability.failedWebhooks),
                    ],
                    [
                      adminInlineText(lang, 'dead_letters_939898e3'),
                      String(analytics.reliability.deadLetters),
                    ],
                    [
                      adminInlineText(lang, 'p50_latency_1566a8f6'),
                      `${analytics.reliability.p50LatencyMs}ms`,
                    ],
                    [
                      adminInlineText(lang, 'p95_latency_b8d39333'),
                      `${analytics.reliability.p95LatencyMs}ms`,
                    ],
                    [
                      adminInlineText(lang, 'warnings_3dbf89d6'),
                      analytics.reliability.warnings.join(', ') ||
                        adminInlineText(lang, 'none_48d72ef0'),
                    ],
                  ]}
                />
                <DataTable
                  className="shadow-none"
                  density="compact"
                  columns={adminInlineColumns(lang, [
                    'Route',
                    'Status',
                    'IP Hash',
                    'Latency',
                    'Created',
                  ])}
                  rows={
                    analytics.edgeAccessLogs.length > 0
                      ? analytics.edgeAccessLogs.map((log) => [
                          log.route,
                          String(log.status),
                          log.ipHash || '-',
                          `${log.latencyMs}ms`,
                          log.createdAt,
                        ])
                      : [
                          [
                            '-',
                            '-',
                            '-',
                            '-',
                            adminInlineText(lang, 'no_edge_access_logs_in_selected_range_e2eafe0f'),
                          ],
                        ]
                  }
                />
              </div>
            ),
          },
          {
            key: 'counts',
            title: adminInlineText(lang, 'raw_counts_3065a8d8'),
            table: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, ['Metric', 'Value'])}
                rows={countEntries.map(([key, value]) => [key, String(value)])}
              />
            ),
          },
        ].map((section) => (
          <EvidenceSection key={section.key} title={adminInlineText(lang, section.title)}>
            {section.table}
          </EvidenceSection>
        ))}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function AdminFilesOperationsPage({
  lang,
  quota,
  files,
  storage,
  reconcile,
  quarantineFileAction,
  restoreFileAction,
  archiveFileAction,
  deleteFileAction,
  cleanupDeletedFilesAction,
  bulkFileAction,
  query,
}: {
  lang: SupportedLanguage;
  quota?: HostFileQuotaStatus;
  files: readonly RuntimeStoreFileRecord[];
  storage: HostFileStorageStatus;
  reconcile: AdminFileStorageReconcileReport;
  quarantineFileAction: AdminFormAction;
  restoreFileAction: AdminFormAction;
  archiveFileAction: AdminFormAction;
  deleteFileAction: AdminFormAction;
  cleanupDeletedFilesAction: AdminFormAction;
  bulkFileAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminFilesCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const providerValue = storage.mode;
  const filteredFiles = files.filter(
    (file) =>
      matchesTextSearch(tableQuery.q, [
        file.id,
        file.name,
        file.moduleId,
        file.status,
        file.ownerId ?? 'system',
        file.purpose,
        file.visibility,
        file.contentType ?? '',
        file.storageKey,
      ]) &&
      matchesExactFilter(tableQuery.status, file.status) &&
      matchesExactFilter(tableQuery.moduleId, file.moduleId) &&
      matchesExactFilter(tableQuery.owner, file.ownerId ?? 'system') &&
      matchesExactFilter(tableQuery.provider, providerValue) &&
      (!tableQuery.mime || (file.contentType ?? '').includes(tableQuery.mime)) &&
      (!tableQuery.path ||
        file.storageKey.includes(tableQuery.path) ||
        file.name.includes(tableQuery.path)) &&
      (!tableQuery.from || file.createdAt.slice(0, 10) >= tableQuery.from) &&
      (!tableQuery.to || file.createdAt.slice(0, 10) <= tableQuery.to) &&
      (!tableQuery.minSize || file.sizeBytes >= tableQuery.minSize) &&
      (!tableQuery.maxSize || file.sizeBytes <= tableQuery.maxSize)
  );
  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / tableQuery.pageSize));
  const currentPage = Math.min(Math.max(tableQuery.page, 1), totalPages);
  const pageStart = (currentPage - 1) * tableQuery.pageSize;
  const visibleFiles = filteredFiles.slice(pageStart, pageStart + tableQuery.pageSize);
  const quarantinedFiles = files.filter((file) => file.status === 'quarantined').length;
  const archivedFiles = files.filter((file) => file.status === 'archived').length;
  const quotaPressure = quota
    ? Math.max(
        quota.perUserBytes > 0 ? quota.userBytes / quota.perUserBytes : 0,
        quota.perWorkspaceBytes > 0 ? quota.workspaceBytes / quota.perWorkspaceBytes : 0,
        quota.perModuleBytes > 0 ? quota.moduleBytes / quota.perModuleBytes : 0
      )
    : 0;
  const storageReviewItems = [
    !storage.durable
      ? {
          key: 'storage-durability',
          title: 'Storage is not durable',
          description: `The current file provider is ${storage.mode}. Move file objects to durable storage before production traffic.`,
          actionLabel: 'Review settings',
          href: localizedPath(lang, '/admin/settings'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    !storage.s3Configured
      ? {
          key: 's3-config',
          title: 'S3 is not configured',
          description:
            'Object storage configuration is missing. Local or memory storage is acceptable for development only.',
          actionLabel: 'Configure storage',
          href: localizedPath(lang, '/admin/settings'),
          status: 'missing',
          tone: 'warning' as const,
        }
      : null,
    reconcile.issues > 0
      ? {
          key: 'reconcile-issues',
          title: 'Storage reconcile issues',
          description: `${reconcile.issues} metadata/object consistency issues were found during the latest scan.`,
          actionLabel: 'Review reconcile',
          href: localizedPath(lang, '/admin/files'),
          status: 'warning',
          tone: 'danger' as const,
        }
      : null,
    reconcile.orphanObjects > 0
      ? {
          key: 'orphan-objects',
          title: adminInlineText(lang, 'orphan_objects_e83d4bbc'),
          description: adminInlineText(
            lang,
            'value_physical_objects_have_no_runtime_metadata_owne_0f58a0e8',
            { value1: reconcile.orphanObjects }
          ),
          actionLabel: adminInlineText(lang, 'review_orphans_e7b8e2ee'),
          href: localizedPath(lang, '/admin/files'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    quota && quotaPressure >= 0.8
      ? {
          key: 'quota-pressure',
          title: adminInlineText(lang, 'file_quota_pressure_5b000362'),
          description: adminInlineText(
            lang,
            'highest_quota_pressure_is_about_value_review_user_wo_462fc813',
            { value1: Math.round(quotaPressure * 100) }
          ),
          actionLabel: adminInlineText(lang, 'review_quota_00df702c'),
          href: localizedPath(lang, '/admin/files'),
          status: quotaPressure >= 1 ? 'blocked' : 'warning',
          tone: quotaPressure >= 1 ? ('danger' as const) : ('warning' as const),
        }
      : null,
    quarantinedFiles > 0
      ? {
          key: 'quarantine',
          title: 'Quarantined files',
          description: `${quarantinedFiles} files are quarantined and should be reviewed before restore or deletion.`,
          actionLabel: 'Filter quarantine',
          href: localizedPath(lang, '/admin/files?status=quarantined'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-5">
        <StatGrid className="order-1">
          <StatCard
            label={adminInlineText(lang, 'Storage')}
            value={storage.mode}
            helper={
              storage.durable
                ? adminInlineText(lang, 'Durable provider')
                : adminInlineText(lang, 'Development mode')
            }
            tone={storage.durable ? 'green' : 'red'}
            icon={Database}
          />
          <StatCard
            label={adminInlineText(lang, 'Files')}
            value={String(files.length)}
            helper={adminInlineText(lang, 'value_visible_d0396c4d', {
              value1: filteredFiles.length,
            })}
            icon={FolderOpen}
          />
          <StatCard
            label={adminInlineText(lang, 'S3 Config')}
            value={storage.s3Configured ? 'ready' : 'missing'}
            helper={adminInlineText(lang, 'Object storage readiness')}
            tone={storage.s3Configured ? 'green' : 'amber'}
            icon={Archive}
          />
          <StatCard
            label={adminInlineText(lang, 'Storage Issues')}
            value={String(reconcile.issues)}
            helper={adminInlineText(lang, 'value_archived_897b05e4', { value1: archivedFiles })}
            tone={reconcile.issues > 0 ? 'amber' : 'neutral'}
            icon={FileWarning}
          />
        </StatGrid>
        {storageReviewItems.length > 0 ? (
          <ActionQueue
            lang={lang}
            className="order-2"
            title={adminInlineText(lang, 'Storage review')}
            description={adminInlineText(
              lang,
              'Durability, configuration, and reconcile issues are shown before the file directory.'
            )}
            status="warning"
            items={storageReviewItems}
          />
        ) : null}
        <AdminPanel
          className="order-3"
          title={adminInlineText(lang, 'quota_and_business_impact_6445f739')}
          description={adminInlineText(
            lang,
            'file_quota_is_shown_by_user_workspace_and_module_so__cbfc26f6'
          )}
        >
          <FactList
            lang={lang}
            density="compact"
            items={
              quota
                ? [
                    {
                      label: 'Policy source',
                      value: quota.policySource,
                      helper: quota.planId ?? 'global',
                    },
                    {
                      label: 'User quota',
                      value: `${formatBytes(quota.userBytes, lang)} / ${formatBytes(quota.perUserBytes, lang)}`,
                    },
                    {
                      label: 'Workspace quota',
                      value: `${formatBytes(quota.workspaceBytes, lang)} / ${formatBytes(quota.perWorkspaceBytes, lang)}`,
                    },
                    {
                      label: 'Module quota',
                      value: `${formatBytes(quota.moduleBytes, lang)} / ${formatBytes(quota.perModuleBytes, lang)}`,
                    },
                  ]
                : [
                    { label: 'Quota', value: adminInlineText(lang, 'not_loaded_75bfeb5e') },
                    { label: 'Business impact', value: adminInlineText(lang, 'unknown_7c2c4389') },
                  ]
            }
          />
        </AdminPanel>
        <AdminPanel
          className="order-4"
          title={adminInlineText(lang, 'orphan_object_governance_3a5d296f')}
          description={adminInlineText(
            lang,
            'physical_orphan_objects_should_not_be_inferred_from__0883b4fb'
          )}
        >
          <DataTable
            columns={adminInlineColumns(lang, ['Object', 'Size', 'Checksum', 'Content-Type'])}
            rows={reconcile.orphans
              .slice(0, 12)
              .map((object) => [
                object.key,
                formatBytes(object.sizeBytes, lang),
                object.checksum,
                object.contentType ?? 'unknown',
              ])}
            empty={adminInlineText(lang, 'no_orphan_objects_be30825b')}
          />
        </AdminPanel>
        <AdminPanel
          className="order-5"
          title={adminInlineText(lang, 'Storage reconcile')}
          description={adminInlineText(
            lang,
            'Compare runtime metadata with physical objects and surface drift before cleanup.'
          )}
          action={
            <code className="rounded-admin-md bg-admin-bg px-2 py-1 text-xs text-admin-text-muted">
              {reconcile.command}
            </code>
          }
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p>
                {adminInlineText(
                  lang,
                  '对 runtime metadata 和物理对象执行一致性扫描，发现 missing object、deleted object present 和 size/checksum 漂移。'
                )}
              </p>
            </div>
          </div>
          <DataTable
            columns={adminInlineColumns(lang, ['Metric', 'Value'])}
            rows={[
              ['Checked Files', `${reconcile.checkedFiles} / ${reconcile.totalFiles}`],
              ['Orphan Scan', reconcile.orphanScanSupported ? 'supported' : 'not supported'],
              ['Present Objects', String(reconcile.presentObjects)],
              ['Missing Objects', String(reconcile.missingObjects)],
              ['Orphan Objects', String(reconcile.orphanObjects)],
              ['Deleted Objects Present', String(reconcile.deletedObjectsPresent)],
              ['Missing Active Objects', String(reconcile.missingActiveObjects)],
              ['Size Mismatches', String(reconcile.sizeMismatches)],
              ['Checksum Mismatches', String(reconcile.checksumMismatches)],
              ['Metadata Bytes', formatBytes(reconcile.metadataBytes, lang)],
              ['Physical Bytes', formatBytes(reconcile.physicalBytes, lang)],
              ['Orphan Bytes', formatBytes(reconcile.orphanBytes, lang)],
              ['Checked At', reconcile.checkedAt],
            ]}
          />
          {reconcile.items.length > 0 ? (
            <DataTable
              columns={adminInlineColumns(lang, [
                'File',
                'Module',
                'Status',
                'Object',
                'Issue',
                'Bytes',
              ])}
              rows={reconcile.items.slice(0, 8).map((item) => [
                <Link key={item.fileId} href={localizedPath(lang, `/admin/files/${item.fileId}`)}>
                  {item.name}
                </Link>,
                item.moduleId,
                <StatusBadge key={`${item.fileId}:status`} lang={lang} value={item.status} />,
                item.objectStatus,
                item.issue,
                `${formatBytes(item.metadataSizeBytes, lang)} / ${
                  item.objectSizeBytes === null
                    ? 'missing'
                    : formatBytes(item.objectSizeBytes, lang)
                }`,
              ])}
            />
          ) : null}
          {reconcile.orphans.length > 0 ? (
            <DataTable
              columns={adminInlineColumns(lang, [
                'Orphan Object',
                'Size',
                'Checksum',
                'Content-Type',
              ])}
              rows={reconcile.orphans
                .slice(0, 8)
                .map((object) => [
                  object.key,
                  formatBytes(object.sizeBytes, lang),
                  object.checksum,
                  object.contentType ?? 'unknown',
                ])}
            />
          ) : null}
        </AdminPanel>
        <form
          action={cleanupDeletedFilesAction}
          className="order-6 rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h2>{adminInlineText(lang, 'Cleanup Deleted Objects')}</h2>
            <p>
              {adminInlineText(lang, '清理已经标记 deleted 的对象内容，metadata 会保留用于审计。')}
            </p>
          </div>
          <ConfirmSubmitButton
            type="submit"
            className="inline-flex min-h-10 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            confirmation={adminInlineText(
              lang,
              '确认清理已删除对象的文件内容？metadata 会继续保留。'
            )}
          >
            {adminInlineText(lang, 'Cleanup')}
          </ConfirmSubmitButton>
        </form>
        {bulkFileAction ? (
          <form
            action={bulkFileAction}
            className="order-7 rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h2>{adminInlineText(lang, 'Bulk File Action')}</h2>
              <p>
                {adminInlineText(
                  lang,
                  '对当前筛选结果执行批量 archive/delete，最多一次处理 100 个文件。'
                )}
              </p>
            </div>
            <input
              type="hidden"
              name="fileIds"
              value={filteredFiles.map((file) => file.id).join(',')}
            />
            <Select
              name="action"
              defaultValue="archive"
              aria-label={adminInlineText(lang, 'Bulk file action')}
            >
              <option value="archive">{adminInlineText(lang, 'Archive current filter')}</option>
              <option value="delete">{adminInlineText(lang, 'Delete current filter')}</option>
            </Select>
            <Input
              name="reason"
              placeholder={adminInlineText(lang, 'reason')}
              aria-label={adminInlineText(lang, 'Bulk reason')}
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={filteredFiles.length === 0}
              confirmation={adminInlineText(
                lang,
                'apply_a_bulk_action_to_value_files_in_the_current_fi_ef78a325',
                { value1: filteredFiles.length }
              )}
            >
              {adminInlineText(lang, 'Apply Bulk Action')}
            </ConfirmSubmitButton>
          </form>
        ) : null}
        <AdminPanel
          className="order-8"
          title={adminInlineText(lang, 'File directory')}
          description={adminInlineText(
            lang,
            'Directory filters show runtime file metadata; an empty directory does not prove there are no orphan physical objects, so reconcile evidence stays above.'
          )}
          contentClassName="p-0"
        >
          <form
            method="get"
            className="grid gap-3 border-b border-admin-border bg-admin-bg/35 px-4 py-3"
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end">
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'Search')}</span>
                <Input
                  type="search"
                  name="q"
                  defaultValue={tableQuery.q}
                  placeholder={adminInlineText(lang, '文件名、ID、模块、owner 或路径')}
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
                  {fileStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {adminInlineText(lang, option.label)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'Module')}</span>
                <Input
                  name="moduleId"
                  defaultValue={tableQuery.moduleId}
                  placeholder={adminInlineText(lang, 'moduleId')}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                >
                  {adminInlineText(lang, 'Filter')}
                </button>
                <Link
                  href={localizedPath(lang, '/admin/files')}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                >
                  {adminInlineText(lang, 'Clear')}
                </Link>
              </div>
            </div>
            <AdvancedFilterPanel
              lang={lang}
              defaultOpen={Boolean(
                tableQuery.owner ||
                tableQuery.mime ||
                tableQuery.provider ||
                tableQuery.path ||
                tableQuery.from ||
                tableQuery.to ||
                tableQuery.minSize ||
                tableQuery.maxSize
              )}
              description={adminInlineText(
                lang,
                '所有者、MIME、供应商、路径、日期和大小是排障筛选，默认折叠以保护目录页的扫描速度。'
              )}
            >
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'Owner')}</span>
                <Input
                  name="owner"
                  defaultValue={tableQuery.owner}
                  placeholder={adminInlineText(lang, 'owner id/email')}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'MIME')}</span>
                <Input
                  name="mime"
                  defaultValue={tableQuery.mime}
                  placeholder={adminInlineText(lang, 'image/json/text')}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'Provider')}</span>
                <Select
                  name="provider"
                  defaultValue={tableQuery.provider}
                  aria-label={adminInlineText(lang, 'Provider')}
                >
                  <option value="">{adminInlineText(lang, 'All')}</option>
                  <option value="local">{adminInlineText(lang, 'Local')}</option>
                  <option value="s3">S3</option>
                  <option value="memory">{adminInlineText(lang, 'Memory')}</option>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'Path')}</span>
                <Input
                  name="path"
                  defaultValue={tableQuery.path}
                  placeholder={adminInlineText(lang, 'folder/path')}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'From')}</span>
                <Input type="date" name="from" defaultValue={tableQuery.from.slice(0, 10)} />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'To')}</span>
                <Input type="date" name="to" defaultValue={tableQuery.to.slice(0, 10)} />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'Min')}</span>
                <Input
                  name="minSize"
                  defaultValue={tableQuery.minSize ? String(tableQuery.minSize) : ''}
                  placeholder={adminInlineText(lang, 'bytes')}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{adminInlineText(lang, 'Max')}</span>
                <Input
                  name="maxSize"
                  defaultValue={tableQuery.maxSize ? String(tableQuery.maxSize) : ''}
                  placeholder={adminInlineText(lang, 'bytes')}
                />
              </label>
            </AdvancedFilterPanel>
          </form>
          <div className="px-4 py-3 sm:px-5">
            <FilterResultHint lang={lang} visible={filteredFiles.length} total={files.length} />
          </div>
          <div className="hidden xl:block">
            <DataTable
              className="rounded-none border-x-0 border-b-0 shadow-none"
              columns={adminInlineColumns(lang, [
                'Name',
                'Module',
                'Status',
                'Owner',
                'Size',
                'Type',
                'Action',
              ])}
              rows={visibleFiles.map((file) => [
                <div key={`${file.id}:name`} className="min-w-0">
                  <Link
                    href={localizedPath(lang, `/admin/files/${file.id}`)}
                    className="block truncate font-semibold text-admin-primary hover:underline"
                  >
                    {file.name}
                  </Link>
                  <div className="mt-1 truncate text-xs text-admin-text-muted">
                    {file.storageKey}
                  </div>
                </div>,
                file.moduleId,
                <StatusBadge key={`${file.id}:status`} lang={lang} value={file.status} />,
                file.ownerId ?? 'system',
                formatBytes(file.sizeBytes, lang),
                file.contentType ?? 'unknown',
                <div key={`${file.id}:actions`} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/api/media/${file.id}`}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  >
                    {adminInlineText(lang, 'Open')}
                  </Link>
                  <Link
                    href={`/api/media/${file.id}?download=1`}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  >
                    {adminInlineText(lang, 'Download')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(file.id)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  >
                    {adminInlineText(lang, 'audit_de9bcda7')}
                  </Link>
                  <MoreActionMenu label={adminInlineText(lang, 'Manage')}>
                    <form
                      action={quarantineFileAction}
                      className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                    >
                      <input type="hidden" name="fileId" value={file.id} />
                      <input type="hidden" name="reason" value="Admin quarantine" />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-1.5 text-xs font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        disabled={file.status === 'quarantined'}
                        confirmation={adminInlineText(lang, 'quarantine_file_value_14449c49', {
                          value1: file.name,
                        })}
                      >
                        {adminInlineText(lang, 'Quarantine')}
                      </ConfirmSubmitButton>
                    </form>
                    <form
                      action={archiveFileAction}
                      className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                    >
                      <input type="hidden" name="fileId" value={file.id} />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        disabled={file.status === 'archived' || file.status === 'deleted'}
                        confirmation={adminInlineText(lang, 'archive_file_value_86b0e1fa', {
                          value1: file.name,
                        })}
                      >
                        {adminInlineText(lang, 'Archive')}
                      </ConfirmSubmitButton>
                    </form>
                    <form
                      action={deleteFileAction}
                      className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                    >
                      <input type="hidden" name="fileId" value={file.id} />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        disabled={file.status === 'deleted'}
                        confirmation={adminInlineText(lang, 'delete_file_value_79d4bf49', {
                          value1: file.name,
                        })}
                      >
                        {adminInlineText(lang, 'Delete')}
                      </ConfirmSubmitButton>
                    </form>
                    <form
                      action={restoreFileAction}
                      className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                    >
                      <input type="hidden" name="fileId" value={file.id} />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        disabled={file.status === 'ready'}
                        confirmation={adminInlineText(lang, 'restore_file_value_80d981b3', {
                          value1: file.name,
                        })}
                      >
                        {adminInlineText(lang, 'Restore')}
                      </ConfirmSubmitButton>
                    </form>
                  </MoreActionMenu>
                </div>,
              ])}
              empty={adminInlineText(lang, 'No files match this filter.')}
              minWidthClass="min-w-[1180px]"
            />
          </div>
          <div className="grid gap-1 px-2 py-2 xl:hidden">
            {visibleFiles.length > 0 ? (
              visibleFiles.map((file) => (
                <EntityListItem
                  key={file.id}
                  href={localizedPath(lang, `/admin/files/${file.id}`)}
                  title={file.name}
                  subtitle={`${file.moduleId} · ${file.ownerId ?? 'system'}`}
                  status={file.status}
                  detail={`${formatBytes(file.sizeBytes, lang)} · ${file.contentType ?? 'unknown'}`}
                  meta={adminInlineText(lang, 'value_audit_in_detail_bd7575cb', {
                    value1: storage.mode,
                  })}
                  icon={FolderOpen}
                  tone={
                    file.status === 'quarantined' || file.status === 'deleted'
                      ? 'warning'
                      : 'primary'
                  }
                />
              ))
            ) : (
              <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
                {adminInlineText(lang, 'No files match this filter.')}
              </div>
            )}
          </div>
        </AdminPanel>
        <div className="order-2">
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            previousHref={
              currentPage > 1
                ? adminListHref(lang, '/admin/files', tableQuery, currentPage - 1)
                : undefined
            }
            nextHref={
              currentPage < totalPages
                ? adminListHref(lang, '/admin/files', tableQuery, currentPage + 1)
                : undefined
            }
          />
        </div>
      </div>
    </WorkspaceShell>
  );
}

export function AdminFileDetailOperationsPage({
  lang,
  detail,
}: {
  lang: SupportedLanguage;
  detail: AdminFileDetailView;
}) {
  const copy = getAdminFileDetailCopy(lang);
  const file = detail.file;
  const storageObject = detail.storageObject;
  const access = detail.access;
  const cleanup = detail.cleanup;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {file ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <StatGrid>
              <StatCard
                label={adminInlineText(lang, 'Status')}
                value={file.status}
                tone={file.status === 'ready' ? 'blue' : 'amber'}
              />
              <StatCard label={adminInlineText(lang, 'Storage')} value={detail.storage.mode} />
              <StatCard
                label={adminInlineText(lang, 'Size')}
                value={formatBytes(file.sizeBytes, lang)}
              />
              <StatCard label={adminInlineText(lang, 'Visibility')} value={file.visibility} />
            </StatGrid>

            <ActionPanel
              title={file.name}
              description={`${file.moduleId} / ${file.purpose} / ${file.ownerId ?? 'system'}`}
              tone={
                storageObject?.status === 'missing'
                  ? 'warning'
                  : file.status === 'quarantined'
                    ? 'danger'
                    : 'neutral'
              }
              actions={
                <>
                  <Link
                    href={`/api/media/${file.id}`}
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Open')}
                  </Link>
                  <Link
                    href={`/api/media/${file.id}?download=1`}
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Download')}
                  </Link>
                </>
              }
            />

            <AdminPanel
              title={adminInlineText(lang, 'Storage object')}
              description={adminInlineText(
                lang,
                'Physical object evidence stays separate from file metadata.'
              )}
              contentClassName="p-0"
            >
              <DataTable
                className="rounded-none border-x-0 shadow-none"
                columns={adminInlineColumns(lang, ['Storage Object', 'Value'])}
                rows={[
                  ['State', storageObject?.status ?? 'unknown'],
                  [
                    'Physical object present',
                    cleanup?.physicalObjectPresent === null
                      ? 'unknown'
                      : String(Boolean(cleanup?.physicalObjectPresent)),
                  ],
                  ['Object Key', storageObject?.key ?? file.storageKey],
                  [
                    'Object Size',
                    storageObject?.sizeBytes === null || storageObject?.sizeBytes === undefined
                      ? 'missing'
                      : formatBytes(storageObject.sizeBytes, lang),
                  ],
                  ['Object Checksum', storageObject?.checksum ?? 'missing'],
                  ['Object Content-Type', storageObject?.contentType ?? 'unknown'],
                  ['Checked At', storageObject?.checkedAt ?? 'not checked'],
                  ['Storage Error', storageObject?.error ?? 'none'],
                ]}
                minWidthClass="min-w-[760px]"
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Access and cleanup')}
              description={adminInlineText(
                lang,
                'Download access and cleanup eligibility are explicit operational facts.'
              )}
              contentClassName="p-0"
            >
              <DataTable
                className="rounded-none border-x-0 shadow-none"
                columns={adminInlineColumns(lang, ['Access / Cleanup', 'Value'])}
                rows={[
                  ['Media Gateway', access?.mediaGateway ?? 'blocked'],
                  ['Open URL', access?.openUrl ?? 'blocked'],
                  ['Download URL', access?.downloadUrl ?? 'blocked'],
                  ['Access Reason', access?.reason ?? 'file is missing'],
                  ['Cleanup Eligible', cleanup ? String(cleanup.eligible) : 'false'],
                  ['Latest Cleanup Audit', cleanup?.latestCleanupAt ?? 'none'],
                  ['Cleanup Command', cleanup?.command ?? 'npm run host:files-cleanup-smoke'],
                  ['Cleanup Reason', cleanup?.reason ?? 'file is missing'],
                ]}
                minWidthClass="min-w-[760px]"
              />
            </AdminPanel>

            <div className="grid gap-5 lg:grid-cols-2">
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'File metadata')}
                description={adminInlineText(lang, 'Redacted file metadata.')}
                value={JSON.stringify(redactSensitive(file.metadata), null, 2)}
              />
              <CodeBlockPanel
                lang={lang}
                title={adminInlineText(lang, 'Object metadata')}
                description={adminInlineText(lang, 'Redacted storage metadata.')}
                value={JSON.stringify(redactSensitive(storageObject?.metadata ?? {}), null, 2)}
              />
            </div>

            <AdminPanel
              title={adminInlineText(lang, 'Audit timeline')}
              description={adminInlineText(
                lang,
                'File lifecycle, access, cleanup and governance events.'
              )}
            >
              <TimelineList
                lang={lang}
                items={detail.audit.map((record) => ({
                  key: record.id,
                  title: record.type,
                  description: compactJson(record.metadata, 180),
                  meta: `${record.actorId ?? 'system'} · ${record.createdAt}`,
                  tone:
                    record.type.includes('delete') || record.type.includes('cleanup')
                      ? 'warning'
                      : 'primary',
                }))}
                empty={adminInlineText(lang, 'No file audit yet.')}
              />
            </AdminPanel>
          </div>

          <DetailDrawer
            open
            title={adminInlineText(lang, 'File snapshot')}
            description={file.name}
            actions={
              <CopyButton
                value={file.id}
                label={adminInlineText(lang, 'Copy ID')}
                copiedLabel={adminInlineText(lang, 'Copied ID')}
              />
            }
            className="xl:sticky xl:top-24 xl:self-start"
          >
            <FactList
              lang={lang}
              items={[
                { label: 'File ID', value: file.id, copyValue: file.id, mono: true },
                { label: 'Product', value: file.productId, mono: true },
                { label: 'Workspace', value: file.workspaceId ?? 'product', mono: true },
                { label: 'Run', value: file.runId ?? 'none', mono: true },
                { label: 'Content-Type', value: file.contentType ?? 'unknown' },
                { label: 'Checksum', value: file.checksum ?? 'missing', mono: true },
                {
                  label: 'Storage Key',
                  value: file.storageKey,
                  copyValue: file.storageKey,
                  mono: true,
                },
                {
                  label: 'Object',
                  value: storageObject?.status ?? 'unknown',
                  tone: storageObject?.status === 'missing' ? 'warning' : 'neutral',
                },
                { label: 'Created', value: file.createdAt },
                { label: 'Updated', value: file.updatedAt },
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
