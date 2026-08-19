import type {
  ModuleDataApi,
  ModuleDataDocument,
  ModuleDataTable,
  ModuleAiApi,
  ModuleAuthContext,
  ModuleAuditApi,
  ModuleCommercialApi,
  ModuleContext,
  ModuleEventsApi,
  ModuleFilesApi,
  ModuleJobsApi,
  ModuleNotificationsApi,
  ModuleProductContext,
  ModuleRagApi,
  ModuleRequest,
  ModuleResponseFactory,
  ModuleRunsApi,
  ModuleScopeContext,
  ModuleServicesApi,
  ModuleUser,
  ModuleWebhooksApi,
  ModuleWorkspaceContext,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import { moduleDataPhysicalTableName, moduleDataPhysicalViewName } from '../data';
import { resolveModuleRuntimeScope } from '../scope';
import { guardModuleContextCapabilities, type ModuleRuntimeAccessSession } from '../security';

export interface CreateModuleContextOptions {
  contract: ModuleRuntimeContract;
  request: Request;
  user: ModuleUser | null;
  product?: ModuleProductContext;
  auth?: ModuleAuthContext;
  workspace?: ModuleWorkspaceContext;
  params?: Record<string, string>;
  data?: ModuleDataApi;
  session?: ModuleRuntimeAccessSession;
  scope?: ModuleScopeContext;
  services?: ModuleServicesApi;
  files?: ModuleFilesApi;
  notifications?: ModuleNotificationsApi;
  runs?: ModuleRunsApi;
  jobs?: ModuleJobsApi;
  events?: ModuleEventsApi;
  webhooks?: ModuleWebhooksApi;
  ai?: ModuleAiApi;
  rag?: ModuleRagApi;
  audit?: ModuleAuditApi;
  commercial?: ModuleCommercialApi;
}

function createResponseFactory(): ModuleResponseFactory {
  return {
    json(data, init) {
      const body = JSON.stringify(data);
      if (body === undefined) {
        return Response.json(data, init);
      }
      const headers = new Headers(init?.headers);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      headers.set('content-length', String(new TextEncoder().encode(body).byteLength));
      return new Response(body, { ...init, headers });
    },
    redirect(url, status = 302) {
      return Response.redirect(url, status);
    },
    stream(body, init) {
      return new Response(body, init);
    },
  };
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}`;
}

function createModuleRequest(
  request: Request,
  params: Record<string, string> = {},
  requestId?: string
): ModuleRequest {
  const url = new URL(request.url);
  const id = requestId ?? request.headers.get('x-request-id') ?? createRequestId();
  const correlationId = request.headers.get('x-correlation-id') ?? id;
  return {
    id,
    correlationId,
    method: request.method,
    url: request.url,
    path: url.pathname,
    headers: request.headers,
    params,
    query: url.searchParams,
    async json<T = unknown>() {
      return (await request.json()) as T;
    },
    text() {
      return request.text();
    },
    formData() {
      return request.formData();
    },
  };
}

function createProductContext(scope: ModuleScopeContext): ModuleProductContext {
  return {
    id: scope.productId,
    profile: scope.profile,
  };
}

function createAuthContext(user: ModuleUser | null, scope: ModuleScopeContext): ModuleAuthContext {
  return {
    actorId: scope.actorId ?? user?.id ?? null,
    isAuthenticated: Boolean(user),
    isAdmin: user?.role === 'admin',
  };
}

function createWorkspaceContext(scope: ModuleScopeContext): ModuleWorkspaceContext {
  return {
    id: scope.workspaceId,
    role: scope.workspaceRole,
  };
}

function createUnavailableDataApi(moduleId: string): ModuleDataApi {
  const unavailable = (name: string): never => {
    throw new Error(
      `MODULE_DATA_RUNTIME_UNAVAILABLE: ctx.data.${name} is not mounted for module "${moduleId}".`
    );
  };

  const document = <TRecord = Record<string, unknown>>(_name: string) =>
    new Proxy(
      {},
      {
        get(_target, property) {
          return () => unavailable(`document.${String(property)}`);
        },
      }
    ) as unknown as ModuleDataDocument<TRecord>;

  const table = <TRecord = Record<string, unknown>>(_name: string) =>
    new Proxy(
      {},
      {
        get(_target, property) {
          return () => unavailable(`table.${String(property)}`);
        },
      }
    ) as unknown as ModuleDataTable<TRecord>;

  return {
    document,
    table,
    async transaction<T>(_callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
      return unavailable('transaction');
    },
    tableRef(name) {
      return { text: `"${moduleDataPhysicalTableName(moduleId, name)}"`, values: [] };
    },
    viewRef(name) {
      return { text: `"${moduleDataPhysicalViewName(moduleId, name)}"`, values: [] };
    },
    sql: {
      async query<T = unknown>(): Promise<T[]> {
        return unavailable('sql.query');
      },
      async execute() {
        return unavailable('sql.execute');
      },
    },
  };
}

function unavailableCapability(name: string): never {
  throw new Error(`MODULE_CAPABILITY_UNAVAILABLE: ctx.${name} is not mounted.`);
}

function createUnavailableServicesApi(): ModuleServicesApi {
  return {
    async invoke() {
      return unavailableCapability('services.invoke');
    },
  };
}

function createUnavailableFilesApi(): ModuleFilesApi {
  return {
    async createUpload() {
      return unavailableCapability('files.createUpload');
    },
    async createSignedUploadUrl() {
      return unavailableCapability('files.createSignedUploadUrl');
    },
    async completeUpload() {
      return unavailableCapability('files.completeUpload');
    },
    async read() {
      return unavailableCapability('files.read');
    },
    async get() {
      return unavailableCapability('files.get');
    },
    async list() {
      return unavailableCapability('files.list');
    },
    async createSignedUrl() {
      return unavailableCapability('files.createSignedUrl');
    },
    async createSignedDownloadUrl() {
      return unavailableCapability('files.createSignedDownloadUrl');
    },
    async publish() {
      return unavailableCapability('files.publish');
    },
    async unpublish() {
      return unavailableCapability('files.unpublish');
    },
    async archive() {
      return unavailableCapability('files.archive');
    },
    async delete() {
      return unavailableCapability('files.delete');
    },
  };
}

function createUnavailableNotificationsApi(): ModuleNotificationsApi {
  return {
    async send() {
      return unavailableCapability('notifications.send');
    },
    async list() {
      return unavailableCapability('notifications.list');
    },
    async markRead() {
      return unavailableCapability('notifications.markRead');
    },
  };
}

function createUnavailableAiApi(): ModuleAiApi {
  return {
    async generateText() {
      return unavailableCapability('ai.generateText');
    },
    async *streamText() {
      unavailableCapability('ai.streamText');
    },
    async embedText() {
      return unavailableCapability('ai.embedText');
    },
  };
}

function createUnavailableRagApi(): ModuleRagApi {
  return {
    async index() {
      return unavailableCapability('rag.index');
    },
    async search() {
      return unavailableCapability('rag.search');
    },
    async contextPack() {
      return unavailableCapability('rag.contextPack');
    },
    async buildContextPack() {
      return unavailableCapability('rag.buildContextPack');
    },
    async delete() {
      return unavailableCapability('rag.delete');
    },
  };
}

function createUnavailableRunsApi(): ModuleRunsApi {
  return {
    async create() {
      return unavailableCapability('runs.create');
    },
    async get() {
      return unavailableCapability('runs.get');
    },
    async list() {
      return unavailableCapability('runs.list');
    },
    async updateProgress() {
      return unavailableCapability('runs.updateProgress');
    },
    async appendLog() {
      return unavailableCapability('runs.appendLog');
    },
    async succeed() {
      return unavailableCapability('runs.succeed');
    },
    async fail() {
      return unavailableCapability('runs.fail');
    },
    async requestCancel() {
      return unavailableCapability('runs.requestCancel');
    },
    async cancel() {
      return unavailableCapability('runs.cancel');
    },
  };
}

function createUnavailableJobsApi(): ModuleJobsApi {
  return {
    async list() {
      return unavailableCapability('jobs.list');
    },
    async run() {
      return unavailableCapability('jobs.run');
    },
  };
}

function createUnavailableEventsApi(): ModuleEventsApi {
  return {
    async publish() {
      return unavailableCapability('events.publish');
    },
  };
}

function createUnavailableWebhooksApi(): ModuleWebhooksApi {
  return {
    async list() {
      return unavailableCapability('webhooks.list');
    },
    async getReceipt() {
      return unavailableCapability('webhooks.getReceipt');
    },
  };
}

function createUnavailableAuditApi(): ModuleAuditApi {
  return {
    async record() {
      return unavailableCapability('audit.record');
    },
  };
}

function createUnavailableCommercialApi(): ModuleContext['commercial'] {
  return {
    async read() {
      throw new Error('MODULE_CAPABILITY_UNAVAILABLE: commercial.read is not mounted.');
    },
    async charge() {
      throw new Error('MODULE_CAPABILITY_UNAVAILABLE: commercial.charge is not mounted.');
    },
    async checkout() {
      throw new Error('MODULE_CAPABILITY_UNAVAILABLE: commercial.checkout is not mounted.');
    },
  };
}

export function createModuleRuntimeContext(options: CreateModuleContextOptions): ModuleContext {
  const response = createResponseFactory();
  const session = options.session ?? { user: options.user, permissions: [] };
  const scope =
    options.scope ??
    resolveModuleRuntimeScope({
      session,
      definition: options.contract.definition.scope,
    });

  const requestId =
    typeof (session as { requestId?: unknown }).requestId === 'string'
      ? (session as { requestId: string }).requestId
      : undefined;

  const context: ModuleContext = {
    module: {
      id: options.contract.id,
      version: options.contract.version,
    },
    product: options.product ?? createProductContext(scope),
    user: options.user,
    auth: options.auth ?? createAuthContext(options.user, scope),
    scope,
    workspace: options.workspace ?? createWorkspaceContext(scope),
    request: createModuleRequest(options.request, options.params, requestId),
    response,
    data: options.data ?? createUnavailableDataApi(options.contract.id),
    services: options.services ?? createUnavailableServicesApi(),
    files: options.files ?? createUnavailableFilesApi(),
    notifications: options.notifications ?? createUnavailableNotificationsApi(),
    runs: options.runs ?? createUnavailableRunsApi(),
    jobs: options.jobs ?? createUnavailableJobsApi(),
    events: options.events ?? createUnavailableEventsApi(),
    webhooks: options.webhooks ?? createUnavailableWebhooksApi(),
    ai: options.ai ?? createUnavailableAiApi(),
    rag: options.rag ?? createUnavailableRagApi(),
    audit: options.audit ?? createUnavailableAuditApi(),
    commercial: options.commercial ?? createUnavailableCommercialApi(),
    json: response.json,
  };

  return guardModuleContextCapabilities({
    context,
    contract: options.contract,
    session,
  });
}
