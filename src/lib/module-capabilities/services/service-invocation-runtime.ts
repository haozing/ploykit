import { createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type {
  ModuleServiceInvokeOptions,
  ModuleServiceOperationDefinition,
  ModuleServiceRequirementDefinition,
  ModuleServicesApi,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../../module-runtime/contract';
import type { ModuleHostSession } from '../../module-runtime/host/session';
import type {
  RuntimeStore,
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreServiceConnectionRecord,
} from '../../module-runtime/stores/runtime-store-types';

type ServiceHealthStatus = 'unknown' | 'ready' | 'warning' | 'blocked';

interface ServiceRequestContext {
  id: string;
  correlationId: string;
  method: string;
  path: string;
}

export interface ServiceInvocationRuntimeOptions {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
  request: ServiceRequestContext;
  fetchImpl?: typeof fetch;
  privateNetworkResolver?: (hostname: string) => Promise<readonly string[]>;
  originRewrite?: Record<string, string>;
  readinessProbe?: boolean;
  secretResolver?: (ref: string) => string | Promise<string | null> | null;
}

interface ServiceHttpInput {
  url?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: string;
  json?: unknown;
}

interface ServiceInvokeResult {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  json?: unknown;
  bytes: number;
  attempts: number;
}

const SENSITIVE_KEY_PATTERN =
  /secret|token|password|passwd|authorization|signature|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key|credential/i;
const SENSITIVE_NORMALIZED_KEYS = new Set(['setcookie', 'apikey', 'privatekey', 'accesskey', 'clientsecret']);

const MANAGED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-service-signature',
  'x-service-timestamp',
  'x-service-claims',
]);

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SIGNING_CANONICAL_FIELDS = new Set([
  'method',
  'path',
  'timestamp',
  'bodySha256',
  'claimsSha256',
]);

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, '').toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_NORMALIZED_KEYS.has(normalized);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function productId(session: ModuleHostSession): string {
  return session.productId ?? 'default-product';
}

function workspaceId(session: ModuleHostSession, connection?: RuntimeStoreServiceConnectionRecord) {
  return connection?.workspaceId ?? session.workspaceId ?? null;
}

function healthStatus(record: RuntimeStoreServiceConnectionRecord): ServiceHealthStatus {
  const status = stringValue(record.health.status);
  return status === 'ready' || status === 'warning' || status === 'blocked'
    ? status
    : 'unknown';
}

function serviceConnectionMatchesScope(
  record: RuntimeStoreServiceConnectionRecord,
  contract: ModuleRuntimeContract,
  session: ModuleHostSession,
  serviceName: string
): boolean {
  if (record.service !== serviceName && record.provider !== serviceName) {
    return false;
  }
  if (record.moduleId && record.moduleId !== contract.id) {
    return false;
  }
  if (record.workspaceId !== undefined && record.workspaceId !== null) {
    return record.workspaceId === (session.workspaceId ?? null);
  }
  return true;
}

async function resolveServiceConnection(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
  serviceName: string;
}): Promise<RuntimeStoreServiceConnectionRecord | null> {
  const records = await input.store.listServiceConnections({
    productId: productId(input.session),
    service: input.serviceName,
  });
  const moduleConnectionId = `${input.contract.id}:service:${input.serviceName}`;
  const scopedRecords = records.filter((record) =>
    serviceConnectionMatchesScope(record, input.contract, input.session, input.serviceName)
  );
  const workspace = input.session.workspaceId ?? null;
  return (
    scopedRecords.find(
      (record) => record.connectionId === moduleConnectionId && (record.workspaceId ?? null) === workspace
    ) ??
    scopedRecords.find((record) => record.connectionId === moduleConnectionId) ??
    scopedRecords.find((record) => (record.workspaceId ?? null) === workspace) ??
    scopedRecords.find((record) => record.workspaceId === null || record.workspaceId === undefined) ??
    null
  );
}

async function loadResourceBindings(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}): Promise<Record<string, RuntimeStoreResourceBindingRecord>> {
  const bindings: Record<string, RuntimeStoreResourceBindingRecord> = {};
  for (const [name, requirement] of Object.entries(input.contract.resourceBindings)) {
    const records = await input.store.listResourceBindings({
      productId: productId(input.session),
      workspaceId: input.session.workspaceId ?? null,
      moduleId: input.contract.id,
      name,
      kind: requirement.kind,
      status: 'active',
    });
    const record =
      records[0] ??
      (
        await input.store.listResourceBindings({
          productId: productId(input.session),
          workspaceId: input.session.workspaceId ?? null,
          name,
          kind: requirement.kind,
          status: 'active',
        })
      )[0];
    if (record) {
      bindings[name] = record;
    }
  }
  return bindings;
}

function normalizeJsonValue(value: unknown, arrayItem = false): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return arrayItem ? null : undefined;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item, true));
  }
  const record: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [key, item] of entries) {
    const normalized = normalizeJsonValue(item);
    if (normalized !== undefined) {
      record[key] = normalized;
    }
  }
  return record;
}

function stableJson(value: unknown): string {
  const normalized = normalizeJsonValue(value);
  if (normalized === undefined) {
    throw new Error('MODULE_SERVICE_JSON_BODY_INVALID');
  }
  return JSON.stringify(normalized);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function templatePath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function expandClaimTemplate(input: {
  template: string;
  contract: ModuleRuntimeContract;
  session: ModuleHostSession;
  request: ServiceRequestContext;
  resources: Record<string, RuntimeStoreResourceBindingRecord>;
  operationInput: unknown;
  claimsAllow: readonly string[];
}): string {
  return input.template.replace(/\$\{([^}]+)\}/g, (_match, expression: string) => {
    const key = expression.trim();
    const ctxValues: Record<string, unknown> = {
      'ctx.module.id': input.contract.id,
      'ctx.module.version': input.contract.version,
      'ctx.scope.productId': input.session.productId ?? null,
      'ctx.scope.workspaceId': input.session.workspaceId ?? null,
      'ctx.scope.userId': input.session.userId ?? input.session.user?.id ?? null,
      'ctx.scope.actorId': input.session.actorId ?? input.session.userId ?? null,
      'ctx.auth.actorId': input.session.actorId ?? input.session.userId ?? null,
      'ctx.auth.isAuthenticated': Boolean(input.session.user),
      'ctx.request.id': input.request.id,
      'ctx.request.method': input.request.method,
      'ctx.request.path': input.request.path,
      'ctx.request.correlationId': input.request.correlationId,
    };
    if (key in ctxValues) {
      return String(ctxValues[key] ?? '');
    }
    const resourceMatch = key.match(/^resource\.([a-zA-Z][a-zA-Z0-9_]*)\.(.+)$/);
    if (resourceMatch) {
      const [, bindingName, fieldPath] = resourceMatch;
      return String(templatePath(input.resources[bindingName!]?.value, fieldPath!) ?? '');
    }
    const inputMatch = key.match(/^input\.([a-zA-Z][a-zA-Z0-9_]*)$/);
    if (inputMatch) {
      const field = inputMatch[1]!;
      if (!input.claimsAllow.includes(field)) {
        throw new Error(`MODULE_SERVICE_CLAIMS_INPUT_NOT_ALLOWED: ${field}`);
      }
      return String(templatePath(input.operationInput, field) ?? '');
    }
    throw new Error(`MODULE_SERVICE_CLAIMS_TEMPLATE_INVALID: ${key}`);
  });
}

function expandClaims(input: {
  requirement: ModuleServiceRequirementDefinition;
  operation: ModuleServiceOperationDefinition;
  contract: ModuleRuntimeContract;
  session: ModuleHostSession;
  request: ServiceRequestContext;
  resources: Record<string, RuntimeStoreResourceBindingRecord>;
  operationInput: unknown;
}) {
  const claims: Record<string, string> = {};
  const claimsAllow = input.operation.input?.claimsAllow ?? [];
  for (const [key, template] of Object.entries(input.requirement.claims ?? {})) {
    claims[key] = expandClaimTemplate({
      template,
      contract: input.contract,
      session: input.session,
      request: input.request,
      resources: input.resources,
      operationInput: input.operationInput,
      claimsAllow,
    });
  }
  return claims;
}

function parseServiceHttpInput(value: unknown): ServiceHttpInput {
  if (typeof value === 'string') {
    return { path: value };
  }
  return recordValue(value) as ServiceHttpInput;
}

function defaultAllowedInputFields(operation: ModuleServiceOperationDefinition): string[] {
  const allowed = ['headers', 'query'];
  if (!operation.path) {
    allowed.push('path');
  }
  if (!operation.method) {
    allowed.push('method');
  }
  if (operation.request?.body === 'json') {
    allowed.push('json');
  } else if (operation.request?.body === 'text') {
    allowed.push('body');
  } else if (operation.request?.body !== 'none') {
    allowed.push('body', 'json');
  }
  return allowed;
}

function assertAllowedInputFields(operation: ModuleServiceOperationDefinition, value: unknown) {
  const input = recordValue(value);
  const allowed = new Set([
    ...(operation.input?.allow ?? defaultAllowedInputFields(operation)),
    ...(operation.input?.claimsAllow ?? []),
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new Error(`MODULE_SERVICE_INPUT_FIELD_DENIED: ${key}`);
    }
  }
}

function isPrivateIpAddress(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  ) {
    return true;
  }
  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost')
  ) {
    return true;
  }
  return isIP(normalized) !== 0 && isPrivateIpAddress(normalized);
}

async function resolveDnsAddresses(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function basePath(base: URL): string {
  return !base.pathname || base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '');
}

function pathWithinBase(pathname: string, allowedBasePath: string): boolean {
  return !allowedBasePath || pathname === allowedBasePath || pathname.startsWith(`${allowedBasePath}/`);
}

async function assertTargetAllowed(input: {
  requirement: ModuleServiceRequirementDefinition;
  connection: RuntimeStoreServiceConnectionRecord;
  base: URL;
  target: URL;
  privateNetworkResolver?: ServiceInvocationRuntimeOptions['privateNetworkResolver'];
}) {
  const egress = input.requirement.connection?.egress?.length
    ? input.requirement.connection.egress
    : [input.base.origin];
  if (!egress.includes(input.target.origin)) {
    throw new Error(`MODULE_SERVICE_EGRESS_DENIED: ${input.target.origin}`);
  }
  if (input.target.protocol !== 'https:') {
    throw new Error(`MODULE_SERVICE_EGRESS_DENIED: ${input.target.protocol}`);
  }
  if (isPrivateHostname(input.target.hostname)) {
    throw new Error(`MODULE_SERVICE_PRIVATE_NETWORK_DENIED: ${input.target.hostname}`);
  }
  const resolver = input.privateNetworkResolver;
  if (resolver && isIP(input.target.hostname) === 0) {
    const addresses = await resolver(input.target.hostname);
    const privateAddress = addresses.find((address) => isPrivateIpAddress(address));
    if (privateAddress) {
      throw new Error(`MODULE_SERVICE_PRIVATE_NETWORK_DENIED: ${input.target.hostname}`);
    }
  }
  const configuredPrefix = input.requirement.connection?.pathPrefix;
  const allowedBasePath = configuredPrefix ?? basePath(input.base);
  if (!pathWithinBase(input.target.pathname, allowedBasePath)) {
    throw new Error(`MODULE_SERVICE_EGRESS_PATH_DENIED: ${input.target.pathname}`);
  }
}

async function resolveTargetUrl(input: {
  requirement: ModuleServiceRequirementDefinition;
  connection: RuntimeStoreServiceConnectionRecord;
  operation: ModuleServiceOperationDefinition;
  operationInput: ServiceHttpInput;
  originRewrite?: ServiceInvocationRuntimeOptions['originRewrite'];
  privateNetworkResolver?: ServiceInvocationRuntimeOptions['privateNetworkResolver'];
}): Promise<URL> {
  const config = recordValue(input.connection.config);
  const baseUrl =
    stringValue(config.baseUrl) ?? input.requirement.connection?.baseUrl ?? 'local://host-runtime';
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:') {
    throw new Error(`MODULE_SERVICE_HTTP_UNSUPPORTED_BASE_URL: ${input.connection.connectionId}`);
  }
  const rawUrl = input.operationInput.url?.trim();
  const target = rawUrl
    ? new URL(rawUrl)
    : new URL(input.operationInput.path ?? input.operation.path ?? '/', base);
  if (input.operationInput.query) {
    for (const [key, value] of Object.entries(input.operationInput.query)) {
      if (value !== undefined && value !== null) {
        target.searchParams.set(key, String(value));
      }
    }
  }
  await assertTargetAllowed({
    requirement: input.requirement,
    connection: input.connection,
    base,
    target,
    privateNetworkResolver: input.privateNetworkResolver,
  });
  const rewriteBase = input.originRewrite?.[target.origin];
  if (rewriteBase) {
    const rewritten = new URL(rewriteBase);
    rewritten.pathname = `${rewritten.pathname.replace(/\/+$/, '')}${target.pathname}`;
    rewritten.search = target.search;
    return rewritten;
  }
  return target;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function managedHeadersForOperation(operation: ModuleServiceOperationDefinition): Set<string> {
  const managed = new Set(MANAGED_HEADERS);
  if (operation.auth?.type === 'bearer') {
    managed.add((operation.auth.header ?? 'authorization').toLowerCase());
  }
  if (operation.signing?.type === 'hmac-sha256') {
    managed.add((operation.signing.header ?? 'x-service-signature').toLowerCase());
    managed.add((operation.signing.timestampHeader ?? 'x-service-timestamp').toLowerCase());
    managed.add((operation.signing.claimsHeader ?? 'x-service-claims').toLowerCase());
  }
  return managed;
}

function assertModuleHeadersAllowed(operation: ModuleServiceOperationDefinition, headers: Headers) {
  const allowHeaders = new Set(
    (operation.request?.allowHeaders ?? []).map((header) => header.toLowerCase())
  );
  const denyHeaders = new Set(
    (operation.request?.denyHeaders ?? []).map((header) => header.toLowerCase())
  );
  const managedHeaders = managedHeadersForOperation(operation);
  headers.forEach((_value, key) => {
    const normalized = key.toLowerCase();
    if (managedHeaders.has(normalized)) {
      throw new Error(`MODULE_SERVICE_MANAGED_HEADER_DENIED: ${key}`);
    }
    if (denyHeaders.has(normalized)) {
      throw new Error(`MODULE_SERVICE_HEADER_DENIED: ${key}`);
    }
    if (allowHeaders.size > 0 && !allowHeaders.has(normalized)) {
      throw new Error(`MODULE_SERVICE_HEADER_DENIED: ${key}`);
    }
    if (allowHeaders.size === 0) {
      throw new Error(`MODULE_SERVICE_HEADER_DENIED: ${key}`);
    }
  });
}

function requestBody(input: ServiceHttpInput, operation: ModuleServiceOperationDefinition) {
  const headers = new Headers(input.headers);
  assertModuleHeadersAllowed(operation, headers);
  if (input.body !== undefined && input.json !== undefined) {
    throw new Error('MODULE_SERVICE_REQUEST_BODY_CONFLICT');
  }
  const bodyPolicy = operation.request?.body;
  if (bodyPolicy === 'none' && (input.body !== undefined || input.json !== undefined)) {
    throw new Error('MODULE_SERVICE_REQUEST_BODY_DENIED');
  }
  let body: BodyInit | null | undefined;
  let bodyText = '';
  if (input.body !== undefined) {
    if (typeof input.body !== 'string') {
      throw new Error('MODULE_SERVICE_REQUEST_BODY_INVALID');
    }
    if (bodyPolicy === 'json') {
      throw new Error('MODULE_SERVICE_REQUEST_BODY_DENIED');
    }
    body = input.body;
    bodyText = input.body;
  }
  if (input.json !== undefined) {
    if (bodyPolicy === 'text') {
      throw new Error('MODULE_SERVICE_REQUEST_BODY_DENIED');
    }
    body = stableJson(input.json);
    bodyText = body;
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  return { headers, body, bodyText };
}

function abortError(timeoutMs: number): Error {
  return new Error(`MODULE_SERVICE_TIMEOUT: ${timeoutMs}ms`);
}

async function withAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  if (signal.aborted) {
    throw abortError(timeoutMs);
  }
  let abortHandler: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        abortHandler = () => reject(abortError(timeoutMs));
        signal.addEventListener('abort', abortHandler, { once: true });
      }),
    ]);
  } finally {
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

async function readResponseBodyWithLimit(input: {
  response: Response;
  maxBytes: number;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<{ body: string; bytes: number }> {
  const body = input.response.body;
  if (!body) {
    return { body: '', bytes: 0 };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await withAbort(reader.read(), input.signal, input.timeoutMs);
      if (chunk.done) {
        text += decoder.decode();
        return { body: text, bytes };
      }
      bytes += chunk.value.byteLength;
      if (bytes > input.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`MODULE_SERVICE_RESPONSE_TOO_LARGE: ${bytes}/${input.maxBytes}`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

async function fetchWithTimeout(input: {
  fetchImpl: typeof fetch;
  url: URL;
  init: RequestInit;
  timeoutMs: number;
  maxResponseBytes: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await withAbort(
      input.fetchImpl(input.url, {
        ...input.init,
        redirect: 'manual',
        signal: controller.signal,
      }),
      controller.signal,
      input.timeoutMs
    );
    const responseBody = await readResponseBodyWithLimit({
      response,
      maxBytes: input.maxResponseBytes,
      signal: controller.signal,
      timeoutMs: input.timeoutMs,
    });
    return { response, ...responseBody };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`MODULE_SERVICE_TIMEOUT: ${input.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function retryPolicy(requirement: ModuleServiceRequirementDefinition) {
  const retry = requirement.connection?.retry;
  return {
    attempts: Math.max(1, Math.min(5, Math.floor(retry?.attempts ?? 1))),
    backoff: retry?.backoff ?? 'none',
    retryOn: new Set(retry?.retryOn ?? [502, 503, 504]),
  };
}

function retryDelayMs(backoff: string, attempt: number): number {
  if (backoff === 'linear') {
    return Math.min(1000, 100 * attempt);
  }
  if (backoff === 'exponential') {
    return Math.min(2000, 100 * 2 ** (attempt - 1));
  }
  return 0;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function resolveSecret(input: {
  connection: RuntimeStoreServiceConnectionRecord;
  secretName: string;
  secretResolver?: ServiceInvocationRuntimeOptions['secretResolver'];
}) {
  const ref = input.connection.secretRefs[input.secretName];
  if (!ref) {
    throw new Error(`MODULE_SERVICE_SECRET_REF_MISSING: ${input.secretName}`);
  }
  const resolved = input.secretResolver
    ? await input.secretResolver(ref)
    : ref.startsWith('env:')
      ? process.env[ref.slice(4)] ?? null
      : null;
  if (!resolved) {
    throw new Error(`MODULE_SERVICE_SECRET_MISSING: ${input.secretName}`);
  }
  return resolved;
}

function canonicalSigningValue(input: {
  canonical: readonly string[];
  method: string;
  path: string;
  timestamp: string;
  bodySha256: string;
  claimsSha256: string;
}) {
  const values: Record<string, string> = {
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    bodySha256: input.bodySha256,
    claimsSha256: input.claimsSha256,
  };
  return input.canonical
    .map((key) => {
      if (!SIGNING_CANONICAL_FIELDS.has(key)) {
        throw new Error(`MODULE_SERVICE_SIGNING_CANONICAL_INVALID: ${key}`);
      }
      return values[key] ?? '';
    })
    .join('\n');
}

function resolveHttpMethod(input: {
  operation: ModuleServiceOperationDefinition;
  operationInput: ServiceHttpInput;
  hasBody: boolean;
}): string {
  const inputMethod = input.operationInput.method?.trim().toUpperCase();
  if (inputMethod && !HTTP_METHODS.has(inputMethod)) {
    throw new Error(`MODULE_SERVICE_METHOD_INVALID: ${inputMethod}`);
  }
  const method = inputMethod ?? input.operation.method ?? (input.hasBody ? 'POST' : 'GET');
  if (input.operation.method && method !== input.operation.method) {
    throw new Error(`MODULE_SERVICE_METHOD_DENIED: ${method}`);
  }
  return method;
}

function requestTargetForSignature(target: URL): string {
  return `${target.pathname}${target.search}`;
}

function retryAllowedForRequest(method: string, headers: Headers): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'PUT' || method === 'DELETE') {
    return true;
  }
  return headers.has('idempotency-key') || headers.has('x-idempotency-key');
}

function applyAuthAndSigning(input: {
  requirement: ModuleServiceRequirementDefinition;
  operation: ModuleServiceOperationDefinition;
  connection: RuntimeStoreServiceConnectionRecord;
  headers: Headers;
  method: string;
  path: string;
  bodyText: string;
  claims: Record<string, string>;
  secretResolver?: ServiceInvocationRuntimeOptions['secretResolver'];
}) {
  return async () => {
    if (input.operation.auth?.type === 'bearer') {
      const secret = await resolveSecret({
        connection: input.connection,
        secretName: input.operation.auth.secret!,
        secretResolver: input.secretResolver,
      });
      input.headers.set(input.operation.auth.header ?? 'authorization', `Bearer ${secret}`);
    }
    if (input.operation.signing?.type === 'hmac-sha256') {
      const secret = await resolveSecret({
        connection: input.connection,
        secretName: input.operation.signing.secret!,
        secretResolver: input.secretResolver,
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const claimsJson = stableJson(input.claims);
      const bodySha256 = sha256(input.bodyText);
      const claimsSha256 = sha256(claimsJson);
      const canonical = canonicalSigningValue({
        canonical: input.operation.signing.canonical ?? [
          'method',
          'path',
          'timestamp',
          'bodySha256',
          'claimsSha256',
        ],
        method: input.method,
        path: input.path,
        timestamp,
        bodySha256,
        claimsSha256,
      });
      input.headers.set(input.operation.signing.timestampHeader ?? 'x-service-timestamp', timestamp);
      input.headers.set(
        input.operation.signing.claimsHeader ?? 'x-service-claims',
        Buffer.from(claimsJson).toString('base64url')
      );
      input.headers.set(
        input.operation.signing.header ?? 'x-service-signature',
        hmacSha256(secret, canonical)
      );
    }
  };
}

function redactValue(value: unknown, extraPaths: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, extraPaths));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      clone[key] = '[REDACTED]';
    } else {
      clone[key] = redactValue(item, extraPaths);
    }
  }
  for (const path of extraPaths) {
    const parts = path.split('.');
    let cursor: Record<string, unknown> | undefined = clone;
    for (const part of parts.slice(0, -1)) {
      const nextValue: unknown = cursor?.[part];
      cursor =
        nextValue && typeof nextValue === 'object'
          ? (nextValue as Record<string, unknown>)
          : undefined;
    }
    if (cursor && parts.at(-1)) {
      cursor[parts.at(-1)!] = '[REDACTED]';
    }
  }
  return clone;
}

function errorInfo(error: unknown) {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') {
      return {
        code: typeof record.code === 'string' ? record.code : 'MODULE_SERVICE_ERROR',
        message: record.message,
      };
    }
  }
  return error instanceof Error
    ? { code: error.name || 'MODULE_SERVICE_ERROR', message: error.message }
    : { code: 'MODULE_SERVICE_ERROR', message: String(error) };
}

function serviceErrorCode(error: unknown): string {
  const info = errorInfo(error);
  if (info.code !== 'Error' && info.code !== 'MODULE_SERVICE_ERROR') {
    return info.code;
  }
  const match = info.message.match(/^([A-Z][A-Z0-9_]+)(?::|\b)/);
  return match?.[1] ?? info.code;
}

function serviceFailureAffectsConnection(error: unknown): boolean {
  const code = serviceErrorCode(error);
  return (
    code === 'MODULE_SERVICE_SECRET_REF_MISSING' ||
    code === 'MODULE_SERVICE_SECRET_MISSING' ||
    code === 'MODULE_SERVICE_HTTP_UNSUPPORTED_BASE_URL' ||
    code === 'MODULE_SERVICE_PRIVATE_NETWORK_DENIED' ||
    code === 'MODULE_SERVICE_RESPONSE_TOO_LARGE' ||
    code === 'MODULE_SERVICE_TIMEOUT' ||
    code === 'MODULE_SERVICE_FETCH_FAILED' ||
    code === 'TypeError' ||
    code.startsWith('MODULE_SERVICE_UPSTREAM_')
  );
}

function safeServiceResult(
  result: ServiceInvokeResult,
  operation: ModuleServiceOperationDefinition
): unknown {
  const recordable =
    result.json === undefined
      ? result
      : {
          ...result,
          body: undefined,
        };
  return redactValue(recordable, operation.redaction?.response);
}

async function recordServiceInvocation(input: {
  store: RuntimeStore;
  contract: ModuleRuntimeContract;
  session: ModuleHostSession;
  connection?: RuntimeStoreServiceConnectionRecord;
  providerId: string;
  serviceName: string;
  operationName: string;
  target?: string;
  startedAt: number;
  status: 'succeeded' | 'failed';
  correlationId: string;
  attempts?: number;
  responseStatus?: number;
  responseBytes?: number;
  request: unknown;
  response?: unknown;
  error?: unknown;
  auditEvent?: string;
}) {
  const latencyMs = Date.now() - input.startedAt;
  const metadata = {
    service: input.serviceName,
    request: input.request,
    response: input.response,
    error: input.error ? errorInfo(input.error) : undefined,
  };
  await input.store.recordProviderInvocation({
    productId: productId(input.session),
    workspaceId: workspaceId(input.session, input.connection),
    moduleId: input.contract.id,
    providerId: input.providerId,
    kind: 'service',
    operation: input.operationName,
    status: input.status,
    target: input.target,
    serviceConnectionId: input.connection?.connectionId,
    usage: {
      attempts: input.attempts,
      responseStatus: input.responseStatus,
      responseBytes: input.responseBytes,
    },
    latencyMs,
    correlationId: input.correlationId,
    error: input.error ? errorInfo(input.error) : undefined,
    metadata,
  });
  await input.store.recordAudit({
    productId: productId(input.session),
    workspaceId: workspaceId(input.session, input.connection),
    moduleId: input.contract.id,
    actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
    type: input.auditEvent ?? 'module.service.invoked',
    metadata: {
      provider: input.providerId,
      service: input.serviceName,
      operation: input.operationName,
      status: input.status,
      target: input.target,
      latencyMs,
      correlationId: input.correlationId,
      request: input.request,
      response: input.response,
      error: input.error ? errorInfo(input.error) : undefined,
    },
  });
}

async function invokeSignedHttp(input: {
  options: ServiceInvocationRuntimeOptions;
  serviceName: string;
  operationName: string;
  requirement: ModuleServiceRequirementDefinition;
  operation: ModuleServiceOperationDefinition;
  connection: RuntimeStoreServiceConnectionRecord;
  operationInput: unknown;
}): Promise<ServiceInvokeResult> {
  assertAllowedInputFields(input.operation, input.operationInput);
  const parsedInput = parseServiceHttpInput(input.operationInput);
  const target = await resolveTargetUrl({
    requirement: input.requirement,
    connection: input.connection,
    operation: input.operation,
    operationInput: parsedInput,
    originRewrite: input.options.originRewrite,
    privateNetworkResolver: input.options.privateNetworkResolver ?? resolveDnsAddresses,
  });
  const { headers, body, bodyText } = requestBody(parsedInput, input.operation);
  const maxRequestBytes =
    input.requirement.connection?.maxRequestBytes ??
    numberValue(input.connection.config.maxRequestBytes) ??
    1024 * 1024;
  const bodyBytes = Buffer.byteLength(bodyText);
  if (bodyBytes > maxRequestBytes) {
    throw new Error(`MODULE_SERVICE_REQUEST_TOO_LARGE: ${bodyBytes}/${maxRequestBytes}`);
  }
  const resources = await loadResourceBindings(input.options);
  const claims = expandClaims({
    requirement: input.requirement,
    operation: input.operation,
    contract: input.options.contract,
    session: input.options.session,
    request: input.options.request,
    resources,
    operationInput: input.operationInput,
  });
  const method = resolveHttpMethod({
    operation: input.operation,
    operationInput: parsedInput,
    hasBody: body !== undefined && body !== null,
  });
  await applyAuthAndSigning({
    requirement: input.requirement,
    operation: input.operation,
    connection: input.connection,
    headers,
    method,
    path: requestTargetForSignature(target),
    bodyText,
    claims,
    secretResolver: input.options.secretResolver,
  })();

  const retry = retryPolicy(input.requirement);
  const timeoutMs =
    input.requirement.connection?.timeoutMs ??
    numberValue(input.connection.config.timeoutMs) ??
    8000;
  const maxResponseBytes =
    input.operation.response?.maxBytes ??
    input.requirement.connection?.maxResponseBytes ??
    numberValue(input.connection.config.maxResponseBytes) ??
    512 * 1024;
  const canRetry = retryAllowedForRequest(method, headers);
  let lastError: unknown;
  const attempts = canRetry ? retry.attempts : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { response, body: responseBody, bytes: responseBytes } = await fetchWithTimeout({
        fetchImpl: input.options.fetchImpl ?? fetch,
        url: target,
        init: {
          method,
          headers,
          body,
        },
        timeoutMs,
        maxResponseBytes,
      });
      if (response.status >= 500 && retry.retryOn.has(response.status) && attempt < attempts) {
        lastError = new Error(`MODULE_SERVICE_UPSTREAM_${response.status}`);
        await sleep(retryDelayMs(retry.backoff, attempt));
        continue;
      }
      const result: ServiceInvokeResult = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || target.toString(),
        headers: headersToRecord(response.headers),
        body: responseBody,
        bytes: responseBytes,
        attempts: attempt,
      };
      if ((input.operation.response?.body ?? 'json') === 'json' && responseBody) {
        result.json = JSON.parse(responseBody);
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(retryDelayMs(retry.backoff, attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('MODULE_SERVICE_FETCH_FAILED');
}

export function createServiceInvocationRuntime(
  options: ServiceInvocationRuntimeOptions
): ModuleServicesApi {
  return {
    async invoke<TInput = unknown, TResult = unknown>(
      serviceName: string,
      operationOrInput: string | TInput,
      inputOrOptions?: TInput | ModuleServiceInvokeOptions,
      maybeOptions?: ModuleServiceInvokeOptions
    ): Promise<TResult> {
      const requirement = options.contract.serviceRequirements[serviceName];
      if (!requirement) {
        throw new Error(`MODULE_SERVICE_REQUIREMENT_MISSING: ${serviceName}`);
      }
      const hasOperation = typeof operationOrInput === 'string' && arguments.length >= 3;
      if (!hasOperation) {
        if (requirement.operations && Object.keys(requirement.operations).length > 0) {
          throw new Error(`MODULE_SERVICE_OPERATION_REQUIRED: ${serviceName}`);
        }
        throw new Error(`MODULE_SERVICE_KIND_NOT_IMPLEMENTED: ${requirement.kind ?? 'unknown'}`);
      }
      const operationName = operationOrInput;
      const operationInput = inputOrOptions as TInput;
      const invokeOptions = maybeOptions;
      const operation = requirement.operations?.[operationName];
      if (!operation) {
        throw new Error(`MODULE_SERVICE_OPERATION_MISSING: ${serviceName}.${operationName}`);
      }
      if (requirement.kind !== 'signed-http') {
        throw new Error(`MODULE_SERVICE_KIND_NOT_IMPLEMENTED: ${requirement.kind ?? 'unknown'}`);
      }
      const connection = await resolveServiceConnection({
        contract: options.contract,
        store: options.store,
        session: options.session,
        serviceName,
      });
      if (!connection) {
        throw new Error(`MODULE_SERVICE_CONNECTION_MISSING: ${serviceName}`);
      }
      if (requirement.provider && connection.provider !== requirement.provider) {
        throw new Error(`MODULE_SERVICE_CONNECTION_PROVIDER_MISMATCH: ${connection.connectionId}`);
      }
      if (connection.status === 'disabled') {
        throw new Error(`MODULE_SERVICE_CONNECTION_DISABLED: ${connection.connectionId}`);
      }
      if (connection.status === 'blocked' && !options.readinessProbe) {
        throw new Error(`MODULE_SERVICE_CONNECTION_BLOCKED: ${connection.connectionId}`);
      }
      const status = healthStatus(connection);
      if (!options.readinessProbe && (status === 'blocked' || (requirement.required && status !== 'ready'))) {
        throw new Error(`MODULE_SERVICE_CONNECTION_NOT_READY: ${connection.connectionId}`);
      }

      const startedAt = Date.now();
      const correlationId = invokeOptions?.correlationId ?? options.request.correlationId;
      try {
        const result = await invokeSignedHttp({
          options: {
            ...options,
            request: { ...options.request, correlationId },
          },
          serviceName,
          operationName,
          requirement,
          operation,
          connection,
          operationInput,
        });
        const safeResult = safeServiceResult(result, operation);
        await options.store.touchServiceConnection(productId(options.session), connection.connectionId, {
          health: {
            ...connection.health,
            status: result.ok ? 'ready' : 'warning',
            lastTestAt: new Date().toISOString(),
            lastError: result.ok ? undefined : `HTTP ${result.status}`,
          },
        });
        await recordServiceInvocation({
          store: options.store,
          contract: options.contract,
          session: options.session,
          connection,
          providerId: connection.provider,
          serviceName,
          operationName,
          target: result.url,
          startedAt,
          status: result.ok ? 'succeeded' : 'failed',
          correlationId,
          attempts: result.attempts,
          responseStatus: result.status,
          responseBytes: result.bytes,
          request: redactValue(operationInput, operation.redaction?.request),
          response: safeResult,
          auditEvent: operation.audit?.event,
        });
        return safeResult as TResult;
      } catch (error) {
        if (serviceFailureAffectsConnection(error)) {
          await options.store
            .touchServiceConnection(productId(options.session), connection.connectionId, {
              health: {
                ...connection.health,
                status: 'blocked',
                lastTestAt: new Date().toISOString(),
                lastError: error instanceof Error ? error.message : String(error),
              },
            })
            .catch(() => undefined);
        }
        await recordServiceInvocation({
          store: options.store,
          contract: options.contract,
          session: options.session,
          connection,
          providerId: connection.provider,
          serviceName,
          operationName,
          startedAt,
          status: 'failed',
          correlationId,
          request: redactValue(operationInput, operation.redaction?.request),
          error: redactValue(errorInfo(error), operation.redaction?.error),
          auditEvent: operation.audit?.event,
        });
        throw error;
      }
    },
  };
}
