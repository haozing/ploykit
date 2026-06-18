import type {
  ModuleArtifactRecord,
  ModuleArtifactWriteInput,
  ModuleArtifactsApi,
  ModuleAiApi,
  ModuleApiKeysApi,
  ModuleAuditApi,
  ModuleCacheApi,
  ModuleConfigApi,
  ModuleConnectorsApi,
  ModuleContext,
  ModuleEventsApi,
  ModuleFileRecord,
  ModuleFilesApi,
  ModuleHttpApi,
  ModuleJobsApi,
  ModuleNotificationRecord,
  ModuleNotificationsApi,
  ModuleRagApi,
  ModuleRateLimitApi,
  ModuleRequest,
  ModuleResourceBindingsApi,
  ModuleResponseFactory,
  ModuleRiskApi,
  ModuleRunRecord,
  ModuleRunsApi,
  ModuleServiceInvokeOptions,
  ModuleScopeContext,
  ModuleSecretsApi,
  ModuleServicesApi,
  ModuleUsageApi,
  ModuleUser,
  ModuleWebhooksApi,
} from './context';
import {
  createTestingBillingApi,
  createTestingCommerceApi,
  createTestingCreditsApi,
  createTestingEntitlementsApi,
  createTestingMeteringApi,
  createTestingRedeemCodesApi,
} from './testing-commercial';
import { createTestingDataApi } from './testing-data';

export interface CreateTestingModuleContextOptions {
  moduleId?: string;
  moduleVersion?: string;
  user?: ModuleUser | null;
  request?: Partial<ModuleRequest>;
  services?: ModuleServicesApi;
  serviceHandlers?: Record<string, TestingServiceHandler>;
}

export type TestingServiceHandler<TInput = unknown, TResult = unknown> = (input: {
  service: string;
  operation: string;
  request: TInput;
  options?: ModuleServiceInvokeOptions;
}) => TResult | Promise<TResult>;

function createResponseFactory(): ModuleResponseFactory {
  return {
    json(data, init) {
      return Response.json(data, init);
    },
    redirect(url, status = 302) {
      return Response.redirect(url, status);
    },
    stream(body, init) {
      return new Response(body, init);
    },
  };
}

function createTestingScope(user: ModuleUser | null): ModuleScopeContext {
  return {
    profile: 'hidden-default',
    resource: 'workspace',
    productId: 'test-product',
    environmentId: 'test',
    workspaceId: 'test-workspace',
    userId: user?.id ?? null,
    actorId: user?.id ?? null,
    workspaceRole: 'owner',
  };
}

function createTestingConfigApi(): ModuleConfigApi {
  const values = new Map<string, unknown>();
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      return (values.get(key) as T | undefined) ?? null;
    },
    async require<T = unknown>(key: string): Promise<T> {
      if (!values.has(key)) {
        throw new Error(`MODULE_TEST_CONFIG_MISSING: ${key}`);
      }
      return values.get(key) as T;
    },
  };
}

function createTestingSecretsApi(): ModuleSecretsApi {
  return {
    async get() {
      return null;
    },
    async require(name) {
      throw new Error(`MODULE_TEST_SECRET_MISSING: ${name}`);
    },
  };
}

export function createTestingServicesApi(
  handlers: Record<string, TestingServiceHandler> = {}
): ModuleServicesApi {
  return {
    async invoke<TInput = unknown, TResult = unknown>(
      name: string,
      operationOrInput: string | TInput,
      inputOrOptions?: TInput | ModuleServiceInvokeOptions,
      maybeOptions?: ModuleServiceInvokeOptions
    ): Promise<TResult> {
      const operation = typeof operationOrInput === 'string' ? operationOrInput : 'default';
      const request = (typeof operationOrInput === 'string' ? inputOrOptions : operationOrInput) as TInput;
      const options = (typeof operationOrInput === 'string' ? maybeOptions : inputOrOptions) as
        | ModuleServiceInvokeOptions
        | undefined;
      const handler = handlers[`${name}.${operation}`] ?? handlers[name];
      if (!handler) {
        throw new Error(`MODULE_TEST_SERVICE_UNAVAILABLE: ${name}.${operation}`);
      }
      return (await handler({
        service: name,
        operation,
        request,
        options,
      })) as TResult;
    },
  };
}

function createTestingConnectorsApi(): ModuleConnectorsApi {
  return {
    async get() {
      return null;
    },
    async invoke() {
      throw new Error('MODULE_TEST_CONNECTOR_UNAVAILABLE');
    },
  };
}

function createTestingResourceBindingsApi(): ModuleResourceBindingsApi {
  return {
    async get() {
      return null;
    },
    async list() {
      return [];
    },
    async upsert<TBinding = unknown>(_name: string, value: TBinding): Promise<TBinding> {
      return value;
    },
  };
}

function createTestingHttpApi(): ModuleHttpApi {
  return {
    async fetch() {
      return Response.json({ ok: true });
    },
  };
}

function createTestingAuditApi(): ModuleAuditApi {
  return {
    async record() {
      return undefined;
    },
  };
}

function createTestingUsageApi(moduleId: string): ModuleUsageApi {
  let nextId = 1;
  const record: ModuleUsageApi['record'] = async (input) => ({
    id: `test_usage_${nextId++}`,
    moduleId,
    meter: input.meter,
    quantity: input.quantity ?? 1,
    unit: input.unit,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  });
  return {
    record,
    increment: record,
  };
}

function createTestingAiApi(): ModuleAiApi {
  return {
    async generateText(input) {
      return {
        text: input.prompt,
        model: input.model ?? 'test-model',
        usage: {
          inputTokens: input.prompt.length,
          outputTokens: input.prompt.length,
        },
      };
    },
    async *streamText(input) {
      yield input.prompt;
    },
    async embedText(input) {
      return {
        embedding: [input.text.length],
        model: input.model ?? 'test-embedding',
        usage: {
          inputTokens: input.text.length,
        },
      };
    },
  };
}

function createTestingRagApi(): ModuleRagApi {
  const documents = new Map<
    string,
    { id: string; content: string; metadata: Record<string, unknown> }
  >();
  const api: ModuleRagApi = {
    async index(input) {
      const document = {
        id: input.id ?? `test_rag_${documents.size + 1}`,
        content: input.content,
        metadata: input.metadata ?? {},
      };
      documents.set(document.id, document);
      return { ...document };
    },
    async search(input) {
      return [...documents.values()]
        .filter((document) => document.content.includes(input.query))
        .slice(0, input.limit ?? 5)
        .map((document) => ({ ...document, score: 1 }));
    },
    async contextPack(input) {
      const results = await api.search(input);
      return {
        context: results.map((document) => document.content).join('\n\n'),
        documents: results,
      };
    },
    async buildContextPack(input) {
      return api.contextPack(input);
    },
    async delete(id) {
      documents.delete(id);
    },
  };
  return api;
}

function createTestingFilesApi(moduleId: string): ModuleFilesApi {
  let nextId = 1;
  const files = new Map<string, ModuleFileRecord>();
  const now = () => new Date().toISOString();

  const api: ModuleFilesApi = {
    async createUpload(input) {
      const id = `test_file_${nextId++}`;
      const timestamp = now();
      const file: ModuleFileRecord = {
        id,
        moduleId,
        name: input.name,
        purpose: input.purpose,
        status: 'uploading',
        contentType: input.contentType,
        sizeBytes: input.sizeBytes ?? 0,
        runId: input.runId,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt:
          input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt,
      };
      files.set(id, file);
      return { file: { ...file }, uploadUrl: `test-upload://${id}` };
    },
    async createSignedUploadUrl(input) {
      return api.createUpload(input);
    },
    async completeUpload(id, input = {}) {
      const file = files.get(id);
      if (!file) {
        throw new Error(`MODULE_TEST_FILE_NOT_FOUND: ${id}`);
      }
      const next = {
        ...file,
        status: 'ready' as const,
        sizeBytes: input.sizeBytes ?? file.sizeBytes,
        metadata: { ...file.metadata, ...(input.metadata ?? {}) },
        updatedAt: now(),
      };
      files.set(id, next);
      return { ...next };
    },
    async read(id) {
      const file = files.get(id);
      return file ? { ...file } : null;
    },
    async get(id) {
      return api.read(id);
    },
    async list(query = {}) {
      return [...files.values()]
        .filter((file) => file.status !== 'deleted')
        .filter((file) => !query.purpose || file.purpose === query.purpose)
        .filter((file) => !query.status || file.status === query.status)
        .filter((file) => !query.runId || file.runId === query.runId)
        .map((file) => ({ ...file }));
    },
    async createSignedUrl(id) {
      if (!files.has(id)) {
        throw new Error(`MODULE_TEST_FILE_NOT_FOUND: ${id}`);
      }
      return `test-file://${id}`;
    },
    async createSignedDownloadUrl(id, options) {
      return api.createSignedUrl(id, options);
    },
    async publish(id) {
      const file = files.get(id);
      if (!file) {
        throw new Error(`MODULE_TEST_FILE_NOT_FOUND: ${id}`);
      }
      const next = { ...file, status: 'published' as const, updatedAt: now(), publishedAt: now() };
      files.set(id, next);
      return { ...next };
    },
    async unpublish(id) {
      const file = files.get(id);
      if (!file) {
        throw new Error(`MODULE_TEST_FILE_NOT_FOUND: ${id}`);
      }
      const next = {
        ...file,
        status: 'ready' as const,
        visibility: 'private' as const,
        updatedAt: now(),
        publishedAt: undefined,
      };
      files.set(id, next);
      return { ...next };
    },
    async archive(id) {
      const file = files.get(id);
      if (!file) {
        throw new Error(`MODULE_TEST_FILE_NOT_FOUND: ${id}`);
      }
      const next = { ...file, status: 'archived' as const, updatedAt: now() };
      files.set(id, next);
      return { ...next };
    },
    async delete(id) {
      const file = files.get(id);
      if (file) {
        files.set(id, { ...file, status: 'deleted', updatedAt: now(), deletedAt: now() });
      }
    },
  };
  return api;
}

function createTestingArtifactsApi(moduleId: string): ModuleArtifactsApi {
  let nextId = 1;
  const artifacts = new Map<string, ModuleArtifactRecord>();
  const now = () => new Date().toISOString();

  const api: ModuleArtifactsApi = {
    async write<TContent = unknown>(input: ModuleArtifactWriteInput<TContent>) {
      const id = `test_artifact_${nextId++}`;
      const timestamp = now();
      const artifact: ModuleArtifactRecord<TContent> = {
        id,
        moduleId,
        name: input.name,
        kind: input.kind,
        path: input.path ?? input.name,
        content: input.content,
        runId: input.runId,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      artifacts.set(id, artifact as ModuleArtifactRecord);
      return { ...artifact };
    },
    async writeText(input) {
      return api.write<string>({ ...input, kind: 'text' });
    },
    async read<TContent = unknown>(id: string) {
      const artifact = artifacts.get(id);
      return artifact ? ({ ...artifact } as ModuleArtifactRecord<TContent>) : null;
    },
    async readText(id) {
      const artifact = await api.read<string>(id);
      return typeof artifact?.content === 'string' ? artifact.content : null;
    },
    async updateMetadata(id, metadata) {
      const artifact = artifacts.get(id);
      if (!artifact) {
        throw new Error(`MODULE_TEST_ARTIFACT_NOT_FOUND: ${id}`);
      }
      const next = {
        ...artifact,
        metadata: { ...artifact.metadata, ...metadata },
        updatedAt: now(),
      };
      artifacts.set(id, next);
      return { ...next };
    },
    async list(query = {}) {
      return [...artifacts.values()]
        .filter((artifact) => !query.kind || artifact.kind === query.kind)
        .filter((artifact) => !query.runId || artifact.runId === query.runId)
        .filter((artifact) => !query.pathPrefix || artifact.path.startsWith(query.pathPrefix))
        .map((artifact) => ({ ...artifact }));
    },
    async tree() {
      return [...artifacts.values()].map((artifact) => ({
        name: artifact.name,
        path: artifact.path,
        type: 'artifact' as const,
        artifactId: artifact.id,
      }));
    },
    async delete(id) {
      artifacts.delete(id);
    },
  };
  return api;
}

function createTestingNotificationsApi(moduleId: string): ModuleNotificationsApi {
  let nextId = 1;
  const notifications = new Map<string, ModuleNotificationRecord>();
  const now = () => new Date().toISOString();

  return {
    async send(input) {
      const id = `test_notification_${nextId++}`;
      const notification: ModuleNotificationRecord = {
        id,
        moduleId,
        userId: input.userId,
        channel: input.channel ?? 'inApp',
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        runId: input.runId,
        status: 'unread',
        metadata: input.metadata ?? {},
        createdAt: now(),
      };
      notifications.set(id, notification);
      return { ...notification };
    },
    async list(query = {}) {
      return [...notifications.values()]
        .filter((notification) => !query.userId || notification.userId === query.userId)
        .filter((notification) => !query.status || notification.status === query.status)
        .filter((notification) => !query.channel || notification.channel === query.channel)
        .filter((notification) => !query.runId || notification.runId === query.runId)
        .map((notification) => ({ ...notification }));
    },
    async markRead(id) {
      const notification = notifications.get(id);
      if (!notification) {
        throw new Error(`MODULE_TEST_NOTIFICATION_NOT_FOUND: ${id}`);
      }
      const next = { ...notification, status: 'read' as const, readAt: now() };
      notifications.set(id, next);
      return { ...next };
    },
  };
}

function createTestingRunsApi(moduleId: string): ModuleRunsApi {
  let nextId = 1;
  const runs = new Map<string, ModuleRunRecord>();
  const now = () => new Date().toISOString();
  const clone = <TInput = unknown, TResult = unknown>(
    run: ModuleRunRecord
  ): ModuleRunRecord<TInput, TResult> =>
    ({
      ...run,
      logs: run.logs.map((log) => ({
        ...log,
        metadata: log.metadata ? { ...log.metadata } : undefined,
      })),
    }) as ModuleRunRecord<TInput, TResult>;

  const createRun: ModuleRunsApi['create'] = async (input) => {
    const timestamp = now();
    const run: ModuleRunRecord = {
      id: `test_run_${nextId++}`,
      moduleId,
      kind: input.kind,
      name: input.name,
      status: 'queued',
      progress: 0,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 1,
      input: input.input,
      costRef: input.costRef,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      logs: [],
    };
    runs.set(run.id, run);
    return clone(run);
  };
  const getRun: ModuleRunsApi['get'] = async (id) => {
    const run = runs.get(id);
    return run ? clone(run) : null;
  };

  return {
    create: createRun,
    get: getRun,
    async list(query = {}) {
      return [...runs.values()]
        .filter((run) => run.moduleId === moduleId)
        .filter((run) => !query.kind || run.kind === query.kind)
        .filter((run) => !query.name || run.name === query.name)
        .filter((run) => !query.status || run.status === query.status)
        .filter((run) => !query.idempotencyKey || run.idempotencyKey === query.idempotencyKey)
        .map((run) => clone(run));
    },
    async updateProgress(id, progress) {
      const run = runs.get(id);
      if (!run) {
        throw new Error(`MODULE_TEST_RUN_NOT_FOUND: ${id}`);
      }
      const next = { ...run, progress, updatedAt: now() };
      runs.set(id, next);
      return clone(next);
    },
    async appendLog(id, level, message, metadata) {
      const run = runs.get(id);
      if (!run) {
        throw new Error(`MODULE_TEST_RUN_NOT_FOUND: ${id}`);
      }
      const next = {
        ...run,
        logs: [...run.logs, { at: now(), level, message, metadata }],
        updatedAt: now(),
      };
      runs.set(id, next);
      return clone(next);
    },
    async succeed(id, result) {
      const run = runs.get(id);
      if (!run) {
        throw new Error(`MODULE_TEST_RUN_NOT_FOUND: ${id}`);
      }
      const next = {
        ...run,
        status: 'succeeded' as const,
        progress: 100,
        result,
        completedAt: now(),
        updatedAt: now(),
      };
      runs.set(id, next);
      return clone(next);
    },
    async fail(id, error) {
      const run = runs.get(id);
      if (!run) {
        throw new Error(`MODULE_TEST_RUN_NOT_FOUND: ${id}`);
      }
      const next = {
        ...run,
        status: 'failed' as const,
        error:
          typeof error === 'string'
            ? { code: 'MODULE_TEST_RUN_FAILED', message: error }
            : error instanceof Error
              ? { code: error.name, message: error.message, stack: error.stack }
              : error,
        completedAt: now(),
        updatedAt: now(),
      };
      runs.set(id, next);
      return clone(next);
    },
    async requestCancel(id) {
      const run = runs.get(id);
      if (!run) {
        throw new Error(`MODULE_TEST_RUN_NOT_FOUND: ${id}`);
      }
      const next = { ...run, status: 'cancel_requested' as const, cancelRequestedAt: now() };
      runs.set(id, next);
      return clone(next);
    },
    async cancel(id, reason = 'Canceled') {
      const run = runs.get(id);
      if (!run) {
        throw new Error(`MODULE_TEST_RUN_NOT_FOUND: ${id}`);
      }
      const next = {
        ...run,
        status: 'canceled' as const,
        error: { code: 'MODULE_TEST_RUN_CANCELED', message: reason },
        canceledAt: now(),
        completedAt: now(),
        updatedAt: now(),
      };
      runs.set(id, next);
      return clone(next);
    },
  };
}

function createTestingJobsApi(): ModuleJobsApi {
  return {
    async list() {
      return [];
    },
    async run() {
      throw new Error('MODULE_TEST_JOB_RUNNER_UNAVAILABLE');
    },
  };
}

function createTestingEventsApi(): ModuleEventsApi {
  let nextId = 1;
  return {
    async publish(name, payload, options = {}) {
      const timestamp = new Date().toISOString();
      return {
        id: `test_event_${nextId++}`,
        name,
        payload,
        metadata: options,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
  };
}

function createTestingWebhooksApi(): ModuleWebhooksApi {
  return {
    async list() {
      return [];
    },
    async getReceipt() {
      return null;
    },
  };
}

function createTestingApiKeysApi(): ModuleApiKeysApi {
  return {
    async create(input) {
      return {
        id: 'test_api_key_1',
        key: 'pk_test_key',
        prefix: 'pk_test',
        owner: input.owner,
        expiresAt: input.expiresAt,
      };
    },
    async rotate(input) {
      return { id: input.id, key: 'pk_test_rotated', prefix: 'pk_test' };
    },
    async revoke(input) {
      return { id: input.id, revoked: true };
    },
    async list() {
      return [];
    },
    async verify() {
      return { ok: false };
    },
    async require() {
      throw new Error('MODULE_TEST_API_KEY_INVALID');
    },
  };
}

function createTestingRateLimitApi(): ModuleRateLimitApi {
  return {
    async check(input) {
      return {
        ok: true,
        remaining: input.limit,
        resetAt: new Date(Date.now() + input.windowMs).toISOString(),
      };
    },
  };
}

function createTestingRiskApi(): ModuleRiskApi {
  return {
    async record(input) {
      return {
        id: 'test_risk_event_1',
        subject: input.subject,
        type: input.type,
        severity: input.severity ?? 'low',
        status: input.status ?? 'open',
        source: input.source,
        sourceId: input.sourceId,
        metadata: input.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
    },
    async block() {
      return { blocked: true };
    },
    async check() {
      return { ok: true };
    },
  };
}

function createTestingCacheApi(): ModuleCacheApi {
  const values = new Map<string, { value: unknown; expiresAt?: number }>();
  const api: ModuleCacheApi = {
    async get<T = unknown>(key: string) {
      const entry = values.get(key);
      if (!entry) {
        return null;
      }
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        values.delete(key);
        return null;
      }
      return entry.value as T;
    },
    async set(key, value, options = {}) {
      values.set(key, {
        value,
        expiresAt: options.ttlSeconds ? Date.now() + options.ttlSeconds * 1000 : undefined,
      });
    },
    async delete(key) {
      values.delete(key);
    },
    async remember(key, factory, options) {
      const existing = await api.get(key);
      if (existing !== null) {
        return existing as Awaited<ReturnType<typeof factory>>;
      }
      const value = await factory();
      await api.set(key, value, options);
      return value;
    },
  };
  return api;
}

export function createTestingModuleContext(
  options: CreateTestingModuleContextOptions = {}
): ModuleContext {
  const response = createResponseFactory();
  const moduleId = options.moduleId ?? 'test';
  const user = options.user ?? { id: 'test-user', role: 'user' };
  const request: ModuleRequest = {
    id: 'test-request',
    correlationId: 'test-request',
    method: 'GET',
    url: 'http://localhost/modules/test',
    path: '/modules/test',
    headers: new Headers(),
    params: {},
    query: new URLSearchParams(),
    async json<T = unknown>() {
      return {} as T;
    },
    async text() {
      return '';
    },
    async formData() {
      return new FormData();
    },
    ...options.request,
  };
  const scope = createTestingScope(user);

  return {
    module: {
      id: moduleId,
      version: options.moduleVersion ?? '0.1.0',
    },
    product: {
      id: scope.productId,
      profile: scope.profile,
    },
    user,
    auth: {
      actorId: scope.actorId,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'admin',
    },
    scope,
    workspace: {
      id: scope.workspaceId,
      role: scope.workspaceRole,
    },
    request,
    response,
    data: createTestingDataApi(moduleId),
    config: createTestingConfigApi(),
    secrets: createTestingSecretsApi(),
    services: options.services ?? createTestingServicesApi(options.serviceHandlers),
    connectors: createTestingConnectorsApi(),
    resourceBindings: createTestingResourceBindingsApi(),
    http: createTestingHttpApi(),
    files: createTestingFilesApi(moduleId),
    artifacts: createTestingArtifactsApi(moduleId),
    notifications: createTestingNotificationsApi(moduleId),
    runs: createTestingRunsApi(moduleId),
    jobs: createTestingJobsApi(),
    events: createTestingEventsApi(),
    webhooks: createTestingWebhooksApi(),
    usage: createTestingUsageApi(moduleId),
    metering: createTestingMeteringApi(moduleId),
    credits: createTestingCreditsApi(),
    billing: createTestingBillingApi(),
    entitlements: createTestingEntitlementsApi(),
    commerce: createTestingCommerceApi(),
    redeemCodes: createTestingRedeemCodesApi(),
    ai: createTestingAiApi(),
    rag: createTestingRagApi(),
    apiKeys: createTestingApiKeysApi(),
    rateLimit: createTestingRateLimitApi(),
    risk: createTestingRiskApi(),
    cache: createTestingCacheApi(),
    audit: createTestingAuditApi(),
    extensions: {},
    json: response.json,
  };
}
