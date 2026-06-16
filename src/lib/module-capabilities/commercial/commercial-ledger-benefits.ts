import type { ModuleBillingPlan } from '@ploykit/module-sdk';
import type {
  RuntimeStore,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreEntitlementGrant,
} from '../../module-runtime/stores';
import { assertPositive, isExpired, uniqueEntitlements } from './commercial-ledger-utils';
import type { CommercialSkuDefinition } from './commercial-ledger-types';

interface CreateCommercialLedgerBenefitsInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  planCatalog: readonly ModuleBillingPlan[];
  skuCatalog: Record<string, CommercialSkuDefinition>;
  now: () => Date;
}

export function createCommercialLedgerBenefits({
  store,
  scope,
  planCatalog,
  skuCatalog,
  now,
}: CreateCommercialLedgerBenefitsInput): {
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
} {
  async function applySkuBenefits(order: RuntimeStoreCommercialOrder): Promise<{
    credits: RuntimeStoreCreditLedgerEntry[];
    entitlements: RuntimeStoreEntitlementGrant[];
  }> {
    const sku = skuCatalog[order.sku];
    const credits: RuntimeStoreCreditLedgerEntry[] = [];
    const entitlements: RuntimeStoreEntitlementGrant[] = [];

    if (sku?.credits) {
      assertPositive(sku.credits.amount, 'order.credits');
      credits.push(
        await store.recordCreditLedger({
          ...scope,
          userId: order.userId,
          amount: sku.credits.amount,
          unit: sku.credits.unit ?? 'credit',
          reason: 'order.paid',
          idempotencyKey: `order:${order.id}:credits:${sku.credits.unit ?? 'credit'}`,
          metadata: { orderId: order.id, sku: order.sku, ...(sku.metadata ?? {}) },
        })
      );
    }

    for (const entitlement of uniqueEntitlements(sku, planCatalog)) {
      entitlements.push(
        await store.grantEntitlement({
          ...scope,
          userId: order.userId,
          entitlement,
          planId: sku?.planId,
          source: 'order',
          idempotencyKey: `order:${order.id}:entitlement:${entitlement}`,
          metadata: { orderId: order.id, sku: order.sku, ...(sku?.metadata ?? {}) },
        })
      );
    }

    return { credits, entitlements };
  }

  async function reverseOrderBenefits(
    order: RuntimeStoreCommercialOrder,
    refundAmount: number,
    creditNoteId: string
  ): Promise<{
    credits: RuntimeStoreCreditLedgerEntry[];
    revokedEntitlements: RuntimeStoreEntitlementGrant[];
  }> {
    const sku = skuCatalog[order.sku];
    const credits: RuntimeStoreCreditLedgerEntry[] = [];
    const revokedEntitlements: RuntimeStoreEntitlementGrant[] = [];

    if (sku?.credits) {
      assertPositive(sku.credits.amount, 'refund.credits');
      credits.push(
        await store.recordCreditLedger({
          ...scope,
          userId: order.userId,
          amount: -sku.credits.amount,
          unit: sku.credits.unit ?? 'credit',
          reason: 'order.refunded',
          idempotencyKey: `refund:${order.id}:credits:${sku.credits.unit ?? 'credit'}`,
          metadata: {
            orderId: order.id,
            sku: order.sku,
            refundAmount,
            creditNoteId,
            ...(sku.metadata ?? {}),
          },
        })
      );
    }

    const grants = await store.listEntitlements({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: order.userId,
      status: 'active',
    });
    for (const grant of grants) {
      const metadata = grant.metadata as { orderId?: unknown };
      if (
        metadata.orderId === order.id ||
        grant.idempotencyKey?.startsWith(`order:${order.id}:entitlement:`)
      ) {
        revokedEntitlements.push(
          await store.revokeEntitlement(grant.id, {
            orderId: order.id,
            creditNoteId,
            reason: 'order.refunded',
          })
        );
      }
    }

    return { credits, revokedEntitlements };
  }

  async function expectedMissingBenefits(order: RuntimeStoreCommercialOrder): Promise<{
    missingCredits: number;
    missingEntitlements: string[];
  }> {
    const sku = skuCatalog[order.sku];
    const missingEntitlements: string[] = [];
    let missingCredits = 0;

    if (sku?.credits) {
      const unit = sku.credits.unit ?? 'credit';
      const ledger = await store.listCreditLedger({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        userId: order.userId,
        unit,
        status: 'available',
      });
      const hasOrderCredit = ledger.some((entry) => {
        const metadata = entry.metadata as { orderId?: unknown };
        return (
          entry.amount === sku.credits?.amount &&
          (entry.idempotencyKey === `order:${order.id}:credits:${unit}` ||
            metadata.orderId === order.id)
        );
      });
      missingCredits = hasOrderCredit ? 0 : sku.credits.amount;
    }

    const expectedEntitlements = uniqueEntitlements(sku, planCatalog);
    if (expectedEntitlements.length > 0) {
      const grants = await store.listEntitlements({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        userId: order.userId,
        status: 'active',
      });
      for (const entitlement of expectedEntitlements) {
        const hasGrant = grants.some((grant) => {
          const metadata = grant.metadata as { orderId?: unknown };
          return (
            grant.entitlement === entitlement &&
            !isExpired(grant.expiresAt, now) &&
            (grant.idempotencyKey === `order:${order.id}:entitlement:${entitlement}` ||
              metadata.orderId === order.id)
          );
        });
        if (!hasGrant) {
          missingEntitlements.push(entitlement);
        }
      }
    }

    return { missingCredits, missingEntitlements };
  }

  return { applySkuBenefits, reverseOrderBenefits, expectedMissingBenefits };
}
