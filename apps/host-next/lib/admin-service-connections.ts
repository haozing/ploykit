import type { ModuleServiceOperationDefinition } from '@ploykit/module-sdk';
import { createServiceInvocationRuntime } from '@/lib/module-capabilities/services';
import { MODULE_MAP_ARTIFACT } from '@/lib/module-map';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { loadModuleRuntimeContracts } from '@/lib/module-runtime/loader/load-module-contracts';
import type {
  RuntimeStore,
  RuntimeStoreAuditRecord,
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreServiceConnectionRecord,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { assertAdminSession } from './admin-session';
import { ensureAdminStoreSeeded } from './admin-store-seed';
import { runHostConfigDoctor, type HostProviderReadiness } from './config-doctor';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from './default-scope';

const DEMO_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

export async function getAdminServiceConnectionsView(): Promise<AdminServiceConnectionsView> {
  const [configDoctor, hostRuntime, contracts] = await Promise.all([
    runHostConfigDoctor({ projectRoot: process.cwd() }),
    getHostRuntime(),
    loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT),
  ]);
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    contracts.map((contract) => contract.id)
  );
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEMO_PRODUCT_ID,
  });
  const storedConnections = await hostRuntime.runtimeStore.store.listServiceConnections({
    productId: DEMO_PRODUCT_ID,
  });
  const storedResourceBindings = await hostRuntime.runtimeStore.store.listResourceBindings({
    productId: DEMO_PRODUCT_ID,
  });
  const retainedCallLogs = applyConnectionCallLogRetention(auditLogs);
  const callLogs = retainedCallLogs.visibleLogs
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);
  const connections = buildServiceConnectionRows({
    contracts,
    providerReadiness: configDoctor.providerReadiness,
    storedConnections,
    storedResourceBindings,
  });

  return {
    ...createServiceConnectionsHealth(configDoctor),
    configDoctor,
    summary: connectionSummary(connections),
    connections,
    retention: retainedCallLogs.retention,
    callLogs,
  };
}

async function findAdminServiceConnection(connectionId: string) {
  const view = await getAdminServiceConnectionsView();
  const connection = view.connections.find((item) => item.id === connectionId);
  if (!connection) {
    throw new Error(`ADMIN_CONNECTION_NOT_FOUND: ${connectionId}`);
  }
  return { view, connection };
}

export async function setAdminServiceConnectionStatus(
  session: ModuleHostSession,
  connectionId: string,
  status: 'active' | 'disabled',
  reason = 'Admin connection status update'
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(connectionId);
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection(
    serviceConnectionStoreInput(session, connection, status)
  );
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: status === 'disabled' ? 'admin.connection.disabled' : 'admin.connection.enabled',
    metadata: {
      connectionId,
      service: connection.service,
      provider: connection.provider,
      previousStatus: connection.status,
      nextStatus: status,
      connectionStoreId: saved.connectionId,
      reason,
    },
  });
}

export async function testAdminServiceConnection(
  session: ModuleHostSession,
  connectionId: string,
  reason = 'Admin connection test',
  options: { fetchImpl?: typeof fetch } = {}
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(connectionId);
  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.upsertServiceConnection(
    serviceConnectionStoreInput(session, connection)
  );
  const contracts = connection.moduleId
    ? await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT)
    : [];
  const contract = contracts.find((item) => item.id === connection.moduleId);
  const signedHealthCheck = contract
    ? await runAdminSignedServiceConnectionHealthCheck({
        session,
        connection,
        contract,
        fetchImpl: options.fetchImpl ?? fetch,
        store: hostRuntime.runtimeStore.store,
      })
    : null;
  const healthCheck =
    signedHealthCheck ??
    (await runAdminServiceConnectionHealthCheck(connection, options.fetchImpl ?? fetch));
  await hostRuntime.runtimeStore.store.touchServiceConnection(DEMO_PRODUCT_ID, connectionId, {
    health: {
      status: healthCheck.status,
      result: healthCheck.result,
      latencyMs: healthCheck.latencyMs,
      lastTestAt: new Date().toISOString(),
      lastError: healthCheck.error,
      responseStatus: healthCheck.responseStatus,
      target: healthCheck.target,
    },
  });
  await hostRuntime.runtimeStore.store.recordProviderInvocation({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId ?? null,
    moduleId: connection.moduleId ?? null,
    providerId: connection.provider,
    kind: 'connector',
    operation: 'healthcheck',
    status: healthCheck.result === 'succeeded' ? 'succeeded' : 'failed',
    target: healthCheck.target ?? connection.baseUrl,
    serviceConnectionId: connectionId,
    usage: {
      responseStatus: healthCheck.responseStatus,
    },
    latencyMs: healthCheck.latencyMs,
    error:
      healthCheck.result === 'failed'
        ? {
            code: 'ADMIN_CONNECTION_HEALTHCHECK_FAILED',
            message: healthCheck.error ?? 'Service connection health check failed.',
          }
        : undefined,
    metadata: {
      service: connection.service,
      healthCheck: connection.healthCheck,
      authType: connection.authType,
    },
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.tested',
    metadata: {
      connectionId,
      service: connection.service,
      provider: connection.provider,
      status: connection.status,
      result: healthCheck.result,
      latencyMs: healthCheck.latencyMs,
      reason,
      request: {
        method: 'HEALTHCHECK',
        baseUrl: connection.baseUrl,
        healthCheck: connection.healthCheck,
        timeoutMs: connection.timeoutMs,
        target: healthCheck.target,
      },
      responseStatus: healthCheck.responseStatus,
      error: healthCheck.error,
    },
  });
}

export async function rotateAdminServiceConnectionSecret(
  session: ModuleHostSession,
  connectionId: string,
  secretSource = 'env:ROTATED_SOURCE',
  reason = 'Admin secret source rotation'
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(connectionId);
  const namedSecretRefs = Object.keys(connection.secretRefs).filter(
    (name) => name !== 'credential'
  );
  if (namedSecretRefs.length > 0 && !connection.secretRefs.credential) {
    throw new Error('ADMIN_CONNECTION_NAMED_SECRET_REFS_REQUIRE_POLICY_UPDATE');
  }
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection({
    ...serviceConnectionStoreInput(session, {
      ...connection,
      secretSource,
      secretRefs: {
        ...connection.secretRefs,
        credential: secretSource,
      },
    }),
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.secret_rotated',
    metadata: {
      connectionId,
      service: connection.service,
      provider: connection.provider,
      authType: connection.authType,
      previousSecretSource: connection.secretSource,
      nextSecretSource: secretSource,
      connectionStoreId: saved.connectionId,
      reason,
    },
  });
}

export interface AdminServiceConnectionPolicyInput {
  connectionId: string;
  service?: string;
  provider?: string;
  moduleId?: string;
  workspaceId?: string | null;
  environment?: string;
  ownerType?: AdminServiceConnectionRow['ownerType'];
  scopeType?: AdminServiceConnectionRow['scopeType'];
  authType?: AdminServiceConnectionRow['authType'];
  secretSource?: string;
  secretRefs?: Record<string, string>;
  baseUrl?: string;
  timeoutMs?: number;
  retry?: string;
  maxResponseBytes?: number;
  healthCheck?: string;
  actorClaims?: string;
  reason?: string;
}

export async function createAdminServiceConnection(
  session: ModuleHostSession,
  input: AdminServiceConnectionPolicyInput
) {
  assertAdminSession(session);
  const connectionId = normalizeCustomConnectionId(input.connectionId);
  const view = await getAdminServiceConnectionsView();
  if (view.connections.some((connection) => connection.id === connectionId)) {
    throw new Error(`ADMIN_CONNECTION_ALREADY_EXISTS: ${connectionId}`);
  }
  const policy = normalizeConnectionPolicyInput({
    ...input,
    connectionId,
    service: input.service ?? connectionId.replace(/^custom:/, ''),
    provider: input.provider ?? 'custom',
  });
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection({
    productId: DEMO_PRODUCT_ID,
    workspaceId: policy.workspaceId,
    moduleId: policy.moduleId ?? null,
    actorId: session.actorId ?? session.user?.id ?? null,
    connectionId,
    service: policy.service,
    provider: policy.provider,
    status: 'active',
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    authType: policy.authType,
    config: {
      baseUrl: policy.baseUrl,
      timeoutMs: policy.timeoutMs,
      retry: policy.retry,
      maxResponseBytes: policy.maxResponseBytes,
      healthCheck: policy.healthCheck,
      actorClaims: policy.actorClaims,
      detail: 'Custom service connection created from Admin operations.',
    },
    secretRefs: policy.secretRefs,
    health: {
      status: 'warning',
      required: false,
    },
    metadata: {
      source: 'custom',
    },
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: policy.workspaceId,
    moduleId: policy.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.created',
    metadata: {
      connectionId,
      connectionStoreId: saved.connectionId,
      policy,
      reason: input.reason ?? 'Admin service connection created',
    },
  });
}

export async function updateAdminServiceConnectionPolicy(
  session: ModuleHostSession,
  input: AdminServiceConnectionPolicyInput
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(input.connectionId);
  const policy = normalizeConnectionPolicyInput({
    ...input,
    connectionId: connection.id,
    service: input.service ?? connection.service,
    provider: input.provider ?? connection.provider,
    moduleId: input.moduleId ?? connection.moduleId,
    workspaceId: input.workspaceId ?? connection.workspaceId,
    environment: input.environment ?? connection.environment,
    ownerType: input.ownerType ?? connection.ownerType,
    scopeType: input.scopeType ?? connection.scopeType,
    authType: input.authType ?? connection.authType,
    secretSource: input.secretSource ?? connection.secretSource,
    secretRefs: input.secretRefs ?? connection.secretRefs,
    baseUrl: input.baseUrl ?? connection.baseUrl,
    timeoutMs: input.timeoutMs ?? connection.timeoutMs,
    retry: input.retry ?? connection.retry,
    maxResponseBytes: input.maxResponseBytes ?? connection.maxResponseBytes,
    healthCheck: input.healthCheck ?? connection.healthCheck,
    actorClaims: input.actorClaims ?? connection.actorClaims,
  });
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection({
    productId: DEMO_PRODUCT_ID,
    workspaceId: policy.workspaceId,
    moduleId: policy.moduleId ?? null,
    actorId: session.actorId ?? session.user?.id ?? null,
    connectionId: connection.id,
    service: policy.service,
    provider: policy.provider,
    status: connection.status === 'disabled' ? 'disabled' : 'active',
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    authType: policy.authType,
    config: {
      baseUrl: policy.baseUrl,
      timeoutMs: policy.timeoutMs,
      retry: policy.retry,
      maxResponseBytes: policy.maxResponseBytes,
      healthCheck: policy.healthCheck,
      actorClaims: policy.actorClaims,
      detail: 'Service connection policy updated from Admin operations.',
    },
    secretRefs: policy.secretRefs,
    health: {
      status: connection.status === 'ready' ? 'ready' : 'warning',
      required: connection.required,
      lastTestAt: connection.lastTestAt,
      lastError: connection.lastError,
    },
    metadata: {
      source: connection.source,
    },
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.updated',
    metadata: {
      connectionId: connection.id,
      connectionStoreId: saved.connectionId,
      service: connection.service,
      provider: connection.provider,
      policy,
      reason: input.reason ?? 'Admin service connection policy updated',
    },
  });
}

export async function applyAdminServiceConnectionLogRetention(
  session: ModuleHostSession,
  input: {
    retentionDays?: number;
    reason?: string;
  } = {}
) {
  assertAdminSession(session);
  const retentionDays = boundedConnectionNumber(input.retentionDays, 30, 0, 3650);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const hostRuntime = await getHostRuntime();
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEMO_PRODUCT_ID,
  });
  const matched = auditLogs.filter(
    (record) =>
      record.type.startsWith('admin.connection.') &&
      record.type !== 'admin.connection.retention_applied' &&
      record.createdAt <= cutoff
  ).length;

  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.retention_applied',
    metadata: {
      retentionDays,
      cutoff,
      mode: 'hide-before-cutoff',
      matched,
      reason: input.reason ?? 'Admin connection call log retention applied',
    },
  });
}

export type AdminServiceConnectionStatus = 'ready' | 'warning' | 'blocked' | 'disabled';

export interface AdminServiceConnectionRow {
  id: string;
  source: 'host' | 'module' | 'custom';
  moduleId?: string;
  service: string;
  provider: string;
  status: AdminServiceConnectionStatus;
  required: boolean;
  environment: string;
  ownerType: 'system' | 'module' | 'workspace' | 'user';
  scopeType: 'global' | 'workspace' | 'user';
  workspaceId?: string | null;
  authType: 'none' | 'apiKey' | 'basic' | 'oauth' | 'webhook' | 'env';
  secretSource: string;
  secretRefs: Record<string, string>;
  baseUrl: string;
  timeoutMs: number;
  retry: string;
  maxResponseBytes: number;
  healthCheck: string;
  detail: string;
  actorClaims?: string;
  policyUpdatedAt?: string;
  lastTestAt?: string;
  lastError?: string;
}

export interface AdminConnectionLogRetentionView {
  retentionDays?: number;
  cutoff?: string;
  appliedAt?: string;
  hiddenCount: number;
  visibleCount: number;
}

export interface AdminServiceConnectionsView {
  runtimeStore: ReturnType<typeof createServiceConnectionsHealth>['runtimeStore'];
  files: ReturnType<typeof createServiceConnectionsHealth>['files'];
  billing: ReturnType<typeof createServiceConnectionsHealth>['billing'];
  auth: ReturnType<typeof createServiceConnectionsHealth>['auth'];
  providers: ReturnType<typeof createServiceConnectionsHealth>['providers'];
  security: ReturnType<typeof createServiceConnectionsHealth>['security'];
  configDoctor: Awaited<ReturnType<typeof runHostConfigDoctor>>;
  summary: Record<AdminServiceConnectionStatus, number>;
  connections: AdminServiceConnectionRow[];
  retention: AdminConnectionLogRetentionView;
  callLogs: RuntimeStoreAuditRecord[];
}

function createServiceConnectionsHealth(
  configDoctor: Awaited<ReturnType<typeof runHostConfigDoctor>>
) {
  return {
    runtimeStore: configDoctor.health.store,
    files: configDoctor.health.files,
    billing: configDoctor.health.billing,
    auth: configDoctor.health.auth,
    providers: configDoctor.health.providers,
    security: configDoctor.health.security,
  };
}

interface AdminServiceConnectionHealthCheckResult {
  result: 'succeeded' | 'failed';
  status: AdminServiceConnectionStatus;
  latencyMs: number;
  target?: string;
  responseStatus?: number;
  error?: string;
}

function deterministicConnectionLatency(connectionId: string): number {
  return (
    20 + Math.abs(Array.from(connectionId).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 90)
  );
}

function resolveAdminServiceSecretRef(ref: string): string | null {
  if (ref.startsWith('env:')) {
    return process.env[ref.slice(4)] ?? null;
  }
  return null;
}

function isPrivateServiceConnectionHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }
  if (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  ) {
    return true;
  }
  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function serviceConnectionBasePath(base: URL): string {
  if (!base.pathname || base.pathname === '/') {
    return '';
  }
  return base.pathname.replace(/\/+$/, '');
}

function serviceConnectionPathWithinBase(pathname: string, basePath: string): boolean {
  return !basePath || pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function joinServiceConnectionPath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!basePath || serviceConnectionPathWithinBase(normalizedPath, basePath)) {
    return normalizedPath;
  }
  return `${basePath}${normalizedPath}`;
}

function normalizeHealthCheckPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'provider readiness' || trimmed === 'declaration only') {
    return '/';
  }
  return trimmed;
}

function serviceHealthOperationInput(
  connection: AdminServiceConnectionRow
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const healthPath = normalizeHealthCheckPath(connection.healthCheck);
  if (healthPath !== '/') {
    input.path = healthPath;
  }
  return input;
}

function serviceHealthProbeOperation(
  sourceOperation: ModuleServiceOperationDefinition
): ModuleServiceOperationDefinition {
  return {
    method: 'GET',
    input: {
      allow: ['path', 'query'],
      claimsAllow: sourceOperation.input?.claimsAllow,
    },
    auth: sourceOperation.auth,
    signing: sourceOperation.signing,
    request: {
      body: 'none',
    },
    response: {
      body: 'text',
      maxBytes: 16 * 1024,
    },
    redaction: sourceOperation.redaction,
  };
}

async function runAdminSignedServiceConnectionHealthCheck(input: {
  session: ModuleHostSession;
  connection: AdminServiceConnectionRow;
  contract: ModuleRuntimeContract;
  fetchImpl: typeof fetch;
  store: RuntimeStore;
}): Promise<AdminServiceConnectionHealthCheckResult | null> {
  const requirement = input.contract.serviceRequirements[input.connection.service];
  if (requirement?.kind !== 'signed-http') {
    return null;
  }
  const sourceOperation = Object.values(requirement.operations ?? {})[0];
  if (!sourceOperation) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: deterministicConnectionLatency(input.connection.id),
      target: input.connection.baseUrl,
      error: 'MODULE_SERVICE_OPERATION_MISSING',
    };
  }
  const probeOperationName = 'admin.healthcheck';
  const probeContract: ModuleRuntimeContract = {
    ...input.contract,
    serviceRequirements: {
      ...input.contract.serviceRequirements,
      [input.connection.service]: {
        ...requirement,
        operations: {
          ...requirement.operations,
          [probeOperationName]: serviceHealthProbeOperation(sourceOperation),
        },
      },
    },
  };
  const startedAt = Date.now();
  const services = createServiceInvocationRuntime({
    contract: probeContract,
    store: input.store,
    session: {
      ...input.session,
      productId: DEMO_PRODUCT_ID,
      workspaceId:
        input.connection.workspaceId ?? input.session.workspaceId ?? DEFAULT_HOST_WORKSPACE_ID,
    },
    request: {
      id: `admin-service-test:${input.connection.id}:${Date.now()}`,
      correlationId: `admin-service-test:${input.connection.id}`,
      method: 'POST',
      path: '/admin/service-connections/test',
    },
    fetchImpl: input.fetchImpl,
    readinessProbe: true,
    secretResolver: resolveAdminServiceSecretRef,
  });
  try {
    const result = (await services.invoke(
      input.connection.service,
      probeOperationName,
      serviceHealthOperationInput(input.connection),
      {
        correlationId: `admin-service-test:${input.connection.id}`,
      }
    )) as { ok?: boolean; status?: number; url?: string };
    const succeeded = result.ok !== false;
    return {
      result: succeeded ? 'succeeded' : 'failed',
      status: succeeded ? 'ready' : 'warning',
      latencyMs: Date.now() - startedAt,
      target: result.url ?? input.connection.baseUrl,
      responseStatus: result.status,
      error: succeeded ? undefined : `HTTP ${result.status ?? 'unknown'}`,
    };
  } catch (error) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: Date.now() - startedAt,
      target: input.connection.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveAdminServiceConnectionHealthUrl(connection: AdminServiceConnectionRow): URL | null {
  let base: URL;
  try {
    base = new URL(connection.baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    return null;
  }
  const healthPath = normalizeHealthCheckPath(connection.healthCheck);
  let target: URL;
  if (/^https?:\/\//i.test(healthPath)) {
    target = new URL(healthPath);
  } else if (healthPath.startsWith('/')) {
    target = new URL(
      joinServiceConnectionPath(serviceConnectionBasePath(base), healthPath),
      base.origin
    );
  } else {
    const baseHref = connection.baseUrl.endsWith('/')
      ? connection.baseUrl
      : `${connection.baseUrl}/`;
    target = new URL(healthPath, baseHref);
  }
  if (target.origin !== base.origin) {
    throw new Error(`ADMIN_CONNECTION_HEALTHCHECK_EGRESS_DENIED: ${target.origin}`);
  }
  if (isPrivateServiceConnectionHostname(target.hostname)) {
    throw new Error(`ADMIN_CONNECTION_HEALTHCHECK_PRIVATE_NETWORK_DENIED: ${target.hostname}`);
  }
  if (!serviceConnectionPathWithinBase(target.pathname, serviceConnectionBasePath(base))) {
    throw new Error(`ADMIN_CONNECTION_HEALTHCHECK_PATH_DENIED: ${target.pathname}`);
  }
  return target;
}

async function fetchAdminServiceConnectionHealth(
  fetchImpl: typeof fetch,
  url: URL,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runAdminServiceConnectionHealthCheck(
  connection: AdminServiceConnectionRow,
  fetchImpl: typeof fetch
): Promise<AdminServiceConnectionHealthCheckResult> {
  const startedAt = Date.now();
  if (connection.status === 'disabled') {
    return {
      result: 'failed',
      status: 'blocked',
      latencyMs: deterministicConnectionLatency(connection.id),
      target: connection.baseUrl,
      error: connection.detail,
    };
  }

  let target: URL | null;
  try {
    target = resolveAdminServiceConnectionHealthUrl(connection);
  } catch (error) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: Date.now() - startedAt,
      target: connection.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!target) {
    return {
      result: 'succeeded',
      status: 'ready',
      latencyMs: deterministicConnectionLatency(connection.id),
      target: connection.baseUrl,
    };
  }

  try {
    const response = await fetchAdminServiceConnectionHealth(
      fetchImpl,
      target,
      connection.timeoutMs
    );
    const succeeded = response.ok;
    return {
      result: succeeded ? 'succeeded' : 'failed',
      status: succeeded ? 'ready' : 'warning',
      latencyMs: Date.now() - startedAt,
      target: target.toString(),
      responseStatus: response.status,
      error: succeeded ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: Date.now() - startedAt,
      target: target.toString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeProviderId(value: string | undefined): string {
  const id = (value ?? '').toLowerCase();
  if (
    ['postgres', 'database', 'runtime-store', 'runtime_store'].some((token) => id.includes(token))
  ) {
    return 'runtime-store';
  }
  if (['s3', 'file', 'storage'].some((token) => id.includes(token))) {
    return 'files';
  }
  if (['stripe', 'billing', 'payment'].some((token) => id.includes(token))) {
    return 'billing';
  }
  if (['email', 'mail'].some((token) => id.includes(token))) {
    return 'email';
  }
  if (['openai', 'ai'].some((token) => id.includes(token))) {
    return 'ai';
  }
  if (['rag', 'vector'].some((token) => id.includes(token))) {
    return 'rag';
  }
  if (['notification'].some((token) => id.includes(token))) {
    return 'notifications';
  }
  return id || 'custom';
}

function inferAuthType(providerId: string): AdminServiceConnectionRow['authType'] {
  if (providerId === 'auth') {
    return 'env';
  }
  if (providerId === 'email' || providerId === 'billing') {
    return 'webhook';
  }
  if (providerId === 'runtime-store') {
    return 'env';
  }
  if (providerId === 'files' || providerId === 'ai') {
    return 'apiKey';
  }
  return 'none';
}

function inferSecretSource(providerId: string): string {
  if (providerId === 'runtime-store') {
    return 'env:DATABASE_URL';
  }
  if (providerId === 'files') {
    return 'env:PLOYKIT_S3_*';
  }
  if (providerId === 'billing') {
    return 'env:STRIPE_*';
  }
  if (providerId === 'email') {
    return 'env:PLOYKIT_EMAIL_*';
  }
  if (providerId === 'ai') {
    return 'env:AI_PROVIDER_*';
  }
  if (providerId === 'auth') {
    return 'env:PLOYKIT_AUTH_SECRET';
  }
  return 'none';
}

function inferBaseUrl(providerId: string): string {
  if (providerId === 'runtime-store') {
    return 'postgres://configured-by-env';
  }
  if (providerId === 'files') {
    return 's3://configured-bucket';
  }
  if (providerId === 'billing') {
    return 'https://api.stripe.com';
  }
  if (providerId === 'email') {
    return 'webhook://email-provider';
  }
  return 'local://host-runtime';
}

function normalizeCustomConnectionId(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!id) {
    throw new Error('ADMIN_CONNECTION_ID_REQUIRED');
  }
  return id.startsWith('custom:') ? id : `custom:${id}`;
}

function normalizeConnectionAuthType(
  value: string | undefined
): AdminServiceConnectionRow['authType'] {
  if (
    value === 'none' ||
    value === 'apiKey' ||
    value === 'basic' ||
    value === 'oauth' ||
    value === 'webhook' ||
    value === 'env'
  ) {
    return value;
  }
  return 'none';
}

function normalizeConnectionOwnerType(
  value: string | undefined
): AdminServiceConnectionRow['ownerType'] {
  if (value === 'system' || value === 'module' || value === 'workspace' || value === 'user') {
    return value;
  }
  return 'workspace';
}

function normalizeConnectionScopeType(
  value: string | undefined
): AdminServiceConnectionRow['scopeType'] {
  if (value === 'global' || value === 'workspace' || value === 'user') {
    return value;
  }
  return 'workspace';
}

function normalizeCredentialRef(value: string | undefined): string {
  const ref = value?.trim();
  if (!ref || ref === 'none' || ref === '[REDACTED]') {
    return 'none';
  }
  if (ref.startsWith('env:')) {
    return ref;
  }
  throw new Error('ADMIN_CONNECTION_SECRET_SOURCE_UNSUPPORTED');
}

function normalizeSecretRefs(input: {
  secretSource?: string;
  secretRefs?: Record<string, string>;
}): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const [name, ref] of Object.entries(input.secretRefs ?? {})) {
    const normalized = normalizeCredentialRef(ref);
    if (normalized !== 'none') {
      refs[name] = normalized;
    }
  }
  const credentialRef = normalizeCredentialRef(input.secretSource);
  if (credentialRef !== 'none' && (input.secretSource !== undefined || !refs.credential)) {
    refs.credential = credentialRef;
  }
  return refs;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = metadataRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function normalizeConnectionUrl(value: string | undefined): string {
  const url = value?.trim() || 'local://host-runtime';
  try {
    const parsed = new URL(url);
    if (
      !['http:', 'https:', 'postgres:', 's3:', 'webhook:', 'local:', 'resource:'].includes(
        parsed.protocol
      )
    ) {
      throw new Error('unsupported protocol');
    }
    return url;
  } catch {
    throw new Error(`ADMIN_CONNECTION_BASE_URL_INVALID: ${url}`);
  }
}

function boundedConnectionNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const next = Number(value ?? fallback);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(next), min), max);
}

function normalizeConnectionPolicyInput(input: AdminServiceConnectionPolicyInput) {
  const authType = normalizeConnectionAuthType(input.authType);
  const secretRefs = normalizeSecretRefs(input);
  return {
    connectionId: input.connectionId,
    service: (input.service ?? 'custom').trim(),
    provider: (input.provider ?? 'custom').trim(),
    moduleId: input.moduleId?.trim() || undefined,
    workspaceId: input.workspaceId === undefined ? DEFAULT_HOST_WORKSPACE_ID : input.workspaceId,
    environment:
      input.environment?.trim() || process.env.PLOYKIT_ENV || process.env.NODE_ENV || 'development',
    ownerType: normalizeConnectionOwnerType(input.ownerType),
    scopeType: normalizeConnectionScopeType(input.scopeType),
    authType,
    credentialRef: secretRefs.credential ?? 'none',
    secretRefs,
    baseUrl: normalizeConnectionUrl(input.baseUrl),
    timeoutMs: boundedConnectionNumber(input.timeoutMs, 8000, 100, 120_000),
    retry: input.retry?.trim() || '2 attempts / exponential',
    maxResponseBytes: boundedConnectionNumber(
      input.maxResponseBytes,
      512 * 1024,
      1024,
      50 * 1024 * 1024
    ),
    healthCheck: input.healthCheck?.trim() || 'provider readiness',
    actorClaims: input.actorClaims?.trim() || 'system',
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function applyConnectionCallLogRetention(logs: readonly RuntimeStoreAuditRecord[]): {
  visibleLogs: RuntimeStoreAuditRecord[];
  retention: AdminConnectionLogRetentionView;
} {
  const connectionLogs = logs.filter((record) => record.type.startsWith('admin.connection.'));
  const marker = connectionLogs
    .filter((record) => record.type === 'admin.connection.retention_applied')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const cutoff = marker ? stringMetadata(marker.metadata.cutoff) : undefined;
  const retentionDays = marker ? numberMetadata(marker.metadata.retentionDays) : undefined;
  const visibleLogs = cutoff
    ? connectionLogs.filter(
        (record) =>
          record.type === 'admin.connection.retention_applied' || record.createdAt > cutoff
      )
    : connectionLogs;

  return {
    visibleLogs,
    retention: {
      retentionDays,
      cutoff,
      appliedAt: marker?.createdAt,
      hiddenCount: connectionLogs.length - visibleLogs.length,
      visibleCount: visibleLogs.length,
    },
  };
}

function policyFromAuditMetadata(metadata: Record<string, unknown>) {
  const policy = metadataRecord(metadata.policy);
  const connectionId = stringMetadata(policy.connectionId) ?? stringMetadata(metadata.connectionId);
  if (!connectionId) {
    return null;
  }
  return {
    connectionId,
    service: stringMetadata(policy.service) ?? 'custom',
    provider: stringMetadata(policy.provider) ?? 'custom',
    moduleId: stringMetadata(policy.moduleId),
    workspaceId:
      typeof policy.workspaceId === 'string' || policy.workspaceId === null
        ? policy.workspaceId
        : DEFAULT_HOST_WORKSPACE_ID,
    environment:
      stringMetadata(policy.environment) ??
      process.env.PLOYKIT_ENV ??
      process.env.NODE_ENV ??
      'development',
    ownerType: normalizeConnectionOwnerType(stringMetadata(policy.ownerType)),
    scopeType: normalizeConnectionScopeType(stringMetadata(policy.scopeType)),
    authType: normalizeConnectionAuthType(stringMetadata(policy.authType)),
    credentialRef: normalizeCredentialRef(stringMetadata(policy.credentialRef)),
    secretRefs: normalizeSecretRefs({
      secretSource: stringMetadata(policy.credentialRef),
      secretRefs: stringRecord(policy.secretRefs),
    }),
    baseUrl: normalizeConnectionUrl(stringMetadata(policy.baseUrl)),
    timeoutMs: boundedConnectionNumber(numberMetadata(policy.timeoutMs), 8000, 100, 120_000),
    retry: stringMetadata(policy.retry) ?? '2 attempts / exponential',
    maxResponseBytes: boundedConnectionNumber(
      numberMetadata(policy.maxResponseBytes),
      512 * 1024,
      1024,
      50 * 1024 * 1024
    ),
    healthCheck: stringMetadata(policy.healthCheck) ?? 'provider readiness',
    actorClaims: stringMetadata(policy.actorClaims) ?? 'system',
  };
}

function rowFromConnectionPolicy(
  policy: NonNullable<ReturnType<typeof policyFromAuditMetadata>>,
  createdAt: string
): AdminServiceConnectionRow {
  return {
    id: policy.connectionId,
    source: 'custom',
    moduleId: policy.moduleId,
    service: policy.service,
    provider: policy.provider,
    status: 'warning',
    required: false,
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    workspaceId: policy.workspaceId,
    authType: policy.authType,
    secretSource: policy.credentialRef,
    secretRefs: policy.secretRefs,
    baseUrl: policy.baseUrl,
    timeoutMs: policy.timeoutMs,
    retry: policy.retry,
    maxResponseBytes: policy.maxResponseBytes,
    healthCheck: policy.healthCheck,
    detail: 'Custom service connection created from Admin operations.',
    actorClaims: policy.actorClaims,
    policyUpdatedAt: createdAt,
  };
}

function applyConnectionPolicy(
  row: AdminServiceConnectionRow,
  policy: NonNullable<ReturnType<typeof policyFromAuditMetadata>>,
  updatedAt: string
): AdminServiceConnectionRow {
  return {
    ...row,
    service: policy.service,
    provider: policy.provider,
    moduleId: policy.moduleId ?? row.moduleId,
    workspaceId: policy.workspaceId,
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    authType: policy.authType,
    secretSource: policy.credentialRef,
    secretRefs: policy.secretRefs,
    baseUrl: policy.baseUrl,
    timeoutMs: policy.timeoutMs,
    retry: policy.retry,
    maxResponseBytes: policy.maxResponseBytes,
    healthCheck: policy.healthCheck,
    actorClaims: policy.actorClaims,
    policyUpdatedAt: updatedAt,
    detail: row.detail.includes('policy updated by admin')
      ? row.detail
      : `${row.detail}; policy updated by admin`,
  };
}

function rowFromServiceConnection(
  record: RuntimeStoreServiceConnectionRecord
): AdminServiceConnectionRow {
  const health = metadataRecord(record.health);
  const statusFromHealth =
    health.status === 'ready' || health.status === 'warning' || health.status === 'blocked'
      ? (health.status as AdminServiceConnectionStatus)
      : undefined;
  return {
    id: record.connectionId,
    source: record.moduleId ? 'module' : 'custom',
    moduleId: record.moduleId ?? undefined,
    service: record.service,
    provider: record.provider,
    status:
      record.status === 'disabled' || record.status === 'blocked'
        ? record.status
        : (statusFromHealth ?? 'warning'),
    required: Boolean(health.required),
    environment:
      record.environment ?? process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
    ownerType: normalizeConnectionOwnerType(stringMetadata(record.ownerType)),
    scopeType: normalizeConnectionScopeType(stringMetadata(record.scopeType)),
    workspaceId: record.workspaceId ?? undefined,
    authType: normalizeConnectionAuthType(stringMetadata(record.authType)),
    secretSource: stringMetadata(record.secretRefs.credential) ?? 'none',
    secretRefs: record.secretRefs,
    baseUrl: stringMetadata(record.config.baseUrl) ?? 'local://host-runtime',
    timeoutMs: numberMetadata(record.config.timeoutMs) ?? 8000,
    retry: stringMetadata(record.config.retry) ?? '2 attempts / exponential',
    maxResponseBytes: numberMetadata(record.config.maxResponseBytes) ?? 512 * 1024,
    healthCheck: stringMetadata(record.config.healthCheck) ?? 'provider readiness',
    detail: stringMetadata(record.config.detail) ?? 'Service connection from typed store.',
    actorClaims: stringMetadata(record.config.actorClaims) ?? 'system',
    policyUpdatedAt: record.updatedAt,
    lastTestAt: stringMetadata(health.lastTestAt),
    lastError: stringMetadata(health.lastError),
  };
}

function rowFromResourceBinding(
  record: RuntimeStoreResourceBindingRecord
): AdminServiceConnectionRow {
  const metadata = metadataRecord(record.metadata);
  const health = metadataRecord(metadata.health);
  const serviceConnection = metadataRecord(metadata.serviceConnection);
  const status =
    record.status === 'disabled'
      ? 'disabled'
      : health.status === 'ready' || health.status === 'warning' || health.status === 'blocked'
        ? (health.status as AdminServiceConnectionStatus)
        : 'warning';
  const connectionId =
    stringMetadata(serviceConnection.connectionId) ?? stringMetadata(metadata.serviceConnectionId);
  return {
    id: record.moduleId
      ? `${record.moduleId}:resource:${record.name}`
      : `shared:resource:${record.name}`,
    source: record.moduleId ? 'module' : 'custom',
    moduleId: record.moduleId ?? undefined,
    service: record.name,
    provider: record.kind ?? stringMetadata(serviceConnection.provider) ?? 'resource',
    status,
    required: Boolean(metadata.required),
    environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
    ownerType: record.moduleId ? 'module' : 'workspace',
    scopeType: record.workspaceId ? 'workspace' : 'global',
    workspaceId: record.workspaceId ?? undefined,
    authType: 'none',
    secretSource: connectionId ? `connection:${connectionId}` : 'resource-binding',
    secretRefs: {},
    baseUrl: connectionId
      ? `service-connection://${connectionId}`
      : `resource://${record.kind ?? 'binding'}`,
    timeoutMs: numberMetadata(metadata.timeoutMs) ?? 8000,
    retry: stringMetadata(metadata.retry) ?? 'host policy',
    maxResponseBytes: numberMetadata(metadata.maxResponseBytes) ?? 512 * 1024,
    healthCheck: stringMetadata(metadata.healthCheck) ?? 'resource binding health',
    detail:
      stringMetadata(metadata.detail) ??
      (connectionId
        ? `Resource binding linked to service connection ${connectionId}.`
        : 'Resource binding from typed store.'),
    actorClaims: stringMetadata(metadata.actorClaims) ?? 'module',
    policyUpdatedAt: record.updatedAt,
    lastTestAt: stringMetadata(health.lastTestAt),
    lastError: stringMetadata(health.lastError),
  };
}

function serviceConnectionStoreInput(
  session: ModuleHostSession,
  row: AdminServiceConnectionRow,
  status: 'active' | 'disabled' = row.status === 'disabled' ? 'disabled' : 'active'
) {
  return {
    productId: DEMO_PRODUCT_ID,
    workspaceId: row.workspaceId ?? session.workspaceId ?? null,
    moduleId: row.moduleId ?? null,
    actorId: session.actorId ?? session.user?.id ?? null,
    connectionId: row.id,
    service: row.service,
    provider: row.provider,
    status,
    environment: row.environment,
    ownerType: row.ownerType,
    scopeType: row.scopeType,
    authType: row.authType,
    config: {
      baseUrl: row.baseUrl,
      timeoutMs: row.timeoutMs,
      retry: row.retry,
      maxResponseBytes: row.maxResponseBytes,
      healthCheck: row.healthCheck,
      actorClaims: row.actorClaims,
      detail: row.detail,
    },
    secretRefs:
      Object.keys(row.secretRefs).length > 0
        ? row.secretRefs
        : {
            credential: row.secretSource,
          },
    health: {
      status: row.status,
      required: row.required,
      lastTestAt: row.lastTestAt,
      lastError: row.lastError,
    },
    metadata: {
      source: row.source,
    },
  };
}

function hostConnectionFromReadiness(item: HostProviderReadiness): AdminServiceConnectionRow {
  const providerId = normalizeProviderId(item.id);
  return {
    id: `host:${item.id}`,
    source: 'host',
    service: item.id,
    provider: item.mode,
    status: item.status,
    required: item.status === 'blocked',
    environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
    ownerType: 'system',
    scopeType: 'global',
    authType: inferAuthType(providerId),
    secretSource: inferSecretSource(providerId),
    secretRefs: {
      credential: inferSecretSource(providerId),
    },
    baseUrl: inferBaseUrl(providerId),
    timeoutMs: 8000,
    retry: '2 attempts / exponential',
    maxResponseBytes: 512 * 1024,
    healthCheck: item.id === 'runtime-store' ? 'select 1' : 'provider readiness',
    detail: item.detail,
  };
}

function applyConnectionAuditState(
  rows: AdminServiceConnectionRow[],
  logs: readonly RuntimeStoreAuditRecord[]
): AdminServiceConnectionRow[] {
  const logsByConnection = new Map<string, RuntimeStoreAuditRecord[]>();
  for (const log of logs
    .filter((record) => record.type.startsWith('admin.connection.'))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const connectionId = String(log.metadata.connectionId ?? '');
    if (connectionId) {
      logsByConnection.set(connectionId, [...(logsByConnection.get(connectionId) ?? []), log]);
    }
  }

  return rows.map((row) => {
    const rowLogs = logsByConnection.get(row.id);
    if (!rowLogs?.length) {
      return row;
    }
    let next: AdminServiceConnectionRow = { ...row };
    for (const log of rowLogs) {
      if (log.type === 'admin.connection.created' || log.type === 'admin.connection.updated') {
        const policy = policyFromAuditMetadata(log.metadata);
        if (policy && policy.connectionId === row.id) {
          next = applyConnectionPolicy(next, policy, log.createdAt);
        }
      }
      if (log.type === 'admin.connection.disabled') {
        next = {
          ...next,
          status: 'disabled',
          detail: next.detail.includes('disabled by admin')
            ? next.detail
            : `${next.detail}; disabled by admin`,
        };
      }
      if (log.type === 'admin.connection.enabled') {
        next = {
          ...next,
          status: row.status,
          detail: row.detail,
        };
      }
      if (log.type === 'admin.connection.tested') {
        next = {
          ...next,
          lastTestAt: log.createdAt,
          lastError:
            log.metadata.result === 'failed'
              ? String(log.metadata.error ?? 'test failed')
              : undefined,
        };
      }
      if (log.type === 'admin.connection.secret_rotated') {
        next = {
          ...next,
          secretSource: '[REDACTED]',
        };
      }
    }
    return next;
  });
}

function customConnectionRowsFromAudit(
  logs: readonly RuntimeStoreAuditRecord[]
): AdminServiceConnectionRow[] {
  const created = new Map<string, RuntimeStoreAuditRecord>();
  for (const log of logs
    .filter((record) => record.type === 'admin.connection.created')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const policy = policyFromAuditMetadata(log.metadata);
    if (policy?.connectionId) {
      created.set(policy.connectionId, log);
    }
  }
  return [...created.values()]
    .map((log) => {
      const policy = policyFromAuditMetadata(log.metadata);
      return policy ? rowFromConnectionPolicy(policy, log.createdAt) : null;
    })
    .filter((row): row is AdminServiceConnectionRow => Boolean(row));
}

function buildServiceConnectionRows(input: {
  contracts: readonly ModuleRuntimeContract[];
  providerReadiness: readonly HostProviderReadiness[];
  storedConnections: readonly RuntimeStoreServiceConnectionRecord[];
  storedResourceBindings: readonly RuntimeStoreResourceBindingRecord[];
}): AdminServiceConnectionRow[] {
  const readinessByProvider = new Map(
    input.providerReadiness.map((item) => [normalizeProviderId(item.id), item])
  );
  const rows: AdminServiceConnectionRow[] = input.providerReadiness.map(
    hostConnectionFromReadiness
  );
  const storedRows = input.storedConnections.map(rowFromServiceConnection);
  const storedBindingRows = input.storedResourceBindings.map(rowFromResourceBinding);

  for (const contract of input.contracts) {
    for (const [name, requirement] of Object.entries(contract.serviceRequirements)) {
      const providerId = normalizeProviderId(requirement.provider ?? name);
      const readiness = readinessByProvider.get(providerId);
      const status: AdminServiceConnectionStatus = readiness
        ? readiness.status
        : requirement.required
          ? 'blocked'
          : 'warning';
      rows.push({
        id: `${contract.id}:service:${name}`,
        source: 'module',
        moduleId: contract.id,
        service: name,
        provider: requirement.provider ?? providerId,
        status,
        required: Boolean(requirement.required),
        environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
        ownerType: 'module',
        scopeType: 'workspace',
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        authType: inferAuthType(providerId),
        secretSource: inferSecretSource(providerId),
        secretRefs: {},
        baseUrl: inferBaseUrl(providerId),
        timeoutMs: 8000,
        retry: '2 attempts / exponential',
        maxResponseBytes: 512 * 1024,
        healthCheck: readiness?.id ?? 'declaration only',
        detail: [requirement.description, readiness?.detail ?? 'no provider binding found']
          .filter(Boolean)
          .join(' · '),
      });
    }

    for (const [name, binding] of Object.entries(contract.resourceBindings)) {
      const providerId = normalizeProviderId(binding.kind);
      rows.push({
        id: `${contract.id}:resource:${name}`,
        source: 'module',
        moduleId: contract.id,
        service: name,
        provider: binding.kind,
        status: binding.required ? 'blocked' : 'warning',
        required: Boolean(binding.required),
        environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
        ownerType: 'module',
        scopeType: 'workspace',
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        authType: 'none',
        secretSource: 'resource-binding',
        secretRefs: {},
        baseUrl: `resource://${binding.kind}`,
        timeoutMs: 8000,
        retry: 'host policy',
        maxResponseBytes: 512 * 1024,
        healthCheck: 'resource binding exists',
        detail: binding.description ?? 'Resource binding declared by module contract.',
      });
    }
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of [...storedRows, ...storedBindingRows]) {
    byId.set(row.id, {
      ...(byId.get(row.id) ?? row),
      ...row,
    });
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function connectionSummary(rows: readonly AdminServiceConnectionRow[]) {
  return rows.reduce<Record<AdminServiceConnectionStatus, number>>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { ready: 0, warning: 0, blocked: 0, disabled: 0 }
  );
}
