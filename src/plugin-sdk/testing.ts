import type {
  PluginConnectorAuthProfile,
  PluginConnectorEgressPolicy,
  PluginConnectorRedactionPolicy,
  PluginConnectorResolvedFile,
  PluginConnectorRetryPolicy,
  PluginContext,
  PluginServiceObjectRequest,
  PluginServiceRequest,
  PluginServiceRequestInit,
  PluginResourceBindingRecord,
  PluginResourceBindingStatus,
  PluginResourceScope,
  PluginRunCostReference,
  PluginRunFiles,
  PluginRunReference,
  PluginRunRetryPolicy,
  PluginRunVisibility,
  PluginUser,
} from './context';
import { PluginError } from './errors';
import { Permission, type PermissionValue } from './permissions';
import type { PluginStorage, PluginStorageCollection, PluginStorageQuery } from './storage';
import type { DefinedPlugin } from './types';
import {
  isPluginRouteCatchAllSegment,
  isPluginRouteDynamicSegment,
  normalizePluginRoutePath,
} from './route-patterns';

export interface PluginTestHelpers<TContext extends PluginContext = PluginContext> {
  ctx: TContext;
  plugin: DefinedPlugin;
  host: PluginTestHost<TContext>;
}

export type PluginTestScenario<TContext extends PluginContext = PluginContext> = (
  helpers: PluginTestHelpers<TContext>
) => Promise<void> | void;

export interface PluginTestRequestOptions {
  method?: string;
  url?: string;
  headers?: HeadersInit;
  params?: Record<string, string>;
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  text?: string;
  formData?: FormData;
}

export interface PluginTestHostStore {
  collections: Map<string, Map<string, Record<string, unknown>>>;
  artifacts: Map<string, Map<string, PluginTestArtifact>>;
  ragChunks: Map<string, PluginTestRagChunk[]>;
  config: Map<string, unknown>;
  secrets: Map<string, string>;
  workspaces: Map<
    string,
    { id: string; name: string; ownerUserId: string; createdAt: Date; updatedAt: Date }
  >;
  runs: Map<
    string,
    {
      id: string;
      scope: PluginResourceScope;
      title: string;
      visibility: PluginRunVisibility;
      status:
        | 'queued'
        | 'running'
        | 'waiting_external'
        | 'cancel_requested'
        | 'cancelled'
        | 'succeeded'
        | 'failed';
      progress: number;
      inputs: PluginRunReference[];
      results: PluginRunReference[];
      costs: PluginRunCostReference[];
      retry?: PluginRunRetryPolicy;
      metadata: Record<string, unknown>;
      createdAt: Date;
      updatedAt: Date;
    }
  >;
  apiKeys: Map<
    string,
    {
      id: string;
      key: string;
      name: string;
      scope: PluginResourceScope;
      permissions: string[];
      createdAt: Date;
      revokedAt?: Date;
    }
  >;
  rateLimits: Map<string, { count: number; resetAt: Date; limit: number }>;
  connectors: Map<
    string,
    {
      name: string;
      type: string;
      baseUrl: string;
      status: 'active' | 'disabled';
      scope?: PluginResourceScope;
      auth?: PluginConnectorAuthProfile;
      egress?: PluginConnectorEgressPolicy;
      retry?: PluginConnectorRetryPolicy;
      redaction?: PluginConnectorRedactionPolicy;
      authType?: string;
      secretName?: string;
      timeoutMs?: number;
      retryCount?: number;
      metadata?: Record<string, unknown>;
    }
  >;
  resourceBindings: Map<string, PluginResourceBindingRecord>;
  files: Map<string, PluginTestFile>;
}

export interface PluginTestHostOptions extends PluginTestRequestOptions {
  user?: PluginUser | null;
  store?: PluginTestHostStore;
  enforcePermissions?: boolean;
}

export interface PluginTestState {
  events: Array<{ event: string; payload?: Record<string, unknown> }>;
  jobs: Array<{ name: string; payload?: Record<string, unknown> }>;
  registeredJobs: Array<{ name: string; options?: unknown }>;
  audit: Array<{ action: string; details?: Record<string, unknown> }>;
  usage: Array<{
    metric: string;
    amount: number;
    options?: { idempotencyKey?: string; unit?: string; metadata?: Record<string, unknown> };
  }>;
  credits: Array<{
    operation: 'getBalance' | 'consume';
    meter?: string;
    metric?: string;
    amount?: number;
    userId?: string;
    idempotencyKey?: string;
    balanceBefore?: number;
    balanceAfter?: number;
    metadata?: Record<string, unknown>;
  }>;
  metering: Array<{
    operation: 'authorize' | 'commit' | 'refund' | 'void' | 'reconcile';
    meter?: string;
    amount?: number;
    unit?: string;
    idempotencyKey?: string;
    usageId?: string;
  }>;
  ai: Array<{
    operation: 'generateText' | 'streamText' | 'embedText';
    model: string;
    meter?: string;
    creditAmount?: number;
    idempotencyKey?: string;
    prompt?: string;
    inputCount?: number;
    metadata?: Record<string, unknown>;
    response?: unknown;
  }>;
  billing: Array<{
    operation: 'getCurrentPlan' | 'hasEntitlement' | 'grantPlan' | 'redeemCode';
    feature?: string;
    planId?: string;
    code?: string;
    userId?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }>;
  notifications: Array<{
    id: string;
    recipientUserId?: string;
    channel: 'in-app' | 'email';
    subject?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  toasts: Array<{ type: 'success' | 'error' | 'info'; message: string }>;
  files: Array<{
    operation:
      | 'createUpload'
      | 'completeUpload'
      | 'read'
      | 'get'
      | 'list'
      | 'createSignedUploadUrl'
      | 'createSignedDownloadUrl'
      | 'archive'
      | 'delete';
    id?: string;
    scope?: PluginResourceScope;
    fileName?: string;
    contentType?: string;
    status?: string;
    runId?: string;
  }>;
  artifacts: Array<{
    operation: 'writeText' | 'readText' | 'list' | 'tree' | 'updateMetadata' | 'delete';
    scope: PluginResourceScope;
    path?: string;
    prefix?: string;
  }>;
  rag: Array<{
    operation: 'index' | 'search' | 'buildContextPack' | 'delete';
    scope: PluginResourceScope;
    sourceId?: string;
    path?: string;
    query?: string;
    chunkCount?: number;
  }>;
  webhookVerifications: Array<{ policy?: string }>;
  httpRequests: Array<{ url: string; init?: RequestInit }>;
  workspace: Array<{ operation: string; workspaceId?: string }>;
  runs: Array<{ operation: string; runId?: string; status?: string }>;
  connectors: Array<{ operation: string; name: string; runId?: string; status?: number }>;
  apiKeys: Array<{ operation: string; id?: string; name?: string }>;
  rateLimit: Array<{ bucket: string; limit: number; window: string }>;
  resourceBindings: Array<{ operation: string; id?: string; resourceType?: string }>;
  services: Array<{ service: string; path: string; method: string; status: number }>;
}

export type PluginTestServiceHandler = (request: {
  service: string;
  path: string;
  method: string;
  headers: Headers;
  query: URLSearchParams;
  body?: unknown;
  scope?: PluginResourceScope;
}) => Response | Promise<Response>;

export interface PluginTestServices {
  [service: string]: PluginTestServiceHandler;
}

export interface PluginTestHost<TContext extends PluginContext = PluginContext> {
  ctx: TContext;
  state: PluginTestState;
  setRequest(options: PluginTestRequestOptions): void;
  readJson<T = unknown>(response: Response): Promise<T>;
  getCollection<TRecord extends Record<string, unknown> = Record<string, unknown>>(
    name: string
  ): TRecord[];
  seedCollection<TRecord extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    record: TRecord
  ): TRecord;
  reset(): void;
}

interface MutableRequestState {
  method: string;
  url: string;
  headers: Headers;
  params: Record<string, string>;
  query: URLSearchParams;
  json: unknown;
  text: string;
  formData: FormData;
}

interface PluginTestArtifact {
  id: string;
  scope: PluginResourceScope;
  path: string;
  contentType: string;
  content: string;
  metadata: Record<string, unknown>;
  version: number;
  size: number;
  hash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PluginTestRagChunk {
  id: string;
  scope: PluginResourceScope;
  sourceId: string;
  sourcePath?: string;
  chunkIndex: number;
  content: string;
  score?: number;
  metadata: Record<string, unknown>;
}

interface PluginTestFile {
  id: string;
  scope: PluginResourceScope;
  fileName: string;
  contentType: string;
  size: number;
  hash?: string;
  purpose: 'source' | 'result' | 'temp';
  status: 'pending_upload' | 'ready' | 'archived' | 'deleted';
  body?: Buffer;
  runId?: string;
  metadata: Record<string, unknown>;
  expiresAt?: Date;
  uploadedAt?: Date;
  archivedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

function createDefaultUser(): PluginUser {
  return { id: 'test-user', role: 'user', email: 'test@example.com' };
}

export function createPluginTestHostStore(): PluginTestHostStore {
  return {
    collections: new Map(),
    artifacts: new Map(),
    ragChunks: new Map(),
    config: new Map(),
    secrets: new Map(),
    workspaces: new Map(),
    runs: new Map(),
    apiKeys: new Map(),
    rateLimits: new Map(),
    connectors: new Map(),
    resourceBindings: new Map(),
    files: new Map(),
  };
}

function createInitialState(): PluginTestState {
  return {
    events: [],
    jobs: [],
    registeredJobs: [],
    audit: [],
    usage: [],
    credits: [],
    metering: [],
    ai: [],
    billing: [],
    notifications: [],
    toasts: [],
    files: [],
    artifacts: [],
    rag: [],
    webhookVerifications: [],
    httpRequests: [],
    workspace: [],
    runs: [],
    connectors: [],
    apiKeys: [],
    rateLimit: [],
    resourceBindings: [],
    services: [],
  };
}

function scopeKey(pluginId: string, user: PluginUser | null, name: string): string {
  return `${pluginId}:${user?.id ?? 'system'}:${name}`;
}

function resourceScopeKey(scope: PluginResourceScope, user: PluginUser | null): string {
  if (scope.type === 'workspace') {
    return `workspace:${scope.id}`;
  }
  return `user:${scope.id ?? user?.id ?? 'system'}`;
}

function normalizeConnectorAuthForTest(input: {
  auth?: PluginConnectorAuthProfile;
  authType?: string;
  secretName?: string;
}): PluginConnectorAuthProfile {
  if (input.auth) {
    return input.auth;
  }

  const type = input.authType ?? 'none';
  if (type === 'none') {
    return { type: 'none' };
  }
  if (type === 'bearer' || type === 'basic') {
    return { type, secretName: input.secretName ?? `${type}-secret` };
  }
  if (type === 'apiKey') {
    return { type, secretName: input.secretName ?? 'api-key-secret' };
  }
  return {
    type: 'custom',
    secretName: input.secretName ?? 'custom-secret',
    headerName: 'x-plugin-secret',
  };
}

function resolveTestMeter(plugin: DefinedPlugin, meterId: string) {
  const meter = plugin.meters?.find((entry) => entry.id === meterId);
  if (!meter) {
    throw new PluginError({
      code: 'PLUGIN_METERING_METER_UNDECLARED',
      message: `Meter "${meterId}" is not declared by plugin "${plugin.id}".`,
      statusCode: 400,
    });
  }
  return meter;
}

function testMeterCost(meter: { defaultCreditCost?: number; billable?: boolean }, amount: number) {
  return meter.billable === false ? 0 : Math.ceil((meter.defaultCreditCost ?? 0) * amount);
}

function groupRunFiles(
  files: Iterable<PluginTestFile>,
  runId: string,
  runScope: PluginResourceScope,
  user: PluginUser | null
): PluginRunFiles {
  const groups: PluginRunFiles = {
    inputs: [],
    outputs: [],
    temp: [],
  };
  const scopeKey = resourceScopeKey(runScope, user);

  for (const file of files) {
    if (file.runId !== runId || resourceScopeKey(file.scope, user) !== scopeKey) {
      continue;
    }

    if (file.purpose === 'source') {
      groups.inputs.push(file);
    } else if (file.purpose === 'result') {
      groups.outputs.push(file);
    } else {
      groups.temp.push(file);
    }
  }

  return groups;
}

function artifactStoreKey(
  pluginId: string,
  user: PluginUser | null,
  scope: PluginResourceScope
): string {
  return scopeKey(pluginId, user, resourceScopeKey(scope, user));
}

function ragStoreKey(
  pluginId: string,
  user: PluginUser | null,
  scope: PluginResourceScope
): string {
  return scopeKey(pluginId, user, `rag:${resourceScopeKey(scope, user)}`);
}

function formatPermissionFix(permission: PermissionValue): string {
  return `Add "${permission}" to plugin.ts permissions.`;
}

function byteSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function fakeHash(value: string): string {
  return `sha256:${Buffer.from(value).toString('base64url')}`;
}

function fakeBufferHash(value: Buffer): string {
  return `sha256:${value.toString('base64url')}`;
}

function simpleTokens(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const chars = Array.from(normalized.replace(/\s+/g, '')).filter(Boolean);
  return new Set([...words, ...chars]);
}

function simpleScore(query: string, content: string): number {
  const queryTokens = simpleTokens(query);
  const contentTokens = simpleTokens(content);
  if (queryTokens.size === 0) {
    return 0;
  }

  let matched = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matched += 1;
    }
  }

  return matched / queryTokens.size;
}

function splitFakeChunks(content: string, size = 1200, overlap = 120): string[] {
  const normalized = content.trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const end = Math.min(cursor + size, normalized.length);
    chunks.push(normalized.slice(cursor, end));
    if (end >= normalized.length) {
      break;
    }
    cursor = Math.max(end - overlap, cursor + 1);
  }

  return chunks;
}

function servicePathAllowed(pattern: string, servicePath: string): boolean {
  const normalizedPattern = normalizePluginRoutePath(pattern.replace(/\/\*\*$/, '/[...rest]'));
  const patternSegments =
    normalizedPattern === '/' ? [] : normalizedPattern.slice(1).split('/').filter(Boolean);
  const normalizedPath = normalizePluginRoutePath(servicePath);
  const pathSegments =
    normalizedPath === '/' ? [] : normalizedPath.slice(1).split('/').filter(Boolean);

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];

    if (isPluginRouteCatchAllSegment(patternSegment)) {
      return true;
    }

    if (pathSegment === undefined) {
      return false;
    }

    if (isPluginRouteDynamicSegment(patternSegment)) {
      continue;
    }

    if (patternSegment !== pathSegment) {
      return false;
    }
  }

  return patternSegments.length === pathSegments.length;
}

function normalizeTestPath(pathValue: string): string {
  return normalizePluginRoutePath(pathValue);
}

function interpolateTestServiceTemplate(
  template: string,
  params: Record<string, string | number | boolean | null | undefined> | undefined
): string {
  const values = params ?? {};
  const normalizedTemplate = normalizeTestPath(template);
  return normalizeTestPath(
    normalizedTemplate
      .split('/')
      .map((segment) => {
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
          });
        }
        return encodeURIComponent(String(value));
      })
      .join('/')
  );
}

function stateHasAiResponse(entry: { response?: unknown }): boolean {
  return Object.prototype.hasOwnProperty.call(entry, 'response');
}

function normalizeArtifactPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (!normalized || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new PluginError({
      code: 'PLUGIN_ARTIFACT_PATH_INVALID',
      message: `Artifact path "${path}" must be a safe relative path inside the workspace.`,
      statusCode: 400,
      details: {
        path,
      },
    });
  }

  return segments.join('/');
}

function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function createRequestState(pluginId: string, options: PluginTestRequestOptions = {}) {
  const url = new URL(options.url ?? `https://ploykit.test/plugins/${pluginId}`);
  if (options.query) {
    const query =
      options.query instanceof URLSearchParams
        ? options.query
        : new URLSearchParams(
            Object.entries(options.query)
              .filter((entry) => entry[1] !== undefined && entry[1] !== null)
              .map(([key, value]) => [key, String(value)])
          );
    url.search = query.toString();
  }
  const jsonBody = options.json ?? {};
  const textBody =
    options.text ?? (typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody));

  return {
    method: options.method ?? 'GET',
    url: url.toString(),
    headers: new Headers(options.headers),
    params: options.params ?? {},
    query: url.searchParams,
    json: jsonBody,
    text: textBody,
    formData: options.formData ?? new FormData(),
  };
}

function parseRequestJson(schema: unknown, value: unknown): unknown {
  if (schema && typeof schema === 'object' && 'parse' in schema) {
    return (schema as { parse(input: unknown): unknown }).parse(value);
  }

  return value;
}

function matchesWhere(record: Record<string, unknown>, query?: PluginStorageQuery): boolean {
  if (!query?.where) {
    return true;
  }

  return Object.entries(query.where).every(([field, expected]) => {
    const actual = record[field];

    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const operators = expected as Record<string, unknown>;
      if ('eq' in operators && actual !== operators.eq) return false;
      if ('ne' in operators && actual === operators.ne) return false;
      if ('in' in operators && Array.isArray(operators.in) && !operators.in.includes(actual)) {
        return false;
      }
      if ('contains' in operators && !String(actual ?? '').includes(String(operators.contains))) {
        return false;
      }
      return true;
    }

    return actual === expected;
  });
}

function applyQuery<TRecord extends Record<string, unknown>>(
  records: TRecord[],
  query?: PluginStorageQuery
): TRecord[] {
  const filtered = records.filter((record) => matchesWhere(record, query));
  const ordered = [...filtered];

  for (const [field, direction] of Object.entries(query?.orderBy ?? {}).reverse()) {
    ordered.sort((left, right) => {
      const leftValue = left[field];
      const rightValue = right[field];
      if (leftValue === rightValue) return 0;
      const result = String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
      return direction === 'asc' ? result : -result;
    });
  }

  const offset = query?.offset ?? 0;
  const limit = query?.limit ?? ordered.length;
  return ordered.slice(offset, offset + limit);
}

export function createPluginTestHost<TContext extends PluginContext = PluginContext>(
  plugin: DefinedPlugin,
  options: PluginTestHostOptions & { services?: PluginTestServices } = {}
): PluginTestHost<TContext> {
  const store = options.store ?? createPluginTestHostStore();
  const user = options.user === undefined ? createDefaultUser() : options.user;
  const shouldEnforcePermissions = options.enforcePermissions ?? true;
  const declaredPermissions = new Set(plugin.permissions ?? []);
  let state = createInitialState();
  let requestState: MutableRequestState = createRequestState(plugin.id, options);

  function enforcePermission(permission: PermissionValue, capability: string): void {
    if (!shouldEnforcePermissions || declaredPermissions.has(permission)) {
      return;
    }

    throw new PluginError({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      message: `Plugin "${plugin.id}" lacks permission "${permission}" for ${capability}.`,
      statusCode: 403,
      fix: formatPermissionFix(permission),
      details: {
        pluginId: plugin.id,
        capability,
        permission,
      },
    });
  }

  function toHttpUrl(urlInput: string | URL): URL {
    try {
      return urlInput instanceof URL ? urlInput : new URL(urlInput);
    } catch {
      throw new PluginError({
        code: 'PLUGIN_HTTP_URL_INVALID',
        message: `ctx.http.fetch URL must be absolute: "${String(urlInput)}".`,
        statusCode: 400,
        fix: 'Use an absolute http(s) URL that matches one of plugin.ts egress origins.',
        details: {
          url: String(urlInput),
        },
      });
    }
  }

  function assertHttpEgress(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new PluginError({
        code: 'PLUGIN_HTTP_PROTOCOL_FORBIDDEN',
        message: `ctx.http.fetch only supports http(s) URLs. Received "${url.protocol}".`,
        statusCode: 400,
        fix: 'Use an http(s) URL behind a declared egress origin.',
        details: {
          pluginId: plugin.id,
          protocol: url.protocol,
        },
      });
    }

    const allowedOrigins = new Set(
      (plugin.egress ?? [])
        .map((origin) => normalizeHttpOrigin(origin))
        .filter((origin): origin is string => Boolean(origin))
    );
    if (allowedOrigins.has(url.origin)) {
      return;
    }

    throw new PluginError({
      code: 'PLUGIN_HTTP_EGRESS_FORBIDDEN',
      message: `Plugin "${plugin.id}" is not allowed to fetch "${url.origin}".`,
      statusCode: 403,
      fix: `Add "${url.origin}" to plugin.ts egress and keep Permission.ExternalHttp declared.`,
      details: {
        pluginId: plugin.id,
        origin: url.origin,
        allowedOrigins: plugin.egress ?? [],
      },
    });
  }

  function getRecords<TRecord extends Record<string, unknown> = Record<string, unknown>>(
    name: string
  ): Map<string, TRecord> {
    const key = scopeKey(plugin.id, user, name);
    if (!store.collections.has(key)) {
      store.collections.set(key, new Map());
    }

    return store.collections.get(key)! as Map<string, TRecord>;
  }

  function normalizeScope(input?: PluginResourceScope): PluginResourceScope {
    if (!input || input.type === 'user') {
      return { type: 'user', id: input?.id ?? user?.id ?? 'system' };
    }
    return { type: 'workspace', id: input.id };
  }

  function declaredBinding(resourceType: string, scope: PluginResourceScope) {
    const normalized = normalizeScope(scope);
    return plugin.resourceBindings?.find(
      (binding) => binding.type === resourceType && binding.scope === normalized.type
    );
  }

  function bindingKey(scope: PluginResourceScope, resourceType: string, resourceId: string) {
    return `${plugin.id}:${resourceScopeKey(normalizeScope(scope), user)}:${resourceType}:${resourceId}`;
  }

  function getArtifacts(scope: PluginResourceScope): Map<string, PluginTestArtifact> {
    const normalizedScope = normalizeScope(scope);
    const key = artifactStoreKey(plugin.id, user, normalizedScope);
    if (!store.artifacts.has(key)) {
      store.artifacts.set(key, new Map());
    }

    return store.artifacts.get(key)!;
  }

  function getRagChunks(scope: PluginResourceScope): PluginTestRagChunk[] {
    const normalizedScope = normalizeScope(scope);
    const key = ragStoreKey(plugin.id, user, normalizedScope);
    if (!store.ragChunks.has(key)) {
      store.ragChunks.set(key, []);
    }

    return store.ragChunks.get(key)!;
  }

  function collection<TRecord extends Record<string, unknown> = Record<string, unknown>>(
    name: string
  ): PluginStorageCollection<TRecord> {
    const records = getRecords<TRecord>(name);

    return {
      async findMany(query) {
        enforcePermission(Permission.StorageRead, `ctx.storage.collection("${name}").findMany`);
        return applyQuery(Array.from(records.values()), query);
      },
      async findById(id: string) {
        enforcePermission(Permission.StorageRead, `ctx.storage.collection("${name}").findById`);
        return records.get(id) ?? null;
      },
      async insert(data) {
        enforcePermission(Permission.StorageWrite, `ctx.storage.collection("${name}").insert`);
        const id = String(data.id ?? `${name}-${records.size + 1}`);
        const record = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as TRecord;
        records.set(id, record);
        return record;
      },
      async update(id, data) {
        enforcePermission(Permission.StorageWrite, `ctx.storage.collection("${name}").update`);
        const existing = records.get(id);
        if (!existing) {
          throw new Error(`Record not found: ${id}`);
        }
        const record = { ...existing, ...data, updatedAt: new Date() } as TRecord;
        records.set(id, record);
        return record;
      },
      async delete(id: string) {
        enforcePermission(Permission.StorageWrite, `ctx.storage.collection("${name}").delete`);
        records.delete(id);
      },
    };
  }

  const storage: PluginStorage = {
    collection,
    async ensureCollections() {
      enforcePermission(Permission.StorageWrite, 'ctx.storage.ensureCollections');
      return undefined;
    },
    async transaction(fn) {
      enforcePermission(Permission.StorageWrite, 'ctx.storage.transaction');
      return fn(storage);
    },
  };

  function searchFakeRag(input: {
    scope: PluginResourceScope;
    query: string;
    topK?: number;
    sourceIds?: string[];
    pathPrefix?: string;
    metadata?: Record<string, unknown>;
  }) {
    const resourceScope = normalizeScope(input.scope);
    const topK = input.topK ?? 8;
    const pathPrefix = input.pathPrefix ? normalizeArtifactPath(input.pathPrefix) : undefined;
    return getRagChunks(resourceScope)
      .filter((chunk) => !input.sourceIds?.length || input.sourceIds.includes(chunk.sourceId))
      .filter((chunk) => !pathPrefix || chunk.sourcePath?.startsWith(pathPrefix))
      .filter(
        (chunk) =>
          !input.metadata ||
          Object.entries(input.metadata).every(([key, value]) => chunk.metadata[key] === value)
      )
      .map((chunk) => ({ ...chunk, score: simpleScore(input.query, chunk.content) }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
      .slice(0, topK)
      .map((chunk) => ({
        id: chunk.id,
        scope: chunk.scope,
        sourceId: chunk.sourceId,
        sourcePath: chunk.sourcePath,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        score: chunk.score,
        metadata: chunk.metadata,
      }));
  }

  const ctx: PluginContext = {
    plugin: { id: plugin.id, version: plugin.version, kind: plugin.kind ?? 'app' },
    user,
    auth: undefined,
    request: {
      get method() {
        return requestState.method;
      },
      get url() {
        return requestState.url;
      },
      get headers() {
        return requestState.headers;
      },
      get params() {
        return requestState.params;
      },
      get query() {
        return requestState.query;
      },
      async json(schema: unknown) {
        return parseRequestJson(schema, requestState.json);
      },
      async text() {
        return requestState.text;
      },
      async formData() {
        return requestState.formData;
      },
    },
    response: {
      json(data: unknown, init?: ResponseInit) {
        return Response.json(data, init);
      },
      redirect(url: string, status?: number) {
        return Response.redirect(url, status);
      },
      stream(body: ReadableStream, init?: ResponseInit) {
        return new Response(body, init);
      },
    },
    storage,
    workspace: {
      async current() {
        enforcePermission(Permission.WorkspaceRead, 'ctx.workspace.current');
        const current = Array.from(store.workspaces.values()).find(
          (workspace) => workspace.ownerUserId === user?.id
        );
        state.workspace.push({ operation: 'current', workspaceId: current?.id });
        return current
          ? {
              ...current,
              status: 'active' as const,
            }
          : null;
      },
      async list() {
        enforcePermission(Permission.WorkspaceRead, 'ctx.workspace.list');
        state.workspace.push({ operation: 'list' });
        return Array.from(store.workspaces.values())
          .filter((workspace) => workspace.ownerUserId === user?.id)
          .map((workspace) => ({ ...workspace, status: 'active' as const }));
      },
      async create(input) {
        enforcePermission(Permission.WorkspaceWrite, 'ctx.workspace.create');
        const now = new Date();
        const workspace = {
          id: `workspace-${store.workspaces.size + 1}`,
          name: input.name,
          slug: input.slug,
          ownerUserId: user?.id ?? 'test-user',
          status: 'active' as const,
          metadata: input.metadata,
          createdAt: now,
          updatedAt: now,
        };
        store.workspaces.set(workspace.id, workspace);
        state.workspace.push({ operation: 'create', workspaceId: workspace.id });
        return workspace;
      },
      async members(workspaceId) {
        enforcePermission(Permission.WorkspaceRead, 'ctx.workspace.members');
        const id = workspaceId ?? Array.from(store.workspaces.keys())[0] ?? 'workspace-1';
        state.workspace.push({ operation: 'members', workspaceId: id });
        return [
          {
            workspaceId: id,
            userId: user?.id ?? 'test-user',
            role: 'owner' as const,
            status: 'active' as const,
            email: user?.email,
            joinedAt: new Date(),
          },
        ];
      },
      async hasRole(_roles, workspaceId) {
        enforcePermission(Permission.WorkspaceRead, 'ctx.workspace.hasRole');
        state.workspace.push({ operation: 'hasRole', workspaceId });
        return true;
      },
      async invite(input) {
        enforcePermission(Permission.WorkspaceWrite, 'ctx.workspace.invite');
        state.workspace.push({ operation: 'invite', workspaceId: input.workspaceId });
        return {
          id: `invitation-${state.workspace.length}`,
          workspaceId: input.workspaceId,
          email: input.email,
          role: input.role,
          status: 'pending' as const,
          createdAt: new Date(),
        };
      },
    },
    ui: {
      toast: {
        async success(message: string) {
          enforcePermission(Permission.UiToast, 'ctx.ui.toast.success');
          state.toasts.push({ type: 'success', message });
        },
        async error(message: string) {
          enforcePermission(Permission.UiToast, 'ctx.ui.toast.error');
          state.toasts.push({ type: 'error', message });
        },
        async info(message: string) {
          enforcePermission(Permission.UiToast, 'ctx.ui.toast.info');
          state.toasts.push({ type: 'info', message });
        },
      },
    },
    events: {
      async emit(event: string, payload?: Record<string, unknown>) {
        enforcePermission(Permission.EventsEmit, 'ctx.events.emit');
        state.events.push({ event, payload });
      },
      on(_event: string, handler: Parameters<NonNullable<PluginContext['events']['on']>>[1]) {
        enforcePermission(Permission.EventsSubscribe, 'ctx.events.on');
        void handler?.(
          {},
          {
            event: _event,
            emitterId: 'test-host',
            timestamp: new Date(),
            eventId: `${_event}:test-event`,
            correlationId: `${_event}:test-correlation`,
          }
        );
      },
      off() {
        enforcePermission(Permission.EventsSubscribe, 'ctx.events.off');
      },
    },
    jobs: {
      async enqueue(name: string, payload?: Record<string, unknown>) {
        enforcePermission(Permission.JobsEnqueue, 'ctx.jobs.enqueue');
        state.jobs.push({ name, payload });
        return { id: `${name}:test-run` };
      },
      register(name: string, _handler: unknown, registerOptions?: unknown) {
        enforcePermission(Permission.JobsRegister, 'ctx.jobs.register');
        state.registeredJobs.push({ name, options: registerOptions });
      },
    },
    files: {
      async createUpload(input) {
        enforcePermission(Permission.FilesWrite, 'ctx.files.createUpload');
        const resourceScope = normalizeScope(input.scope);
        const now = new Date();
        const id = `file-${store.files.size + 1}`;
        let body: Buffer | undefined;
        let status: PluginTestFile['status'] = 'pending_upload';
        let hash: string | undefined;
        let uploadedAt: Date | undefined;
        if (input.body) {
          body =
            input.body instanceof ReadableStream
              ? Buffer.from(await new Response(input.body).arrayBuffer())
              : Buffer.from(input.body);
          hash = fakeBufferHash(body);
          status = 'ready';
          uploadedAt = now;
        }
        const file: PluginTestFile = {
          id,
          scope: resourceScope,
          fileName: input.fileName,
          contentType: input.contentType,
          size: input.size,
          hash,
          purpose: input.purpose,
          status,
          body,
          runId: input.runId,
          metadata: input.metadata ?? {},
          expiresAt: input.expiresAt,
          uploadedAt,
          createdAt: now,
          updatedAt: now,
        };
        store.files.set(id, file);
        state.files.push({
          operation: 'createUpload',
          id,
          scope: resourceScope,
          fileName: input.fileName,
          contentType: input.contentType,
          status,
          runId: input.runId,
        });
        return {
          id,
          scope: resourceScope,
          fileName: file.fileName,
          contentType: file.contentType,
          size: file.size,
          purpose: file.purpose,
          status: file.status,
          storageRef: `memory://${plugin.id}/${id}/${file.fileName}`,
          metadata: file.metadata,
          expiresAt: file.expiresAt,
          createdAt: file.createdAt,
        };
      },
      async completeUpload(input) {
        enforcePermission(Permission.FilesWrite, 'ctx.files.completeUpload');
        const existing = store.files.get(input.fileId);
        if (!existing) {
          throw new PluginError({
            code: 'PLUGIN_FILE_NOT_FOUND',
            message: 'File not found.',
            statusCode: 404,
          });
        }
        const updated: PluginTestFile = {
          ...existing,
          size: input.size,
          hash: input.hash ?? existing.hash,
          contentType: input.contentType ?? existing.contentType,
          metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
          status: 'ready',
          uploadedAt: new Date(),
          updatedAt: new Date(),
        };
        store.files.set(input.fileId, updated);
        state.files.push({
          operation: 'completeUpload',
          id: input.fileId,
          scope: updated.scope,
          status: updated.status,
        });
        return updated;
      },
      async read(id) {
        enforcePermission(Permission.FilesRead, 'ctx.files.read');
        const file = store.files.get(id);
        if (!file || file.status !== 'ready') {
          throw new PluginError({
            code: 'PLUGIN_FILE_NOT_FOUND',
            message: 'File not found.',
            statusCode: 404,
          });
        }
        state.files.push({ operation: 'read', id, scope: file.scope });
        return { record: file, body: file.body ?? Buffer.from(file.id) };
      },
      async get(id: string) {
        enforcePermission(Permission.FilesRead, 'ctx.files.get');
        const file = store.files.get(id) ?? null;
        state.files.push({ operation: 'get', id, scope: file?.scope });
        return file;
      },
      async list(input) {
        enforcePermission(Permission.FilesRead, 'ctx.files.list');
        const resourceScope = normalizeScope(input.scope);
        state.files.push({ operation: 'list', scope: resourceScope });
        return Array.from(store.files.values())
          .filter(
            (file) =>
              resourceScopeKey(file.scope, user) === resourceScopeKey(resourceScope, user) &&
              (!input.purpose || file.purpose === input.purpose) &&
              (!input.status || file.status === input.status) &&
              (!input.runId || file.runId === input.runId)
          )
          .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? store.files.size));
      },
      async createSignedUploadUrl(id: string) {
        enforcePermission(Permission.FilesWrite, 'ctx.files.createSignedUploadUrl');
        state.files.push({ operation: 'createSignedUploadUrl', id });
        return `https://ploykit.test/plugin-files/${id}/upload`;
      },
      async createSignedDownloadUrl(id: string) {
        enforcePermission(Permission.FilesRead, 'ctx.files.createSignedDownloadUrl');
        state.files.push({ operation: 'createSignedDownloadUrl', id });
        return `https://ploykit.test/plugin-files/${id}/download`;
      },
      async archive(id: string) {
        enforcePermission(Permission.FilesWrite, 'ctx.files.archive');
        const existing = store.files.get(id);
        if (!existing) {
          throw new PluginError({
            code: 'PLUGIN_FILE_NOT_FOUND',
            message: 'File not found.',
            statusCode: 404,
          });
        }
        const archived = {
          ...existing,
          status: 'archived' as const,
          archivedAt: new Date(),
          updatedAt: new Date(),
        };
        store.files.set(id, archived);
        state.files.push({ operation: 'archive', id, scope: archived.scope, status: 'archived' });
        return archived;
      },
      async delete(id: string) {
        enforcePermission(Permission.FilesWrite, 'ctx.files.delete');
        const existing = store.files.get(id);
        if (existing) {
          store.files.set(id, {
            ...existing,
            status: 'deleted',
            deletedAt: new Date(),
            updatedAt: new Date(),
          });
        }
        state.files.push({ operation: 'delete', id, scope: existing?.scope, status: 'deleted' });
      },
    },
    artifacts: {
      async writeText(input) {
        enforcePermission(Permission.ArtifactsWrite, 'ctx.artifacts.writeText');
        const resourceScope = normalizeScope(input.scope);
        const path = normalizeArtifactPath(input.path);
        const artifacts = getArtifacts(resourceScope);
        const existing = artifacts.get(path);
        const now = new Date();
        const artifact: PluginTestArtifact = {
          id: existing?.id ?? `${resourceScope.type}:${resourceScope.id}:${path}`,
          scope: resourceScope,
          path,
          contentType: input.contentType ?? 'text/plain',
          content: input.content,
          metadata: input.metadata ?? {},
          version: (existing?.version ?? 0) + 1,
          size: byteSize(input.content),
          hash: fakeHash(input.content),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        artifacts.set(path, artifact);
        state.artifacts.push({ operation: 'writeText', scope: resourceScope, path });
        return artifact;
      },
      async readText(input) {
        enforcePermission(Permission.ArtifactsRead, 'ctx.artifacts.readText');
        const resourceScope = normalizeScope(input.scope);
        const path = normalizeArtifactPath(input.path);
        state.artifacts.push({ operation: 'readText', scope: resourceScope, path });
        return getArtifacts(resourceScope).get(path) ?? null;
      },
      async list(input) {
        enforcePermission(Permission.ArtifactsRead, 'ctx.artifacts.list');
        const resourceScope = normalizeScope(input.scope);
        const prefix = input.prefix ? normalizeArtifactPath(input.prefix) : undefined;
        state.artifacts.push({ operation: 'list', scope: resourceScope, prefix });
        const rows = Array.from(getArtifacts(resourceScope).values())
          .filter((artifact) => !prefix || artifact.path.startsWith(prefix))
          .sort((left, right) => left.path.localeCompare(right.path));
        const offset = input.offset ?? 0;
        const limit = input.limit ?? rows.length;
        return rows
          .slice(offset, offset + limit)
          .map(({ content: _content, ...summary }) => summary);
      },
      async tree(input) {
        enforcePermission(Permission.ArtifactsRead, 'ctx.artifacts.tree');
        const resourceScope = normalizeScope(input.scope);
        const prefix = input.prefix ? normalizeArtifactPath(input.prefix) : undefined;
        state.artifacts.push({ operation: 'tree', scope: resourceScope, prefix });
        const rows = Array.from(getArtifacts(resourceScope).values())
          .filter((artifact) => !prefix || artifact.path.startsWith(prefix))
          .sort((left, right) => left.path.localeCompare(right.path));
        const offset = input.offset ?? 0;
        const limit = input.limit ?? rows.length;
        return rows.slice(offset, offset + limit).map(({ content: _content, ...summary }) => {
          const segments = summary.path.split('/');
          return {
            ...summary,
            name: segments.at(-1) ?? summary.path,
            parentPath: segments.length > 1 ? segments.slice(0, -1).join('/') : '',
          };
        });
      },
      async updateMetadata(input) {
        enforcePermission(Permission.ArtifactsWrite, 'ctx.artifacts.updateMetadata');
        const resourceScope = normalizeScope(input.scope);
        const path = normalizeArtifactPath(input.path);
        const artifacts = getArtifacts(resourceScope);
        const existing = artifacts.get(path);
        if (!existing) {
          throw new PluginError({
            code: 'PLUGIN_ARTIFACT_NOT_FOUND',
            message: `Artifact "${resourceScope.type}:${resourceScope.id}/${path}" was not found.`,
            statusCode: 404,
          });
        }
        const updated: PluginTestArtifact = {
          ...existing,
          metadata:
            input.merge === false ? input.metadata : { ...existing.metadata, ...input.metadata },
          version: existing.version + 1,
          updatedAt: new Date(),
        };
        artifacts.set(path, updated);
        state.artifacts.push({ operation: 'updateMetadata', scope: resourceScope, path });
        const { content: _content, ...summary } = updated;
        return summary;
      },
      async delete(input) {
        enforcePermission(Permission.ArtifactsWrite, 'ctx.artifacts.delete');
        const resourceScope = normalizeScope(input.scope);
        const path = normalizeArtifactPath(input.path);
        getArtifacts(resourceScope).delete(path);
        state.artifacts.push({ operation: 'delete', scope: resourceScope, path });
      },
    },
    rag: {
      async index(input) {
        enforcePermission(Permission.RagWrite, 'ctx.rag.index');
        const resourceScope = normalizeScope(input.scope);
        let sourceId = input.artifactId ?? input.path;
        let sourcePath = input.path ? normalizeArtifactPath(input.path) : undefined;
        let content = input.content;

        if (!content && sourcePath) {
          const artifact = getArtifacts(resourceScope).get(sourcePath);
          content = artifact?.content;
          sourceId = artifact?.id ?? sourceId;
          sourcePath = artifact?.path ?? sourcePath;
        }

        if (!content || !sourceId) {
          throw new PluginError({
            code: 'PLUGIN_RAG_SOURCE_NOT_FOUND',
            message: 'RAG index source was not found.',
            statusCode: 404,
          });
        }

        const chunks = getRagChunks(resourceScope);
        const remaining = chunks.filter((chunk) => chunk.sourceId !== sourceId);
        const chunkTexts = splitFakeChunks(content, input.chunkSize, input.chunkOverlap);
        const nextChunks = chunkTexts.map((chunk, index) => ({
          id: `${sourceId}:chunk-${index}`,
          scope: resourceScope,
          sourceId,
          sourcePath,
          chunkIndex: index,
          content: chunk,
          metadata: input.metadata ?? {},
        }));
        store.ragChunks.set(ragStoreKey(plugin.id, user, resourceScope), [
          ...remaining,
          ...nextChunks,
        ]);
        state.rag.push({
          operation: 'index',
          scope: resourceScope,
          sourceId,
          path: sourcePath,
          chunkCount: nextChunks.length,
        });
        return {
          scope: resourceScope,
          sourceId,
          sourcePath,
          sourceHash: fakeHash(content),
          chunkCount: nextChunks.length,
          indexedAt: new Date(),
        };
      },
      async search(input) {
        enforcePermission(Permission.RagRead, 'ctx.rag.search');
        const resourceScope = normalizeScope(input.scope);
        state.rag.push({ operation: 'search', scope: resourceScope, query: input.query });
        return searchFakeRag(input);
      },
      async buildContextPack(input) {
        enforcePermission(Permission.RagRead, 'ctx.rag.buildContextPack');
        const resourceScope = normalizeScope(input.scope);
        state.rag.push({ operation: 'buildContextPack', scope: resourceScope, query: input.query });
        const sources = searchFakeRag(input);
        const separator = input.separator ?? '\n\n---\n\n';
        const maxCharacters = input.maxCharacters ?? 8000;
        const content = sources
          .map(
            (source) =>
              `${source.sourcePath ?? source.sourceId}#${source.chunkIndex}\n${source.content}`
          )
          .join(separator)
          .slice(0, maxCharacters);
        return {
          scope: resourceScope,
          query: input.query,
          content,
          sources,
          characterCount: content.length,
        };
      },
      async delete(input) {
        enforcePermission(Permission.RagWrite, 'ctx.rag.delete');
        const resourceScope = normalizeScope(input.scope);
        const path = input.path ? normalizeArtifactPath(input.path) : undefined;
        const chunks = getRagChunks(resourceScope);
        store.ragChunks.set(
          ragStoreKey(plugin.id, user, resourceScope),
          chunks.filter(
            (chunk) =>
              (input.sourceId && chunk.sourceId !== input.sourceId) ||
              (path && chunk.sourcePath !== path) ||
              (!input.sourceId && !path)
          )
        );
        state.rag.push({
          operation: 'delete',
          scope: resourceScope,
          sourceId: input.sourceId,
          path,
        });
      },
    },
    ai: {
      async generateText(input) {
        enforcePermission(Permission.AiGenerate, 'ctx.ai.generateText');
        const model = input.model ?? 'test.generate';
        const prompt =
          input.prompt ??
          input.messages
            ?.map((message) => message.content)
            .filter(Boolean)
            .join('\n') ??
          '';
        state.ai.push({
          operation: 'generateText',
          model,
          meter: input.meter,
          creditAmount: input.creditAmount,
          idempotencyKey: input.idempotencyKey,
          prompt,
          metadata: input.metadata,
        });
        return {
          text: `Generated: ${prompt}`,
          model,
          provider: 'fake-host',
          finishReason: 'stop',
          usage: {
            inputTokens: Math.max(1, Math.ceil(prompt.length / 4)),
            outputTokens: 3,
            totalTokens: Math.max(4, Math.ceil(prompt.length / 4) + 3),
            creditsConsumed: input.creditAmount ?? 1,
          },
        };
      },
      streamText: async function* (input) {
        enforcePermission(Permission.AiGenerate, 'ctx.ai.streamText');
        const result = await this.generateText(input);
        const generatedEntry = [...state.ai].reverse().find(
          (entry) =>
            entry.operation === 'generateText' &&
            entry.model === result.model &&
            entry.prompt ===
              (input.prompt ??
                input.messages
                  ?.map((message) => message.content)
                  .filter(Boolean)
                  .join('\n') ??
                '') &&
            !stateHasAiResponse(entry)
        );
        if (generatedEntry) {
          generatedEntry.operation = 'streamText';
          generatedEntry.response = 'stream';
        }
        yield { type: 'text-delta' as const, text: result.text };
        yield { type: 'done' as const, result };
      },
      async embedText(input) {
        enforcePermission(Permission.AiEmbed, 'ctx.ai.embedText');
        const model = input.model ?? 'test.embed';
        const values = Array.isArray(input.input) ? input.input : [input.input];
        state.ai.push({
          operation: 'embedText',
          model,
          meter: input.meter,
          creditAmount: input.creditAmount,
          idempotencyKey: input.idempotencyKey,
          inputCount: values.length,
          metadata: input.metadata,
        });
        return {
          embeddings: values.map((value, index) => ({
            index,
            embedding: [
              value.length / 100,
              simpleTokens(value).size / 100,
              index / Math.max(values.length, 1),
            ],
          })),
          model,
          provider: 'fake-host',
          usage: {
            inputTokens: values.reduce(
              (sum, value) => sum + Math.max(1, Math.ceil(value.length / 4)),
              0
            ),
            totalTokens: values.reduce(
              (sum, value) => sum + Math.max(1, Math.ceil(value.length / 4)),
              0
            ),
            creditsConsumed: input.creditAmount ?? 1,
          },
        };
      },
    },
    secrets: {
      async get(name: string) {
        enforcePermission(Permission.SecretsRead, 'ctx.secrets.get');
        return store.secrets.get(scopeKey(plugin.id, user, name)) ?? null;
      },
      async set(name: string, value: string) {
        enforcePermission(Permission.SecretsWrite, 'ctx.secrets.set');
        store.secrets.set(scopeKey(plugin.id, user, name), value);
      },
      async delete(name: string) {
        enforcePermission(Permission.SecretsWrite, 'ctx.secrets.delete');
        store.secrets.delete(scopeKey(plugin.id, user, name));
      },
    },
    config: {
      async get<T = unknown>(key: string) {
        enforcePermission(Permission.ConfigRead, 'ctx.config.get');
        return (store.config.get(scopeKey(plugin.id, user, key)) as T | undefined) ?? null;
      },
      async set<T = unknown>(key: string, value: T) {
        enforcePermission(Permission.ConfigWrite, 'ctx.config.set');
        store.config.set(scopeKey(plugin.id, user, key), value);
      },
      async delete(key: string) {
        enforcePermission(Permission.ConfigWrite, 'ctx.config.delete');
        store.config.delete(scopeKey(plugin.id, user, key));
      },
    },
    resourceBindings: {
      async get(input) {
        enforcePermission(Permission.ResourceBindingsRead, 'ctx.resourceBindings.get');
        if (!declaredBinding(input.resourceType, input.scope)) {
          throw new PluginError({
            code: 'PLUGIN_RESOURCE_BINDING_UNDECLARED',
            message: `Resource binding "${input.resourceType}" is not declared.`,
            statusCode: 403,
          });
        }
        state.resourceBindings.push({ operation: 'get', resourceType: input.resourceType });
        const status = input.status ?? 'active';
        return (
          Array.from(store.resourceBindings.values()).find(
            (binding) =>
              binding.resourceType === input.resourceType &&
              (!input.resourceId || binding.resourceId === input.resourceId) &&
              binding.status === status &&
              resourceScopeKey(binding.scope, user) ===
                resourceScopeKey(normalizeScope(input.scope), user)
          ) ?? null
        );
      },
      async list(input) {
        enforcePermission(Permission.ResourceBindingsRead, 'ctx.resourceBindings.list');
        state.resourceBindings.push({ operation: 'list', resourceType: input.resourceType });
        const status = input.status ?? 'active';
        return Array.from(store.resourceBindings.values())
          .filter(
            (binding) =>
              (!input.resourceType || binding.resourceType === input.resourceType) &&
              binding.status === status &&
              resourceScopeKey(binding.scope, user) ===
                resourceScopeKey(normalizeScope(input.scope), user)
          )
          .slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 100));
      },
      async upsert(input) {
        enforcePermission(Permission.ResourceBindingsWrite, 'ctx.resourceBindings.upsert');
        const declaration = declaredBinding(input.resourceType, input.scope);
        if (!declaration) {
          throw new PluginError({
            code: 'PLUGIN_RESOURCE_BINDING_UNDECLARED',
            message: `Resource binding "${input.resourceType}" is not declared.`,
            statusCode: 403,
          });
        }
        const scope = normalizeScope(input.scope);
        const now = new Date();
        if ((declaration.cardinality ?? 'many') === 'one') {
          for (const [key, binding] of store.resourceBindings.entries()) {
            if (
              binding.resourceType === input.resourceType &&
              resourceScopeKey(binding.scope, user) === resourceScopeKey(scope, user)
            ) {
              store.resourceBindings.set(key, {
                ...binding,
                status: 'archived',
                archivedAt: now,
                updatedAt: now,
              });
            }
          }
        }
        const existingKey = bindingKey(scope, input.resourceType, input.resourceId);
        const existing = store.resourceBindings.get(existingKey);
        const record: PluginResourceBindingRecord = {
          id: existing?.id ?? `binding-${store.resourceBindings.size + 1}`,
          scope,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          cardinality: declaration.cardinality ?? 'many',
          displayName: input.displayName,
          status: (input.status ?? 'active') as PluginResourceBindingStatus,
          metadata: input.metadata ?? {},
          createdByUserId: existing?.createdByUserId ?? user?.id,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        store.resourceBindings.set(existingKey, record);
        state.resourceBindings.push({
          operation: 'upsert',
          id: record.id,
          resourceType: input.resourceType,
        });
        return record;
      },
      async archive(id) {
        enforcePermission(Permission.ResourceBindingsWrite, 'ctx.resourceBindings.archive');
        const existing = Array.from(store.resourceBindings.entries()).find(
          ([, binding]) => binding.id === id
        );
        if (!existing) {
          throw new PluginError({
            code: 'PLUGIN_RESOURCE_BINDING_NOT_FOUND',
            message: 'Resource binding not found.',
            statusCode: 404,
          });
        }
        const [key, binding] = existing;
        const archived = {
          ...binding,
          status: 'archived' as const,
          archivedAt: new Date(),
          updatedAt: new Date(),
        };
        store.resourceBindings.set(key, archived);
        state.resourceBindings.push({ operation: 'archive', id });
        return archived;
      },
    },
    audit: {
      async record(action: string, details?: Record<string, unknown>) {
        enforcePermission(Permission.AuditWrite, 'ctx.audit.record');
        state.audit.push({ action, details });
      },
    },
    usage: {
      async increment(
        metric: string,
        amount = 1,
        usageOptions?: {
          idempotencyKey?: string;
          unit?: string;
          metadata?: Record<string, unknown>;
        }
      ) {
        enforcePermission(Permission.UsageWrite, 'ctx.usage.increment');
        state.usage.push({ metric, amount, options: usageOptions });
      },
    },
    credits: {
      async getBalance(metric = 'platform.apiCallsRemaining') {
        enforcePermission(Permission.CreditsRead, 'ctx.credits.getBalance');
        const userId = user?.id ?? 'test-user';
        const balance = 1000;
        state.credits.push({ operation: 'getBalance', metric, userId });
        return { balance, metric, userId };
      },
      async consume(input) {
        enforcePermission(Permission.CreditsConsume, 'ctx.credits.consume');
        const amount = input.amount ?? 1;
        const userId = input.userId ?? user?.id ?? 'test-user';
        const consumedTotal = state.credits
          .filter((entry) => entry.operation === 'consume')
          .reduce((total, entry) => total + (entry.amount ?? 0), 0);
        const balanceBefore = 1000 - consumedTotal;
        const balanceAfter = Math.max(0, balanceBefore - amount);
        const idempotencyKey = input.idempotencyKey ?? `credits-${state.credits.length + 1}`;
        state.credits.push({
          operation: 'consume',
          meter: input.meter,
          amount,
          userId,
          idempotencyKey,
          balanceBefore,
          balanceAfter,
          metadata: input.metadata,
        });
        return {
          consumed: true,
          amount,
          balanceBefore,
          balanceAfter,
          meter: input.meter,
          userId,
          idempotencyKey,
          metadata: input.metadata,
        };
      },
    },
    metering: {
      async authorize(input) {
        enforcePermission(Permission.MeteringWrite, 'ctx.metering.authorize');
        const meter = resolveTestMeter(plugin, input.meter);
        const amount = input.amount ?? 1;
        const idempotencyKey = input.idempotencyKey ?? `metering-${state.metering.length + 1}`;
        state.metering.push({
          operation: 'authorize',
          meter: meter.id,
          amount,
          unit: meter.unit,
          idempotencyKey,
        });
        return {
          authorized: true,
          meter: meter.id,
          amount,
          unit: meter.unit,
          billable: meter.billable !== false,
          creditCost: testMeterCost(meter, amount),
          userId: user?.id ?? 'test-user',
          idempotencyKey,
        };
      },
      async commit(input) {
        enforcePermission(Permission.MeteringWrite, 'ctx.metering.commit');
        const authorized = await ctx.metering.authorize({
          ...input,
          idempotencyKey: input.idempotencyKey ?? `metering-${state.metering.length + 1}`,
        });
        const usageId = `usage-${state.usage.length + 1}`;
        await ctx.usage.increment(authorized.meter, authorized.amount, {
          idempotencyKey: `${authorized.idempotencyKey}:usage`,
          unit: authorized.unit,
          metadata: input.metadata,
        });
        const credits =
          authorized.creditCost > 0
            ? await ctx.credits.consume({
                meter: authorized.meter,
                amount: authorized.creditCost,
                idempotencyKey: `${authorized.idempotencyKey}:credits`,
                metadata: input.metadata,
              })
            : undefined;
        state.metering.push({
          operation: 'commit',
          meter: authorized.meter,
          amount: authorized.amount,
          unit: authorized.unit,
          idempotencyKey: authorized.idempotencyKey,
          usageId,
        });
        return { ...authorized, usageId, credits };
      },
      async refund(input) {
        enforcePermission(Permission.MeteringWrite, 'ctx.metering.refund');
        const meter = resolveTestMeter(plugin, input.meter);
        const amount = input.amount ?? 1;
        const idempotencyKey = input.idempotencyKey ?? `metering-${state.metering.length + 1}`;
        state.metering.push({
          operation: 'refund',
          meter: meter.id,
          amount,
          unit: meter.unit,
          idempotencyKey,
        });
        return {
          adjusted: true,
          meter: meter.id,
          amount,
          unit: meter.unit,
          userId: user?.id ?? 'test-user',
          idempotencyKey,
        };
      },
      async void(input) {
        enforcePermission(Permission.MeteringWrite, 'ctx.metering.void');
        const meter = resolveTestMeter(plugin, input.meter);
        const amount = input.amount ?? 1;
        const idempotencyKey = input.idempotencyKey ?? `metering-${state.metering.length + 1}`;
        state.metering.push({
          operation: 'void',
          meter: meter.id,
          amount,
          unit: meter.unit,
          idempotencyKey,
        });
        return {
          adjusted: true,
          meter: meter.id,
          amount,
          unit: meter.unit,
          userId: user?.id ?? 'test-user',
          idempotencyKey,
        };
      },
      async reconcile(input = {}) {
        enforcePermission(Permission.MeteringWrite, 'ctx.metering.reconcile');
        state.metering.push({ operation: 'reconcile', meter: input.meter });
        const usageAmount = state.usage
          .filter((entry) => !input.meter || entry.metric === input.meter)
          .reduce((sum, entry) => sum + entry.amount, 0);
        return {
          meter: input.meter,
          userId: input.userId ?? user?.id ?? 'test-user',
          usageAmount,
          unit: input.meter ? resolveTestMeter(plugin, input.meter).unit : undefined,
        };
      },
    },
    billing: {
      async getCurrentPlan() {
        enforcePermission(Permission.BillingRead, 'ctx.billing.getCurrentPlan');
        state.billing.push({ operation: 'getCurrentPlan' });
        return null;
      },
      async hasEntitlement(feature: string) {
        enforcePermission(Permission.BillingRead, 'ctx.billing.hasEntitlement');
        state.billing.push({ operation: 'hasEntitlement', feature });
        return false;
      },
      async grantPlan(input) {
        enforcePermission(Permission.BillingWrite, 'ctx.billing.grantPlan');
        const userId = input.userId ?? user?.id ?? 'test-user';
        const entitlementId = `entitlement-${state.billing.length + 1}`;
        state.billing.push({
          operation: 'grantPlan',
          planId: input.planId,
          userId,
          reason: input.reason,
          metadata: input.metadata,
          idempotencyKey: input.idempotencyKey,
        });
        return {
          entitlementId,
          userId,
          planId: input.planId,
          status: 'active',
          metadata: input.metadata,
        };
      },
      async redeemCode(input) {
        enforcePermission(Permission.BillingWrite, 'ctx.billing.redeemCode');
        const userId = input.userId ?? user?.id ?? 'test-user';
        const redemptionId = `redemption-${state.billing.length + 1}`;
        state.billing.push({
          operation: 'redeemCode',
          code: input.code,
          userId,
          metadata: input.metadata,
          idempotencyKey: input.idempotencyKey,
        });
        return {
          redeemed: true,
          redemptionId,
          message: 'Redeemed by fake plugin host.',
          metadata: input.metadata,
        };
      },
    },
    runs: {
      async create(input) {
        enforcePermission(Permission.RunsWrite, 'ctx.runs.create');
        const now = new Date();
        const run = {
          id: `run-${store.runs.size + 1}`,
          scope: normalizeScope(input.scope),
          title: input.title,
          visibility: input.visibility ?? 'internal',
          status: 'queued' as const,
          progress: 0,
          inputs: input.inputs ?? [],
          results: [],
          costs: input.costs ?? [],
          retry: input.retry,
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
        };
        store.runs.set(run.id, run);
        state.runs.push({ operation: 'create', runId: run.id, status: run.status });
        return run;
      },
      async update(id, input) {
        enforcePermission(Permission.RunsWrite, 'ctx.runs.update');
        const existing = store.runs.get(id);
        if (!existing)
          throw new PluginError({
            code: 'PLUGIN_RUN_NOT_FOUND',
            message: 'Run not found.',
            statusCode: 404,
          });
        const updated = {
          ...existing,
          status: input.status ?? existing.status,
          progress: input.progress ?? existing.progress,
          metadata: input.metadata ?? existing.metadata,
          updatedAt: new Date(),
        };
        store.runs.set(id, updated);
        state.runs.push({ operation: 'update', runId: id, status: updated.status });
        return updated;
      },
      async appendLog(id, input) {
        enforcePermission(Permission.RunsWrite, 'ctx.runs.appendLog');
        state.runs.push({ operation: 'appendLog', runId: id });
        return {
          id: `run-log-${state.runs.length}`,
          runId: id,
          ...input,
          metadata: input.metadata ?? {},
          createdAt: new Date(),
        };
      },
      async addResult(id, input) {
        enforcePermission(Permission.RunsWrite, 'ctx.runs.addResult');
        state.runs.push({ operation: 'addResult', runId: id });
        return {
          id: `run-result-${state.runs.length}`,
          runId: id,
          ...input,
          metadata: input.metadata ?? {},
          createdAt: new Date(),
        };
      },
      async complete(id, metadata) {
        return this.update(id, { status: 'succeeded', progress: 100, metadata });
      },
      async fail(id, error) {
        state.runs.push({ operation: 'fail', runId: id, status: 'failed' });
        return this.update(id, { status: 'failed', metadata: error.metadata });
      },
      async requestCancel(id) {
        return this.update(id, { status: 'cancel_requested' });
      },
      async get(id) {
        enforcePermission(Permission.RunsRead, 'ctx.runs.get');
        state.runs.push({ operation: 'get', runId: id });
        const run = store.runs.get(id);
        return run
          ? {
              ...run,
              results: [],
              files: groupRunFiles(store.files.values(), id, run.scope, user),
            }
          : null;
      },
      async list(input = {}) {
        enforcePermission(Permission.RunsRead, 'ctx.runs.list');
        state.runs.push({ operation: 'list' });
        return Array.from(store.runs.values()).filter(
          (run) =>
            (!input.status || run.status === input.status) &&
            (!input.scope ||
              resourceScopeKey(normalizeScope(input.scope), user) ===
                resourceScopeKey(run.scope, user))
        );
      },
    },
    connectors: {
      async get(name) {
        enforcePermission(Permission.ConnectorsRead, 'ctx.connectors.get');
        state.connectors.push({ operation: 'get', name });
        return (
          store.connectors.get(`${plugin.id}:${name}`) ?? {
            name,
            type: 'test',
            baseUrl: 'https://connector.test',
            status: 'active' as const,
            auth: { type: 'none' as const },
            egress: {},
            retry: {},
            redaction: {},
            metadata: {},
          }
        );
      },
      async list(input = {}) {
        enforcePermission(Permission.ConnectorsRead, 'ctx.connectors.list');
        state.connectors.push({ operation: 'list', name: '*' });
        return Array.from(store.connectors.values()).filter(
          (connector) =>
            (input.includeDisabled || connector.status === 'active') &&
            (!input.scope ||
              !connector.scope ||
              resourceScopeKey(connector.scope, user) ===
                resourceScopeKey(normalizeScope(input.scope), user))
        );
      },
      async upsert(input) {
        enforcePermission(Permission.ConnectorsManage, 'ctx.connectors.upsert');
        const auth = normalizeConnectorAuthForTest(input);
        const connector = {
          name: input.name,
          type: input.type ?? 'http',
          baseUrl: input.baseUrl,
          status: 'active' as const,
          scope: input.scope ? normalizeScope(input.scope) : undefined,
          auth,
          egress: input.egress,
          retry: input.retry,
          redaction: input.redaction,
          authType: auth.type,
          secretName: auth.type === 'none' ? undefined : auth.secretName,
          timeoutMs: input.timeoutMs ?? 30000,
          retryCount: input.retry?.count ?? input.retryCount ?? 0,
          metadata: input.metadata ?? {},
        };
        store.connectors.set(`${plugin.id}:${input.name}`, connector);
        state.connectors.push({ operation: 'upsert', name: input.name });
        return connector;
      },
      async setStatus(name, status) {
        enforcePermission(Permission.ConnectorsManage, 'ctx.connectors.setStatus');
        const existing = store.connectors.get(`${plugin.id}:${name}`) ?? {
          name,
          type: 'test',
          baseUrl: 'https://connector.test',
          status: 'active' as const,
          auth: { type: 'none' as const },
          egress: {},
          retry: {},
          redaction: {},
          metadata: {},
        };
        const updated = { ...existing, status };
        store.connectors.set(`${plugin.id}:${name}`, updated);
        state.connectors.push({ operation: 'setStatus', name });
        return updated;
      },
      async delete(name) {
        enforcePermission(Permission.ConnectorsManage, 'ctx.connectors.delete');
        store.connectors.delete(`${plugin.id}:${name}`);
        state.connectors.push({ operation: 'delete', name });
      },
      async call(name, request) {
        enforcePermission(Permission.ConnectorsInvoke, 'ctx.connectors.call');
        const resolvedFiles: PluginConnectorResolvedFile[] = [];
        if (request.files?.length) {
          enforcePermission(Permission.FilesRead, 'ctx.connectors.call(files)');
          if (request.body !== undefined && request.json === undefined) {
            throw new PluginError({
              code: 'PLUGIN_CONNECTOR_FILE_BODY_UNSUPPORTED',
              message: 'Connector file references require a JSON payload, not a raw body.',
              statusCode: 400,
            });
          }
          for (const reference of request.files) {
            const file = store.files.get(reference.fileId);
            if (!file || file.status !== 'ready') {
              throw new PluginError({
                code: 'PLUGIN_CONNECTOR_FILE_NOT_FOUND',
                message: `Connector file "${reference.fileId}" was not found.`,
                statusCode: 404,
              });
            }
            resolvedFiles.push({
              id: file.id,
              name: reference.name ?? file.fileName,
              scope: file.scope,
              fileName: file.fileName,
              contentType: file.contentType,
              size: file.size,
              hash: file.hash,
              purpose: file.purpose,
              runId: file.runId,
              downloadUrl: `https://ploykit.test/plugin-files/${file.id}/download`,
            });
          }
        }
        state.connectors.push({ operation: 'call', name, runId: request.runId, status: 200 });
        if (request.creditAmount) {
          await ctx.credits.consume({
            meter: request.meter ?? `${plugin.id}.connector.${name}`,
            amount: request.creditAmount,
            idempotencyKey: request.idempotencyKey,
          });
        }
        return {
          status: 200,
          ok: true,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({
            ok: true,
            connector: name,
            ...(resolvedFiles.length ? { files: resolvedFiles } : {}),
          }),
          json: {
            ok: true,
            connector: name,
            ...(resolvedFiles.length ? { files: resolvedFiles } : {}),
          },
          callId: `connector-call-${state.connectors.length}`,
        };
      },
      async createSignedCallback(input) {
        enforcePermission(Permission.ConnectorsInvoke, 'ctx.connectors.createSignedCallback');
        state.connectors.push({
          operation: 'createSignedCallback',
          name: input.connector,
          runId: input.runId,
        });
        return {
          url: `https://ploykit.test/api/plugins/${plugin.id}/connectors/${input.connector}/callback`,
          token: `callback-token-${state.connectors.length}`,
          expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? 3600) * 1000),
        };
      },
    },
    apiKeys: {
      async create(input) {
        enforcePermission(Permission.ApiKeysWrite, 'ctx.apiKeys.create');
        const createdAt = new Date();
        const record = {
          id: `api-key-${store.apiKeys.size + 1}`,
          key: `pk_test_${store.apiKeys.size + 1}`,
          name: input.name,
          scope: normalizeScope(input.scope),
          permissions: input.permissions ?? [],
          createdAt,
        };
        store.apiKeys.set(record.id, record);
        state.apiKeys.push({ operation: 'create', id: record.id, name: input.name });
        return { ...record, expiresAt: input.expiresAt };
      },
      async list(input = {}) {
        enforcePermission(Permission.ApiKeysRead, 'ctx.apiKeys.list');
        state.apiKeys.push({ operation: 'list' });
        return Array.from(store.apiKeys.values())
          .filter(
            (key) =>
              !input.scope ||
              resourceScopeKey(key.scope, user) ===
                resourceScopeKey(normalizeScope(input.scope), user)
          )
          .map(({ key: _key, ...record }) => record);
      },
      async revoke(id) {
        enforcePermission(Permission.ApiKeysWrite, 'ctx.apiKeys.revoke');
        const existing = store.apiKeys.get(id);
        if (existing) {
          store.apiKeys.set(id, { ...existing, revokedAt: new Date() });
        }
        state.apiKeys.push({ operation: 'revoke', id });
      },
    },
    rateLimit: {
      async check(input) {
        enforcePermission(Permission.RateLimitCheck, 'ctx.rateLimit.check');
        state.rateLimit.push({ bucket: input.bucket, limit: input.limit, window: input.window });
        return {
          allowed: true,
          remaining: Math.max(input.limit - (input.cost ?? 1), 0),
          resetAt: new Date(Date.now() + 60000),
        };
      },
    },
    notifications: {
      async send(input) {
        enforcePermission(Permission.NotificationsSend, 'ctx.notifications.send');
        const id = `notification-${state.notifications.length + 1}`;
        state.notifications.push({
          id,
          recipientUserId: input.recipientUserId ?? user?.id,
          channel: input.channel ?? 'in-app',
          subject: input.subject,
          message: input.message,
          metadata: input.metadata,
        });
        return { id, queued: false };
      },
    },
    webhooks: {
      async verify(policy?: string) {
        enforcePermission(Permission.WebhookReceive, 'ctx.webhooks.verify');
        state.webhookVerifications.push({ policy });
        return { verified: true };
      },
      respondAccepted() {
        enforcePermission(Permission.WebhookReceive, 'ctx.webhooks.respondAccepted');
        return Response.json({ accepted: true }, { status: 202 });
      },
    },
    http: {
      async fetch(url: string | URL, init?: RequestInit) {
        enforcePermission(Permission.ExternalHttp, 'ctx.http.fetch');
        const parsedUrl = toHttpUrl(url);
        assertHttpEgress(parsedUrl);
        state.httpRequests.push({ url: parsedUrl.href, init });
        return Response.json({ ok: true, url: parsedUrl.href });
      },
    },
    services: {
      async fetch(
        service: string,
        servicePathOrRequest: PluginServiceRequest,
        init: PluginServiceRequestInit = {}
      ): Promise<Response> {
        enforcePermission(Permission.ServicesInvoke, 'ctx.services.fetch');
        const declaration = plugin.services?.find((entry) => entry.name === service);
        const request =
          typeof servicePathOrRequest === 'string'
            ? { path: servicePathOrRequest, ...init }
            : servicePathOrRequest;
        const method = (request.method ?? 'GET').toUpperCase();
        if (!declaration) {
          throw new PluginError({
            code: 'PLUGIN_SERVICE_UNDECLARED',
            message: `Service "${service}" is not declared.`,
            statusCode: 403,
          });
        }
        if (!declaration.methods.map((item) => item.toUpperCase()).includes(method)) {
          throw new PluginError({
            code: 'PLUGIN_SERVICE_METHOD_FORBIDDEN',
            message: `Service "${service}" does not allow method "${method}".`,
            statusCode: 403,
          });
        }
        const servicePath = request.template
          ? interpolateTestServiceTemplate(request.template, request.params)
          : request.path;
        if (!servicePath) {
          throw new PluginError({
            code: 'PLUGIN_SERVICE_PATH_REQUIRED',
            message: `Service "${service}" requires a path or template.`,
            statusCode: 400,
          });
        }
        const allowed = declaration.paths.some((pathPattern) =>
          request.template
            ? normalizeTestPath(pathPattern) === normalizeTestPath(request.template)
            : servicePathAllowed(pathPattern, servicePath)
        );
        if (!allowed) {
          throw new PluginError({
            code: 'PLUGIN_SERVICE_PATH_FORBIDDEN',
            message: `Service "${service}" does not allow path "${servicePath}".`,
            statusCode: 403,
          });
        }
        const handler = options.services?.[service];
        if (!handler) {
          throw new PluginError({
            code: 'PLUGIN_SERVICE_NOT_REGISTERED',
            message: `Test service "${service}" is not registered.`,
            statusCode: 502,
          });
        }
        const query =
          request.query instanceof URLSearchParams
            ? request.query
            : new URLSearchParams(
                Object.entries(request.query ?? {})
                  .filter((entry) => entry[1] !== undefined && entry[1] !== null)
                  .map(([key, value]) => [key, String(value)])
              );
        const response = await handler({
          service,
          path: servicePath,
          method,
          headers: new Headers(request.headers),
          query,
          body: request.json ?? request.body,
          scope: request.scope,
        });
        state.services.push({ service, path: servicePath, method, status: response.status });
        return response;
      },
      async json<T = unknown>(
        service: string,
        servicePathOrRequest: PluginServiceRequest,
        init?: PluginServiceRequestInit
      ): Promise<T> {
        const response =
          typeof servicePathOrRequest === 'string'
            ? await ctx.services.fetch(service, servicePathOrRequest, init)
            : await ctx.services.fetch(service, servicePathOrRequest);
        if (!response.ok) {
          throw new PluginError({
            code: 'SERVICE_REQUEST_FAILED',
            message: `Test service "${service}" returned ${response.status}.`,
            statusCode: 502,
          });
        }
        return response.json() as Promise<T>;
      },
      async requestJson<T = unknown>(service: string, request: PluginServiceObjectRequest) {
        const response = await ctx.services.fetch(service, request);
        const headers = new Headers(response.headers);
        const contentType = response.headers.get('content-type') ?? '';
        const payload = contentType.includes('application/json')
          ? await response.json()
          : await response.text();
        if (response.ok) {
          return { ok: true, status: response.status, data: payload as T, headers };
        }
        if (request.errorMode === 'throw') {
          throw new PluginError({
            code: 'SERVICE_REQUEST_FAILED',
            message: `Test service "${service}" returned ${response.status}.`,
            statusCode: 502,
          });
        }
        return { ok: false, status: response.status, error: payload, headers };
      },
    },
    json(data: unknown, init?: ResponseInit) {
      return Response.json(data, init);
    },
  };

  const host: PluginTestHost<TContext> = {
    ctx: ctx as unknown as TContext,
    state,
    setRequest(requestOptions) {
      requestState = createRequestState(plugin.id, requestOptions);
    },
    async readJson<T = unknown>(response: Response): Promise<T> {
      return response.json() as Promise<T>;
    },
    getCollection<TRecord extends Record<string, unknown> = Record<string, unknown>>(
      name: string
    ): TRecord[] {
      return Array.from(
        (store.collections.get(scopeKey(plugin.id, user, name)) ?? new Map()).values()
      ) as TRecord[];
    },
    seedCollection<TRecord extends Record<string, unknown> = Record<string, unknown>>(
      name: string,
      record: TRecord
    ): TRecord {
      const records = getRecords<TRecord>(name);
      const id = String(record.id ?? `${name}-${records.size + 1}`);
      const seeded = {
        ...record,
        id,
        createdAt: record.createdAt ?? new Date(),
        updatedAt: record.updatedAt ?? new Date(),
      } as TRecord;
      records.set(id, seeded);
      return seeded;
    },
    reset() {
      store.collections.clear();
      store.artifacts.clear();
      store.ragChunks.clear();
      store.config.clear();
      store.secrets.clear();
      store.workspaces.clear();
      store.runs.clear();
      store.apiKeys.clear();
      store.rateLimits.clear();
      store.connectors.clear();
      store.resourceBindings.clear();
      store.files.clear();
      state = createInitialState();
      host.state = state;
      requestState = createRequestState(plugin.id);
    },
  };

  return host;
}

export function testPlugin<TContext extends PluginContext = PluginContext>(
  plugin: DefinedPlugin,
  scenario: PluginTestScenario<TContext>
) {
  return {
    plugin,
    scenario,
  };
}
