import type {
  HostCommercialOrderStatusEventPayload,
  HostCommercialOrderStatusEventReason,
  ModuleBillingApi,
  ModuleBillingPlan,
  ModuleCommerceApi,
  ModuleCommercialRequirement,
  ModuleCreditsApi,
  ModuleCreditsBalance,
  ModuleEntitlementsApi,
  ModuleMeteringApi,
  ModuleRedeemCodesApi,
  ModuleRiskApi,
  ModuleUsageApi,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';
import type {
  RuntimeStore,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialCatalogKind,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
  RuntimeStoreRedeemCode,
  RuntimeStoreRevenueBucket,
  RuntimeStoreSettlementBatch,
  RuntimeStoreSubscriptionEventRecord,
  RuntimeStoreSubscriptionEventType,
  RuntimeStoreSubscriptionStatus,
  RuntimeStoreTaxProfileRecord,
} from '../../module-runtime/stores';

export interface CommercialSkuDefinition {
  credits?: {
    amount: number;
    unit?: string;
  };
  entitlement?: string;
  entitlements?: readonly string[];
  planId?: string;
  metadata?: Record<string, unknown>;
}

export type CommercialOrderStatusEventReason = HostCommercialOrderStatusEventReason;

export type CommercialOrderStatusEventPayload = HostCommercialOrderStatusEventPayload;

export interface CommercialOrderEventPublisher {
  publish<TPayload = unknown>(input: {
    name: string;
    payload: TPayload;
    correlationId?: string;
    causationId?: string;
    idempotencyKey?: string;
    maxAttempts?: number;
  }): Promise<unknown>;
}

export interface CreateRuntimeStoreCommercialRuntimeOptions {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
  planCatalog?: readonly ModuleBillingPlan[];
  skuCatalog?: Record<string, CommercialSkuDefinition>;
  events?: CommercialOrderEventPublisher;
  now?: () => Date;
}

export interface CommercialAdminSessionInput {
  session: ModuleRuntimeAccessSession;
}

export interface CommercialProviderPaidInput {
  provider: string;
  providerRef: string;
  orderId?: string;
  userId: string;
  sku: string;
  amount: number;
  currency: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface CommercialProviderRefundInput {
  provider: string;
  providerRef: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface CommercialProviderOrderState {
  provider: string;
  providerRef: string;
  status: RuntimeStoreCommercialOrderStatus;
}

export interface CommercialSettlementInput {
  provider: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  fee?: number;
  status?: 'draft' | 'closed' | 'reconciled';
  metadata?: Record<string, unknown>;
}

export interface CommercialSubscriptionEventInput {
  userId: string;
  subscriptionId?: string;
  planId: string;
  type: RuntimeStoreSubscriptionEventType;
  status?: RuntimeStoreSubscriptionStatus;
  provider?: string | null;
  providerRef?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  effectiveAt?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface CommercialReconcileResult {
  checked: number;
  discrepancies: {
    provider: string;
    providerRef: string;
    reason: 'missing-local-order' | 'status-mismatch';
    localStatus?: RuntimeStoreCommercialOrderStatus;
    providerStatus?: RuntimeStoreCommercialOrderStatus;
  }[];
}

export interface CommercialBenefitReconcileResult {
  checked: number;
  repaired: number;
  missing: {
    orderId: string;
    userId: string;
    sku: string;
    missingCredits: number;
    missingEntitlements: string[];
  }[];
}

export interface CommercialGuardResult {
  ok: boolean;
  code?: 'entitlement-denied' | 'plan-denied' | 'credits-denied';
  message?: string;
}

export interface RuntimeStoreCommercialRuntime {
  forModule(moduleId: string): {
    usage: ModuleUsageApi;
    metering: ModuleMeteringApi;
    credits: ModuleCreditsApi;
    billing: ModuleBillingApi;
    entitlements: ModuleEntitlementsApi;
    commerce: ModuleCommerceApi;
    redeemCodes: ModuleRedeemCodesApi;
    risk: ModuleRiskApi;
  };
  admin: {
    grantCredits(
      input: CommercialAdminSessionInput & {
        userId: string;
        amount: number;
        unit?: string;
        reason?: string;
        idempotencyKey?: string;
        expiresAt?: string;
        metadata?: Record<string, unknown>;
      }
    ): Promise<ModuleCreditsBalance>;
    adjustCredits(
      input: CommercialAdminSessionInput & {
        userId: string;
        amount: number;
        unit?: string;
        idempotencyKey?: string;
        metadata?: Record<string, unknown>;
      }
    ): Promise<ModuleCreditsBalance>;
    grantEntitlement(
      input: CommercialAdminSessionInput & {
        userId: string;
        entitlement: string;
        planId?: string;
        expiresAt?: string;
        idempotencyKey?: string;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreEntitlementGrant>;
    revokeEntitlement(
      input: CommercialAdminSessionInput & {
        entitlementId: string;
        reason?: string;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreEntitlementGrant>;
    overrideEntitlement(
      input: CommercialAdminSessionInput & {
        entitlementId: string;
        status: RuntimeStoreEntitlementStatus;
        expiresAt?: string | null;
        reason?: string;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreEntitlementGrant>;
    createRedeemCode(
      input: CommercialAdminSessionInput & {
        code: string;
        entitlement?: string;
        creditsAmount?: number;
        creditsUnit?: string;
        maxRedemptions: number;
        expiresAt?: string;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreRedeemCode>;
    listOrders(query?: {
      userId?: string;
      status?: RuntimeStoreCommercialOrderStatus;
    }): Promise<RuntimeStoreCommercialOrder[]>;
    listCreditLedger(query?: {
      userId?: string;
      unit?: string;
    }): Promise<RuntimeStoreCreditLedgerEntry[]>;
    reconcileCredits(
      userId: string,
      unit?: string
    ): Promise<{
      userId: string;
      unit: string;
      balance: number;
      ledgerBalance: number;
      ok: boolean;
    }>;
    validateTaxProfile(
      input: CommercialAdminSessionInput & {
        userId: string;
        jurisdiction: string;
        profile?: Record<string, unknown>;
        evidence?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreTaxProfileRecord>;
    upsertCatalogDraft<TValue = unknown>(
      input: CommercialAdminSessionInput & {
        kind: RuntimeStoreCommercialCatalogKind;
        itemId: string;
        value: TValue;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreCommercialCatalogItem<TValue>>;
    publishCatalogItem<TValue = unknown>(
      input: CommercialAdminSessionInput & {
        kind: RuntimeStoreCommercialCatalogKind;
        itemId: string;
        version?: number;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreCommercialCatalogItem<TValue>>;
    rollbackCatalogItem<TValue = unknown>(
      input: CommercialAdminSessionInput & {
        kind: RuntimeStoreCommercialCatalogKind;
        itemId: string;
        toVersion: number;
        metadata?: Record<string, unknown>;
      }
    ): Promise<RuntimeStoreCommercialCatalogItem<TValue>>;
    listRevenueBuckets(query?: {
      from?: string;
      to?: string;
      currency?: string;
    }): Promise<RuntimeStoreRevenueBucket[]>;
  };
  provider: {
    applyCheckoutPaid(input: CommercialProviderPaidInput): Promise<{
      order: RuntimeStoreCommercialOrder;
      credits: RuntimeStoreCreditLedgerEntry[];
      entitlements: RuntimeStoreEntitlementGrant[];
    }>;
    applyRefund(input: CommercialProviderRefundInput): Promise<{
      order: RuntimeStoreCommercialOrder;
      creditNote: RuntimeStoreCreditNoteRecord;
      credits: RuntimeStoreCreditLedgerEntry[];
      revokedEntitlements: RuntimeStoreEntitlementGrant[];
    }>;
    reconcileOrders(
      providerOrders: CommercialProviderOrderState[]
    ): Promise<CommercialReconcileResult>;
    reconcilePaidOrderBenefits(query?: {
      userId?: string;
    }): Promise<CommercialBenefitReconcileResult>;
    recordSettlement(input: CommercialSettlementInput): Promise<RuntimeStoreSettlementBatch>;
    recordSubscriptionEvent(
      input: CommercialSubscriptionEventInput
    ): Promise<RuntimeStoreSubscriptionEventRecord>;
  };
}

export type RuntimeStoreCommercialRequirementCheckInput = {
  commercial?: ModuleCommercialRequirement;
  userId: string;
  billing: ModuleBillingApi;
  credits: ModuleCreditsApi;
};
