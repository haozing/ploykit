import { HOST_CAPABILITIES, type HostCapability } from './rbac';

export type AdminRegistryKind = 'page' | 'api' | 'action';
export type AdminRegistryScope = 'product' | 'workspace' | 'user' | 'system';
export type AdminRegistryRisk = 'read' | 'write' | 'dangerous';

export interface AdminRegistryEntry {
  id: string;
  kind: AdminRegistryKind;
  path: string;
  methods?: readonly string[];
  capability: HostCapability;
  scope: AdminRegistryScope;
  risk: AdminRegistryRisk;
  auditEvent: string;
  rateLimit?: 'none' | 'machine' | 'interactive' | 'dangerous';
}

export interface AdminRegistryAudit {
  ok: boolean;
  entries: number;
  pages: number;
  apis: number;
  actions: number;
  duplicateKeys: readonly string[];
  duplicateApiMethods: readonly string[];
  missingCapabilities: readonly string[];
}

function entry(input: AdminRegistryEntry): AdminRegistryEntry {
  return input;
}

function page(
  id: string,
  path: string,
  capability: HostCapability,
  risk: AdminRegistryRisk = 'read'
): AdminRegistryEntry {
  return entry({
    id,
    kind: 'page',
    path,
    capability,
    scope: 'product',
    risk,
    auditEvent: `admin.page.${id}.viewed`,
    rateLimit: 'none',
  });
}

function api(
  id: string,
  path: string,
  methods: readonly string[],
  capability: HostCapability,
  risk: AdminRegistryRisk = 'read'
): AdminRegistryEntry {
  return entry({
    id,
    kind: 'api',
    path,
    methods,
    capability,
    scope: 'product',
    risk,
    auditEvent: `admin.api.${id}.called`,
    rateLimit: risk === 'read' ? 'machine' : risk === 'dangerous' ? 'dangerous' : 'interactive',
  });
}

function action(
  id: string,
  path: string,
  capability: HostCapability,
  risk: AdminRegistryRisk = 'write',
  auditEvent = `admin.action.${id}.executed`
): AdminRegistryEntry {
  return entry({
    id,
    kind: 'action',
    path,
    capability,
    scope: 'product',
    risk,
    auditEvent,
    rateLimit: risk === 'dangerous' ? 'dangerous' : 'interactive',
  });
}

export const ADMIN_ROUTE_REGISTRY = [
  page('overview', '/admin', 'admin.access'),
  page('analytics', '/admin/analytics', 'admin.operations.read'),
  page('users', '/admin/users', 'admin.users.manage'),
  page('user.detail', '/admin/users/[userId]', 'admin.users.manage'),
  page('rbac', '/admin/rbac', 'admin.rbac.read'),
  page('modules', '/admin/modules', 'admin.operations.read'),
  page('module.detail', '/admin/modules/[moduleId]', 'admin.operations.read'),
  page('module.devConsole', '/admin/module-dev-console', 'admin.devConsole.read'),
  page('runs', '/admin/runs', 'admin.operations.read'),
  page('run.detail', '/admin/runs/[runId]', 'admin.operations.read'),
  page('webhooks', '/admin/webhooks', 'admin.webhooks.read'),
  page('webhook.detail', '/admin/webhooks/[outboxId]', 'admin.webhooks.read'),
  page('serviceConnections', '/admin/service-connections', 'admin.serviceConnections.read'),
  page('entitlements', '/admin/entitlements', 'billing.read'),
  page('revenue', '/admin/revenue', 'billing.read'),
  page('billing', '/admin/billing', 'billing.read'),
  page('files', '/admin/files', 'files.read'),
  page('file.detail', '/admin/files/[fileId]', 'files.read'),
  page('audit', '/admin/audit', 'admin.operations.read'),
  page('settings', '/admin/settings', 'admin.settings.read'),
  page('usage', '/admin/usage', 'admin.operations.read'),
  page('search', '/admin/search', 'admin.access'),
  page('module.runtime', '/admin/[...modulePath]', 'admin.access'),

  api('users', '/api/admin/users', ['GET'], 'admin.users.manage'),
  api('roles', '/api/admin/roles', ['GET'], 'admin.rbac.read'),
  api('permissions', '/api/admin/permissions', ['GET'], 'admin.rbac.read'),
  api('entitlements.read', '/api/admin/entitlements', ['GET'], 'billing.read'),
  api('entitlements.write', '/api/admin/entitlements', ['POST', 'PATCH'], 'billing.write', 'write'),
  api('analytics', '/api/admin/analytics', ['GET'], 'admin.operations.read'),
  api('providers.read', '/api/admin/providers', ['GET'], 'admin.operations.read'),
  api('providers.write', '/api/admin/providers', ['POST'], 'admin.operations.write', 'write'),
  api('workers', '/api/admin/workers', ['GET'], 'admin.operations.read'),
  api('revenue', '/api/admin/revenue', ['GET'], 'billing.read'),
  api('revenue.reconcile', '/api/admin/revenue/reconcile', ['POST'], 'billing.write', 'dangerous'),
  api('usage', '/api/admin/usage', ['GET'], 'admin.operations.read'),
  api('audit', '/api/admin/audit', ['GET'], 'admin.operations.read'),
  api('files', '/api/admin/files', ['GET'], 'files.read'),
  api('outbox.deadLetters.read', '/api/admin/outbox/dead-letters', ['GET'], 'admin.webhooks.read'),
  api('outbox.deadLetters.write', '/api/admin/outbox/dead-letters', ['POST'], 'admin.webhooks.write', 'dangerous'),
  api('serviceConnections', '/api/admin/service-connections', ['GET'], 'admin.serviceConnections.read'),
  api('search', '/api/admin/search', ['GET'], 'admin.access'),
  api('security.catalog', '/api/admin/security/catalog', ['GET'], 'admin.operations.read'),

  action('audit.applyRetention', '/admin/audit', 'admin.operations.write', 'dangerous'),
  action('billing.upsertPlan', '/admin/billing', 'billing.write'),
  action('billing.archivePlan', '/admin/billing', 'billing.write', 'dangerous'),
  action('billing.upsertSku', '/admin/billing', 'billing.write'),
  action('billing.archiveSku', '/admin/billing', 'billing.write', 'dangerous'),
  action('billing.syncSku', '/admin/billing', 'billing.write'),
  action('entitlements.grant', '/admin/entitlements', 'billing.write'),
  action('entitlements.override', '/admin/entitlements', 'billing.write', 'dangerous'),
  action('entitlements.revoke', '/admin/entitlements', 'billing.write', 'dangerous'),
  action('files.quarantine', '/admin/files', 'admin.operations.write', 'dangerous'),
  action('files.restore', '/admin/files', 'admin.operations.write'),
  action('files.archive', '/admin/files', 'admin.operations.write', 'dangerous'),
  action('files.delete', '/admin/files', 'admin.operations.write', 'dangerous'),
  action('files.cleanupDeleted', '/admin/files', 'admin.operations.write', 'dangerous'),
  action('files.bulkUpdate', '/admin/files', 'admin.operations.write', 'dangerous'),
  action('modules.status', '/admin/modules', 'admin.operations.write'),
  action('revenue.reconcile', '/admin/revenue', 'billing.write', 'dangerous'),
  action('runs.requeue', '/admin/runs', 'admin.operations.write', 'dangerous'),
  action('runs.cancel', '/admin/runs', 'admin.operations.write', 'dangerous'),
  action('settings.update', '/admin/settings', 'admin.settings.write'),
  action('serviceConnections.test', '/admin/service-connections', 'admin.serviceConnections.write'),
  action('serviceConnections.updateStatus', '/admin/service-connections', 'admin.serviceConnections.write', 'dangerous'),
  action('serviceConnections.rotateSecret', '/admin/service-connections', 'admin.serviceConnections.write', 'dangerous'),
  action('serviceConnections.create', '/admin/service-connections', 'admin.serviceConnections.write'),
  action('serviceConnections.updatePolicy', '/admin/service-connections', 'admin.serviceConnections.write'),
  action('serviceConnections.applyRetention', '/admin/service-connections', 'admin.serviceConnections.write', 'dangerous'),
  action('webhooks.retryOutbox', '/admin/webhooks', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.discardOutbox', '/admin/webhooks', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.archiveOutbox', '/admin/webhooks', 'admin.webhooks.write'),
  action('webhooks.detail.retryOutbox', '/admin/webhooks/[outboxId]', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.detail.discardOutbox', '/admin/webhooks/[outboxId]', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.detail.archiveOutbox', '/admin/webhooks/[outboxId]', 'admin.webhooks.write'),
  action('webhooks.bulkReplayDeadLetters', '/admin/webhooks', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.bulkDiscardOutbox', '/admin/webhooks', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.bulkArchiveOutbox', '/admin/webhooks', 'admin.webhooks.write'),
  action('webhooks.retryReceipt', '/admin/webhooks', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.detail.retryReceipt', '/admin/webhooks/[outboxId]', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.bulkRetryReceipts', '/admin/webhooks', 'admin.webhooks.write', 'dangerous'),
  action('webhooks.drainWorker', '/admin/webhooks', 'admin.webhooks.write', 'dangerous'),
  action('users.updateStatus', '/admin/users/[userId]', 'admin.users.manage', 'dangerous'),
  action('users.updateRole', '/admin/users/[userId]', 'admin.users.manage', 'dangerous'),
  action('users.passwordReset', '/admin/users/[userId]', 'admin.users.manage', 'write'),
  action('users.revokeSession', '/admin/users/[userId]', 'admin.users.manage', 'dangerous'),
  action('users.list.updateStatus', '/admin/users', 'admin.users.manage', 'dangerous'),
  action('users.list.updateRole', '/admin/users', 'admin.users.manage', 'dangerous'),
] as const satisfies readonly AdminRegistryEntry[];

export function getAdminRegistryEntries(): readonly AdminRegistryEntry[] {
  return ADMIN_ROUTE_REGISTRY;
}

export function adminRegistryKey(entry: Pick<AdminRegistryEntry, 'kind' | 'id'>): string {
  return `${entry.kind}:${entry.id}`;
}

export function adminApiRouteId(entry: Pick<AdminRegistryEntry, 'kind' | 'id'>): string {
  if (entry.kind !== 'api') {
    throw new Error(`ADMIN_REGISTRY_ENTRY_NOT_API: ${adminRegistryKey(entry)}`);
  }
  return `admin.${entry.id}`;
}

export function getAdminRegistryEntry(
  id: string,
  options: { kind?: AdminRegistryKind } = {}
): AdminRegistryEntry {
  const entries = ADMIN_ROUTE_REGISTRY.filter(
    (item) => item.id === id && (!options.kind || item.kind === options.kind)
  );
  if (entries.length === 0) {
    throw new Error(
      `ADMIN_REGISTRY_ENTRY_NOT_FOUND: ${options.kind ? `${options.kind}:` : ''}${id}`
    );
  }
  if (entries.length > 1) {
    throw new Error(`ADMIN_REGISTRY_ENTRY_AMBIGUOUS: ${id}`);
  }
  return entries[0]!;
}

export function findAdminRegistryByPath(
  path: string,
  kind?: AdminRegistryKind
): readonly AdminRegistryEntry[] {
  return ADMIN_ROUTE_REGISTRY.filter(
    (entry) => entry.path === path && (!kind || entry.kind === kind)
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registryPathMatches(entryPath: string, path: string): boolean {
  if (entryPath === path) {
    return true;
  }
  const pattern = entryPath
    .split('/')
    .map((segment) =>
      /^\[\.\.\.[^\]]+\]$/.test(segment)
        ? '.+'
        : /^\[[^\]]+\]$/.test(segment)
          ? '[^/]+'
          : escapeRegex(segment)
    )
    .join('/');
  return new RegExp(`^${pattern}$`).test(path);
}

export function findAdminPageRegistryEntry(path: string): AdminRegistryEntry | null {
  return (
    ADMIN_ROUTE_REGISTRY.find(
      (entry) => entry.kind === 'page' && registryPathMatches(entry.path, path)
    ) ?? null
  );
}

export function getAdminApiRouteIds(): readonly string[] {
  return ADMIN_ROUTE_REGISTRY.filter((entry) => entry.kind === 'api').map(
    (entry) => adminApiRouteId(entry)
  );
}

export function findAdminApiRegistryEntry(
  routeId: string,
  method?: string
): AdminRegistryEntry | null {
  if (!routeId.startsWith('admin.')) {
    return null;
  }
  const id = routeId.slice('admin.'.length);
  const normalizedMethod = method?.toUpperCase();
  return (
    ADMIN_ROUTE_REGISTRY.find(
      (entry) =>
        entry.kind === 'api' &&
        entry.id === id &&
        (!normalizedMethod ||
          (entry.methods && entry.methods.length > 0 ? entry.methods : ['GET']).some(
            (entryMethod) => entryMethod.toUpperCase() === normalizedMethod
          ))
    ) ?? null
  );
}

export function getAdminActionRegistryEntry(actionId: string): AdminRegistryEntry {
  return getAdminRegistryEntry(actionId, { kind: 'action' });
}

export function auditAdminRegistry(): AdminRegistryAudit {
  const keyCounts = new Map<string, number>();
  const apiMethodCounts = new Map<string, number>();
  const knownCapabilities = new Set(HOST_CAPABILITIES.map((capability) => capability.id));
  const missingCapabilities: string[] = [];
  for (const entry of ADMIN_ROUTE_REGISTRY) {
    const key = adminRegistryKey(entry);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    if (!entry.capability || !knownCapabilities.has(entry.capability)) {
      missingCapabilities.push(key);
    }
    if (entry.kind === 'api') {
      for (const method of entry.methods ?? ['GET']) {
        const key = `${entry.path} ${method.toUpperCase()}`;
        apiMethodCounts.set(key, (apiMethodCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const duplicateKeys = [...keyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const duplicateApiMethods = [...apiMethodCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const pages = ADMIN_ROUTE_REGISTRY.filter((entry) => entry.kind === 'page').length;
  const apis = ADMIN_ROUTE_REGISTRY.filter((entry) => entry.kind === 'api').length;
  const actions = ADMIN_ROUTE_REGISTRY.filter((entry) => entry.kind === 'action').length;
  return {
    ok:
      duplicateKeys.length === 0 &&
      duplicateApiMethods.length === 0 &&
      missingCapabilities.length === 0,
    entries: ADMIN_ROUTE_REGISTRY.length,
    pages,
    apis,
    actions,
    duplicateKeys,
    duplicateApiMethods,
    missingCapabilities,
  };
}
