import type { ModuleResourceBindingsApi } from '@ploykit/module-sdk';
import type { RuntimeStore, RuntimeStoreResourceBindingRecord } from '../stores/runtime-store-types';

export interface StaticModuleResourceBinding {
  name: string;
  kind?: string;
  value: unknown;
}

export function createStaticModuleResourceBindingsApi(
  bindings: readonly StaticModuleResourceBinding[]
): ModuleResourceBindingsApi {
  const state = [...bindings];
  return {
    async get<TBinding = unknown>(name: string): Promise<TBinding | null> {
      const binding = state.find((candidate) => candidate.name === name);
      return binding ? (binding.value as TBinding) : null;
    },
    async list<TBinding = unknown>(kind?: string): Promise<TBinding[]> {
      return state
        .filter((binding) => !kind || binding.kind === kind)
        .map((binding) => binding.value as TBinding);
    },
    async upsert<TBinding = unknown>(
      name: string,
      value: TBinding,
      options?: { kind?: string }
    ): Promise<TBinding> {
      const existingIndex = state.findIndex((binding) => binding.name === name);
      const next = { name, kind: options?.kind, value };
      if (existingIndex >= 0) {
        state[existingIndex] = next;
      } else {
        state.push(next);
      }
      return value;
    },
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function enrichBindingValue<TBinding>(
  store: RuntimeStore,
  binding: RuntimeStoreResourceBindingRecord
): Promise<TBinding> {
  const value = metadataRecord(binding.value);
  if (Object.keys(value).length === 0) {
    return binding.value as TBinding;
  }
  const connectionId =
    typeof value.connectionId === 'string'
      ? value.connectionId
      : typeof binding.metadata.serviceConnectionId === 'string'
        ? binding.metadata.serviceConnectionId
        : undefined;
  if (!connectionId) {
    return binding.value as TBinding;
  }
  const connection = await store.getServiceConnection(binding.productId, connectionId);
  if (!connection) {
    return {
      ...value,
      _host: {
        bindingId: binding.bindingId,
        health: {
          status: 'blocked',
          result: 'missing-service-connection',
          connectionId,
        },
      },
    } as TBinding;
  }
  return {
    ...value,
    _host: {
      bindingId: binding.bindingId,
      serviceConnection: {
        connectionId: connection.connectionId,
        service: connection.service,
        provider: connection.provider,
        status: connection.status,
        lastUsedAt: connection.lastUsedAt,
      },
      health: {
        status: connection.status === 'disabled' ? 'blocked' : connection.health.status ?? 'warning',
        result: connection.health.result ?? 'untested',
        lastTestAt: connection.health.lastTestAt,
        lastError: connection.health.lastError,
      },
    },
  } as TBinding;
}

export function createRuntimeStoreModuleResourceBindingsApi(input: {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  actorId?: string | null;
}): ModuleResourceBindingsApi {
  function assertNoSecretMaterial(value: unknown, path = 'value'): void {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoSecretMaterial(item, `${path}.${index}`));
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        [
          'secret',
          'token',
          'password',
          'privatekey',
          'apikey',
          'accesskey',
          'refreshtoken',
          'clientsecret',
        ].includes(normalized)
      ) {
        throw new Error(`MODULE_RESOURCE_BINDING_SECRET_VALUE_DENIED: ${path}.${key}`);
      }
      assertNoSecretMaterial(item, `${path}.${key}`);
    }
  }

  async function activeBindings(kind?: string) {
    const [moduleBindings, sharedBindings] = await Promise.all([
      input.store.listResourceBindings({
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        kind,
        status: 'active',
      }),
      input.store.listResourceBindings({
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: null,
        kind,
        status: 'active',
      }),
    ]);
    const byName = new Map(sharedBindings.map((binding) => [binding.name, binding]));
    for (const binding of moduleBindings) {
      byName.set(binding.name, binding);
    }
    return [...byName.values()];
  }

  return {
    async get<TBinding = unknown>(name: string): Promise<TBinding | null> {
      const binding = (await activeBindings()).find((candidate) => candidate.name === name);
      return binding ? enrichBindingValue<TBinding>(input.store, binding) : null;
    },
    async list<TBinding = unknown>(kind?: string): Promise<TBinding[]> {
      return Promise.all(
        (await activeBindings(kind)).map((binding) =>
          enrichBindingValue<TBinding>(input.store, binding)
        )
      );
    },
    async upsert<TBinding = unknown>(
      name: string,
      value: TBinding,
      options?: {
        kind?: string;
        status?: 'active' | 'disabled';
        metadata?: Record<string, unknown>;
      }
    ): Promise<TBinding> {
      assertNoSecretMaterial(value);
      const record = await input.store.upsertResourceBinding<TBinding>({
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        actorId: input.actorId ?? null,
        name,
        kind: options?.kind,
        value,
        status: options?.status,
        metadata: options?.metadata,
      });
      await input.store.recordAudit({
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        actorId: input.actorId ?? null,
        type: 'host.resource_binding.upserted',
        metadata: {
          bindingId: record.bindingId,
          name,
          kind: record.kind,
          status: record.status,
        },
      });
      return record.value as TBinding;
    },
  };
}
