import type {
  ModuleFilePurpose,
  ModuleFileStatus,
  ModuleFileVisibility,
  ModuleNotificationChannel,
  ModuleNotificationStatus,
} from '@ploykit/module-sdk';
import type { ModuleRunLogEntry, ModuleRunRecord, ModuleRunStatus } from '../runs';
import type { ModuleCatalogModuleState, ModuleCatalogModuleStatus } from '../catalog';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeProduct,
  ProductScopeWorkspace,
} from '../scope/product-scope-types';
import type { RuntimeStoreScope } from './runtime-store-common-types';
import type {
  CreateRuntimeStoreCreditNoteInput,
  CreateRuntimeStoreSubscriptionEventInput,
  RuntimeStoreBillingAccount,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialCatalogKind,
  RuntimeStoreCommercialCatalogStatus,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreCreditNoteStatus,
  RuntimeStoreCreditReservation,
  RuntimeStoreCreditReservationStatus,
  RuntimeStoreCreditStatus,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
  RuntimeStoreInvoiceRecord,
  RuntimeStoreInvoiceStatus,
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreMeteringStatus,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
  RuntimeStoreRevenueBucket,
  RuntimeStoreSettlementBatch,
  RuntimeStoreSettlementBatchStatus,
  RuntimeStoreSubscriptionEventRecord,
  RuntimeStoreSubscriptionEventType,
  RuntimeStoreSubscriptionRecord,
  RuntimeStoreSubscriptionStatus,
  RuntimeStoreTaxProfileRecord,
  UpsertRuntimeStoreBillingAccountInput,
  UpsertRuntimeStoreCommercialCatalogItemInput,
  UpsertRuntimeStoreInvoiceInput,
  UpsertRuntimeStoreRevenueBucketInput,
  UpsertRuntimeStoreSettlementBatchInput,
  UpsertRuntimeStoreSubscriptionInput,
  UpsertRuntimeStoreTaxProfileInput,
} from './runtime-store-commercial-types';
import type {
  CreateRuntimeStoreRunInput,
  CreateRuntimeStoreWebhookReceiptInput,
  EnqueueRuntimeStoreOutboxInput,
  ListRuntimeStoreRunsQuery,
  RecordRuntimeStoreDeliveryInput,
  RuntimeStoreDeliveryKind,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreDeliveryStatus,
  RuntimeStoreOutboxRecord,
  RuntimeStoreOutboxStatus,
  RuntimeStoreWebhookReceipt,
  RuntimeStoreWebhookReceiptStatus,
  RuntimeStoreWorkerRecord,
  RuntimeStoreWorkerStatus,
  UpsertRuntimeStoreWorkerInput,
} from './runtime-store-execution-types';
import type {
  CreateRuntimeStoreNotificationInput,
  RuntimeStoreNotificationCategory,
  RuntimeStoreNotificationDeliveryRecord,
  RuntimeStoreNotificationDeliveryStatus,
  RuntimeStoreNotificationRecord,
} from './runtime-store-notification-types';
import type {
  RecordRuntimeStoreProviderInvocationInput,
  RuntimeStoreAuditRecord,
  RuntimeStoreProviderInvocationRecord,
  RuntimeStoreProviderInvocationStatus,
  RuntimeStoreUsageRecord,
} from './runtime-store-observability-types';
import type {
  RuntimeStoreRagChunkRecord,
  RuntimeStoreRagSourceRecord,
  RuntimeStoreRagSourceStatus,
  UpsertRuntimeStoreRagChunkInput,
  UpsertRuntimeStoreRagSourceInput,
} from './runtime-store-rag-types';
import type {
  CreateRuntimeStoreAuthSessionInput,
  CreateRuntimeStoreApiKeyInput,
  RuntimeStoreAuthSession,
  RuntimeStoreAuthSessionStatus,
  RuntimeStoreAuthSessionSubjectType,
  RuntimeStoreApiKeyRecord,
  RuntimeStoreApiKeyStatus,
  RuntimeStoreHostUser,
  RuntimeStoreHostUserRole,
  RuntimeStoreHostUserStatus,
  RuntimeStoreMembership,
  RuntimeStorePlatformUser,
  RuntimeStorePlatformUserStatus,
  RuntimeStoreUserIdentity,
  RuntimeStoreUserIdentityStatus,
  RuntimeStoreWorkspaceInvite,
  RuntimeStoreWorkspaceInviteStatus,
  RuntimeStoreWorkspaceMember,
  RuntimeStoreWorkspaceMemberStatus,
  UpsertRuntimeStorePlatformUserInput,
  UpsertRuntimeStoreUserIdentityInput,
  UpsertRuntimeStoreWorkspaceInviteInput,
  UpsertRuntimeStoreWorkspaceMemberInput,
} from './runtime-store-identity-types';
import type {
  BeginRuntimeStoreIdempotencyKeyInput,
  CompleteRuntimeStoreIdempotencyKeyInput,
  DeleteExpiredRuntimeStoreIdempotencyKeysQuery,
  ListRuntimeStoreIdempotencyKeysQuery,
  RuntimeStoreIdempotencyBeginResult,
  RuntimeStoreIdempotencyRecord,
  RuntimeStoreIdempotencyStatus,
} from './runtime-store-idempotency-types';
import type { RuntimeStoreRiskBlock, RuntimeStoreRiskEvent } from './runtime-store-risk-types';
import type { RuntimeStoreFileRecord } from './runtime-store-file-types';
import type {
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreResourceBindingStatus,
  RuntimeStoreServiceConnectionRecord,
  RuntimeStoreServiceConnectionStatus,
  RuntimeStoreSettingRecord,
  RuntimeStoreSettingStatus,
  UpsertRuntimeStoreResourceBindingInput,
  UpsertRuntimeStoreServiceConnectionInput,
  UpsertRuntimeStoreSettingInput,
} from './runtime-store-config-types';

export type { RuntimeStoreScope } from './runtime-store-common-types';

export type {
  CreateRuntimeStoreCreditNoteInput,
  CreateRuntimeStoreSubscriptionEventInput,
  RuntimeStoreBillingAccount,
  RuntimeStoreBillingAccountStatus,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialCatalogKind,
  RuntimeStoreCommercialCatalogStatus,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreCreditNoteStatus,
  RuntimeStoreCreditReservation,
  RuntimeStoreCreditReservationStatus,
  RuntimeStoreCreditStatus,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
  RuntimeStoreInvoiceRecord,
  RuntimeStoreInvoiceStatus,
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreMeteringStatus,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
  RuntimeStoreRevenueBucket,
  RuntimeStoreSettlementBatch,
  RuntimeStoreSettlementBatchStatus,
  RuntimeStoreSubscriptionEventRecord,
  RuntimeStoreSubscriptionEventType,
  RuntimeStoreSubscriptionRecord,
  RuntimeStoreSubscriptionStatus,
  RuntimeStoreTaxProfileRecord,
  UpsertRuntimeStoreBillingAccountInput,
  UpsertRuntimeStoreCommercialCatalogItemInput,
  UpsertRuntimeStoreInvoiceInput,
  UpsertRuntimeStoreRevenueBucketInput,
  UpsertRuntimeStoreSettlementBatchInput,
  UpsertRuntimeStoreSubscriptionInput,
  UpsertRuntimeStoreTaxProfileInput,
} from './runtime-store-commercial-types';

export type {
  CreateRuntimeStoreRunInput,
  CreateRuntimeStoreWebhookReceiptInput,
  EnqueueRuntimeStoreOutboxInput,
  ListRuntimeStoreRunsQuery,
  RecordRuntimeStoreDeliveryInput,
  RuntimeStoreDeliveryKind,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreDeliveryStatus,
  RuntimeStoreOutboxRecord,
  RuntimeStoreOutboxStatus,
  RuntimeStoreWebhookReceipt,
  RuntimeStoreWebhookReceiptStatus,
  RuntimeStoreWorkerRecord,
  RuntimeStoreWorkerStatus,
  UpsertRuntimeStoreWorkerInput,
} from './runtime-store-execution-types';

export type {
  CreateRuntimeStoreNotificationInput,
  RuntimeStoreNotificationCategory,
  RuntimeStoreNotificationDeliveryRecord,
  RuntimeStoreNotificationDeliveryStatus,
  RuntimeStoreNotificationRecord,
} from './runtime-store-notification-types';

export type {
  RecordRuntimeStoreProviderInvocationInput,
  RuntimeStoreAuditRecord,
  RuntimeStoreProviderInvocationRecord,
  RuntimeStoreProviderInvocationStatus,
  RuntimeStoreUsageRecord,
} from './runtime-store-observability-types';

export type {
  RuntimeStoreRagChunkRecord,
  RuntimeStoreRagSourceRecord,
  RuntimeStoreRagSourceStatus,
  UpsertRuntimeStoreRagChunkInput,
  UpsertRuntimeStoreRagSourceInput,
} from './runtime-store-rag-types';

export type {
  CreateRuntimeStoreAuthSessionInput,
  CreateRuntimeStoreApiKeyInput,
  RuntimeStoreAuthSession,
  RuntimeStoreAuthSessionStatus,
  RuntimeStoreAuthSessionSubjectType,
  RuntimeStoreApiKeyRecord,
  RuntimeStoreApiKeyStatus,
  RuntimeStoreHostUser,
  RuntimeStoreHostUserRole,
  RuntimeStoreHostUserStatus,
  RuntimeStoreMembership,
  RuntimeStorePlatformUser,
  RuntimeStorePlatformUserStatus,
  RuntimeStoreUserIdentity,
  RuntimeStoreUserIdentityStatus,
  RuntimeStoreWorkspaceInvite,
  RuntimeStoreWorkspaceInviteStatus,
  RuntimeStoreWorkspaceMember,
  RuntimeStoreWorkspaceMemberStatus,
  UpsertRuntimeStorePlatformUserInput,
  UpsertRuntimeStoreUserIdentityInput,
  UpsertRuntimeStoreWorkspaceInviteInput,
  UpsertRuntimeStoreWorkspaceMemberInput,
} from './runtime-store-identity-types';

export type {
  BeginRuntimeStoreIdempotencyKeyInput,
  CompleteRuntimeStoreIdempotencyKeyInput,
  DeleteExpiredRuntimeStoreIdempotencyKeysQuery,
  ListRuntimeStoreIdempotencyKeysQuery,
  RuntimeStoreIdempotencyBeginResult,
  RuntimeStoreIdempotencyRecord,
  RuntimeStoreIdempotencyStatus,
} from './runtime-store-idempotency-types';

export type { RuntimeStoreRiskBlock, RuntimeStoreRiskEvent } from './runtime-store-risk-types';

export type { RuntimeStoreFileRecord } from './runtime-store-file-types';

export type {
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreResourceBindingStatus,
  RuntimeStoreServiceConnectionRecord,
  RuntimeStoreServiceConnectionStatus,
  RuntimeStoreSettingRecord,
  RuntimeStoreSettingStatus,
  UpsertRuntimeStoreResourceBindingInput,
  UpsertRuntimeStoreServiceConnectionInput,
  UpsertRuntimeStoreSettingInput,
} from './runtime-store-config-types';

export interface RuntimeStore {
  ensureSchema?(): Promise<void>;
  transaction?<T>(callback: (tx: RuntimeStore) => Promise<T>): Promise<T>;
  beginIdempotencyKey(
    input: BeginRuntimeStoreIdempotencyKeyInput
  ): Promise<RuntimeStoreIdempotencyBeginResult>;
  completeIdempotencyKey(
    input: CompleteRuntimeStoreIdempotencyKeyInput
  ): Promise<RuntimeStoreIdempotencyRecord>;
  getIdempotencyKey(id: string): Promise<RuntimeStoreIdempotencyRecord | null>;
  listIdempotencyKeys(
    query?: ListRuntimeStoreIdempotencyKeysQuery
  ): Promise<RuntimeStoreIdempotencyRecord[]>;
  deleteExpiredIdempotencyKeys(
    query?: DeleteExpiredRuntimeStoreIdempotencyKeysQuery
  ): Promise<number>;
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
    environmentId?: string | null;
    workspaceId?: string | null;
    status?: RuntimeStoreOutboxStatus;
    name?: string;
    namePrefix?: string;
  }): Promise<RuntimeStoreOutboxRecord[]>;
  claimOutbox(query?: {
    productId?: string;
    environmentId?: string | null;
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
    workspaceId: string | null | undefined,
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
    environmentId?: string | null;
    workspaceId?: string | null;
    userId?: string;
    unit?: string;
    status?: RuntimeStoreCreditStatus;
  }): Promise<RuntimeStoreCreditLedgerEntry[]>;
  getCreditBalance(query: {
    productId: string;
    environmentId?: string | null;
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
      expiresAt?: string;
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
    environmentId?: string | null;
    workspaceId?: string | null;
    userId?: string;
    unit?: string;
    status?: RuntimeStoreCreditReservationStatus;
    source?: string;
    sourceId?: string;
    expiresBefore?: string;
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
      maxRedemptions?: number;
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
    environmentId?: string | null;
    workspaceId?: string | null;
    id: string;
  }): Promise<RuntimeStoreApiKeyRecord | null>;
  findApiKeyByHash(input: {
    productId?: string;
    environmentId?: string | null;
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
      rateLimit?: Record<string, unknown> | null;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreApiKeyRecord>;
  listApiKeys(query?: {
    productId?: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    moduleId?: string | null;
    ownerSubjectType?: RuntimeStoreApiKeyRecord['ownerSubjectType'];
    ownerSubjectId?: string;
    status?: RuntimeStoreApiKeyStatus;
  }): Promise<RuntimeStoreApiKeyRecord[]>;
  recordRiskEvent(
    input: RuntimeStoreScope & {
      id?: string;
      subjectType?: RuntimeStoreRiskEvent['subjectType'];
      subjectId?: string;
      type: string;
      severity?: RuntimeStoreRiskEvent['severity'];
      status?: RuntimeStoreRiskEvent['status'];
      source?: string;
      sourceId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreRiskEvent>;
  upsertRiskBlock(
    input: RuntimeStoreScope & {
      id?: string;
      subjectType: RuntimeStoreRiskBlock['subjectType'];
      subjectId: string;
      scope?: string;
      reason: string;
      expiresAt?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreRiskBlock>;
  releaseRiskBlock(
    id: string,
    patch?: {
      releasedAt?: string;
      releasedBy?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreRiskBlock>;
  listRiskEvents(query?: {
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string | null;
    subjectType?: RuntimeStoreRiskEvent['subjectType'];
    subjectId?: string;
    type?: string;
    severity?: RuntimeStoreRiskEvent['severity'];
    status?: RuntimeStoreRiskEvent['status'];
    source?: string;
    sourceId?: string;
  }): Promise<RuntimeStoreRiskEvent[]>;
  listRiskBlocks(query?: {
    productId?: string;
    workspaceId?: string | null;
    subjectType?: RuntimeStoreRiskBlock['subjectType'];
    subjectId?: string;
    scope?: string;
    includeReleased?: boolean;
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
  upsertPlatformUser(input: UpsertRuntimeStorePlatformUserInput): Promise<RuntimeStorePlatformUser>;
  getPlatformUser(id: string): Promise<RuntimeStorePlatformUser | null>;
  findPlatformUserByEmail(email: string): Promise<RuntimeStorePlatformUser | null>;
  listPlatformUsers(query?: {
    status?: RuntimeStorePlatformUserStatus;
  }): Promise<RuntimeStorePlatformUser[]>;
  updatePlatformUserStatus(
    id: string,
    status: RuntimeStorePlatformUserStatus,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStorePlatformUser>;
  upsertWorkspaceMember(
    input: UpsertRuntimeStoreWorkspaceMemberInput
  ): Promise<RuntimeStoreWorkspaceMember>;
  listWorkspaceMembers(query?: {
    productId?: string;
    workspaceId?: string;
    platformUserId?: string;
    status?: RuntimeStoreWorkspaceMemberStatus;
  }): Promise<RuntimeStoreWorkspaceMember[]>;
  updateWorkspaceMemberStatus(
    id: string,
    status: RuntimeStoreWorkspaceMemberStatus,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStoreWorkspaceMember>;
  upsertWorkspaceInvite(
    input: UpsertRuntimeStoreWorkspaceInviteInput
  ): Promise<RuntimeStoreWorkspaceInvite>;
  getWorkspaceInvite(id: string): Promise<RuntimeStoreWorkspaceInvite | null>;
  findWorkspaceInviteByTokenHash(tokenHash: string): Promise<RuntimeStoreWorkspaceInvite | null>;
  listWorkspaceInvites(query?: {
    productId?: string;
    workspaceId?: string;
    status?: RuntimeStoreWorkspaceInviteStatus;
    email?: string;
  }): Promise<RuntimeStoreWorkspaceInvite[]>;
  updateWorkspaceInviteStatus(
    id: string,
    status: RuntimeStoreWorkspaceInviteStatus,
    patch?: {
      acceptedByPlatformUserId?: string;
      acceptedAt?: string;
      revokedAt?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreWorkspaceInvite>;
  createAuthSession(input: CreateRuntimeStoreAuthSessionInput): Promise<RuntimeStoreAuthSession>;
  getAuthSession(id: string): Promise<RuntimeStoreAuthSession | null>;
  listAuthSessions(query?: {
    productId?: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    subjectType?: RuntimeStoreAuthSessionSubjectType;
    subjectId?: string;
    status?: RuntimeStoreAuthSessionStatus;
    sessionType?: string;
  }): Promise<RuntimeStoreAuthSession[]>;
  touchAuthSession(
    id: string,
    patch?: {
      lastSeenAt?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreAuthSession>;
  revokeAuthSession(
    id: string,
    patch?: {
      revokedAt?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<RuntimeStoreAuthSession>;
  revokeAuthSessions(query: {
    productId?: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    subjectType?: RuntimeStoreAuthSessionSubjectType;
    subjectId?: string;
    excludeId?: string;
    reason?: string;
    revokedAt?: string;
  }): Promise<RuntimeStoreAuthSession[]>;
  upsertUserIdentity(
    input: UpsertRuntimeStoreUserIdentityInput
  ): Promise<RuntimeStoreUserIdentity>;
  findUserIdentity(query: {
    productId: string;
    environmentId?: string | null;
    provider: string;
    providerKey: string;
    status?: RuntimeStoreUserIdentityStatus;
  }): Promise<RuntimeStoreUserIdentity | null>;
  listUserIdentities(query?: {
    productId?: string;
    environmentId?: string | null;
    userId?: string;
    provider?: string;
    status?: RuntimeStoreUserIdentityStatus;
  }): Promise<RuntimeStoreUserIdentity[]>;
  updateUserIdentityStatus(
    id: string,
    status: RuntimeStoreUserIdentityStatus,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeStoreUserIdentity>;
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
