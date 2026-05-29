import type {
  ModuleDataApi,
  ModuleDataDocument,
  ModuleDataQuery,
  ModuleDataSqlFragment,
  ModuleDataTable,
  ModuleDataWriteOptions,
} from './data';
import type {
  ModuleArtifactRecord,
  ModuleArtifactWriteInput,
  ModuleArtifactsApi,
  ModuleAiApi,
  ModuleApiKeysApi,
  ModuleAuditApi,
  ModuleCacheApi,
  ModuleBillingApi,
  ModuleCommerceApi,
  ModuleConfigApi,
  ModuleConnectorsApi,
  ModuleContext,
  ModuleEventsApi,
  ModuleEntitlementsApi,
  ModuleCreditsApi,
  ModuleFileRecord,
  ModuleFilesApi,
  ModuleHttpApi,
  ModuleJobsApi,
  ModuleMeteringApi,
  ModuleNotificationRecord,
  ModuleNotificationsApi,
  ModuleRagApi,
  ModuleRedeemCodesApi,
  ModuleRateLimitApi,
  ModuleRequest,
  ModuleResourceBindingsApi,
  ModuleResponseFactory,
  ModuleRiskApi,
  ModuleRunRecord,
  ModuleRunsApi,
  ModuleScopeContext,
  ModuleSecretsApi,
  ModuleServicesApi,
  ModuleUsageApi,
  ModuleUser,
  ModuleWebhooksApi,
  CommercialSubject,
} from './context';

export interface CreateTestingModuleContextOptions {
  moduleId?: string;
  moduleVersion?: string;
  user?: ModuleUser | null;
  request?: Partial<ModuleRequest>;
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

type TestingDataRecord = Record<string, unknown> & { id?: string };

function readComparable(value: unknown): string {
  return value instanceof Date ? value.toISOString() : JSON.stringify(value);
}

function matchesWhere(record: TestingDataRecord, where?: Record<string, unknown>): boolean {
  if (!where) {
    return true;
  }

  return Object.entries(where).every(([key, value]) => record[key] === value);
}

class TestingDataCollection<TRecord extends TestingDataRecord>
  implements ModuleDataDocument<TRecord>, ModuleDataTable<TRecord>
{
  private nextId = 1;
  private readonly records = new Map<string, TRecord>();

  async findMany(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord[]> {
    let rows = [...this.records.values()].filter((record) =>
      matchesWhere(record, query.where as Record<string, unknown> | undefined)
    );

    for (const [field, direction] of Object.entries(query.orderBy ?? {}).reverse()) {
      rows = rows.sort((left, right) => {
        const leftValue = readComparable(left[field]);
        const rightValue = readComparable(right[field]);
        return direction === 'desc'
          ? rightValue.localeCompare(leftValue)
          : leftValue.localeCompare(rightValue);
      });
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map((record) => ({ ...record }));
  }

  async findOne(query?: ModuleDataQuery<TRecord>): Promise<TRecord | null> {
    return (await this.findMany({ ...query, limit: 1 }))[0] ?? null;
  }

  async findById(id: string): Promise<TRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async insert(input: Partial<TRecord>): Promise<TRecord> {
    const id = String(input.id ?? `test_${this.nextId++}`);
    const record = { ...input, id } as TRecord;
    this.records.set(id, record);
    return { ...record };
  }

  async insertMany(input: readonly Partial<TRecord>[]): Promise<TRecord[]> {
    const records: TRecord[] = [];
    for (const item of input) {
      records.push(await this.insert(item));
    }
    return records;
  }

  async insertIfAbsent(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const existing = await this.findByUnique(input, options);
    return existing ?? this.insert(input);
  }

  async upsert(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const existing = await this.findByUnique(input, options);
    if (!existing?.id) {
      return this.insert(input);
    }
    return this.update(existing.id, input);
  }

  async update(id: string, input: Partial<TRecord>): Promise<TRecord> {
    const existing = this.records.get(id);
    if (!existing) {
      throw new Error(`MODULE_TEST_DATA_NOT_FOUND: ${id}`);
    }
    const next = { ...existing, ...input, id } as TRecord;
    this.records.set(id, next);
    return { ...next };
  }

  async updateWhere(query: ModuleDataQuery<TRecord>, input: Partial<TRecord>): Promise<number> {
    const rows = await this.findMany(query);
    for (const row of rows) {
      if (row.id) {
        await this.update(row.id, input);
      }
    }
    return rows.length;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async claim(query: ModuleDataQuery<TRecord>, patch: Partial<TRecord>): Promise<TRecord | null> {
    const record = await this.findOne({ ...query, lock: 'update' });
    return record?.id ? this.update(record.id, patch) : null;
  }

  async count(query?: ModuleDataQuery<TRecord>): Promise<number> {
    return (await this.findMany(query)).length;
  }

  async exists(query?: ModuleDataQuery<TRecord>): Promise<boolean> {
    return (await this.count(query)) > 0;
  }

  async softDelete(id: string): Promise<TRecord> {
    return this.update(id, { deleted_at: new Date().toISOString() } as unknown as Partial<TRecord>);
  }

  async restore(id: string): Promise<TRecord> {
    return this.update(id, { deleted_at: null } as unknown as Partial<TRecord>);
  }

  private async findByUnique(
    input: Partial<TRecord>,
    options: ModuleDataWriteOptions
  ): Promise<TRecord | null> {
    if (!options.uniqueBy || options.uniqueBy.length === 0) {
      throw new Error('MODULE_TEST_DATA_UNIQUE_BY_REQUIRED');
    }

    const where = Object.fromEntries(
      options.uniqueBy.map((field) => [field, input[field as keyof TRecord]])
    );
    return this.findOne({ where } as ModuleDataQuery<TRecord>);
  }
}

function moduleDataPhysicalTableName(moduleId: string, tableName: string): string {
  return `mod_${moduleId.replace(/-/g, '_')}__${tableName}`;
}

function createTestingDataApi(moduleId: string): ModuleDataApi {
  const documents = new Map<string, TestingDataCollection<TestingDataRecord>>();
  const tables = new Map<string, TestingDataCollection<TestingDataRecord>>();
  const getCollection = (
    store: Map<string, TestingDataCollection<TestingDataRecord>>,
    name: string
  ) => {
    let collection = store.get(name);
    if (!collection) {
      collection = new TestingDataCollection();
      store.set(name, collection);
    }
    return collection;
  };
  const tableRef = (name: string): ModuleDataSqlFragment => ({
    text: `"${moduleDataPhysicalTableName(moduleId, name)}"`,
    values: [],
  });
  const viewRef = (name: string): ModuleDataSqlFragment => ({
    text: `"${moduleDataPhysicalTableName(moduleId, name)}_view"`,
    values: [],
  });

  return {
    document<TRecord = Record<string, unknown>>(name: string) {
      return getCollection(documents, name) as unknown as ModuleDataDocument<TRecord>;
    },
    table<TRecord = Record<string, unknown>>(name: string) {
      return getCollection(tables, name) as unknown as ModuleDataTable<TRecord>;
    },
    async transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
      return callback(this);
    },
    tableRef,
    viewRef,
    sql: {
      async query<T = unknown>(): Promise<T[]> {
        return [];
      },
      async execute(): Promise<{ rowCount: number }> {
        return { rowCount: 0 };
      },
    },
  };
}

function createTestingScope(user: ModuleUser | null): ModuleScopeContext {
  return {
    profile: 'hidden-default',
    resource: 'workspace',
    productId: 'test-product',
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

function createTestingServicesApi(): ModuleServicesApi {
  return {
    async invoke() {
      throw new Error('MODULE_TEST_SERVICE_UNAVAILABLE');
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

function createTestingMeteringApi(moduleId: string): ModuleMeteringApi {
  let nextId = 1;
  const authorization = (
    id: string,
    status: 'authorized' | 'committed' | 'refunded' | 'voided'
  ) => {
    const timestamp = new Date().toISOString();
    return {
      id,
      moduleId,
      meter: 'test',
      quantity: 1,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  return {
    async authorize(input) {
      const timestamp = new Date().toISOString();
      return {
        id: `test_meter_${nextId++}`,
        moduleId,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        status: 'authorized',
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async commit(id) {
      return authorization(id, 'committed');
    },
    async refund(id) {
      return authorization(id, 'refunded');
    },
    async void(id) {
      return authorization(id, 'voided');
    },
    async reconcile() {
      return { checked: 0 };
    },
    async charge(input) {
      const timestamp = new Date().toISOString();
      const id = `test_charge_${nextId++}`;
      return {
        id,
        moduleId,
        subject: input.subject,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        credits: input.credits
          ? { amount: input.credits.amount, unit: input.credits.unit ?? 'credit' }
          : undefined,
        usageId: `${id}_usage`,
        meteringId: `${id}_metering`,
        balance: input.credits
          ? {
              subject: input.subject,
              userId: input.subject.type === 'user' ? input.subject.id : undefined,
              unit: input.credits.unit ?? 'credit',
              balance: 0,
            }
          : undefined,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
      };
    },
  };
}

function subjectFromInput(input: { subject?: CommercialSubject; userId?: string }): CommercialSubject {
  if (input.subject) {
    return input.subject;
  }
  return { type: 'user', id: input.userId ?? 'test-user' };
}

function createTestingCreditsApi(): ModuleCreditsApi {
  return {
    async balance(input: string | { subject: CommercialSubject; unit?: string }, unit = 'credit') {
      if (typeof input === 'string') {
        return { subject: { type: 'user', id: input }, userId: input, unit, balance: 0 };
      }
      return { subject: input.subject, unit: input.unit ?? unit, balance: 0 };
    },
    async grant(input) {
      const subject = subjectFromInput(input);
      return { subject, userId: subject.type === 'user' ? subject.id : undefined, unit: input.unit ?? 'credit', balance: input.amount };
    },
    async consume(input) {
      const subject = subjectFromInput(input);
      return { subject, userId: subject.type === 'user' ? subject.id : undefined, unit: input.unit ?? 'credit', balance: -input.amount };
    },
    async adjust(input) {
      const subject = subjectFromInput(input);
      return { subject, userId: subject.type === 'user' ? subject.id : undefined, unit: input.unit ?? 'credit', balance: input.amount };
    },
    async refund(input) {
      const subject = subjectFromInput(input);
      return { subject, userId: subject.type === 'user' ? subject.id : undefined, unit: input.unit ?? 'credit', balance: input.amount };
    },
    async reserve(input) {
      const subject = subjectFromInput(input);
      const timestamp = new Date().toISOString();
      return {
        id: 'test_reservation_1',
        subject,
        amountReserved: input.amount,
        amountCommitted: 0,
        unit: input.unit ?? 'credit',
        status: 'reserved',
        source: input.source,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async commitReservation() {
      return { subject: { type: 'user', id: 'test-user' }, userId: 'test-user', unit: 'credit', balance: 0 };
    },
    async releaseReservation() {
      return { subject: { type: 'user', id: 'test-user' }, userId: 'test-user', unit: 'credit', balance: 0 };
    },
    async revokeBySource() {
      return { revoked: 0 };
    },
    async listLedger() {
      return [];
    },
  };
}

function createTestingBillingApi(): ModuleBillingApi {
  return {
    async getPlan() {
      return null;
    },
    async getCurrentPlan() {
      return null;
    },
    async hasEntitlement() {
      return false;
    },
    async redeemCode() {
      return { ok: false };
    },
  };
}

function createTestingEntitlementsApi(): ModuleEntitlementsApi {
  return {
    async has() {
      return false;
    },
    async list() {
      return [];
    },
    async grant(input) {
      const subject = subjectFromInput(input);
      const timestamp = new Date().toISOString();
      return {
        id: 'test_entitlement_1',
        subject,
        userId: subject.type === 'user' ? subject.id : undefined,
        entitlement: input.entitlement,
        planId: input.planId,
        source: input.source,
        sourceId: input.sourceId,
        status: 'active',
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async revoke(input) {
      const timestamp = new Date().toISOString();
      return {
        id: input.id,
        subject: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        entitlement: 'test.entitlement',
        source: 'test',
        status: 'revoked',
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async override(input) {
      const timestamp = new Date().toISOString();
      return {
        id: input.id,
        subject: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        entitlement: 'test.entitlement',
        source: 'test',
        status: input.status,
        expiresAt: input.expiresAt ?? undefined,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async expire() {
      return { expired: 0 };
    },
  };
}

function createTestingCommerceApi(): ModuleCommerceApi {
  return {
    async createCheckout(input) {
      const beneficiary = input.beneficiary ?? (input.userId ? { type: 'user' as const, id: input.userId } : undefined);
      return {
        id: 'test_checkout_1',
        userId: input.userId,
        buyer: input.buyer,
        beneficiary,
        sku: input.sku,
        amount: input.amount,
        currency: input.currency,
        status: 'created',
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date().toISOString(),
      };
    },
    async getOrder() {
      return null;
    },
    async applyCheckoutPaid(input) {
      const order = await this.createCheckout(input);
      return { order: { ...order, status: 'paid' }, credits: [], entitlements: [] };
    },
    async applyRefund(input) {
      return {
        order: {
          id: input.orderId ?? 'test_checkout_1',
          sku: 'test',
          amount: input.amount ?? 0,
          currency: input.currency ?? 'usd',
          status: 'refunded',
          createdAt: new Date().toISOString(),
        },
        credits: [],
        revokedEntitlements: [],
      };
    },
    async recordSubscriptionEvent(input) {
      return {
        id: 'test_subscription_event_1',
        subject: input.subject ?? { type: 'user', id: input.userId ?? 'test-user' },
        planId: input.planId,
        type: input.type,
        status: input.status ?? 'active',
      };
    },
    async reconcilePaidOrderBenefits() {
      return { checked: 0, repaired: 0 };
    },
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

function createTestingRedeemCodesApi(): ModuleRedeemCodesApi {
  return {
    async createBatch(input) {
      const timestamp = new Date().toISOString();
      return {
        batchId: 'test_redeem_batch_1',
        codes: Array.from({ length: input.count }, (_, index) => ({
          id: `test_redeem_code_${index + 1}`,
          batchId: 'test_redeem_batch_1',
          code: `${input.prefix ?? 'TEST'}-${index + 1}`,
          prefix: input.prefix,
          maskedCode: `${input.prefix ?? 'TEST'}-****`,
          entitlement: input.entitlement,
          credits: input.credits,
          maxRedemptions: input.maxRedemptions,
          status: 'active',
          expiresAt: input.expiresAt,
          metadata: input.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      };
    },
    async redeem(input) {
      const subject = input.subject ?? { type: 'user', id: input.userId ?? 'test-user' };
      return {
        ok: true,
        redemption: {
          id: 'test_redemption_1',
          code: input.code,
          subject,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ?? {},
          createdAt: new Date().toISOString(),
        },
      };
    },
    async freeze() {
      return { frozen: 0 };
    },
    async revoke(input) {
      const timestamp = new Date().toISOString();
      return {
        id: input.codeId,
        maxRedemptions: 1,
        status: 'revoked',
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
    async list() {
      return [];
    },
    async listRedemptions() {
      return [];
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
    services: createTestingServicesApi(),
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
