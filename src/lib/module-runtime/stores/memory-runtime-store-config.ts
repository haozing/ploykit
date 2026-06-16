import type {
  RuntimeStore,
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreResourceBindingStatus,
  RuntimeStoreServiceConnectionRecord,
  RuntimeStoreSettingRecord,
  RuntimeStoreSettingStatus,
  UpsertRuntimeStoreResourceBindingInput,
  UpsertRuntimeStoreSettingInput,
} from './runtime-store-types';

type InMemoryConfigRuntimeStore = Pick<
  RuntimeStore,
  | 'upsertSetting'
  | 'getSetting'
  | 'listSettings'
  | 'upsertServiceConnection'
  | 'getServiceConnection'
  | 'listServiceConnections'
  | 'touchServiceConnection'
  | 'upsertResourceBinding'
  | 'listResourceBindings'
>;

interface CreateInMemoryConfigRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryConfigRuntimeStore({
  now,
  createId,
}: CreateInMemoryConfigRuntimeStoreInput): InMemoryConfigRuntimeStore {
  const settings = new Map<string, RuntimeStoreSettingRecord>();
  const serviceConnections = new Map<string, RuntimeStoreServiceConnectionRecord>();
  const resourceBindings = new Map<string, RuntimeStoreResourceBindingRecord>();

  return {
    async upsertSetting<TValue = unknown>(input: UpsertRuntimeStoreSettingInput<TValue>) {
      const status = input.status ?? 'active';
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.namespace}:${input.key}:${status}`;
      const existing = settings.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreSettingRecord<TValue> = {
        id: existing?.id ?? createId('setting'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        status,
        version: input.version ?? (existing ? existing.version + 1 : 1),
        updatedBy: input.actorId ?? null,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      settings.set(key, record);
      return clone(record);
    },
    async getSetting<TValue = unknown>(query: {
      productId: string;
      namespace: string;
      key: string;
      workspaceId?: string | null;
      status?: RuntimeStoreSettingStatus;
    }) {
      const candidates = [...settings.values()]
        .filter((setting) => setting.productId === query.productId)
        .filter((setting) => setting.namespace === query.namespace)
        .filter((setting) => setting.key === query.key)
        .filter((setting) => setting.status === (query.status ?? 'active'))
        .filter(
          (setting) => query.workspaceId === undefined || setting.workspaceId === query.workspaceId
        )
        .sort((left, right) => right.version - left.version);
      return candidates[0] ? (clone(candidates[0]) as RuntimeStoreSettingRecord<TValue>) : null;
    },
    async listSettings<TValue = unknown>(
      query: {
        productId?: string;
        workspaceId?: string | null;
        namespace?: string;
        status?: RuntimeStoreSettingStatus;
      } = {}
    ) {
      return [...settings.values()]
        .filter((setting) => !query.productId || setting.productId === query.productId)
        .filter(
          (setting) => query.workspaceId === undefined || setting.workspaceId === query.workspaceId
        )
        .filter((setting) => !query.namespace || setting.namespace === query.namespace)
        .filter((setting) => !query.status || setting.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((setting) => clone(setting) as RuntimeStoreSettingRecord<TValue>);
    },
    async upsertServiceConnection(input) {
      const key = `${input.productId}:${input.connectionId}`;
      const existing = serviceConnections.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreServiceConnectionRecord = {
        connectionId: input.connectionId,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        service: input.service,
        provider: input.provider,
        status: input.status ?? existing?.status ?? 'active',
        environment: input.environment,
        ownerType: input.ownerType,
        scopeType: input.scopeType,
        authType: input.authType,
        config: input.config ?? {},
        secretRefs: input.secretRefs ?? {},
        health: input.health ?? existing?.health ?? {},
        lastUsedAt: input.lastUsedAt ?? existing?.lastUsedAt,
        updatedBy: input.actorId ?? null,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      serviceConnections.set(key, record);
      return clone(record);
    },
    async getServiceConnection(productId, connectionId) {
      const record = serviceConnections.get(`${productId}:${connectionId}`);
      return record ? clone(record) : null;
    },
    async listServiceConnections(query = {}) {
      return [...serviceConnections.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.service || record.service === query.service)
        .filter((record) => !query.provider || record.provider === query.provider)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async touchServiceConnection(productId, connectionId, patch = {}) {
      const key = `${productId}:${connectionId}`;
      const existing = serviceConnections.get(key);
      if (!existing) {
        throw new Error(`RUNTIME_STORE_SERVICE_CONNECTION_NOT_FOUND: ${connectionId}`);
      }
      const next: RuntimeStoreServiceConnectionRecord = {
        ...existing,
        health: patch.health ?? existing.health,
        metadata: { ...existing.metadata, ...(patch.metadata ?? {}) },
        lastUsedAt: iso(now),
        updatedAt: iso(now),
      };
      serviceConnections.set(key, next);
      return clone(next);
    },
    async upsertResourceBinding<TValue = unknown>(
      input: UpsertRuntimeStoreResourceBindingInput<TValue>
    ) {
      const bindingId =
        input.bindingId ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId ?? ''}:${input.name}`;
      const existing = resourceBindings.get(bindingId);
      const timestamp = iso(now);
      const record: RuntimeStoreResourceBindingRecord<TValue> = {
        bindingId,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        name: input.name,
        kind: input.kind,
        value: input.value,
        status: input.status ?? existing?.status ?? 'active',
        updatedBy: input.actorId ?? null,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      resourceBindings.set(bindingId, record);
      return clone(record);
    },
    async listResourceBindings<TValue = unknown>(
      query: {
        productId?: string;
        workspaceId?: string | null;
        moduleId?: string | null;
        name?: string;
        kind?: string;
        status?: RuntimeStoreResourceBindingStatus;
      } = {}
    ) {
      return [...resourceBindings.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter((record) => !query.name || record.name === query.name)
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record) as RuntimeStoreResourceBindingRecord<TValue>);
    },
  };
}
