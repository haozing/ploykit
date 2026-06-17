import type { ModuleBillingPlan } from '@ploykit/module-sdk';
import type {
  RuntimeStore,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreSubscriptionRecord,
  RuntimeStoreSubscriptionStatus,
} from '../../module-runtime/stores';
import {
  assertPositiveIntegerAmount,
  isRevenueInvoice,
  isWithinPeriod,
  subscriptionStatusForEvent,
  timestampToMillis,
  uniqueEntitlements,
} from './commercial-ledger-utils';
import type {
  CommercialBenefitReconcileResult,
  CommercialOrderStatusEventReason,
  CommercialProviderPaidInput,
  CommercialReconcileResult,
  CommercialSkuDefinition,
  RuntimeStoreCommercialRuntime,
} from './commercial-ledger-types';

interface CreateCommercialProviderRuntimeInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  planCatalog: readonly ModuleBillingPlan[];
  skuCatalog: Record<string, CommercialSkuDefinition>;
  now: () => Date;
  requireScopedOrder(id: string, operation: string): Promise<RuntimeStoreCommercialOrder>;
  assertPaidInputMatchesOrder(
    order: RuntimeStoreCommercialOrder,
    input: CommercialProviderPaidInput
  ): void;
  applySkuBenefits(order: RuntimeStoreCommercialOrder): Promise<{
    credits: RuntimeStoreCreditLedgerEntry[];
    entitlements: RuntimeStoreEntitlementGrant[];
  }>;
  recordCommercialDomainFacts(order: RuntimeStoreCommercialOrder): Promise<void>;
  publishOrderStatusEvent(input: {
    order: RuntimeStoreCommercialOrder;
    previousStatus: RuntimeStoreCommercialOrderStatus;
    reason: CommercialOrderStatusEventReason;
    provider: string;
    providerRef: string;
    refund?: {
      creditNoteId: string;
      amount: number;
      currency: string;
      reason: string;
    };
  }): Promise<void>;
  recordRefundDomainFacts(input: {
    order: RuntimeStoreCommercialOrder;
    amount: number;
    currency: string;
    provider: string;
    providerRef: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreCreditNoteRecord>;
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
}

export function createCommercialProviderRuntime({
  store,
  scope,
  planCatalog,
  skuCatalog,
  now,
  requireScopedOrder,
  assertPaidInputMatchesOrder,
  applySkuBenefits,
  recordCommercialDomainFacts,
  publishOrderStatusEvent,
  recordRefundDomainFacts,
  reverseOrderBenefits,
  expectedMissingBenefits,
  findCurrentSubscription,
  subscriptionLastEventAt,
  syncSubscriptionEntitlements,
}: CreateCommercialProviderRuntimeInput): RuntimeStoreCommercialRuntime['provider'] {
  return {
    async applyCheckoutPaid(input) {
      assertPositiveIntegerAmount(input.amount, 'provider.paid.amount');
      const sku = skuCatalog[input.sku];
      if (sku?.planId) {
        await store.upsertCommercialCatalogItem({
          ...scope,
          kind: 'plan',
          itemId: sku.planId,
          status: 'published',
          value: planCatalog.find((plan) => plan.id === sku.planId) ?? {
            id: sku.planId,
            name: sku.planId,
            entitlements: uniqueEntitlements(sku, planCatalog),
          },
          metadata: { source: 'provider.paid' },
        });
      }
      await store.upsertCommercialCatalogItem({
        ...scope,
        kind: 'sku',
        itemId: input.sku,
        status: 'published',
        value: {
          id: input.sku,
          amount: input.amount,
          currency: input.currency,
          credits: sku?.credits,
          entitlements: uniqueEntitlements(sku, planCatalog),
          planId: sku?.planId,
        },
        metadata: { source: 'provider.paid' },
      });
      const orderById = input.orderId
        ? await requireScopedOrder(input.orderId, 'MODULE_COMMERCIAL_PAID')
        : null;
      const orderByProviderRef = await store.findCommercialOrderByProviderRef(
        scope.productId,
        scope.workspaceId,
        input.provider,
        input.providerRef
      );
      if (orderById && orderByProviderRef && orderById.id !== orderByProviderRef.id) {
        throw new Error(`MODULE_COMMERCIAL_ORDER_PROVIDER_REF_CONFLICT: ${input.providerRef}`);
      }
      let order = orderById ?? orderByProviderRef;
      order ??= await store.createCommercialOrder({
        ...scope,
        userId: input.userId,
        sku: input.sku,
        amount: input.amount,
        currency: input.currency,
        provider: input.provider,
        providerRef: input.providerRef,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });
      if (order.provider !== input.provider || order.providerRef !== input.providerRef) {
        order = await store.attachCommercialOrderProvider(
          order.id,
          input.provider,
          input.providerRef,
          input.metadata
        );
      }

      assertPaidInputMatchesOrder(order, input);
      if (order.status === 'refunded') {
        return { order, credits: [], entitlements: [] };
      }

      const previousStatus: RuntimeStoreCommercialOrderStatus =
        order.status === 'paid' ? 'created' : order.status;
      const paidOrder = await store.updateCommercialOrderStatus(order.id, 'paid', {
        provider: input.provider,
        providerRef: input.providerRef,
        ...(input.metadata ?? {}),
      });
      const benefits = await applySkuBenefits(paidOrder);
      await recordCommercialDomainFacts(paidOrder);
      await store.recordAudit({
        ...scope,
        actorId: input.userId,
        type: 'commercial.order.paid',
        metadata: {
          orderId: paidOrder.id,
          provider: input.provider,
          providerRef: input.providerRef,
          sku: paidOrder.sku,
        },
      });
      await publishOrderStatusEvent({
        order: paidOrder,
        previousStatus,
        reason: 'provider.checkout.paid',
        provider: input.provider,
        providerRef: input.providerRef,
      });
      return { order: paidOrder, ...benefits };
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
      const amount = input.amount ?? order.amount;
      assertPositiveIntegerAmount(amount, 'refund.amount');
      const currency = input.currency ?? order.currency;
      if (currency !== order.currency) {
        throw new Error(`MODULE_COMMERCIAL_REFUND_CURRENCY_MISMATCH: ${currency}`);
      }
      if (!['paid', 'refunded'].includes(order.status)) {
        throw new Error(`MODULE_COMMERCIAL_REFUND_ORDER_NOT_PAID: ${order.id}`);
      }
      const reason = input.reason ?? 'provider.refund';
      const existingCreditNotes = await store.listCreditNotes({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        orderId: order.id,
      });
      const duplicateCreditNote = existingCreditNotes.find(
        (note) =>
          note.status === 'issued' &&
          note.provider === input.provider &&
          note.providerRef === input.providerRef
      );
      if (duplicateCreditNote) {
        if (order.status === 'refunded') {
          await publishOrderStatusEvent({
            order,
            previousStatus: 'paid',
            reason: 'provider.refund.full',
            provider: input.provider,
            providerRef: input.providerRef,
            refund: {
              creditNoteId: duplicateCreditNote.id,
              amount: duplicateCreditNote.amount,
              currency: duplicateCreditNote.currency,
              reason: duplicateCreditNote.reason,
            },
          });
        }
        return {
          order,
          creditNote: duplicateCreditNote,
          credits: [],
          revokedEntitlements: [],
        };
      }
      const refundedTotal =
        existingCreditNotes
          .filter((note) => note.status === 'issued' && note.currency === currency)
          .reduce((sum, note) => sum + note.amount, 0) + amount;
      if (refundedTotal > order.amount) {
        throw new Error(`MODULE_COMMERCIAL_REFUND_EXCEEDS_ORDER: ${order.id}`);
      }
      const fullyRefunded = refundedTotal >= order.amount;
      const previousStatus = order.status;
      const refundedOrder = await store.updateCommercialOrderStatus(
        order.id,
        fullyRefunded ? 'refunded' : 'paid',
        {
          provider: input.provider,
          providerRef: input.providerRef,
          refundAmount: amount,
          refundCurrency: currency,
          refundReason: reason,
          ...(input.metadata ?? {}),
        }
      );
      const creditNote = await recordRefundDomainFacts({
        order: refundedOrder,
        amount,
        currency,
        provider: input.provider,
        providerRef: input.providerRef,
        reason,
        metadata: input.metadata,
      });
      const reversed = fullyRefunded
        ? await reverseOrderBenefits(refundedOrder, amount, creditNote.id)
        : { credits: [], revokedEntitlements: [] };
      await store.recordAudit({
        ...scope,
        actorId: refundedOrder.userId,
        type: 'commercial.order.refunded',
        metadata: {
          orderId: refundedOrder.id,
          creditNoteId: creditNote.id,
          provider: input.provider,
          providerRef: input.providerRef,
          amount,
          currency,
          reason,
        },
      });
      if (fullyRefunded) {
        await publishOrderStatusEvent({
          order: refundedOrder,
          previousStatus,
          reason: 'provider.refund.full',
          provider: input.provider,
          providerRef: input.providerRef,
          refund: {
            creditNoteId: creditNote.id,
            amount,
            currency,
            reason,
          },
        });
      }
      return {
        order: refundedOrder,
        creditNote,
        credits: reversed.credits,
        revokedEntitlements: reversed.revokedEntitlements,
      };
    },
    async reconcileOrders(providerOrders) {
      const discrepancies: CommercialReconcileResult['discrepancies'] = [];
      for (const providerOrder of providerOrders) {
        const local = await store.findCommercialOrderByProviderRef(
          scope.productId,
          scope.workspaceId,
          providerOrder.provider,
          providerOrder.providerRef
        );
        if (!local) {
          discrepancies.push({
            provider: providerOrder.provider,
            providerRef: providerOrder.providerRef,
            reason: 'missing-local-order',
            providerStatus: providerOrder.status,
          });
          continue;
        }
        if (local.status !== providerOrder.status) {
          discrepancies.push({
            provider: providerOrder.provider,
            providerRef: providerOrder.providerRef,
            reason: 'status-mismatch',
            localStatus: local.status,
            providerStatus: providerOrder.status,
          });
        }
      }
      return { checked: providerOrders.length, discrepancies };
    },
    async reconcilePaidOrderBenefits(query = {}) {
      const orders = await store.listCommercialOrders({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        userId: query.userId,
        status: 'paid',
      });
      const missing: CommercialBenefitReconcileResult['missing'] = [];
      let repaired = 0;

      for (const order of orders) {
        const expected = await expectedMissingBenefits(order);
        if (expected.missingCredits <= 0 && expected.missingEntitlements.length === 0) {
          continue;
        }
        missing.push({
          orderId: order.id,
          userId: order.userId,
          sku: order.sku,
          missingCredits: expected.missingCredits,
          missingEntitlements: expected.missingEntitlements,
        });
        await applySkuBenefits(order);
        repaired += 1;
      }

      if (repaired > 0) {
        await store.recordAudit({
          ...scope,
          actorId: 'system',
          type: 'commercial.reconcile.benefits_repaired',
          metadata: { repaired, checked: orders.length, missing },
        });
      }

      return { checked: orders.length, repaired, missing };
    },
    async recordSubscriptionEvent(input) {
      const status = subscriptionStatusForEvent(input.type, input.status);
      const subscriptionId =
        input.subscriptionId ??
        `${scope.productId}:${scope.workspaceId ?? ''}:${input.userId}:${input.planId}`;
      const effectiveAt = input.effectiveAt ?? new Date().toISOString();
      const currentSubscription = await findCurrentSubscription({
        id: subscriptionId,
        userId: input.userId,
        planId: input.planId,
      });
      const lastEventAt = subscriptionLastEventAt(currentSubscription);
      const effectiveAtMillis = timestampToMillis(effectiveAt) ?? now().getTime();
      const stale = lastEventAt !== null && effectiveAtMillis < lastEventAt;
      const nextMetadata = {
        ...(currentSubscription?.metadata ?? {}),
        ...(input.metadata ?? {}),
        lastEventAt: effectiveAt,
        lastEventType: input.type,
        lastEventStatus: status,
        lastEventProvider: input.provider ?? null,
        lastEventProviderRef: input.providerRef ?? null,
        lastEventIdempotencyKey: input.idempotencyKey ?? null,
      };
      const subscription =
        stale && currentSubscription
          ? currentSubscription
          : await store.upsertSubscription({
              ...scope,
              id: subscriptionId,
              userId: input.userId,
              planId: input.planId,
              status,
              provider: input.provider ?? null,
              providerRef: input.providerRef ?? null,
              currentPeriodStart:
                input.currentPeriodStart ?? currentSubscription?.currentPeriodStart ?? effectiveAt,
              currentPeriodEnd:
                input.currentPeriodEnd ?? currentSubscription?.currentPeriodEnd ?? null,
              trialEnd: input.trialEnd ?? currentSubscription?.trialEnd ?? null,
              cancelAtPeriodEnd:
                input.cancelAtPeriodEnd ??
                (status === 'canceled' ? true : (currentSubscription?.cancelAtPeriodEnd ?? false)),
              renewalStrategy: input.provider ? 'provider' : 'manual',
              metadata: nextMetadata,
            });
      if (!stale) {
        await syncSubscriptionEntitlements({
          subscription,
          status,
          provider: input.provider ?? null,
          providerRef: input.providerRef ?? null,
          eventIdempotencyKey: input.idempotencyKey,
        });
      }
      const event = await store.createSubscriptionEvent({
        ...scope,
        userId: input.userId,
        subscriptionId,
        planId: input.planId,
        type: input.type,
        status,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        idempotencyKey: input.idempotencyKey,
        effectiveAt,
        metadata: {
          ...(input.metadata ?? {}),
          stale,
        },
      });
      await store.recordAudit({
        ...scope,
        actorId: input.userId,
        type: `commercial.subscription.${input.type}`,
        metadata: {
          subscriptionId,
          planId: input.planId,
          status,
          provider: input.provider,
          providerRef: input.providerRef,
          stale,
        },
      });
      return event;
    },
    async recordSettlement(input) {
      const fee = input.fee ?? 0;
      const [invoices, creditNotes] = await Promise.all([
        store.listInvoices({
          productId: scope.productId,
          workspaceId: scope.workspaceId,
        }),
        store.listCreditNotes({
          productId: scope.productId,
          workspaceId: scope.workspaceId,
        }),
      ]);
      const providerInvoices = invoices.filter(
        (invoice) =>
          invoice.provider === input.provider &&
          invoice.currency === input.currency &&
          isRevenueInvoice(invoice) &&
          isWithinPeriod(invoice.paidAt!, input.periodStart, input.periodEnd)
      );
      const providerCreditNotes = creditNotes.filter(
        (note) =>
          note.provider === input.provider &&
          note.currency === input.currency &&
          note.status === 'issued' &&
          isWithinPeriod(note.issuedAt, input.periodStart, input.periodEnd)
      );
      const gross = providerInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
      const refund = providerCreditNotes.reduce((sum, note) => sum + note.amount, 0);
      const orderCount = new Set(providerInvoices.map((invoice) => invoice.orderId ?? invoice.id))
        .size;
      const batch = await store.upsertSettlementBatch({
        ...scope,
        provider: input.provider,
        currency: input.currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? 'closed',
        gross,
        refund,
        fee,
        net: gross - refund - fee,
        orderCount,
        invoiceCount: providerInvoices.length,
        creditNoteCount: providerCreditNotes.length,
        metadata: input.metadata,
      });
      await store.recordAudit({
        ...scope,
        actorId: 'system',
        type: 'commercial.settlement.recorded',
        metadata: {
          settlementBatchId: batch.id,
          provider: input.provider,
          currency: input.currency,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          gross,
          refund,
          fee,
          net: batch.net,
        },
      });
      return batch;
    },
  };
}
