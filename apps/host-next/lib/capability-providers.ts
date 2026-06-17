import { createInMemoryModuleArtifactRuntime } from '@/lib/module-capabilities/artifacts/artifact-runtime';
import { createRuntimeStoreModuleResourceBindingsApi } from '@/lib/module-runtime/capabilities/resource-bindings';
import { getModuleConnectorDefinition } from '@/lib/module-runtime/capabilities/connectors';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { CreateModuleHostCapabilitiesOptions } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { createModuleHttpApi } from '@/lib/module-capabilities/http/http-runtime';
import { createRuntimeStoreNotificationRuntime } from '@/lib/module-capabilities/notifications/notification-runtime';
import { createServiceInvocationRuntime } from '@/lib/module-capabilities/services';
import type {
  RuntimeStore,
  RuntimeStoreServiceConnectionRecord,
} from '@/lib/module-runtime/stores/runtime-store-types';
import type {
  ModuleConnectorsApi,
  ModuleEventPublishResult,
  ModuleJobsApi,
  ModuleRunError,
  ModuleRunRecord,
  ModuleRunsApi,
} from '@ploykit/module-sdk';
import { createHostModuleAiApi } from './ai-provider';
import { createHostModuleApiKeysApi } from './capability-api-keys';
import {
  createHostCommercialRuntimeFromStore,
  type HostBillingCatalog,
} from './commercial-provider';
import { createHostFileRuntimeFromParts, type HostFileStorageHandle } from './files';
import { createHostModuleRagApi } from './rag-provider';
import type { HostRuntimeStoreHandle } from './runtime-store';
import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
  defaultProductId,
} from './default-scope';

export { createHostModuleApiKeyVerifier, createHostModuleApiKeysApi } from './capability-api-keys';

const artifactRuntime = createInMemoryModuleArtifactRuntime();
const DEFAULT_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;
const DEFAULT_WORKSPACE_ID = DEFAULT_HOST_WORKSPACE_ID;

type HostServiceConnectionStatus = 'ready' | 'warning' | 'blocked' | 'disabled';

interface HostServiceConnectionPolicy {
  connectionId: string;
  service: string;
  provider: string;
  connectorKind: string;
  operations: readonly string[];
  risk: string;
  moduleId?: string;
  workspaceId?: string | null;
  environment: string;
  authType: string;
  credentialRef: string;
  baseUrl: string;
  timeoutMs: number;
  retry: string;
  maxResponseBytes: number;
  healthCheck: string;
  actorClaims: string;
  status: HostServiceConnectionStatus;
  required: boolean;
  updatedAt?: string;
}

interface HostConnectorFetchInput {
  url?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  json?: unknown;
}

interface HostConnectorFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  attempts: number;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function metadataNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sessionOwnerId(session: ModuleHostSession): string | undefined {
  return session.userId ?? session.user?.id ?? session.actorId;
}

function createHostRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}`;
}

function serviceRequestContext(request: Request, session: ModuleHostSession) {
  const url = new URL(request.url);
  const id = session.requestId ?? request.headers.get('x-request-id') ?? createHostRequestId();
  return {
    id,
    correlationId: request.headers.get('x-correlation-id') ?? id,
    method: request.method,
    path: url.pathname,
  };
}

function resolveHostServiceSecretRef(ref: string): string | null {
  if (ref.startsWith('env:')) {
    return process.env[ref.slice(4)] ?? null;
  }
  return null;
}

function parseServiceOriginRewrite(value: string | undefined): Record<string, string> | undefined {
  const allowProductionRewrite =
    process.env.PLOYKIT_ALLOW_SERVICE_E2E_ORIGIN_MAP_IN_PRODUCTION === '1';
  if (!value || (process.env.NODE_ENV === 'production' && !allowProductionRewrite)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const rewrites = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([from, to]) => [new URL(from).origin, new URL(to).origin] as const);
    return rewrites.length > 0 ? Object.fromEntries(rewrites) : undefined;
  } catch {
    return undefined;
  }
}

function createServiceE2ePrivateNetworkResolver(originRewrite: Record<string, string> | undefined) {
  if (!originRewrite) {
    return undefined;
  }
  const rewrittenHosts = new Set(
    Object.keys(originRewrite).map((origin) => new URL(origin).hostname)
  );
  return async (hostname: string): Promise<readonly string[]> =>
    rewrittenHosts.has(hostname) ? ['203.0.113.10'] : [];
}

function withRunOwner<TInput>(value: TInput | undefined, ownerId: string | undefined): unknown {
  if (!ownerId) {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), ownerId };
  }
  if (value === undefined) {
    return { ownerId };
  }
  return { value, ownerId };
}

function normalizeRunProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function normalizeRunError(error: ModuleRunError | Error | string): {
  code: string;
  message: string;
} {
  if (typeof error === 'string') {
    return { code: 'MODULE_RUN_FAILED', message: error };
  }
  if ('code' in error && typeof error.code === 'string') {
    return { code: error.code, message: error.message };
  }
  return {
    code: error instanceof Error ? error.name || 'MODULE_RUN_FAILED' : 'MODULE_RUN_FAILED',
    message: error.message,
  };
}

function boundedPolicyNumber(
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

function normalizePolicyUrl(value: string | undefined): string {
  const candidate = value?.trim() || 'local://host-runtime';
  try {
    const parsed = new URL(candidate);
    if (
      !['http:', 'https:', 'postgres:', 's3:', 'webhook:', 'local:', 'resource:'].includes(
        parsed.protocol
      )
    ) {
      return 'local://host-runtime';
    }
    return candidate;
  } catch {
    return 'local://host-runtime';
  }
}

function normalizeEgressOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function baseConnectionFromServiceRequirement(
  contract: ModuleRuntimeContract,
  name: string
): HostServiceConnectionPolicy {
  const requirement = contract.serviceRequirements[name]!;
  return {
    connectionId: `${contract.id}:service:${name}`,
    service: name,
    provider: requirement.provider ?? name,
    connectorKind: getModuleConnectorDefinition(requirement.provider ?? name).kind,
    operations: getModuleConnectorDefinition(requirement.provider ?? name).operations,
    risk: getModuleConnectorDefinition(requirement.provider ?? name).risk,
    moduleId: contract.id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
    authType: 'none',
    credentialRef: 'none',
    baseUrl: 'local://host-runtime',
    timeoutMs: 8000,
    retry: '2 attempts / exponential',
    maxResponseBytes: 512 * 1024,
    healthCheck: 'declaration only',
    actorClaims: 'module',
    status: requirement.required ? 'blocked' : 'warning',
    required: Boolean(requirement.required),
  };
}

function policyFromServiceConnectionRecord(
  record: RuntimeStoreServiceConnectionRecord
): HostServiceConnectionPolicy {
  const config = metadataRecord(record.config);
  const health = metadataRecord(record.health);
  const healthStatus =
    health.status === 'ready' || health.status === 'warning' || health.status === 'blocked'
      ? health.status
      : 'warning';
  return {
    connectionId: record.connectionId,
    service: record.service,
    provider: record.provider,
    connectorKind:
      metadataString(config.connectorKind) ?? getModuleConnectorDefinition(record.provider).kind,
    operations: Array.isArray(config.operations)
      ? config.operations.filter((item): item is string => typeof item === 'string')
      : getModuleConnectorDefinition(record.provider).operations,
    risk: metadataString(config.risk) ?? getModuleConnectorDefinition(record.provider).risk,
    moduleId: record.moduleId ?? undefined,
    workspaceId: record.workspaceId,
    environment:
      metadataString(record.environment) ??
      process.env.PLOYKIT_ENV ??
      process.env.NODE_ENV ??
      'development',
    authType: metadataString(record.authType) ?? 'none',
    credentialRef: metadataString(record.secretRefs.credential) ?? 'none',
    baseUrl: normalizePolicyUrl(metadataString(config.baseUrl)),
    timeoutMs: boundedPolicyNumber(metadataNumber(config.timeoutMs), 8000, 100, 120_000),
    retry: metadataString(config.retry) ?? '2 attempts / exponential',
    maxResponseBytes: boundedPolicyNumber(
      metadataNumber(config.maxResponseBytes),
      512 * 1024,
      1024,
      50 * 1024 * 1024
    ),
    healthCheck: metadataString(config.healthCheck) ?? 'provider readiness',
    actorClaims: metadataString(config.actorClaims) ?? 'system',
    status:
      record.status === 'disabled' || record.status === 'blocked' ? record.status : healthStatus,
    required: Boolean(health.required),
    updatedAt: record.updatedAt,
  };
}

function applyPolicyOverlay(
  current: HostServiceConnectionPolicy | undefined,
  policy: HostServiceConnectionPolicy
): HostServiceConnectionPolicy {
  return {
    ...(current ?? policy),
    ...policy,
    status: policy.status,
    required: policy.required || Boolean(current?.required),
  };
}

async function loadConnectionPolicies(input: {
  store: RuntimeStore;
  contract: ModuleRuntimeContract;
  session: ModuleHostSession;
}): Promise<HostServiceConnectionPolicy[]> {
  const byId = new Map<string, HostServiceConnectionPolicy>();
  for (const name of Object.keys(input.contract.serviceRequirements)) {
    const connection = baseConnectionFromServiceRequirement(input.contract, name);
    byId.set(connection.connectionId, connection);
  }

  const storedConnections = await input.store.listServiceConnections({
    productId: defaultProductId(input.session.productId),
  });
  for (const record of storedConnections) {
    const policy = policyFromServiceConnectionRecord(record);
    const current = byId.get(policy.connectionId);
    byId.set(policy.connectionId, applyPolicyOverlay(current, policy));
    if (!current) {
      byId.set(policy.connectionId, policy);
    }
  }

  return [...byId.values()];
}

function workspaceMatches(
  connection: HostServiceConnectionPolicy,
  session: ModuleHostSession
): boolean {
  if (connection.workspaceId === undefined || connection.workspaceId === null) {
    return true;
  }
  return connection.workspaceId === (session.workspaceId ?? DEFAULT_WORKSPACE_ID);
}

function pickConnection(
  connections: readonly HostServiceConnectionPolicy[],
  contract: ModuleRuntimeContract,
  session: ModuleHostSession,
  name: string
): HostServiceConnectionPolicy | null {
  const moduleServiceId = `${contract.id}:service:${name}`;
  const candidates = connections.filter((connection) => workspaceMatches(connection, session));
  return (
    candidates.find((connection) => connection.connectionId === name) ??
    candidates.find((connection) => connection.connectionId === moduleServiceId) ??
    candidates.find(
      (connection) => connection.moduleId === contract.id && connection.service === name
    ) ??
    candidates.find((connection) => connection.service === name) ??
    candidates.find((connection) => connection.provider === name) ??
    null
  );
}

function toConnectorConfig(connection: HostServiceConnectionPolicy): Record<string, unknown> {
  return {
    connectionId: connection.connectionId,
    service: connection.service,
    provider: connection.provider,
    connectorKind: connection.connectorKind,
    operations: connection.operations,
    risk: connection.risk,
    moduleId: connection.moduleId,
    workspaceId: connection.workspaceId,
    environment: connection.environment,
    authType: connection.authType,
    credentialRef: connection.credentialRef,
    baseUrl: connection.baseUrl,
    timeoutMs: connection.timeoutMs,
    retry: connection.retry,
    maxResponseBytes: connection.maxResponseBytes,
    healthCheck: connection.healthCheck,
    actorClaims: connection.actorClaims,
    status: connection.status,
    required: connection.required,
    updatedAt: connection.updatedAt,
  };
}

function parseConnectorHttpInput(input: unknown): HostConnectorFetchInput {
  if (typeof input === 'string') {
    return { path: input };
  }
  return metadataRecord(input) as HostConnectorFetchInput;
}

function parseRetryAttempts(retry: string): number {
  if (/none/i.test(retry)) {
    return 1;
  }
  const match = retry.match(/\d+/);
  const attempts = match ? Number(match[0]) : 2;
  return boundedPolicyNumber(attempts, 2, 1, 5);
}

function isPrivateConnectorHostname(hostname: string): boolean {
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

function connectorBasePath(base: URL): string {
  if (!base.pathname || base.pathname === '/') {
    return '';
  }
  return base.pathname.replace(/\/+$/, '');
}

function pathWithinConnectorBase(pathname: string, basePath: string): boolean {
  return !basePath || pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function joinConnectorPath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!basePath || pathWithinConnectorBase(normalizedPath, basePath)) {
    return normalizedPath;
  }
  return `${basePath}${normalizedPath}`;
}

function assertConnectorHttpTargetAllowed(
  connection: HostServiceConnectionPolicy,
  base: URL,
  target: URL
): void {
  if (target.origin !== base.origin) {
    throw new Error(
      `MODULE_CONNECTOR_EGRESS_DENIED: ${connection.connectionId} -> ${target.origin}`
    );
  }
  if (isPrivateConnectorHostname(target.hostname)) {
    throw new Error(
      `MODULE_CONNECTOR_PRIVATE_NETWORK_DENIED: ${connection.connectionId} -> ${target.hostname}`
    );
  }
  const basePath = connectorBasePath(base);
  if (!pathWithinConnectorBase(target.pathname, basePath)) {
    throw new Error(
      `MODULE_CONNECTOR_EGRESS_PATH_DENIED: ${connection.connectionId} -> ${target.pathname}`
    );
  }
}

function resolveConnectionHttpUrl(
  connection: HostServiceConnectionPolicy,
  input: HostConnectorFetchInput
) {
  const base = new URL(connection.baseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error(`MODULE_CONNECTOR_HTTP_UNSUPPORTED_BASE_URL: ${connection.connectionId}`);
  }

  const rawUrl = input.url?.trim();
  if (rawUrl) {
    const target = new URL(rawUrl);
    assertConnectorHttpTargetAllowed(connection, base, target);
    return target;
  }

  const path = input.path?.trim() || connection.healthCheck;
  let target: URL;
  if (path.startsWith('/')) {
    target = new URL(joinConnectorPath(connectorBasePath(base), path), base.origin);
  } else {
    const baseHref = connection.baseUrl.endsWith('/')
      ? connection.baseUrl
      : `${connection.baseUrl}/`;
    target = new URL(path, baseHref);
  }
  assertConnectorHttpTargetAllowed(connection, base, target);
  return target;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function connectorErrorMessage(
  error: Error | string | { code: string; message: string } | undefined
): string | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message;
}

function requestInitFromConnectorInput(input: HostConnectorFetchInput): RequestInit {
  const headers = new Headers(input.headers);
  let body = input.body;
  if (input.json !== undefined) {
    body = JSON.stringify(input.json);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  return {
    method: (input.method ?? (body ? 'POST' : 'GET')).toUpperCase(),
    headers,
    body,
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  try {
    return await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`MODULE_CONNECTOR_TIMEOUT: ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

async function invokeConnectionHttpFetch(input: {
  connection: HostServiceConnectionPolicy;
  operationInput: unknown;
  fetchImpl: typeof fetch;
}): Promise<HostConnectorFetchResult> {
  const request = parseConnectorHttpInput(input.operationInput);
  const url = resolveConnectionHttpUrl(input.connection, request);
  const init = requestInitFromConnectorInput(request);
  const attempts = parseRetryAttempts(input.connection.retry);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        input.fetchImpl,
        url,
        init,
        input.connection.timeoutMs
      );
      const body = await response.text();
      const bytes = Buffer.byteLength(body);
      if (bytes > input.connection.maxResponseBytes) {
        throw new Error(
          `MODULE_CONNECTOR_RESPONSE_TOO_LARGE: ${bytes}/${input.connection.maxResponseBytes}`
        );
      }
      if (response.status >= 500 && attempt < attempts) {
        lastError = new Error(`MODULE_CONNECTOR_UPSTREAM_${response.status}`);
        continue;
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || url.toString(),
        headers: headersToRecord(response.headers),
        body,
        bytes,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('MODULE_CONNECTOR_FETCH_FAILED');
}

async function recordConnectorCall(input: {
  store: RuntimeStore;
  session: ModuleHostSession;
  contract: ModuleRuntimeContract;
  connection: HostServiceConnectionPolicy;
  operation: string;
  startedAt: number;
  status: 'succeeded' | 'failed';
  target?: string;
  attempts?: number;
  responseStatus?: number;
  responseBytes?: number;
  error?: Error | string | { code: string; message: string };
}) {
  await input.store.recordProviderInvocation({
    productId: input.session.productId ?? DEFAULT_PRODUCT_ID,
    workspaceId: input.connection.workspaceId ?? input.session.workspaceId ?? null,
    moduleId: input.contract.id,
    providerId: input.connection.provider,
    kind: 'connector',
    operation: input.operation,
    status: input.status,
    target: input.target ?? input.connection.baseUrl,
    serviceConnectionId: input.connection.connectionId,
    usage: {
      attempts: input.attempts,
      responseStatus: input.responseStatus,
      responseBytes: input.responseBytes,
    },
    latencyMs: Date.now() - input.startedAt,
    error: input.error,
    metadata: {
      connectorKind: input.connection.connectorKind,
      service: input.connection.service,
      risk: input.connection.risk,
      responseStatus: input.responseStatus,
    },
  });
  await input.store.recordAudit({
    productId: input.session.productId ?? DEFAULT_PRODUCT_ID,
    workspaceId: input.connection.workspaceId ?? input.session.workspaceId ?? null,
    moduleId: input.contract.id,
    actorId: input.session.actorId ?? input.session.user?.id,
    type: 'admin.connection.invoked',
    metadata: {
      connectionId: input.connection.connectionId,
      service: input.connection.service,
      provider: input.connection.provider,
      operation: input.operation,
      status: input.status,
      target: input.target ?? input.connection.baseUrl,
      latencyMs: Date.now() - input.startedAt,
      attempts: input.attempts,
      timeoutMs: input.connection.timeoutMs,
      maxResponseBytes: input.connection.maxResponseBytes,
      responseStatus: input.responseStatus,
      responseBytes: input.responseBytes,
      error: connectorErrorMessage(input.error),
    },
  });
}

function connectorHttpStatusError(result: HostConnectorFetchResult) {
  if (result.ok) {
    return undefined;
  }
  return {
    code: `MODULE_CONNECTOR_UPSTREAM_${result.status}`,
    message: `Connector upstream returned HTTP ${result.status}.`,
  };
}

export function createHostServiceConnectionsApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
  fetchImpl?: typeof fetch;
}): ModuleConnectorsApi {
  const fetchImpl = input.fetchImpl ?? fetch;

  async function resolveConnection(name: string) {
    const connections = await loadConnectionPolicies(input);
    return pickConnection(connections, input.contract, input.session, name);
  }

  return {
    async get<TConfig = unknown>(name: string): Promise<TConfig | null> {
      const connection = await resolveConnection(name);
      return connection ? (toConnectorConfig(connection) as TConfig) : null;
    },
    async invoke<TInput = unknown, TResult = unknown>(
      name: string,
      operation: string,
      operationInput: TInput
    ): Promise<TResult> {
      const connection = await resolveConnection(name);
      if (!connection) {
        throw new Error(`MODULE_CONNECTOR_MISSING: ${name}`);
      }
      const startedAt = Date.now();
      try {
        if (connection.status === 'disabled') {
          throw new Error(`MODULE_CONNECTOR_DISABLED: ${connection.connectionId}`);
        }
        if (connection.status === 'blocked') {
          throw new Error(`MODULE_CONNECTOR_BLOCKED: ${connection.connectionId}`);
        }
        if (!connection.operations.includes(operation)) {
          throw new Error(`MODULE_CONNECTOR_OPERATION_UNSUPPORTED: ${operation}`);
        }
        if (connection.connectorKind !== 'http') {
          throw new Error(`MODULE_CONNECTOR_KIND_NOT_IMPLEMENTED: ${connection.connectorKind}`);
        }
        const result = await invokeConnectionHttpFetch({
          connection,
          operationInput,
          fetchImpl,
        });
        const responseError = connectorHttpStatusError(result);
        const invocationStatus = result.ok ? 'succeeded' : 'failed';
        await input.store.touchServiceConnection(
          defaultProductId(input.session.productId),
          connection.connectionId,
          {
            health: {
              status: result.ok ? 'ready' : 'warning',
              result: result.ok ? 'succeeded' : 'failed',
              lastTestAt: new Date().toISOString(),
              lastError: responseError?.message,
              latencyMs: Date.now() - startedAt,
              connectorKind: connection.connectorKind,
            },
          }
        );
        await recordConnectorCall({
          store: input.store,
          session: input.session,
          contract: input.contract,
          connection,
          operation,
          startedAt,
          status: invocationStatus,
          target: result.url,
          attempts: result.attempts,
          responseStatus: result.status,
          responseBytes: result.bytes,
          error: responseError,
        });
        return result as TResult;
      } catch (error) {
        await input.store
          .touchServiceConnection(
            defaultProductId(input.session.productId),
            connection.connectionId,
            {
              health: {
                status: connection.status === 'disabled' ? 'blocked' : connection.status,
                result: 'failed',
                lastTestAt: new Date().toISOString(),
                lastError: error instanceof Error ? error.message : String(error),
                connectorKind: connection.connectorKind,
              },
            }
          )
          .catch(() => undefined);
        await recordConnectorCall({
          store: input.store,
          session: input.session,
          contract: input.contract,
          connection,
          operation,
          startedAt,
          status: 'failed',
          error: error instanceof Error ? error : String(error),
        });
        throw error;
      }
    },
  };
}

export function createScopedJobsApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}): ModuleJobsApi {
  return {
    async list() {
      return Object.entries(input.contract.jobs).map(([name, definition]) => ({
        moduleId: input.contract.id,
        name,
        schedule: definition.schedule,
        timeoutMs: definition.timeoutMs,
        retries: definition.retries,
      }));
    },
    async run<TInput = unknown, TResult = unknown>(
      name: string,
      jobInput?: TInput,
      options?: { idempotencyKey?: string }
    ) {
      const definition = input.contract.jobs[name];
      if (!definition) {
        throw new Error(`MODULE_JOB_NOT_FOUND: ${input.contract.id}.${name}`);
      }
      const run = await input.store.createRun({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: input.contract.id,
        kind: 'job',
        name,
        input: withRunOwner(jobInput, sessionOwnerId(input.session)),
        maxAttempts: (definition.retries ?? 0) + 1,
        idempotencyKey: options?.idempotencyKey,
      });
      await input.store.enqueueOutbox({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: input.contract.id,
        name: `job:${input.contract.id}:${name}`,
        payload: {
          runId: run.id,
          moduleId: input.contract.id,
          name,
          input: jobInput,
        },
        idempotencyKey: options?.idempotencyKey
          ? `job:${input.contract.id}:${name}:${options.idempotencyKey}`
          : undefined,
        metadata: {
          maxAttempts: (definition.retries ?? 0) + 1,
        },
      });
      return {
        run: run as ModuleRunRecord<unknown, TResult>,
        result: undefined as TResult | undefined,
      };
    },
  };
}

export function createScopedRunsApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}): ModuleRunsApi {
  const productId = defaultProductId(input.session.productId);
  const workspaceId = input.session.workspaceId ?? null;

  function belongsToScope(run: ModuleRunRecord): boolean {
    return (
      run.productId === productId &&
      (run.workspaceId ?? null) === workspaceId &&
      run.moduleId === input.contract.id
    );
  }

  async function readScopedRun(id: string): Promise<ModuleRunRecord> {
    const run = await input.store.getRun(id);
    if (!run || !belongsToScope(run)) {
      throw new Error(`MODULE_RUN_NOT_FOUND: ${input.contract.id}.${id}`);
    }
    return run;
  }

  return {
    async create<TInput = unknown>(runInput: Parameters<ModuleRunsApi['create']>[0]) {
      return input.store.createRun({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        kind: runInput.kind,
        name: runInput.name,
        input: withRunOwner(runInput.input, sessionOwnerId(input.session)) as TInput,
        maxAttempts: runInput.maxAttempts,
        costRef: runInput.costRef,
        idempotencyKey: runInput.idempotencyKey,
      });
    },
    async get<TResult = unknown>(id: string) {
      const run = await input.store.getRun(id);
      return run && belongsToScope(run) ? (run as ModuleRunRecord<unknown, TResult>) : null;
    },
    async list(query = {}) {
      const runs = await input.store.listRuns({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        kind: query.kind,
        status: query.status,
        idempotencyKey: query.idempotencyKey,
      });
      return query.name ? runs.filter((run) => run.name === query.name) : runs;
    },
    async updateProgress(id: string, progress: number) {
      const run = await readScopedRun(id);
      return input.store.updateRunStatus(id, run.status, {
        progress: normalizeRunProgress(progress),
        result: run.result,
        error: run.error,
      });
    },
    async appendLog(id: string, level, message, metadata) {
      await readScopedRun(id);
      return input.store.appendRunLog(id, level, message, metadata);
    },
    async succeed<TResult = unknown>(id: string, result?: TResult) {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'succeeded', {
        progress: 100,
        result,
      }) as Promise<ModuleRunRecord<unknown, TResult>>;
    },
    async fail(id: string, error: ModuleRunError | Error | string) {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'failed', {
        error: normalizeRunError(error),
      });
    },
    async requestCancel(id: string) {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'cancel_requested');
    },
    async cancel(id: string, reason = 'Canceled') {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'canceled', {
        error: { code: 'MODULE_RUN_CANCELED', message: reason },
      });
    },
  };
}

export function createScopedEventsApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}) {
  return {
    async publish<TPayload = unknown>(
      name: string,
      payload: TPayload,
      options?: {
        correlationId?: string;
        causationId?: string;
        idempotencyKey?: string;
      }
    ): Promise<ModuleEventPublishResult<TPayload>> {
      if (!input.contract.events.publishes.includes(name)) {
        throw new Error(`MODULE_EVENT_NOT_DECLARED: ${input.contract.id}.${name}`);
      }
      const record = await input.store.enqueueOutbox({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: input.contract.id,
        name: `event:${name}`,
        payload,
        idempotencyKey: options?.idempotencyKey,
        metadata: {
          eventName: name,
          correlationId: options?.correlationId,
          causationId: options?.causationId,
          sourceModuleId: input.contract.id,
        },
      });
      return {
        id: record.id,
        name,
        payload,
        metadata: record.metadata,
        status: 'queued' as const,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    },
  };
}

export function createScopedWebhooksApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}) {
  return {
    async list() {
      return Object.entries(input.contract.webhooks).map(([name, definition]) => ({
        name,
        path: definition.path,
        methods: definition.methods ?? ['POST'],
        signature: definition.signature ?? 'none',
      }));
    },
    async getReceipt(id: string) {
      const receipts = await input.store.listWebhookReceipts({
        productId: defaultProductId(input.session.productId),
        moduleId: input.contract.id,
      });
      const receipt = receipts.find((candidate) => candidate.id === id);
      return receipt
        ? {
            id: receipt.id,
            webhookName: receipt.webhookName,
            status: receipt.status,
            createdAt: receipt.createdAt,
            processedAt: receipt.processedAt,
            error: receipt.error?.message,
          }
        : null;
    },
  };
}

export function createHostCapabilityProviders(input: {
  runtimeStore: HostRuntimeStoreHandle;
  fileStorage: HostFileStorageHandle;
  billingCatalog?: HostBillingCatalog;
}): CreateModuleHostCapabilitiesOptions {
  function commercialForSession(hostSession: ModuleHostSession) {
    return createHostCommercialRuntimeFromStore({
      store: input.runtimeStore.store,
      productId: hostSession.productId,
      workspaceId: hostSession.workspaceId ?? null,
      catalog: input.billingCatalog,
    });
  }

  function auditForSession(hostSession: ModuleHostSession) {
    return async (record: {
      moduleId: string;
      type: string;
      metadata?: Record<string, unknown>;
    }) => {
      await input.runtimeStore.store.recordAudit({
        productId: hostSession.productId ?? DEFAULT_PRODUCT_ID,
        workspaceId: hostSession.workspaceId ?? null,
        moduleId: record.moduleId,
        actorId: hostSession.actorId ?? hostSession.userId ?? hostSession.user?.id,
        type: record.type,
        metadata: record.metadata,
      });
    };
  }

  function aiForSession(contract: ModuleRuntimeContract, hostSession: ModuleHostSession) {
    return createHostModuleAiApi({
      moduleId: contract.id,
      session: hostSession,
      commercialForModule(moduleId) {
        return commercialForSession(hostSession).forModule(moduleId);
      },
      audit: auditForSession(hostSession),
    });
  }

  return {
    audit: ({ contract, hostSession }) => ({
      async record(type, metadata) {
        await auditForSession(hostSession)({
          moduleId: contract.id,
          type,
          metadata,
        });
      },
    }),
    ai: ({ contract, hostSession }) => aiForSession(contract, hostSession),
    rag: ({ contract, hostSession }) =>
      createHostModuleRagApi({
        moduleId: contract.id,
        session: hostSession,
        ai: aiForSession(contract, hostSession),
        store: input.runtimeStore.store,
        durable: input.runtimeStore.durable,
        audit: auditForSession(hostSession),
      }),
    notifications: ({ contract, hostSession }) =>
      createRuntimeStoreNotificationRuntime({
        store: input.runtimeStore.store,
        productId: defaultProductId(hostSession.productId),
        workspaceId: hostSession.workspaceId ?? null,
      }).forModule(contract.id),
    files: ({ contract, hostSession }) =>
      createHostFileRuntimeFromParts({
        store: input.runtimeStore.store,
        storage: input.fileStorage.storage,
        session: hostSession,
      }).forModule(contract.id),
    artifacts: ({ contract }) => artifactRuntime.forModule(contract.id),
    connectors: ({ contract, hostSession }) =>
      createHostServiceConnectionsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    services: ({ contract, hostSession, request }) => {
      const originRewrite = parseServiceOriginRewrite(process.env.PLOYKIT_SERVICE_E2E_ORIGIN_MAP);
      return createServiceInvocationRuntime({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
        request: serviceRequestContext(request, hostSession),
        originRewrite,
        privateNetworkResolver: createServiceE2ePrivateNetworkResolver(originRewrite),
        secretResolver: resolveHostServiceSecretRef,
      });
    },
    resourceBindings: ({ contract, hostSession }) =>
      createRuntimeStoreModuleResourceBindingsApi({
        store: input.runtimeStore.store,
        productId: defaultProductId(hostSession.productId),
        workspaceId: hostSession.workspaceId ?? null,
        moduleId: contract.id,
        actorId: hostSession.actorId ?? hostSession.userId ?? hostSession.user?.id ?? null,
      }),
    runs: ({ contract, hostSession }) =>
      createScopedRunsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    http: ({ contract, hostSession }) =>
      createModuleHttpApi({
        moduleId: contract.id,
        allowedOrigins: contract.egress.map(normalizeEgressOrigin),
        maxBodyBytes: 1024 * 1024,
        audit: async (event) => {
          await input.runtimeStore.store.recordAudit({
            productId: defaultProductId(hostSession.productId),
            workspaceId: hostSession.workspaceId ?? null,
            actorId: hostSession.actorId ?? hostSession.userId ?? hostSession.user?.id,
            moduleId: contract.id,
            type: 'module.http.fetch',
            metadata: {
              method: event.method,
              origin: event.origin,
              path: event.path,
              ok: event.ok,
              status: event.status,
              durationMs: event.durationMs,
              errorCode: event.errorCode,
            },
          });
        },
      }),
    jobs: ({ contract, hostSession }) =>
      createScopedJobsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    events: ({ contract, hostSession }) =>
      createScopedEventsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    webhooks: ({ contract, hostSession }) =>
      createScopedWebhooksApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    usage: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).usage,
    metering: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).metering,
    credits: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).credits,
    billing: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).billing,
    entitlements: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).entitlements,
    commerce: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).commerce,
    redeemCodes: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).redeemCodes,
    risk: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).risk,
    apiKeys: ({ contract, hostSession }) =>
      createHostModuleApiKeysApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
  };
}
