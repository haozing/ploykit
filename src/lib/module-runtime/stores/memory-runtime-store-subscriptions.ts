import { redactSensitive } from '../observability/redaction';
import type {
  RuntimeStore,
  RuntimeStoreSubscriptionEventRecord,
  RuntimeStoreSubscriptionRecord,
} from './runtime-store-types';

type InMemorySubscriptionRuntimeStore = Pick<
  RuntimeStore,
  'upsertSubscription' | 'listSubscriptions' | 'createSubscriptionEvent' | 'listSubscriptionEvents'
>;

interface CreateInMemorySubscriptionRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemorySubscriptionRuntimeStore({
  now,
  createId,
}: CreateInMemorySubscriptionRuntimeStoreInput): InMemorySubscriptionRuntimeStore {
  const subscriptions = new Map<string, RuntimeStoreSubscriptionRecord>();
  const subscriptionEvents = new Map<string, RuntimeStoreSubscriptionEventRecord>();
  const subscriptionEventIdempotency = new Map<string, string>();

  return {
    async upsertSubscription(input) {
      const id =
        input.id ?? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.planId}`;
      const existing = subscriptions.get(id);
      const timestamp = iso(now);
      const subscription: RuntimeStoreSubscriptionRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        planId: input.planId,
        status: input.status ?? existing?.status ?? 'active',
        provider: input.provider ?? existing?.provider ?? null,
        providerRef: input.providerRef ?? existing?.providerRef ?? null,
        currentPeriodStart: input.currentPeriodStart ?? existing?.currentPeriodStart ?? timestamp,
        currentPeriodEnd: input.currentPeriodEnd ?? existing?.currentPeriodEnd ?? null,
        trialEnd: input.trialEnd ?? existing?.trialEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
        renewalStrategy: input.renewalStrategy ?? existing?.renewalStrategy ?? 'manual',
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      subscriptions.set(id, subscription);
      return clone(subscription);
    },
    async listSubscriptions(query = {}) {
      return [...subscriptions.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.planId || record.planId === query.planId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async createSubscriptionEvent(input) {
      const timestamp = iso(now);
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = subscriptionEventIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(subscriptionEvents.get(existingId)!);
        }
      }
      const event: RuntimeStoreSubscriptionEventRecord = {
        id: createId('subscription_event'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        planId: input.planId,
        type: input.type,
        status: input.status,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        effectiveAt: input.effectiveAt ?? timestamp,
        metadata: redactSensitive(input.metadata ?? {}),
        createdAt: timestamp,
      };
      subscriptionEvents.set(event.id, event);
      if (idempotencyKey) {
        subscriptionEventIdempotency.set(idempotencyKey, event.id);
      }
      return clone(event);
    },
    async listSubscriptionEvents(query = {}) {
      return [...subscriptionEvents.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.subscriptionId || record.subscriptionId === query.subscriptionId)
        .filter((record) => !query.planId || record.planId === query.planId)
        .filter((record) => !query.type || record.type === query.type)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
  };
}
