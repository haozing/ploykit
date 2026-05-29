import type {
  ModuleFilePurpose,
  ModuleFileRecord,
  ModuleFileStatus,
  ModuleFileVisibility,
  ModuleNotificationChannel,
  ModuleNotificationRecord,
  ModuleNotificationStatus,
  PermissionValue,
  ModuleWorkspaceRole,
} from '@ploykit/module-sdk';
import type { ModuleRunKind, ModuleRunLogEntry, ModuleRunRecord, ModuleRunStatus } from '../runs';
import type { ModuleCatalogModuleState, ModuleCatalogModuleStatus } from '../catalog';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeProduct,
  ProductScopeWorkspace,
} from '../scope/product-scope-types';

export interface RuntimeStoreScope {
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
}

export interface CreateRuntimeStoreRunInput<TInput = unknown> extends RuntimeStoreScope {
  id?: string;
  moduleId: string;
  kind: ModuleRunKind;
  name: string;
  input?: TInput;
  maxAttempts?: number;
  costRef?: string;
  idempotencyKey?: string;
}

export interface ListRuntimeStoreRunsQuery {
  productId?: string;
  workspaceId?: string | null;
  moduleId?: string;
  status?: ModuleRunStatus;
  kind?: ModuleRunKind;
  idempotencyKey?: string;
}

export type RuntimeStoreOutboxStatus =
  | 'queued'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'dead_letter'
  | 'archived';

export interface RuntimeStoreOutboxRecord<TPayload = unknown> {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  name: string;
  payload: TPayload;
  metadata: Record<string, unknown>;
  status: RuntimeStoreOutboxStatus;
  attempts: number;
  idempotencyKey?: string;
  scheduledAt?: string;
  priority?: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  heartbeatAt?: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  error?: { code: string; message: string };
}

export type RuntimeStoreDeliveryKind = 'job' | 'event' | 'webhook' | 'email' | 'worker';

export type RuntimeStoreDeliveryStatus =
  | 'queued'
  | 'processing'
  | 'delivered'
  | 'failed'
  | 'dead_letter'
  | 'skipped'
  | 'archived';

export interface RuntimeStoreDeliveryRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
  kind: RuntimeStoreDeliveryKind;
  source: string;
  target: string;
  status: RuntimeStoreDeliveryStatus;
  attempts: number;
  outboxId?: string | null;
  runId?: string | null;
  receiptId?: string | null;
  eventId?: string | null;
  emailId?: string | null;
  workerId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  nextRetryAt?: string | null;
  errorCategory?: string | null;
  error?: { code: string; message: string };
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RecordRuntimeStoreDeliveryInput extends RuntimeStoreScope {
  kind: RuntimeStoreDeliveryKind;
  source: string;
  target: string;
  status: RuntimeStoreDeliveryStatus;
  attempts?: number;
  outboxId?: string | null;
  runId?: string | null;
  receiptId?: string | null;
  eventId?: string | null;
  emailId?: string | null;
  workerId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  nextRetryAt?: string | null;
  errorCategory?: string | null;
  error?: Error | string | { code: string; message: string };
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreWorkerStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'stopped' | 'error';

export interface RuntimeStoreWorkerRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  workerId: string;
  profile: string;
  status: RuntimeStoreWorkerStatus;
  queueProfile: string;
  heartbeatAt: string;
  lastDrainAt?: string | null;
  lastDurationMs: number;
  processed: number;
  failed: number;
  deadLettered: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreWorkerInput extends RuntimeStoreScope {
  workerId: string;
  profile?: string;
  status?: RuntimeStoreWorkerStatus;
  queueProfile?: string;
  heartbeatAt?: string;
  lastDrainAt?: string | null;
  lastDurationMs?: number;
  processed?: number;
  failed?: number;
  deadLettered?: number;
  metadata?: Record<string, unknown>;
}

export interface EnqueueRuntimeStoreOutboxInput<TPayload = unknown> extends RuntimeStoreScope {
  name: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  scheduledAt?: string;
  priority?: number;
}

export type RuntimeStoreWebhookReceiptStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'duplicate'
  | 'rejected';

export interface RuntimeStoreWebhookReceipt {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  webhookName: string;
  path: string;
  method: string;
  status: RuntimeStoreWebhookReceiptStatus;
  attempts: number;
  idempotencyKey?: string;
  signature?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyDigest?: string;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  error?: { code: string; message: string };
}

export interface CreateRuntimeStoreWebhookReceiptInput extends RuntimeStoreScope {
  moduleId: string;
  webhookName: string;
  path: string;
  method: string;
  idempotencyKey?: string;
  signature?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyDigest?: string;
}

export type RuntimeStoreNotificationCategory =
  | 'tasks'
  | 'billing'
  | 'files'
  | 'workspace'
  | 'admin'
  | 'system';

export type RuntimeStoreNotificationDeliveryStatus = 'delivered' | 'skipped' | 'failed';

export interface RuntimeStoreNotificationRecord extends ModuleNotificationRecord {
  productId: string;
  workspaceId?: string | null;
  source: string;
  category: RuntimeStoreNotificationCategory;
  deliveryStatus: RuntimeStoreNotificationDeliveryStatus;
  idempotencyKey?: string;
  deliveredAt?: string;
  skippedAt?: string;
  error?: { code: string; message: string };
}

export interface CreateRuntimeStoreNotificationInput extends RuntimeStoreScope {
  moduleId?: string | null;
  userId: string;
  channel?: ModuleNotificationChannel;
  title: string;
  body?: string;
  actionUrl?: string;
  runId?: string;
  source?: string;
  category?: RuntimeStoreNotificationCategory;
  status?: ModuleNotificationStatus;
  deliveryStatus?: RuntimeStoreNotificationDeliveryStatus;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  error?: Error | string;
}

export interface RuntimeStoreNotificationDeliveryRecord {
  id: string;
  notificationId?: string | null;
  productId: string;
  workspaceId?: string | null;
  userId: string;
  channel: ModuleNotificationChannel;
  provider: string;
  status: RuntimeStoreNotificationDeliveryStatus;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RuntimeStoreAuditRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  actorId?: string | null;
  type: string;
  metadata: Record<string, unknown>;
  integrity?: {
    schemaVersion: 1;
    category: string;
    risk: 'low' | 'medium' | 'high';
    resourceType?: string;
    resourceId?: string;
    correlationId?: string;
    previousHash?: string | null;
    recordHash: string;
  };
  createdAt: string;
}

export interface RuntimeStoreUsageRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  meter: string;
  quantity: number;
  unit?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

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

export interface UpsertRuntimeStoreCommercialCatalogItemInput<TValue = unknown>
  extends RuntimeStoreScope {
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

export type RuntimeStoreProviderInvocationStatus = 'succeeded' | 'failed';

export interface RuntimeStoreProviderInvocationRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  providerId: string;
  kind: string;
  operation: string;
  status: RuntimeStoreProviderInvocationStatus;
  target?: string | null;
  model?: string | null;
  serviceConnectionId?: string | null;
  resourceBindingId?: string | null;
  usage: Record<string, unknown>;
  cost: Record<string, unknown>;
  latencyMs: number;
  correlationId?: string | null;
  error?: { code: string; message: string };
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecordRuntimeStoreProviderInvocationInput extends RuntimeStoreScope {
  providerId: string;
  kind: string;
  operation: string;
  status: RuntimeStoreProviderInvocationStatus;
  target?: string | null;
  model?: string | null;
  serviceConnectionId?: string | null;
  resourceBindingId?: string | null;
  usage?: Record<string, unknown>;
  cost?: Record<string, unknown>;
  latencyMs?: number;
  correlationId?: string | null;
  error?: Error | string | { code: string; message: string };
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreRagSourceStatus = 'indexed' | 'deleted' | 'stale';

export interface RuntimeStoreRagSourceRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
  status: RuntimeStoreRagSourceStatus;
  contentDigest?: string | null;
  contentLength: number;
  chunkCount: number;
  indexedAt?: string | null;
  deletedAt?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreRagSourceInput extends RuntimeStoreScope {
  moduleId: string;
  sourceId: string;
  status?: RuntimeStoreRagSourceStatus;
  contentDigest?: string | null;
  contentLength?: number;
  chunkCount?: number;
  indexedAt?: string | null;
  deletedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreRagChunkRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreRagChunkInput extends RuntimeStoreScope {
  id?: string;
  moduleId: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
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

export type RuntimeStoreApiKeyStatus = 'active' | 'revoked';

export interface RuntimeStoreApiKeyRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  name: string;
  prefix: string;
  keyHash: string;
  ownerSubjectType?: 'user' | 'workspace' | 'organization' | 'apiKey';
  ownerSubjectId?: string;
  permissions: readonly PermissionValue[];
  status: RuntimeStoreApiKeyStatus;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeStoreRiskEvent {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  subjectType?: 'user' | 'workspace' | 'organization' | 'apiKey';
  subjectId?: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source?: string;
  sourceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RuntimeStoreRiskBlock {
  id: string;
  productId: string;
  workspaceId?: string | null;
  subjectType: 'user' | 'workspace' | 'organization' | 'apiKey';
  subjectId: string;
  scope?: string;
  reason: string;
  expiresAt?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRuntimeStoreApiKeyInput extends RuntimeStoreScope {
  id?: string;
  name: string;
  prefix: string;
  keyHash: string;
  ownerSubjectType?: RuntimeStoreApiKeyRecord['ownerSubjectType'];
  ownerSubjectId?: string;
  permissions?: readonly PermissionValue[];
  status?: RuntimeStoreApiKeyStatus;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreFileRecord extends ModuleFileRecord {
  productId: string;
  workspaceId?: string | null;
  ownerId?: string | null;
  visibility: ModuleFileVisibility;
  storageKey: string;
}

export interface RuntimeStoreMembership {
  id: string;
  productId: string;
  workspaceId: string;
  userId: string;
  role: ModuleWorkspaceRole;
  status: 'active' | 'disabled';
  updatedAt: string;
}

export type RuntimeStoreHostUserRole = 'admin' | 'user';
export type RuntimeStoreHostUserStatus =
  | 'active'
  | 'suspended'
  | 'deleted'
  | 'pending-verification';

export interface RuntimeStoreHostUser {
  id: string;
  email: string;
  passwordHash: string;
  role: RuntimeStoreHostUserRole;
  status: RuntimeStoreHostUserStatus;
  productId: string;
  workspaceId: string;
  workspaceRole: ModuleWorkspaceRole;
  permissions?: readonly PermissionValue[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type RuntimeStoreSettingStatus = 'active' | 'draft' | 'archived';

export interface RuntimeStoreSettingRecord<TValue = unknown> {
  id: string;
  productId: string;
  workspaceId?: string | null;
  namespace: string;
  key: string;
  value: TValue;
  status: RuntimeStoreSettingStatus;
  version: number;
  updatedBy?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreSettingInput<TValue = unknown> extends RuntimeStoreScope {
  namespace: string;
  key: string;
  value: TValue;
  status?: RuntimeStoreSettingStatus;
  version?: number;
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreServiceConnectionStatus = 'active' | 'disabled' | 'blocked';

export interface RuntimeStoreServiceConnectionRecord {
  connectionId: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  service: string;
  provider: string;
  status: RuntimeStoreServiceConnectionStatus;
  environment?: string;
  ownerType?: string;
  scopeType?: string;
  authType?: string;
  config: Record<string, unknown>;
  secretRefs: Record<string, string>;
  health: Record<string, unknown>;
  lastUsedAt?: string;
  updatedBy?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreServiceConnectionInput extends RuntimeStoreScope {
  connectionId: string;
  moduleId?: string | null;
  service: string;
  provider: string;
  status?: RuntimeStoreServiceConnectionStatus;
  environment?: string;
  ownerType?: string;
  scopeType?: string;
  authType?: string;
  config?: Record<string, unknown>;
  secretRefs?: Record<string, string>;
  health?: Record<string, unknown>;
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
}

export type RuntimeStoreResourceBindingStatus = 'active' | 'disabled';

export interface RuntimeStoreResourceBindingRecord<TValue = unknown> {
  bindingId: string;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  name: string;
  kind?: string;
  value: TValue;
  status: RuntimeStoreResourceBindingStatus;
  updatedBy?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreResourceBindingInput<TValue = unknown>
  extends RuntimeStoreScope {
  bindingId?: string;
  name: string;
  kind?: string;
  value: TValue;
  status?: RuntimeStoreResourceBindingStatus;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStore {
  ensureSchema?(): Promise<void>;
  createRun<TInput = unknown>(
    input: CreateRuntimeStoreRunInput<TInput>
  ): Promise<ModuleRunRecord<TInput>>;
  getRun(id: string): Promise<ModuleRunRecord | null>;
  listRuns(query?: ListRuntimeStoreRunsQuery): Promise<ModuleRunRecord[]>;
  updateRunStatus(
    id: string,
    status: ModuleRunStatus,
    patch?: {
      progress?: number;
      result?: unknown;
      error?: { code: string; message: string };
    }
  ): Promise<ModuleRunRecord>;
  appendRunLog(
    id: string,
    level: ModuleRunLogEntry['level'],
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<ModuleRunRecord>;
  enqueueOutbox<TPayload = unknown>(
    input: EnqueueRuntimeStoreOutboxInput<TPayload>
  ): Promise<RuntimeStoreOutboxRecord<TPayload>>;
  listOutbox(query?: {
    productId?: string;
    workspaceId?: string | null;
    status?: RuntimeStoreOutboxStatus;
    name?: string;
    namePrefix?: string;
  }): Promise<RuntimeStoreOutboxRecord[]>;
  claimOutbox(query?: {
    productId?: string;
    workspaceId?: string | null;
    name?: string;
    namePrefix?: string;
    limit?: number;
    statuses?: RuntimeStoreOutboxStatus[];
    leaseOwner?: string;
    leaseMs?: number;
  }): Promise<RuntimeStoreOutboxRecord[]>;
  markOutbox(
    id: string,
    status: RuntimeStoreOutboxStatus,
    error?: Error | string,
    options?: {
      scheduledAt?: string | null;
      heartbeatAt?: string | null;
    }
  ): Promise<RuntimeStoreOutboxRecord>;
  recordDelivery(input: RecordRuntimeStoreDeliveryInput): Promise<RuntimeStoreDeliveryRecord>;
  listDeliveries(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string | null;
    kind?: RuntimeStoreDeliveryKind;
    status?: RuntimeStoreDeliveryStatus;
    outboxId?: string;
    runId?: string;
    receiptId?: string;
    eventId?: string;
    emailId?: string;
    workerId?: string;
    correlationId?: string;
  }): Promise<RuntimeStoreDeliveryRecord[]>;
  upsertWorkerHeartbeat(input: UpsertRuntimeStoreWorkerInput): Promise<RuntimeStoreWorkerRecord>;
  listWorkers(query?: {
    productId?: string;
    workspaceId?: string | null;
    workerId?: string;
    status?: RuntimeStoreWorkerStatus;
  }): Promise<RuntimeStoreWorkerRecord[]>;
  createWebhookReceipt(
    input: CreateRuntimeStoreWebhookReceiptInput
  ): Promise<RuntimeStoreWebhookReceipt>;
  findWebhookReceiptByIdempotencyKey(
    productId: string,
    moduleId: string,
    webhookName: string,
    idempotencyKey: string
  ): Promise<RuntimeStoreWebhookReceipt | null>;
  markWebhookReceipt(
    id: string,
    status: RuntimeStoreWebhookReceiptStatus,
    error?: Error | string
  ): Promise<RuntimeStoreWebhookReceipt>;
  listWebhookReceipts(query?: {
    productId?: string;
    moduleId?: string;
    status?: RuntimeStoreWebhookReceiptStatus;
  }): Promise<RuntimeStoreWebhookReceipt[]>;
  createNotification(
    input: CreateRuntimeStoreNotificationInput
  ): Promise<RuntimeStoreNotificationRecord>;
  listNotifications(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
    userId?: string;
    status?: ModuleNotificationStatus;
    channel?: ModuleNotificationChannel;
    category?: RuntimeStoreNotificationCategory;
    deliveryStatus?: RuntimeStoreNotificationDeliveryStatus;
  }): Promise<RuntimeStoreNotificationRecord[]>;
  markNotificationRead(id: string): Promise<RuntimeStoreNotificationRecord>;
  markNotificationsRead(query: {
    productId: string;
    workspaceId?: string | null;
    userId: string;
    channel?: ModuleNotificationChannel;
    category?: RuntimeStoreNotificationCategory;
  }): Promise<RuntimeStoreNotificationRecord[]>;
  recordNotificationDelivery(input: {
    notificationId?: string | null;
    productId: string;
    workspaceId?: string | null;
    userId: string;
    channel: ModuleNotificationChannel;
    provider: string;
    status: RuntimeStoreNotificationDeliveryStatus;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreNotificationDeliveryRecord>;
  listNotificationDeliveries(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    status?: RuntimeStoreNotificationDeliveryStatus;
    provider?: string;
  }): Promise<RuntimeStoreNotificationDeliveryRecord[]>;
  recordAudit(
    input: RuntimeStoreScope & {
      type: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreAuditRecord>;
  listAudit(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
    actorId?: string;
    type?: string;
    from?: string;
    to?: string;
  }): Promise<RuntimeStoreAuditRecord[]>;
  recordUsage(
    input: RuntimeStoreScope & {
      moduleId: string;
      meter: string;
      quantity?: number;
      unit?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreUsageRecord>;
  listUsage(query?: {
    productId?: string;
    moduleId?: string;
    meter?: string;
  }): Promise<RuntimeStoreUsageRecord[]>;
  recordMetering(
    input: RuntimeStoreScope & {
      moduleId: string;
      meter: string;
      quantity?: number;
      unit?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreMeteringLedgerEntry>;
  getMetering(id: string): Promise<RuntimeStoreMeteringLedgerEntry | null>;
  updateMeteringStatus(
    id: string,
    status: RuntimeStoreMeteringStatus,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStoreMeteringLedgerEntry>;
  listMetering(query?: {
    productId?: string;
    moduleId?: string;
    meter?: string;
    status?: RuntimeStoreMeteringStatus;
  }): Promise<RuntimeStoreMeteringLedgerEntry[]>;
  recordCreditLedger(
    input: RuntimeStoreScope & {
      userId: string;
      amount: number;
      unit?: string;
      reason: string;
      status?: RuntimeStoreCreditStatus;
      idempotencyKey?: string;
      expiresAt?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreCreditLedgerEntry>;
  consumeCreditLedger(
    input: RuntimeStoreScope & {
      userId: string;
      amount: number;
      unit?: string;
      reason: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreCreditLedgerEntry>;
  listCreditLedger(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    unit?: string;
    status?: RuntimeStoreCreditStatus;
  }): Promise<RuntimeStoreCreditLedgerEntry[]>;
  getCreditBalance(query: {
    productId: string;
    workspaceId?: string | null;
    userId: string;
    unit?: string;
  }): Promise<{ userId: string; unit: string; balance: number }>;
  createCreditReservation(
    input: RuntimeStoreScope & {
      id?: string;
      userId: string;
      amountReserved: number;
      amountCommitted?: number;
      unit?: string;
      status?: RuntimeStoreCreditReservationStatus;
      reason?: string;
      source?: string;
      sourceId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreCreditReservation>;
  getCreditReservation(id: string): Promise<RuntimeStoreCreditReservation | null>;
  updateCreditReservation(
    id: string,
    patch: {
      amountCommitted?: number;
      status?: RuntimeStoreCreditReservationStatus;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreCreditReservation>;
  listCreditReservations(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    unit?: string;
    status?: RuntimeStoreCreditReservationStatus;
    source?: string;
    sourceId?: string;
  }): Promise<RuntimeStoreCreditReservation[]>;
  grantEntitlement(
    input: RuntimeStoreScope & {
      userId: string;
      entitlement: string;
      planId?: string;
      source: string;
      status?: RuntimeStoreEntitlementStatus;
      idempotencyKey?: string;
      expiresAt?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreEntitlementGrant>;
  listEntitlements(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    entitlement?: string;
    status?: RuntimeStoreEntitlementStatus;
  }): Promise<RuntimeStoreEntitlementGrant[]>;
  revokeEntitlement(
    id: string,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStoreEntitlementGrant>;
  overrideEntitlement(
    id: string,
    input: {
      status: RuntimeStoreEntitlementStatus;
      expiresAt?: string | null;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreEntitlementGrant>;
  upsertCommercialCatalogItem<TValue = unknown>(
    input: UpsertRuntimeStoreCommercialCatalogItemInput<TValue>
  ): Promise<RuntimeStoreCommercialCatalogItem<TValue>>;
  listCommercialCatalogItems<TValue = unknown>(query?: {
    productId?: string;
    workspaceId?: string | null;
    kind?: RuntimeStoreCommercialCatalogKind;
    status?: RuntimeStoreCommercialCatalogStatus;
    itemId?: string;
  }): Promise<RuntimeStoreCommercialCatalogItem<TValue>[]>;
  createCommercialOrder(
    input: RuntimeStoreScope & {
      userId: string;
      sku: string;
      amount: number;
      currency: string;
      provider?: string;
      providerRef?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreCommercialOrder>;
  getCommercialOrder(id: string): Promise<RuntimeStoreCommercialOrder | null>;
  findCommercialOrderByProviderRef(
    productId: string,
    workspaceId: string | null | undefined,
    provider: string,
    providerRef: string
  ): Promise<RuntimeStoreCommercialOrder | null>;
  attachCommercialOrderProvider(
    id: string,
    provider: string,
    providerRef: string,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStoreCommercialOrder>;
  updateCommercialOrderStatus(
    id: string,
    status: RuntimeStoreCommercialOrderStatus,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStoreCommercialOrder>;
  listCommercialOrders(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    status?: RuntimeStoreCommercialOrderStatus;
  }): Promise<RuntimeStoreCommercialOrder[]>;
  upsertBillingAccount(
    input: UpsertRuntimeStoreBillingAccountInput
  ): Promise<RuntimeStoreBillingAccount>;
  getBillingAccount(
    productId: string,
    userId: string,
    workspaceId?: string | null
  ): Promise<RuntimeStoreBillingAccount | null>;
  upsertInvoice(input: UpsertRuntimeStoreInvoiceInput): Promise<RuntimeStoreInvoiceRecord>;
  listInvoices(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    orderId?: string;
    status?: RuntimeStoreInvoiceStatus;
  }): Promise<RuntimeStoreInvoiceRecord[]>;
  createCreditNote(input: CreateRuntimeStoreCreditNoteInput): Promise<RuntimeStoreCreditNoteRecord>;
  listCreditNotes(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    orderId?: string;
    invoiceId?: string;
    status?: RuntimeStoreCreditNoteStatus;
  }): Promise<RuntimeStoreCreditNoteRecord[]>;
  upsertSubscription(
    input: UpsertRuntimeStoreSubscriptionInput
  ): Promise<RuntimeStoreSubscriptionRecord>;
  listSubscriptions(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    planId?: string;
    status?: RuntimeStoreSubscriptionStatus;
  }): Promise<RuntimeStoreSubscriptionRecord[]>;
  createSubscriptionEvent(
    input: CreateRuntimeStoreSubscriptionEventInput
  ): Promise<RuntimeStoreSubscriptionEventRecord>;
  listSubscriptionEvents(query?: {
    productId?: string;
    workspaceId?: string | null;
    userId?: string;
    subscriptionId?: string;
    planId?: string;
    type?: RuntimeStoreSubscriptionEventType;
  }): Promise<RuntimeStoreSubscriptionEventRecord[]>;
  upsertTaxProfile(input: UpsertRuntimeStoreTaxProfileInput): Promise<RuntimeStoreTaxProfileRecord>;
  getTaxProfile(
    productId: string,
    userId: string,
    workspaceId?: string | null
  ): Promise<RuntimeStoreTaxProfileRecord | null>;
  upsertRevenueBucket(
    input: UpsertRuntimeStoreRevenueBucketInput
  ): Promise<RuntimeStoreRevenueBucket>;
  listRevenueBuckets(query?: {
    productId?: string;
    workspaceId?: string | null;
    from?: string;
    to?: string;
    currency?: string;
  }): Promise<RuntimeStoreRevenueBucket[]>;
  upsertSettlementBatch(
    input: UpsertRuntimeStoreSettlementBatchInput
  ): Promise<RuntimeStoreSettlementBatch>;
  listSettlementBatches(query?: {
    productId?: string;
    workspaceId?: string | null;
    provider?: string;
    currency?: string;
    status?: RuntimeStoreSettlementBatchStatus;
  }): Promise<RuntimeStoreSettlementBatch[]>;
  recordProviderInvocation(
    input: RecordRuntimeStoreProviderInvocationInput
  ): Promise<RuntimeStoreProviderInvocationRecord>;
  listProviderInvocations(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string | null;
    providerId?: string;
    kind?: string;
    operation?: string;
    status?: RuntimeStoreProviderInvocationStatus;
  }): Promise<RuntimeStoreProviderInvocationRecord[]>;
  upsertRagSource(input: UpsertRuntimeStoreRagSourceInput): Promise<RuntimeStoreRagSourceRecord>;
  listRagSources(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
    sourceId?: string;
    status?: RuntimeStoreRagSourceStatus;
  }): Promise<RuntimeStoreRagSourceRecord[]>;
  upsertRagChunk(input: UpsertRuntimeStoreRagChunkInput): Promise<RuntimeStoreRagChunkRecord>;
  listRagChunks(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
    sourceId?: string;
  }): Promise<RuntimeStoreRagChunkRecord[]>;
  deleteRagChunkById(input: {
    productId: string;
    workspaceId?: string | null;
    moduleId?: string;
    id: string;
  }): Promise<boolean>;
  deleteRagChunksBySource(input: {
    productId: string;
    workspaceId?: string | null;
    moduleId?: string;
    sourceId: string;
  }): Promise<number>;
  upsertRedeemCode(
    code: Omit<RuntimeStoreRedeemCode, 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<RuntimeStoreRedeemCode>;
  getRedeemCode(productId: string, code: string): Promise<RuntimeStoreRedeemCode | null>;
  updateRedeemCodeStatus(input: {
    productId: string;
    code: string;
    status: 'active' | 'frozen' | 'revoked' | 'expired';
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreRedeemCode>;
  listRedeemCodes(query?: {
    productId?: string;
    batchId?: string;
    status?: 'active' | 'frozen' | 'revoked' | 'expired';
  }): Promise<RuntimeStoreRedeemCode[]>;
  recordRedeemRedemption(
    input: RuntimeStoreScope & {
      code: string;
      userId: string;
      entitlement?: string;
      creditsAmount?: number;
      creditsUnit?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreRedeemRedemption>;
  listRedeemRedemptions(query?: {
    productId?: string;
    code?: string;
    userId?: string;
  }): Promise<RuntimeStoreRedeemRedemption[]>;
  createApiKey(input: CreateRuntimeStoreApiKeyInput): Promise<RuntimeStoreApiKeyRecord>;
  getApiKey(input: {
    productId?: string;
    workspaceId?: string | null;
    id: string;
  }): Promise<RuntimeStoreApiKeyRecord | null>;
  findApiKeyByHash(input: {
    productId?: string;
    prefix?: string;
    keyHash: string;
  }): Promise<RuntimeStoreApiKeyRecord | null>;
  updateApiKey(
    id: string,
    patch: {
      prefix?: string;
      keyHash?: string;
      status?: RuntimeStoreApiKeyStatus;
      expiresAt?: string | null;
      revokedAt?: string | null;
      lastUsedAt?: string | null;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreApiKeyRecord>;
  listApiKeys(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string | null;
    ownerSubjectType?: RuntimeStoreApiKeyRecord['ownerSubjectType'];
    ownerSubjectId?: string;
    status?: RuntimeStoreApiKeyStatus;
  }): Promise<RuntimeStoreApiKeyRecord[]>;
  recordRiskEvent(input: RuntimeStoreScope & {
    id?: string;
    subjectType?: RuntimeStoreRiskEvent['subjectType'];
    subjectId?: string;
    type: string;
    severity?: RuntimeStoreRiskEvent['severity'];
    source?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreRiskEvent>;
  upsertRiskBlock(input: RuntimeStoreScope & {
    id?: string;
    subjectType: RuntimeStoreRiskBlock['subjectType'];
    subjectId: string;
    scope?: string;
    reason: string;
    expiresAt?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeStoreRiskBlock>;
  listRiskEvents(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string | null;
    subjectType?: RuntimeStoreRiskEvent['subjectType'];
    subjectId?: string;
    type?: string;
    severity?: RuntimeStoreRiskEvent['severity'];
    source?: string;
    sourceId?: string;
  }): Promise<RuntimeStoreRiskEvent[]>;
  listRiskBlocks(query?: {
    productId?: string;
    workspaceId?: string | null;
    subjectType?: RuntimeStoreRiskBlock['subjectType'];
    subjectId?: string;
    scope?: string;
  }): Promise<RuntimeStoreRiskBlock[]>;
  createFile(
    input: RuntimeStoreScope & {
      moduleId: string;
      ownerId?: string | null;
      name: string;
      purpose: ModuleFilePurpose;
      status?: ModuleFileStatus;
      visibility?: ModuleFileVisibility;
      contentType?: string;
      sizeBytes?: number;
      checksum?: string;
      storageKey: string;
      runId?: string;
      metadata?: Record<string, unknown>;
      expiresAt?: string;
    }
  ): Promise<RuntimeStoreFileRecord>;
  getFile(id: string): Promise<RuntimeStoreFileRecord | null>;
  updateFile(
    id: string,
    patch: Partial<
      Pick<
        RuntimeStoreFileRecord,
        | 'status'
        | 'visibility'
        | 'contentType'
        | 'sizeBytes'
        | 'checksum'
        | 'metadata'
        | 'expiresAt'
        | 'publishedAt'
        | 'deletedAt'
      >
    > & {
      quarantinedAt?: string;
    }
  ): Promise<RuntimeStoreFileRecord>;
  listFiles(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
    ownerId?: string;
    purpose?: ModuleFilePurpose;
    status?: ModuleFileStatus;
    visibility?: ModuleFileVisibility;
    runId?: string;
    includeDeleted?: boolean;
  }): Promise<RuntimeStoreFileRecord[]>;
  upsertCatalogState(state: ModuleCatalogModuleState): Promise<ModuleCatalogModuleState>;
  listCatalogStates(query?: {
    productId?: string;
    status?: ModuleCatalogModuleStatus;
  }): Promise<ModuleCatalogModuleState[]>;
  upsertMembership(
    membership: Omit<RuntimeStoreMembership, 'id' | 'updatedAt'> & {
      id?: string;
      updatedAt?: string;
    }
  ): Promise<RuntimeStoreMembership>;
  listMemberships(query?: {
    productId?: string;
    workspaceId?: string;
    userId?: string;
  }): Promise<RuntimeStoreMembership[]>;
  upsertProductScopeProduct(product: ProductScopeProduct): Promise<ProductScopeProduct>;
  listProductScopeProducts(query?: { productId?: string }): Promise<ProductScopeProduct[]>;
  upsertProductScopeWorkspace(workspace: ProductScopeWorkspace): Promise<ProductScopeWorkspace>;
  listProductScopeWorkspaces(query?: {
    productId?: string;
    workspaceId?: string;
  }): Promise<ProductScopeWorkspace[]>;
  upsertProductScopeDomainAlias(alias: ProductScopeDomainAlias): Promise<ProductScopeDomainAlias>;
  listProductScopeDomainAliases(query?: {
    productId?: string;
    hostname?: string;
  }): Promise<ProductScopeDomainAlias[]>;
  upsertProductScopeInvite(invite: ProductScopeInvite): Promise<ProductScopeInvite>;
  listProductScopeInvites(query?: {
    productId?: string;
    workspaceId?: string;
    status?: ProductScopeInvite['status'];
    token?: string;
  }): Promise<ProductScopeInvite[]>;
  upsertHostUser(
    user: Omit<RuntimeStoreHostUser, 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<RuntimeStoreHostUser>;
  getHostUser(id: string): Promise<RuntimeStoreHostUser | null>;
  findHostUserByEmail(email: string): Promise<RuntimeStoreHostUser | null>;
  listHostUsers(query?: {
    productId?: string;
    role?: RuntimeStoreHostUserRole;
    status?: RuntimeStoreHostUserStatus;
  }): Promise<RuntimeStoreHostUser[]>;
  updateHostUserStatus(
    id: string,
    status: RuntimeStoreHostUserStatus,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStoreHostUser>;
  upsertSetting<TValue = unknown>(
    input: UpsertRuntimeStoreSettingInput<TValue>
  ): Promise<RuntimeStoreSettingRecord<TValue>>;
  getSetting<TValue = unknown>(query: {
    productId: string;
    namespace: string;
    key: string;
    workspaceId?: string | null;
    status?: RuntimeStoreSettingStatus;
  }): Promise<RuntimeStoreSettingRecord<TValue> | null>;
  listSettings<TValue = unknown>(query?: {
    productId?: string;
    workspaceId?: string | null;
    namespace?: string;
    status?: RuntimeStoreSettingStatus;
  }): Promise<RuntimeStoreSettingRecord<TValue>[]>;
  upsertServiceConnection(
    input: UpsertRuntimeStoreServiceConnectionInput
  ): Promise<RuntimeStoreServiceConnectionRecord>;
  getServiceConnection(
    productId: string,
    connectionId: string
  ): Promise<RuntimeStoreServiceConnectionRecord | null>;
  listServiceConnections(query?: {
    productId?: string;
    workspaceId?: string | null;
    service?: string;
    provider?: string;
    status?: RuntimeStoreServiceConnectionStatus;
  }): Promise<RuntimeStoreServiceConnectionRecord[]>;
  touchServiceConnection(
    productId: string,
    connectionId: string,
    patch?: { health?: Record<string, unknown>; metadata?: Record<string, unknown> }
  ): Promise<RuntimeStoreServiceConnectionRecord>;
  upsertResourceBinding<TValue = unknown>(
    input: UpsertRuntimeStoreResourceBindingInput<TValue>
  ): Promise<RuntimeStoreResourceBindingRecord<TValue>>;
  listResourceBindings<TValue = unknown>(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string | null;
    name?: string;
    kind?: string;
    status?: RuntimeStoreResourceBindingStatus;
  }): Promise<RuntimeStoreResourceBindingRecord<TValue>[]>;
}
