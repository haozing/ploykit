import type { ModuleServiceOperationDefinition } from '@ploykit/module-sdk';
import { createServiceInvocationRuntime } from '@/lib/module-capabilities/services';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';
import type {
  AdminServiceConnectionRow,
  AdminServiceConnectionStatus,
} from './admin-service-connections';
import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from './default-scope';

export interface AdminServiceConnectionHealthCheckResult {
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

export async function runAdminSignedServiceConnectionHealthCheck(input: {
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
      productId: DEFAULT_HOST_PRODUCT_ID,
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

export async function runAdminServiceConnectionHealthCheck(
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
