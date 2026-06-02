import Link from 'next/link';
import type { ReactNode } from 'react';
import { BadgeDollarSign, CreditCard, PackageCheck, ReceiptText } from 'lucide-react';
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
  ActionQueue,
  ActionPanel,
  AdminPanel,
  ChartPanel,
  DangerZone,
  EvidenceSection,
  FilterBar,
  EntityListItem,
  FactList,
  HealthRowList,
  MoreActionMenu,
  PageSynopsis,
  SegmentedWorkspace,
  StatGrid,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatCurrencyMinor } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import {
  getAdminBillingCopy,
  getAdminEntitlementsCopy,
  getAdminRevenueCopy,
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
  RuntimeStoreEntitlementStatus,
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
  { value: 'reservations', label: 'Reservations' },
  { value: 'redeem', label: 'Redeem codes' },
  { value: 'api_keys', label: 'API keys' },
  { value: 'risk', label: 'Risk' },
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

function metadataOrderId(record: { metadata?: Record<string, unknown>; idempotencyKey?: string }) {
  const orderId = record.metadata?.orderId;
  return typeof orderId === 'string' && orderId.length > 0
    ? orderId
    : record.idempotencyKey?.startsWith('order:')
      ? record.idempotencyKey.split(':')[1]
      : undefined;
}

function orderBenefitSummary(order: RuntimeStoreCommercialOrder, commercial: AdminCommercialView) {
  const sku = commercial.catalog.skus.find((item) => item.id === order.sku);
  const expectedEntitlements = [...new Set(sku?.entitlements ?? [])];
  const expectedCredits = sku?.credits ?? 0;
  const entitlements = commercial.entitlements.filter((grant) => {
    const grantOrderId = metadataOrderId(grant);
    return (
      grant.userId === order.userId &&
      (grantOrderId === order.id ||
        grant.idempotencyKey?.startsWith(`order:${order.id}:entitlement:`) ||
        grant.source === 'order')
    );
  });
  const credits = commercial.credits.filter((entry) => {
    const entryOrderId = metadataOrderId(entry);
    return (
      entry.userId === order.userId &&
      (entryOrderId === order.id ||
        entry.idempotencyKey?.startsWith(`order:${order.id}:credits:`) ||
        entry.reason === 'order.paid')
    );
  });
  const missingEntitlements =
    order.status === 'paid'
      ? expectedEntitlements.filter(
          (entitlement) =>
            !entitlements.some(
              (grant) => grant.entitlement === entitlement && grant.status === 'active'
            )
        )
      : [];
  const creditGranted = credits.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
  const missingCredits =
    order.status === 'paid' && expectedCredits > creditGranted
      ? expectedCredits - creditGranted
      : 0;
  return {
    sku,
    expectedEntitlements,
    expectedCredits,
    entitlements,
    credits,
    missingEntitlements,
    missingCredits,
  };
}

function orderContextLinks(lang: SupportedLanguage, order: RuntimeStoreCommercialOrder) {
  return [
    {
      label: adminInlineText(lang, 'User'),
      href: localizedPath(lang, `/admin/users?q=${encodeURIComponent(order.userId)}`),
    },
    {
      label: adminInlineText(lang, 'Revenue'),
      href: localizedPath(lang, `/admin/revenue?q=${encodeURIComponent(order.id)}`),
    },
    {
      label: adminInlineText(lang, 'Entitlements'),
      href: localizedPath(lang, `/admin/entitlements?q=${encodeURIComponent(order.userId)}`),
    },
    {
      label: adminInlineText(lang, 'Audit'),
      href: localizedPath(lang, `/admin/audit?q=${encodeURIComponent(order.id)}`),
    },
  ];
}

export function AdminBillingOperationsPage({
  lang,
  commercial,
  upsertPlanAction,
  archivePlanAction,
  upsertSkuAction,
  archiveSkuAction,
  syncSkuAction,
  query,
}: {
  lang: SupportedLanguage;
  commercial: AdminCommercialView;
  upsertPlanAction?: AdminFormAction;
  archivePlanAction?: AdminFormAction;
  upsertSkuAction?: AdminFormAction;
  archiveSkuAction?: AdminFormAction;
  syncSkuAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminBillingCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const showOrders = tableQuery.type.length === 0 || tableQuery.type === 'orders';
  const showEntitlements = tableQuery.type.length === 0 || tableQuery.type === 'entitlements';
  const showCredits = tableQuery.type.length === 0 || tableQuery.type === 'credits';
  const showReservations = tableQuery.type.length === 0 || tableQuery.type === 'reservations';
  const showRedeem = tableQuery.type.length === 0 || tableQuery.type === 'redeem';
  const showApiKeys = tableQuery.type.length === 0 || tableQuery.type === 'api_keys';
  const showRisk = tableQuery.type.length === 0 || tableQuery.type === 'risk';
  const orders = commercial.orders.filter(
    (order) =>
      matchesTextSearch(tableQuery.q, [order.id, order.sku, order.userId, order.status]) &&
      matchesExactFilter(tableQuery.status, order.status)
  );
  const entitlements = commercial.entitlements.filter(
    (grant) =>
      matchesTextSearch(tableQuery.q, [grant.id, grant.entitlement, grant.userId, grant.status]) &&
      matchesExactFilter(tableQuery.status, grant.status)
  );
  const credits = commercial.credits.filter((entry) =>
    matchesTextSearch(tableQuery.q, [entry.id, entry.reason, entry.userId, entry.amount])
  );
  const reservations = commercial.creditReservations.filter(
    (reservation) =>
      matchesTextSearch(tableQuery.q, [
        reservation.id,
        reservation.subject.label,
        reservation.reason,
        reservation.source,
        reservation.status,
      ]) && matchesExactFilter(tableQuery.status, reservation.status)
  );
  const redeemCodes = commercial.redeemCodes.filter(
    (code) =>
      matchesTextSearch(tableQuery.q, [
        code.id,
        code.batchId,
        code.prefix,
        code.maskedCode,
        code.entitlement,
        code.status,
      ]) && matchesExactFilter(tableQuery.status, code.status)
  );
  const redeemRedemptions = commercial.redeemRedemptions.filter((redemption) =>
    matchesTextSearch(tableQuery.q, [
      redemption.id,
      redemption.codeHashPrefix,
      redemption.subject.label,
      redemption.entitlement,
    ])
  );
  const redeemAttempts = commercial.redeemAttempts.filter((attempt) =>
    matchesTextSearch(tableQuery.q, [
      attempt.id,
      attempt.codeHashPrefix,
      attempt.subject?.label,
      attempt.reason,
      attempt.ok ? 'success' : 'failed',
    ])
  );
  const apiKeys = commercial.apiKeys.filter(
    (key) =>
      matchesTextSearch(tableQuery.q, [
        key.id,
        key.name,
        key.prefix,
        key.owner?.label,
        key.moduleId,
        key.status,
      ]) && matchesExactFilter(tableQuery.status, key.status)
  );
  const riskRows = [...commercial.riskEvents, ...commercial.riskBlocks].filter((record) =>
    matchesTextSearch(tableQuery.q, [
      record.id,
      'type' in record ? record.type : 'block',
      record.subject?.label,
      'severity' in record ? record.severity : undefined,
      'reason' in record ? record.reason : undefined,
    ])
  );
  const visibleCount =
    (showOrders ? orders.length : 0) +
    (showEntitlements ? entitlements.length : 0) +
    (showCredits ? credits.length : 0) +
    (showReservations ? reservations.length : 0) +
    (showRedeem ? redeemCodes.length + redeemRedemptions.length + redeemAttempts.length : 0) +
    (showApiKeys ? apiKeys.length : 0) +
    (showRisk ? riskRows.length : 0);
  const totalCount =
    commercial.orders.length +
    commercial.entitlements.length +
    commercial.credits.length +
    commercial.creditReservations.length +
    commercial.redeemCodes.length +
    commercial.redeemRedemptions.length +
    commercial.redeemAttempts.length +
    commercial.apiKeys.length +
    commercial.riskEvents.length +
    commercial.riskBlocks.length;
  const failedOrders = commercial.orders.filter((order) =>
    ['failed', 'voided', 'canceled', 'expired'].includes(order.status)
  );
  const inactiveEntitlements = commercial.entitlements.filter((grant) =>
    ['revoked', 'expired'].includes(grant.status)
  );
  const activeSubscriptions = commercial.subscriptions.filter(
    (subscription) => subscription.status === 'active'
  ).length;
  const pastDueSubscriptions = commercial.subscriptions.filter(
    (subscription) => subscription.status === 'past_due'
  );
  const openInvoices = commercial.invoices.filter((invoice) => invoice.status === 'open');
  const savedPaymentMethods = commercial.paymentMethods.length;
  const taxProfiles = commercial.taxProfiles.length;
  const benefitSummaryByOrder = new Map(
    commercial.orders.map((order) => [order.id, orderBenefitSummary(order, commercial)])
  );
  const missingBenefitOrders = commercial.orders.filter((order) => {
    const summary = benefitSummaryByOrder.get(order.id);
    return (
      order.status === 'paid' &&
      Boolean(summary) &&
      (summary!.missingCredits > 0 || summary!.missingEntitlements.length > 0)
    );
  });
  const focusOrder =
    missingBenefitOrders[0] ??
    failedOrders[0] ??
    commercial.orders.find((order) => order.status === 'paid') ??
    commercial.orders[0] ??
    null;
  const commerceReviewItems = [
    failedOrders.length > 0
      ? {
          key: 'failed-orders',
          title: 'Orders need review',
          description: `${failedOrders.length} orders are failed, expired, canceled, or voided. Review payment provider evidence before changing access.`,
          actionLabel: 'Filter orders',
          href: localizedPath(lang, '/admin/billing?type=orders&status=failed'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    openInvoices.length > 0
      ? {
          key: 'open-invoices',
          title: 'Open invoices',
          description: `${openInvoices.length} invoices are still open. Reconcile them against the matching order and subscription state.`,
          actionLabel: 'Review invoices',
          href: localizedPath(lang, '/admin/revenue?status=open'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    pastDueSubscriptions.length > 0
      ? {
          key: 'past-due-subscriptions',
          title: 'Past due subscriptions',
          description: `${pastDueSubscriptions.length} subscriptions are past due and may block access renewal.`,
          actionLabel: 'Review subscriptions',
          href: localizedPath(lang, '/admin/billing?type=entitlements'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    missingBenefitOrders.length > 0
      ? {
          key: 'missing-benefits',
          title: 'Missing paid order benefits',
          description: `${missingBenefitOrders.length} paid orders are missing expected credits or entitlements. Reconcile by idempotency key before shipping access.`,
          actionLabel: 'Reconcile benefits',
          href: localizedPath(lang, '/admin/revenue'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    inactiveEntitlements.length > 0
      ? {
          key: 'inactive-entitlements',
          title: 'Inactive entitlements',
          description: `${inactiveEntitlements.length} grants are revoked or expired. Check whether users still have matching subscriptions.`,
          actionLabel: 'Review grants',
          href: localizedPath(lang, '/admin/billing?type=entitlements'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const skusByPlan = commercial.catalog.skus.reduce<
    Record<string, Array<(typeof commercial.catalog.skus)[number]>>
  >((acc, sku) => {
    acc[sku.planId] ??= [];
    acc[sku.planId].push(sku);
    return acc;
  }, {});

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Orders')}
          value={String(commercial.orders.length)}
          helper={adminInlineText(lang, 'value_need_review_fee2a156', {
            value1: failedOrders.length,
          })}
          tone="blue"
          icon={ReceiptText}
        />
        <StatCard
          label={adminInlineText(lang, 'Entitlements')}
          value={String(commercial.entitlements.length)}
          helper={adminInlineText(lang, 'value_inactive_c9d6730a', {
            value1: inactiveEntitlements.length,
          })}
          icon={BadgeDollarSign}
        />
        <StatCard
          label={adminInlineText(lang, 'Credits')}
          value={String(commercial.credits.length)}
          helper={adminInlineText(lang, 'Ledger entries')}
          tone="amber"
          icon={CreditCard}
        />
        <StatCard
          label={adminInlineText(lang, 'Plans')}
          value={String(commercial.catalog.plans.length)}
          helper={`${commercial.catalog.skus.length} SKUs`}
          icon={PackageCheck}
        />
      </StatGrid>
      <PageSynopsis
        lang={lang}
        title={adminInlineText(lang, 'Billing operating model')}
        description={adminInlineText(
          lang,
          'The page keeps billing exceptions and access review before catalog editing; catalog objects remain available as a secondary workspace.'
        )}
        status={failedOrders.length > 0 || inactiveEntitlements.length > 0 ? 'review' : 'healthy'}
        statusTone={
          failedOrders.length > 0
            ? 'danger'
            : inactiveEntitlements.length > 0
              ? 'warning'
              : 'success'
        }
        items={[
          {
            key: 'settlement',
            label: adminInlineText(lang, 'Settlement'),
            value: adminInlineText(lang, 'value_open_d19c38f3', { value1: openInvoices.length }),
            detail: adminInlineText(lang, 'value_failed_orders_9ca0c0f7', {
              value1: failedOrders.length,
            }),
            tone: openInvoices.length > 0 || failedOrders.length > 0 ? 'warning' : 'success',
          },
          {
            key: 'access',
            label: adminInlineText(lang, 'Access'),
            value: adminInlineText(lang, 'value_active_c668ccbe', { value1: activeSubscriptions }),
            detail: adminInlineText(lang, 'value_inactive_grants_a556f8e3', {
              value1: inactiveEntitlements.length,
            }),
            tone: inactiveEntitlements.length > 0 ? 'warning' : 'success',
          },
          {
            key: 'catalog',
            label: adminInlineText(lang, 'Catalog'),
            value: adminInlineText(lang, 'value_plans_a759f4a7', {
              value1: commercial.catalog.plans.length,
            }),
            detail: `${commercial.catalog.skus.length} SKUs`,
            tone: 'primary',
          },
          {
            key: 'profiles',
            label: adminInlineText(lang, 'Profiles'),
            value: `${savedPaymentMethods + taxProfiles}`,
            detail: adminInlineText(lang, 'Payment and tax records'),
            tone: 'info',
          },
        ]}
      />
      {commerceReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Billing review')}
          description={adminInlineText(
            lang,
            'Payment and access states that need human review are promoted before commercial ledgers.'
          )}
          status="warning"
          items={commerceReviewItems}
        />
      ) : null}
      {focusOrder ? (
        <DetailDrawer
          open
          title={adminInlineText(lang, 'Order detail')}
          description={`${focusOrder.id} · ${focusOrder.sku}`}
          className="mb-5"
          actions={orderContextLinks(lang, focusOrder).map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {link.label}
            </Link>
          ))}
        >
          {(() => {
            const summary = benefitSummaryByOrder.get(focusOrder.id);
            const invoice = commercial.invoices.find((item) => item.orderId === focusOrder.id);
            const subscription = commercial.subscriptions.find(
              (item) => item.userId === focusOrder.userId && item.planId === summary?.sku?.planId
            );
            return (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  { label: 'Order ID', value: focusOrder.id, copyValue: focusOrder.id, mono: true },
                  {
                    label: 'Customer',
                    value: focusOrder.userId,
                    copyValue: focusOrder.userId,
                    mono: true,
                  },
                  { label: 'Status', value: focusOrder.status },
                  { label: 'Amount', value: `${focusOrder.amount} ${focusOrder.currency}` },
                  { label: 'SKU package', value: summary?.sku?.name ?? focusOrder.sku },
                  {
                    label: 'Expected benefits',
                    value:
                      [
                        summary?.expectedEntitlements.length
                          ? `${summary.expectedEntitlements.length} entitlements`
                          : null,
                        summary?.expectedCredits ? `${summary.expectedCredits} credits` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'none',
                  },
                  {
                    label: 'Missing benefits',
                    value:
                      [
                        summary?.missingEntitlements.length
                          ? summary.missingEntitlements.join(', ')
                          : null,
                        summary?.missingCredits ? `${summary.missingCredits} credits` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'none',
                    tone:
                      summary &&
                      (summary.missingCredits > 0 || summary.missingEntitlements.length > 0)
                        ? 'warning'
                        : 'success',
                  },
                  {
                    label: 'Invoice',
                    value: invoice ? `${invoice.status} · ${invoice.id}` : 'none',
                  },
                  {
                    label: 'Subscription',
                    value: subscription
                      ? `${subscription.status} · ${subscription.planId}`
                      : 'none',
                  },
                ]}
              />
            );
          })()}
        </DetailDrawer>
      ) : null}
      <AdminPanel
        title={adminInlineText(lang, 'Business lanes')}
        description={adminInlineText(
          lang,
          'Billing should read as product packaging, customer access, settlement, and compliance lanes before raw ledger rows.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'catalog',
              title: 'Product packaging',
              detail: adminInlineText(lang, '{plans} plans and {skus} SKUs define sellable offers.', {
                plans: commercial.catalog.plans.length,
                skus: commercial.catalog.skus.length,
              }),
              meta: adminInlineText(lang, '{count} SKUs', {
                count: commercial.catalog.skus.length,
              }),
              status: commercial.catalog.skus.length > 0 ? 'ready' : 'empty',
              statusTone: commercial.catalog.skus.length > 0 ? 'success' : 'warning',
              tone: commercial.catalog.skus.length > 0 ? 'success' : 'warning',
            },
            {
              key: 'access',
              title: 'Customer access',
              detail: adminInlineText(
                lang,
                '{active} active subscriptions and {inactive} inactive grants.',
                {
                  active: activeSubscriptions,
                  inactive: inactiveEntitlements.length,
                }
              ),
              meta: adminInlineText(lang, '{count} grants', {
                count: commercial.entitlements.length,
              }),
              status: inactiveEntitlements.length > 0 ? 'review' : 'clear',
              statusTone: inactiveEntitlements.length > 0 ? 'warning' : 'success',
              tone: inactiveEntitlements.length > 0 ? 'warning' : 'success',
              href:
                inactiveEntitlements.length > 0
                  ? localizedPath(lang, '/admin/billing?type=entitlements')
                  : undefined,
            },
            {
              key: 'settlement',
              title: 'Settlement',
              detail: adminInlineText(
                lang,
                '{count} invoices are not settled; failed orders must be checked against provider evidence.',
                { count: openInvoices.length }
              ),
              meta: adminInlineText(lang, '{count} invoices', {
                count: commercial.invoices.length,
              }),
              status: openInvoices.length > 0 || failedOrders.length > 0 ? 'review' : 'clear',
              statusTone:
                openInvoices.length > 0 || failedOrders.length > 0 ? 'warning' : 'success',
              tone: openInvoices.length > 0 || failedOrders.length > 0 ? 'warning' : 'success',
            },
            {
              key: 'profiles',
              title: 'Payment and tax profiles',
              detail: adminInlineText(
                lang,
                '{paymentMethods} saved payment methods and {taxProfiles} tax profiles are available.',
                {
                  paymentMethods: savedPaymentMethods,
                  taxProfiles,
                }
              ),
              meta: adminInlineText(lang, '{count} tax profiles', { count: taxProfiles }),
              status: taxProfiles > 0 || savedPaymentMethods > 0 ? 'ready' : 'empty',
              statusTone: taxProfiles > 0 || savedPaymentMethods > 0 ? 'info' : 'neutral',
              tone: taxProfiles > 0 || savedPaymentMethods > 0 ? 'info' : 'neutral',
            },
          ]}
        />
      </AdminPanel>
      {upsertPlanAction || upsertSkuAction ? (
        <AdminPanel
          title={adminInlineText(lang, 'Catalog authoring')}
          description={adminInlineText(
            lang,
            'Plan and SKU editing is grouped separately from customer ledgers so product packaging does not blend into transaction review.'
          )}
          contentClassName="connection-policy-grid"
        >
          {upsertPlanAction ? (
            <details className="rounded-admin-md border border-admin-border bg-admin-bg/40">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
                {adminInlineText(lang, 'Plan authoring')}
              </summary>
              <form
                action={upsertPlanAction}
                className="grid gap-4 border-t border-admin-border p-4"
              >
                <div>
                  <h2>{adminInlineText(lang, 'Plan')}</h2>
                  <p>
                    {adminInlineText(lang, '创建或更新计划，权益会进入 runtime billing guard。')}
                  </p>
                </div>
                <Input
                  name="planId"
                  placeholder={adminInlineText(lang, 'team-pro')}
                  aria-label={adminInlineText(lang, 'Plan ID')}
                  required
                />
                <Input
                  name="name"
                  placeholder={adminInlineText(lang, 'Team Pro')}
                  aria-label={adminInlineText(lang, 'Plan name')}
                  required
                />
                <Input
                  name="entitlements"
                  placeholder={adminInlineText(lang, 'public-tools.pro,ai.rag')}
                  aria-label={adminInlineText(lang, 'Entitlements')}
                />
                <Input
                  name="features"
                  placeholder={adminInlineText(lang, 'priority support,team workspace')}
                  aria-label={adminInlineText(lang, 'Features')}
                />
                <Input
                  name="limits"
                  placeholder={adminInlineText(lang, 'credits:1000,filesMb:250')}
                  aria-label={adminInlineText(lang, 'Limits')}
                />
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(lang, '确认保存 billing plan？')}
                >
                  {adminInlineText(lang, 'Save Plan')}
                </ConfirmSubmitButton>
              </form>
            </details>
          ) : null}
          {upsertSkuAction ? (
            <details className="rounded-admin-md border border-admin-border bg-admin-bg/40">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
                {adminInlineText(lang, 'SKU authoring')}
              </summary>
              <form
                action={upsertSkuAction}
                className="grid gap-4 border-t border-admin-border p-4"
              >
                <div>
                  <h2>{adminInlineText(lang, 'SKU')}</h2>
                  <p>
                    {adminInlineText(
                      lang,
                      '创建或更新 SKU，checkout 和 paid order benefits 会使用它。'
                    )}
                  </p>
                </div>
                <Input
                  name="skuId"
                  placeholder={adminInlineText(lang, 'team-pro-monthly')}
                  aria-label={adminInlineText(lang, 'SKU ID')}
                  required
                />
                <Input
                  name="name"
                  placeholder={adminInlineText(lang, 'Team Pro Monthly')}
                  aria-label={adminInlineText(lang, 'SKU name')}
                  required
                />
                <Input
                  name="planId"
                  placeholder={adminInlineText(lang, 'team-pro')}
                  aria-label={adminInlineText(lang, 'Plan ID')}
                  required
                />
                <Input
                  name="amount"
                  placeholder="1200"
                  aria-label={adminInlineText(lang, 'Amount cents')}
                  required
                />
                <Input
                  name="currency"
                  placeholder={adminInlineText(lang, 'USD')}
                  aria-label={adminInlineText(lang, 'Currency')}
                />
                <Select
                  name="interval"
                  defaultValue="month"
                  aria-label={adminInlineText(lang, 'Interval')}
                >
                  <option value="month">{adminInlineText(lang, 'Monthly')}</option>
                  <option value="one_time">{adminInlineText(lang, 'One time')}</option>
                </Select>
                <Input
                  name="credits"
                  placeholder="1000"
                  aria-label={adminInlineText(lang, 'Credits')}
                />
                <Input
                  name="creditUnit"
                  placeholder={adminInlineText(lang, 'credit')}
                  aria-label={adminInlineText(lang, 'Credit unit')}
                />
                <Input
                  name="entitlements"
                  placeholder={adminInlineText(lang, 'public-tools.pro')}
                  aria-label={adminInlineText(lang, 'Entitlements')}
                />
                <Input
                  name="stripePriceId"
                  placeholder={adminInlineText(lang, 'price_test_...')}
                  aria-label={adminInlineText(lang, 'Stripe price ID')}
                />
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(lang, '确认保存 SKU？')}
                >
                  {adminInlineText(lang, 'Save SKU')}
                </ConfirmSubmitButton>
              </form>
            </details>
          ) : null}
        </AdminPanel>
      ) : null}
      <SegmentedWorkspace
        lang={lang}
        title={adminInlineText(lang, 'Commercial catalog')}
        description={adminInlineText(
          lang,
          'Plans and SKUs are the primary billing workspace. They are grouped as product packages first, with row-level maintenance behind compact actions.'
        )}
        sections={[
          {
            key: 'billing-plans',
            label: 'Plans',
            count: commercial.catalog.plans.length,
            content: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, [
                  'Plan',
                  'Package',
                  'Subscribers',
                  'Coverage',
                  'Maintenance',
                ])}
                rows={commercial.catalog.plans.map((plan) => {
                  const skus = skusByPlan[plan.id] ?? [];
                  const monthlySku = skus.find((sku) => sku.interval === 'month');
                  const oneTimeSku = skus.find((sku) => sku.interval === 'one_time');
                  return [
                    <span key={`${plan.id}:plan`} className="block min-w-0">
                      <span className="block truncate font-semibold text-admin-text">
                        {plan.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                        {plan.id}
                      </span>
                    </span>,
                    <span
                      key={`${plan.id}:package`}
                      className="block text-xs leading-5 text-admin-text-muted"
                    >
                      {monthlySku
                        ? `${formatCurrencyMinor(monthlySku.amount, monthlySku.currency, lang)} / month`
                        : 'no monthly SKU'}
                      {oneTimeSku
                        ? ` · ${formatCurrencyMinor(oneTimeSku.amount, oneTimeSku.currency, lang)} one-time`
                        : ''}
                    </span>,
                    String(commercial.planSubscribers[plan.id] ?? 0),
                    <span
                      key={`${plan.id}:coverage`}
                      className="block max-w-sm text-xs leading-5 text-admin-text-muted"
                    >
                      {plan.entitlements.join(', ') || 'No entitlements'}
                      {Object.keys(plan.limits).length > 0
                        ? ` · ${Object.entries(plan.limits)
                            .map(([key, value]) => `${key}:${value}`)
                            .join(', ')}`
                        : ''}
                    </span>,
                    <div key={`${plan.id}:action`} className="flex items-center gap-2">
                      <StatusBadge lang={lang} value={plan.status} />
                      {archivePlanAction ? (
                        <MoreActionMenu label={adminInlineText(lang, 'Maintain')}>
                          <form action={archivePlanAction}>
                            <input type="hidden" name="planId" value={plan.id} />
                            <input type="hidden" name="reason" value={`Archive plan ${plan.id}`} />
                            <ConfirmSubmitButton
                              type="submit"
                              className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                              disabled={plan.status === 'archived'}
                              confirmation={adminInlineText(
                                lang,
                                'archive_plan_value_existing_subscriptions_will_not_b_da179b8e',
                                { value1: plan.name }
                              )}
                            >
                              {adminInlineText(lang, 'Archive plan')}
                            </ConfirmSubmitButton>
                          </form>
                        </MoreActionMenu>
                      ) : null}
                    </div>,
                  ];
                })}
              />
            ),
          },
          {
            key: 'billing-skus',
            label: 'SKU packages',
            count: commercial.catalog.skus.length,
            content: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, [
                  'SKU',
                  'Plan',
                  'Price',
                  'Credits',
                  'Maintenance',
                ])}
                rows={commercial.catalog.skus.map((sku) => [
                  <span key={`${sku.id}:sku`} className="block min-w-0">
                    <span className="block truncate font-semibold text-admin-text">{sku.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                      {sku.id}
                    </span>
                  </span>,
                  sku.planId,
                  `${formatCurrencyMinor(sku.amount, sku.currency, lang)} · ${sku.interval}`,
                  `${sku.credits} ${sku.creditUnit}`,
                  <div key={`${sku.id}:actions`} className="flex items-center gap-2">
                    <StatusBadge lang={lang} value={sku.status ?? 'active'} />
                    {syncSkuAction || archiveSkuAction ? (
                      <MoreActionMenu label={adminInlineText(lang, 'Maintain')}>
                        {syncSkuAction ? (
                          <form action={syncSkuAction}>
                            <input type="hidden" name="skuId" value={sku.id} />
                            <input type="hidden" name="reason" value={`Sync SKU ${sku.id}`} />
                            <ConfirmSubmitButton
                              type="submit"
                              className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                              confirmation={adminInlineText(
                                lang,
                                'sync_sku_value_to_the_stripe_status_check_919dc3f3',
                                { value1: sku.name }
                              )}
                            >
                              {adminInlineText(lang, 'Sync provider')}
                            </ConfirmSubmitButton>
                          </form>
                        ) : null}
                        {archiveSkuAction ? (
                          <form action={archiveSkuAction}>
                            <input type="hidden" name="skuId" value={sku.id} />
                            <input type="hidden" name="reason" value={`Archive SKU ${sku.id}`} />
                            <ConfirmSubmitButton
                              type="submit"
                              className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                              disabled={sku.status === 'archived'}
                              confirmation={adminInlineText(lang, 'archive_sku_value_6fe9d791', {
                                value1: sku.name,
                              })}
                            >
                              {adminInlineText(lang, 'Archive SKU')}
                            </ConfirmSubmitButton>
                          </form>
                        ) : null}
                      </MoreActionMenu>
                    ) : null}
                  </div>,
                ])}
              />
            ),
          },
          {
            key: 'billing-catalog-filter',
            label: 'Ledger filter',
            count: visibleCount,
            content: (
              <div className="grid gap-3">
                <FilterBar
                  lang={lang}
                  embedded
                  searchValue={tableQuery.q}
                  searchPlaceholder="搜索订单、权益、用户或 credit reason"
                  filterName="type"
                  filterValue={tableQuery.type}
                  filterLabel="记录"
                  filterOptions={commercialTypeOptions}
                  resetHref={localizedPath(lang, '/admin/billing')}
                />
                <FilterResultHint lang={lang} visible={visibleCount} total={totalCount} />
              </div>
            ),
          },
        ]}
      />
      {archivePlanAction || archiveSkuAction ? (
        <DangerZone
          title={adminInlineText(lang, 'Catalog archive controls')}
          description={adminInlineText(
            lang,
            'Archive actions are intentionally hidden in row-level Maintain menus. They never appear as primary catalog actions.'
          )}
        />
      ) : null}
      <AdminPanel
        title={adminInlineText(lang, 'Access and credit ledger')}
        description={adminInlineText(
          lang,
          'Filtered customer-facing records stay in one ledger section instead of spreading across separate page bands.'
        )}
        contentClassName="grid gap-4"
      >
        <EvidenceSection
          title={adminInlineText(lang, 'Feature matrix')}
          description={adminInlineText(lang, 'Plan capability coverage for product packaging.')}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, [
              'Capability',
              ...commercial.catalog.plans.map((plan) => plan.id),
            ])}
            rows={commercial.featureMatrix.map((row) => [
              row.capability,
              ...commercial.catalog.plans.map((plan) => {
                const value = row.plans[plan.id];
                return typeof value === 'boolean'
                  ? value
                    ? adminInlineText(lang, 'yes')
                    : '-'
                  : String(value ?? '-');
              }),
            ])}
            density="compact"
          />
        </EvidenceSection>
        {showOrders ? (
          <EvidenceSection
            title={`Order records · ${orders.length}`}
            description={adminInlineText(lang, 'Filtered order rows with user and payment state.')}
          >
            <DataTable
              className="hidden xl:block shadow-none"
              columns={adminInlineColumns(lang, [
                'Order',
                'User',
                'Amount',
                'Status',
                'Benefits',
                'Links',
              ])}
              rows={orders.map((order) => {
                const summary = benefitSummaryByOrder.get(order.id);
                return [
                  <span key={`${order.id}:order`} className="block min-w-0">
                    <span className="block truncate font-semibold text-admin-text">
                      {order.sku}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                      {order.id}
                    </span>
                  </span>,
                  <Link
                    key={`${order.id}:user`}
                    href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(order.userId)}`)}
                    className="font-medium text-admin-primary hover:underline"
                  >
                    {order.userId}
                  </Link>,
                  `${order.amount} ${order.currency}`,
                  <StatusBadge key={`${order.id}:status`} lang={lang} value={order.status} />,
                  <span
                    key={`${order.id}:benefits`}
                    className="block text-xs leading-5 text-admin-text-muted"
                  >
                    {summary?.missingEntitlements.length || summary?.missingCredits
                      ? [
                          summary?.missingEntitlements.length
                            ? summary.missingEntitlements.join(', ')
                            : null,
                          summary?.missingCredits ? `${summary.missingCredits} credits` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : 'benefits satisfied'}
                  </span>,
                  <div key={`${order.id}:links`} className="flex flex-wrap items-center gap-2">
                    {orderContextLinks(lang, order).map((link) => (
                      <Link
                        key={link.label}
                        href={link.href}
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-bg px-2.5 py-1 text-[11px] font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>,
                ];
              })}
              density="compact"
            />
            <div className="grid gap-1 xl:hidden">
              {orders.map((order) => {
                const summary = benefitSummaryByOrder.get(order.id);
                return (
                  <EntityListItem
                    key={order.id}
                    href={localizedPath(lang, `/admin/revenue?q=${encodeURIComponent(order.id)}`)}
                    title={order.sku}
                    subtitle={order.userId}
                    status={order.status}
                    detail={[
                      `${order.amount} ${order.currency}`,
                      summary?.missingEntitlements.length || summary?.missingCredits
                        ? [
                            summary?.missingEntitlements.length
                              ? summary.missingEntitlements.join(', ')
                              : null,
                            summary?.missingCredits ? `${summary.missingCredits} credits` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : 'benefits satisfied',
                    ].join(' · ')}
                    meta={order.id}
                    icon={ReceiptText}
                    density="compact"
                    tone={
                      order.status === 'failed' || order.status === 'refunded'
                        ? 'danger'
                        : 'primary'
                    }
                  />
                );
              })}
            </div>
          </EvidenceSection>
        ) : null}
        {showEntitlements ? (
          <EvidenceSection
            title={`Entitlement records · ${entitlements.length}`}
            description={adminInlineText(lang, 'Filtered grants and user access state.')}
          >
            <DataTable
              className="hidden xl:block shadow-none"
              columns={adminInlineColumns(lang, [
                'Entitlement',
                'User',
                'Source',
                'Context',
                'Status',
              ])}
              rows={entitlements.map((grant) => {
                const orderId = metadataOrderId(grant);
                return [
                  grant.entitlement,
                  <Link
                    key={`${grant.id}:user`}
                    href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(grant.userId)}`)}
                    className="font-medium text-admin-primary hover:underline"
                  >
                    {grant.userId}
                  </Link>,
                  grant.source,
                  <span
                    key={`${grant.id}:context`}
                    className="block text-xs leading-5 text-admin-text-muted"
                  >
                    {grant.planId ?? 'no plan'}
                    {orderId ? ` · order ${orderId}` : ''}
                    {grant.expiresAt ? ` · ${grant.expiresAt}` : ''}
                  </span>,
                  <StatusBadge key={`${grant.id}:status`} lang={lang} value={grant.status} />,
                ];
              })}
              density="compact"
            />
            <div className="grid gap-1 xl:hidden">
              {entitlements.map((grant) => {
                const orderId = metadataOrderId(grant);
                return (
                  <EntityListItem
                    key={grant.id}
                    href={localizedPath(
                      lang,
                      `/admin/entitlements?q=${encodeURIComponent(grant.userId)}`
                    )}
                    title={grant.entitlement}
                    subtitle={grant.userId}
                    status={grant.status}
                    detail={[
                      grant.source,
                      grant.planId ?? 'no plan',
                      orderId ? `order ${orderId}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    meta={grant.id}
                    icon={BadgeDollarSign}
                    density="compact"
                    tone={grant.status === 'active' ? 'primary' : 'warning'}
                  />
                );
              })}
            </div>
          </EvidenceSection>
        ) : null}
        {showCredits ? (
          <EvidenceSection
            title={`Credit records · ${credits.length}`}
            description={adminInlineText(lang, 'Filtered credit ledger entries.')}
          >
            <DataTable
              className="hidden xl:block shadow-none"
              columns={adminInlineColumns(lang, ['Reason', 'User', 'Amount', 'Context'])}
              rows={credits.map((entry) => [
                entry.reason,
                <Link
                  key={`${entry.id}:user`}
                  href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(entry.userId)}`)}
                  className="font-medium text-admin-primary hover:underline"
                >
                  {entry.userId}
                </Link>,
                String(entry.amount),
                <span
                  key={`${entry.id}:context`}
                  className="block text-xs leading-5 text-admin-text-muted"
                >
                  {entry.unit}
                  {metadataOrderId(entry) ? ` · order ${metadataOrderId(entry)}` : ''}
                </span>,
              ])}
              density="compact"
            />
            <div className="grid gap-1 xl:hidden">
              {credits.map((entry) => (
                <EntityListItem
                  key={entry.id}
                  href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(entry.userId)}`)}
                  title={entry.reason}
                  subtitle={entry.userId}
                  detail={[
                    `${entry.amount} ${entry.unit}`,
                    metadataOrderId(entry) ? `order ${metadataOrderId(entry)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={entry.id}
                  icon={CreditCard}
                  density="compact"
                  tone={entry.amount < 0 ? 'danger' : 'primary'}
                />
              ))}
            </div>
          </EvidenceSection>
        ) : null}
        {showReservations ? (
          <EvidenceSection
            title={`Credit reservations · ${reservations.length}`}
            description={copy.creditReservationsDescription}
          >
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Reservation', 'Subject', 'Amount', 'Status'])}
              rows={reservations.map((reservation) => [
                <span key={`${reservation.id}:reservation`} className="block min-w-0">
                  <span className="block truncate font-semibold text-admin-text">
                    {reservation.reason ?? reservation.source ?? 'reserve'}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                    {reservation.id}
                  </span>
                </span>,
                reservation.subject.label,
                `${reservation.amountCommitted}/${reservation.amountReserved} ${reservation.unit}`,
                <StatusBadge key={`${reservation.id}:status`} lang={lang} value={reservation.status} />,
              ])}
              density="compact"
            />
          </EvidenceSection>
        ) : null}
        {showRedeem ? (
          <EvidenceSection
            title={`Redeem code lifecycle · ${redeemCodes.length + redeemRedemptions.length + redeemAttempts.length}`}
            description={copy.redeemCodeLifecycleDescription}
          >
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Record', 'Subject', 'Benefit', 'Status'])}
              rows={[
                ...redeemCodes.map((code) => [
                  <span key={`${code.id}:code`} className="block min-w-0">
                    <span className="block truncate font-semibold text-admin-text">
                      {code.maskedCode ?? code.prefix ?? code.codeHashPrefix}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                      {code.batchId ?? code.codeHashPrefix}
                    </span>
                  </span>,
                  '-',
                  [
                    code.entitlement,
                    code.creditsAmount ? `${code.creditsAmount} ${code.creditsUnit}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '-',
                  <StatusBadge key={`${code.id}:status`} lang={lang} value={code.status} />,
                ]),
                ...redeemRedemptions.map((redemption) => [
                  <span key={`${redemption.id}:redemption`} className="block min-w-0">
                    <span className="block truncate font-semibold text-admin-text">
                      {copy.redemptionRecord}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                      {redemption.codeHashPrefix}
                    </span>
                  </span>,
                  redemption.subject.label,
                  [
                    redemption.entitlement,
                    redemption.creditsAmount
                      ? `${redemption.creditsAmount} ${redemption.creditsUnit ?? 'credit'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '-',
                  'redeemed',
                ]),
                ...redeemAttempts.map((attempt) => [
                  <span key={`${attempt.id}:attempt`} className="block min-w-0">
                    <span className="block truncate font-semibold text-admin-text">
                      {copy.attemptRecord}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                      {attempt.codeHashPrefix ?? attempt.id}
                    </span>
                  </span>,
                  attempt.subject?.label ?? '-',
                  attempt.reason ?? '-',
                  <StatusBadge
                    key={`${attempt.id}:status`}
                    lang={lang}
                    value={attempt.ok ? 'success' : 'failed'}
                  />,
                ]),
              ]}
              density="compact"
            />
          </EvidenceSection>
        ) : null}
        {showApiKeys ? (
          <EvidenceSection
            title={`Machine API keys · ${apiKeys.length}`}
            description={copy.machineApiKeysDescription}
          >
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Key', 'Owner', 'Permissions', 'Status'])}
              rows={apiKeys.map((key) => [
                <span key={`${key.id}:key`} className="block min-w-0">
                  <span className="block truncate font-semibold text-admin-text">{key.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                    {key.prefix} · {key.moduleId ?? 'product'}
                  </span>
                </span>,
                key.owner?.label ?? '-',
                joinOrNone(key.permissions.map(String)),
                <StatusBadge key={`${key.id}:status`} lang={lang} value={key.status} />,
              ])}
              density="compact"
            />
          </EvidenceSection>
        ) : null}
        {showRisk ? (
          <EvidenceSection
            title={`Risk facts · ${riskRows.length}`}
            description={copy.riskFactsDescription}
          >
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Risk', 'Subject', 'Source', 'Status'])}
              rows={riskRows.map((record) => [
                <span key={`${record.id}:risk`} className="block min-w-0">
                  <span className="block truncate font-semibold text-admin-text">
                    {'type' in record ? record.type : record.reason}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                    {record.id}
                  </span>
                </span>,
                record.subject?.label ?? '-',
                'severity' in record ? record.source ?? '-' : record.scope ?? '-',
                <StatusBadge
                  key={`${record.id}:status`}
                  lang={lang}
                  value={'severity' in record ? record.severity : 'blocked'}
                />,
              ])}
              density="compact"
            />
          </EvidenceSection>
        ) : null}
      </AdminPanel>
      <AdminPanel
        title={adminInlineText(lang, 'Settlement evidence')}
        description={adminInlineText(
          lang,
          'Subscriptions, invoices, payment methods, and tax profiles are settlement evidence. They stay collapsed until an operator needs the detail.'
        )}
        contentClassName="grid gap-3"
      >
        {[
          {
            key: 'subscriptions',
            title: `${adminInlineText(lang, 'Subscriptions')} · ${commercial.subscriptions.length}`,
            description: 'Subscriptions connect customer access to plan state.',
            table: (
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Subscription', 'User', 'Plan', 'Status'])}
                rows={commercial.subscriptions.map((subscription) => [
                  subscription.entitlement,
                  subscription.userId,
                  subscription.planId,
                  <StatusBadge key={subscription.id} lang={lang} value={subscription.status} />,
                ])}
                density="compact"
              />
            ),
          },
          {
            key: 'invoices',
            title: `${adminInlineText(lang, 'Invoices')} · ${commercial.invoices.length}`,
            description: 'Invoices explain settlement evidence for paid orders.',
            table: (
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Invoice', 'Order', 'Amount', 'Status'])}
                rows={commercial.invoices.map((invoice) => [
                  invoice.id,
                  invoice.orderId,
                  `${invoice.amount} ${invoice.currency}`,
                  <StatusBadge key={invoice.id} lang={lang} value={invoice.status} />,
                ])}
                density="compact"
              />
            ),
          },
          {
            key: 'payment-methods',
            title: `${adminInlineText(lang, 'Payment methods')} · ${commercial.paymentMethods.length}`,
            description: 'Saved payment methods stay together with the settlement evidence.',
            table: (
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Payment Method', 'User', 'Provider', 'Status'])}
                rows={
                  commercial.paymentMethods.length > 0
                    ? commercial.paymentMethods.map((method) => [
                        method.label,
                        method.userId ?? 'system',
                        method.provider,
                        <StatusBadge key={method.id} lang={lang} value={method.status} />,
                      ])
                    : [['-', '-', '-', 'No saved payment methods']]
                }
                density="compact"
              />
            ),
          },
          {
            key: 'tax',
            title: `${adminInlineText(lang, 'Tax profiles')} · ${commercial.taxProfiles.length}`,
            description: 'Tax profiles are retained as evidence, not as a separate page band.',
            table: (
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Tax Profile', 'Company', 'Country', 'Tax ID'])}
                rows={
                  commercial.taxProfiles.length > 0
                    ? commercial.taxProfiles.map((profile) => [
                        profile.userId,
                        profile.company ?? '-',
                        profile.country ?? '-',
                        profile.taxIdMasked ?? '-',
                      ])
                    : [['-', '-', '-', 'No tax profile data']]
                }
                density="compact"
              />
            ),
          },
        ].map((section) => (
          <EvidenceSection
            key={section.key}
            title={section.title}
            description={adminInlineText(lang, section.description)}
          >
            {section.table}
          </EvidenceSection>
        ))}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function AdminRevenueOperationsPage({
  lang,
  revenue,
  commercial,
  reconcileBillingAction,
  query,
}: {
  lang: SupportedLanguage;
  revenue: AdminPagedResult<RuntimeStoreCommercialOrder> & {
    totals: Record<string, number>;
    providerEvents: RuntimeStoreAuditRecord[];
    catalog: HostBillingOverview['catalog'];
    dailyBuckets: {
      day: string;
      total: number;
      paid: number;
      refunded: number;
      failed: number;
      currencies: Record<string, number>;
    }[];
  };
  commercial?: AdminCommercialView;
  reconcileBillingAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminRevenueCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const paidOrders = revenue.items.filter((order) => order.status === 'paid');
  const refundedOrders = revenue.items.filter((order) => order.status === 'refunded');
  const failedOrders = revenue.items.filter((order) => order.status === 'failed');
  const benefitSummaryByOrder = commercial
    ? new Map(commercial.orders.map((order) => [order.id, orderBenefitSummary(order, commercial)]))
    : new Map<string, ReturnType<typeof orderBenefitSummary>>();
  const missingBenefitOrders = commercial
    ? commercial.orders.filter((order) => {
        const summary = benefitSummaryByOrder.get(order.id);
        return (
          order.status === 'paid' &&
          Boolean(summary) &&
          (summary!.missingCredits > 0 || summary!.missingEntitlements.length > 0)
        );
      })
    : [];
  const focusOrder =
    missingBenefitOrders[0] ?? failedOrders[0] ?? refundedOrders[0] ?? revenue.items[0] ?? null;
  const dailyBuckets = revenue.dailyBuckets;
  const chartBuckets = dailyBuckets.slice(-14);
  const revenueReviewItems = [
    failedOrders.length > 0
      ? {
          key: 'failed-orders',
          title: adminInlineText(lang, 'Failed orders'),
          description:
            lang === 'zh'
              ? `${failedOrders.length} 个订单失败。重试结账或变更访问权限前，请先检查供应商事件证据。`
              : `${failedOrders.length} orders failed. Check provider event evidence before retrying checkout or changing access.`,
          actionLabel: adminInlineText(lang, 'Review orders'),
          href: localizedPath(lang, '/admin/revenue?status=failed'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    refundedOrders.length > 0
      ? {
          key: 'refunded-orders',
          title: adminInlineText(lang, 'Refunded orders'),
          description:
            lang === 'zh'
              ? `${refundedOrders.length} 个订单已退款。请确认贷项记录和权益撤销证据。`
              : `${refundedOrders.length} orders were refunded. Confirm credit notes and entitlement revocation evidence.`,
          actionLabel: adminInlineText(lang, 'Review refunds'),
          href: localizedPath(lang, '/admin/revenue?status=refunded'),
          status: 'refunded',
          tone: 'warning' as const,
        }
      : null,
    missingBenefitOrders.length > 0
      ? {
          key: 'missing-benefits',
          title: adminInlineText(lang, 'Missing benefits'),
          description:
            lang === 'zh'
              ? `${missingBenefitOrders.length} 个已支付订单缺少点数或权益。`
              : `${missingBenefitOrders.length} paid orders are missing credits or entitlements.`,
          actionLabel: adminInlineText(lang, 'Reconcile'),
          href: localizedPath(lang, '/admin/revenue'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        {Object.entries(revenue.totals).map(([currency, amount]) => (
          <StatCard
            key={currency}
            label={currency}
            value={String(amount)}
            helper={adminInlineText(lang, 'Recognized total')}
            tone="blue"
            icon={BadgeDollarSign}
          />
        ))}
        <StatCard
          label={adminInlineText(lang, 'Orders')}
          value={String(revenue.page.total)}
          helper={adminInlineText(lang, 'Commercial ledger rows')}
          icon={ReceiptText}
        />
        <StatCard
          label={adminInlineText(lang, 'Failed orders')}
          value={String(failedOrders.length)}
          helper={adminInlineText(lang, 'Needs payment follow-up')}
          tone={failedOrders.length > 0 ? 'amber' : 'green'}
          icon={CreditCard}
        />
        <StatCard
          label={adminInlineText(lang, 'Missing benefits')}
          value={String(missingBenefitOrders.length)}
          helper={adminInlineText(lang, 'Credits or entitlements')}
          tone={missingBenefitOrders.length > 0 ? 'red' : 'green'}
          icon={PackageCheck}
        />
      </StatGrid>
      {revenueReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Revenue review')}
          description={adminInlineText(
            lang,
            'Failed, refunded, and missing-benefit orders are promoted before the ledger so reconcile has a concrete target.'
          )}
          status="warning"
          items={revenueReviewItems}
        />
      ) : null}
      {reconcileBillingAction ? (
        <ActionPanel
          title={adminInlineText(lang, 'Billing reconcile')}
          description={adminInlineText(
            lang,
            'Replay paid order benefits and repair missing entitlements or credits by idempotency key.'
          )}
          tone={failedOrders.length > 0 ? 'warning' : 'primary'}
          actions={
            <form action={reconcileBillingAction}>
              <ConfirmSubmitButton
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                confirmation={adminInlineText(
                  lang,
                  '确认执行 Billing reconcile？该操作会补齐缺失的 paid order benefits。'
                )}
              >
                {adminInlineText(lang, 'Reconcile')}
              </ConfirmSubmitButton>
            </form>
          }
        />
      ) : null}
      {focusOrder ? (
        <DetailDrawer
          open
          title={adminInlineText(lang, 'Order evidence')}
          description={`${focusOrder.id} · ${focusOrder.sku}`}
          actions={orderContextLinks(lang, focusOrder).map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {link.label}
            </Link>
          ))}
        >
          {(() => {
            const summary = benefitSummaryByOrder.get(focusOrder.id);
            return (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  { label: 'Order ID', value: focusOrder.id, copyValue: focusOrder.id, mono: true },
                  {
                    label: 'Customer',
                    value: focusOrder.userId,
                    copyValue: focusOrder.userId,
                    mono: true,
                  },
                  { label: 'Status', value: focusOrder.status },
                  { label: 'Amount', value: `${focusOrder.amount} ${focusOrder.currency}` },
                  { label: 'Provider', value: focusOrder.provider ?? 'local' },
                  { label: 'Provider Ref', value: focusOrder.providerRef ?? 'none', mono: true },
                  {
                    label: 'Benefit status',
                    value: summary
                      ? [
                          summary.missingEntitlements.length
                            ? summary.missingEntitlements.join(', ')
                            : null,
                          summary.missingCredits ? `${summary.missingCredits} credits` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'satisfied'
                      : 'not loaded',
                    tone:
                      summary &&
                      (summary.missingCredits > 0 || summary.missingEntitlements.length > 0)
                        ? 'warning'
                        : 'success',
                  },
                ]}
              />
            );
          })()}
        </DetailDrawer>
      ) : null}
      <ChartPanel
        title={adminInlineText(lang, 'Revenue pulse')}
        description={adminInlineText(
          lang,
          'Daily paid revenue buckets are returned by the admin API so filtering the order table does not collapse the trend context.'
        )}
        values={chartBuckets.map((bucket) => bucket.total)}
        labels={chartBuckets.map((bucket) => bucket.day.slice(5))}
        axisLabel="paid amount"
        legend={[
          { key: 'paid', label: 'Paid', value: paidOrders.length, tone: 'success' },
          {
            key: 'refunded',
            label: 'Refunded',
            value: refundedOrders.length,
            tone: refundedOrders.length > 0 ? 'warning' : 'neutral',
          },
          {
            key: 'failed',
            label: 'Failed',
            value: failedOrders.length,
            tone: failedOrders.length > 0 ? 'danger' : 'neutral',
          },
        ]}
        drilldownHref={localizedPath(lang, '/admin/billing')}
        drilldownLabel="Billing detail"
        stats={[
          {
            key: 'paid',
            label: 'Paid orders',
            value: paidOrders.length,
            detail: `${revenue.page.total} total rows`,
            tone: 'success',
          },
          {
            key: 'refunded',
            label: 'Refunded',
            value: refundedOrders.length,
            detail: 'watch revenue leakage',
            tone: refundedOrders.length > 0 ? 'warning' : 'neutral',
          },
          {
            key: 'failed',
            label: 'Failed',
            value: failedOrders.length,
            detail: failedOrders.length > 0 ? 'needs review' : 'clear',
            tone: failedOrders.length > 0 ? 'danger' : 'success',
          },
        ]}
        empty={adminInlineText(lang, 'No revenue orders in this window.')}
      />
      <AdminPanel
        title={adminInlineText(lang, 'Order ledger')}
        description={adminInlineText(
          lang,
          'Filter revenue records by order, SKU, user, or payment status.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索订单、SKU、用户或状态"
          filterValue={tableQuery.status}
          filterOptions={[
            { value: 'paid', label: 'Paid' },
            { value: 'pending', label: 'Pending' },
            { value: 'failed', label: 'Failed' },
            { value: 'refunded', label: 'Refunded' },
          ]}
          resetHref={localizedPath(lang, '/admin/revenue')}
        />
        <DataTable
          title={adminInlineText(lang, 'Daily buckets')}
          description={adminInlineText(lang, 'Revenue grouped by order created date and currency.')}
          className="rounded-none border-x-0 shadow-none"
          columns={adminInlineColumns(lang, ['Date', 'Paid Amount', 'Paid', 'Refunded', 'Failed'])}
          rows={dailyBuckets.map((bucket) => [
            bucket.day,
            Object.entries(bucket.currencies)
              .map(([currency, amount]) => `${amount} ${currency}`)
              .join(', ') || '0',
            String(bucket.paid),
            String(bucket.refunded),
            String(bucket.failed),
          ])}
          empty={adminInlineText(lang, 'No daily revenue buckets in this window.')}
        />
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, ['Order', 'SKU', 'User', 'Amount', 'Status', 'Links'])}
          rows={revenue.items.map((order) => [
            <span key={`${order.id}:order`} className="font-mono text-xs">
              {order.id}
            </span>,
            order.sku,
            <Link
              key={`${order.id}:user`}
              href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(order.userId)}`)}
              className="font-medium text-admin-primary hover:underline"
            >
              {order.userId}
            </Link>,
            `${order.amount} ${order.currency}`,
            <StatusBadge key={order.id} lang={lang} value={order.status} />,
            <div key={`${order.id}:links`} className="flex flex-wrap items-center gap-2">
              {orderContextLinks(lang, order).map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-bg px-2.5 py-1 text-[11px] font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {link.label}
                </Link>
              ))}
            </div>,
          ])}
        />
        <div className="grid gap-1 px-2 py-2 xl:hidden">
          {revenue.items.map((order) => (
            <EntityListItem
              key={order.id}
              href={localizedPath(lang, `/admin/revenue?q=${encodeURIComponent(order.id)}`)}
              title={order.sku}
              subtitle={order.userId}
              status={order.status}
              detail={`${order.amount} ${order.currency}`}
              meta={order.id}
              icon={ReceiptText}
              density="compact"
              tone={
                order.status === 'failed'
                  ? 'danger'
                  : order.status === 'refunded'
                    ? 'warning'
                    : 'primary'
              }
            />
          ))}
        </div>
      </AdminPanel>
      <AdminPanel
        title={adminInlineText(lang, 'Commercial evidence')}
        description={adminInlineText(
          lang,
          'Pricing package details and provider events stay available for audit without taking over the revenue workflow.'
        )}
        contentClassName="grid gap-3"
      >
        <EvidenceSection
          title={adminInlineText(lang, 'SKU catalog')}
          description={adminInlineText(
            lang,
            'Pricing packages shown as business objects, not raw config.'
          )}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['SKU', 'Plan', 'Amount', 'Credits'])}
            rows={revenue.catalog.skus.map((sku) => [
              sku.name,
              sku.planId,
              `${sku.amount} ${sku.currency}`,
              `${sku.credits} ${sku.creditUnit}`,
            ])}
            minWidthClass="min-w-[720px]"
          />
        </EvidenceSection>
        <EvidenceSection
          title={adminInlineText(lang, 'Provider events')}
          description={adminInlineText(
            lang,
            'Payment provider and reconcile evidence grouped as a timeline.'
          )}
        >
          <TimelineList
            lang={lang}
            items={revenue.providerEvents.map((record) => ({
              key: record.id,
              title: record.type,
              description: compactJson(record.metadata, 180),
              meta: record.actorId ?? 'system',
              tone: record.type.includes('failed')
                ? 'danger'
                : record.type.includes('reconcile')
                  ? 'warning'
                  : 'primary',
            }))}
            empty={adminInlineText(lang, 'No provider or reconcile events yet.')}
          />
        </EvidenceSection>
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function AdminEntitlementsOperationsPage({
  lang,
  entitlements,
  commercial,
  grantEntitlementAction,
  overrideEntitlementAction,
  revokeEntitlementAction,
  query,
}: {
  lang: SupportedLanguage;
  entitlements: AdminPagedResult<RuntimeStoreEntitlementGrant> & {
    statusCounts: Record<RuntimeStoreEntitlementStatus, number>;
  };
  commercial?: AdminCommercialView;
  grantEntitlementAction?: AdminFormAction;
  overrideEntitlementAction?: AdminFormAction;
  revokeEntitlementAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminEntitlementsCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const statusCounts = entitlements.statusCounts;
  const activeGrants = statusCounts.active;
  const revokedGrants = statusCounts.revoked;
  const expiredGrants = statusCounts.expired;
  const grantContextById = commercial
    ? new Map(
        entitlements.items.map((grant) => {
          const grantOrderId = metadataOrderId(grant);
          const grantSku = commercial.catalog.skus.find(
            (sku) => sku.planId === grant.planId && sku.entitlements.includes(grant.entitlement)
          );
          const grantOrder = grantOrderId
            ? commercial.orders.find((order) => order.id === grantOrderId)
            : commercial.orders.find(
                (order) => order.userId === grant.userId && order.sku === grantSku?.id
              );
          const grantSubscription = grant.planId
            ? commercial.subscriptions.find(
                (subscription) =>
                  subscription.userId === grant.userId && subscription.planId === grant.planId
              )
            : undefined;
          return [
            grant.id,
            {
              grantOrder,
              grantSubscription,
              grantOrderId,
            },
          ] as const;
        })
      )
    : new Map<
        string,
        {
          grantOrder?: RuntimeStoreCommercialOrder;
          grantSubscription?: { id: string; userId: string; planId: string; status: string };
          grantOrderId?: string;
        }
      >();
  const mismatchGrants = commercial
    ? entitlements.items.filter((grant) => {
        const context = grantContextById.get(grant.id);
        if (!context) {
          return false;
        }
        if (
          grant.source === 'order' &&
          (!context.grantOrder || context.grantOrder.status !== 'paid')
        ) {
          return true;
        }
        if (grant.source !== 'order' && grant.planId && !context.grantSubscription) {
          return true;
        }
        return false;
      })
    : [];
  const focusGrant =
    mismatchGrants[0] ??
    entitlements.items.find((grant) => grant.status !== 'active') ??
    entitlements.items[0] ??
    null;
  const focusGrantContext = focusGrant ? grantContextById.get(focusGrant.id) : undefined;
  const totalPages = Math.max(1, Math.ceil(entitlements.page.total / entitlements.page.limit));
  const currentPage = Math.min(
    Math.max(Math.floor(entitlements.page.offset / entitlements.page.limit) + 1, 1),
    totalPages
  );
  const entitlementReviewItems = [
    revokedGrants > 0
      ? {
          key: 'revoked-grants',
          title: adminInlineText(lang, 'Revoked entitlements'),
          description: adminInlineText(
            lang,
            'value_grants_are_revoked_verify_whether_matching_sub_8bd63058',
            { value1: revokedGrants }
          ),
          actionLabel: adminInlineText(lang, 'Filter revoked'),
          href: localizedPath(lang, '/admin/entitlements?status=revoked'),
          status: 'revoked',
          tone: 'warning' as const,
        }
      : null,
    expiredGrants > 0
      ? {
          key: 'expired-grants',
          title: adminInlineText(lang, 'Expired entitlements'),
          description: adminInlineText(
            lang,
            'value_grants_have_expired_confirm_renewal_grace_peri_c5e9044c',
            { value1: expiredGrants }
          ),
          actionLabel: adminInlineText(lang, 'Filter expired'),
          href: localizedPath(lang, '/admin/entitlements?status=expired'),
          status: 'expired',
          tone: 'warning' as const,
        }
      : null,
    mismatchGrants.length > 0
      ? {
          key: 'mismatch-grants',
          title: adminInlineText(lang, 'Entitlement mismatch'),
          description: `${mismatchGrants.length} grants have incomplete order or subscription evidence and should be reviewed before granting access.`,
          actionLabel: adminInlineText(lang, 'Review mismatch'),
          href: localizedPath(lang, '/admin/entitlements'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Grants')}
          value={String(entitlements.page.total)}
          helper={adminInlineText(lang, 'value_loaded_0827bcbc', {
            value1: entitlements.items.length,
          })}
          icon={BadgeDollarSign}
        />
        <StatCard
          label={adminInlineText(lang, 'Active')}
          value={String(activeGrants)}
          helper={adminInlineText(lang, 'Currently effective')}
          tone="green"
          icon={PackageCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Revoked')}
          value={String(revokedGrants)}
          helper={adminInlineText(lang, 'Manual or billing removal')}
          tone={revokedGrants > 0 ? 'amber' : 'neutral'}
          icon={CreditCard}
        />
        <StatCard
          label={adminInlineText(lang, 'Expired')}
          value={String(expiredGrants)}
          helper={adminInlineText(lang, 'Grace or renewal review')}
          tone={expiredGrants > 0 ? 'amber' : 'neutral'}
          icon={ReceiptText}
        />
      </StatGrid>
      {entitlementReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Access review')}
          description={adminInlineText(
            lang,
            'Revoked and expired grants are promoted before the full entitlement ledger.'
          )}
          status="warning"
          items={entitlementReviewItems}
        />
      ) : null}
      {grantEntitlementAction ? (
        <ActionPanel
          title={adminInlineText(lang, 'Manual grant')}
          description={adminInlineText(
            lang,
            'Manual access changes require explicit user, entitlement, plan, and confirmation; no demo defaults are prefilled.'
          )}
          tone="warning"
        >
          <form
            action={grantEntitlementAction}
            className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
          >
            <FormField label={adminInlineText(lang, 'User ID')} htmlFor="grant-user-id">
              <Input
                id="grant-user-id"
                name="userId"
                placeholder={adminInlineText(lang, 'user id')}
                required
              />
            </FormField>
            <FormField label={adminInlineText(lang, 'Entitlement')} htmlFor="grant-entitlement">
              <Input
                id="grant-entitlement"
                name="entitlement"
                placeholder={adminInlineText(lang, 'public-tools.pro')}
                required
              />
            </FormField>
            <FormField label={adminInlineText(lang, 'Plan')} htmlFor="grant-plan">
              <Input id="grant-plan" name="planId" placeholder={adminInlineText(lang, 'plan id')} />
            </FormField>
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              confirmation={adminInlineText(lang, '确认手动授予该 entitlement？')}
            >
              {adminInlineText(lang, 'Grant')}
            </ConfirmSubmitButton>
          </form>
        </ActionPanel>
      ) : null}
      {focusGrant ? (
        <DetailDrawer
          open
          title={adminInlineText(lang, 'Entitlement detail')}
          description={`${focusGrant.entitlement} · ${focusGrant.userId}`}
          className="mb-5"
          actions={[
            <Link
              key="user"
              href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(focusGrant.userId)}`)}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'User')}
            </Link>,
            <Link
              key="revenue"
              href={localizedPath(
                lang,
                `/admin/revenue?q=${encodeURIComponent(focusGrant.userId)}`
              )}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Revenue')}
            </Link>,
            <Link
              key="audit"
              href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(focusGrant.id)}`)}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Audit')}
            </Link>,
          ]}
        >
          <FactList
            lang={lang}
            density="compact"
            items={[
              {
                label: 'Entitlement',
                value: focusGrant.entitlement,
                copyValue: focusGrant.entitlement,
              },
              { label: 'User', value: focusGrant.userId, copyValue: focusGrant.userId, mono: true },
              { label: 'Plan', value: focusGrant.planId ?? 'none' },
              { label: 'Source', value: focusGrant.source },
              {
                label: 'Order',
                value:
                  focusGrantContext?.grantOrder?.id ?? focusGrantContext?.grantOrderId ?? 'none',
                mono: true,
              },
              {
                label: 'Subscription',
                value: focusGrantContext?.grantSubscription
                  ? `${focusGrantContext.grantSubscription.planId} · ${focusGrantContext.grantSubscription.status}`
                  : 'none',
              },
              { label: 'Expires', value: focusGrant.expiresAt ?? 'none' },
              { label: 'Status', value: focusGrant.status },
            ]}
          />
        </DetailDrawer>
      ) : null}
      <AdminPanel
        title={adminInlineText(lang, 'Entitlement ledger')}
        description={adminInlineText(
          lang,
          'Filter grants by user, entitlement, plan, source, or status.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索用户、权益、套餐或状态"
          filterValue={tableQuery.status}
          filterOptions={[
            { value: 'active', label: 'Active' },
            { value: 'revoked', label: 'Revoked' },
            { value: 'expired', label: 'Expired' },
          ]}
          resetHref={localizedPath(lang, '/admin/entitlements')}
        />
        <DataTable
          className="hidden xl:block rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'Entitlement',
            'User',
            'Plan / Context',
            'Expires',
            'Source',
            'Status',
            'Override',
            'Action',
          ])}
          rows={entitlements.items.map((grant) => {
            const context = grantContextById.get(grant.id);
            return [
              grant.entitlement,
              <Link
                key={`${grant.id}:user`}
                href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(grant.userId)}`)}
                className="font-medium text-admin-primary hover:underline"
              >
                {grant.userId}
              </Link>,
              <span
                key={`${grant.id}:context`}
                className="block text-xs leading-5 text-admin-text-muted"
              >
                {grant.planId ?? 'none'}
                {context?.grantOrder?.id
                  ? ` · order ${context.grantOrder.id}`
                  : context?.grantOrderId
                    ? ` · order ${context.grantOrderId}`
                    : ''}
                {context?.grantSubscription
                  ? ` · sub ${context.grantSubscription.planId} ${context.grantSubscription.status}`
                  : ''}
              </span>,
              grant.expiresAt ?? 'none',
              <span
                key={`${grant.id}:source`}
                className="block text-xs leading-5 text-admin-text-muted"
              >
                {grant.source}
                {grant.source === 'order' && context?.grantOrder?.status
                  ? ` · ${context.grantOrder.status}`
                  : ''}
              </span>,
              <StatusBadge key={`${grant.id}:status`} lang={lang} value={grant.status} />,
              overrideEntitlementAction ? (
                <form
                  key={`override-${grant.id}`}
                  action={overrideEntitlementAction}
                  className="inline-flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="entitlementId" value={grant.id} />
                  <Select
                    name="status"
                    aria-label={adminInlineText(lang, 'override_value_status_0da851a6', {
                      value1: grant.entitlement,
                    })}
                    defaultValue={grant.status}
                  >
                    <option value="active">{adminInlineText(lang, 'Active')}</option>
                    <option value="expired">{adminInlineText(lang, 'Expired')}</option>
                    <option value="revoked">{adminInlineText(lang, 'Revoked')}</option>
                  </Select>
                  <Input
                    name="reason"
                    placeholder={adminInlineText(lang, 'reason')}
                    aria-label={adminInlineText(lang, 'override_value_reason_bed3b42a', {
                      value1: grant.entitlement,
                    })}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(lang, 'override_value_s_value_status_a76f8235', {
                      value1: grant.userId,
                      value2: grant.entitlement,
                    })}
                  >
                    {adminInlineText(lang, 'Override')}
                  </ConfirmSubmitButton>
                </form>
              ) : (
                adminInlineText(lang, 'none')
              ),
              revokeEntitlementAction && grant.status === 'active' ? (
                <form
                  key={`revoke-${grant.id}`}
                  action={revokeEntitlementAction}
                  className="inline-flex"
                >
                  <input type="hidden" name="entitlementId" value={grant.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={adminInlineText(lang, 'revoke_value_s_value_3da7b9d1', {
                      value1: grant.userId,
                      value2: grant.entitlement,
                    })}
                  >
                    {adminInlineText(lang, 'Revoke')}
                  </ConfirmSubmitButton>
                </form>
              ) : (
                adminInlineText(lang, 'none')
              ),
            ];
          })}
        />
        <div className="grid gap-1 xl:hidden">
          {entitlements.items.map((grant) => {
            const context = grantContextById.get(grant.id);
            return (
              <EntityListItem
                key={grant.id}
                href={localizedPath(
                  lang,
                  `/admin/entitlements?q=${encodeURIComponent(grant.userId)}`
                )}
                title={grant.entitlement}
                subtitle={grant.userId}
                status={grant.status}
                detail={[
                  grant.planId ?? 'none',
                  context?.grantOrder?.id
                    ? `order ${context.grantOrder.id}`
                    : context?.grantOrderId
                      ? `order ${context.grantOrderId}`
                      : null,
                  context?.grantSubscription
                    ? `sub ${context.grantSubscription.planId} ${context.grantSubscription.status}`
                    : null,
                  grant.source,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                meta={grant.id}
                icon={BadgeDollarSign}
                density="compact"
                tone={grant.status === 'active' ? 'primary' : 'warning'}
              />
            );
          })}
        </div>
      </AdminPanel>
      {totalPages > 1 ? (
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          previousHref={
            currentPage > 1
              ? adminListHref(
                  lang,
                  '/admin/entitlements',
                  { ...tableQuery, pageSize: entitlements.page.limit },
                  currentPage - 1
                )
              : undefined
          }
          nextHref={
            currentPage < totalPages
              ? adminListHref(
                  lang,
                  '/admin/entitlements',
                  { ...tableQuery, pageSize: entitlements.page.limit },
                  currentPage + 1
                )
              : undefined
          }
        />
      ) : null}
    </WorkspaceShell>
  );
}
