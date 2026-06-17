import { type CommercialSubject, ModuleCommerceApi } from '@ploykit/module-sdk';
import type {
  RuntimeStore,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreEntitlementGrant,
} from '../../module-runtime/stores';
import {
  subjectFromCommercialInput,
  subjectToStoredUserId,
  subscriptionStatusForEvent,
  assertPositiveIntegerAmount,
  toCheckout,
  toCreditLedgerEntry,
  toEntitlementGrant,
} from './commercial-ledger-utils';
import type { CommercialProviderPaidInput } from './commercial-ledger-types';

interface CreateCommercialLedgerCommerceInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  applySkuBenefits(order: RuntimeStoreCommercialOrder): Promise<{
    credits: RuntimeStoreCreditLedgerEntry[];
    entitlements: RuntimeStoreEntitlementGrant[];
  }>;
  reverseOrderBenefits(
    order: RuntimeStoreCommercialOrder,
    refundAmount: number,
    creditNoteId: string
  ): Promise<{
    credits: RuntimeStoreCreditLedgerEntry[];
    revokedEntitlements: RuntimeStoreEntitlementGrant[];
  }>;
  expectedMissingBenefits(order: RuntimeStoreCommercialOrder): Promise<{
    missingCredits: number;
    missingEntitlements: string[];
  }>;
}

export function createCommercialLedgerCommerce({
  store,
  scope,
  applySkuBenefits,
  reverseOrderBenefits,
  expectedMissingBenefits,
}: CreateCommercialLedgerCommerceInput): {
  commerce: ModuleCommerceApi;
  getScopedOrder(id: string): Promise<RuntimeStoreCommercialOrder | null>;
  requireScopedOrder(id: string, operation: string): Promise<RuntimeStoreCommercialOrder>;
  assertPaidInputMatchesOrder(
    order: RuntimeStoreCommercialOrder,
    input: CommercialProviderPaidInput
  ): void;
} {
  function orderBelongsToScope(order: RuntimeStoreCommercialOrder): boolean {
    return (
      order.productId === scope.productId &&
      (order.workspaceId ?? null) === (scope.workspaceId ?? null)
    );
  }

  async function getScopedOrder(id: string): Promise<RuntimeStoreCommercialOrder | null> {
    const order = await store.getCommercialOrder(id);
    return order && orderBelongsToScope(order) ? order : null;
  }

  async function requireScopedOrder(
    id: string,
    operation: string
  ): Promise<RuntimeStoreCommercialOrder> {
    const order = await getScopedOrder(id);
    if (!order) {
      throw new Error(`${operation}_ORDER_NOT_FOUND: ${id}`);
    }
    return order;
  }

  function assertPaidInputMatchesOrder(
    order: RuntimeStoreCommercialOrder,
    input: CommercialProviderPaidInput
  ): void {
    if (
      order.userId !== input.userId ||
      order.sku !== input.sku ||
      order.amount !== input.amount ||
      order.currency !== input.currency
    ) {
      throw new Error(`MODULE_COMMERCIAL_ORDER_MISMATCH: ${order.id}`);
    }
  }

  const commerce: ModuleCommerceApi = {
    async createCheckout(input) {
      assertPositiveIntegerAmount(input.amount, 'commerce.createCheckout.amount');
      const beneficiary = input.beneficiary ?? input.buyer ?? subjectFromCommercialInput(input);
      const order = await store.createCommercialOrder({
        ...scope,
        userId: subjectToStoredUserId(beneficiary),
        sku: input.sku,
        amount: input.amount,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          buyer: input.buyer,
          beneficiary,
        },
      });
      return toCheckout(order);
    },
    async getOrder(id) {
      const order = await getScopedOrder(id);
      return order ? toCheckout(order) : null;
    },
    async applyCheckoutPaid(input) {
      assertPositiveIntegerAmount(input.amount, 'commerce.applyCheckoutPaid.amount');
      const beneficiary = input.beneficiary ?? input.buyer ?? subjectFromCommercialInput(input);
      let order = input.orderId
        ? await requireScopedOrder(input.orderId, 'MODULE_COMMERCIAL_PAID')
        : null;
      order ??= await store.findCommercialOrderByProviderRef(
        scope.productId,
        scope.workspaceId,
        input.provider,
        input.providerRef
      );
      order ??= await store.createCommercialOrder({
        ...scope,
        userId: subjectToStoredUserId(beneficiary),
        sku: input.sku,
        amount: input.amount,
        currency: input.currency,
        provider: input.provider,
        providerRef: input.providerRef,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          ...(input.metadata ?? {}),
          buyer: input.buyer,
          beneficiary,
        },
      });
      if (order.provider !== input.provider || order.providerRef !== input.providerRef) {
        order = await store.attachCommercialOrderProvider(
          order.id,
          input.provider,
          input.providerRef,
          input.metadata
        );
      }
      const paidOrder = await store.updateCommercialOrderStatus(order.id, 'paid', {
        provider: input.provider,
        providerRef: input.providerRef,
        ...(input.metadata ?? {}),
      });
      const benefits = await applySkuBenefits(paidOrder);
      return {
        order: toCheckout(paidOrder),
        credits: benefits.credits.map(toCreditLedgerEntry),
        entitlements: benefits.entitlements.map(toEntitlementGrant),
      };
    },
    async applyRefund(input) {
      let order = input.orderId
        ? await requireScopedOrder(input.orderId, 'MODULE_COMMERCIAL_REFUND')
        : null;
      order ??= await store.findCommercialOrderByProviderRef(
        scope.productId,
        scope.workspaceId,
        input.provider,
        input.providerRef
      );
      if (!order) {
        throw new Error(`MODULE_COMMERCIAL_REFUND_ORDER_NOT_FOUND: ${input.providerRef}`);
      }
      assertPositiveIntegerAmount(input.amount ?? order.amount, 'commerce.applyRefund.amount');
      const refundedOrder = await store.updateCommercialOrderStatus(order.id, 'refunded', {
        provider: input.provider,
        providerRef: input.providerRef,
        refundAmount: input.amount ?? order.amount,
        refundCurrency: input.currency ?? order.currency,
        refundReason: input.reason ?? 'provider.refund',
        ...(input.metadata ?? {}),
      });
      const reversed = await reverseOrderBenefits(
        refundedOrder,
        input.amount ?? order.amount,
        input.idempotencyKey ?? `refund:${input.providerRef}`
      );
      return {
        order: toCheckout(refundedOrder),
        credits: reversed.credits.map(toCreditLedgerEntry),
        revokedEntitlements: reversed.revokedEntitlements.map(toEntitlementGrant),
      };
    },
    async recordSubscriptionEvent(input) {
      const subject = subjectFromCommercialInput(input);
      const userId = subjectToStoredUserId(subject);
      const status = subscriptionStatusForEvent(input.type, input.status);
      const subscriptionId =
        input.subscriptionId ??
        `${scope.productId}:${scope.workspaceId ?? ''}:${userId}:${input.planId}`;
      await store.upsertSubscription({
        ...scope,
        id: subscriptionId,
        userId,
        planId: input.planId,
        status,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        currentPeriodStart:
          input.currentPeriodStart ?? input.effectiveAt ?? new Date().toISOString(),
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        trialEnd: input.trialEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? status === 'canceled',
        renewalStrategy: input.provider ? 'provider' : 'manual',
        metadata: {
          ...(input.metadata ?? {}),
          subject,
        },
      });
      const event = await store.createSubscriptionEvent({
        ...scope,
        userId,
        subscriptionId,
        planId: input.planId,
        type: input.type,
        status,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        idempotencyKey: input.idempotencyKey,
        effectiveAt: input.effectiveAt,
        metadata: {
          ...(input.metadata ?? {}),
          subject,
        },
      });
      return {
        id: event.id,
        subject: subject as CommercialSubject,
        planId: event.planId,
        type: event.type,
        status: event.status,
      };
    },
    async reconcilePaidOrderBenefits(input = {}) {
      const orders = await store.listCommercialOrders({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        status: 'paid',
      });
      let repaired = 0;
      for (const order of orders) {
        if (
          input.provider &&
          order.provider !== input.provider &&
          order.metadata.provider !== input.provider
        ) {
          continue;
        }
        if (input.from && order.updatedAt < input.from) {
          continue;
        }
        if (input.to && order.updatedAt > input.to) {
          continue;
        }
        const expected = await expectedMissingBenefits(order);
        if (expected.missingCredits > 0 || expected.missingEntitlements.length > 0) {
          await applySkuBenefits(order);
          repaired += 1;
        }
      }
      return { checked: orders.length, repaired };
    },
  };

  return {
    commerce,
    getScopedOrder,
    requireScopedOrder,
    assertPaidInputMatchesOrder,
  };
}
