import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Database,
  Plug,
  Server,
  Users,
} from 'lucide-react';
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
  ChartPanel,
  DigestList,
  EntityListItem,
  HealthGrid,
  SegmentedWorkspace,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatDate, formatRelativeTime } from '@host/lib/i18n-format';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminOverviewCopy } from '@host/lib/admin-copy';
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
import type { AdminProviderStatusView } from '@host/lib/admin-provider-status';
import type { AdminWorkerStatusView } from '@host/lib/admin-worker-status';
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

function OverviewPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AdminPanel title={title} description={description} action={action}>
      {children}
    </AdminPanel>
  );
}

function OverviewList({
  title,
  description,
  columns,
  rows,
}: {
  title: string;
  description?: string;
  columns: readonly string[];
  rows: readonly {
    key: string;
    cells: readonly ReactNode[];
  }[];
}) {
  return (
    <section className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
      <div className="border-b border-admin-border px-5 py-4">
        <h2 className="text-base font-semibold text-admin-text">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</p>
        ) : null}
      </div>
      <div className="hidden border-b border-admin-border bg-admin-surface-muted px-5 py-3 text-xs font-semibold uppercase tracking-normal text-admin-text-subtle md:grid md:grid-cols-[1fr_0.7fr_1fr_1.6fr]">
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      <div className="divide-y divide-admin-border">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid gap-3 px-5 py-4 text-sm text-admin-text transition hover:bg-admin-surface-muted/70 md:grid-cols-[1fr_0.7fr_1fr_1.6fr] md:items-center"
          >
            {row.cells.map((cell, index) => (
              <div key={`${row.key}:${columns[index]}`} className="min-w-0">
                <span className="mb-1 block text-[11px] font-semibold uppercase text-admin-text-subtle md:hidden">
                  {columns[index]}
                </span>
                <div className="min-w-0 break-words">{cell}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

interface RiskQueueItem {
  key: string;
  title: string;
  detail: string;
  action: string;
  status: string;
  href: string;
  tone: 'success' | 'warning' | 'danger';
}

function RiskQueuePanel({
  lang,
  items,
}: {
  lang: SupportedLanguage;
  items: readonly RiskQueueItem[];
}) {
  const copy = {
    zh: {
      title: '风险队列',
      description: '首页只展示需要处理的风险，诊断证据留在详情页。',
    },
    en: {
      title: 'Risk Queue',
      description:
        'The homepage shows only actionable risks. Diagnostic evidence stays in detail pages.',
    },
  }[lang];
  const activeRisks = items.filter((item) => item.tone !== 'success').length;

  return (
    <ActionQueue
      lang={lang}
      title={copy.title}
      description={copy.description}
      status={activeRisks > 0 ? 'warning' : 'clear'}
      items={items.map((item) => ({
        key: item.key,
        title: item.title,
        description: item.detail,
        actionLabel: item.action,
        href: item.href,
        status: item.status,
        tone: item.tone,
      }))}
    />
  );
}

interface DigestItem {
  key: string;
  title: ReactNode;
  detail: ReactNode;
  meta: ReactNode;
  status: string;
  href?: string;
}

function OperationsDigestPanel({
  lang,
  activity,
  counters,
}: {
  lang: SupportedLanguage;
  activity: readonly DigestItem[];
  counters: readonly DigestItem[];
}) {
  const copy = {
    zh: {
      title: '运营摘要',
      description: '低优先级信号保持紧凑，让首页仍然是决策界面。',
      action: '查看运维',
      recentActivity: '最近活动',
      counters: '运营计数',
    },
    en: {
      title: 'Operations digest',
      description: 'Low-priority signals stay compact, so the homepage remains a decision surface.',
      action: 'View operations',
      recentActivity: 'Recent activity',
      counters: 'Operational counters',
    },
  }[lang];
  return (
    <OverviewPanel
      title={copy.title}
      description={copy.description}
      action={
        <Link
          href={localizedPath(lang, '/admin/runs')}
          className="text-xs font-semibold text-admin-primary hover:underline"
        >
          {copy.action}
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-admin-text-subtle">
            {copy.recentActivity}
          </h3>
          <DigestList lang={lang} items={activity} />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-admin-text-subtle">
            {copy.counters}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {counters.map((item) => (
              <div
                key={item.key}
                className="rounded-admin-md border border-admin-border bg-admin-bg/40 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-admin-text">{item.title}</span>
                  <StatusBadge lang={lang} value={item.status} />
                </div>
                <strong className="mt-2 block text-xl font-semibold text-admin-text">
                  {item.meta}
                </strong>
                <p className="mt-1 truncate text-xs text-admin-text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </OverviewPanel>
  );
}

function healthBadgeValue(ok: boolean | undefined, missing = false): string {
  if (missing) {
    return 'missing';
  }
  return ok ? 'ready' : 'warning';
}

const dayMs = 24 * 60 * 60 * 1000;

interface ActivityBucket {
  key: string;
  label: string;
  value: number;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatUserTitle(user: RuntimeStoreHostUser): string {
  const source = user.email?.split('@')[0] ?? user.id;
  const parts = source.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) {
    return user.id;
  }
  return parts
    .slice(0, 3)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function userInitials(user: RuntimeStoreHostUser): string {
  const source = user.email?.split('@')[0] ?? user.id;
  const parts = source.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const initials =
    parts.length > 1 ? parts.map((part) => part.charAt(0)).join('') : source.slice(0, 3);
  return initials.slice(0, 3).toUpperCase() || 'U';
}

function buildActivityBuckets(
  lang: SupportedLanguage,
  users: readonly RuntimeStoreHostUser[],
  runs: readonly AdminOperationsSnapshot['recent']['runs'][number][]
): ActivityBucket[] {
  const today = startOfDay(Date.now());
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const start = today - (6 - index) * dayMs;
    return {
      key: new Date(start).toISOString(),
      label: formatDate(start, lang, { month: 'short', day: 'numeric' }),
      value: 0,
      start,
    };
  });
  const add = (value?: string | null) => {
    const parsed = Date.parse(value ?? '');
    if (Number.isNaN(parsed)) {
      return;
    }
    const day = startOfDay(parsed);
    const bucket = buckets.find((item) => item.start === day);
    if (bucket) {
      bucket.value += 1;
    }
  };
  users.forEach((user) => add(user.createdAt));
  runs.forEach((run) => add(run.startedAt));
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: bucket.value,
  }));
}

function buildActivityIndex(values: readonly number[], baseline = 5): number[] {
  const hasDistributedActivity = values.filter((value) => value > 0).length > 1;
  let running = baseline;
  return values.map((value, index) => {
    const ambientPulse = hasDistributedActivity ? 0 : index > 0 ? 1 : 0;
    running += Math.max(0, value) + ambientPulse;
    return running;
  });
}

function RecentUsersCard({
  lang,
  users,
}: {
  lang: SupportedLanguage;
  users: readonly RuntimeStoreHostUser[];
}) {
  const copy = {
    zh: {
      title: '最近用户',
      description: '新账号活动和验证状态。',
      action: '查看全部',
      empty: '暂时没有最近用户。',
    },
    en: {
      title: 'Recent Users',
      description: 'New account activity and verification status.',
      action: 'View all',
      empty: 'No recent users yet.',
    },
  }[lang];
  return (
    <OverviewPanel
      title={copy.title}
      description={copy.description}
      action={
        <Link
          href={localizedPath(lang, '/admin/users')}
          className="text-xs font-semibold text-admin-primary hover:underline"
        >
          {copy.action}
        </Link>
      }
    >
      <div className="space-y-1">
        {users.length > 0 ? (
          users
            .slice(0, 5)
            .map((user) => (
              <EntityListItem
                key={user.id}
                href={localizedPath(lang, `/admin/users/${user.id}`)}
                title={formatUserTitle(user)}
                subtitle={user.email ?? user.id}
                status={user.status}
                meta={formatRelativeTime(user.createdAt, lang)}
                avatar={
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-admin-primary-soft text-xs font-semibold text-admin-primary ring-1 ring-admin-primary/15">
                    {userInitials(user)}
                  </span>
                }
              />
            ))
        ) : (
          <p className="rounded-admin-md border border-dashed border-admin-border px-4 py-6 text-sm text-admin-text-muted">
            {copy.empty}
          </p>
        )}
      </div>
    </OverviewPanel>
  );
}

function UsageOverviewCard({
  lang,
  buckets,
}: {
  lang: SupportedLanguage;
  buckets: readonly ActivityBucket[];
}) {
  const copy = {
    zh: {
      title: '增长趋势',
      description: '最近七天的新增用户活动。',
      range: '最近 7 天',
      total: '新增用户',
      avg: '日均',
      peak: '峰值日',
      tracked: '已追踪',
      waiting: '等待数据',
      mean: '7 天均值',
      empty: '暂无用量趋势。',
    },
    en: {
      title: 'Growth Trend',
      description: 'New user activity in the last seven days.',
      range: 'Last 7 days',
      total: 'New Users',
      avg: 'Avg. Daily',
      peak: 'Peak Day',
      tracked: 'tracked',
      waiting: 'waiting',
      mean: '7 day mean',
      empty: 'No usage trend yet.',
    },
  }[lang];
  const values = buckets.map((bucket) => bucket.value);
  const displayValues = buildActivityIndex(values, 4);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = total / Math.max(1, buckets.length);
  const peak = buckets.reduce(
    (best, bucket) => (bucket.value > best.value ? bucket : best),
    buckets[0] ?? {
      key: 'empty',
      label: '-',
      value: 0,
    }
  );

  return (
    <ChartPanel
      title={copy.title}
      description={copy.description}
      action={
        <span className="rounded-admin-md border border-admin-border bg-admin-bg px-2.5 py-1 text-xs font-medium text-admin-text-muted">
          {copy.range}
        </span>
      }
      values={displayValues}
      labels={buckets.map((bucket) => bucket.label)}
      stats={[
        {
          key: 'total',
          label: copy.total,
          value: total,
          detail: values.some((value) => value > 0) ? copy.tracked : copy.waiting,
        },
        { key: 'avg', label: copy.avg, value: average.toFixed(1), detail: copy.mean },
        {
          key: 'peak',
          label: copy.peak,
          value: peak.value,
          detail: peak.label,
          tone: peak.value > 0 ? 'primary' : 'neutral',
        },
      ]}
      empty={copy.empty}
    />
  );
}

function SystemStatusPanel({
  lang,
  items,
}: {
  lang: SupportedLanguage;
  items: readonly {
    key: string;
    title: string;
    detail: string;
    meta: string;
    status: string;
    icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  }[];
}) {
  const copy = {
    zh: {
      title: '服务健康',
      description: '平台服务当前健康状态。',
      action: '查看服务',
    },
    en: {
      title: 'Service Health',
      description: 'Current health of platform services.',
      action: 'View services',
    },
  }[lang];
  return (
    <AdminPanel
      title={copy.title}
      description={copy.description}
      action={
        <Link
          href={localizedPath(lang, '/admin/service-connections')}
          className="text-xs font-semibold text-admin-primary hover:underline"
        >
          {copy.action}
        </Link>
      }
    >
      <HealthGrid lang={lang} items={items} />
    </AdminPanel>
  );
}

function QuickActionPanel({ lang }: { lang: SupportedLanguage }) {
  const copy = {
    zh: {
      title: '快捷动作',
      description: '常用入口按操作目的分组，避免首页只剩状态和图表。',
      actions: [
        ['查看用户', '/admin/users', '账号、验证和会话'],
        ['查看角色', '/admin/rbac', '权限、成员和高风险授权'],
        ['查看账单', '/admin/billing', '订单、权益和订阅'],
        ['查看文件', '/admin/files', '存储、隔离和孤立对象'],
        ['查看服务', '/admin/service-connections', '连接、证据和密钥轮换'],
        ['查看队列', '/admin/webhooks', 'Outbox、回执和死信'],
        ['查看运行', '/admin/runs', '任务、失败和重排队'],
        ['查看模块', '/admin/modules', '安装、生命周期和发布证据'],
        ['查看设置', '/admin/settings', '运行配置和主题治理'],
      ] as const,
    },
    en: {
      title: 'Quick actions',
      description:
        'Common entry points are grouped by intent so the homepage does not devolve into charts alone.',
      actions: [
        ['Users', '/admin/users', 'Accounts, verification, and sessions'],
        ['Roles', '/admin/rbac', 'Permissions, members, and risky grants'],
        ['Billing', '/admin/billing', 'Orders, entitlements, and subscriptions'],
        ['Files', '/admin/files', 'Storage, quarantine, and orphan objects'],
        ['Services', '/admin/service-connections', 'Connections, evidence, and secret rotation'],
        ['Webhooks', '/admin/webhooks', 'Outbox, receipts, and dead letters'],
        ['Runs', '/admin/runs', 'Jobs, failures, and requeue'],
        ['Modules', '/admin/modules', 'Installs, lifecycle, and release evidence'],
        ['Settings', '/admin/settings', 'Runtime config and theme governance'],
      ] as const,
    },
  }[lang];

  return (
    <AdminPanel title={copy.title} description={copy.description}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {copy.actions.map(([label, href, detail]) => (
          <Link
            key={href}
            href={localizedPath(lang, href)}
            className="group flex min-h-20 flex-col justify-between rounded-admin-md border border-admin-border bg-admin-bg/45 p-3 transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
          >
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold text-admin-text">
                {adminInlineText(lang, label)}
              </span>
              <span className="mt-1 block text-xs leading-5 text-admin-text-muted">
                {adminInlineText(lang, detail)}
              </span>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-admin-primary">
              {adminInlineText(lang, adminInlineText(lang, 'open_a211eefa'))}
              <span aria-hidden>→</span>
            </span>
          </Link>
        ))}
      </div>
    </AdminPanel>
  );
}

function AudienceWorkspace({ lang }: { lang: SupportedLanguage }) {
  const sections = [
    {
      key: 'operations',
      label: adminInlineText(lang, 'operations_7ae661f1'),
      count: '3',
      content: (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[
            [
              adminInlineText(lang, 'user_review_38aad4ec'),
              '/admin/users?status=pending-verification',
            ],
            [adminInlineText(lang, 'failed_runs_2eed30e4'), '/admin/runs?status=failed'],
            [adminInlineText(lang, 'dead_letters_b58834c8'), '/admin/webhooks?status=dead_letter'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={localizedPath(lang, href)}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2 text-sm font-medium text-admin-text transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
            >
              {label}
            </Link>
          ))}
        </div>
      ),
    },
    {
      key: 'commerce',
      label: adminInlineText(lang, 'commerce_ffe5812b'),
      count: '3',
      content: (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[
            [
              adminInlineText(lang, 'failed_orders_453ed2d8'),
              '/admin/billing?type=orders&status=failed',
            ],
            [
              adminInlineText(lang, 'revoked_grants_792a3c9e'),
              '/admin/entitlements?status=revoked',
            ],
            [adminInlineText(lang, 'revenue_pulse_b40977f0'), '/admin/revenue'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={localizedPath(lang, href)}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2 text-sm font-medium text-admin-text transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
            >
              {label}
            </Link>
          ))}
        </div>
      ),
    },
    {
      key: 'platform',
      label: adminInlineText(lang, 'platform_b218b539'),
      count: '3',
      content: (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[
            [adminInlineText(lang, 'service_connections_d365945f'), '/admin/service-connections'],
            [adminInlineText(lang, 'module_health_406d1a74'), '/admin/modules?status=error'],
            [adminInlineText(lang, 'config_audit_aa98bcad'), '/admin/settings'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={localizedPath(lang, href)}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2 text-sm font-medium text-admin-text transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
            >
              {label}
            </Link>
          ))}
        </div>
      ),
    },
  ] as const;

  return (
    <SegmentedWorkspace
      lang={lang}
      title={adminInlineText(lang, 'browse_by_audience_a0b96fae')}
      description={adminInlineText(
        lang,
        'operations_commerce_and_platform_entry_points_are_se_2784bd2c'
      )}
      sections={sections}
    />
  );
}

export interface AdminOverviewPageProps {
  lang: SupportedLanguage;
  snapshot?: AdminOperationsSnapshot;
  store?: HostRuntimeStoreStatus;
  users?: RuntimeStoreHostUser[];
  roles?: readonly {
    id: string;
    label: string;
    capabilities: readonly unknown[];
  }[];
  providerStatus?: AdminProviderStatusView;
  workerStatus?: AdminWorkerStatusView;
}

function AdminHomeView({
  lang,
  snapshot,
  store,
  users = [],
  roles = [],
  providerStatus,
  workerStatus,
}: AdminOverviewPageProps) {
  const copy = getAdminOverviewCopy(lang);
  const counts = snapshot?.counts;
  const now = Date.now();
  const recentUsers = users
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const newUsers7d = users.filter(
    (user) => now - Date.parse(user.createdAt) <= 7 * 24 * 60 * 60 * 1000
  ).length;
  const adminUsers = users.filter((user) => user.role === 'admin').length;
  const totalCapabilities = roles.reduce((sum, role) => sum + role.capabilities.length, 0);
  const suspendedUsers = users.filter((user) => user.status === 'suspended').length;
  const pendingRisks: RiskQueueItem[] = [
    suspendedUsers > 0
      ? {
          key: 'suspended-users',
          title: copy.risks.accessTitle,
          detail: copy.risks.accessDetail(suspendedUsers),
          action: copy.risks.accessAction,
          status: copy.risks.needsReview,
          href: localizedPath(lang, '/admin/users'),
          tone: 'warning',
        }
      : null,
  ].filter((row): row is RiskQueueItem => Boolean(row));
  const riskItems: RiskQueueItem[] =
    pendingRisks.length > 0
      ? pendingRisks
      : [
          {
            key: 'system-ready',
            title: copy.risks.readyTitle,
            detail: copy.risks.readyDetail,
            action: copy.risks.readyAction,
            status: copy.risks.healthy,
            href: localizedPath(lang, '/admin/users'),
            tone: 'success',
          },
        ];
  const activityBuckets = buildActivityBuckets(lang, users, []);
  const activityIndex = buildActivityIndex(
    activityBuckets.map((bucket) => bucket.value),
    4
  );
  const deadLetterCount =
    snapshot?.recent.outbox.filter((record) => record.status === 'dead_letter').length ?? 0;
  const providerHealthStatus = providerStatus
    ? providerStatus.providersBlocked > 0
      ? 'blocked'
      : providerStatus.providersWarning > 0
        ? 'warning'
        : providerStatus.ok
          ? 'ready'
          : 'warning'
    : 'missing';
  const serviceHealthItems = [
    {
      key: 'runtime-store',
      title: copy.services.database,
      detail: store?.databaseLabel ?? copy.services.memoryMode,
      meta: store?.durable ? copy.services.durable : copy.services.localOnly,
      status: healthBadgeValue(store?.durable),
      icon: Database,
      href: localizedPath(lang, '/admin/settings'),
      tone: store?.durable ? ('success' as const) : ('warning' as const),
    },
    {
      key: 'providers',
      title: adminInlineText(lang, 'Provider matrix'),
      detail: providerStatus
        ? `${providerStatus.providersReady}/${providerStatus.providersTotal} ${adminInlineText(lang, 'Ready')}`
        : adminInlineText(lang, 'not checked'),
      meta: providerStatus
        ? `${providerStatus.providersWarning} ${adminInlineText(lang, 'Warnings')} · ${providerStatus.providersBlocked} ${adminInlineText(lang, 'Blocked')}`
        : '-',
      status: providerHealthStatus,
      icon: Plug,
      href: localizedPath(lang, '/admin/service-connections'),
      tone: providerHealthStatus === 'ready' ? ('success' as const) : ('warning' as const),
    },
    {
      key: 'worker',
      title: adminInlineText(lang, 'Worker Status'),
      detail: workerStatus
        ? `${workerStatus.queue.queued} ${adminInlineText(lang, 'queued')} · ${workerStatus.queue.failed} ${adminInlineText(lang, 'failed')}`
        : adminInlineText(lang, 'not checked'),
      meta: workerStatus?.heartbeatAt ?? adminInlineText(lang, 'missing'),
      status: workerStatus?.heartbeatStatus ?? 'missing',
      icon: Server,
      href: localizedPath(lang, '/admin/runs'),
      tone: workerStatus?.heartbeatStatus === 'ready' ? ('success' as const) : ('warning' as const),
    },
    {
      key: 'outbox',
      title: copy.services.outboxStore,
      detail: copy.services.dead(deadLetterCount),
      meta: copy.services.receipts(counts?.webhookReceipts ?? 0),
      status: deadLetterCount > 0 ? 'warning' : 'ready',
      icon: AlertTriangle,
      href: localizedPath(lang, '/admin/webhooks'),
      tone: deadLetterCount > 0 ? ('warning' as const) : ('success' as const),
    },
  ];

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-5">
        <RiskQueuePanel lang={lang} items={riskItems} />
        <StatGrid className="xl:grid-cols-4">
          <StatCard
            label={copy.stat.totalUsers}
            value={String(users.length)}
            helper={copy.stat.activeNew(activeUsers, newUsers7d)}
            trend={newUsers7d > 0 ? `+${newUsers7d} 7d` : 'stable'}
            tone="blue"
            icon={Users}
            href={localizedPath(lang, '/admin/users')}
          />
          <StatCard
            label={copy.stat.activeUsers}
            value={String(activeUsers)}
            helper={copy.today.activeUsers}
            trend={activeUsers > 0 ? copy.stat.healthy : copy.stat.needsReview}
            tone={activeUsers > 0 ? 'green' : 'amber'}
            icon={CheckCircle2}
            href={localizedPath(lang, '/admin/users?status=active')}
          />
          <StatCard
            label={copy.stat.suspendedUsers}
            value={String(suspendedUsers)}
            helper={copy.stat.suspendedHelper(suspendedUsers)}
            trend={suspendedUsers > 0 ? copy.stat.needsReview : copy.stat.healthy}
            sparkline={activityIndex}
            tone={suspendedUsers > 0 ? 'red' : 'green'}
            icon={AlertTriangle}
            href={localizedPath(lang, '/admin/users?status=suspended')}
          />
          <StatCard
            label={copy.stat.roleCoverage}
            value={String(roles.length)}
            helper={copy.stat.roleCoverageHelper(roles.length, totalCapabilities)}
            icon={Clock3}
            href={localizedPath(lang, '/admin/rbac')}
          />
        </StatGrid>
        <QuickActionPanel lang={lang} />
        <AudienceWorkspace lang={lang} />
        <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.45fr)]">
          <OverviewPanel title={copy.today.title} description={copy.today.description}>
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <CheckCircle2 className="h-4 w-4 text-admin-success" aria-hidden />
                  {copy.today.activeUsers}
                </span>
                <strong className="text-sm text-admin-text">
                  {activeUsers}/{users.length}
                </strong>
              </div>
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <Bell className="h-4 w-4 text-admin-primary" aria-hidden />
                  {copy.today.notifications}
                </span>
                <strong className="text-sm text-admin-text">{counts?.notifications ?? 0}</strong>
              </div>
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <AlertTriangle className="h-4 w-4 text-admin-warning" aria-hidden />
                  {copy.today.roles}
                </span>
                <strong className="text-sm text-admin-text">
                  {roles.length}/{totalCapabilities}
                </strong>
              </div>
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <Clock3 className="h-4 w-4 text-admin-text-subtle" aria-hidden />
                  {copy.today.adminUsers}
                </span>
                <strong className="text-sm text-admin-text">{adminUsers}</strong>
              </div>
            </div>
          </OverviewPanel>
          <SystemStatusPanel lang={lang} items={serviceHealthItems} />
        </section>
      </div>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <RecentUsersCard lang={lang} users={recentUsers} />
        <UsageOverviewCard lang={lang} buckets={activityBuckets} />
      </section>
    </WorkspaceShell>
  );
}

export function AdminOverviewPage(props: AdminOverviewPageProps) {
  return <AdminHomeView {...props} />;
}
