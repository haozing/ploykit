import type {
  ModuleDataApi,
  ModuleDataDocument,
  ModuleDataTable,
  ModuleArtifactsApi,
  ModuleAiApi,
  ModuleApiKeysApi,
  ModuleAuthContext,
  ModuleAuditApi,
  ModuleConfigApi,
  ModuleConnectorsApi,
  ModuleContext,
  ModuleCacheApi,
  ModuleBillingApi,
  ModuleCommerceApi,
  ModuleCreditsApi,
  ModuleEntitlementsApi,
  ModuleEventsApi,
  ModuleFilesApi,
  ModuleHttpApi,
  ModuleJobsApi,
  ModuleMeteringApi,
  ModuleNotificationsApi,
  ModuleProductContext,
  ModuleRagApi,
  ModuleRedeemCodesApi,
  ModuleRateLimitApi,
  ModuleRequest,
  ModuleResourceBindingsApi,
  ModuleResponseFactory,
  ModuleRiskApi,
  ModuleRunsApi,
  ModuleScopeContext,
  ModuleSecretsApi,
  ModuleServicesApi,
  ModuleUsageApi,
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
  config?: ModuleConfigApi;
  secrets?: ModuleSecretsApi;
  services?: ModuleServicesApi;
  connectors?: ModuleConnectorsApi;
  resourceBindings?: ModuleResourceBindingsApi;
  http?: ModuleHttpApi;
  files?: ModuleFilesApi;
  artifacts?: ModuleArtifactsApi;
  notifications?: ModuleNotificationsApi;
  runs?: ModuleRunsApi;
  jobs?: ModuleJobsApi;
  events?: ModuleEventsApi;
  webhooks?: ModuleWebhooksApi;
  usage?: ModuleUsageApi;
  metering?: ModuleMeteringApi;
  credits?: ModuleCreditsApi;
  billing?: ModuleBillingApi;
  entitlements?: ModuleEntitlementsApi;
  commerce?: ModuleCommerceApi;
  redeemCodes?: ModuleRedeemCodesApi;
  ai?: ModuleAiApi;
  rag?: ModuleRagApi;
  apiKeys?: ModuleApiKeysApi;
  rateLimit?: ModuleRateLimitApi;
  risk?: ModuleRiskApi;
  cache?: ModuleCacheApi;
  audit?: ModuleAuditApi;
  extensions?: Readonly<Record<string, unknown>>;
}

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

function createUnavailableConfigApi(): ModuleConfigApi {
  return {
    async get() {
      return unavailableCapability('config.get');
    },
    async require() {
      return unavailableCapability('config.require');
    },
  };
}

function createUnavailableSecretsApi(): ModuleSecretsApi {
  return {
    async get() {
      return unavailableCapability('secrets.get');
    },
    async require() {
      return unavailableCapability('secrets.require');
    },
  };
}

function createUnavailableServicesApi(): ModuleServicesApi {
  return {
    async invoke() {
      return unavailableCapability('services.invoke');
    },
  };
}

function createUnavailableConnectorsApi(): ModuleConnectorsApi {
  return {
    async get() {
      return unavailableCapability('connectors.get');
    },
    async invoke() {
      return unavailableCapability('connectors.invoke');
    },
  };
}

function createUnavailableResourceBindingsApi(): ModuleResourceBindingsApi {
  return {
    async get() {
      return unavailableCapability('resourceBindings.get');
    },
    async list() {
      return unavailableCapability('resourceBindings.list');
    },
    async upsert() {
      return unavailableCapability('resourceBindings.upsert');
    },
  };
}

function createUnavailableHttpApi(): ModuleHttpApi {
  return {
    async fetch() {
      return unavailableCapability('http.fetch');
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

function createUnavailableArtifactsApi(): ModuleArtifactsApi {
  return {
    async write() {
      return unavailableCapability('artifacts.write');
    },
    async writeText() {
      return unavailableCapability('artifacts.writeText');
    },
    async read() {
      return unavailableCapability('artifacts.read');
    },
    async readText() {
      return unavailableCapability('artifacts.readText');
    },
    async updateMetadata() {
      return unavailableCapability('artifacts.updateMetadata');
    },
    async list() {
      return unavailableCapability('artifacts.list');
    },
    async tree() {
      return unavailableCapability('artifacts.tree');
    },
    async delete() {
      return unavailableCapability('artifacts.delete');
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

function createUnavailableUsageApi(): ModuleUsageApi {
  return {
    async record() {
      return unavailableCapability('usage.record');
    },
    async increment() {
      return unavailableCapability('usage.increment');
    },
  };
}

function createUnavailableMeteringApi(): ModuleMeteringApi {
  return {
    async authorize() {
      return unavailableCapability('metering.authorize');
    },
    async commit() {
      return unavailableCapability('metering.commit');
    },
    async refund() {
      return unavailableCapability('metering.refund');
    },
    async void() {
      return unavailableCapability('metering.void');
    },
    async reconcile() {
      return unavailableCapability('metering.reconcile');
    },
    async charge() {
      return unavailableCapability('metering.charge');
    },
  };
}

function createUnavailableCreditsApi(): ModuleCreditsApi {
  return {
    async balance() {
      return unavailableCapability('credits.balance');
    },
    async grant() {
      return unavailableCapability('credits.grant');
    },
    async consume() {
      return unavailableCapability('credits.consume');
    },
    async adjust() {
      return unavailableCapability('credits.adjust');
    },
    async refund() {
      return unavailableCapability('credits.refund');
    },
    async reserve() {
      return unavailableCapability('credits.reserve');
    },
    async commitReservation() {
      return unavailableCapability('credits.commitReservation');
    },
    async releaseReservation() {
      return unavailableCapability('credits.releaseReservation');
    },
    async revokeBySource() {
      return unavailableCapability('credits.revokeBySource');
    },
    async listLedger() {
      return unavailableCapability('credits.listLedger');
    },
  };
}

function createUnavailableBillingApi(): ModuleBillingApi {
  return {
    async getPlan() {
      return unavailableCapability('billing.getPlan');
    },
    async getCurrentPlan() {
      return unavailableCapability('billing.getCurrentPlan');
    },
    async hasEntitlement() {
      return unavailableCapability('billing.hasEntitlement');
    },
    async redeemCode() {
      return unavailableCapability('billing.redeemCode');
    },
  };
}

function createUnavailableEntitlementsApi(): ModuleEntitlementsApi {
  return {
    async has() {
      return unavailableCapability('entitlements.has');
    },
    async list() {
      return unavailableCapability('entitlements.list');
    },
    async grant() {
      return unavailableCapability('entitlements.grant');
    },
    async revoke() {
      return unavailableCapability('entitlements.revoke');
    },
    async override() {
      return unavailableCapability('entitlements.override');
    },
    async expire() {
      return unavailableCapability('entitlements.expire');
    },
  };
}

function createUnavailableCommerceApi(): ModuleCommerceApi {
  return {
    async createCheckout() {
      return unavailableCapability('commerce.createCheckout');
    },
    async getOrder() {
      return unavailableCapability('commerce.getOrder');
    },
    async applyCheckoutPaid() {
      return unavailableCapability('commerce.applyCheckoutPaid');
    },
    async applyRefund() {
      return unavailableCapability('commerce.applyRefund');
    },
    async recordSubscriptionEvent() {
      return unavailableCapability('commerce.recordSubscriptionEvent');
    },
    async reconcilePaidOrderBenefits() {
      return unavailableCapability('commerce.reconcilePaidOrderBenefits');
    },
  };
}

function createUnavailableRedeemCodesApi(): ModuleRedeemCodesApi {
  return {
    async createBatch() {
      return unavailableCapability('redeemCodes.createBatch');
    },
    async redeem() {
      return unavailableCapability('redeemCodes.redeem');
    },
    async freeze() {
      return unavailableCapability('redeemCodes.freeze');
    },
    async revoke() {
      return unavailableCapability('redeemCodes.revoke');
    },
    async list() {
      return unavailableCapability('redeemCodes.list');
    },
    async listRedemptions() {
      return unavailableCapability('redeemCodes.listRedemptions');
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

function createUnavailableApiKeysApi(): ModuleApiKeysApi {
  return {
    async create() {
      return unavailableCapability('apiKeys.create');
    },
    async rotate() {
      return unavailableCapability('apiKeys.rotate');
    },
    async revoke() {
      return unavailableCapability('apiKeys.revoke');
    },
    async list() {
      return unavailableCapability('apiKeys.list');
    },
    async verify() {
      return unavailableCapability('apiKeys.verify');
    },
    async require() {
      return unavailableCapability('apiKeys.require');
    },
  };
}

function createUnavailableRateLimitApi(): ModuleRateLimitApi {
  return {
    async check() {
      return unavailableCapability('rateLimit.check');
    },
  };
}

function createUnavailableRiskApi(): ModuleRiskApi {
  return {
    async record() {
      return unavailableCapability('risk.record');
    },
    async block() {
      return unavailableCapability('risk.block');
    },
    async check() {
      return unavailableCapability('risk.check');
    },
  };
}

function createUnavailableCacheApi(): ModuleCacheApi {
  return {
    async get() {
      return unavailableCapability('cache.get');
    },
    async set() {
      return unavailableCapability('cache.set');
    },
    async delete() {
      return unavailableCapability('cache.delete');
    },
    async remember() {
      return unavailableCapability('cache.remember');
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
    config: options.config ?? createUnavailableConfigApi(),
    secrets: options.secrets ?? createUnavailableSecretsApi(),
    services: options.services ?? createUnavailableServicesApi(),
    connectors: options.connectors ?? createUnavailableConnectorsApi(),
    resourceBindings: options.resourceBindings ?? createUnavailableResourceBindingsApi(),
    http: options.http ?? createUnavailableHttpApi(),
    files: options.files ?? createUnavailableFilesApi(),
    artifacts: options.artifacts ?? createUnavailableArtifactsApi(),
    notifications: options.notifications ?? createUnavailableNotificationsApi(),
    runs: options.runs ?? createUnavailableRunsApi(),
    jobs: options.jobs ?? createUnavailableJobsApi(),
    events: options.events ?? createUnavailableEventsApi(),
    webhooks: options.webhooks ?? createUnavailableWebhooksApi(),
    usage: options.usage ?? createUnavailableUsageApi(),
    metering: options.metering ?? createUnavailableMeteringApi(),
    credits: options.credits ?? createUnavailableCreditsApi(),
    billing: options.billing ?? createUnavailableBillingApi(),
    entitlements: options.entitlements ?? createUnavailableEntitlementsApi(),
    commerce: options.commerce ?? createUnavailableCommerceApi(),
    redeemCodes: options.redeemCodes ?? createUnavailableRedeemCodesApi(),
    ai: options.ai ?? createUnavailableAiApi(),
    rag: options.rag ?? createUnavailableRagApi(),
    apiKeys: options.apiKeys ?? createUnavailableApiKeysApi(),
    rateLimit: options.rateLimit ?? createUnavailableRateLimitApi(),
    risk: options.risk ?? createUnavailableRiskApi(),
    cache: options.cache ?? createUnavailableCacheApi(),
    audit: options.audit ?? createUnavailableAuditApi(),
    extensions: options.extensions ?? {},
    json: response.json,
  };

  return guardModuleContextCapabilities({
    context,
    contract: options.contract,
    session,
  });
}
