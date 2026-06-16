import { createAuditEnvelope } from '../observability/audit-metadata';
import { redactSensitive } from '../observability/redaction';
import type {
  RuntimeStore,
  RuntimeStoreAuditRecord,
  RuntimeStoreProviderInvocationRecord,
  RuntimeStoreUsageRecord,
} from './runtime-store-types';

type InMemoryObservabilityRuntimeStore = Pick<
  RuntimeStore,
  | 'recordAudit'
  | 'listAudit'
  | 'recordUsage'
  | 'listUsage'
  | 'recordProviderInvocation'
  | 'listProviderInvocations'
>;

interface CreateInMemoryObservabilityRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeError(error: Error | string): { code: string; message: string } {
  return typeof error === 'string'
    ? { code: 'RUNTIME_STORE_ERROR', message: error }
    : { code: error.name || 'RUNTIME_STORE_ERROR', message: error.message };
}

function normalizeDeliveryError(
  error?: Error | string | { code: string; message: string }
): { code: string; message: string } | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'object' && 'code' in error && 'message' in error) {
    return error;
  }
  return normalizeError(error);
}

export function createInMemoryObservabilityRuntimeStore({
  now,
  createId,
}: CreateInMemoryObservabilityRuntimeStoreInput): InMemoryObservabilityRuntimeStore {
  const audit: RuntimeStoreAuditRecord[] = [];
  const usage = new Map<string, RuntimeStoreUsageRecord>();
  const usageIdempotency = new Map<string, string>();
  const providerInvocations = new Map<string, RuntimeStoreProviderInvocationRecord>();

  return {
    async recordAudit(input) {
      const id = createId('audit');
      const createdAt = iso(now);
      const previousHash =
        [...audit].reverse().find((record) => record.productId === input.productId)?.integrity
          ?.recordHash ?? null;
      const envelope = createAuditEnvelope({
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        metadata: input.metadata ?? {},
        createdAt,
        previousHash,
      });
      const record: RuntimeStoreAuditRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        metadata: envelope.metadata,
        integrity: envelope.integrity,
        createdAt,
      };
      audit.push(record);
      return clone(record);
    },
    async listAudit(query = {}) {
      return audit
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.actorId || record.actorId === query.actorId)
        .filter((record) => !query.type || record.type === query.type)
        .filter((record) => !query.from || record.createdAt >= query.from)
        .filter((record) => !query.to || record.createdAt <= query.to)
        .map((record) => clone(record));
    },
    async recordUsage(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.moduleId}:${input.meter}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = usageIdempotency.get(key);
        if (existingId) {
          return clone(usage.get(existingId)!);
        }
      }

      const record: RuntimeStoreUsageRecord = {
        id: createId('usage'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
      };
      usage.set(record.id, record);
      if (key) {
        usageIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async listUsage(query = {}) {
      return [...usage.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.meter || record.meter === query.meter)
        .map((record) => clone(record));
    },
    async recordProviderInvocation(input) {
      const record: RuntimeStoreProviderInvocationRecord = {
        id: createId('provider_invocation'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        providerId: input.providerId,
        kind: input.kind,
        operation: input.operation,
        status: input.status,
        target: input.target ?? null,
        model: input.model ?? null,
        serviceConnectionId: input.serviceConnectionId ?? null,
        resourceBindingId: input.resourceBindingId ?? null,
        usage: input.usage ?? {},
        cost: input.cost ?? {},
        latencyMs: input.latencyMs ?? 0,
        correlationId: input.correlationId ?? null,
        error: normalizeDeliveryError(input.error),
        metadata: redactSensitive(input.metadata ?? {}),
        createdAt: iso(now),
      };
      providerInvocations.set(record.id, record);
      return clone(record);
    },
    async listProviderInvocations(query = {}) {
      return [...providerInvocations.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter((record) => !query.providerId || record.providerId === query.providerId)
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.operation || record.operation === query.operation)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
  };
}
