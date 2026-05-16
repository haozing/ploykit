import { createHmac, randomUUID } from 'crypto';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginServiceJsonResult,
  type PluginServiceObjectRequest,
  type PluginServiceRequest,
  type PluginServiceRequestInit,
  type PluginServices,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginInternalServiceBindings,
  pluginServiceCallLogs,
  type PluginInternalServiceBinding,
  type NewPluginServiceCallLog,
} from '@/lib/db/schema/plugin-platform';
import { env } from '@/lib/_core/env';
import { matchRuntimePathWithParams, normalizeRuntimePath } from '../contract';
import {
  assertResourceScopeAccess,
  enforceCapabilityPermission,
  normalizeResourceScope,
  type NormalizedPluginResourceScope,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import { DbPluginSecretsRepository } from './secrets-capability.server';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import { getUsageLedger, type UsageLedger } from '@/lib/usage/usage-ledger.server';
import { DEFAULT_PRODUCT_ID, getPluginRuntimeMapEntry } from '@/lib/plugin-runtime/loader';

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
  audience?: string;
  keyId?: string;
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
    input: PluginInternalServiceLookup
  ): PluginInternalServiceDefinition | Promise<PluginInternalServiceDefinition | null> | null;
}

export interface PluginInternalServiceLookup {
  pluginId: string;
  productId?: string;
  suiteId?: string;
  serviceName: string;
  workspaceId?: string;
  environment?: string;
}

export interface PluginInternalServiceBindingLookup extends PluginInternalServiceLookup {
  status?: PluginInternalServiceBinding['status'];
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

type InternalServiceSecretRepository = {
  get(
    scope: { pluginId: string; userId: string; system: true },
    name: string
  ): Promise<string | null>;
};

interface ServicePathGuard {
  pathTemplate: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_ENVIRONMENT = env.NODE_ENV;
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

function normalizeTemplatePath(path: string): string {
  return normalizeServicePath(path);
}

function getServiceDeclaration(scope: PluginCapabilityScope, name: string) {
  return scope.contract.services.find((service) => service.name === name);
}

function assertServiceAllowed(
  scope: PluginCapabilityScope,
  name: string,
  method: string,
  path: string,
  template?: string
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

  const matchedPath = declaration.paths.find((pattern) =>
    template
      ? normalizeRuntimePath(pattern) === normalizeRuntimePath(template)
      : matchServicePath(pattern, path)
  );
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

function interpolateServiceTemplate(
  template: string,
  params: Record<string, string | number | boolean | null | undefined> | undefined
): string {
  const normalizedTemplate = normalizeTemplatePath(template);
  const values = params ?? {};
  const segments = normalizedTemplate.split('/').map((segment) => {
    if (!segment.startsWith(':')) {
      return segment;
    }

    const name = segment.slice(1);
    const value = values[name];
    if (value === undefined || value === null) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_TEMPLATE_PARAM_MISSING',
        message: `Service path template "${normalizedTemplate}" is missing param "${name}".`,
        statusCode: 400,
        details: { template: normalizedTemplate, param: name },
      });
    }

    return encodeURIComponent(String(value));
  });

  return normalizeServicePath(segments.join('/'));
}

function normalizeServiceRequest(
  pathOrRequest: PluginServiceRequest,
  init?: PluginServiceRequestInit
): { path: string; template?: string; init: PluginServiceObjectRequest } {
  if (typeof pathOrRequest === 'string') {
    return {
      path: normalizeServicePath(pathOrRequest),
      init: init ?? {},
    };
  }

  const request = pathOrRequest;
  if (request.template) {
    const template = normalizeTemplatePath(request.template);
    return {
      path: interpolateServiceTemplate(template, request.params),
      template,
      init: request,
    };
  }

  if (request.path) {
    return {
      path: normalizeServicePath(request.path),
      init: request,
    };
  }

  throw new PluginError({
    code: 'PLUGIN_SERVICE_PATH_REQUIRED',
    message: 'ctx.services object-form requests require either "path" or "template".',
    statusCode: 400,
  });
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
    aud: actorClaims.audience ?? service.name,
    sub: scope.user?.id ?? scope.contract.id,
    email: scope.user?.email,
    plugin_id: scope.contract.id,
    request_id: scope.requestId,
    workspace: resourceScope?.type === 'workspace' ? { id: resourceScope.id } : undefined,
    scope: resourceScope,
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
    kid: actorClaims.keyId,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));

  if (actorClaims.header === 'jwt') {
    const header = encodeBase64Url(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: actorClaims.keyId })
    );
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

function environmentCandidates(environment: string | undefined): Array<string | null> {
  const normalized = environment?.trim() || DEFAULT_ENVIRONMENT;
  return [normalized, null];
}

function bindingScopeRank(row: PluginInternalServiceBinding, workspaceId?: string): number {
  if (workspaceId && row.scopeType === 'workspace' && row.scopeId === workspaceId) {
    return row.environment ? 0 : 1;
  }
  if (row.scopeType === 'global') {
    return row.environment ? 2 : 3;
  }
  return 99;
}

function ownerRank(row: PluginInternalServiceBinding, input: PluginInternalServiceLookup): number {
  if (row.ownerType === 'plugin' && row.ownerId === input.pluginId) {
    return 0;
  }
  if (row.ownerType === 'suite') {
    return 1;
  }
  if (row.ownerType === 'product') {
    return 2;
  }
  return 99;
}

function ownerConditions(input: PluginInternalServiceLookup): SQL[] {
  const runtimeEntry = getPluginRuntimeMapEntry(input.pluginId);
  const productId = input.productId ?? runtimeEntry?.productId ?? DEFAULT_PRODUCT_ID;
  const suiteId = input.suiteId ?? runtimeEntry?.suiteId;
  const candidates: SQL[] = [
    and(
      eq(pluginInternalServiceBindings.ownerType, 'plugin'),
      eq(pluginInternalServiceBindings.ownerId, input.pluginId)
    )!,
    and(
      eq(pluginInternalServiceBindings.ownerType, 'product'),
      eq(pluginInternalServiceBindings.ownerId, productId)
    )!,
  ];

  if (suiteId) {
    candidates.push(
      and(
        eq(pluginInternalServiceBindings.ownerType, 'suite'),
        eq(pluginInternalServiceBindings.ownerId, suiteId)
      )!
    );
  }

  return [eq(pluginInternalServiceBindings.productId, productId), or(...candidates)!];
}

function parseSecretRef(
  ref: string | null | undefined
): { kind: 'env' | 'dbsec'; name: string } | null {
  if (!ref) {
    return null;
  }

  const [kind, ...rest] = ref.split(':');
  const name = rest.join(':').trim();
  if (!name || (kind !== 'env' && kind !== 'dbsec')) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_SECRET_REF_INVALID',
      message: `Internal service secret ref "${ref}" is invalid.`,
      statusCode: 500,
      details: { ref },
    });
  }

  return { kind, name };
}

function readDynamicSecretEnv(name: string): string | undefined {
  // env:<NAME> refs intentionally resolve arbitrary host-owned secret keys.
  // eslint-disable-next-line no-restricted-syntax
  return process.env[name];
}

async function resolveSecretRef(
  ref: string | null | undefined,
  pluginId: string,
  repository: InternalServiceSecretRepository
): Promise<string | undefined> {
  const parsed = parseSecretRef(ref);
  if (!parsed) {
    return undefined;
  }

  if (parsed.kind === 'env') {
    const value = readDynamicSecretEnv(parsed.name);
    if (!value) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_SECRET_MISSING',
        message: `Internal service secret "${ref}" was not found.`,
        statusCode: 500,
        details: { ref },
      });
    }
    return value;
  }

  const value = await repository.get({ pluginId, userId: '', system: true }, parsed.name);
  if (!value) {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_SECRET_MISSING',
      message: `Internal service secret "${ref}" was not found.`,
      statusCode: 500,
      details: { ref },
    });
  }
  return value;
}

function normalizeBindingBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PluginError({
      code: 'PLUGIN_SERVICE_BASE_URL_INVALID',
      message: 'Internal service base URL must be http or https.',
      statusCode: 500,
    });
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    const hostname = url.hostname.toLowerCase();
    const privateHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
    if (!privateHost) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_BASE_URL_HTTPS_REQUIRED',
        message:
          'Production internal service base URLs must use https unless they target private network hosts.',
        statusCode: 500,
      });
    }
  }
  return url.toString().replace(/\/+$/, '');
}

async function toServiceDefinition(
  row: PluginInternalServiceBinding,
  secretRepository: InternalServiceSecretRepository
): Promise<PluginInternalServiceDefinition> {
  const authType = row.authType as PluginInternalServiceAuth['type'];
  const token =
    authType === 'bearer' || authType === 'apiKey'
      ? await resolveSecretRef(row.authSecretRef, row.pluginId, secretRepository)
      : undefined;
  const username =
    authType === 'basic'
      ? await resolveSecretRef(row.authUsernameRef, row.pluginId, secretRepository)
      : undefined;
  const password =
    authType === 'basic'
      ? await resolveSecretRef(row.authPasswordRef, row.pluginId, secretRepository)
      : undefined;
  const actorSecret = row.actorClaimsEnabled
    ? await resolveSecretRef(row.actorClaimsSecretRef, row.pluginId, secretRepository)
    : undefined;

  return {
    name: row.serviceName,
    baseUrl: normalizeBindingBaseUrl(row.baseUrl),
    auth:
      authType === 'none'
        ? { type: 'none' }
        : {
            type: authType,
            token,
            username,
            password,
            headerName: row.authHeaderName ?? undefined,
          },
    actorClaims: {
      enabled: row.actorClaimsEnabled,
      secret: actorSecret,
      header: row.actorClaimsType === 'jwt' ? 'jwt' : 'hmac',
      audience: row.actorClaimsAudience ?? row.serviceName,
      keyId: row.actorClaimsKeyId ?? undefined,
      ttlSeconds: row.actorClaimsTtlSeconds,
    },
    timeoutMs: row.timeoutMs,
    retry: {
      attempts: row.retryAttempts,
      backoffMs: row.retryBackoffMs,
    },
    maxResponseBytes: row.maxResponseBytes,
  };
}

export class DbPluginInternalServiceRegistry implements PluginInternalServiceRegistry {
  constructor(
    private readonly executor: Executor = db,
    private readonly secretRepository: InternalServiceSecretRepository = new DbPluginSecretsRepository(
      executor
    )
  ) {}

  async resolveBinding(
    input: PluginInternalServiceBindingLookup
  ): Promise<PluginInternalServiceBinding | null> {
    const environmentValues = environmentCandidates(input.environment);
    const scopeConditions: SQL[] = [eq(pluginInternalServiceBindings.scopeType, 'global')];
    if (input.workspaceId) {
      scopeConditions.push(
        and(
          eq(pluginInternalServiceBindings.scopeType, 'workspace'),
          eq(pluginInternalServiceBindings.scopeId, input.workspaceId)
        )!
      );
    }
    const conditions: SQL[] = [
      ...ownerConditions(input),
      eq(pluginInternalServiceBindings.serviceName, input.serviceName),
      or(...scopeConditions)!,
      or(
        ...environmentValues.map((value) =>
          value === null
            ? isNull(pluginInternalServiceBindings.environment)
            : eq(pluginInternalServiceBindings.environment, value)
        )
      )!,
    ];
    if (input.status) {
      conditions.push(eq(pluginInternalServiceBindings.status, input.status));
    }

    const rows = await this.executor
      .select()
      .from(pluginInternalServiceBindings)
      .where(and(...conditions));
    const selected = rows
      .sort(
        (left, right) =>
          ownerRank(left, input) - ownerRank(right, input) ||
          bindingScopeRank(left, input.workspaceId) - bindingScopeRank(right, input.workspaceId)
      )
      .at(0);

    return selected ?? null;
  }

  async get(input: PluginInternalServiceLookup): Promise<PluginInternalServiceDefinition | null> {
    const selected = await this.resolveBinding({ ...input, status: 'active' });
    return selected ? toServiceDefinition(selected, this.secretRepository) : null;
  }
}

export function applyInternalServiceRequestHeaders(
  headers: Headers,
  input: {
    service: PluginInternalServiceDefinition;
    scope: PluginCapabilityScope;
    resourceScope?: NormalizedPluginResourceScope;
    requestId?: string;
  }
): void {
  headers.set('x-ploykit-request-id', input.requestId ?? input.scope.requestId);
  headers.set('x-ploykit-plugin-id', input.scope.contract.id);
  applyServiceAuth(headers, input.service.auth);
  applyActorClaims(headers, input.scope, input.service, input.resourceScope);
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
let defaultDbServiceRegistry: PluginInternalServiceRegistry | undefined;

export function setDefaultPluginInternalServiceRegistry(
  registry: PluginInternalServiceRegistry | undefined
): void {
  explicitDefaultServiceRegistry = registry;
}

export function getDefaultPluginInternalServiceRegistry(): PluginInternalServiceRegistry {
  if (explicitDefaultServiceRegistry) {
    return explicitDefaultServiceRegistry;
  }

  defaultDbServiceRegistry ??= new DbPluginInternalServiceRegistry();
  return defaultDbServiceRegistry ?? EMPTY_SERVICE_REGISTRY;
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
    pathOrRequest: PluginServiceRequest,
    init: PluginServiceRequestInit = {}
  ): Promise<Response> {
    enforceCapabilityPermission(scope, Permission.ServicesInvoke, 'ctx.services.fetch');
    const serviceName = normalizeServiceName(serviceInput);
    const normalizedRequest = normalizeServiceRequest(pathOrRequest, init);
    const path = normalizedRequest.path;
    const requestInit = normalizedRequest.init;
    const method = normalizeMethod(requestInit.method);
    const guard = assertServiceAllowed(
      scope,
      serviceName,
      method,
      path,
      normalizedRequest.template
    );

    let resourceScope: NormalizedPluginResourceScope | undefined;
    if (requestInit.scope) {
      resourceScope = normalizeResourceScope(scope, requestInit.scope, 'ctx.services.fetch');
      await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.services.fetch');
    }

    const service = await registry.get({
      pluginId: scope.contract.id,
      serviceName,
      workspaceId: workspaceIdFromScope(resourceScope),
      environment: DEFAULT_ENVIRONMENT,
    });
    if (!service) {
      throw new PluginError({
        code: 'PLUGIN_SERVICE_NOT_REGISTERED',
        message: `Internal service "${serviceName}" is not registered by the host.`,
        statusCode: 502,
        details: { pluginId: scope.contract.id, service: serviceName },
      });
    }

    const headers = sanitizeHeaders(requestInit.headers);
    applyInternalServiceRequestHeaders(headers, { service, scope, resourceScope });
    const body = normalizeBody(headers, requestInit);
    const url = joinUrl(service.baseUrl, path, requestInit.query);
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
          signal:
            requestInit.signal ?? AbortSignal.timeout(service.timeoutMs ?? DEFAULT_TIMEOUT_MS),
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
    async json<T = unknown>(
      service: string,
      pathOrRequest: PluginServiceRequest,
      init?: PluginServiceRequestInit
    ): Promise<T> {
      const response = await invoke(service, pathOrRequest, init);
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
      return response.json() as Promise<T>;
    },
    async requestJson<T = unknown>(
      service: string,
      request: PluginServiceObjectRequest
    ): Promise<PluginServiceJsonResult<T>> {
      const response = await invoke(service, request);
      const headers = new Headers(response.headers);
      const contentType = response.headers.get('content-type') ?? '';
      let payload: unknown = null;
      if (contentType.includes('application/json')) {
        payload = await response.json();
      } else {
        payload = await response.text();
      }

      if (response.ok) {
        return { ok: true, status: response.status, data: payload as T, headers };
      }

      if (request.errorMode === 'throw') {
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

      return { ok: false, status: response.status, error: payload, headers };
    },
  };
}
