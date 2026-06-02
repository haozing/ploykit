import {
  type CommercialSubject,
  HOST_COMMERCIAL_ORDER_STATUS_EVENT_NAME,
  type HostCommercialOrderStatusEventPayload,
  type HostCommercialOrderStatusEventReason,
  ModuleBillingApi,
  ModuleBillingPlan,
  ModuleCommerceApi,
  ModuleCommerceCheckout,
  ModuleCommercialRequirement,
  ModuleCreditsApi,
  ModuleCreditsBalance,
  ModuleCreditsLedgerEntry,
  ModuleCreditsReservation,
  ModuleEntitlementGrant,
  ModuleEntitlementsApi,
  ModuleMeteringApi,
  ModuleMeteringAuthorization,
  ModuleRedeemCodeRecord,
  ModuleRedeemCodeRedemption,
  ModuleRedeemCodesApi,
  ModuleRiskApi,
  ModuleUsageApi,
  ModuleUsageRecord,
} from '@ploykit/module-sdk';
import { randomUUID } from 'node:crypto';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';
import type {
  RuntimeStore,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialCatalogKind,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
  RuntimeStoreInvoiceRecord,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
  RuntimeStoreRevenueBucket,
  RuntimeStoreSettlementBatch,
  RuntimeStoreSubscriptionEventRecord,
  RuntimeStoreSubscriptionEventType,
  RuntimeStoreSubscriptionRecord,
  RuntimeStoreSubscriptionStatus,
  RuntimeStoreTaxProfileRecord,
} from '../../module-runtime/stores';
import {
  aggregateProvider,
  assertAdmin,
  assertNonNegative,
  assertPositive,
  bucketDate,
  createInvoiceTaxSnapshot,
  hashRedeemCode,
  isExpired,
  isRevenueInvoice,
  isWithinPeriod,
  maskRedeemCode,
  metadataObject,
  metadataRecord,
  normalizeJurisdiction,
  orderInvoiceNumber,
  redeemAttemptEmailMetadata,
  redeemBindStatus,
  redeemRedemptionMetadata,
  sameSubject,
  subjectFromCommercialInput,
  subjectFromMetadata,
  subjectFromStoredUserId,
  subjectToStoredUserId,
  subscriptionStatusForEvent,
  taxValidationStatus,
  timestampToMillis,
  toCheckout,
  toCreditBalance,
  toCreditLedgerEntry,
  toCreditsReservation,
  toEntitlementGrant,
  toMeteringAuthorization,
  toRedeemCodeRecord,
  toRedeemCodeRedemption,
  toUsageRecord,
  uniqueEntitlements,
  userSubject,
} from './commercial-ledger-utils';
export { normalizeRuntimeStoreEntitlementGrant } from './commercial-ledger-utils';

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

export const COMMERCIAL_ORDER_STATUS_EVENT_NAME = HOST_COMMERCIAL_ORDER_STATUS_EVENT_NAME;

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

export async function checkRuntimeStoreCommercialRequirement(input: {
  commercial?: ModuleCommercialRequirement;
  userId: string;
  billing: ModuleBillingApi;
  credits: ModuleCreditsApi;
}): Promise<CommercialGuardResult> {
  const commercial = input.commercial;
  if (!commercial) {
    return { ok: true };
  }

  for (const entitlement of commercial.entitlements ?? []) {
    if (!(await input.billing.hasEntitlement(input.userId, entitlement))) {
      return {
        ok: false,
        code: 'entitlement-denied',
        message: 'Required entitlement is missing.',
      };
    }
  }

  const requiredPlans = commercial.plans ?? [];
  if (requiredPlans.length > 0) {
    const plan = await input.billing.getPlan(input.userId);
    if (!plan || !requiredPlans.includes(plan.id)) {
      return { ok: false, code: 'plan-denied', message: 'Required plan is missing.' };
    }
  }

  if (commercial.credits) {
    const balance = await input.credits.balance(input.userId, commercial.credits.unit);
    if (balance.balance < commercial.credits.amount) {
      return { ok: false, code: 'credits-denied', message: 'Not enough credits.' };
    }
  }

  return { ok: true };
}

export function createRuntimeStoreCommercialRuntime(
  options: CreateRuntimeStoreCommercialRuntimeOptions
): RuntimeStoreCommercialRuntime {
  const now = options.now ?? (() => new Date());
  const planCatalog = options.planCatalog ?? [];
  const skuCatalog = options.skuCatalog ?? {};
  const scope = {
    productId: options.productId,
    workspaceId: options.workspaceId,
  };

  async function activeEntitlements(
    userId: string,
    entitlement?: string
  ): Promise<RuntimeStoreEntitlementGrant[]> {
    const grants = await options.store.listEntitlements({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId,
      entitlement,
      status: 'active',
    });
    return grants.filter((grant) => !isExpired(grant.expiresAt, now));
  }

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
    const candidates = await options.store.listSubscriptions({
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
    const grants = await options.store.listEntitlements({
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
          await options.store.revokeEntitlement(grant.id, {
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
      await options.store.grantEntitlement({
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

  async function creditBalance(
    input: string | { subject: CommercialSubject; unit?: string },
    unit = 'credit'
  ): Promise<ModuleCreditsBalance> {
    const subject = typeof input === 'string' ? userSubject(input) : input.subject;
    const resolvedUnit = typeof input === 'string' ? unit : (input.unit ?? unit);
    const balance = await options.store.getCreditBalance({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: subjectToStoredUserId(subject),
      unit: resolvedUnit,
    });
    return toCreditBalance(balance);
  }

  async function recordCredit(input: {
    subject?: CommercialSubject;
    userId?: string;
    amount: number;
    unit?: string;
    reason: string;
    source?: string;
    sourceId?: string;
    idempotencyKey?: string;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleCreditsBalance> {
    const subject = subjectFromCommercialInput(input);
    const userId = subjectToStoredUserId(subject);
    await options.store.recordCreditLedger({
      ...scope,
      userId,
      amount: input.amount,
      unit: input.unit ?? 'credit',
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
      metadata: {
        ...(input.metadata ?? {}),
        subject,
        source: input.source,
        sourceId: input.sourceId,
      },
    });
    return creditBalance({ subject, unit: input.unit });
  }

  async function loadInvoiceTaxSnapshot(
    userId: string,
    capturedAt: string
  ): Promise<Record<string, unknown>> {
    const [taxProfile, hostUser] = await Promise.all([
      options.store.getTaxProfile(scope.productId, userId, scope.workspaceId),
      options.store.getHostUser(userId),
    ]);
    return createInvoiceTaxSnapshot({
      taxProfile,
      hostUserMetadata: hostUser?.metadata ?? {},
      capturedAt,
    });
  }

  function orderBelongsToScope(order: RuntimeStoreCommercialOrder): boolean {
    return (
      order.productId === scope.productId &&
      (order.workspaceId ?? null) === (scope.workspaceId ?? null)
    );
  }

  async function getScopedOrder(id: string): Promise<RuntimeStoreCommercialOrder | null> {
    const order = await options.store.getCommercialOrder(id);
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

  async function publishOrderStatusEvent(input: {
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
  }): Promise<void> {
    if (!options.events) {
      return;
    }

    const payload: CommercialOrderStatusEventPayload = {
      orderId: input.order.id,
      productId: scope.productId,
      workspaceId: scope.workspaceId ?? null,
      userId: input.order.userId,
      sku: input.order.sku,
      amount: input.order.amount,
      currency: input.order.currency,
      previousStatus: input.previousStatus,
      status: input.order.status,
      reason: input.reason,
      provider: input.provider,
      providerRef: input.providerRef,
      occurredAt: input.order.updatedAt,
      ...(input.refund
        ? {
            refund: {
              ...input.refund,
              provider: input.provider,
              providerRef: input.providerRef,
            },
          }
        : {}),
    };

    await options.events.publish({
      name: COMMERCIAL_ORDER_STATUS_EVENT_NAME,
      payload,
      correlationId: `commercial-order:${input.order.id}`,
      causationId: input.refund?.creditNoteId ?? input.providerRef,
      idempotencyKey: `${COMMERCIAL_ORDER_STATUS_EVENT_NAME}:${input.order.id}:${input.order.status}`,
      maxAttempts: 5,
    });
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
        await options.store.recordCreditLedger({
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
        await options.store.grantEntitlement({
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

  async function recordCommercialDomainFacts(order: RuntimeStoreCommercialOrder): Promise<void> {
    const sku = skuCatalog[order.sku];
    const existingInvoice = (
      await options.store.listInvoices({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        orderId: order.id,
      })
    )[0];
    const paidAt = existingInvoice?.paidAt ?? (order.status === 'paid' ? order.updatedAt : null);
    const taxSnapshot = existingInvoice
      ? existingInvoice.taxSnapshot
      : await loadInvoiceTaxSnapshot(order.userId, order.updatedAt);
    await options.store.upsertBillingAccount({
      ...scope,
      userId: order.userId,
      providerCustomers:
        order.provider && order.providerRef
          ? { [order.provider]: String(order.metadata.customerId ?? order.providerRef) }
          : {},
      paymentMethods: order.provider
        ? [
            {
              id: `${order.provider}:${order.providerRef ?? order.id}`,
              provider: order.provider,
              type: order.provider === 'local' ? 'local' : 'card',
              label:
                order.provider === 'local' ? 'Local ledger checkout' : `${order.provider} checkout`,
              status: 'active',
              updatedAt: order.updatedAt,
            },
          ]
        : undefined,
      metadata: { lastOrderId: order.id, sku: order.sku },
    });
    if (sku?.planId) {
      await options.store.upsertSubscription({
        ...scope,
        userId: order.userId,
        planId: sku.planId,
        status: order.status === 'paid' ? 'active' : 'past_due',
        provider: order.provider ?? null,
        providerRef: order.providerRef ?? null,
        currentPeriodStart: order.updatedAt,
        renewalStrategy: 'provider',
        metadata: { orderId: order.id, sku: order.sku },
      });
    }
    const invoice = await options.store.upsertInvoice({
      ...scope,
      id: `invoice-${order.id}`,
      userId: order.userId,
      orderId: order.id,
      subscriptionId: sku?.planId
        ? `${scope.productId}:${scope.workspaceId ?? ''}:${order.userId}:${sku.planId}`
        : null,
      number: orderInvoiceNumber(order),
      status: order.status === 'refunded' ? 'refunded' : order.status === 'paid' ? 'paid' : 'open',
      subtotal: order.amount,
      total: order.amount,
      currency: order.currency,
      provider: order.provider ?? null,
      providerRef: order.providerRef ?? null,
      lines: [
        {
          sku: order.sku,
          quantity: 1,
          amount: order.amount,
          currency: order.currency,
          description: sku?.metadata?.product ?? order.sku,
        },
      ],
      taxSnapshot,
      paidAt,
      metadata: { orderId: order.id },
    });
    if (invoice.paidAt) {
      await refreshRevenueBucket(bucketDate(invoice.paidAt), invoice.currency);
    }
  }

  async function refreshRevenueBucket(
    date: string,
    currency: string
  ): Promise<RuntimeStoreRevenueBucket> {
    const [invoices, creditNotes] = await Promise.all([
      options.store.listInvoices({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
      }),
      options.store.listCreditNotes({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
      }),
    ]);
    const bucketInvoices = invoices.filter(
      (invoice) =>
        invoice.currency === currency &&
        isRevenueInvoice(invoice) &&
        bucketDate(invoice.paidAt!) === date
    );
    const bucketCreditNotes = creditNotes.filter(
      (note) =>
        note.currency === currency && note.status === 'issued' && bucketDate(note.issuedAt) === date
    );
    const gross = bucketInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const discount = bucketInvoices.reduce((sum, invoice) => sum + invoice.discount, 0);
    const tax = bucketInvoices.reduce((sum, invoice) => sum + invoice.tax, 0);
    const refund = bucketCreditNotes.reduce((sum, note) => sum + note.amount, 0);
    const fee = bucketInvoices.reduce((sum, invoice) => sum + invoice.fee, 0);
    const orders = new Set(bucketInvoices.map((invoice) => invoice.orderId ?? invoice.id)).size;
    return options.store.upsertRevenueBucket({
      ...scope,
      bucketDate: date,
      currency,
      gross,
      discount,
      tax,
      refund,
      fee,
      net: gross - refund - fee,
      orders,
      provider: aggregateProvider([
        ...bucketInvoices.map((invoice) => invoice.provider),
        ...bucketCreditNotes.map((note) => note.provider),
      ]),
      metadata: {
        source: 'commercial-ledger',
        invoiceCount: bucketInvoices.length,
        creditNoteCount: bucketCreditNotes.length,
      },
    });
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
        await options.store.recordCreditLedger({
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

    const grants = await options.store.listEntitlements({
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
          await options.store.revokeEntitlement(grant.id, {
            orderId: order.id,
            creditNoteId,
            reason: 'order.refunded',
          })
        );
      }
    }

    return { credits, revokedEntitlements };
  }

  async function recordRefundDomainFacts(input: {
    order: RuntimeStoreCommercialOrder;
    amount: number;
    currency: string;
    provider: string;
    providerRef: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreCreditNoteRecord> {
    const invoice = (
      await options.store.listInvoices({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        orderId: input.order.id,
      })
    )[0];
    const baseInvoice = await options.store.upsertInvoice({
      ...scope,
      id: invoice?.id ?? `invoice-${input.order.id}`,
      userId: input.order.userId,
      orderId: input.order.id,
      subscriptionId: invoice?.subscriptionId ?? null,
      number: invoice?.number,
      status: invoice?.status ?? 'paid',
      subtotal: invoice?.subtotal ?? input.order.amount,
      discount: invoice?.discount ?? 0,
      tax: invoice?.tax ?? 0,
      total: invoice?.total ?? input.order.amount,
      refunded: invoice?.refunded ?? 0,
      fee: invoice?.fee ?? 0,
      net:
        invoice?.net ??
        (invoice?.total ?? input.order.amount) - (invoice?.refunded ?? 0) - (invoice?.fee ?? 0),
      currency: input.currency,
      provider: invoice?.provider ?? input.provider,
      providerRef: invoice?.providerRef ?? input.providerRef,
      taxSnapshot: invoice?.taxSnapshot ?? {},
      lines: invoice?.lines ?? [
        {
          sku: input.order.sku,
          quantity: 1,
          amount: input.order.amount,
          currency: input.currency,
        },
      ],
      paidAt: invoice?.paidAt ?? input.order.updatedAt,
      metadata: {
        orderId: input.order.id,
      },
    });
    const creditNote = await options.store.createCreditNote({
      ...scope,
      userId: input.order.userId,
      orderId: input.order.id,
      invoiceId: baseInvoice.id,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      provider: input.provider,
      providerRef: input.providerRef,
      lines: [
        {
          sku: input.order.sku,
          amount: input.amount,
          currency: input.currency,
        },
      ],
      metadata: {
        orderId: input.order.id,
        invoiceId: baseInvoice.id,
        ...(input.metadata ?? {}),
      },
    });
    const issuedCreditNotes = await options.store.listCreditNotes({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      orderId: input.order.id,
      status: 'issued',
    });
    const refunded = issuedCreditNotes
      .filter((note) => note.currency === input.currency)
      .reduce((sum, note) => sum + note.amount, 0);
    const updatedInvoice = await options.store.upsertInvoice({
      ...scope,
      id: baseInvoice.id,
      userId: input.order.userId,
      orderId: input.order.id,
      subscriptionId: baseInvoice.subscriptionId ?? null,
      number: baseInvoice.number,
      status: refunded >= baseInvoice.total ? 'refunded' : 'paid',
      subtotal: baseInvoice.subtotal,
      discount: baseInvoice.discount,
      tax: baseInvoice.tax,
      total: baseInvoice.total,
      refunded,
      fee: baseInvoice.fee,
      net: baseInvoice.total - refunded - baseInvoice.fee,
      currency: baseInvoice.currency,
      provider: input.provider,
      providerRef: input.providerRef,
      taxSnapshot: baseInvoice.taxSnapshot,
      lines: baseInvoice.lines,
      paidAt: baseInvoice.paidAt ?? input.order.updatedAt,
      metadata: {
        refundedBy: input.provider,
        refundProviderRef: input.providerRef,
        refundReason: input.reason,
      },
    });
    const paidDate = updatedInvoice.paidAt ? bucketDate(updatedInvoice.paidAt) : null;
    const refundDate = bucketDate(creditNote.issuedAt);
    if (paidDate) {
      await refreshRevenueBucket(paidDate, updatedInvoice.currency);
    }
    if (paidDate !== refundDate) {
      await refreshRevenueBucket(refundDate, creditNote.currency);
    }
    return creditNote;
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
      const ledger = await options.store.listCreditLedger({
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
      const grants = await options.store.listEntitlements({
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

  async function redeemCodeForSubject(input: {
    code: string;
    subject: CommercialSubject;
    email?: string;
  }): Promise<{ ok: boolean; entitlement?: string; reason?: string }> {
    const codeHash = hashRedeemCode(input.code);
    const userId = subjectToStoredUserId(input.subject);
    const redeemCodeRecord = await options.store.getRedeemCode(scope.productId, codeHash);
    const status =
      typeof redeemCodeRecord?.metadata.status === 'string'
        ? redeemCodeRecord.metadata.status
        : 'active';
    if (!redeemCodeRecord || status !== 'active' || isExpired(redeemCodeRecord.expiresAt, now)) {
      return { ok: false, reason: 'invalid_or_unavailable' };
    }

    const bindStatus = redeemBindStatus(redeemCodeRecord.metadata.bind, {
      subject: input.subject,
      email: input.email,
    });
    if (!bindStatus.ok) {
      return bindStatus;
    }

    const existingForUser = await options.store.listRedeemRedemptions({
      productId: scope.productId,
      code: codeHash,
      userId,
    });
    const redemptions = await options.store.listRedeemRedemptions({
      productId: scope.productId,
      code: codeHash,
    });
    if (existingForUser.length === 0 && redemptions.length >= redeemCodeRecord.maxRedemptions) {
      return { ok: false, reason: 'redemption_limit_exceeded' };
    }

    const idempotencyKey = `redeem:${codeHash}:${userId}`;
    await options.store.recordRedeemRedemption({
      ...scope,
      code: codeHash,
      userId,
      entitlement: redeemCodeRecord.entitlement,
      creditsAmount: redeemCodeRecord.creditsAmount,
      creditsUnit: redeemCodeRecord.creditsUnit,
      idempotencyKey,
      metadata: redeemRedemptionMetadata(redeemCodeRecord.metadata),
    });

    if (redeemCodeRecord.entitlement) {
      await options.store.grantEntitlement({
        ...scope,
        userId,
        entitlement: redeemCodeRecord.entitlement,
        source: 'redeem',
        idempotencyKey,
        metadata: { codeHash, maskedCode: redeemCodeRecord.metadata.maskedCode },
      });
    }
    if (redeemCodeRecord.creditsAmount) {
      await options.store.recordCreditLedger({
        ...scope,
        userId,
        amount: redeemCodeRecord.creditsAmount,
        unit: redeemCodeRecord.creditsUnit,
        reason: 'redeem',
        idempotencyKey,
        expiresAt: redeemCodeRecord.expiresAt,
        metadata: { codeHash, maskedCode: redeemCodeRecord.metadata.maskedCode },
      });
    }

    return { ok: true, entitlement: redeemCodeRecord.entitlement };
  }

  async function redeemCode(
    code: string,
    userId: string
  ): Promise<{ ok: boolean; entitlement?: string }> {
    const result = await redeemCodeForSubject({
      code,
      subject: subjectFromStoredUserId(userId),
    });
    return { ok: result.ok, entitlement: result.entitlement };
  }

  return {
    forModule(moduleId: string) {
      const recordUsage: ModuleUsageApi['record'] = async (input) => {
        const record = await options.store.recordUsage({
          ...scope,
          moduleId,
          meter: input.meter,
          quantity: input.quantity,
          unit: input.unit,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        });
        return toUsageRecord(record);
      };
      const usage: ModuleUsageApi = {
        record: recordUsage,
        increment: recordUsage,
      };

      const metering: ModuleMeteringApi = {
        async authorize(input) {
          const record = await options.store.recordMetering({
            ...scope,
            moduleId,
            meter: input.meter,
            quantity: input.quantity,
            unit: input.unit,
            idempotencyKey: input.idempotencyKey,
          });
          return toMeteringAuthorization(record);
        },
        async commit(id) {
          return toMeteringAuthorization(await options.store.updateMeteringStatus(id, 'committed'));
        },
        async refund(id) {
          return toMeteringAuthorization(await options.store.updateMeteringStatus(id, 'refunded'));
        },
        async void(id) {
          return toMeteringAuthorization(await options.store.updateMeteringStatus(id, 'voided'));
        },
        async reconcile() {
          return {
            checked: (await options.store.listMetering({ productId: scope.productId })).length,
          };
        },
        async charge(input) {
          const quantity = input.quantity ?? 1;
          assertPositive(quantity, 'metering.charge.quantity');
          if (input.credits) {
            assertPositive(input.credits.amount, 'metering.charge.credits');
          }
          if (input.credits && !input.reservationId) {
            const currentBalance = await creditBalance({
              subject: input.subject,
              unit: input.credits.unit,
            });
            if (currentBalance.balance < input.credits.amount) {
              throw new Error('MODULE_CREDITS_INSUFFICIENT');
            }
          }
          const usageRecord = await options.store.recordUsage({
            ...scope,
            moduleId,
            meter: input.meter,
            quantity,
            unit: input.unit,
            idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:usage` : undefined,
            metadata: {
              ...(input.metadata ?? {}),
              subject: input.subject,
            },
          });
          const meteringRecord = await options.store.recordMetering({
            ...scope,
            moduleId,
            meter: input.meter,
            quantity,
            unit: input.unit,
            idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:metering` : undefined,
            metadata: {
              ...(input.metadata ?? {}),
              subject: input.subject,
              usageId: usageRecord.id,
            },
          });
          let balance;
          try {
            balance = input.credits
              ? input.reservationId
                ? await credits.commitReservation({
                    reservationId: input.reservationId,
                    finalAmount: input.credits.amount,
                    idempotencyKey: input.idempotencyKey
                      ? `${input.idempotencyKey}:reservation`
                      : undefined,
                    metadata: {
                      ...(input.metadata ?? {}),
                      meter: input.meter,
                      usageId: usageRecord.id,
                      meteringId: meteringRecord.id,
                    },
                  })
                : await credits.consume({
                    subject: input.subject,
                    amount: input.credits.amount,
                    unit: input.credits.unit,
                    reason: 'metering.charge',
                    source: 'metering',
                    sourceId: meteringRecord.id,
                    idempotencyKey: input.idempotencyKey
                      ? `${input.idempotencyKey}:credits`
                      : undefined,
                    metadata: {
                      ...(input.metadata ?? {}),
                      meter: input.meter,
                      usageId: usageRecord.id,
                      meteringId: meteringRecord.id,
                      reservationId: input.reservationId,
                    },
                  })
              : undefined;
          } catch (error) {
            await options.store.updateMeteringStatus(meteringRecord.id, 'voided', {
              chargeFailed: true,
              chargeFailure: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
          await options.store.updateMeteringStatus(meteringRecord.id, 'committed', {
            chargedAt: new Date().toISOString(),
          });
          return {
            id: `charge_${meteringRecord.id}`,
            moduleId,
            subject: input.subject,
            meter: input.meter,
            quantity,
            unit: input.unit,
            credits: input.credits
              ? { amount: input.credits.amount, unit: input.credits.unit ?? 'credit' }
              : undefined,
            usageId: usageRecord.id,
            meteringId: meteringRecord.id,
            balance,
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata ?? {},
            createdAt: usageRecord.createdAt,
          };
        },
      };

      const credits: ModuleCreditsApi = {
        balance: creditBalance,
        async grant(input) {
          assertPositive(input.amount, 'credits.grant');
          return recordCredit({ ...input, reason: 'grant' });
        },
        async consume(input) {
          assertPositive(input.amount, 'credits.consume');
          const subject = subjectFromCommercialInput(input);
          const userId = subjectToStoredUserId(subject);
          await options.store.consumeCreditLedger({
            ...scope,
            userId,
            amount: input.amount,
            unit: input.unit ?? 'credit',
            reason: input.reason ?? 'consume',
            idempotencyKey: input.idempotencyKey,
            metadata: {
              ...(input.metadata ?? {}),
              subject,
              source: input.source,
              sourceId: input.sourceId,
            },
          });
          return creditBalance({ subject, unit: input.unit });
        },
        async adjust(input) {
          return recordCredit({ ...input, reason: 'adjust' });
        },
        async refund(input) {
          assertPositive(input.amount, 'credits.refund');
          return recordCredit({ ...input, reason: 'refund' });
        },
        async reserve(input) {
          assertPositive(input.amount, 'credits.reserve');
          const subject = subjectFromCommercialInput(input);
          const currentBalance = await creditBalance({
            subject,
            unit: input.unit,
          });
          if (currentBalance.balance < input.amount) {
            throw new Error('MODULE_CREDITS_INSUFFICIENT');
          }
          const reservation = await options.store.createCreditReservation({
            ...scope,
            userId: subjectToStoredUserId(subject),
            amountReserved: input.amount,
            amountCommitted: 0,
            unit: input.unit ?? 'credit',
            status: 'reserved',
            reason: input.reason ?? 'reserve',
            source: input.source,
            sourceId: input.sourceId,
            idempotencyKey: input.idempotencyKey,
            metadata: {
              ...(input.metadata ?? {}),
              subject,
            },
          });
          try {
            await options.store.consumeCreditLedger({
              ...scope,
              userId: subjectToStoredUserId(subject),
              amount: input.amount,
              unit: input.unit ?? 'credit',
              reason: input.reason ?? 'reserve',
              idempotencyKey: input.idempotencyKey,
              metadata: {
                ...(input.metadata ?? {}),
                subject,
                source: input.source,
                sourceId: input.sourceId,
                reservationId: reservation.id,
              },
            });
          } catch (error) {
            await options.store.updateCreditReservation(reservation.id, {
              status: 'released',
              metadata: {
                reserveFailed: true,
                reserveFailure:
                  error instanceof Error ? error.message : 'MODULE_CREDITS_RESERVE_FAILED',
              },
            });
            throw error;
          }
          return toCreditsReservation(reservation);
        },
        async commitReservation(input) {
          const reservation = await options.store.getCreditReservation(input.reservationId);
          if (!reservation) {
            throw new Error(`MODULE_CREDITS_RESERVATION_NOT_FOUND: ${input.reservationId}`);
          }
          if (reservation.status === 'committed') {
            return creditBalance({
              subject: subjectFromStoredUserId(reservation.userId),
              unit: reservation.unit,
            });
          }
          if (reservation.status === 'released') {
            throw new Error(`MODULE_CREDITS_RESERVATION_RELEASED: ${input.reservationId}`);
          }
          const finalAmount = input.finalAmount ?? reservation.amountReserved;
          assertNonNegative(finalAmount, 'credits.commitReservation.finalAmount');
          if (finalAmount < reservation.amountReserved) {
            await recordCredit({
              subject: subjectFromStoredUserId(reservation.userId),
              amount: reservation.amountReserved - finalAmount,
              unit: reservation.unit,
              reason: 'reserve.release',
              source: reservation.source,
              sourceId: reservation.sourceId,
              idempotencyKey: input.idempotencyKey,
              metadata: {
                ...(input.metadata ?? {}),
                reservationId: reservation.id,
              },
            });
          } else if (finalAmount > reservation.amountReserved) {
            await options.store.consumeCreditLedger({
              ...scope,
              userId: reservation.userId,
              amount: finalAmount - reservation.amountReserved,
              unit: reservation.unit,
              reason: 'reserve.overage',
              idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:overage` : undefined,
              metadata: {
                ...(input.metadata ?? {}),
                subject: subjectFromStoredUserId(reservation.userId),
                source: reservation.source,
                sourceId: reservation.sourceId,
                reservationId: reservation.id,
              },
            });
          }
          await options.store.updateCreditReservation(reservation.id, {
            amountCommitted: finalAmount,
            status: 'committed',
            metadata: input.metadata,
          });
          return creditBalance({
            subject: subjectFromStoredUserId(reservation.userId),
            unit: reservation.unit,
          });
        },
        async releaseReservation(input) {
          const reservation = await options.store.getCreditReservation(input.reservationId);
          if (!reservation) {
            throw new Error(`MODULE_CREDITS_RESERVATION_NOT_FOUND: ${input.reservationId}`);
          }
          if (reservation.status === 'committed') {
            return creditBalance({
              subject: subjectFromStoredUserId(reservation.userId),
              unit: reservation.unit,
            });
          }
          if (reservation.status !== 'released') {
            const releasable = reservation.amountReserved - reservation.amountCommitted;
            if (releasable > 0) {
              await recordCredit({
                subject: subjectFromStoredUserId(reservation.userId),
                amount: releasable,
                unit: reservation.unit,
                reason: input.reason ?? 'reserve.release',
                source: reservation.source,
                sourceId: reservation.sourceId,
                idempotencyKey: input.idempotencyKey,
                metadata: {
                  ...(input.metadata ?? {}),
                  reservationId: reservation.id,
                },
              });
            }
          }
          await options.store.updateCreditReservation(reservation.id, {
            status: 'released',
            metadata: input.metadata,
          });
          return creditBalance({
            subject: subjectFromStoredUserId(reservation.userId),
            unit: reservation.unit,
          });
        },
        async revokeBySource(input) {
          const entries = await options.store.listCreditLedger({
            productId: scope.productId,
            workspaceId: scope.workspaceId,
          });
          const matching = entries.filter(
            (entry) =>
              entry.metadata.source === input.source && entry.metadata.sourceId === input.sourceId
          );
          for (const entry of matching) {
            if (entry.amount > 0) {
              await options.store.recordCreditLedger({
                ...scope,
                userId: entry.userId,
                amount: -entry.amount,
                unit: entry.unit,
                reason: input.reason ?? 'revoke',
                idempotencyKey: input.idempotencyKey
                  ? `${input.idempotencyKey}:${entry.id}`
                  : undefined,
                metadata: {
                  ...(input.metadata ?? {}),
                  source: input.source,
                  sourceId: input.sourceId,
                  revokedEntryId: entry.id,
                },
              });
            }
          }
          return { revoked: matching.length };
        },
        async listLedger(input = {}) {
          const subject = subjectFromCommercialInput(input);
          const records = await options.store.listCreditLedger({
            productId: scope.productId,
            workspaceId: scope.workspaceId,
            userId: input.subject || input.userId ? subjectToStoredUserId(subject) : undefined,
            unit: input.unit,
            status:
              input.status === 'available' ||
              input.status === 'pending' ||
              input.status === 'expired'
                ? input.status
                : undefined,
          });
          return records
            .filter((record) => !input.source || record.metadata.source === input.source)
            .filter((record) => !input.sourceId || record.metadata.sourceId === input.sourceId)
            .map(toCreditLedgerEntry);
        },
      };

      const billing: ModuleBillingApi = {
        async getPlan(userId) {
          const grants = await activeEntitlements(userId);
          const planIds = new Set(grants.map((grant) => grant.planId).filter(Boolean));
          return planCatalog.find((plan) => planIds.has(plan.id)) ?? null;
        },
        async getCurrentPlan(userId) {
          const grants = await activeEntitlements(userId);
          const planIds = new Set(grants.map((grant) => grant.planId).filter(Boolean));
          return planCatalog.find((plan) => planIds.has(plan.id)) ?? null;
        },
        async hasEntitlement(userId, entitlement) {
          return (await activeEntitlements(userId, entitlement)).length > 0;
        },
        redeemCode,
      };

      const entitlements: ModuleEntitlementsApi = {
        async has(input, entitlement) {
          const subject = typeof input === 'string' ? userSubject(input) : input.subject;
          const resolvedEntitlement = typeof input === 'string' ? entitlement : input.entitlement;
          if (!resolvedEntitlement) {
            return false;
          }
          return (
            (await activeEntitlements(subjectToStoredUserId(subject), resolvedEntitlement)).length >
            0
          );
        },
        async list(input = {}) {
          const subject = subjectFromCommercialInput(input);
          const grants = await options.store.listEntitlements({
            productId: scope.productId,
            workspaceId: scope.workspaceId,
            userId: input.subject || input.userId ? subjectToStoredUserId(subject) : undefined,
            entitlement: input.entitlement,
            status: input.status,
          });
          return grants.map(toEntitlementGrant);
        },
        async grant(input) {
          const subject = subjectFromCommercialInput(input);
          const grant = await options.store.grantEntitlement({
            ...scope,
            userId: subjectToStoredUserId(subject),
            entitlement: input.entitlement,
            planId: input.planId,
            source: input.source,
            idempotencyKey: input.idempotencyKey,
            expiresAt: input.expiresAt,
            metadata: {
              ...(input.metadata ?? {}),
              subject,
              sourceId: input.sourceId,
            },
          });
          return toEntitlementGrant(grant);
        },
        async revoke(input) {
          return toEntitlementGrant(
            await options.store.revokeEntitlement(input.id, {
              ...(input.metadata ?? {}),
              reason: input.reason,
              idempotencyKey: input.idempotencyKey,
            })
          );
        },
        async override(input) {
          return toEntitlementGrant(
            await options.store.overrideEntitlement(input.id, {
              status: input.status,
              expiresAt: input.expiresAt,
              metadata: {
                ...(input.metadata ?? {}),
                idempotencyKey: input.idempotencyKey,
              },
            })
          );
        },
        async expire(input = {}) {
          const cutoff = input.before ? new Date(input.before).getTime() : now().getTime();
          const grants = await options.store.listEntitlements({
            productId: scope.productId,
            workspaceId: scope.workspaceId,
            status: 'active',
          });
          let expired = 0;
          for (const grant of grants) {
            if (input.limit && expired >= input.limit) {
              break;
            }
            if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= cutoff) {
              await options.store.overrideEntitlement(grant.id, {
                status: 'expired',
                metadata: { reason: 'expire' },
              });
              expired += 1;
            }
          }
          return { expired };
        },
      };

      const commerce: ModuleCommerceApi = {
        async createCheckout(input) {
          const beneficiary = input.beneficiary ?? input.buyer ?? subjectFromCommercialInput(input);
          const order = await options.store.createCommercialOrder({
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
          const beneficiary = input.beneficiary ?? input.buyer ?? subjectFromCommercialInput(input);
          let order = input.orderId
            ? await requireScopedOrder(input.orderId, 'MODULE_COMMERCIAL_PAID')
            : null;
          order ??= await options.store.findCommercialOrderByProviderRef(
            scope.productId,
            scope.workspaceId,
            input.provider,
            input.providerRef
          );
          order ??= await options.store.createCommercialOrder({
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
            order = await options.store.attachCommercialOrderProvider(
              order.id,
              input.provider,
              input.providerRef,
              input.metadata
            );
          }
          const paidOrder = await options.store.updateCommercialOrderStatus(order.id, 'paid', {
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
          order ??= await options.store.findCommercialOrderByProviderRef(
            scope.productId,
            scope.workspaceId,
            input.provider,
            input.providerRef
          );
          if (!order) {
            throw new Error(`MODULE_COMMERCIAL_REFUND_ORDER_NOT_FOUND: ${input.providerRef}`);
          }
          const refundedOrder = await options.store.updateCommercialOrderStatus(
            order.id,
            'refunded',
            {
              provider: input.provider,
              providerRef: input.providerRef,
              refundAmount: input.amount ?? order.amount,
              refundCurrency: input.currency ?? order.currency,
              refundReason: input.reason ?? 'provider.refund',
              ...(input.metadata ?? {}),
            }
          );
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
          await options.store.upsertSubscription({
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
          const event = await options.store.createSubscriptionEvent({
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
            subject,
            planId: event.planId,
            type: event.type,
            status: event.status,
          };
        },
        async reconcilePaidOrderBenefits(input = {}) {
          const orders = await options.store.listCommercialOrders({
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

      const redeemCodes: ModuleRedeemCodesApi = {
        async createBatch(input) {
          if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000) {
            throw new Error('MODULE_REDEEM_CODES_INVALID_COUNT');
          }
          if (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1) {
            throw new Error('MODULE_REDEEM_CODES_INVALID_MAX_REDEMPTIONS');
          }
          if (input.credits) {
            assertPositive(input.credits.amount, 'redeemCodes.createBatch.credits');
          }
          const batchId = `redeem_batch_${randomUUID()}`;
          const codes: ModuleRedeemCodeRecord[] = [];
          for (let index = 0; index < input.count; index += 1) {
            const code = `${input.prefix ? `${input.prefix}_` : ''}${randomUUID().replace(/-/g, '').slice(0, 20)}`;
            const codeHash = hashRedeemCode(code);
            const record = await options.store.upsertRedeemCode({
              productId: scope.productId,
              code: codeHash,
              entitlement: input.entitlement,
              creditsAmount: input.credits?.amount,
              creditsUnit: input.credits?.unit ?? 'credit',
              maxRedemptions: input.maxRedemptions,
              expiresAt: input.expiresAt,
              metadata: {
                ...(input.metadata ?? {}),
                bind: input.bind,
                batchId,
                prefix: input.prefix,
                maskedCode: maskRedeemCode(code),
                status: 'active',
              },
            });
            codes.push({
              ...toRedeemCodeRecord(record, now),
              batchId,
              metadata: { ...record.metadata, rawCode: code },
            });
          }
          return { batchId, codes };
        },
        async redeem(input) {
          const subject = subjectFromCommercialInput(input);
          const userId = subjectToStoredUserId(subject);
          const codeHash = hashRedeemCode(input.code);
          const result = await redeemCodeForSubject({
            code: input.code,
            subject,
            email: input.email,
          });
          const [redemption] = await options.store.listRedeemRedemptions({
            productId: scope.productId,
            code: codeHash,
            userId,
          });
          await options.store.recordAudit({
            ...scope,
            actorId: userId,
            type: 'commercial.redeem_code.attempt',
            metadata: {
              codeHash,
              subject,
              ok: result.ok,
              reason: result.ok ? undefined : result.reason,
              redemptionId: redemption?.id,
              idempotencyKey: input.idempotencyKey,
              ...redeemAttemptEmailMetadata(input.email),
            },
          });
          return {
            ok: result.ok,
            entitlement: result.entitlement,
            credits: redemption?.creditsAmount
              ? { amount: redemption.creditsAmount, unit: redemption.creditsUnit }
              : undefined,
            redemption: redemption ? toRedeemCodeRedemption(redemption) : undefined,
          };
        },
        async freeze(input) {
          const records = await options.store.listRedeemCodes({
            productId: scope.productId,
            batchId: input.batchId,
            status: 'active',
          });
          let frozen = 0;
          for (const record of records) {
            if (isExpired(record.expiresAt, now)) {
              continue;
            }
            const redemptions = await options.store.listRedeemRedemptions({
              productId: scope.productId,
              code: record.code,
            });
            if (redemptions.length >= record.maxRedemptions) {
              continue;
            }
            await options.store.updateRedeemCodeStatus({
              productId: scope.productId,
              code: record.code,
              status: 'frozen',
              metadata: { reason: input.reason },
            });
            frozen += 1;
          }
          return { frozen };
        },
        async revoke(input) {
          const [, codeHash = input.codeId] = input.codeId.split(':');
          const record = await options.store.updateRedeemCodeStatus({
            productId: scope.productId,
            code: codeHash,
            status: 'revoked',
            metadata: { reason: input.reason },
          });
          return toRedeemCodeRecord(record, now);
        },
        async list(input = {}) {
          const records = await options.store.listRedeemCodes({
            productId: scope.productId,
            batchId: input.batchId,
            status: input.status === 'expired' ? undefined : input.status,
          });
          const mapped = records.map((record) => {
            const mapped = toRedeemCodeRecord(record, now);
            return {
              ...mapped,
              batchId:
                typeof record.metadata.batchId === 'string' ? record.metadata.batchId : undefined,
            };
          });
          return input.status ? mapped.filter((record) => record.status === input.status) : mapped;
        },
        async listRedemptions(input = {}) {
          const subject = subjectFromCommercialInput(input);
          const codeHash = input.codeId ? input.codeId.split(':').at(-1) : undefined;
          const records = await options.store.listRedeemRedemptions({
            productId: scope.productId,
            code: codeHash,
            userId: input.subject || input.userId ? subjectToStoredUserId(subject) : undefined,
          });
          return records.map(toRedeemCodeRedemption);
        },
      };

      const risk: ModuleRiskApi = {
        async record(input) {
          const event = await options.store.recordRiskEvent({
            ...scope,
            moduleId,
            subjectType: input.subject?.type,
            subjectId: input.subject?.id,
            type: input.type,
            severity: input.severity ?? 'medium',
            source: input.source,
            sourceId: input.sourceId,
            metadata: input.metadata ?? {},
          });
          await options.store.recordAudit({
            ...scope,
            moduleId,
            type: `risk.${event.type}`,
            metadata: {
              riskEventId: event.id,
              subject: input.subject,
              type: event.type,
              severity: event.severity,
              source: event.source,
              sourceId: event.sourceId,
            },
          });
          return {
            id: event.id,
            subject: input.subject,
            type: event.type,
            severity: event.severity,
            source: event.source,
            sourceId: event.sourceId,
            metadata: event.metadata,
            createdAt: event.createdAt,
          };
        },
        async block(input) {
          await options.store.upsertRiskBlock({
            ...scope,
            subjectType: input.subject.type,
            subjectId: input.subject.id,
            scope: input.scope,
            reason: input.reason,
            expiresAt: input.expiresAt,
            idempotencyKey: input.idempotencyKey,
          });
          await options.store.recordAudit({
            ...scope,
            moduleId,
            type: 'risk.subject.blocked',
            metadata: {
              subject: input.subject,
              riskScope: input.scope,
              reason: input.reason,
              expiresAt: input.expiresAt,
              idempotencyKey: input.idempotencyKey,
            },
          });
          return { blocked: true };
        },
        async check(input) {
          if (!input.subject) {
            return { ok: true };
          }
          const blocks = await options.store.listRiskBlocks({
            productId: scope.productId,
            workspaceId: scope.workspaceId,
            subjectType: input.subject.type,
            subjectId: input.subject.id,
          });
          for (const block of blocks) {
            if (block.scope && input.scope && block.scope !== input.scope) {
              continue;
            }
            if (block.scope && !input.scope) {
              continue;
            }
            if (block.expiresAt && new Date(block.expiresAt).getTime() <= now().getTime()) {
              continue;
            }
            return { ok: false, reason: block.reason };
          }
          return { ok: true };
        },
      };

      return { usage, metering, credits, billing, entitlements, commerce, redeemCodes, risk };
    },
    admin: {
      async grantCredits(input) {
        assertAdmin(input.session);
        assertPositive(input.amount, 'admin.grantCredits');
        const balance = await recordCredit({
          userId: input.userId,
          amount: input.amount,
          unit: input.unit,
          reason: input.reason ?? 'admin.grant',
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
          metadata: input.metadata,
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.credits.granted',
          metadata: { userId: input.userId, amount: input.amount, unit: balance.unit },
        });
        return balance;
      },
      async adjustCredits(input) {
        assertAdmin(input.session);
        const balance = await recordCredit({
          userId: input.userId,
          amount: input.amount,
          unit: input.unit,
          reason: 'admin.adjust',
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.credits.adjusted',
          metadata: { userId: input.userId, amount: input.amount, unit: balance.unit },
        });
        return balance;
      },
      async grantEntitlement(input) {
        assertAdmin(input.session);
        const grant = await options.store.grantEntitlement({
          ...scope,
          userId: input.userId,
          entitlement: input.entitlement,
          planId: input.planId,
          source: 'admin',
          expiresAt: input.expiresAt,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.entitlement.granted',
          metadata: { userId: input.userId, entitlement: input.entitlement },
        });
        return grant;
      },
      async revokeEntitlement(input) {
        assertAdmin(input.session);
        const grant = await options.store.revokeEntitlement(input.entitlementId, {
          revokedBy: input.session.actorId ?? input.session.user?.id,
          source: 'admin',
          metadata: input.metadata,
        });
        await options.store.recordAudit({
          productId: grant.productId,
          workspaceId: grant.workspaceId,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.entitlement.revoked',
          metadata: {
            entitlementId: input.entitlementId,
            userId: grant.userId,
            entitlement: grant.entitlement,
            reason: input.reason,
            ...(input.metadata ?? {}),
          },
        });
        return grant;
      },
      async overrideEntitlement(input) {
        assertAdmin(input.session);
        const grant = await options.store.overrideEntitlement(input.entitlementId, {
          status: input.status,
          expiresAt: input.expiresAt,
          metadata: {
            ...(input.metadata ?? {}),
            overrideBy: input.session.actorId ?? input.session.user?.id,
            overrideReason: input.reason,
            overrideStatus: input.status,
            source: 'admin',
          },
        });
        await options.store.recordAudit({
          productId: grant.productId,
          workspaceId: grant.workspaceId,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.entitlement.overridden',
          metadata: {
            entitlementId: input.entitlementId,
            userId: grant.userId,
            entitlement: grant.entitlement,
            status: input.status,
            expiresAt: input.expiresAt,
            reason: input.reason,
          },
        });
        return grant;
      },
      async createRedeemCode(input) {
        assertAdmin(input.session);
        const codeHash = hashRedeemCode(input.code);
        const code = await options.store.upsertRedeemCode({
          productId: scope.productId,
          code: codeHash,
          entitlement: input.entitlement,
          creditsAmount: input.creditsAmount,
          creditsUnit: input.creditsUnit ?? 'credit',
          maxRedemptions: input.maxRedemptions,
          expiresAt: input.expiresAt,
          metadata: {
            ...(input.metadata ?? {}),
            maskedCode: maskRedeemCode(input.code),
            prefix: input.code.includes('_') ? input.code.split('_')[0] : undefined,
            status: 'active',
          },
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.redeem_code.upserted',
          metadata: { codeHash, maskedCode: maskRedeemCode(input.code) },
        });
        return code;
      },
      listOrders(query = {}) {
        return options.store.listCommercialOrders({
          ...query,
          productId: scope.productId,
          workspaceId: scope.workspaceId,
        });
      },
      listCreditLedger(query = {}) {
        return options.store.listCreditLedger({
          ...query,
          productId: scope.productId,
          workspaceId: scope.workspaceId,
        });
      },
      async reconcileCredits(userId, unit = 'credit') {
        const balance = await creditBalance(userId, unit);
        const ledger = await options.store.listCreditLedger({
          productId: scope.productId,
          workspaceId: scope.workspaceId,
          userId,
          unit,
          status: 'available',
        });
        const ledgerBalance = ledger.reduce((sum, entry) => sum + entry.amount, 0);
        return {
          userId,
          unit,
          balance: balance.balance,
          ledgerBalance,
          ok: balance.balance === ledgerBalance,
        };
      },
      async validateTaxProfile(input) {
        assertAdmin(input.session);
        const jurisdiction = normalizeJurisdiction(input.jurisdiction);
        const validationStatus = taxValidationStatus(input.profile);
        const record = await options.store.upsertTaxProfile({
          ...scope,
          userId: input.userId,
          jurisdiction,
          status: validationStatus === 'valid' ? 'validated' : 'invalid',
          validationStatus,
          profile: input.profile,
          evidence: {
            validator: 'host-local-tax-validator',
            checkedAt: now().toISOString(),
            jurisdiction,
            validationStatus,
            ...(input.evidence ?? {}),
          },
          metadata: input.metadata,
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.tax_profile.validated',
          metadata: {
            userId: input.userId,
            jurisdiction,
            validationStatus,
          },
        });
        return record;
      },
      async upsertCatalogDraft(input) {
        assertAdmin(input.session);
        const existing = await options.store.listCommercialCatalogItems({
          productId: scope.productId,
          workspaceId: scope.workspaceId,
          kind: input.kind,
          itemId: input.itemId,
        });
        const version = Math.max(0, ...existing.map((item) => item.version)) + 1;
        const item = await options.store.upsertCommercialCatalogItem({
          ...scope,
          kind: input.kind,
          itemId: input.itemId,
          version,
          status: 'draft',
          value: input.value,
          metadata: input.metadata,
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.catalog.draft_upserted',
          metadata: {
            kind: input.kind,
            itemId: input.itemId,
            version: item.version,
          },
        });
        return item;
      },
      async publishCatalogItem<TValue = unknown>(
        input: CommercialAdminSessionInput & {
          kind: RuntimeStoreCommercialCatalogKind;
          itemId: string;
          version?: number;
          metadata?: Record<string, unknown>;
        }
      ) {
        assertAdmin(input.session);
        const items = await options.store.listCommercialCatalogItems({
          productId: scope.productId,
          workspaceId: scope.workspaceId,
          kind: input.kind,
          itemId: input.itemId,
        });
        const source =
          (typeof input.version === 'number'
            ? items.find((item) => item.version === input.version)
            : items.find((item) => item.status === 'draft')) ?? items[0];
        if (!source) {
          throw new Error(
            `MODULE_COMMERCIAL_CATALOG_ITEM_NOT_FOUND: ${input.kind}.${input.itemId}`
          );
        }
        const published = await options.store.upsertCommercialCatalogItem({
          ...scope,
          kind: input.kind,
          itemId: input.itemId,
          version: Math.max(0, ...items.map((item) => item.version)) + 1,
          status: 'published',
          value: source.value,
          metadata: {
            publishedFromVersion: source.version,
            ...(input.metadata ?? {}),
          },
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.catalog.published',
          metadata: {
            kind: input.kind,
            itemId: input.itemId,
            version: published.version,
            publishedFromVersion: source.version,
          },
        });
        return published as RuntimeStoreCommercialCatalogItem<TValue>;
      },
      async rollbackCatalogItem<TValue = unknown>(
        input: CommercialAdminSessionInput & {
          kind: RuntimeStoreCommercialCatalogKind;
          itemId: string;
          toVersion: number;
          metadata?: Record<string, unknown>;
        }
      ) {
        assertAdmin(input.session);
        const items = await options.store.listCommercialCatalogItems({
          productId: scope.productId,
          workspaceId: scope.workspaceId,
          kind: input.kind,
          itemId: input.itemId,
        });
        const source = items.find((item) => item.version === input.toVersion);
        if (!source) {
          throw new Error(
            `MODULE_COMMERCIAL_CATALOG_VERSION_NOT_FOUND: ${input.kind}.${input.itemId}.${input.toVersion}`
          );
        }
        const rollback = await options.store.upsertCommercialCatalogItem({
          ...scope,
          kind: input.kind,
          itemId: input.itemId,
          version: Math.max(0, ...items.map((item) => item.version)) + 1,
          status: 'published',
          value: source.value,
          metadata: {
            rollbackToVersion: source.version,
            ...(input.metadata ?? {}),
          },
        });
        await options.store.recordAudit({
          ...scope,
          actorId: input.session.actorId ?? input.session.user?.id,
          type: 'commercial.catalog.rolled_back',
          metadata: {
            kind: input.kind,
            itemId: input.itemId,
            version: rollback.version,
            rollbackToVersion: source.version,
          },
        });
        return rollback as RuntimeStoreCommercialCatalogItem<TValue>;
      },
      listRevenueBuckets(query = {}) {
        return options.store.listRevenueBuckets({
          productId: scope.productId,
          workspaceId: scope.workspaceId,
          from: query.from,
          to: query.to,
          currency: query.currency,
        });
      },
    },
    provider: {
      async applyCheckoutPaid(input) {
        const sku = skuCatalog[input.sku];
        if (sku?.planId) {
          await options.store.upsertCommercialCatalogItem({
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
        await options.store.upsertCommercialCatalogItem({
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
        const orderByProviderRef = await options.store.findCommercialOrderByProviderRef(
          scope.productId,
          scope.workspaceId,
          input.provider,
          input.providerRef
        );
        if (orderById && orderByProviderRef && orderById.id !== orderByProviderRef.id) {
          throw new Error(`MODULE_COMMERCIAL_ORDER_PROVIDER_REF_CONFLICT: ${input.providerRef}`);
        }
        let order = orderById ?? orderByProviderRef;
        order ??= await options.store.createCommercialOrder({
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
          order = await options.store.attachCommercialOrderProvider(
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
        const paidOrder = await options.store.updateCommercialOrderStatus(order.id, 'paid', {
          provider: input.provider,
          providerRef: input.providerRef,
          ...(input.metadata ?? {}),
        });
        const benefits = await applySkuBenefits(paidOrder);
        await recordCommercialDomainFacts(paidOrder);
        await options.store.recordAudit({
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
        order ??= await options.store.findCommercialOrderByProviderRef(
          scope.productId,
          scope.workspaceId,
          input.provider,
          input.providerRef
        );
        if (!order) {
          throw new Error(`MODULE_COMMERCIAL_REFUND_ORDER_NOT_FOUND: ${input.providerRef}`);
        }
        const amount = input.amount ?? order.amount;
        assertPositive(amount, 'refund.amount');
        const currency = input.currency ?? order.currency;
        if (currency !== order.currency) {
          throw new Error(`MODULE_COMMERCIAL_REFUND_CURRENCY_MISMATCH: ${currency}`);
        }
        if (!['paid', 'refunded'].includes(order.status)) {
          throw new Error(`MODULE_COMMERCIAL_REFUND_ORDER_NOT_PAID: ${order.id}`);
        }
        const reason = input.reason ?? 'provider.refund';
        const existingCreditNotes = await options.store.listCreditNotes({
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
        const refundedOrder = await options.store.updateCommercialOrderStatus(
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
        await options.store.recordAudit({
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
          const local = await options.store.findCommercialOrderByProviderRef(
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
        const orders = await options.store.listCommercialOrders({
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
          await options.store.recordAudit({
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
            : await options.store.upsertSubscription({
                ...scope,
                id: subscriptionId,
                userId: input.userId,
                planId: input.planId,
                status,
                provider: input.provider ?? null,
                providerRef: input.providerRef ?? null,
                currentPeriodStart:
                  input.currentPeriodStart ??
                  currentSubscription?.currentPeriodStart ??
                  effectiveAt,
                currentPeriodEnd:
                  input.currentPeriodEnd ?? currentSubscription?.currentPeriodEnd ?? null,
                trialEnd: input.trialEnd ?? currentSubscription?.trialEnd ?? null,
                cancelAtPeriodEnd:
                  input.cancelAtPeriodEnd ??
                  (status === 'canceled'
                    ? true
                    : (currentSubscription?.cancelAtPeriodEnd ?? false)),
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
        const event = await options.store.createSubscriptionEvent({
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
        await options.store.recordAudit({
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
          options.store.listInvoices({
            productId: scope.productId,
            workspaceId: scope.workspaceId,
          }),
          options.store.listCreditNotes({
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
        const batch = await options.store.upsertSettlementBatch({
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
        await options.store.recordAudit({
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
    },
  };
}
