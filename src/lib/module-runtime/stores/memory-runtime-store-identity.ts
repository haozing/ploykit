import type {
  RuntimeStore,
  RuntimeStoreApiKeyRecord,
  RuntimeStoreHostUser,
  RuntimeStoreHostUserStatus,
} from './runtime-store-types';

type InMemoryIdentityRuntimeStore = Pick<
  RuntimeStore,
  | 'createApiKey'
  | 'getApiKey'
  | 'findApiKeyByHash'
  | 'updateApiKey'
  | 'listApiKeys'
  | 'upsertHostUser'
  | 'getHostUser'
  | 'findHostUserByEmail'
  | 'listHostUsers'
  | 'updateHostUserStatus'
>;

interface CreateInMemoryIdentityRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryIdentityRuntimeStore({
  now,
  createId,
}: CreateInMemoryIdentityRuntimeStoreInput): InMemoryIdentityRuntimeStore {
  const apiKeys = new Map<string, RuntimeStoreApiKeyRecord>();
  const hostUsers = new Map<string, RuntimeStoreHostUser>();

  function readHostUser(id: string): RuntimeStoreHostUser {
    const user = hostUsers.get(id);
    if (!user) {
      throw new Error(`RUNTIME_STORE_HOST_USER_NOT_FOUND: ${id}`);
    }
    return user;
  }

  return {
    async createApiKey(input) {
      const timestamp = iso(now);
      const id = input.id ?? createId('api_key');
      if (apiKeys.has(id)) {
        throw new Error(`RUNTIME_STORE_API_KEY_ALREADY_EXISTS: ${id}`);
      }
      const keyHashCollision = [...apiKeys.values()].find(
        (candidate) => candidate.keyHash === input.keyHash
      );
      if (keyHashCollision) {
        throw new Error(`RUNTIME_STORE_API_KEY_HASH_ALREADY_EXISTS: ${input.prefix}`);
      }
      const record: RuntimeStoreApiKeyRecord = {
        id,
        productId: input.productId,
        environmentId: input.environmentId ?? null,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        name: input.name,
        prefix: input.prefix,
        keyHash: input.keyHash,
        ownerSubjectType: input.ownerSubjectType,
        ownerSubjectId: input.ownerSubjectId,
        createdBy: input.createdBy,
        permissions: input.permissions ?? [],
        rateLimit: input.rateLimit,
        status: input.status ?? 'active',
        expiresAt: input.expiresAt,
        revokedAt: input.revokedAt,
        lastUsedAt: input.lastUsedAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      apiKeys.set(record.id, record);
      return clone(record);
    },
    async getApiKey(input) {
      const record = apiKeys.get(input.id);
      if (
        !record ||
        (input.productId && record.productId !== input.productId) ||
        (input.environmentId !== undefined &&
          record.environmentId !== undefined &&
          record.environmentId !== null &&
          record.environmentId !== input.environmentId) ||
        (input.workspaceId !== undefined && record.workspaceId !== input.workspaceId)
      ) {
        return null;
      }
      return clone(record);
    },
    async findApiKeyByHash(input) {
      const record =
        [...apiKeys.values()].find(
          (candidate) =>
            candidate.keyHash === input.keyHash &&
            (!input.prefix || candidate.prefix === input.prefix) &&
            (!input.productId || candidate.productId === input.productId) &&
            (input.environmentId === undefined ||
              candidate.environmentId === undefined ||
              candidate.environmentId === null ||
              candidate.environmentId === input.environmentId)
        ) ?? null;
      return record ? clone(record) : null;
    },
    async updateApiKey(id, patch) {
      const previous = apiKeys.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_API_KEY_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreApiKeyRecord = {
        ...previous,
        prefix: patch.prefix ?? previous.prefix,
        keyHash: patch.keyHash ?? previous.keyHash,
        status: patch.status ?? previous.status,
        expiresAt: patch.expiresAt === null ? undefined : (patch.expiresAt ?? previous.expiresAt),
        revokedAt: patch.revokedAt === null ? undefined : (patch.revokedAt ?? previous.revokedAt),
        lastUsedAt:
          patch.lastUsedAt === null ? undefined : (patch.lastUsedAt ?? previous.lastUsedAt),
        rateLimit: patch.rateLimit === null ? undefined : (patch.rateLimit ?? previous.rateLimit),
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: iso(now),
      };
      apiKeys.set(id, next);
      return clone(next);
    },
    async listApiKeys(query = {}) {
      return [...apiKeys.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.environmentId === undefined || (record.environmentId ?? null) === query.environmentId
        )
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter(
          (record) => !query.ownerSubjectType || record.ownerSubjectType === query.ownerSubjectType
        )
        .filter((record) => !query.ownerSubjectId || record.ownerSubjectId === query.ownerSubjectId)
        .filter((record) => !query.status || record.status === query.status)
        .map((record) => clone(record));
    },
    async upsertHostUser(input) {
      const timestamp = iso(now);
      const existing = hostUsers.get(input.id);
      const user: RuntimeStoreHostUser = {
        id: input.id,
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
        status: input.status,
        productId: input.productId,
        workspaceId: input.workspaceId,
        workspaceRole: input.workspaceRole,
        permissions: input.permissions ? [...input.permissions] : undefined,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? existing?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      hostUsers.set(user.id, user);
      return clone(user);
    },
    async getHostUser(id) {
      const user = hostUsers.get(id);
      return user ? clone(user) : null;
    },
    async findHostUserByEmail(email) {
      const normalized = email.trim().toLowerCase();
      const user = [...hostUsers.values()].find((record) => record.email === normalized);
      return user ? clone(user) : null;
    },
    async listHostUsers(query = {}) {
      return [...hostUsers.values()]
        .filter((user) => !query.productId || user.productId === query.productId)
        .filter((user) => !query.role || user.role === query.role)
        .filter((user) => !query.status || user.status === query.status)
        .map((user) => clone(user));
    },
    async updateHostUserStatus(id: string, status: RuntimeStoreHostUserStatus, metadata) {
      const previous = readHostUser(id);
      const next: RuntimeStoreHostUser = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      hostUsers.set(id, next);
      return clone(next);
    },
  };
}
