import type { RuntimeStoreScope } from './runtime-store-common-types';

export type RuntimeStoreMeteringStatus = 'authorized' | 'committed' | 'refunded' | 'voided';

export interface RuntimeStoreMeteringLedgerEntry {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  meter: string;
  quantity: number;
  unit?: string;
  status: RuntimeStoreMeteringStatus;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type RuntimeStoreCreditStatus = 'pending' | 'available' | 'expired' | 'void';
export type RuntimeStoreCreditReservationStatus = 'reserved' | 'committed' | 'released';

export interface RuntimeStoreCreditLedgerEntry {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  amount: number;
  unit: string;
  reason: string;
  status: RuntimeStoreCreditStatus;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RuntimeStoreCreditReservation {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  amountReserved: number;
  amountCommitted: number;
  unit: string;
  status: RuntimeStoreCreditReservationStatus;
  reason?: string;
  source?: string;
  sourceId?: string;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type RuntimeStoreEntitlementStatus = 'active' | 'revoked' | 'expired';

export interface RuntimeStoreEntitlementGrant {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  entitlement: string;
  planId?: string;
  source: string;
  status: RuntimeStoreEntitlementStatus;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type RuntimeStoreCommercialCatalogKind = 'plan' | 'sku' | 'entitlement' | 'credit_unit';
export type RuntimeStoreCommercialCatalogStatus = 'draft' | 'published' | 'archived';

export interface RuntimeStoreCommercialCatalogItem<TValue = unknown> {
  id: string;
  productId: string;
  workspaceId?: string | null;
  kind: RuntimeStoreCommercialCatalogKind;
  itemId: string;
  version: number;
  status: RuntimeStoreCommercialCatalogStatus;
  value: TValue;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreCommercialCatalogItemInput<
  TValue = unknown,
> extends RuntimeStoreScope {
  kind: RuntimeStoreCommercialCatalogKind;
  itemId: string;
  version?: number;
  status?: RuntimeStoreCommercialCatalogStatus;
  value: TValue;
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreCommercialOrderStatus =
  | 'created'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'canceled';

export interface RuntimeStoreCommercialOrder {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  sku: string;
  amount: number;
  currency: string;
  status: RuntimeStoreCommercialOrderStatus;
  provider?: string;
  providerRef?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type RuntimeStoreBillingAccountStatus = 'active' | 'disabled' | 'deleted';

export interface RuntimeStoreBillingAccount {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  status: RuntimeStoreBillingAccountStatus;
  customerProfile: Record<string, unknown>;
  providerCustomers: Record<string, string>;
  paymentMethods: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreBillingAccountInput extends RuntimeStoreScope {
  userId: string;
  status?: RuntimeStoreBillingAccountStatus;
  customerProfile?: Record<string, unknown>;
  providerCustomers?: Record<string, string>;
  paymentMethods?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreInvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'refunded';

export interface RuntimeStoreInvoiceRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  orderId?: string | null;
  subscriptionId?: string | null;
  number: string;
  status: RuntimeStoreInvoiceStatus;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  refunded: number;
  fee: number;
  net: number;
  currency: string;
  provider?: string | null;
  providerRef?: string | null;
  documentFileId?: string | null;
  taxSnapshot: Record<string, unknown>;
  lines: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  issuedAt?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreInvoiceInput extends RuntimeStoreScope {
  id?: string;
  userId: string;
  orderId?: string | null;
  subscriptionId?: string | null;
  number?: string;
  status?: RuntimeStoreInvoiceStatus;
  subtotal: number;
  discount?: number;
  tax?: number;
  total?: number;
  refunded?: number;
  fee?: number;
  net?: number;
  currency: string;
  provider?: string | null;
  providerRef?: string | null;
  documentFileId?: string | null;
  taxSnapshot?: Record<string, unknown>;
  lines?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
  issuedAt?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
}

export type RuntimeStoreCreditNoteStatus = 'issued' | 'void';

export interface RuntimeStoreCreditNoteRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  orderId?: string | null;
  invoiceId?: string | null;
  number: string;
  status: RuntimeStoreCreditNoteStatus;
  amount: number;
  currency: string;
  reason: string;
  provider?: string | null;
  providerRef?: string | null;
  lines: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRuntimeStoreCreditNoteInput extends RuntimeStoreScope {
  id?: string;
  userId: string;
  orderId?: string | null;
  invoiceId?: string | null;
  number?: string;
  status?: RuntimeStoreCreditNoteStatus;
  amount: number;
  currency: string;
  reason?: string;
  provider?: string | null;
  providerRef?: string | null;
  lines?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
  issuedAt?: string;
}

export type RuntimeStoreSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'paused';

export interface RuntimeStoreSubscriptionRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  planId: string;
  status: RuntimeStoreSubscriptionStatus;
  provider?: string | null;
  providerRef?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  renewalStrategy: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreSubscriptionInput extends RuntimeStoreScope {
  id?: string;
  userId: string;
  planId: string;
  status?: RuntimeStoreSubscriptionStatus;
  provider?: string | null;
  providerRef?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  renewalStrategy?: string;
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreSubscriptionEventType =
  | 'created'
  | 'trial_started'
  | 'renewed'
  | 'past_due'
  | 'paused'
  | 'resumed'
  | 'canceled';

export interface RuntimeStoreSubscriptionEventRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  subscriptionId: string;
  planId: string;
  type: RuntimeStoreSubscriptionEventType;
  status: RuntimeStoreSubscriptionStatus;
  provider?: string | null;
  providerRef?: string | null;
  idempotencyKey?: string | null;
  effectiveAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateRuntimeStoreSubscriptionEventInput extends RuntimeStoreScope {
  userId: string;
  subscriptionId: string;
  planId: string;
  type: RuntimeStoreSubscriptionEventType;
  status: RuntimeStoreSubscriptionStatus;
  provider?: string | null;
  providerRef?: string | null;
  idempotencyKey?: string;
  effectiveAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreTaxProfileRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  status: 'draft' | 'validated' | 'invalid';
  jurisdiction?: string | null;
  validationStatus: 'unverified' | 'valid' | 'invalid';
  profile: Record<string, unknown>;
  evidence: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreTaxProfileInput extends RuntimeStoreScope {
  userId: string;
  status?: RuntimeStoreTaxProfileRecord['status'];
  jurisdiction?: string | null;
  validationStatus?: RuntimeStoreTaxProfileRecord['validationStatus'];
  profile?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreRevenueBucket {
  id: string;
  productId: string;
  workspaceId?: string | null;
  bucketDate: string;
  currency: string;
  gross: number;
  discount: number;
  tax: number;
  refund: number;
  fee: number;
  net: number;
  orders: number;
  provider?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreRevenueBucketInput extends RuntimeStoreScope {
  bucketDate: string;
  currency: string;
  gross?: number;
  discount?: number;
  tax?: number;
  refund?: number;
  fee?: number;
  net?: number;
  orders?: number;
  provider?: string | null;
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreSettlementBatchStatus = 'draft' | 'closed' | 'reconciled';

export interface RuntimeStoreSettlementBatch {
  id: string;
  productId: string;
  workspaceId?: string | null;
  provider: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: RuntimeStoreSettlementBatchStatus;
  gross: number;
  refund: number;
  fee: number;
  net: number;
  orderCount: number;
  invoiceCount: number;
  creditNoteCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreSettlementBatchInput extends RuntimeStoreScope {
  id?: string;
  provider: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status?: RuntimeStoreSettlementBatchStatus;
  gross?: number;
  refund?: number;
  fee?: number;
  net?: number;
  orderCount?: number;
  invoiceCount?: number;
  creditNoteCount?: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreRedeemCode {
  productId: string;
  code: string;
  entitlement?: string;
  creditsAmount?: number;
  creditsUnit: string;
  maxRedemptions: number;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeStoreRedeemRedemption {
  id: string;
  productId: string;
  code: string;
  userId: string;
  entitlement?: string;
  creditsAmount?: number;
  creditsUnit?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
