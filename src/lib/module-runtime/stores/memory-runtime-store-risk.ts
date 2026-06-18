import type {
  RuntimeStore,
  RuntimeStoreRiskBlock,
  RuntimeStoreRiskEvent,
} from './runtime-store-types';

type InMemoryRiskRuntimeStore = Pick<
  RuntimeStore,
  'recordRiskEvent' | 'upsertRiskBlock' | 'releaseRiskBlock' | 'listRiskEvents' | 'listRiskBlocks'
>;

interface CreateInMemoryRiskRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryRiskRuntimeStore({
  now,
  createId,
}: CreateInMemoryRiskRuntimeStoreInput): InMemoryRiskRuntimeStore {
  const riskEvents = new Map<string, RuntimeStoreRiskEvent>();
  const riskBlocks = new Map<string, RuntimeStoreRiskBlock>();
  const riskBlockIdempotency = new Map<string, string>();

  return {
    async recordRiskEvent(input) {
      const record: RuntimeStoreRiskEvent = {
        id: input.id ?? createId('risk_event'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        type: input.type,
        severity: input.severity ?? 'medium',
        status: input.status ?? 'open',
        source: input.source,
        sourceId: input.sourceId,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
        updatedAt: iso(now),
      };
      riskEvents.set(record.id, record);
      return clone(record);
    },
    async upsertRiskBlock(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.subjectType}:${input.subjectId}:${input.scope ?? ''}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = riskBlockIdempotency.get(key);
        if (existingId) {
          return clone(riskBlocks.get(existingId)!);
        }
      }
      const existing = [...riskBlocks.values()].find(
        (record) =>
          record.productId === input.productId &&
          record.workspaceId === (input.workspaceId ?? null) &&
          record.subjectType === input.subjectType &&
          record.subjectId === input.subjectId &&
          (record.scope ?? '') === (input.scope ?? '') &&
          !record.releasedAt
      );
      const timestamp = iso(now);
      const record: RuntimeStoreRiskBlock = {
        id: existing?.id ?? input.id ?? createId('risk_block'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        scope: input.scope,
        reason: input.reason,
        expiresAt: input.expiresAt,
        releasedAt: existing?.releasedAt,
        releasedBy: existing?.releasedBy,
        releaseReason: existing?.releaseReason,
        idempotencyKey: input.idempotencyKey,
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      riskBlocks.set(record.id, record);
      if (key) {
        riskBlockIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async releaseRiskBlock(id, patch = {}) {
      const previous = riskBlocks.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_RISK_BLOCK_NOT_FOUND: ${id}`);
      }
      const timestamp = patch.releasedAt ?? iso(now);
      const next: RuntimeStoreRiskBlock = {
        ...previous,
        releasedAt: timestamp,
        releasedBy: patch.releasedBy,
        releaseReason: patch.reason,
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: timestamp,
      };
      riskBlocks.set(id, next);
      return clone(next);
    },
    async listRiskEvents(query = {}) {
      return [...riskEvents.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter((record) => !query.subjectType || record.subjectType === query.subjectType)
        .filter((record) => !query.subjectId || record.subjectId === query.subjectId)
        .filter((record) => !query.type || record.type === query.type)
        .filter((record) => !query.severity || record.severity === query.severity)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.source || record.source === query.source)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .map((record) => clone(record));
    },
    async listRiskBlocks(query = {}) {
      return [...riskBlocks.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.subjectType || record.subjectType === query.subjectType)
        .filter((record) => !query.subjectId || record.subjectId === query.subjectId)
        .filter(
          (record) => query.scope === undefined || (record.scope ?? '') === (query.scope ?? '')
        )
        .filter((record) => query.includeReleased || !record.releasedAt)
        .map((record) => clone(record));
    },
  };
}
