import type { ModuleBillingPlan } from '@ploykit/module-sdk';
import type {
  RuntimeStore,
  RuntimeStoreSubscriptionRecord,
  RuntimeStoreSubscriptionStatus,
} from '../../module-runtime/stores';
import { timestampToMillis } from './commercial-ledger-utils';

interface CreateCommercialLedgerSubscriptionsInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  planCatalog: readonly ModuleBillingPlan[];
}

export function createCommercialLedgerSubscriptions({
  store,
  scope,
  planCatalog,
}: CreateCommercialLedgerSubscriptionsInput): {
  findCurrentSubscription(input: {
    id: string;
    userId: string;
    planId: string;
  }): Promise<RuntimeStoreSubscriptionRecord | null>;
  subscriptionLastEventAt(subscription: RuntimeStoreSubscriptionRecord | null): number | null;
  syncSubscriptionEntitlements(input: {
    subscription: RuntimeStoreSubscriptionRecord;
    status: RuntimeStoreSubscriptionStatus;
    provider?: string | null;
    providerRef?: string | null;
    eventIdempotencyKey?: string;
  }): Promise<void>;
} {
  function planEntitlements(planId: string): string[] {
    const plan = planCatalog.find((candidate) => candidate.id === planId);
    return [...new Set(plan?.entitlements ?? [])];
  }

  function subscriptionOrderId(subscription: RuntimeStoreSubscriptionRecord | null): string | null {
    const orderId = subscription?.metadata.orderId;
    return typeof orderId === 'string' && orderId.length > 0 ? orderId : null;
  }

  function subscriptionLastEventAt(
    subscription: RuntimeStoreSubscriptionRecord | null
  ): number | null {
    const lastEventAt = subscription?.metadata.lastEventAt;
    return timestampToMillis(typeof lastEventAt === 'string' ? lastEventAt : null);
  }

  async function findCurrentSubscription(input: {
    id: string;
    userId: string;
    planId: string;
  }): Promise<RuntimeStoreSubscriptionRecord | null> {
    const candidates = await store.listSubscriptions({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: input.userId,
      planId: input.planId,
    });
    return candidates.find((candidate) => candidate.id === input.id) ?? null;
  }

  async function syncSubscriptionEntitlements(input: {
    subscription: RuntimeStoreSubscriptionRecord;
    status: RuntimeStoreSubscriptionStatus;
    provider?: string | null;
    providerRef?: string | null;
    eventIdempotencyKey?: string;
  }): Promise<void> {
    const entitlements = planEntitlements(input.subscription.planId);
    const orderId = subscriptionOrderId(input.subscription);
    const grants = await store.listEntitlements({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: input.subscription.userId,
      status: 'active',
    });

    if (input.status === 'canceled') {
      for (const grant of grants) {
        const grantOrderId = grant.metadata.orderId;
        const grantSubscriptionId = grant.metadata.subscriptionId;
        const isOrderBacked =
          orderId &&
          grant.source === 'order' &&
          grant.planId === input.subscription.planId &&
          (grantOrderId === orderId ||
            grant.idempotencyKey?.startsWith(`order:${orderId}:entitlement:`));
        const isSubscriptionBacked =
          !orderId &&
          grant.source === 'subscription' &&
          grantSubscriptionId === input.subscription.id;
        if (isOrderBacked || isSubscriptionBacked) {
          await store.revokeEntitlement(grant.id, {
            subscriptionId: input.subscription.id,
            provider: input.provider,
            providerRef: input.providerRef,
            reason: 'subscription.canceled',
          });
        }
      }
      return;
    }

    if (entitlements.length === 0) {
      return;
    }

    if (orderId || (input.status !== 'active' && input.status !== 'trialing')) {
      return;
    }

    for (const entitlement of entitlements) {
      const hasGrant = grants.some(
        (grant) =>
          grant.entitlement === entitlement &&
          grant.source === 'subscription' &&
          grant.metadata.subscriptionId === input.subscription.id
      );
      if (hasGrant) {
        continue;
      }
      await store.grantEntitlement({
        ...scope,
        userId: input.subscription.userId,
        entitlement,
        planId: input.subscription.planId,
        source: 'subscription',
        idempotencyKey: `subscription:${input.subscription.id}:entitlement:${entitlement}`,
        metadata: {
          subscriptionId: input.subscription.id,
          provider: input.provider,
          providerRef: input.providerRef,
          eventIdempotencyKey: input.eventIdempotencyKey,
        },
      });
    }
  }

  return { findCurrentSubscription, subscriptionLastEventAt, syncSubscriptionEntitlements };
}
