import { createHmac, randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginServiceRequestInit,
  type PluginServices,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginServiceCallLogs,
  type NewPluginServiceCallLog,
} from '@/lib/db/schema/plugin-platform';
import { matchRuntimePathWithParams, normalizeRuntimePath } from '../contract';
import {
  assertResourceScopeAccess,
  enforceCapabilityPermission,
  normalizeResourceScope,
  type NormalizedPluginResourceScope,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import { getUsageLedger, type UsageLedger } from '@/lib/usage/usage-ledger.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginInternalServiceAuth {
  type: 'none' | 'bearer' | 'basic' | 'apiKey';
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
}

export interface PluginInternalServiceActorClaimsConfig {
  enabled?: boolean;
  secret?: string;
  header?: 'jwt' | 'hmac';
  ttlSeconds?: number;
}

export interface PluginInternalServiceDefinition {
  name: string;
  baseUrl: string;
  auth?: PluginInternalServiceAuth;
  actorClaims?: PluginInternalServiceActorClaimsConfig;
  timeoutMs?: number;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
  maxResponseBytes?: number;
}

export interface PluginInternalServiceRegistry {
  get(
    name: string
  ): PluginInternalServiceDefinition | Promise<PluginInternalServiceDefinition | null> | null;
}

export interface PluginServicesHttpHost {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface PluginServiceCallLogRepository {
  record(input: NewPluginServiceCallLog): Promise<void>;
}

export interface CreatePluginServicesOptions {
  registry?: PluginInternalServiceRegistry;
  httpHost?: PluginServicesHttpHost;
  logRepository?: PluginServiceCallLogRepository;
  auditPort?: AuditPort;
  usageLedger?: UsageLedger;
}

interface ServicePathGuard {
  pathTemplate: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const ACTOR_CLAIM_HEADERS = [
  'ploykit-actor-claims',
  'ploykit-actor-signature',
  'ploykit-actor-jwt',
  'x-ploykit-actor-claims',
  'x-ploykit-actor-signature',
  'x-ploykit-actor-jwt',
];

function normalizeMethod(method: string | undefined): string {
  return (method ?? 'GET').toUpperCase();
}

function normalizeServiceName(name: string): string {
  const normalized = name.trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_NAME_INVALID',
      message: `Service name "${name}" is invalid.`,
      statusCode: 400,
    });
  }
  return normalized;
}

function normalizeServicePath(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_PATH_ABSOLUTE_FORBIDDEN',
      message: 'ctx.services only accepts service-local paths, not absolute URLs.',
      statusCode: 400,
    });
  }
  return normalizeRuntimePath(path);
}

function getServiceDeclaration(scope: PluginCapabilityScope, name: string) {
  return scope.contract.services.find((service) => service.name === name);
}

function assertServiceAllowed(
  scope: PluginCapabilityScope,
  name: string,
  method: string,
  path: string
): ServicePathGuard {
  const declaration = getServiceDeclaration(scope, name);
  if (!declaration) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_UNDECLARED',
      message: `Plugin "${scope.contract.id}" did not declare internal service "${name}".`,
      statusCode: 403,
      fix: `Declare services: [{ name: "${name}", methods: ["${method}"], paths: ["${path}"] }] in plugin.ts.`,
      details: { pluginId: scope.contract.id, service: name },
    });
  }

  const methods = new Set(declaration.methods.map((item) => item.toUpperCase()));
  if (!methods.has(method)) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_METHOD_FORBIDDEN',
      message: `Service "${name}" does not allow method "${method}".`,
      statusCode: 403,
      details: { pluginId: scope.contract.id, service: name, method, allowedMethods: [...methods] },
    });
  }

  const matchedPath = declaration.paths.find((pattern) => matchServicePath(pattern, path));
  if (!matchedPath) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_PATH_FORBIDDEN',
      message: `Service "${name}" does not allow path "${path}".`,
      statusCode: 403,
      details: {
        pluginId: scope.contract.id,
        service: name,
        path,
        allowedPaths: declaration.paths,
      },
    });
  }

  return { pathTemplate: matchedPath };
}

function matchServicePath(pattern: string, path: string): boolean {
  const normalizedPattern = normalizeRuntimePath(pattern.replace(/\/\*\*$/, '/[...rest]'));
  return matchRuntimePathWithParams(normalizedPattern, path) !== null;
}

function joinUrl(baseUrl: string, path: string, query?: PluginServiceRequestInit['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}${path}`);

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => url.searchParams.append(key, value));
  } else if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    }
  }

  return url.toString();
}

function sanitizeHeaders(headers: HeadersInit | undefined): Headers {
  const output = new Headers(headers);
  for (const header of ACTOR_CLAIM_HEADERS) {
    output.delete(header);
  }
  output.delete('authorization');
  output.delete('proxy-authorization');
  return output;
}

function applyServiceAuth(headers: Headers, auth: PluginInternalServiceAuth | undefined): void {
  if (!auth || auth.type === 'none') {
    return;
  }

  if (auth.type === 'bearer') {
    if (!auth.token) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_AUTH_MISSING',
        message: 'Service bearer auth is missing a token.',
        statusCode: 500,
      });
    }
    headers.set('authorization', `Bearer ${auth.token}`);
    return;
  }

  if (auth.type === 'basic') {
    if (!auth.username || !auth.password) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_AUTH_MISSING',
        message: 'Service basic auth requires username and password.',
        statusCode: 500,
      });
    }
    headers.set(
      'authorization',
      `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
    );
    return;
  }

  if (auth.type === 'apiKey') {
    if (!auth.token) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_AUTH_MISSING',
        message: 'Service apiKey auth is missing a token.',
        statusCode: 500,
      });
    }
    headers.set(auth.headerName ?? 'x-api-key', auth.token);
  }
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function signActorClaims(
  scope: PluginCapabilityScope,
  service: PluginInternalServiceDefinition,
  resourceScope: NormalizedPluginResourceScope | undefined
): { kind: 'jwt'; jwt: string } | { kind: 'hmac'; claims: string; signature: string } | null {
  const actorClaims = service.actorClaims;
  if (!actorClaims?.enabled) {
    return null;
  }

  if (!actorClaims.secret) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_ACTOR_CLAIMS_SECRET_MISSING',
      message: `Service "${service.name}" enables actor claims but has no signing secret.`,
      statusCode: 500,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(actorClaims.ttlSeconds ?? 60, 10), 300);
  const payload = {
    iss: 'ploykit',
    aud: service.name,
    sub: scope.user?.id ?? scope.contract.id,
    email: scope.user?.email,
    plugin_id: scope.contract.id,
    request_id: scope.requestId,
    workspace: resourceScope?.type === 'workspace' ? { id: resourceScope.id } : undefined,
    iat: now,
    exp: now + ttl,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));

  if (actorClaims.header === 'jwt') {
    const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const unsigned = `${header}.${encodedPayload}`;
    const signature = createHmac('sha256', actorClaims.secret).update(unsigned).digest('base64url');
    return { kind: 'jwt', jwt: `${unsigned}.${signature}` };
  }

  const signature = createHmac('sha256', actorClaims.secret)
    .update(encodedPayload)
    .digest('base64url');
  return { kind: 'hmac', claims: encodedPayload, signature: `v1=${signature}` };
}

function applyActorClaims(
  headers: Headers,
  scope: PluginCapabilityScope,
  service: PluginInternalServiceDefinition,
  resourceScope: NormalizedPluginResourceScope | undefined
): void {
  const claims = signActorClaims(scope, service, resourceScope);
  if (!claims) {
    return;
  }

  if (claims.kind === 'jwt') {
    headers.set('ploykit-actor-jwt', claims.jwt);
    return;
  }

  headers.set('ploykit-actor-claims', claims.claims);
  headers.set('ploykit-actor-signature', claims.signature);
}

function normalizeBody(headers: Headers, init: PluginServiceRequestInit): BodyInit | undefined {
  if (init.json !== undefined) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
    return JSON.stringify(init.json);
  }

  if (Array.isArray(init.body) || isPlainJsonBody(init.body)) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
    return JSON.stringify(init.body);
  }

  return init.body;
}

function isPlainJsonBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof URLSearchParams ||
    value instanceof ReadableStream
  ) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Response> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_RESPONSE_TOO_LARGE',
      message: 'Internal service response exceeded the configured size limit.',
      statusCode: 502,
      details: { maxBytes, responseBytes: buffer.byteLength },
    });
  }
  return new Response(buffer, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function fetchWithRetry(
  host: PluginServicesHttpHost,
  url: string,
  init: RequestInit,
  retry: PluginInternalServiceDefinition['retry'] | undefined
): Promise<Response> {
  const attempts = Math.min(Math.max(retry?.attempts ?? 0, 0), 5);
  let lastError: unknown;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const response = await host.fetch(url, init);
      if (response.status < 500 || attempt === attempts) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw error;
      }
    }

    const backoff = retry?.backoffMs ?? 250;
    if (backoff > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoff * (attempt + 1)));
    }
  }

  throw lastError;
}

class DbPluginServiceCallLogRepository implements PluginServiceCallLogRepository {
  constructor(private readonly executor: Executor = db) {}

  async record(input: NewPluginServiceCallLog): Promise<void> {
    if (this.executor !== db) {
      await this.executor.insert(pluginServiceCallLogs).values(input);
      return;
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
      await tx.insert(pluginServiceCallLogs).values(input);
    });
  }
}

class EmptyServiceRegistry implements PluginInternalServiceRegistry {
  get(): null {
    return null;
  }
}

const EMPTY_SERVICE_REGISTRY = new EmptyServiceRegistry();
let explicitDefaultServiceRegistry: PluginInternalServiceRegistry | undefined;

export function setDefaultPluginInternalServiceRegistry(
  registry: PluginInternalServiceRegistry | undefined
): void {
  explicitDefaultServiceRegistry = registry;
}

export function getDefaultPluginInternalServiceRegistry(): PluginInternalServiceRegistry {
  if (explicitDefaultServiceRegistry) {
    return explicitDefaultServiceRegistry;
  }

  return EMPTY_SERVICE_REGISTRY;
}

function workspaceIdFromScope(resourceScope: NormalizedPluginResourceScope | undefined) {
  return resourceScope?.type === 'workspace' ? resourceScope.id : undefined;
}

export function createPluginServicesCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginServicesOptions = {}
): PluginServices {
  const registry = options.registry ?? getDefaultPluginInternalServiceRegistry();
  const httpHost = options.httpHost ?? { fetch };
  const logRepository = options.logRepository ?? new DbPluginServiceCallLogRepository();
  const usageLedger = options.usageLedger ?? getUsageLedger();

  async function invoke(
    serviceInput: string,
    pathInput: string,
    init: PluginServiceRequestInit = {}
  ): Promise<Response> {
    enforceCapabilityPermission(scope, Permission.ServicesInvoke, 'ctx.services.fetch');
    const serviceName = normalizeServiceName(serviceInput);
    const path = normalizeServicePath(pathInput);
    const method = normalizeMethod(init.method);
    const guard = assertServiceAllowed(scope, serviceName, method, path);
    const service = await registry.get(serviceName);
    if (!service) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_NOT_REGISTERED',
        message: `Internal service "${serviceName}" is not registered by the host.`,
        statusCode: 502,
        details: { pluginId: scope.contract.id, service: serviceName },
      });
    }

    let resourceScope: NormalizedPluginResourceScope | undefined;
    if (init.scope) {
      resourceScope = normalizeResourceScope(scope, init.scope, 'ctx.services.fetch');
      await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.services.fetch');
    }

    const headers = sanitizeHeaders(init.headers);
    headers.set('x-ploykit-request-id', scope.requestId);
    headers.set('x-ploykit-plugin-id', scope.contract.id);
    applyServiceAuth(headers, service.auth);
    applyActorClaims(headers, scope, service, resourceScope);
    const body = normalizeBody(headers, init);
    const url = joinUrl(service.baseUrl, path, init.query);
    const callId = randomUUID();
    const started = Date.now();
    let response: Response | null = null;
    let errorCode: string | undefined;

    try {
      response = await fetchWithRetry(
        httpHost,
        url,
        {
          method,
          headers,
          body,
          signal: init.signal ?? AbortSignal.timeout(service.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        },
        service.retry
      );
      return await readBoundedResponse(
        response,
        service.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
      );
    } catch (error) {
      errorCode = error instanceof PluginError ? error.code : 'SERVICE_REQUEST_FAILED';
      if (error instanceof PluginError) {
        throw error;
      }
      throw new PluginError({
        code: 'SERVICE_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Internal service request failed.',
        statusCode: 502,
        details: { service: serviceName, requestId: scope.requestId },
      });
    } finally {
      const durationMs = Date.now() - started;
      await logRepository.record({
        id: callId,
        pluginId: scope.contract.id,
        serviceName,
        userId: scope.user?.id,
        workspaceId: workspaceIdFromScope(resourceScope),
        method,
        path,
        pathTemplate: guard.pathTemplate,
        status: response?.status,
        ok: response?.ok ? 'true' : 'false',
        durationMs,
        requestId: scope.requestId,
        errorCode,
        metadata: {},
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.services.invoke`,
        {
          service: serviceName,
          method,
          path,
          pathTemplate: guard.pathTemplate,
          status: response?.status,
          ok: response?.ok,
        },
        options.auditPort
      );
      if (usageLedger) {
        await usageLedger.record({
          id: randomUUID(),
          idempotencyKey: `${scope.requestId}:service:${callId}:usage`,
          userId: scope.user?.id ?? scope.contract.id,
          category: 'api_quota',
          amount: 1,
          unit: 'call',
          metadata: {
            pluginId: scope.contract.id,
            service: serviceName,
            method,
            pathTemplate: guard.pathTemplate,
          },
          timestamp: new Date(),
        });
      }
    }
  }

  return {
    fetch: invoke,
    async json(service, path, init) {
      const response = await invoke(service, path, init);
      if (!response.ok) {
        throw new PluginError({
          code: 'SERVICE_REQUEST_FAILED',
          message: `Internal service "${service}" returned ${response.status}.`,
          statusCode: 502,
          details: {
            service,
            status: response.status,
            requestId: scope.requestId,
          },
        });
      }
      return response.json();
    },
  };
}
