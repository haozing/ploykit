import type {
  RuntimeStore,
  RuntimeStoreIdempotencyRecord,
  RuntimeStoreIdempotencyStatus,
} from './runtime-store-types';

type InMemoryIdempotencyRuntimeStore = Pick<
  RuntimeStore,
  | 'beginIdempotencyKey'
  | 'completeIdempotencyKey'
  | 'getIdempotencyKey'
  | 'listIdempotencyKeys'
  | 'deleteExpiredIdempotencyKeys'
>;

interface CreateInMemoryIdempotencyRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultExpiresAt(now: () => Date): string {
  return new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function keyFor(input: {
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  namespace: string;
  key: string;
}): string {
  return `${input.productId}:${input.environmentId ?? ''}:${input.workspaceId ?? ''}:${input.namespace}:${input.key}`;
}

function isExpired(record: RuntimeStoreIdempotencyRecord, before: string): boolean {
  return new Date(record.expiresAt).getTime() <= new Date(before).getTime();
}

export function createInMemoryIdempotencyRuntimeStore({
  now,
  createId,
}: CreateInMemoryIdempotencyRuntimeStoreInput): InMemoryIdempotencyRuntimeStore {
  const records = new Map<string, RuntimeStoreIdempotencyRecord>();
  const scopeIndex = new Map<string, string>();

  function remove(record: RuntimeStoreIdempotencyRecord): void {
    records.delete(record.id);
    scopeIndex.delete(keyFor(record));
  }

  return {
    async beginIdempotencyKey(input) {
      const scopeKey = keyFor(input);
      const existingId = scopeIndex.get(scopeKey);
      const nowIso = now().toISOString();

      if (existingId) {
        const existing = records.get(existingId);
        if (existing && isExpired(existing, nowIso)) {
          remove(existing);
        } else if (existing) {
          if (existing.requestHash !== input.requestHash) {
            return { outcome: 'conflict', record: clone(existing) };
          }
          if (existing.status === 'completed') {
            return { outcome: 'replay', record: clone(existing) };
          }
          if (
            input.recoverLockedBefore &&
            new Date(existing.lockedAt).getTime() <=
              new Date(input.recoverLockedBefore).getTime()
          ) {
            const recovered: RuntimeStoreIdempotencyRecord = {
              ...existing,
              lockedAt: nowIso,
              updatedAt: nowIso,
              metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
            };
            records.set(recovered.id, recovered);
            return { outcome: 'started', record: clone(recovered) };
          }
          return { outcome: 'in_progress', record: clone(existing) };
        }
      }

      const record: RuntimeStoreIdempotencyRecord = {
        id: createId('idem'),
        productId: input.productId,
        environmentId: input.environmentId ?? null,
        workspaceId: input.workspaceId ?? null,
        namespace: input.namespace,
        key: input.key,
        requestHash: input.requestHash,
        status: 'in_progress',
        lockedAt: nowIso,
        expiresAt: input.expiresAt ?? defaultExpiresAt(now),
        metadata: input.metadata ?? {},
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      records.set(record.id, record);
      scopeIndex.set(scopeKey, record.id);
      return { outcome: 'started', record: clone(record) };
    },
    async completeIdempotencyKey(input) {
      const existing = records.get(input.id);
      if (!existing) {
        throw new Error(`RUNTIME_STORE_IDEMPOTENCY_NOT_FOUND: ${input.id}`);
      }
      const updated: RuntimeStoreIdempotencyRecord = {
        ...existing,
        status: 'completed',
        responseStatus: input.responseStatus,
        responseHeaders: input.responseHeaders,
        responseBodyBase64: input.responseBodyBase64,
        metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
        updatedAt: now().toISOString(),
      };
      records.set(updated.id, updated);
      return clone(updated);
    },
    async getIdempotencyKey(id) {
      const record = records.get(id);
      return record ? clone(record) : null;
    },
    async listIdempotencyKeys(query = {}) {
      return [...records.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.environmentId === undefined || record.environmentId === query.environmentId
        )
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.namespace || record.namespace === query.namespace)
        .filter(
          (record) =>
            !query.status || (record.status as RuntimeStoreIdempotencyStatus) === query.status
        )
        .filter((record) => !query.expiresBefore || isExpired(record, query.expiresBefore))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(clone);
    },
    async deleteExpiredIdempotencyKeys(query = {}) {
      const before = query.before ?? now().toISOString();
      const expired = [...records.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.environmentId === undefined || record.environmentId === query.environmentId
        )
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => isExpired(record, before))
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
        .slice(0, query.limit ?? Number.POSITIVE_INFINITY);

      for (const record of expired) {
        remove(record);
      }
      return expired.length;
    },
  };
}
