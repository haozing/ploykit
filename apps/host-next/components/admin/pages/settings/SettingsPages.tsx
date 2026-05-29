import Link from 'next/link';
import type { ReactNode } from 'react';
import { CreditCard, Database, HardDrive, Settings2 } from 'lucide-react';
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
import { ProviderStatusPanel } from '@host/components/admin/shared/ProviderStatusPanel';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { WorkerStatusPanel } from '@host/components/admin/shared/WorkerStatusPanel';
import {
  ActionQueue,
  AdminPanel,
  FactList,
  HealthRowList,
  SegmentedWorkspace,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminSettingsCopy } from '@host/lib/admin-copy';
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
type AdminSettingsFieldKey = AdminHostSettingsView['fields'][number]['key'];
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

export function AdminSettingsOperationsPage({
  lang,
  snapshot,
  store,
  health,
  configDoctor,
  providerStatus,
  workerStatus,
  settings,
  updateSettingsAction,
  compositionPanel,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsSnapshot;
  store: HostRuntimeStoreStatus;
  health?: HostRuntimeHealth;
  configDoctor?: HostConfigDoctorReport;
  providerStatus?: AdminProviderStatusView;
  workerStatus?: AdminWorkerStatusView;
  settings?: AdminHostSettingsView;
  updateSettingsAction?: AdminFormAction;
  compositionPanel?: ReactNode;
}) {
  const copy = getAdminSettingsCopy(lang);
  const fileStorage = health?.files;
  const billingProvider = health?.billing;
  const settingsReviewItems = [
    !store.durable
      ? {
          key: 'runtime-store',
          title: adminInlineText(lang, 'Runtime store is not durable'),
          description: adminInlineText(
            lang,
            'The host is running in local memory mode. Move runtime state to Postgres before production traffic.'
          ),
          actionLabel: adminInlineText(lang, 'Review database'),
          href: localizedPath(lang, '/admin/settings'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    fileStorage && !fileStorage.durable
      ? {
          key: 'file-storage',
          title: adminInlineText(lang, 'File storage is not durable'),
          description: adminInlineText(
            lang,
            'file_storage_is_using_value_configure_durable_object_7f7b6e93',
            { value1: fileStorage.mode }
          ),
          actionLabel: adminInlineText(lang, 'Review files'),
          href: localizedPath(lang, '/admin/files'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    configDoctor && !configDoctor.ok
      ? {
          key: 'config-doctor',
          title: adminInlineText(lang, 'Configuration doctor needs attention'),
          description: adminInlineText(
            lang,
            'value_diagnostics_are_open_across_route_catalog_prov_bc8bb0a0',
            { value1: configDoctor.diagnostics.length }
          ),
          actionLabel: adminInlineText(lang, 'Review diagnostics'),
          href: localizedPath(lang, '/admin/settings'),
          status: 'blocked',
          tone: 'danger' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const settingField = (key: AdminSettingsFieldKey) =>
    settings?.fields.find((field) => field.key === key);
  const settingDisabled = (key: AdminSettingsFieldKey) => {
    const field = settingField(key);
    return Boolean(field && !field.editable);
  };
  const settingDiffProps = (key: AdminSettingsFieldKey, value: string | number | boolean) => {
    const field = settingField(key);
    return {
      'data-current-value': String(value),
      'data-risk': field?.risk ?? 'unknown',
      'data-requires-restart': String(Boolean(field?.requiresRestart)),
    };
  };
  return (
    <WorkspaceShell
      lang={lang}
      title={copy.title}
      subtitle={copy.subtitle}
      nav={adminNav}
      actions={
        settings && updateSettingsAction ? (
          <ConfirmSubmitButton
            form="settings-product-form"
            type="submit"
            className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            confirmation={adminInlineText(lang, '确认保存系统设置？')}
            formDiff
            formDiffTitle={adminInlineText(lang, 'change_diff_risk_restart_impact_c5687988')}
            formDiffEmptyLabel={adminInlineText(lang, 'no_field_changes_detected_1503883a')}
          >
            {adminInlineText(lang, 'Save Settings')}
          </ConfirmSubmitButton>
        ) : null
      }
    >
      <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
        <StatGrid className="order-1">
          <StatCard
            label={adminInlineText(lang, 'Runtime Store')}
            value={store.mode}
            helper={store.durable ? store.databaseLabel : 'local memory mode'}
            tone={store.durable ? 'green' : 'red'}
            icon={Database}
          />
          <StatCard
            label={adminInlineText(lang, 'File Storage')}
            value={fileStorage?.mode ?? 'local'}
            helper={fileStorage?.durable ? 'durable' : 'development mode'}
            tone={fileStorage?.durable ? 'green' : 'amber'}
            icon={HardDrive}
          />
          <StatCard
            label={adminInlineText(lang, 'Billing')}
            value={billingProvider?.mode ?? 'local'}
            helper={billingProvider?.stripeConfigured ? 'Stripe configured' : 'local ledger'}
            tone={billingProvider?.stripeConfigured ? 'green' : 'amber'}
            icon={CreditCard}
          />
          <StatCard
            label={adminInlineText(lang, 'Config Doctor')}
            value={configDoctor?.ok ? 'ready' : 'needs attention'}
            helper={configDoctor ? `${configDoctor.diagnostics.length} diagnostics` : 'not loaded'}
            tone={configDoctor?.ok ? 'green' : 'red'}
            icon={Settings2}
          />
        </StatGrid>
        {settingsReviewItems.length > 0 ? (
          <ActionQueue
            lang={lang}
            className="order-6"
            title={adminInlineText(lang, 'Settings review')}
            description={adminInlineText(
              lang,
              'Production-readiness issues stay visible in the operational diagnostics section.'
            )}
            status="warning"
            items={settingsReviewItems}
          />
        ) : null}
        <AdminPanel
          className="order-7"
          title={adminInlineText(lang, 'Runtime config')}
          description={adminInlineText(
            lang,
            'Infrastructure readiness is separated from product settings so operators can scan durability, providers, auth, and security boundaries.'
          )}
        >
          <HealthRowList
            lang={lang}
            items={[
              {
                key: 'database',
                title: 'Database',
                detail: store.durable
                  ? store.databaseLabel
                  : 'Runtime state is still using local memory mode.',
                meta: store.mode,
                status: store.durable ? 'durable' : 'memory',
                statusTone: store.durable ? 'success' : 'danger',
                tone: store.durable ? 'success' : 'danger',
              },
              {
                key: 'files',
                title: 'File storage',
                detail:
                  fileStorage?.mode === 's3'
                    ? `${fileStorage.bucket ?? 'bucket'} @ ${fileStorage.region ?? 'region'}`
                    : (fileStorage?.rootDir ?? 'local or memory storage'),
                meta: fileStorage?.mode ?? 'local',
                status: fileStorage?.durable ? 'durable' : 'development',
                statusTone: fileStorage?.durable ? 'success' : 'warning',
                tone: fileStorage?.durable ? 'success' : 'warning',
                href: localizedPath(lang, '/admin/files'),
              },
              {
                key: 'billing',
                title: 'Billing provider',
                detail: billingProvider?.stripeWebhookConfigured
                  ? 'Stripe webhook is configured.'
                  : 'Using local ledger or missing webhook secret.',
                meta: billingProvider?.mode ?? 'local',
                status: billingProvider?.stripeConfigured ? 'configured' : 'local',
                statusTone: billingProvider?.stripeConfigured ? 'success' : 'warning',
                tone: billingProvider?.stripeConfigured ? 'success' : 'warning',
                href: localizedPath(lang, '/admin/revenue'),
              },
              {
                key: 'auth',
                title: 'Authentication',
                detail: health?.auth.secretConfigured
                  ? 'Signed cookie secret configured.'
                  : 'Development signed cookie secret.',
                meta: health?.auth.mode ?? 'runtime-store-signed-cookie',
                status: health?.auth.secretConfigured ? 'configured' : 'development',
                statusTone: health?.auth.secretConfigured ? 'success' : 'warning',
                tone: health?.auth.secretConfigured ? 'success' : 'warning',
              },
              {
                key: 'security',
                title: 'Security runtime',
                detail: configDoctor
                  ? lang === 'zh'
                    ? `${configDoctor.metrics.routeCatalogEntries} 条路由目录记录，发现 ${configDoctor.metrics.apiRoutesDiscovered} 条 API 路由。`
                    : `${configDoctor.metrics.routeCatalogEntries} route catalog entries and ${configDoctor.metrics.apiRoutesDiscovered} discovered API routes.`
                  : `csrf=${health?.security.csrf ?? 'runtime-only'}, rate=${health?.security.rateLimit ?? 'runtime-only'}`,
                meta: configDoctor?.ok ? 'ready' : 'review',
                status: configDoctor?.ok ? 'ready' : 'review',
                statusTone: configDoctor?.ok ? 'success' : 'warning',
                tone: configDoctor?.ok ? 'success' : 'warning',
              },
            ]}
          />
        </AdminPanel>
        {settings && updateSettingsAction ? (
          <AdminPanel
            className="order-2"
            title={adminInlineText(lang, 'Product settings')}
            description={adminInlineText(
              lang,
              'White-label product settings stay separate from runtime and diagnostic evidence. Changes write audit records.'
            )}
          >
            <form id="settings-product-form" action={updateSettingsAction} className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <FormField label={adminInlineText(lang, 'Site name')} htmlFor="settings-site-name">
                  <Input
                    id="settings-site-name"
                    name="siteName"
                    defaultValue={settings.siteName}
                    disabled={settingDisabled('siteName')}
                    {...settingDiffProps('siteName', settings.siteName)}
                  />
                </FormField>
                <FormField
                  label={adminInlineText(lang, 'Support email')}
                  htmlFor="settings-support-email"
                >
                  <Input
                    id="settings-support-email"
                    name="supportEmail"
                    defaultValue={settings.supportEmail}
                    disabled={settingDisabled('supportEmail')}
                    {...settingDiffProps('supportEmail', settings.supportEmail)}
                  />
                </FormField>
                <FormField label={adminInlineText(lang, 'Locale')} htmlFor="settings-locale">
                  <Select
                    id="settings-locale"
                    name="defaultLocale"
                    defaultValue={settings.defaultLocale}
                    disabled={settingDisabled('defaultLocale')}
                    {...settingDiffProps('defaultLocale', settings.defaultLocale)}
                  >
                    <option value="zh">zh</option>
                    <option value="en">en</option>
                  </Select>
                </FormField>
                <FormField label={adminInlineText(lang, 'Timezone')} htmlFor="settings-timezone">
                  <Input
                    id="settings-timezone"
                    name="timezone"
                    defaultValue={settings.timezone}
                    disabled={settingDisabled('timezone')}
                    {...settingDiffProps('timezone', settings.timezone)}
                  />
                </FormField>
                <FormField
                  label={adminInlineText(lang, 'Session max age days')}
                  htmlFor="settings-session-age"
                >
                  <Input
                    id="settings-session-age"
                    name="sessionMaxAgeDays"
                    defaultValue={String(settings.sessionMaxAgeDays)}
                    disabled={settingDisabled('sessionMaxAgeDays')}
                    {...settingDiffProps('sessionMaxAgeDays', settings.sessionMaxAgeDays)}
                  />
                </FormField>
                <FormField
                  label={adminInlineText(lang, 'Password min length')}
                  htmlFor="settings-password-min"
                >
                  <Input
                    id="settings-password-min"
                    name="passwordMinLength"
                    defaultValue={String(settings.passwordMinLength)}
                    disabled={settingDisabled('passwordMinLength')}
                    {...settingDiffProps('passwordMinLength', settings.passwordMinLength)}
                  />
                </FormField>
                <FormField
                  label={adminInlineText(lang, 'Email provider')}
                  htmlFor="settings-email-provider"
                >
                  <Select
                    id="settings-email-provider"
                    name="emailProvider"
                    defaultValue={settings.emailProvider}
                    disabled={settingDisabled('emailProvider')}
                    {...settingDiffProps('emailProvider', settings.emailProvider)}
                  >
                    <option value="log">{adminInlineText(lang, 'log')}</option>
                    <option value="webhook">{adminInlineText(lang, 'webhook')}</option>
                    <option value="disabled">{adminInlineText(lang, 'disabled')}</option>
                  </Select>
                </FormField>
                <FormField
                  label={adminInlineText(lang, 'Digest frequency')}
                  htmlFor="settings-digest"
                >
                  <Select
                    id="settings-digest"
                    name="digestFrequency"
                    defaultValue={settings.digestFrequency}
                    disabled={settingDisabled('digestFrequency')}
                    {...settingDiffProps('digestFrequency', settings.digestFrequency)}
                  >
                    <option value="immediate">{adminInlineText(lang, 'immediate')}</option>
                    <option value="daily">{adminInlineText(lang, 'daily')}</option>
                    <option value="weekly">{adminInlineText(lang, 'weekly')}</option>
                    <option value="off">{adminInlineText(lang, 'off')}</option>
                  </Select>
                </FormField>
                <FormField label={adminInlineText(lang, 'From name')} htmlFor="settings-from-name">
                  <Input
                    id="settings-from-name"
                    name="fromName"
                    defaultValue={settings.fromName}
                    disabled={settingDisabled('fromName')}
                    {...settingDiffProps('fromName', settings.fromName)}
                  />
                </FormField>
                <FormField
                  label={adminInlineText(lang, 'From email')}
                  htmlFor="settings-from-email"
                >
                  <Input
                    id="settings-from-email"
                    name="fromEmail"
                    defaultValue={settings.fromEmail}
                    disabled={settingDisabled('fromEmail')}
                    {...settingDiffProps('fromEmail', settings.fromEmail)}
                  />
                </FormField>
                <FormField label={adminInlineText(lang, 'Change reason')} htmlFor="settings-reason">
                  <Input id="settings-reason" name="reason" defaultValue="" />
                </FormField>
              </div>
              <div className="flex flex-col gap-3 border-t border-admin-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    name="requireEmailVerification"
                    defaultChecked={settings.requireEmailVerification}
                    disabled={settingDisabled('requireEmailVerification')}
                    {...settingDiffProps(
                      'requireEmailVerification',
                      settings.requireEmailVerification
                    )}
                  />
                  <span>{adminInlineText(lang, 'Require email verification')}</span>
                </label>
                <div className="text-sm text-admin-text-muted">
                  {adminInlineText(lang, 'source')} {settings.source}
                  {settings.updatedAt
                    ? adminInlineText(lang, 'updated_value_5da794a3', {
                        value1: settings.updatedAt,
                      })
                    : ''}
                </div>
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={adminInlineText(lang, '确认保存系统设置？')}
                  formDiff
                  formDiffTitle={adminInlineText(lang, 'change_diff_risk_restart_impact_c5687988')}
                  formDiffEmptyLabel={adminInlineText(lang, 'no_field_changes_detected_1503883a')}
                >
                  {adminInlineText(lang, 'Save Settings')}
                </ConfirmSubmitButton>
              </div>
            </form>
          </AdminPanel>
        ) : null}
        {settings ? (
          <AdminPanel
            className="order-3"
            title={adminInlineText(lang, 'Resolved product settings')}
            description={adminInlineText(
              lang,
              'Current values after environment and runtime overrides are resolved.'
            )}
          >
            <FactList
              lang={lang}
              className="md:grid-cols-2 xl:grid-cols-3"
              density="compact"
              items={[
                { label: 'Site name', value: settings.siteName },
                { label: 'Support email', value: settings.supportEmail },
                { label: 'Locale', value: settings.defaultLocale },
                { label: 'Timezone', value: settings.timezone },
                { label: 'Email verification', value: String(settings.requireEmailVerification) },
                { label: 'Session max age', value: `${settings.sessionMaxAgeDays} days` },
                { label: 'Password min length', value: String(settings.passwordMinLength) },
                { label: 'Email provider', value: settings.emailProvider },
                { label: 'From', value: `${settings.fromName} <${settings.fromEmail}>` },
                { label: 'Digest', value: settings.digestFrequency },
                { label: 'Source', value: settings.source },
                {
                  label: 'Version',
                  value: settings.version ? String(settings.version) : 'not versioned',
                },
                { label: 'Updated', value: settings.updatedAt ?? 'not updated' },
              ]}
            />
            <div className="mt-4">
              <DataTable
                columns={adminInlineColumns(lang, [
                  'Setting',
                  'Value',
                  'Default',
                  'Source',
                  'Risk',
                  'Restart',
                  'Scope',
                ])}
                rows={settings.fields.map((field) => [
                  <span key={`${field.key}:setting`} className="block min-w-0">
                    <span className="block truncate font-semibold text-admin-text">
                      {field.key}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-admin-text-muted">
                      {field.description}
                    </span>
                  </span>,
                  compactJson(field.value),
                  compactJson(field.defaultValue),
                  field.source,
                  field.risk,
                  adminInlineText(lang, field.requiresRestart ? 'yes' : 'no'),
                  field.scope,
                ])}
              />
            </div>
          </AdminPanel>
        ) : null}
        <AdminPanel
          className="order-4"
          title={adminInlineText(lang, 'Theme component preview')}
          description={adminInlineText(
            lang,
            'A compact smoke preview for shell primitives. Full profile, workspace scope, diagnostics, and rollout checks live in Theme management below.'
          )}
        >
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: 'Surface',
                  className: 'bg-admin-surface text-admin-text border-admin-border',
                  value: 'surface / text / border',
                },
                {
                  label: 'Primary',
                  className: 'bg-admin-primary text-white border-admin-primary',
                  value: 'primary action',
                },
                {
                  label: 'Success',
                  className: 'bg-admin-success/10 text-admin-success border-admin-success/25',
                  value: 'success state',
                },
                {
                  label: 'Warning',
                  className: 'bg-admin-warning/10 text-admin-warning border-admin-warning/25',
                  value: 'warning state',
                },
              ].map((token) => (
                <article
                  key={token.label}
                  className={`rounded-admin-md border p-4 ${token.className}`}
                >
                  <span className="block text-[11px] font-semibold uppercase opacity-75">
                    {token.label}
                  </span>
                  <strong className="mt-3 block text-lg">{token.value}</strong>
                </article>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    {adminInlineText(lang, 'Primary')}
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text"
                  >
                    {adminInlineText(lang, 'Secondary')}
                  </button>
                  <StatusBadge lang={lang} value="ready" tone="success" />
                  <StatusBadge lang={lang} value="warning" tone="warning" />
                  <StatusBadge lang={lang} value="failed" tone="danger" />
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <Input
                    defaultValue={settings?.siteName ?? 'PloyKit'}
                    aria-label={adminInlineText(lang, 'Theme preview input')}
                  />
                  <Select
                    defaultValue="comfortable"
                    aria-label={adminInlineText(lang, 'Theme preview density')}
                  >
                    <option value="comfortable">{adminInlineText(lang, 'comfortable')}</option>
                    <option value="compact">{adminInlineText(lang, 'compact')}</option>
                  </Select>
                  <div className="rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text-muted">
                    {adminInlineText(lang, 'radius · border · focus')}
                  </div>
                </div>
              </div>
              <FactList
                lang={lang}
                density="compact"
                items={[
                  { label: 'Scope', value: 'product / workspace / module override' },
                  {
                    label: 'Allowed tokens',
                    value:
                      'background, foreground, card, muted, border, primary, success, warning, destructive, radius',
                  },
                  { label: 'Admin shell', value: 'token consumer, not arbitrary CSS target' },
                ]}
              />
            </div>
          </div>
        </AdminPanel>
        <div className="order-5">{compositionPanel}</div>
        <SegmentedWorkspace
          lang={lang}
          className="order-8"
          title={adminInlineText(lang, 'Diagnostics center')}
          description={adminInlineText(
            lang,
            'Provider and worker evidence are separated into independent operational lanes so readiness reviews do not mix concerns.'
          )}
          sections={[
            {
              key: 'provider-diagnostics',
              label: 'Provider',
              content: (
                <ProviderStatusPanel
                  lang={lang}
                  status={providerStatus}
                  title={adminInlineText(lang, 'Diagnostics · Provider Matrix')}
                  description={adminInlineText(
                    lang,
                '配置诊断就绪度、供应商矩阵最新结果和本地供应商深度冒烟测试。'
                  )}
                />
              ),
            },
            {
              key: 'worker-diagnostics',
              label: 'Worker',
              content: (
                <WorkerStatusPanel
                  lang={lang}
                  status={workerStatus}
                  title={adminInlineText(lang, 'Diagnostics · Worker Matrix')}
                  description={adminInlineText(
                    lang,
                'Worker 心跳、队列延迟、死信和最新 Worker 浸泡测试证据。'
                  )}
                />
              ),
            },
          ]}
        />
        <div className="order-9">
          <DataTable
            title={adminInlineText(lang, 'Diagnostics summary')}
            description={adminInlineText(
              lang,
              'Provider, security, retention, and runtime readiness in one compact evidence table.'
            )}
            columns={adminInlineColumns(lang, ['Config', 'State', 'Detail'])}
            rows={[
              ['Database', store.durable ? 'durable' : 'memory', store.databaseLabel],
              [
                'Files',
                fileStorage?.durable ? 'durable' : 'memory',
                fileStorage?.mode === 's3'
                  ? `${fileStorage.bucket ?? 'bucket'} @ ${fileStorage.region ?? 'region'}`
                  : (fileStorage?.rootDir ?? 'memory'),
              ],
              [
                'Stripe',
                billingProvider?.stripeConfigured ? 'configured' : 'local fallback',
                billingProvider?.stripeWebhookConfigured
                  ? 'webhook ready'
                  : 'webhook secret missing',
              ],
              [
                'Auth',
                health?.auth.mode ?? 'runtime-store-signed-cookie',
                health?.auth.secretConfigured
                  ? 'signed cookie secret configured'
                  : 'dev signed cookie secret',
              ],
              [
                'Product Scope',
                health?.productScope.mode ?? 'in-memory-default-scope',
                health?.productScope.durable ? 'durable' : 'memory fallback',
              ],
              [
                'AI/RAG/Notifications',
                `${health?.providers.ai.mode ?? 'static'} / ${health?.providers.rag.mode ?? 'memory-vector'} / ${health?.providers.notifications ?? 'runtime-store'}`,
                'provider readiness summary',
              ],
              [
                'Worker',
                health?.worker.mode ?? 'runtime-store-loop',
                `durableQueue=${String(health?.worker.durableQueue ?? store.durable)}, lease=${health?.worker.lease ?? 'none'}`,
              ],
              [
                'Security',
                `csrf=${health?.security.csrf ?? 'runtime-only'}, rate=${health?.security.rateLimit ?? 'runtime-only'}`,
                configDoctor
                  ? `routeCatalog=${configDoctor.metrics.routeCatalogEntries}, apiRoutes=${configDoctor.metrics.apiRoutesDiscovered}`
                  : `routeCatalog=${health?.security.routeCatalog ?? 'missing'}`,
              ],
              [
                'Config Doctor',
                configDoctor?.ok ? 'ready' : 'blocked or warnings',
                configDoctor
                  ? `${configDoctor.diagnostics.length} diagnostics, ${configDoctor.metrics.providersReady}/${configDoctor.metrics.providersTotal} providers ready`
                  : 'not loaded',
              ],
              [
                'Retention',
                'policy snapshot',
                configDoctor
                  ? `${configDoctor.retention.files}; audit=${configDoctor.retention.auditLogs}`
                  : 'not loaded',
              ],
            ]}
          />
        </div>
      </div>
    </WorkspaceShell>
  );
}

export function AdminSectionPage({
  lang,
  title,
  subtitle,
  rows,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
  rows: readonly (readonly string[])[];
}) {
  return (
    <WorkspaceShell lang={lang} title={title} subtitle={subtitle} nav={adminNav}>
      <AdminPanel title={title} description={subtitle} contentClassName="p-0">
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, ['Object', 'State', 'Note'])}
          rows={rows}
        />
      </AdminPanel>
    </WorkspaceShell>
  );
}
