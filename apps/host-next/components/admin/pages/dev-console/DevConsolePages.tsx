import Link from 'next/link';
import type { ReactNode } from 'react';
import { Boxes, FileCode2, LayoutTemplate, TriangleAlert } from 'lucide-react';
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
  ActionPanel,
  AdminPanel,
  FactList,
  HealthRowList,
  SegmentedWorkspace,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminDevConsoleCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  ProductCompositionView,
  ProductThemeDiagnosticsView,
} from '@host/lib/product-composition';
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
      {adminInlineText(lang, 'current_filter_shows_value_value_records_f66a03c1', {
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

type DevConsoleModuleRow = AdminModuleDevConsoleView['snapshot']['modules'][number];

function moduleRoot(module: DevConsoleModuleRow): string {
  return module.rootDir ?? `modules/${module.id}`;
}

function moduleRunbook(module: DevConsoleModuleRow): string {
  return `${moduleRoot(module).replace(/\\/g, '/')}/README.md`;
}

function moduleOwner(module: DevConsoleModuleRow): string {
  const root = moduleRoot(module).replace(/\\/g, '/');
  return root.split('/').filter(Boolean).at(-1) ?? module.id;
}

function moduleEscalation(
  lang: SupportedLanguage,
  diagnostics: readonly { severity: string; code: string }[]
): string {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return adminInlineText(lang, 'block_release_and_repair_error_diagnostics_from_the__f4134cd0');
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) {
    return adminInlineText(lang, 'module_owner_reviews_warnings_and_test_evidence_befo_4e508ce4');
  }
  return adminInlineText(lang, 'standard_owner_review_keep_module_doctor_and_module__82c3ccc4');
}

function moduleRepairCommands(module: DevConsoleModuleRow): string[] {
  return [
    `npm run module:doctor -- ${module.id}`,
    `npm run module:test -- ${module.id}`,
    'npm run modules:scan',
  ];
}

export function AdminModuleDevConsoleOperationsPage({
  lang,
  view,
  composition,
  theme,
  diagnosticsPanel,
}: {
  lang: SupportedLanguage;
  view: AdminModuleDevConsoleView;
  composition?: ProductCompositionView;
  theme?: ProductThemeDiagnosticsView;
  diagnosticsPanel?: ReactNode;
}) {
  const copy = getAdminDevConsoleCopy(lang);
  const reportByModule = new Map(view.testReports.map((report) => [report.moduleId, report]));
  const diagnosticItems = view.report.modulesWithErrors.slice(0, 4).map((moduleId) => ({
    key: moduleId,
    title: moduleId,
    description:
      (view.diagnosticsByModule[moduleId] ?? [])
        .slice(0, 2)
        .map((item) => `${item.code}: ${item.message}`)
        .join(' · ') || 'Module has errors in the latest diagnostics report.',
    actionLabel: copy.openModule,
    href: localizedPath(lang, `/admin/modules/${moduleId}`),
    status: 'failed',
    tone: 'danger' as const,
  }));
  const diagnosticQueueItems =
    diagnosticItems.length > 0
      ? diagnosticItems
      : [
          {
            key: 'diagnostics-clear',
            title: adminInlineText(lang, 'No blocking module diagnostics'),
            description: adminInlineText(
              lang,
              'Latest module doctor evidence has no blocking errors; raw tables remain available below.'
            ),
            actionLabel: adminInlineText(lang, 'Open modules'),
            href: localizedPath(lang, '/admin/modules'),
            status: 'ready',
            tone: 'success' as const,
          },
        ];
  const compositionSummary = composition
    ? {
        activeOverrides: composition.pages.filter((page) => page.activeModuleId).length,
        pageDiagnostics: composition.pages.reduce((sum, page) => sum + page.diagnostics.length, 0),
        configuredSlots: composition.slots.filter((slot) => slot.configured).length,
        blockedSlots: composition.slots.reduce(
          (sum, slot) =>
            sum +
            slot.blockedContributions.length +
            slot.blockedModules.length +
            slot.diagnostics.length,
          0
        ),
      }
    : null;
  const themeSummary = theme
    ? {
        acceptedTokens: Object.keys(theme.productProfile.acceptedTokens).length,
        rejectedTokens:
          Object.keys(theme.productProfile.rejectedTokens).length +
          Object.keys(theme.productProfile.rejectedDarkTokens).length +
          theme.productProfile.diagnostics.length,
        moduleThemeWriters: theme.modules.filter((module) => module.declaredThemeWrite).length,
        cssBlockedModules: theme.modules.filter((module) => module.hasCss).length,
      }
    : null;
  const aiPromptEntries = view.snapshot.modules.map((module) => {
    const diagnostics = view.diagnosticsByModule[module.id] ?? [];
    return {
      moduleId: module.id,
      diagnostics,
      prompt:
        view.report.aiFixPrompts[module.id] ??
        'Use defineModule(), local module handlers and explicit ctx capabilities only.',
    };
  });
  const aiPromptBundle = JSON.stringify(
    Object.fromEntries(aiPromptEntries.map((entry) => [entry.moduleId, entry.prompt])),
    null,
    2
  );
  const testedModules = new Set(
    view.testReports.filter((report) => report.success).map((report) => report.moduleId)
  );
  const modulesWithDiagnostics = view.snapshot.modules.filter(
    (module) => (view.diagnosticsByModule[module.id] ?? []).length > 0
  );
  const repairPacks = view.snapshot.modules.map((module) => {
    const diagnostics = view.diagnosticsByModule[module.id] ?? [];
    const prompt =
      view.report.aiFixPrompts[module.id] ??
      'Use defineModule(), local module handlers and explicit ctx capabilities only.';
    return {
      module,
      diagnostics,
      prompt,
      commands: moduleRepairCommands(module),
      pack: JSON.stringify(
        {
          moduleId: module.id,
          owner: moduleOwner(module),
          runbook: moduleRunbook(module),
          escalation: moduleEscalation(lang, diagnostics),
          diagnostics: diagnostics.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
            path: diagnostic.path,
          })),
          prompt,
          commands: moduleRepairCommands(module),
        },
        null,
        2
      ),
    };
  });
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Modules')}
          value={String(view.snapshot.moduleCount)}
          helper={adminInlineText(lang, 'Runtime snapshot')}
          tone="blue"
          icon={Boxes}
        />
        <StatCard
          label={adminInlineText(lang, 'Bundle')}
          value={String(view.bundle.modules.length)}
          helper={adminInlineText(lang, 'Scanned module sources')}
          icon={FileCode2}
        />
        <StatCard
          label={adminInlineText(lang, 'Errors')}
          value={String(view.report.modulesWithErrors.length)}
          helper={adminInlineText(lang, 'Doctor diagnostics')}
          tone={view.report.modulesWithErrors.length > 0 ? 'red' : 'neutral'}
          icon={TriangleAlert}
        />
        <StatCard
          label={adminInlineText(lang, 'Templates')}
          value={String(view.report.templates.length)}
          helper={adminInlineText(lang, 'Available scaffolds')}
          tone="amber"
          icon={LayoutTemplate}
        />
      </StatGrid>

      <ActionPanel
        title={
          diagnosticItems.length > 0
            ? adminInlineText(lang, 'Diagnostics need review')
            : adminInlineText(lang, 'Diagnostics clear')
        }
        description={
          diagnosticItems.length > 0
            ? adminInlineText(
                lang,
                'Module errors are promoted before raw diagnostic tables so the first screen has a concrete next action.'
              )
            : adminInlineText(
                lang,
                'This page intentionally keeps raw module evidence available below, but the first screen now starts with the diagnostic conclusion.'
              )
        }
        tone={diagnosticItems.length > 0 ? 'danger' : 'success'}
      />

      <ActionQueue
        lang={lang}
        title={adminInlineText(lang, 'Diagnostics review')}
        description={adminInlineText(
          lang,
          'This page may expose raw diagnostics, but module errors still get a clear first action.'
        )}
        status={diagnosticItems.length > 0 ? 'failed' : 'ready'}
        items={diagnosticQueueItems}
      />

      <AdminPanel
        title={adminInlineText(lang, 'Environment comparison')}
        description={adminInlineText(
          lang,
          'mdc_does_not_have_a_remote_environment_contract_yet__9d34727c'
        )}
      >
        <div className="grid gap-4">
          <FactList
            lang={lang}
            density="compact"
            className="md:grid-cols-2 xl:grid-cols-4"
            items={[
              { label: 'Current env', value: view.environment.currentEnvironment },
              { label: 'Node env', value: view.environment.nodeEnvironment },
              { label: 'Target env', value: view.environment.targetEnvironment },
              {
                label: 'Module map',
                value: `${view.environment.moduleMapKind} · ${view.environment.moduleMapBuildId ?? 'no build id'}`,
              },
            ]}
          />
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Lane', 'Status', 'Evidence', 'Next check'])}
            rows={[
              [
                'Runtime',
                view.report.modulesWithErrors.length > 0 ? 'review' : 'ready',
                `${view.snapshot.moduleCount} modules · ${view.report.modulesWithErrors.length} error modules`,
                'npm run typecheck',
              ],
              [
                'Module map',
                view.environment.moduleMapGeneratedAt ? 'generated' : 'missing timestamp',
                `${view.environment.moduleMapKind} · ${view.environment.moduleMapGeneratedAt ?? 'not generated'}`,
                'npm run modules:scan',
              ],
              [
                'Module tests',
                testedModules.size === view.snapshot.moduleCount ? 'covered' : 'partial',
                `${testedModules.size}/${view.snapshot.moduleCount} modules have passing module:test reports`,
                'npm run module:test -- <module-id>',
              ],
              [
                'Production target',
                modulesWithDiagnostics.length > 0 ? 'blocked' : 'ready',
                `${modulesWithDiagnostics.length} modules have diagnostics before ${view.environment.targetEnvironment}`,
                'npm run release:rc-gate',
              ],
            ]}
            minWidthClass="min-w-[860px]"
            density="compact"
          />
        </div>
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Owner, runbook, and escalation')}
        description={adminInlineText(
          lang,
          'module_owner_readme_runbook_escalation_and_linked_ru_df2711d0'
        )}
        contentClassName="p-0"
      >
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, ['Module', 'Owner', 'Runbook', 'Escalation', 'Links'])}
          rows={view.snapshot.modules.map((module) => {
            const diagnostics = view.diagnosticsByModule[module.id] ?? [];
            return [
              module.id,
              moduleOwner(module),
              <span
                key={`${module.id}:runbook`}
                className="font-mono text-xs text-admin-text-muted"
              >
                {moduleRunbook(module)}
              </span>,
              moduleEscalation(lang, diagnostics),
              <div key={`${module.id}:links`} className="flex flex-wrap gap-2">
                <Link
                  href={localizedPath(lang, `/admin/modules/${module.id}`)}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Module')}
                </Link>
                <Link
                  href={`${localizedPath(lang, '/admin/runs')}?q=${encodeURIComponent(module.id)}`}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Runs')}
                </Link>
              </div>,
            ];
          })}
          minWidthClass="min-w-[980px]"
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'AI repair workflow')}
        description={adminInlineText(
          lang,
          'each_module_has_a_copyable_repair_pack_with_diagnost_f986abc5'
        )}
        contentClassName="p-0"
      >
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, ['Module', 'Diagnostics', 'Commands', 'Repair pack'])}
          rows={repairPacks.map((entry) => [
            entry.module.id,
            entry.diagnostics.length > 0
              ? entry.diagnostics
                  .map((diagnostic) => `${diagnostic.severity}:${diagnostic.code}`)
                  .join(', ')
              : 'clean',
            <span
              key={`${entry.module.id}:commands`}
              className="whitespace-pre-wrap font-mono text-xs text-admin-text-muted"
            >
              {entry.commands.join('\n')}
            </span>,
            <CopyButton
              key={`${entry.module.id}:pack`}
              value={entry.pack}
              label={adminInlineText(lang, 'Copy')}
              copiedLabel={adminInlineText(lang, 'Copied')}
            />,
          ])}
          minWidthClass="min-w-[920px]"
        />
      </AdminPanel>

      <SegmentedWorkspace
        lang={lang}
        title={adminInlineText(lang, 'MDC operations summary')}
        description={adminInlineText(
          lang,
          'Host composition, theme governance, and AI repair prompts are summarized before raw diagnostic tables.'
        )}
        sections={[
          {
            key: 'mdc-host-composition',
            label: 'Host composition',
            count: composition?.pages.length ?? 0,
            content: compositionSummary ? (
              <div className="grid gap-4">
                <FactList
                  lang={lang}
                  density="compact"
                  className="md:grid-cols-2 xl:grid-cols-4"
                  items={[
                    { label: 'Pages', value: String(composition?.pages.length ?? 0) },
                    {
                      label: 'Active overrides',
                      value: String(compositionSummary.activeOverrides),
                    },
                    {
                      label: 'Configured slots',
                      value: String(compositionSummary.configuredSlots),
                    },
                    {
                      label: 'Composition issues',
                      value: String(
                        compositionSummary.pageDiagnostics + compositionSummary.blockedSlots
                      ),
                      tone:
                        compositionSummary.pageDiagnostics + compositionSummary.blockedSlots > 0
                          ? 'warning'
                          : 'success',
                    },
                  ]}
                />
                <HealthRowList
                  lang={lang}
                  items={[
                    {
                      key: 'composition-overrides',
                      title: 'Page replacement map',
                      detail: `${compositionSummary.activeOverrides}/${composition?.pages.length ?? 0} pages currently use module replacement.`,
                      meta: `${composition?.enabledModules.length ?? 0} enabled modules`,
                      status: compositionSummary.activeOverrides > 0 ? 'scoped' : 'host default',
                      statusTone: 'info',
                      tone: 'info',
                    },
                    {
                      key: 'composition-slots',
                      title: 'Slot contribution policy',
                      detail: `${compositionSummary.configuredSlots}/${composition?.slots.length ?? 0} slots have explicit policy.`,
                      meta: `${compositionSummary.blockedSlots} blocked signals`,
                      status: compositionSummary.blockedSlots > 0 ? 'review' : 'clear',
                      statusTone: compositionSummary.blockedSlots > 0 ? 'warning' : 'success',
                      tone: compositionSummary.blockedSlots > 0 ? 'warning' : 'success',
                    },
                  ]}
                />
              </div>
            ) : (
              <p className="text-sm text-admin-text-muted">
                {adminInlineText(lang, 'No composition summary loaded.')}
              </p>
            ),
          },
          {
            key: 'mdc-theme-governance',
            label: 'Theme governance',
            count: theme?.modules.length ?? 0,
            content: themeSummary ? (
              <FactList
                lang={lang}
                density="compact"
                className="md:grid-cols-2 xl:grid-cols-4"
                items={[
                  { label: 'Accepted tokens', value: String(themeSummary.acceptedTokens) },
                  {
                    label: 'Rejected tokens',
                    value: String(themeSummary.rejectedTokens),
                    tone: themeSummary.rejectedTokens > 0 ? 'warning' : 'success',
                  },
                  {
                    label: 'ThemeWrite modules',
                    value: `${themeSummary.moduleThemeWriters}/${theme?.modules.length ?? 0}`,
                  },
                  {
                    label: 'CSS blocked modules',
                    value: String(themeSummary.cssBlockedModules),
                    tone: themeSummary.cssBlockedModules > 0 ? 'warning' : 'success',
                  },
                  {
                    label: 'Workspace profiles',
                    value: String(theme?.workspaceProfiles.length ?? 0),
                  },
                  { label: 'Allowed tokens', value: theme?.allowedTokens.join(', ') ?? 'none' },
                ]}
              />
            ) : (
              <p className="text-sm text-admin-text-muted">
                {adminInlineText(lang, 'No theme governance summary loaded.')}
              </p>
            ),
          },
          {
            key: 'mdc-ai-prompts',
            label: 'AI prompts',
            count: aiPromptEntries.length,
            content: (
              <div className="grid gap-4">
                <DataTable
                  className="shadow-none"
                  columns={adminInlineColumns(lang, ['Module', 'Diagnostics', 'Prompt', 'Copy'])}
                  rows={aiPromptEntries.map((entry) => [
                    entry.moduleId,
                    entry.diagnostics.length > 0
                      ? entry.diagnostics.map((item) => `${item.severity}:${item.code}`).join(', ')
                      : 'clean',
                    <span
                      key={`${entry.moduleId}:prompt`}
                      className="line-clamp-2 text-xs leading-5 text-admin-text-muted"
                    >
                      {entry.prompt}
                    </span>,
                    <CopyButton
                      key={`${entry.moduleId}:copy`}
                      value={entry.prompt}
                      label={adminInlineText(lang, 'Copy')}
                      copiedLabel={adminInlineText(lang, 'Copied')}
                    />,
                  ])}
                  minWidthClass="min-w-[920px]"
                  density="compact"
                />
                <div className="rounded-admin-md border border-admin-border bg-admin-bg/45">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-3 py-2.5">
                    <span className="text-sm font-semibold text-admin-text">
                      {adminInlineText(lang, 'Export prompts')}
                    </span>
                    <CopyButton
                      value={aiPromptBundle}
                      label={adminInlineText(lang, 'Copy')}
                      copiedLabel={adminInlineText(lang, 'Copied')}
                    />
                  </div>
                  <pre className="max-h-64 overflow-auto break-all p-3 text-xs leading-5 text-admin-text-muted">
                    {aiPromptBundle}
                  </pre>
                </div>
              </div>
            ),
          },
        ]}
      />

      <details className="rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
          {adminInlineText(lang, 'Raw diagnostic tables')}
        </summary>
        <div className="grid gap-4 border-t border-admin-border p-4">
          <AdminPanel
            title={adminInlineText(lang, 'Module map')}
            description={adminInlineText(
              lang,
              'Contract-level module map with test evidence and declared capabilities.'
            )}
            contentClassName="p-0"
          >
            <DataTable
              className="rounded-none border-x-0 border-b-0 shadow-none"
              columns={adminInlineColumns(lang, [
                'Module',
                'Status',
                'Routes',
                'Data',
                'Background',
                'module:test',
              ])}
              rows={view.snapshot.modules.map((module) => {
                const capabilities = module.capabilities;
                const testReport = reportByModule.get(module.id);
                return [
                  module.id,
                  module.status,
                  String(capabilities?.routes ?? 0),
                  `${capabilities?.data.tables ?? 0} tables / ${capabilities?.data.documents ?? 0} docs`,
                  `${capabilities?.jobs ?? 0} jobs / ${capabilities?.webhooks ?? 0} webhooks`,
                  testReport
                    ? `${testReport.success ? 'pass' : 'fail'} · ${testReport.checkedAt}`
                    : `npm run module:test -- ${module.id}`,
                ];
              })}
            />
          </AdminPanel>

          <DataTable
            title={adminInlineText(lang, 'Templates')}
            description={adminInlineText(
              lang,
              'Available local module scaffolds for new product capabilities.'
            )}
            columns={adminInlineColumns(lang, ['Template', 'Path', 'Capabilities'])}
            rows={view.report.templates.map((template) => [
              template.id,
              template.path,
              template.capabilities.join(', '),
            ])}
          />

          <DataTable
            title={adminInlineText(lang, 'Bundle inspect')}
            description={adminInlineText(lang, 'Scanned module files by capability surface.')}
            columns={adminInlineColumns(lang, ['Bundle Module', 'Source', 'Files'])}
            rows={view.bundle.modules.map((module) => [
              module.id,
              module.rootDir ?? 'unknown',
              [
                module.files.pages.length ? `${module.files.pages.length} pages` : null,
                module.files.apis.length ? `${module.files.apis.length} apis` : null,
                module.files.actions.length ? `${module.files.actions.length} actions` : null,
                module.files.jobs.length ? `${module.files.jobs.length} jobs` : null,
                module.files.webhooks.length ? `${module.files.webhooks.length} webhooks` : null,
              ]
                .filter(Boolean)
                .join(', ') || 'module only',
            ])}
          />

          <DataTable
            title={adminInlineText(lang, 'AI authoring prompts')}
            description={adminInlineText(
              lang,
              'Module diagnostics and prompt hints for AI-assisted fixes.'
            )}
            columns={adminInlineColumns(lang, [
              'Module',
              'Diagnostics',
              'AI-assisted authoring prompt',
            ])}
            rows={view.snapshot.modules.map((module) => {
              const diagnostics = view.diagnosticsByModule[module.id] ?? [];
              return [
                module.id,
                diagnostics.length > 0
                  ? diagnostics.map((item) => `${item.severity}:${item.code}`).join(', ')
                  : 'clean',
                view.report.aiFixPrompts[module.id] ??
                  'Use defineModule(), local module handlers and explicit ctx capabilities only.',
              ];
            })}
          />
        </div>
      </details>
      {diagnosticsPanel}
    </WorkspaceShell>
  );
}
