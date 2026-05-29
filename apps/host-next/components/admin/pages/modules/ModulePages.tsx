import Link from 'next/link';
import type { ReactNode } from 'react';
import { Box, CircleCheck, FileCode2, PackageCheck, ShieldAlert } from 'lucide-react';
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
  ActionQueue,
  AdminPanel,
  CodeBlockPanel,
  EntityListItem,
  EvidenceSection,
  FactList,
  FilterBar,
  HealthRowList,
  MoreActionMenu,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminModuleDetailCopy, getAdminModulesCopy } from '@host/lib/admin-copy';
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

type AdminModuleListItem = AdminOperationsViewSnapshot['modules'][number];

const moduleProductAreaDetails: Record<string, string> = {
  Commerce: 'Billing, checkout, entitlement, SKU, order, and revenue-facing product capability.',
  'Public site':
    'Public routes, marketing/content pages, SEO aliases, and unauthenticated product surfaces.',
  'AI workspace': 'AI, RAG, indexing, retrieval, and assistant-facing workflow capability.',
  Automation: 'Background jobs, webhooks, events, queues, and integration workflow capability.',
  'Data operations':
    'Structured data tables, documents, CRUD surfaces, and operator data workflows.',
  'Back office': 'Admin or dashboard pages that extend the product operations console.',
  Platform: 'General host extension or foundation capability.',
};

function getModuleProductArea(module: AdminModuleListItem) {
  const id = module.id.toLowerCase();
  if (id.includes('billing') || id.includes('shop') || id.includes('commerce')) {
    return 'Commerce';
  }
  if (id.includes('cms') || id.includes('site') || module.capabilities.siteRoutes > 0) {
    return 'Public site';
  }
  if (id.includes('ai') || id.includes('rag')) {
    return 'AI workspace';
  }
  if (module.capabilities.jobs > 0 || module.capabilities.webhooks > 0) {
    return 'Automation';
  }
  if (module.capabilities.dataTables > 0 || module.capabilities.dataDocuments > 0) {
    return 'Data operations';
  }
  if (module.capabilities.adminRoutes > 0 || module.capabilities.dashboardRoutes > 0) {
    return 'Back office';
  }
  return 'Platform';
}

function getModuleCategory(module: AdminModuleListItem) {
  if (module.required) {
    return 'Required foundation';
  }
  if (
    module.runtimeState === 'blocked' ||
    module.runtimeState === 'error' ||
    module.health.errors > 0
  ) {
    return 'Needs operator review';
  }
  if (module.status === 'enabled') {
    return 'Enabled product module';
  }
  if (!module.installed) {
    return 'Available catalog item';
  }
  return 'Installed module';
}

function getModuleCapabilityPhrases(module: AdminModuleListItem) {
  const phrases = [
    module.capabilities.siteRoutes > 0
      ? `Public site surface x ${module.capabilities.siteRoutes}`
      : null,
    module.capabilities.dashboardRoutes > 0
      ? `Workspace dashboard route x ${module.capabilities.dashboardRoutes}`
      : null,
    module.capabilities.adminRoutes > 0
      ? `Admin operations route x ${module.capabilities.adminRoutes}`
      : null,
    module.capabilities.apiRoutes > 0
      ? `Module API endpoint x ${module.capabilities.apiRoutes}`
      : null,
    module.capabilities.actions > 0 ? `Operator action x ${module.capabilities.actions}` : null,
    module.capabilities.jobs > 0 ? `Background workflow x ${module.capabilities.jobs}` : null,
    module.capabilities.events > 0 ? `Event integration x ${module.capabilities.events}` : null,
    module.capabilities.webhooks > 0
      ? `Webhook entrypoint x ${module.capabilities.webhooks}`
      : null,
    module.capabilities.dataTables > 0 || module.capabilities.dataDocuments > 0
      ? `Data model x ${module.capabilities.dataTables + module.capabilities.dataDocuments}`
      : null,
    module.permissions.length > 0 ? `Permission boundary x ${module.permissions.length}` : null,
  ].filter((item): item is string => Boolean(item));
  return phrases.length > 0 ? phrases : ['Metadata-only extension'];
}

function getModuleReleaseImpact(lang: SupportedLanguage, module: AdminModuleListItem) {
  if (
    module.runtimeState === 'blocked' ||
    module.runtimeState === 'error' ||
    module.health.errors > 0
  ) {
    return {
      label: adminInlineText(lang, 'blocks_release_57547c33'),
      detail: adminInlineText(
        lang,
        'fix_lifecycle_resource_binding_or_doctor_errors_befo_b7176e93'
      ),
      status: 'blocked',
      tone: 'danger' as const,
    };
  }
  if (module.health.warnings > 0) {
    return {
      label: adminInlineText(lang, 'needs_review_e7a3a9f7'),
      detail: adminInlineText(
        lang,
        'warnings_should_be_resolved_or_accepted_before_produ_da84cf4e'
      ),
      status: 'review',
      tone: 'warning' as const,
    };
  }
  if (module.required) {
    return {
      label: adminInlineText(lang, 'foundation_9a1d6e6c'),
      detail: adminInlineText(
        lang,
        'required_module_treat_lifecycle_changes_as_product_i_15c2b333'
      ),
      status: 'guarded',
      tone: 'info' as const,
    };
  }
  if (module.status === 'enabled') {
    return {
      label: adminInlineText(lang, 'no_blocking_evidence_c879beea'),
      detail: adminInlineText(
        lang,
        'enabled_and_clear_in_current_runtime_health_evidence_8a3f05b2'
      ),
      status: 'ready',
      tone: 'success' as const,
    };
  }
  return {
    label: adminInlineText(lang, 'not_in_release_path_c82db65f'),
    detail: adminInlineText(lang, 'install_or_enable_only_when_this_product_area_is_nee_07e0154a'),
    status: 'optional',
    tone: 'neutral' as const,
  };
}

function getModuleOperatorNextAction(lang: SupportedLanguage, module: AdminModuleListItem) {
  if (!module.installed || module.status === 'not_installed') {
    return adminInlineText(lang, 'install_before_using_contributed_pages_or_apis_d688f7ad');
  }
  if (module.runtimeState === 'blocked') {
    return adminInlineText(lang, 'review_missing_resources_and_lifecycle_state_f7287c70');
  }
  if (module.runtimeState === 'error' || module.health.errors > 0) {
    return adminInlineText(lang, 'open_diagnostics_and_fix_doctor_errors_2c0e0899');
  }
  if (module.health.warnings > 0) {
    return adminInlineText(lang, 'review_warnings_before_rc_evidence_b91e8fcb');
  }
  if (module.status === 'enabled') {
    return adminInlineText(lang, 'monitor_runtime_activity_and_release_impact_b7c0f12c');
  }
  if (module.status === 'maintenance') {
    return adminInlineText(lang, 'keep_traffic_paused_until_maintenance_evidence_is_cl_5a01f8e7');
  }
  return adminInlineText(lang, 'enable_when_this_product_capability_is_ready_92ed0027');
}

export function AdminModulesOperationsPage({
  lang,
  snapshot,
  updateModuleStatusAction,
  query,
  headerActions,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsViewSnapshot;
  updateModuleStatusAction: AdminFormAction;
  query?: AdminTableQuery;
  headerActions?: ReactNode;
}) {
  const copy = getAdminModulesCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const modules = snapshot.modules.filter((module) => {
    const searchable = [
      module.id,
      module.name,
      module.version,
      module.status,
      module.runtimeState,
      module.health.status,
      module.permissions.join(' '),
    ];
    return (
      matchesTextSearch(tableQuery.q, searchable) &&
      (matchesExactFilter(tableQuery.status, module.status) ||
        matchesExactFilter(tableQuery.status, module.runtimeState) ||
        matchesExactFilter(tableQuery.status, module.health.status))
    );
  });
  const enabledModules = snapshot.modules.filter((module) => module.status === 'enabled').length;
  const blockedModules = snapshot.modules.filter(
    (module) => module.runtimeState === 'blocked'
  ).length;
  const modulesWithErrors = snapshot.modules.filter(
    (module) => module.runtimeState === 'error' || module.health.errors > 0
  ).length;
  const installedModules = snapshot.modules.filter((module) => module.installed).length;
  const needsReviewModules = modules.filter(
    (module) =>
      module.runtimeState === 'blocked' ||
      module.runtimeState === 'error' ||
      module.health.errors > 0 ||
      module.health.warnings > 0
  ).length;
  const requiredModules = modules.filter((module) => module.required).length;
  const activeModules = modules.filter(
    (module) => module.activity.runs > 0 || module.activity.outbox > 0
  ).length;
  const mapIssueCount = snapshot.moduleMapHealth.issues.length;
  const hostSnapshot = snapshot.hostSnapshot;
  const productAreas = modules.reduce<Array<{ area: string; modules: AdminModuleListItem[] }>>(
    (acc, module) => {
      const area = getModuleProductArea(module);
      const existing = acc.find((item) => item.area === area);
      if (existing) {
        existing.modules.push(module);
      } else {
        acc.push({ area, modules: [module] });
      }
      return acc;
    },
    []
  );
  const pageSize = tableQuery.pageSize === 20 ? 8 : tableQuery.pageSize;
  const totalPages = Math.max(1, Math.ceil(modules.length / pageSize));
  const page = Math.min(Math.max(tableQuery.page, 1), totalPages);
  const pageStart = (page - 1) * pageSize;
  const visibleModules = modules.slice(pageStart, pageStart + pageSize);
  const modulePageQuery = { ...tableQuery, pageSize };
  const reviewItems = [
    blockedModules > 0
      ? {
          key: 'blocked-modules',
          title: 'Blocked module runtime',
          description: `${blockedModules} modules are blocked at runtime. Review lifecycle state, required resources, and diagnostics before enabling traffic.`,
          actionLabel: 'Review blocked',
          href: localizedPath(lang, '/admin/modules?status=blocked'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
    modulesWithErrors > 0
      ? {
          key: 'module-errors',
          title: 'Module health errors',
          description: `${modulesWithErrors} modules report runtime errors or doctor failures. Inspect module detail before release candidate checks.`,
          actionLabel: 'Review errors',
          href: localizedPath(lang, '/admin/modules?status=error'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    mapIssueCount > 0
      ? {
          key: 'module-map-drift',
          title: 'Module map drift',
          description: `${mapIssueCount} map/contract consistency issue(s) were found. Regenerate the module map before relying on release evidence.`,
          actionLabel: 'Open dev console',
          href: localizedPath(lang, '/admin/module-dev-console'),
          status: 'drift',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

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
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Installed')}
          value={`${installedModules}/${snapshot.modules.length}`}
          helper={adminInlineText(lang, 'Catalog states persisted')}
          tone="blue"
          icon={PackageCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Enabled')}
          value={String(enabledModules)}
          helper={adminInlineText(lang, 'Available to product surfaces')}
          tone="green"
          icon={CircleCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Blocked')}
          value={String(blockedModules)}
          helper={adminInlineText(lang, 'Runtime prevents execution')}
          tone={blockedModules > 0 ? 'amber' : 'neutral'}
          icon={ShieldAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Health Errors')}
          value={String(modulesWithErrors)}
          helper={adminInlineText(lang, 'Doctor or runtime failures')}
          tone={modulesWithErrors > 0 ? 'red' : 'neutral'}
          icon={Box}
        />
        <StatCard
          label={adminInlineText(lang, 'Map Health')}
          value={snapshot.moduleMapHealth.ok ? 'clean' : String(mapIssueCount)}
          helper={`Build ${snapshot.moduleMapHealth.buildId ?? 'local'}`}
          tone={snapshot.moduleMapHealth.ok ? 'green' : 'amber'}
          icon={FileCode2}
        />
      </StatGrid>

      {reviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Module review')}
          description={adminInlineText(
            lang,
            'Only lifecycle and health states that need action appear here. Capability evidence stays in module detail.'
          )}
          status="warning"
          items={reviewItems}
        />
      ) : null}

      <AdminPanel
        title={adminInlineText(lang, 'Inventory lanes')}
        description={adminInlineText(
          lang,
          'Module inventory is grouped by product impact before the full capability table.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'installed',
              title: 'Installed catalog',
              detail: 'Modules with persisted catalog state and discoverable contracts.',
              meta: `${installedModules}/${snapshot.modules.length}`,
              status: installedModules === snapshot.modules.length ? 'complete' : 'partial',
              statusTone: installedModules === snapshot.modules.length ? 'success' : 'warning',
              tone: installedModules === snapshot.modules.length ? 'success' : 'warning',
            },
            {
              key: 'enabled',
              title: 'Enabled surfaces',
              detail: 'Modules currently available to product, dashboard, admin, or API surfaces.',
              meta: `${enabledModules} enabled`,
              status: enabledModules > 0 ? 'active' : 'idle',
              statusTone: enabledModules > 0 ? 'success' : 'neutral',
              tone: enabledModules > 0 ? 'success' : 'neutral',
            },
            {
              key: 'review',
              title: 'Needs review',
              detail: 'Blocked, error, warning, or failed runtime evidence.',
              meta: `${needsReviewModules} modules`,
              status: needsReviewModules > 0 ? 'review' : 'clear',
              statusTone: needsReviewModules > 0 ? 'warning' : 'success',
              tone: needsReviewModules > 0 ? 'warning' : 'success',
              href:
                needsReviewModules > 0
                  ? localizedPath(lang, '/admin/modules?status=blocked')
                  : undefined,
            },
            {
              key: 'required',
              title: 'Required modules',
              detail: 'Core product modules that should not be disabled without replacement.',
              meta: `${requiredModules} required`,
              status: requiredModules > 0 ? 'guarded' : 'none',
              statusTone: requiredModules > 0 ? 'info' : 'neutral',
              tone: 'info',
            },
            {
              key: 'activity',
              title: 'Runtime activity',
              detail: 'Modules with recent runs, outbox, webhook, usage, or file activity.',
              meta: `${activeModules} active`,
              status: activeModules > 0 ? 'active' : 'quiet',
              statusTone: activeModules > 0 ? 'info' : 'neutral',
              tone: activeModules > 0 ? 'info' : 'neutral',
            },
          ]}
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Runtime host snapshot')}
        description={adminInlineText(
          lang,
          'Mounted capabilities, provider profile, route resolution, and module-map release evidence are captured from the same runtime host.'
        )}
      >
        <DataTable
          className="shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, ['Snapshot', 'Value', 'Evidence'])}
          rows={[
            [
              'Mounted capabilities',
              `${hostSnapshot.mountedCapabilities.modules} modules / ${hostSnapshot.mountedCapabilities.routes} routes / ${hostSnapshot.mountedCapabilities.actions} actions`,
              `${hostSnapshot.mountedCapabilities.surfaces} surfaces / ${hostSnapshot.mountedCapabilities.dataModels} data models`,
            ],
            [
              'Provider profile',
              `${hostSnapshot.providerProfile.services.length} services / ${hostSnapshot.providerProfile.resourceBindings.length} resources`,
              hostSnapshot.providerProfile.egressOrigins.length > 0
                ? hostSnapshot.providerProfile.egressOrigins.join(', ')
                : 'no external egress',
            ],
            [
              'Product scope',
              hostSnapshot.productScope?.productId ?? 'unknown',
              `${hostSnapshot.productScope?.workspaceId ?? 'no workspace'} / ${hostSnapshot.productScope?.profile ?? 'default'}`,
            ],
            [
              'Module map',
              snapshot.moduleMapHealth.ok ? 'clean' : `${mapIssueCount} issue(s)`,
              `${hostSnapshot.moduleMapHealth.entriesWithReleaseMetadata}/${hostSnapshot.moduleMapHealth.modules} entries with release metadata`,
            ],
          ]}
          minWidthClass="min-w-[780px]"
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Product area map')}
        description={adminInlineText(
          lang,
          'Modules are grouped by the product area they shape before raw catalog rows.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={productAreas.map(({ area, modules: areaModules }) => {
            const reviewCount = areaModules.filter(
              (module) =>
                module.runtimeState === 'blocked' ||
                module.runtimeState === 'error' ||
                module.health.errors > 0 ||
                module.health.warnings > 0
            ).length;
            const enabledCount = areaModules.filter((module) => module.status === 'enabled').length;
            return {
              key: area,
              title: area,
              detail: `${adminInlineText(lang, moduleProductAreaDetails[area] ?? moduleProductAreaDetails.Platform)} ${areaModules
                .map((module) => module.name)
                .slice(0, 3)
                .join(', ')}`,
              meta: `${enabledCount}/${areaModules.length} enabled`,
              status: reviewCount > 0 ? 'review' : 'clear',
              statusTone: reviewCount > 0 ? ('warning' as const) : ('success' as const),
              tone: reviewCount > 0 ? ('warning' as const) : ('success' as const),
              href: areaModules[0]
                ? localizedPath(lang, `/admin/modules?q=${encodeURIComponent(areaModules[0].id)}`)
                : undefined,
            };
          })}
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Module catalog')}
        description={adminInlineText(
          lang,
          'Installed modules are product capabilities. Detail pages contain contracts, routes, permissions, resources, and diagnostics.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索模块名称、ID、版本、状态或权限"
          filterValue={tableQuery.status}
          filterOptions={moduleStatusOptions}
          resetHref={localizedPath(lang, '/admin/modules')}
        />
        <div className="px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterResultHint
              lang={lang}
              visible={modules.length}
              total={snapshot.modules.length}
            />
            <span className="text-xs text-admin-text-muted">
              {adminInlineText(lang, 'showing_value_value_of_value_3d583a43', {
                value1: modules.length === 0 ? 0 : pageStart + 1,
                value2: Math.min(pageStart + pageSize, modules.length),
                value3: modules.length,
              })}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
            {[
              ['Needs review', needsReviewModules],
              ['Required', requiredModules],
              ['With activity', activeModules],
              ['Visible', modules.length],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2"
              >
                <span className="text-[11px] font-semibold uppercase text-admin-text-subtle">
                  {adminInlineText(lang, String(label))}
                </span>
                <strong className="mt-1 block text-sm text-admin-text">{value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden xl:block">
          <DataTable
            className="rounded-none border-x-0 border-b-0 shadow-none"
            density="compact"
            columns={adminInlineColumns(lang, [
              'Module',
              'Product Area',
              'Lifecycle',
              'Health',
              'Capabilities',
              'Activity',
              'Action',
            ])}
            rows={visibleModules.map((module) => {
              const nextStatus = module.status === 'enabled' ? 'disabled' : 'enabled';
              const actionLabel =
                module.status === 'not_installed'
                  ? 'Install'
                  : nextStatus === 'enabled'
                    ? 'Enable'
                    : 'Disable';
              const statusActionBlocked = module.required && nextStatus !== 'enabled';
              const impact = [
                `${module.capabilities.routes} routes`,
                `${module.capabilities.actions} actions`,
                `${module.capabilities.jobs} jobs`,
                `${module.capabilities.webhooks} webhooks`,
                `${module.capabilities.dataTables + module.capabilities.dataDocuments} data objects`,
              ].join(', ');
              const failures =
                module.activity.failedRuns +
                module.activity.failedOutbox +
                module.activity.failedWebhookReceipts;
              const capabilityPhrases = getModuleCapabilityPhrases(module);
              const releaseImpact = getModuleReleaseImpact(lang, module);
              return [
                <div key={`${module.id}:module`} className="min-w-0">
                  <Link
                    href={localizedPath(lang, `/admin/modules/${module.id}`)}
                    className="block truncate font-semibold text-admin-primary hover:underline"
                  >
                    {module.name}
                  </Link>
                  <div className="mt-1 truncate text-xs text-admin-text-muted">
                    {module.id} · v{module.version}
                    {module.required ? ' · required' : ''}
                  </div>
                </div>,
                <div key={`${module.id}:area`} className="grid gap-1">
                  <span className="text-sm font-semibold text-admin-text">
                    {getModuleProductArea(module)}
                  </span>
                  <span className="text-xs text-admin-text-muted">{getModuleCategory(module)}</span>
                </div>,
                <div key={`${module.id}:lifecycle`} className="grid gap-1">
                  <StatusBadge lang={lang} value={module.status} />
                  <span className="text-xs text-admin-text-muted">
                    {adminInlineText(lang, module.installed ? 'persisted' : 'not installed')}
                  </span>
                </div>,
                <div key={`${module.id}:health`} className="grid gap-1">
                  <StatusBadge lang={lang} value={module.runtimeState} />
                  <span className="text-xs text-admin-text-muted">
                    {adminInlineText(lang, 'value_errors_value_warnings_52368790', {
                      value1: module.health.errors,
                      value2: module.health.warnings,
                    })}
                  </span>
                </div>,
                <div key={`${module.id}:capabilities`} className="text-sm text-admin-text">
                  {capabilityPhrases.slice(0, 2).join(' · ')}
                  <div className="mt-1 text-xs leading-5 text-admin-text-muted">
                    {capabilityPhrases.slice(2, 5).join(' · ') ||
                      getModuleOperatorNextAction(lang, module)}
                  </div>
                </div>,
                <div key={`${module.id}:activity`} className="text-sm text-admin-text">
                  <StatusBadge
                    lang={lang}
                    value={releaseImpact.status}
                    label={releaseImpact.label}
                    tone={releaseImpact.tone}
                  />
                  <div className="mt-1 text-xs text-admin-text-muted">
                    {adminInlineText(lang, 'value_failures_value_99e0a2ec', {
                      value1: failures,
                      value2: getModuleOperatorNextAction(lang, module),
                    })}
                  </div>
                </div>,
                <div key={`${module.id}:actions`} className="flex flex-wrap items-center gap-2">
                  {statusActionBlocked ? (
                    <StatusBadge
                      lang={lang}
                      value="guarded"
                      label={adminInlineText(lang, 'Required')}
                      tone="info"
                    />
                  ) : (
                    <form action={updateModuleStatusAction} className="inline-flex">
                      <input type="hidden" name="moduleId" value={module.id} />
                      <input type="hidden" name="status" value={nextStatus} />
                      <input
                        type="hidden"
                        name="reason"
                        value={`Admin ${actionLabel.toLowerCase()} from module list. Impact: ${impact}.`}
                      />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        confirmation={adminInlineText(
                          lang,
                          'value_module_value_impact_value_075dd98f',
                          { value1: actionLabel, value2: module.name, value3: impact }
                        )}
                      >
                        {adminInlineText(lang, actionLabel)}
                      </ConfirmSubmitButton>
                    </form>
                  )}
                  {module.status === 'enabled' && !module.required ? (
                    <MoreActionMenu label={adminInlineText(lang, 'Maintain')}>
                      <form action={updateModuleStatusAction}>
                        <input type="hidden" name="moduleId" value={module.id} />
                        <input type="hidden" name="status" value="maintenance" />
                        <input
                          type="hidden"
                          name="reason"
                          value={`Admin moved ${module.id} to maintenance from module list. Impact: ${impact}.`}
                        />
                        <ConfirmSubmitButton
                          type="submit"
                          className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-1.5 text-xs font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                          confirmation={adminInlineText(
                            lang,
                            'move_value_to_maintenance_mode_impact_value_28a88ab6',
                            { value1: module.name, value2: impact }
                          )}
                        >
                          {adminInlineText(lang, 'Move to maintenance')}
                        </ConfirmSubmitButton>
                      </form>
                    </MoreActionMenu>
                  ) : null}
                </div>,
              ];
            })}
            empty={adminInlineText(lang, 'No modules match this filter.')}
            minWidthClass="min-w-[1260px]"
          />
        </div>
        <div className="grid gap-1 px-2 py-2 xl:hidden">
          {visibleModules.length > 0 ? (
            visibleModules.map((module) => {
              const failures =
                module.activity.failedRuns +
                module.activity.failedOutbox +
                module.activity.failedWebhookReceipts;
              return (
                <EntityListItem
                  key={module.id}
                  href={localizedPath(lang, `/admin/modules/${module.id}`)}
                  title={module.name}
                  subtitle={`${module.id} · v${module.version}`}
                  status={module.runtimeState}
                  detail={adminInlineText(lang, 'value_value_value_failures_282222ec', {
                    value1: getModuleProductArea(module),
                    value2: getModuleCapabilityPhrases(module).slice(0, 2).join(' · '),
                    value3: failures,
                  })}
                  meta={module.status}
                  icon={Box}
                  density="compact"
                  tone={
                    module.runtimeState === 'error' || failures > 0
                      ? 'danger'
                      : module.runtimeState === 'blocked'
                        ? 'warning'
                        : 'primary'
                  }
                />
              );
            })
          ) : (
            <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
              {adminInlineText(lang, 'No modules match this filter.')}
            </div>
          )}
        </div>
      </AdminPanel>
      <Pagination
        page={page}
        totalPages={totalPages}
        previousHref={
          page > 1 ? adminListHref(lang, '/admin/modules', modulePageQuery, page - 1) : undefined
        }
        nextHref={
          page < totalPages
            ? adminListHref(lang, '/admin/modules', modulePageQuery, page + 1)
            : undefined
        }
      />
    </WorkspaceShell>
  );
}

export function AdminModuleDetailOperationsPage({
  lang,
  detail,
}: {
  lang: SupportedLanguage;
  detail: AdminModuleDetailView;
}) {
  const copy = getAdminModuleDetailCopy(lang);
  const module = detail.module;
  const contract = detail.contract;
  const diagnostics = detail.presentedDiagnostics;
  const capabilityPhrases = module ? getModuleCapabilityPhrases(module) : [];
  const releaseImpact = module ? getModuleReleaseImpact(lang, module) : null;
  return (
    <WorkspaceShell
      lang={lang}
      title={module?.name ?? copy.detailTitle}
      subtitle={copy.subtitle}
      nav={adminNav}
    >
      {module ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
            <Link
              href={localizedPath(lang, '/admin/modules')}
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Back to modules')}
            </Link>
            <Link
              href={`${localizedPath(lang, '/admin/module-dev-console')}?moduleId=${encodeURIComponent(module.id)}`}
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Open dev console')}
            </Link>
          </div>
          <div className="grid gap-5">
            <StatGrid>
              <StatCard
                label={adminInlineText(lang, 'Catalog')}
                value={module.status}
                tone={module.status === 'enabled' ? 'blue' : 'amber'}
              />
              <StatCard
                label={adminInlineText(lang, 'Runtime')}
                value={module.runtimeState}
                tone={module.runtimeState === 'error' ? 'red' : 'blue'}
              />
              <StatCard
                label={adminInlineText(lang, 'Health')}
                value={module.health.status}
                tone={
                  module.health.errors > 0 ? 'red' : module.health.warnings > 0 ? 'amber' : 'blue'
                }
              />
              <StatCard
                label={adminInlineText(lang, 'Permissions')}
                value={String(module.permissions.length)}
                tone="amber"
              />
            </StatGrid>

            <AdminPanel
              title={adminInlineText(lang, 'Capability narrative')}
              description={adminInlineText(
                lang,
                'This turns the module contract into product-language impact before showing raw evidence.'
              )}
              contentClassName="grid gap-4"
            >
              <HealthRowList
                lang={lang}
                items={[
                  {
                    key: 'product-area',
                    title: getModuleProductArea(module),
                    detail:
                      moduleProductAreaDetails[getModuleProductArea(module)] ??
                      moduleProductAreaDetails.Platform,
                    meta: getModuleCategory(module),
                    status: module.status,
                    statusTone:
                      module.status === 'enabled'
                        ? 'success'
                        : module.status === 'not_installed'
                          ? 'neutral'
                          : 'warning',
                    tone: 'primary',
                  },
                  {
                    key: 'release-impact',
                    title: releaseImpact?.label ?? 'Unknown release impact',
                    detail: releaseImpact?.detail ?? 'No release impact evidence available.',
                    meta: getModuleOperatorNextAction(lang, module),
                    status: releaseImpact?.status ?? 'unknown',
                    statusLabel: releaseImpact?.label,
                    statusTone: releaseImpact?.tone,
                    tone: releaseImpact?.tone ?? 'neutral',
                  },
                ]}
              />
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'product_capabilities_c63c578c'),
                    value: capabilityPhrases.join(' · '),
                    helper: adminInlineText(
                      lang,
                      'human_readable_phrases_derived_from_routes_surfaces__eca5b552'
                    ),
                  },
                  {
                    label: adminInlineText(lang, 'operator_next_action_1f0c6789'),
                    value: getModuleOperatorNextAction(lang, module),
                    helper: adminInlineText(
                      lang,
                      'the_next_action_is_derived_from_install_state_lifecy_837e1098'
                    ),
                    tone: releaseImpact?.tone ?? 'neutral',
                  },
                  {
                    label: adminInlineText(lang, 'release_candidate_impact_71d4c09e'),
                    value:
                      releaseImpact?.detail ??
                      adminInlineText(lang, 'no_release_impact_evidence_available_bfb7c0f6'),
                    helper: adminInlineText(
                      lang,
                      'use_this_before_enabling_traffic_or_preparing_rc_evi_d0b8a4a9'
                    ),
                  },
                ]}
              />
            </AdminPanel>

            <AdminPanel
              title="Product shape"
              description="Host-level product metadata shows which shells a module intends to own before raw route evidence is inspected."
              contentClassName="grid gap-4"
            >
              {module.product ? (
                <>
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Field', 'Value', 'Evidence'])}
                    rows={[
                      ['Kind', module.product.kind, 'module.product.kind'],
                      [
                        'Audiences',
                        joinOrNone(module.product.audiences),
                        'module.product.audiences',
                      ],
                      [
                        'Required shells',
                        joinOrNone(module.product.requiredShells),
                        module.product.missingShells.length > 0
                          ? `missing routes: ${module.product.missingShells.join(', ')}`
                          : 'all required shells have routes',
                      ],
                      [
                        'Navigation',
                        module.product.missingNavigationShells.length > 0
                          ? `missing: ${module.product.missingNavigationShells.join(', ')}`
                          : 'all required shell navigation declared',
                        'navigation contribution',
                      ],
                      [
                        'Page counts',
                        `${module.product.pageCounts.site} site / ${module.product.pageCounts.dashboard} dashboard / ${module.product.pageCounts.admin} admin`,
                        `${module.product.pages.length} declared product pages`,
                      ],
                    ]}
                    minWidthClass="min-w-[820px]"
                    density="compact"
                  />
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, [
                      'Shell',
                      'Path',
                      'Audience',
                      'User question',
                      'Primary actions',
                    ])}
                    rows={module.product.pages.map((page) => [
                      page.shell,
                      page.path,
                      page.audience,
                      page.userQuestion,
                      joinOrNone(page.primaryActions),
                    ])}
                    minWidthClass="min-w-[980px]"
                    density="compact"
                  />
                </>
              ) : (
                <EmptyState title="No product shape declared">
                  This module can still be valid, but product modules should declare module.product
                  so doctor, quality, and Admin can catch missing site, console, or admin surfaces.
                </EmptyState>
              )}
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Operational metadata')}
              description={adminInlineText(
                lang,
                'Owner, runbook, replacement, and related operational links are explicit here; missing contract metadata is surfaced as release evidence debt.'
              )}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={localizedPath(lang, `/admin/runs?q=${encodeURIComponent(module.id)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Runs')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/webhooks?q=${encodeURIComponent(module.id)}`)}
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                  >
                    {adminInlineText(lang, 'Webhooks')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(module.id)}`)}
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
                className="md:grid-cols-2 xl:grid-cols-4"
                items={[
                  {
                    label: 'Owner',
                    value: 'module contract owner metadata missing',
                    tone: 'warning',
                  },
                  {
                    label: 'Runbook',
                    value: contract?.rootDir
                      ? `${contract.rootDir}/README.md`
                      : `modules/${module.id}/README.md`,
                    mono: true,
                  },
                  {
                    label: 'Replacement plan',
                    value: module.required
                      ? 'Required module: define replacement before disabling.'
                      : 'Disable or maintenance action is available from the module list.',
                    tone: module.required ? 'warning' : 'success',
                  },
                  { label: 'Product area', value: getModuleProductArea(module) },
                  { label: 'Last activity', value: module.activity.lastActivityAt ?? 'none' },
                  {
                    label: 'Release metadata',
                    value: module.contractMeta.buildId ?? 'missing',
                    tone: module.contractMeta.buildId ? 'success' : 'warning',
                  },
                  { label: 'Source files', value: String(module.contractMeta.sourceFiles) },
                  {
                    label: 'Contract digest',
                    value: module.contractMeta.contractDigest ?? 'missing',
                    mono: true,
                  },
                ]}
              />
            </AdminPanel>

            <AdminPanel
              title={adminInlineText(lang, 'Contract and runtime evidence')}
              description={adminInlineText(
                lang,
                'The module detail page keeps the product summary visible first. Raw contract, gateway, resource, activity, and doctor evidence stays folded by task.'
              )}
              contentClassName="grid gap-3"
            >
              {contract ? (
                <EvidenceSection
                  title={adminInlineText(lang, 'Risk review')}
                  description={adminInlineText(
                    lang,
                    'High-risk permissions, external entrypoints, secrets, and required resources are summarized before raw contract detail.'
                  )}
                  defaultOpen={contract.risk.score > 0}
                >
                  <div className="grid gap-4">
                    <DataTable
                      className="shadow-none"
                      columns={adminInlineColumns(lang, ['Risk area', 'Count', 'Evidence'])}
                      rows={[
                        [
                          'High-risk permissions',
                          String(contract.risk.highRiskPermissions.length),
                          contract.risk.highRiskPermissions.length > 0
                            ? contract.risk.highRiskPermissions
                                .map((permission) => `${permission.value}:${permission.risk}`)
                                .join(', ')
                            : 'none',
                        ],
                        [
                          'System-only permissions',
                          String(contract.risk.systemPermissions.length),
                          joinOrNone(contract.risk.systemPermissions),
                        ],
                        [
                          'External egress',
                          String(contract.risk.externalEgress.length),
                          joinOrNone(contract.risk.externalEgress),
                        ],
                        [
                          'Public APIs',
                          String(contract.risk.publicApis.length),
                          contract.risk.publicApis.length > 0
                            ? contract.risk.publicApis
                                .map(
                                  (route) =>
                                    `${route.methods.join('|')} ${route.path}${route.anonymousPolicy ? ' policy' : ''}`
                                )
                                .join(', ')
                            : 'none',
                        ],
                        [
                          'Webhooks',
                          String(contract.risk.webhooks.length),
                          contract.risk.webhooks.length > 0
                            ? contract.risk.webhooks
                                .map((webhook) => `${webhook.name}:${webhook.signature}`)
                                .join(', ')
                            : 'none',
                        ],
                        [
                          'Presentation overrides',
                          String(contract.risk.presentationOverrides.length),
                          joinOrNone(contract.risk.presentationOverrides),
                        ],
                        [
                          'Secrets and required resources',
                          String(
                            contract.risk.secretConfig.length +
                              contract.risk.requiredRequirements.length
                          ),
                          joinOrNone([
                            ...contract.risk.secretConfig,
                            ...contract.risk.requiredRequirements,
                          ]),
                        ],
                      ]}
                      minWidthClass="min-w-[920px]"
                      density="compact"
                    />
                    <HealthRowList
                      lang={lang}
                      items={[
                        {
                          key: 'risk-score',
                          title: 'Module risk score',
                          detail:
                            contract.risk.score > 0
                              ? 'Review the risk evidence before enabling or accepting release-candidate traffic.'
                              : 'No high-risk contract signals were found in the current module contract.',
                          meta: String(contract.risk.score),
                          status:
                            contract.risk.score > 8
                              ? 'high'
                              : contract.risk.score > 0
                                ? 'review'
                                : 'clear',
                          statusTone:
                            contract.risk.score > 8
                              ? 'danger'
                              : contract.risk.score > 0
                                ? 'warning'
                                : 'success',
                          tone:
                            contract.risk.score > 8
                              ? 'danger'
                              : contract.risk.score > 0
                                ? 'warning'
                                : 'success',
                        },
                      ]}
                    />
                  </div>
                </EvidenceSection>
              ) : null}

              <EvidenceSection
                title={adminInlineText(lang, 'Capability map')}
                description={adminInlineText(
                  lang,
                  'Product-facing capabilities before raw contract details.'
                )}
                defaultOpen
              >
                <div className="grid gap-4">
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Capability', 'Count', 'Notes'])}
                    rows={[
                      [
                        'Routes',
                        String(module.capabilities.routes),
                        `${module.capabilities.siteRoutes} site / ${module.capabilities.dashboardRoutes} dashboard / ${module.capabilities.adminRoutes} admin / ${module.capabilities.apiRoutes} api`,
                      ],
                      [
                        'Actions',
                        String(module.capabilities.actions),
                        contract ? joinOrNone(contract.actions.map((item) => item.name)) : 'none',
                      ],
                      [
                        'Jobs',
                        String(module.capabilities.jobs),
                        contract ? joinOrNone(contract.jobs.map((item) => item.name)) : 'none',
                      ],
                      [
                        'Events',
                        String(module.capabilities.events),
                        contract
                          ? `${contract.events.publishes.length} publishes / ${contract.events.subscribes.length} subscribes`
                          : 'none',
                      ],
                      [
                        'Webhooks',
                        String(module.capabilities.webhooks),
                        contract ? joinOrNone(contract.webhooks.map((item) => item.name)) : 'none',
                      ],
                      [
                        'Data',
                        String(module.capabilities.dataTables + module.capabilities.dataDocuments),
                        contract
                          ? `${joinOrNone(contract.data.tables)} tables / ${joinOrNone(contract.data.documents)} documents / ${joinOrNone(contract.data.views)} views / ${joinOrNone(contract.data.grants)} grants / ${joinOrNone(contract.data.checks)} checks / ${contract.data.migrationMode ?? 'no migration mode'}`
                          : 'none',
                      ],
                    ]}
                    minWidthClass="min-w-[760px]"
                    density="compact"
                  />
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, [
                      'Summary channel',
                      'Runtime contract',
                      'Map release evidence',
                    ])}
                    rows={[
                      [
                        'Provider requirements',
                        `${module.runtimeSummary.providerRequirements.services.length} services / ${module.runtimeSummary.providerRequirements.resourceBindings.length} resources / ${module.runtimeSummary.providerRequirements.egressOrigins.length} egress`,
                        module.contractMeta.capabilitySummary
                          ? `${module.contractMeta.capabilitySummary.providerRequirements} map requirements`
                          : 'missing map summary',
                      ],
                      [
                        'Commercial',
                        `${module.runtimeSummary.commercialRequirements.meters.length} meters / ${module.runtimeSummary.commercialRequirements.routeEntitlements.length + module.runtimeSummary.commercialRequirements.actionEntitlements.length} entitlements`,
                        module.contractMeta.capabilitySummary
                          ? `${module.contractMeta.capabilitySummary.commercialRequirements} map requirements`
                          : 'missing map summary',
                      ],
                      [
                        'Presentation',
                        `${module.runtimeSummary.presentationContribution.surfaces.length} surfaces / ${module.runtimeSummary.presentationContribution.replaces.length} replacements / ${module.runtimeSummary.presentationContribution.i18nNamespaces.length} namespaces`,
                        module.contractMeta.capabilitySummary
                          ? `${module.contractMeta.capabilitySummary.presentationContributions} map contributions`
                          : 'missing map summary',
                      ],
                    ]}
                    minWidthClass="min-w-[860px]"
                    density="compact"
                  />
                </div>
              </EvidenceSection>

              <EvidenceSection
                title={adminInlineText(lang, 'Source and release metadata')}
                description={adminInlineText(
                  lang,
                  'Generated module-map evidence explains whether source, contract, and release metadata still match.'
                )}
              >
                <DataTable
                  className="shadow-none"
                  columns={adminInlineColumns(lang, ['Field', 'Value', 'Evidence'])}
                  rows={[
                    [
                      'Module source',
                      [module.contractMeta.sourceId, module.contractMeta.sourceKind]
                        .filter(Boolean)
                        .join(' / ') || 'workspace',
                      module.contractMeta.sourceDir ?? 'unknown',
                    ],
                    [
                      'Build ID',
                      module.contractMeta.buildId ?? 'missing',
                      contract?.release?.generatedAt ?? 'no generatedAt',
                    ],
                    [
                      'Source hash',
                      module.contractMeta.sourceHash ?? 'missing',
                      `${module.contractMeta.sourceFiles} source files`,
                    ],
                    [
                      'Contract digest',
                      module.contractMeta.contractDigest ?? 'missing',
                      'module.ts contract digest',
                    ],
                    [
                      'Contract parts',
                      contract && contract.parts.length > 0
                        ? contract.parts.map((part) => `${part.name}:${part.path}`).join(', ')
                        : 'none',
                      'parts are optional local split files wired back into module.ts',
                    ],
                  ]}
                  minWidthClass="min-w-[900px]"
                  density="compact"
                />
              </EvidenceSection>

              <EvidenceSection
                title={`Routes and gateways · ${detail.routes.length}`}
                description={adminInlineText(
                  lang,
                  'Routes are grouped with the host gateways that expose them.'
                )}
              >
                <div className="grid gap-4">
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Kind', 'Path', 'Auth'])}
                    rows={detail.routes.map((route) => [route.kind, route.path, route.auth])}
                    empty={adminInlineText(lang, 'No module routes declared.')}
                    minWidthClass="min-w-[720px]"
                    density="compact"
                  />
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Gateway', 'Status', 'Contract'])}
                    rows={[
                      [
                        '/api/modules/[...path]',
                        module.capabilities.apiRoutes > 0 ? 'mounted' : 'not declared',
                        module.capabilities.apiRoutes > 0
                          ? `${module.capabilities.apiRoutes} API routes; auth/rate/anonymousPolicy follows the module route contract`
                          : 'no module API routes',
                      ],
                      [
                        '/api/module-webhooks/[...path]',
                        module.capabilities.webhooks > 0 ? 'mounted' : 'not declared',
                        contract
                          ? contract.webhooks
                              .map((webhook) => `${webhook.name}:${webhook.signature}`)
                              .join(', ') || 'no webhooks'
                          : 'no contract',
                      ],
                      [
                        '/[lang]/admin/[...modulePath]',
                        module.capabilities.adminRoutes > 0
                          ? 'admin routes declared'
                          : 'not declared',
                        module.capabilities.adminRoutes > 0
                          ? 'Rendered through the host Admin shell from routes.admin'
                          : 'no module admin runtime route',
                      ],
                    ]}
                    minWidthClass="min-w-[820px]"
                    density="compact"
                  />
                </div>
              </EvidenceSection>

              <EvidenceSection
                title={adminInlineText(lang, 'Surfaces and resources')}
                description={adminInlineText(
                  lang,
                  'Navigation, surfaces, and provider requirements are extension evidence, not the primary page story.'
                )}
              >
                <div className="grid gap-4">
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Surface / Navigation', 'Mode', 'Target'])}
                    rows={
                      contract && (contract.surfaces.length > 0 || contract.navigation.length > 0)
                        ? [
                            ...contract.navigation.map((item) => [
                              `nav:${item.location}`,
                              'link',
                              `${item.label} -> ${item.path}`,
                            ]),
                            ...contract.surfaces.map((item) => [
                              `surface:${item.id}`,
                              item.mode,
                              item.component,
                            ]),
                          ]
                        : [['none', 'none', 'module does not contribute navigation or surfaces']]
                    }
                    minWidthClass="min-w-[740px]"
                    density="compact"
                  />
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Resource', 'Required', 'Detail'])}
                    rows={
                      contract && contract.requirements.length > 0
                        ? contract.requirements.map((item) => [
                            `${item.kind}:${item.name}`,
                            item.required ? 'required' : 'optional',
                            [item.provider, item.description].filter(Boolean).join(' · ') ||
                              'declared',
                          ])
                        : [['none', 'no', 'module has no service/resource binding requirements']]
                    }
                    minWidthClass="min-w-[740px]"
                    density="compact"
                  />
                </div>
              </EvidenceSection>

              <EvidenceSection
                title={adminInlineText(lang, 'Runtime activity')}
                description={adminInlineText(
                  lang,
                  'Recent module records are summarized before raw diagnostics.'
                )}
              >
                <DataTable
                  className="shadow-none"
                  columns={adminInlineColumns(lang, ['Runtime Record', 'Count', 'Latest / Failed'])}
                  rows={[
                    [
                      'Runs',
                      String(detail.recent.runs.length),
                      `${module.activity.failedRuns} failed`,
                    ],
                    [
                      'Outbox',
                      String(module.activity.outbox),
                      `${module.activity.failedOutbox} failed/dead`,
                    ],
                    [
                      'Webhook receipts',
                      String(module.activity.webhookReceipts),
                      `${module.activity.failedWebhookReceipts} failed/rejected`,
                    ],
                    [
                      'Usage',
                      String(module.activity.usageRecords),
                      joinOrNone(detail.recent.usageRecords.map((record) => record.meter)),
                    ],
                    [
                      'Files',
                      String(module.activity.files),
                      joinOrNone(detail.recent.files.map((file) => file.status)),
                    ],
                  ]}
                  minWidthClass="min-w-[760px]"
                  density="compact"
                />
              </EvidenceSection>

              <EvidenceSection
                title={`Diagnostics · ${detail.diagnostics.length}`}
                description={adminInlineText(
                  lang,
                  'Doctor output stays below product and runtime summaries.'
                )}
              >
                <div className="grid gap-4">
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Subsystem', 'Errors', 'Warnings'])}
                    rows={
                      detail.diagnostics.length > 0
                        ? Array.from(
                            detail.diagnostics.reduce((groups, item) => {
                              const key = `${item.category ?? 'contract'}:${item.subsystem ?? 'module'}`;
                              const existing = groups.get(key) ?? { errors: 0, warnings: 0 };
                              if (item.severity === 'error') {
                                existing.errors += 1;
                              }
                              if (item.severity === 'warning') {
                                existing.warnings += 1;
                              }
                              groups.set(key, existing);
                              return groups;
                            }, new Map<string, { errors: number; warnings: number }>())
                          ).map(([key, value]) => [
                            key,
                            String(value.errors),
                            String(value.warnings),
                          ])
                        : [['contract:module', '0', '0']]
                    }
                    minWidthClass="min-w-[700px]"
                    density="compact"
                  />
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Severity', 'Code', 'Location / Fix'])}
                    rows={
                      detail.diagnostics.length > 0
                        ? detail.diagnostics.map((item) => [
                            item.severity,
                            item.code,
                            [
                              item.path,
                              item.line
                                ? `L${item.line}${item.column ? `:${item.column}` : ''}`
                                : null,
                              item.category && item.subsystem
                                ? `${item.category}/${item.subsystem}`
                                : null,
                              item.fix ?? item.message,
                            ]
                              .filter(Boolean)
                              .join(' · '),
                          ])
                        : [['ok', 'MODULE_DOCTOR_CLEAN', 'No module-specific diagnostics']]
                    }
                    minWidthClass="min-w-[760px]"
                    density="compact"
                  />
                  <DataTable
                    className="shadow-none"
                    columns={adminInlineColumns(lang, ['Presenter', 'Count', 'Meaning'])}
                    rows={[
                      [
                        'Errors',
                        String(diagnostics.errors.length),
                        'Must be fixed before risky release paths',
                      ],
                      [
                        'Warnings',
                        String(diagnostics.warnings.length),
                        'Should be fixed for RC evidence',
                      ],
                      ['Infos', String(diagnostics.infos.length), 'Informational only'],
                    ]}
                    minWidthClass="min-w-[700px]"
                    density="compact"
                  />
                </div>
              </EvidenceSection>
            </AdminPanel>

            <CodeBlockPanel
              lang={lang}
              title={adminInlineText(lang, 'AI fix prompt')}
              description={adminInlineText(
                lang,
                'Copy this prompt when a module needs targeted doctor remediation.'
              )}
              value={diagnostics.aiFixPrompt}
              copyValue={diagnostics.aiFixPrompt}
            />
          </div>

          <DetailDrawer
            open
            title={adminInlineText(lang, 'Module snapshot')}
            description={module.id}
            actions={
              <CopyButton
                value={module.id}
                label={adminInlineText(lang, 'Copy ID')}
                copiedLabel={adminInlineText(lang, 'Copied ID')}
              />
            }
            className="xl:sticky xl:top-24 xl:self-start"
          >
            <FactList
              lang={lang}
              items={[
                { label: 'Module ID', value: module.id, copyValue: module.id, mono: true },
                { label: 'Description', value: module.description ?? 'none' },
                { label: 'Version', value: module.version },
                { label: 'Installed', value: module.installed ? 'yes' : 'no' },
                { label: 'Required', value: module.required ? 'yes' : 'no' },
                {
                  label: 'Source',
                  value: [contract?.sourceId, contract?.sourceKind].filter(Boolean).join(' / ') || 'unknown',
                  mono: true,
                },
                { label: 'Root', value: contract?.rootDir ?? 'unknown', mono: true },
                { label: 'Permissions', value: module.permissions.join(', ') || 'none' },
                { label: 'Catalog', value: compactJson(detail.catalogState ?? {}), mono: true },
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
