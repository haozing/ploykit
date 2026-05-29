import { randomUUID } from 'node:crypto';
import type { ModuleRunLogEntry, ModuleRunRecord, ModuleRunStatus } from '../runs';
import type { ModuleDataPostgresExecutor } from '../data';
import type { ModuleCatalogModuleState } from '../catalog';
import { redactSensitive } from '../observability/redaction';
import { createAuditEnvelope, splitAuditEnvelope } from '../observability/audit-metadata';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeProduct,
  ProductScopeWorkspace,
} from '../scope/product-scope-types';
import { applyRuntimeStoreMigration } from './runtime-store-migrations';
import type {
  CreateRuntimeStoreRunInput,
  CreateRuntimeStoreNotificationInput,
  CreateRuntimeStoreWebhookReceiptInput,
  EnqueueRuntimeStoreOutboxInput,
  RuntimeStore,
  RuntimeStoreApiKeyRecord,
  RuntimeStoreAuditRecord,
  RuntimeStoreBillingAccount,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreFileRecord,
  RuntimeStoreHostUser,
  RuntimeStoreHostUserStatus,
  RuntimeStoreInvoiceRecord,
  RuntimeStoreMembership,
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreMeteringStatus,
  RuntimeStoreNotificationDeliveryRecord,
  RuntimeStoreNotificationRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreOutboxStatus,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
  RuntimeStoreRagChunkRecord,
  RuntimeStoreRagSourceRecord,
  RuntimeStoreProviderInvocationRecord,
  RuntimeStoreRevenueBucket,
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreRiskBlock,
  RuntimeStoreRiskEvent,
  RuntimeStoreServiceConnectionRecord,
  RuntimeStoreSettingRecord,
  RuntimeStoreSettlementBatch,
  RuntimeStoreSubscriptionEventRecord,
  RuntimeStoreSubscriptionRecord,
  RuntimeStoreTaxProfileRecord,
  RuntimeStoreUsageRecord,
  RuntimeStoreWebhookReceipt,
  RuntimeStoreWebhookReceiptStatus,
  RuntimeStoreWorkerRecord,
} from './runtime-store-types';

export interface CreatePostgresRuntimeStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId?: (prefix: string) => string;
}

type Row = Record<string, any>;

function createDefaultId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function json(value: unknown): unknown {
  return value === undefined ? null : JSON.stringify(value);
}

function toIso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function runtimeWorkspaceKey(workspaceId?: string | null): string {
  return workspaceId ?? '';
}

function runtimeWorkspaceFilter(workspaceId?: string | null): string | null {
  return workspaceId === undefined ? null : runtimeWorkspaceKey(workspaceId);
}

function creditWorkspaceKey(workspaceId?: string | null): string {
  return runtimeWorkspaceKey(workspaceId);
}

function creditWorkspaceFilter(workspaceId?: string | null): string | null {
  return runtimeWorkspaceFilter(workspaceId);
}

function orderWorkspaceKey(workspaceId?: string | null): string {
  return runtimeWorkspaceKey(workspaceId);
}

function orderWorkspaceFilter(workspaceId?: string | null): string | null {
  return runtimeWorkspaceFilter(workspaceId);
}

function errorFrom(error?: Error | string): { code: string; message: string } | undefined {
  if (!error) {
    return undefined;
  }
  return typeof error === 'string'
    ? { code: 'RUNTIME_STORE_ERROR', message: error }
    : { code: error.name || 'RUNTIME_STORE_ERROR', message: error.message };
}

function deliveryErrorFrom(
  error?: Error | string | { code: string; message: string }
): { code: string; message: string } | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'object' && 'code' in error && 'message' in error) {
    return error;
  }
  return errorFrom(error);
}

function mapRun(row: Row, logs: ModuleRunLogEntry[] = []): ModuleRunRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    progress: Number(row.progress),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    input: row.input ?? undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    costRef: row.cost_ref ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    cancelRequestedAt: toIso(row.cancel_requested_at),
    canceledAt: toIso(row.canceled_at),
    logs,
  };
}

function mapOutbox(row: Row): RuntimeStoreOutboxRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    moduleId: row.module_id,
    name: row.name,
    payload: row.payload,
    metadata: row.metadata ?? {},
    status: row.status,
    attempts: Number(row.attempts),
    idempotencyKey: row.idempotency_key ?? undefined,
    scheduledAt: toIso(row.scheduled_at),
    priority: row.priority === undefined ? 0 : Number(row.priority),
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: toIso(row.lease_expires_at),
    heartbeatAt: toIso(row.heartbeat_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    processedAt: toIso(row.processed_at),
    error: row.error ?? undefined,
  };
}

function mapDelivery(row: Row): RuntimeStoreDeliveryRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id ?? null,
    actorId: row.actor_id ?? null,
    kind: row.kind,
    source: row.source,
    target: row.target,
    status: row.status,
    attempts: Number(row.attempts),
    outboxId: row.outbox_id ?? null,
    runId: row.run_id ?? null,
    receiptId: row.receipt_id ?? null,
    eventId: row.event_id ?? null,
    emailId: row.email_id ?? null,
    workerId: row.worker_id ?? null,
    correlationId: row.correlation_id ?? null,
    causationId: row.causation_id ?? null,
    nextRetryAt: toIso(row.next_retry_at) ?? null,
    errorCategory: row.error_category ?? null,
    error: row.error ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapWorker(row: Row): RuntimeStoreWorkerRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id || null,
    workerId: row.worker_id,
    profile: row.profile,
    status: row.status,
    queueProfile: row.queue_profile,
    heartbeatAt: toIso(row.heartbeat_at)!,
    lastDrainAt: toIso(row.last_drain_at) ?? null,
    lastDurationMs: Number(row.last_duration_ms),
    processed: Number(row.processed),
    failed: Number(row.failed),
    deadLettered: Number(row.dead_lettered),
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapReceipt(row: Row): RuntimeStoreWebhookReceipt {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    moduleId: row.module_id,
    webhookName: row.webhook_name,
    path: row.path,
    method: row.method,
    status: row.status,
    attempts: Number(row.attempts),
    idempotencyKey: row.idempotency_key ?? undefined,
    signature: row.signature ?? undefined,
    headers: row.headers ?? undefined,
    bodyText: row.body_text ?? undefined,
    bodyDigest: row.body_digest ?? undefined,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    processedAt: toIso(row.processed_at),
    error: row.error ?? undefined,
  };
}

function mapNotification(row: Row): RuntimeStoreNotificationRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    moduleId: row.module_id,
    userId: row.user_id,
    channel: row.channel,
    title: row.title,
    body: row.body ?? undefined,
    actionUrl: row.action_url ?? undefined,
    runId: row.run_id ?? undefined,
    source: row.source,
    category: row.category,
    status: row.status,
    deliveryStatus: row.delivery_status,
    idempotencyKey: row.idempotency_key ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    readAt: toIso(row.read_at),
    deliveredAt: toIso(row.delivered_at),
    skippedAt: toIso(row.skipped_at),
    error: row.error ?? undefined,
  };
}

function mapNotificationDelivery(row: Row): RuntimeStoreNotificationDeliveryRecord {
  return {
    id: row.id,
    notificationId: row.notification_id ?? null,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    reason: row.reason ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
  };
}

function mapAudit(row: Row): RuntimeStoreAuditRecord {
  const envelope = splitAuditEnvelope(row.metadata ?? {});
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    moduleId: row.module_id,
    actorId: row.actor_id,
    type: row.type,
    metadata: envelope.metadata,
    integrity: envelope.integrity,
    createdAt: toIso(row.created_at)!,
  };
}

function mapUsage(row: Row): RuntimeStoreUsageRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    moduleId: row.module_id,
    meter: row.meter,
    quantity: Number(row.quantity),
    unit: row.unit ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
  };
}

function mapMetering(row: Row): RuntimeStoreMeteringLedgerEntry {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    moduleId: row.module_id,
    meter: row.meter,
    quantity: Number(row.quantity),
    unit: row.unit ?? undefined,
    status: row.status,
    idempotencyKey: row.idempotency_key ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapCreditLedger(row: Row): RuntimeStoreCreditLedgerEntry {
  const expiresAt = toIso(row.expires_at);
  const status =
    row.status === 'available' && expiresAt && new Date(expiresAt).getTime() <= Date.now()
      ? 'expired'
      : row.status;
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    amount: Number(row.amount),
    unit: row.unit,
    reason: row.reason,
    status,
    idempotencyKey: row.idempotency_key ?? undefined,
    expiresAt,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
  };
}

function mapCreditReservation(row: Row): RuntimeStoreCreditReservation {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    userId: row.user_id,
    amountReserved: Number(row.amount_reserved),
    amountCommitted: Number(row.amount_committed),
    unit: row.unit,
    status: row.status,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    sourceId: row.source_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapEntitlement(row: Row): RuntimeStoreEntitlementGrant {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    entitlement: row.entitlement,
    planId: row.plan_id ?? undefined,
    source: row.source,
    status: row.status,
    idempotencyKey: row.idempotency_key ?? undefined,
    expiresAt: toIso(row.expires_at),
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapCommercialCatalogItem(row: Row): RuntimeStoreCommercialCatalogItem {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    kind: row.kind,
    itemId: row.item_id,
    version: Number(row.version),
    status: row.status,
    value: row.value_json,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapCommercialOrder(row: Row): RuntimeStoreCommercialOrder {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    sku: row.sku,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    provider: row.provider ?? undefined,
    providerRef: row.provider_ref ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapBillingAccount(row: Row): RuntimeStoreBillingAccount {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    userId: row.user_id,
    status: row.status,
    customerProfile: row.customer_profile ?? {},
    providerCustomers: row.provider_customers ?? {},
    paymentMethods: Array.isArray(row.payment_methods) ? row.payment_methods : [],
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapInvoice(row: Row): RuntimeStoreInvoiceRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    userId: row.user_id,
    orderId: row.order_id ?? null,
    subscriptionId: row.subscription_id ?? null,
    number: row.number,
    status: row.status,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    tax: Number(row.tax),
    total: Number(row.total),
    refunded: Number(row.refunded),
    fee: Number(row.fee),
    net: Number(row.net),
    currency: row.currency,
    provider: row.provider ?? null,
    providerRef: row.provider_ref ?? null,
    documentFileId: row.document_file_id ?? null,
    taxSnapshot: row.tax_snapshot ?? {},
    lines: Array.isArray(row.lines) ? row.lines : [],
    metadata: row.metadata ?? {},
    issuedAt: toIso(row.issued_at) ?? null,
    dueAt: toIso(row.due_at) ?? null,
    paidAt: toIso(row.paid_at) ?? null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapCreditNote(row: Row): RuntimeStoreCreditNoteRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    orderId: row.order_id ?? null,
    invoiceId: row.invoice_id ?? null,
    number: row.number,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    reason: row.reason,
    provider: row.provider ?? null,
    providerRef: row.provider_ref ?? null,
    lines: row.lines ?? [],
    metadata: row.metadata ?? {},
    issuedAt: toIso(row.issued_at)!,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapSubscription(row: Row): RuntimeStoreSubscriptionRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    userId: row.user_id,
    planId: row.plan_id,
    status: row.status,
    provider: row.provider ?? null,
    providerRef: row.provider_ref ?? null,
    currentPeriodStart: toIso(row.current_period_start) ?? null,
    currentPeriodEnd: toIso(row.current_period_end) ?? null,
    trialEnd: toIso(row.trial_end) ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    renewalStrategy: row.renewal_strategy,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapSubscriptionEvent(row: Row): RuntimeStoreSubscriptionEventRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    subscriptionId: row.subscription_id,
    planId: row.plan_id,
    type: row.type,
    status: row.status,
    provider: row.provider ?? null,
    providerRef: row.provider_ref ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    effectiveAt: toIso(row.effective_at)!,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
  };
}

function mapTaxProfile(row: Row): RuntimeStoreTaxProfileRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    userId: row.user_id,
    status: row.status,
    jurisdiction: row.jurisdiction ?? null,
    validationStatus: row.validation_status,
    profile: row.profile ?? {},
    evidence: row.evidence ?? {},
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapRevenueBucket(row: Row): RuntimeStoreRevenueBucket {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    bucketDate: toIso(row.bucket_date)?.slice(0, 10) ?? String(row.bucket_date),
    currency: row.currency,
    gross: Number(row.gross),
    discount: Number(row.discount),
    tax: Number(row.tax),
    refund: Number(row.refund),
    fee: Number(row.fee),
    net: Number(row.net),
    orders: Number(row.orders),
    provider: row.provider ?? null,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapProviderInvocation(row: Row): RuntimeStoreProviderInvocationRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id ?? null,
    providerId: row.provider_id,
    kind: row.kind,
    operation: row.operation,
    status: row.status,
    target: row.target ?? null,
    model: row.model ?? null,
    serviceConnectionId: row.service_connection_id ?? null,
    resourceBindingId: row.resource_binding_id ?? null,
    usage: row.usage ?? {},
    cost: row.cost ?? {},
    latencyMs: Number(row.latency_ms),
    correlationId: row.correlation_id ?? null,
    error: row.error ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
  };
}

function mapRagSource(row: Row): RuntimeStoreRagSourceRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id,
    sourceId: row.source_id,
    status: row.status,
    contentDigest: row.content_digest ?? null,
    contentLength: Number(row.content_length),
    chunkCount: Number(row.chunk_count),
    indexedAt: toIso(row.indexed_at) ?? null,
    deletedAt: toIso(row.deleted_at) ?? null,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapRagChunk(row: Row): RuntimeStoreRagChunkRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id,
    sourceId: row.source_id,
    chunkIndex: Number(row.chunk_index),
    content: row.content,
    embedding: Array.isArray(row.embedding) ? row.embedding.map(Number) : [],
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapSettlementBatch(row: Row): RuntimeStoreSettlementBatch {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    currency: row.currency,
    periodStart: toIso(row.period_start)!,
    periodEnd: toIso(row.period_end)!,
    status: row.status,
    gross: Number(row.gross),
    refund: Number(row.refund),
    fee: Number(row.fee),
    net: Number(row.net),
    orderCount: Number(row.order_count),
    invoiceCount: Number(row.invoice_count),
    creditNoteCount: Number(row.credit_note_count),
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapRedeemCode(row: Row): RuntimeStoreRedeemCode {
  return {
    productId: row.product_id,
    code: row.code,
    entitlement: row.entitlement ?? undefined,
    creditsAmount: row.credits_amount === null ? undefined : Number(row.credits_amount),
    creditsUnit: row.credits_unit,
    maxRedemptions: Number(row.max_redemptions),
    expiresAt: toIso(row.expires_at),
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapRedeemRedemption(row: Row): RuntimeStoreRedeemRedemption {
  return {
    id: row.id,
    productId: row.product_id,
    code: row.code,
    userId: row.user_id,
    entitlement: row.entitlement ?? undefined,
    creditsAmount: row.credits_amount === null ? undefined : Number(row.credits_amount),
    creditsUnit: row.credits_unit ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
  };
}

function mapApiKey(row: Row): RuntimeStoreApiKeyRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id ?? null,
    name: row.name,
    prefix: row.prefix,
    keyHash: row.key_hash,
    ownerSubjectType: row.owner_subject_type ?? undefined,
    ownerSubjectId: row.owner_subject_id ?? undefined,
    permissions: row.permissions ?? [],
    status: row.status,
    expiresAt: toIso(row.expires_at),
    revokedAt: toIso(row.revoked_at),
    lastUsedAt: toIso(row.last_used_at),
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapRiskEvent(row: Row): RuntimeStoreRiskEvent {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id ?? null,
    subjectType: row.subject_type ?? undefined,
    subjectId: row.subject_id ?? undefined,
    type: row.type,
    severity: row.severity,
    source: row.source ?? undefined,
    sourceId: row.source_id ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
  };
}

function mapRiskBlock(row: Row): RuntimeStoreRiskBlock {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    scope: row.scope ?? undefined,
    reason: row.reason,
    expiresAt: toIso(row.expires_at),
    idempotencyKey: row.idempotency_key ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapFile(row: Row): RuntimeStoreFileRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    moduleId: row.module_id,
    ownerId: row.owner_id,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    visibility: row.visibility,
    contentType: row.content_type ?? undefined,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum ?? undefined,
    storageKey: row.storage_key,
    runId: row.run_id ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    expiresAt: toIso(row.expires_at),
    publishedAt: toIso(row.published_at),
    deletedAt: toIso(row.deleted_at),
    quarantinedAt: toIso(row.quarantined_at),
  };
}

function mapCatalogState(row: Row): ModuleCatalogModuleState {
  return {
    productId: row.product_id,
    moduleId: row.module_id,
    status: row.status,
    bundleId: row.bundle_id ?? undefined,
    required: Boolean(row.required),
    scopeProfile: row.scope_profile ?? undefined,
    diagnostics: row.diagnostics ?? [],
    updatedAt: toIso(row.updated_at),
  };
}

function mapMembership(row: Row): RuntimeStoreMembership {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapProductScopeProduct(row: Row): ProductScopeProduct {
  return {
    id: row.id,
    name: row.name,
    profile: row.profile,
    defaultWorkspaceId: row.default_workspace_id ?? undefined,
  };
}

function mapProductScopeWorkspace(row: Row): ProductScopeWorkspace {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    slug: row.slug,
    domainAliases: row.domain_aliases ?? undefined,
  };
}

function mapProductScopeDomainAlias(row: Row): ProductScopeDomainAlias {
  return {
    hostname: row.hostname,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? undefined,
  };
}

function mapProductScopeInvite(row: Row): ProductScopeInvite {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    status: row.status,
    token: row.token,
    expiresAt: toIso(row.expires_at)!,
    invitedBy: row.invited_by ?? undefined,
    acceptedBy: row.accepted_by ?? undefined,
  };
}

function mapHostUser(row: Row): RuntimeStoreHostUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    productId: row.product_id,
    workspaceId: row.workspace_id,
    workspaceRole: row.workspace_role,
    permissions: row.permissions ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapSetting(row: Row): RuntimeStoreSettingRecord {
  return {
    id: row.id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    namespace: row.namespace,
    key: row.key,
    value: row.value_json,
    status: row.status,
    version: Number(row.version),
    updatedBy: row.updated_by ?? null,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapServiceConnection(row: Row): RuntimeStoreServiceConnectionRecord {
  return {
    connectionId: row.connection_id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id ?? null,
    service: row.service,
    provider: row.provider,
    status: row.status,
    environment: row.environment ?? undefined,
    ownerType: row.owner_type ?? undefined,
    scopeType: row.scope_type ?? undefined,
    authType: row.auth_type ?? undefined,
    config: row.config ?? {},
    secretRefs: row.secret_refs ?? {},
    health: row.health ?? {},
    lastUsedAt: toIso(row.last_used_at),
    updatedBy: row.updated_by ?? null,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapResourceBinding(row: Row): RuntimeStoreResourceBindingRecord {
  return {
    bindingId: row.binding_id,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? null,
    moduleId: row.module_id ?? null,
    name: row.name,
    kind: row.kind ?? undefined,
    value: row.value_json,
    status: row.status,
    updatedBy: row.updated_by ?? null,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export function createPostgresRuntimeStore(
  options: CreatePostgresRuntimeStoreOptions
): RuntimeStore {
  const database = options.database;
  const createId = options.createId ?? createDefaultId;

  async function readRun(id: string): Promise<ModuleRunRecord> {
    const run = await database.query<Row>('select * from module_runs where id = $1', [id]);
    if (!run.rows[0]) {
      throw new Error(`RUNTIME_STORE_RUN_NOT_FOUND: ${id}`);
    }
    const logs = await database.query<Row>(
      'select * from module_run_logs where run_id = $1 order by at asc, id asc',
      [id]
    );
    return mapRun(
      run.rows[0],
      logs.rows.map((row) => ({
        at: toIso(row.at)!,
        level: row.level,
        message: row.message,
        metadata: row.metadata ?? undefined,
      }))
    );
  }

  return {
    ensureSchema() {
      return applyRuntimeStoreMigration(database);
    },
    async createRun<TInput = unknown>(input: CreateRuntimeStoreRunInput<TInput>) {
      if (input.id) {
        const existingById = await database.query<Row>(
          'select id, idempotency_key from module_runs where id = $1',
          [input.id]
        );
        if (existingById.rows[0]) {
          const existingIdempotencyKey = existingById.rows[0].idempotency_key ?? undefined;
          if (input.idempotencyKey && existingIdempotencyKey === input.idempotencyKey) {
            return readRun(input.id) as Promise<ModuleRunRecord<TInput>>;
          }
          throw new Error(`RUNTIME_STORE_RUN_ID_CONFLICT: ${input.id}`);
        }
      }
      const id = input.id ?? createId('run');
      const result = await database.query<Row>(
        `insert into module_runs (
          id, product_id, workspace_id, module_id, kind, name, status, progress,
          attempt, max_attempts, input, cost_ref, idempotency_key
        )
        values ($1, $2, $3, $4, $5, $6, 'queued', 0, 0, $7, $8::jsonb, $9, $10)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), module_id, idempotency_key)
        where idempotency_key is not null
        do update set updated_at = module_runs.updated_at
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.kind,
          input.name,
          input.maxAttempts ?? 1,
          json(input.input),
          input.costRef ?? null,
          input.idempotencyKey ?? null,
        ]
      );
      return mapRun(result.rows[0]!) as ModuleRunRecord<TInput>;
    },
    async getRun(id) {
      const result = await database.query<Row>('select id from module_runs where id = $1', [id]);
      return result.rows[0] ? readRun(id) : null;
    },
    async listRuns(query = {}) {
      const result = await database.query<Row>(
        `select * from module_runs
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or status = $4)
           and ($5::text is null or kind = $5)
           and ($6::text is null or idempotency_key = $6)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.status ?? null,
          query.kind ?? null,
          query.idempotencyKey ?? null,
        ]
      );
      return result.rows.map((row) => mapRun(row));
    },
    async updateRunStatus(id: string, status: ModuleRunStatus, patch = {}) {
      await database.query(
        `update module_runs
         set status = $2,
             progress = coalesce($3, progress),
             result = coalesce($4::jsonb, result),
             error = $5::jsonb,
             updated_at = now(),
             started_at = case when $2 = 'running' then coalesce(started_at, now()) else started_at end,
             completed_at = case when $2 in ('succeeded', 'failed', 'canceled') then now() else completed_at end,
             cancel_requested_at = case when $2 = 'cancel_requested' then coalesce(cancel_requested_at, now()) else cancel_requested_at end,
             canceled_at = case when $2 = 'canceled' then coalesce(canceled_at, now()) else canceled_at end
         where id = $1`,
        [id, status, patch.progress ?? null, json(patch.result), json(patch.error)]
      );
      return readRun(id);
    },
    async appendRunLog(id, level: ModuleRunLogEntry['level'], message, metadata) {
      await database.query(
        `insert into module_run_logs (run_id, level, message, metadata)
         values ($1, $2, $3, $4::jsonb)`,
        [id, level, message, json(redactSensitive(metadata))]
      );
      await database.query('update module_runs set updated_at = now() where id = $1', [id]);
      return readRun(id);
    },
    async enqueueOutbox<TPayload = unknown>(input: EnqueueRuntimeStoreOutboxInput<TPayload>) {
      const result = await database.query<Row>(
        `insert into module_outbox (
          id, product_id, workspace_id, module_id, name, payload, metadata, status,
          idempotency_key, scheduled_at, priority
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'queued', $8, $9, $10)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), name, idempotency_key)
        where idempotency_key is not null
        do update set updated_at = module_outbox.updated_at
        returning *`,
        [
          createId('outbox'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.name,
          json(input.payload),
          json(input.metadata ?? {}),
          input.idempotencyKey ?? null,
          input.scheduledAt ?? null,
          input.priority ?? 0,
        ]
      );
      return mapOutbox(result.rows[0]!) as RuntimeStoreOutboxRecord<TPayload>;
    },
    async listOutbox(query = {}) {
      const result = await database.query<Row>(
        `select * from module_outbox
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or status = $3)
           and ($4::text is null or name = $4)
           and ($5::text is null or name like $5 || '%')
         order by created_at asc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.status ?? null,
          query.name ?? null,
          query.namePrefix ?? null,
        ]
      );
      return result.rows.map(mapOutbox);
    },
    async claimOutbox(query = {}) {
      const result = await database.query<Row>(
        `with picked as (
           select id
           from module_outbox
           where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or name = $3)
           and ($4::text is null or name like $4 || '%')
           and (
             (status = any($5::text[]) and (scheduled_at is null or scheduled_at <= now()))
             or (status = 'processing' and lease_expires_at is not null and lease_expires_at <= now())
           )
          order by priority desc, coalesce(scheduled_at, created_at), created_at asc
           limit $6
           for update skip locked
         )
         update module_outbox
         set status = 'processing',
             attempts = attempts + 1,
             lease_owner = $7,
             lease_expires_at = now() + ($8::text || ' milliseconds')::interval,
             heartbeat_at = now(),
             updated_at = now()
         where id in (select id from picked)
         returning *`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.name ?? null,
          query.namePrefix ?? null,
          query.statuses ?? ['queued', 'failed'],
          query.limit ?? 50,
          query.leaseOwner ?? 'postgres-runtime-worker',
          query.leaseMs ?? 60_000,
        ]
      );
      return result.rows.map(mapOutbox);
    },
    async markOutbox(
      id: string,
      status: RuntimeStoreOutboxStatus,
      error?: Error | string,
      options = {}
    ) {
      const result = await database.query<Row>(
        `update module_outbox
         set status = $2,
             attempts = case when $2 = 'processing' then attempts + 1 else attempts end,
             processed_at = case when $2 = 'processed' then now() else processed_at end,
             error = $3::jsonb,
             scheduled_at = $4::timestamptz,
             lease_owner = case when $2 = 'processing' then lease_owner else null end,
             lease_expires_at = case when $2 = 'processing' then lease_expires_at else null end,
             heartbeat_at = case when $2 = 'processing' then coalesce($5::timestamptz, now()) else null end,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(errorFrom(error)), options.scheduledAt ?? null, options.heartbeatAt ?? null]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_OUTBOX_NOT_FOUND: ${id}`);
      }
      return mapOutbox(result.rows[0]);
    },
    async recordDelivery(input) {
      const result = await database.query<Row>(
        `insert into module_delivery_ledger (
          id, product_id, workspace_id, module_id, actor_id, kind, source, target,
          status, attempts, outbox_id, run_id, receipt_id, event_id, email_id,
          worker_id, correlation_id, causation_id, next_retry_at, error_category,
          error, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19::timestamptz, $20,
          $21::jsonb, $22::jsonb
        )
        returning *`,
        [
          createId('delivery'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.actorId ?? null,
          input.kind,
          input.source,
          input.target,
          input.status,
          input.attempts ?? 0,
          input.outboxId ?? null,
          input.runId ?? null,
          input.receiptId ?? null,
          input.eventId ?? null,
          input.emailId ?? null,
          input.workerId ?? null,
          input.correlationId ?? null,
          input.causationId ?? null,
          input.nextRetryAt ?? null,
          input.errorCategory ?? null,
          json(deliveryErrorFrom(input.error)),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapDelivery(result.rows[0]!);
    },
    async listDeliveries(query = {}) {
      const result = await database.query<Row>(
        `select * from module_delivery_ledger
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or coalesce(module_id, '') = coalesce($3, ''))
           and ($4::text is null or kind = $4)
           and ($5::text is null or status = $5)
           and ($6::text is null or outbox_id = $6)
           and ($7::text is null or run_id = $7)
           and ($8::text is null or receipt_id = $8)
           and ($9::text is null or event_id = $9)
           and ($10::text is null or email_id = $10)
           and ($11::text is null or worker_id = $11)
           and ($12::text is null or correlation_id = $12)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.kind ?? null,
          query.status ?? null,
          query.outboxId ?? null,
          query.runId ?? null,
          query.receiptId ?? null,
          query.eventId ?? null,
          query.emailId ?? null,
          query.workerId ?? null,
          query.correlationId ?? null,
        ]
      );
      return result.rows.map(mapDelivery);
    },
    async upsertWorkerHeartbeat(input) {
      const result = await database.query<Row>(
        `insert into module_worker_registry (
          id, product_id, workspace_id, worker_id, profile, status, queue_profile,
          heartbeat_at, last_drain_at, last_duration_ms, processed, failed,
          dead_lettered, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          coalesce($8::timestamptz, now()), $9::timestamptz, $10, $11, $12,
          $13, $14::jsonb
        )
        on conflict (product_id, (coalesce(workspace_id, ''::text)), worker_id)
        do update set
          profile = excluded.profile,
          status = excluded.status,
          queue_profile = excluded.queue_profile,
          heartbeat_at = excluded.heartbeat_at,
          last_drain_at = coalesce(excluded.last_drain_at, module_worker_registry.last_drain_at),
          last_duration_ms = excluded.last_duration_ms,
          processed = excluded.processed,
          failed = excluded.failed,
          dead_lettered = excluded.dead_lettered,
          metadata = module_worker_registry.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('worker'),
          input.productId,
          input.workspaceId ?? '',
          input.workerId,
          input.profile ?? 'default',
          input.status ?? 'running',
          input.queueProfile ?? 'default',
          input.heartbeatAt ?? null,
          input.lastDrainAt ?? null,
          input.lastDurationMs ?? 0,
          input.processed ?? 0,
          input.failed ?? 0,
          input.deadLettered ?? 0,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapWorker(result.rows[0]!);
    },
    async listWorkers(query = {}) {
      const result = await database.query<Row>(
        `select * from module_worker_registry
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or worker_id = $3)
           and ($4::text is null or status = $4)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.workerId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapWorker);
    },
    async createWebhookReceipt(input: CreateRuntimeStoreWebhookReceiptInput) {
      const result = await database.query<Row>(
        `insert into module_webhook_receipts (
          id, product_id, workspace_id, module_id, webhook_name, path, method,
          status, idempotency_key, signature, headers, body_text, body_digest
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'received', $8, $9, $10::jsonb, $11, $12)
        on conflict (product_id, module_id, webhook_name, idempotency_key)
        where idempotency_key is not null
        do update set updated_at = module_webhook_receipts.updated_at
        returning *`,
        [
          createId('wh'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.webhookName,
          input.path,
          input.method,
          input.idempotencyKey ?? null,
          input.signature ?? null,
          json(redactSensitive(input.headers ?? {})),
          input.bodyText ?? null,
          input.bodyDigest ?? null,
        ]
      );
      return mapReceipt(result.rows[0]!);
    },
    async findWebhookReceiptByIdempotencyKey(productId, moduleId, webhookName, idempotencyKey) {
      const result = await database.query<Row>(
        `select * from module_webhook_receipts
         where product_id = $1 and module_id = $2 and webhook_name = $3 and idempotency_key = $4`,
        [productId, moduleId, webhookName, idempotencyKey]
      );
      return result.rows[0] ? mapReceipt(result.rows[0]) : null;
    },
    async markWebhookReceipt(
      id: string,
      status: RuntimeStoreWebhookReceiptStatus,
      error?: Error | string
    ) {
      const result = await database.query<Row>(
        `update module_webhook_receipts
         set status = $2,
             attempts = case when $2 = 'processing' then attempts + 1 else attempts end,
             processed_at = case when $2 = 'processed' then now() else processed_at end,
             error = $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(errorFrom(error))]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_WEBHOOK_RECEIPT_NOT_FOUND: ${id}`);
      }
      return mapReceipt(result.rows[0]);
    },
    async listWebhookReceipts(query = {}) {
      const result = await database.query<Row>(
        `select * from module_webhook_receipts
         where ($1::text is null or product_id = $1)
           and ($2::text is null or module_id = $2)
           and ($3::text is null or status = $3)
         order by created_at desc`,
        [query.productId ?? null, query.moduleId ?? null, query.status ?? null]
      );
      return result.rows.map(mapReceipt);
    },
    async createNotification(input: CreateRuntimeStoreNotificationInput) {
      const deliveryStatus = input.deliveryStatus ?? 'delivered';
      const status = input.status ?? (deliveryStatus === 'delivered' ? 'unread' : 'read');
      const result = await database.query<Row>(
        `insert into module_notifications (
          id, product_id, workspace_id, module_id, user_id, channel, title, body,
          action_url, run_id, source, category, status, delivery_status,
          idempotency_key, metadata, read_at, delivered_at, skipped_at, error
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16::jsonb,
          case when $13 = 'read' then now() else null end,
          case when $14 = 'delivered' then now() else null end,
          case when $14 = 'skipped' then now() else null end,
          $17::jsonb
        )
        on conflict (product_id, user_id, source, idempotency_key)
        where idempotency_key is not null
        do update set updated_at = module_notifications.updated_at
        returning *`,
        [
          createId('notification'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? '__host__',
          input.userId,
          input.channel ?? 'inApp',
          input.title,
          input.body ?? null,
          input.actionUrl ?? null,
          input.runId ?? null,
          input.source ?? 'host',
          input.category ?? 'system',
          status,
          deliveryStatus,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
          json(errorFrom(input.error)),
        ]
      );
      return mapNotification(result.rows[0]!);
    },
    async listNotifications(query = {}) {
      const result = await database.query<Row>(
        `select * from module_notifications
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or user_id = $4)
           and ($5::text is null or status = $5)
           and ($6::text is null or channel = $6)
           and ($7::text is null or category = $7)
           and ($8::text is null or delivery_status = $8)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.userId ?? null,
          query.status ?? null,
          query.channel ?? null,
          query.category ?? null,
          query.deliveryStatus ?? null,
        ]
      );
      return result.rows.map(mapNotification);
    },
    async markNotificationRead(id) {
      const result = await database.query<Row>(
        `update module_notifications
         set status = 'read',
             read_at = coalesce(read_at, now()),
             updated_at = now()
         where id = $1
         returning *`,
        [id]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_NOTIFICATION_NOT_FOUND: ${id}`);
      }
      return mapNotification(result.rows[0]);
    },
    async markNotificationsRead(query) {
      const result = await database.query<Row>(
        `update module_notifications
         set status = 'read',
             read_at = coalesce(read_at, now()),
             updated_at = now()
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and user_id = $3
           and ($4::text is null or channel = $4)
           and ($5::text is null or category = $5)
           and delivery_status = 'delivered'
         returning *`,
        [
          query.productId,
          runtimeWorkspaceFilter(query.workspaceId),
          query.userId,
          query.channel ?? null,
          query.category ?? null,
        ]
      );
      return result.rows.map(mapNotification);
    },
    async recordNotificationDelivery(input) {
      const result = await database.query<Row>(
        `insert into module_notification_deliveries (
          id, notification_id, product_id, workspace_id, user_id, channel,
          provider, status, reason, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        returning *`,
        [
          createId('notification_delivery'),
          input.notificationId ?? null,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.channel,
          input.provider,
          input.status,
          input.reason ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapNotificationDelivery(result.rows[0]!);
    },
    async listNotificationDeliveries(query = {}) {
      const result = await database.query<Row>(
        `select * from module_notification_deliveries
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or status = $4)
           and ($5::text is null or provider = $5)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.status ?? null,
          query.provider ?? null,
        ]
      );
      return result.rows.map(mapNotificationDelivery);
    },
    async recordAudit(input) {
      const id = createId('audit');
      const createdAt = new Date().toISOString();
      const previous = await database.query<Row>(
        `select metadata #>> '{_audit,recordHash}' as record_hash
         from module_audit_logs
         where product_id = $1
           and (metadata #>> '{_audit,recordHash}') is not null
         order by created_at desc
         limit 1`,
        [input.productId]
      );
      const previousHash =
        typeof previous.rows[0]?.record_hash === 'string'
          ? previous.rows[0].record_hash
          : null;
      const envelope = createAuditEnvelope({
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        metadata: input.metadata ?? {},
        createdAt,
        previousHash,
      });
      const result = await database.query<Row>(
        `insert into module_audit_logs (
          id, product_id, workspace_id, module_id, actor_id, type, metadata, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.actorId ?? null,
          input.type,
          json(envelope.storedMetadata),
          createdAt,
        ]
      );
      return mapAudit(result.rows[0]!);
    },
    async listAudit(query = {}) {
      const result = await database.query<Row>(
        `select * from module_audit_logs
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or module_id = $3)
           and ($4::text is null or actor_id = $4)
           and ($5::text is null or type = $5)
           and ($6::timestamptz is null or created_at >= $6::timestamptz)
           and ($7::timestamptz is null or created_at <= $7::timestamptz)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.moduleId ?? null,
          query.actorId ?? null,
          query.type ?? null,
          query.from ?? null,
          query.to ?? null,
        ]
      );
      return result.rows.map(mapAudit);
    },
    async recordUsage(input) {
      const result = await database.query<Row>(
        `insert into module_usage_records (
          id, product_id, workspace_id, module_id, meter, quantity, unit, idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        on conflict (product_id, module_id, meter, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_usage_records.metadata
        returning *`,
        [
          createId('usage'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.meter,
          input.quantity ?? 1,
          input.unit ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapUsage(result.rows[0]!);
    },
    async listUsage(query = {}) {
      const result = await database.query<Row>(
        `select * from module_usage_records
         where ($1::text is null or product_id = $1)
           and ($2::text is null or module_id = $2)
           and ($3::text is null or meter = $3)
         order by created_at desc`,
        [query.productId ?? null, query.moduleId ?? null, query.meter ?? null]
      );
      return result.rows.map(mapUsage);
    },
    async recordMetering(input) {
      const result = await database.query<Row>(
        `insert into module_metering_ledger (
          id, product_id, workspace_id, module_id, meter, quantity, unit, status,
          idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'authorized', $8, $9::jsonb)
        on conflict (product_id, module_id, meter, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_metering_ledger.metadata
        returning *`,
        [
          createId('meter'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.meter,
          input.quantity ?? 1,
          input.unit ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapMetering(result.rows[0]!);
    },
    async getMetering(id) {
      const result = await database.query<Row>(
        'select * from module_metering_ledger where id = $1',
        [id]
      );
      return result.rows[0] ? mapMetering(result.rows[0]) : null;
    },
    async updateMeteringStatus(
      id: string,
      status: RuntimeStoreMeteringStatus,
      metadata?: Record<string, unknown>
    ) {
      const result = await database.query<Row>(
        `update module_metering_ledger
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_METERING_NOT_FOUND: ${id}`);
      }
      return mapMetering(result.rows[0]);
    },
    async listMetering(query = {}) {
      const result = await database.query<Row>(
        `select * from module_metering_ledger
         where ($1::text is null or product_id = $1)
           and ($2::text is null or module_id = $2)
           and ($3::text is null or meter = $3)
           and ($4::text is null or status = $4)
         order by created_at desc`,
        [query.productId ?? null, query.moduleId ?? null, query.meter ?? null, query.status ?? null]
      );
      return result.rows.map(mapMetering);
    },
    async recordCreditLedger(input) {
      const result = await database.query<Row>(
        `insert into module_credit_ledger (
          id, product_id, workspace_id, user_id, amount, unit, reason, status,
          idempotency_key, expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, unit, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_credit_ledger.metadata
        returning *`,
        [
          createId('credit'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.amount,
          input.unit ?? 'credit',
          input.reason,
          input.status ??
            (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()
              ? 'expired'
              : 'available'),
          input.idempotencyKey ?? null,
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapCreditLedger(result.rows[0]!);
    },
    async consumeCreditLedger(input) {
      if (!database.transaction) {
        throw new Error('RUNTIME_STORE_TRANSACTION_REQUIRED: credit consume requires database.transaction');
      }
      const unit = input.unit ?? 'credit';
      const workspaceKey = creditWorkspaceKey(input.workspaceId);
      return database.transaction(async (tx) => {
        await tx.query(
          `select pg_advisory_xact_lock(
            hashtext($1::text),
            hashtext($2::text || ':' || $3::text || ':' || $4::text)
          )`,
          [input.productId, workspaceKey, input.userId, unit]
        );

        if (input.idempotencyKey) {
          const existing = await tx.query<Row>(
            `select *
             from module_credit_ledger
             where product_id = $1
               and coalesce(workspace_id, ''::text) = $2
               and user_id = $3
               and unit = $4
               and idempotency_key = $5
             limit 1`,
            [input.productId, workspaceKey, input.userId, unit, input.idempotencyKey]
          );
          if (existing.rows[0]) {
            return mapCreditLedger(existing.rows[0]);
          }
        }

        const balance = await tx.query<Row>(
          `select coalesce(sum(amount), 0) as balance
           from module_credit_ledger
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and user_id = $3
             and unit = $4
             and status = 'available'
             and (expires_at is null or expires_at > now())`,
          [input.productId, workspaceKey, input.userId, unit]
        );
        if (Number(balance.rows[0]?.balance ?? 0) < input.amount) {
          throw new Error('MODULE_CREDITS_INSUFFICIENT');
        }

        const result = await tx.query<Row>(
          `insert into module_credit_ledger (
            id, product_id, workspace_id, user_id, amount, unit, reason, status,
            idempotency_key, expires_at, metadata
          )
          values ($1, $2, $3, $4, $5, $6, $7, 'available', $8, null, $9::jsonb)
          on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, unit, idempotency_key)
          where idempotency_key is not null
          do update set metadata = module_credit_ledger.metadata
          returning *`,
          [
            createId('credit'),
            input.productId,
            input.workspaceId ?? null,
            input.userId,
            -input.amount,
            unit,
            input.reason,
            input.idempotencyKey ?? null,
            json(input.metadata ?? {}),
          ]
        );
        return mapCreditLedger(result.rows[0]!);
      });
    },
    async listCreditLedger(query = {}) {
      const result = await database.query<Row>(
        `select * from module_credit_ledger
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or unit = $4)
           and (
             $5::text is null
             or case
               when status = 'available' and expires_at is not null and expires_at <= now()
               then 'expired'
               else status
             end = $5
           )
         order by created_at desc`,
        [
          query.productId ?? null,
          creditWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.unit ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapCreditLedger);
    },
    async getCreditBalance(query) {
      const unit = query.unit ?? 'credit';
      const result = await database.query<Row>(
        `select coalesce(sum(amount), 0) as balance
         from module_credit_ledger
         where product_id = $1
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and user_id = $3
           and unit = $4
           and status = 'available'
           and (expires_at is null or expires_at > now())`,
        [query.productId, creditWorkspaceFilter(query.workspaceId), query.userId, unit]
      );
      return { userId: query.userId, unit, balance: Number(result.rows[0]?.balance ?? 0) };
    },
    async createCreditReservation(input) {
      const unit = input.unit ?? 'credit';
      const result = await database.query<Row>(
        `insert into module_credit_reservations (
          id, product_id, workspace_id, user_id, amount_reserved, amount_committed,
          unit, status, reason, source, source_id, idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, unit, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_credit_reservations.metadata
        returning *`,
        [
          input.id ?? createId('credit_reservation'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.amountReserved,
          input.amountCommitted ?? 0,
          unit,
          input.status ?? 'reserved',
          input.reason ?? null,
          input.source ?? null,
          input.sourceId ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapCreditReservation(result.rows[0]!);
    },
    async getCreditReservation(id) {
      const result = await database.query<Row>(
        'select * from module_credit_reservations where id = $1',
        [id]
      );
      return result.rows[0] ? mapCreditReservation(result.rows[0]) : null;
    },
    async updateCreditReservation(id, patch) {
      const result = await database.query<Row>(
        `update module_credit_reservations
         set amount_committed = coalesce($2, amount_committed),
             status = coalesce($3, status),
             metadata = metadata || $4::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          patch.amountCommitted ?? null,
          patch.status ?? null,
          json(patch.metadata ?? {}),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_CREDIT_RESERVATION_NOT_FOUND: ${id}`);
      }
      return mapCreditReservation(result.rows[0]);
    },
    async listCreditReservations(query = {}) {
      const result = await database.query<Row>(
        `select * from module_credit_reservations
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or unit = $4)
           and ($5::text is null or status = $5)
           and ($6::text is null or source = $6)
           and ($7::text is null or source_id = $7)
         order by created_at desc`,
        [
          query.productId ?? null,
          creditWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.unit ?? null,
          query.status ?? null,
          query.source ?? null,
          query.sourceId ?? null,
        ]
      );
      return result.rows.map(mapCreditReservation);
    },
    async grantEntitlement(input) {
      const result = await database.query<Row>(
        `insert into module_commercial_entitlements (
          id, product_id, workspace_id, user_id, entitlement, plan_id, source, status,
          idempotency_key, expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb)
        on conflict (product_id, user_id, entitlement, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_commercial_entitlements.metadata
        returning *`,
        [
          createId('entitlement'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.entitlement,
          input.planId ?? null,
          input.source,
          input.status ?? 'active',
          input.idempotencyKey ?? null,
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapEntitlement(result.rows[0]!);
    },
    async listEntitlements(query = {}) {
      const result = await database.query<Row>(
        `select * from module_commercial_entitlements
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or entitlement = $4)
           and ($5::text is null or status = $5)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.entitlement ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapEntitlement);
    },
    async revokeEntitlement(id: string, metadata?: Record<string, unknown>) {
      const result = await database.query<Row>(
        `update module_commercial_entitlements
         set status = 'revoked',
             metadata = metadata || $2::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      return mapEntitlement(result.rows[0]);
    },
    async overrideEntitlement(id, input) {
      const result = await database.query<Row>(
        `update module_commercial_entitlements
         set status = $2,
             expires_at = case when $3::boolean then $4::timestamptz else expires_at end,
             metadata = metadata || $5::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          input.status,
          Object.prototype.hasOwnProperty.call(input, 'expiresAt'),
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      return mapEntitlement(result.rows[0]);
    },
    async upsertCommercialCatalogItem(input) {
      const result = await database.query<Row>(
        `insert into module_commercial_catalog (
          id, product_id, workspace_id, kind, item_id, version, status, value_json, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), kind, item_id, version)
        do update set
          status = excluded.status,
          value_json = excluded.value_json,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('commercial_catalog'),
          input.productId,
          input.workspaceId ?? null,
          input.kind,
          input.itemId,
          input.version ?? 1,
          input.status ?? 'draft',
          json(input.value),
          json(input.metadata ?? {}),
        ]
      );
      return mapCommercialCatalogItem(result.rows[0]!) as never;
    },
    async listCommercialCatalogItems(query = {}) {
      const result = await database.query<Row>(
        `select * from module_commercial_catalog
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or kind = $3)
           and ($4::text is null or status = $4)
           and ($5::text is null or item_id = $5)
         order by item_id asc, version desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.kind ?? null,
          query.status ?? null,
          query.itemId ?? null,
        ]
      );
      return result.rows.map((row) => mapCommercialCatalogItem(row)) as never;
    },
    async createCommercialOrder(input) {
      if (input.provider && input.providerRef) {
        const existingByProvider = await database.query<Row>(
          `select *
           from module_commercial_orders
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and provider = $3
             and provider_ref = $4
           limit 1`,
          [
            input.productId,
            orderWorkspaceKey(input.workspaceId),
            input.provider,
            input.providerRef,
          ]
        );
        if (existingByProvider.rows[0]) {
          return mapCommercialOrder(existingByProvider.rows[0]);
        }
      }
      const result = await database.query<Row>(
        `insert into module_commercial_orders (
          id, product_id, workspace_id, user_id, sku, amount, currency, status,
          provider, provider_ref, idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9, $10, $11::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_commercial_orders.metadata
        returning *`,
        [
          createId('order'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.sku,
          input.amount,
          input.currency,
          input.provider ?? null,
          input.providerRef ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapCommercialOrder(result.rows[0]!);
    },
    async getCommercialOrder(id) {
      const result = await database.query<Row>(
        'select * from module_commercial_orders where id = $1',
        [id]
      );
      return result.rows[0] ? mapCommercialOrder(result.rows[0]) : null;
    },
    async findCommercialOrderByProviderRef(productId, workspaceId, provider, providerRef) {
      const result = await database.query<Row>(
        `select * from module_commercial_orders
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and provider = $3
           and provider_ref = $4`,
        [productId, orderWorkspaceKey(workspaceId), provider, providerRef]
      );
      return result.rows[0] ? mapCommercialOrder(result.rows[0]) : null;
    },
    async attachCommercialOrderProvider(
      id: string,
      provider: string,
      providerRef: string,
      metadata?: Record<string, unknown>
    ) {
      const result = await database.query<Row>(
        `update module_commercial_orders
         set provider = $2,
             provider_ref = $3,
             metadata = metadata || $4::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, provider, providerRef, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_NOT_FOUND: ${id}`);
      }
      return mapCommercialOrder(result.rows[0]);
    },
    async updateCommercialOrderStatus(
      id: string,
      status: RuntimeStoreCommercialOrderStatus,
      metadata?: Record<string, unknown>
    ) {
      const result = await database.query<Row>(
        `update module_commercial_orders
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_NOT_FOUND: ${id}`);
      }
      return mapCommercialOrder(result.rows[0]);
    },
    async listCommercialOrders(query = {}) {
      const result = await database.query<Row>(
        `select * from module_commercial_orders
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or status = $4)
         order by created_at desc`,
        [
          query.productId ?? null,
          orderWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapCommercialOrder);
    },
    async upsertBillingAccount(input) {
      const result = await database.query<Row>(
        `insert into module_billing_accounts (
          id, product_id, workspace_id, user_id, status, customer_profile,
          provider_customers, payment_methods, metadata
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id)
        do update set
          status = excluded.status,
          customer_profile = module_billing_accounts.customer_profile || excluded.customer_profile,
          provider_customers = module_billing_accounts.provider_customers || excluded.provider_customers,
          payment_methods = excluded.payment_methods,
          metadata = module_billing_accounts.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('billing_account'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.status ?? 'active',
          json(input.customerProfile ?? {}),
          json(input.providerCustomers ?? {}),
          json(input.paymentMethods ?? []),
          json(input.metadata ?? {}),
        ]
      );
      return mapBillingAccount(result.rows[0]!);
    },
    async getBillingAccount(productId, userId, workspaceId) {
      const result = await database.query<Row>(
        `select * from module_billing_accounts
         where product_id = $1
           and user_id = $2
           and coalesce(workspace_id, ''::text) = $3
         limit 1`,
        [productId, userId, runtimeWorkspaceKey(workspaceId)]
      );
      return result.rows[0] ? mapBillingAccount(result.rows[0]) : null;
    },
    async upsertInvoice(input) {
      const workspaceKey = orderWorkspaceKey(input.workspaceId);
      const directExisting = input.id
        ? (
            await database.query<Row>('select * from module_invoices where id = $1', [input.id])
          ).rows[0]
        : undefined;
      const orderExisting = input.orderId
        ? (
            await database.query<Row>(
              `select *
               from module_invoices
               where product_id = $1
                 and coalesce(workspace_id, ''::text) = $2
                 and order_id = $3
               limit 1`,
              [input.productId, workspaceKey, input.orderId]
            )
          ).rows[0]
        : undefined;
      if (directExisting && orderExisting && directExisting.id !== orderExisting.id) {
        throw new Error(`RUNTIME_STORE_INVOICE_ORDER_CONFLICT: ${input.orderId}`);
      }
      const existing = orderExisting ?? directExisting;
      const id = existing?.id ?? input.id ?? createId('invoice');
      const number =
        input.number ??
        existing?.number ??
        `PK-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberConflict = await database.query<Row>(
        `select id
         from module_invoices
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and number = $3
           and id <> $4
         limit 1`,
        [input.productId, workspaceKey, number, id]
      );
      if (numberConflict.rows[0]) {
        throw new Error(`RUNTIME_STORE_INVOICE_NUMBER_CONFLICT: ${number}`);
      }
      const discount = input.discount ?? Number(existing?.discount ?? 0);
      const tax = input.tax ?? Number(existing?.tax ?? 0);
      const total =
        input.total ?? Math.max(0, input.subtotal - discount + tax);
      const refunded = input.refunded ?? Number(existing?.refunded ?? 0);
      const fee = input.fee ?? Number(existing?.fee ?? 0);
      const result = await database.query<Row>(
        `insert into module_invoices (
          id, product_id, workspace_id, user_id, order_id, subscription_id, number,
          status, subtotal, discount, tax, total, refunded, fee, net, currency,
          provider, provider_ref, document_file_id, tax_snapshot, lines, metadata,
          issued_at, due_at, paid_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb,
          $23::timestamptz, $24::timestamptz, $25::timestamptz
        )
        on conflict (id)
        do update set
          status = excluded.status,
          subtotal = excluded.subtotal,
          discount = excluded.discount,
          tax = excluded.tax,
          total = excluded.total,
          refunded = excluded.refunded,
          fee = excluded.fee,
          net = excluded.net,
          provider = excluded.provider,
          provider_ref = excluded.provider_ref,
          document_file_id = excluded.document_file_id,
          tax_snapshot = excluded.tax_snapshot,
          lines = excluded.lines,
          metadata = module_invoices.metadata || excluded.metadata,
          paid_at = coalesce(excluded.paid_at, module_invoices.paid_at),
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.orderId ?? existing?.order_id ?? null,
          input.subscriptionId ?? existing?.subscription_id ?? null,
          number,
          input.status ?? existing?.status ?? 'open',
          input.subtotal,
          discount,
          tax,
          total,
          refunded,
          fee,
          input.net ?? total - refunded - fee,
          input.currency,
          input.provider ?? existing?.provider ?? null,
          input.providerRef ?? existing?.provider_ref ?? null,
          input.documentFileId ?? existing?.document_file_id ?? null,
          json(input.taxSnapshot ?? existing?.tax_snapshot ?? {}),
          json(input.lines ?? existing?.lines ?? []),
          json(input.metadata ?? {}),
          input.issuedAt ?? toIso(existing?.issued_at) ?? new Date().toISOString(),
          input.dueAt ?? toIso(existing?.due_at) ?? null,
          input.paidAt ?? toIso(existing?.paid_at) ?? null,
        ]
      );
      return mapInvoice(result.rows[0]!);
    },
    async listInvoices(query = {}) {
      const result = await database.query<Row>(
        `select * from module_invoices
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or order_id = $4)
           and ($5::text is null or status = $5)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.userId ?? null,
          query.orderId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapInvoice);
    },
    async createCreditNote(input) {
      const workspaceKey = orderWorkspaceKey(input.workspaceId);
      if (input.provider && input.providerRef) {
        const existing = await database.query<Row>(
          `select *
           from module_credit_notes
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and provider = $3
             and provider_ref = $4
           limit 1`,
          [input.productId, workspaceKey, input.provider, input.providerRef]
        );
        if (existing.rows[0]) {
          return mapCreditNote(existing.rows[0]);
        }
      }
      const id = input.id ?? createId('credit_note');
      const number =
        input.number ?? `CN-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberConflict = await database.query<Row>(
        `select id
         from module_credit_notes
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and number = $3
           and id <> $4
         limit 1`,
        [input.productId, workspaceKey, number, id]
      );
      if (numberConflict.rows[0]) {
        throw new Error(`RUNTIME_STORE_CREDIT_NOTE_NUMBER_CONFLICT: ${number}`);
      }
      const result = await database.query<Row>(
        `insert into module_credit_notes (
          id, product_id, workspace_id, user_id, order_id, invoice_id, number,
          status, amount, currency, reason, provider, provider_ref, lines, metadata, issued_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::timestamptz
        )
        on conflict (product_id, (coalesce(workspace_id, ''::text)), provider, provider_ref)
        where provider_ref is not null
        do update set metadata = module_credit_notes.metadata
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.orderId ?? null,
          input.invoiceId ?? null,
          number,
          input.status ?? 'issued',
          input.amount,
          input.currency,
          input.reason ?? 'refund',
          input.provider ?? null,
          input.providerRef ?? null,
          json(input.lines ?? []),
          json(redactSensitive(input.metadata ?? {})),
          input.issuedAt ?? new Date().toISOString(),
        ]
      );
      return mapCreditNote(result.rows[0]!);
    },
    async listCreditNotes(query = {}) {
      const result = await database.query<Row>(
        `select * from module_credit_notes
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or order_id = $4)
           and ($5::text is null or invoice_id = $5)
           and ($6::text is null or status = $6)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.userId ?? null,
          query.orderId ?? null,
          query.invoiceId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapCreditNote);
    },
    async upsertSubscription(input) {
      const id =
        input.id ?? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.planId}`;
      const result = await database.query<Row>(
        `insert into module_subscriptions (
          id, product_id, workspace_id, user_id, plan_id, status, provider, provider_ref,
          current_period_start, current_period_end, trial_end, cancel_at_period_end,
          renewal_strategy, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9::timestamptz, $10::timestamptz, $11::timestamptz, $12,
          $13, $14::jsonb
        )
        on conflict (id)
        do update set
          status = excluded.status,
          provider = excluded.provider,
          provider_ref = excluded.provider_ref,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          trial_end = excluded.trial_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          renewal_strategy = excluded.renewal_strategy,
          metadata = module_subscriptions.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.planId,
          input.status ?? 'active',
          input.provider ?? null,
          input.providerRef ?? null,
          input.currentPeriodStart ?? new Date().toISOString(),
          input.currentPeriodEnd ?? null,
          input.trialEnd ?? null,
          input.cancelAtPeriodEnd ?? false,
          input.renewalStrategy ?? 'manual',
          json(input.metadata ?? {}),
        ]
      );
      return mapSubscription(result.rows[0]!);
    },
    async listSubscriptions(query = {}) {
      const result = await database.query<Row>(
        `select * from module_subscriptions
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or plan_id = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          orderWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.planId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapSubscription);
    },
    async createSubscriptionEvent(input) {
      if (input.idempotencyKey) {
        const existing = await database.query<Row>(
          `select * from module_subscription_events
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and idempotency_key = $3
           limit 1`,
          [input.productId, orderWorkspaceKey(input.workspaceId), input.idempotencyKey]
        );
        if (existing.rows[0]) {
          return mapSubscriptionEvent(existing.rows[0]);
        }
      }
      const result = await database.query<Row>(
        `insert into module_subscription_events (
          id, product_id, workspace_id, user_id, subscription_id, plan_id,
          type, status, provider, provider_ref, idempotency_key, effective_at, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12::timestamptz, $13::jsonb
        )
        returning *`,
        [
          createId('subscription_event'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.subscriptionId,
          input.planId,
          input.type,
          input.status,
          input.provider ?? null,
          input.providerRef ?? null,
          input.idempotencyKey ?? null,
          input.effectiveAt ?? new Date().toISOString(),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapSubscriptionEvent(result.rows[0]!);
    },
    async listSubscriptionEvents(query = {}) {
      const result = await database.query<Row>(
        `select * from module_subscription_events
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or subscription_id = $4)
           and ($5::text is null or plan_id = $5)
           and ($6::text is null or type = $6)
         order by created_at desc`,
        [
          query.productId ?? null,
          orderWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.subscriptionId ?? null,
          query.planId ?? null,
          query.type ?? null,
        ]
      );
      return result.rows.map(mapSubscriptionEvent);
    },
    async upsertTaxProfile(input) {
      const result = await database.query<Row>(
        `insert into module_tax_profiles (
          id, product_id, workspace_id, user_id, status, jurisdiction,
          validation_status, profile, evidence, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id)
        do update set
          status = excluded.status,
          jurisdiction = excluded.jurisdiction,
          validation_status = excluded.validation_status,
          profile = module_tax_profiles.profile || excluded.profile,
          evidence = module_tax_profiles.evidence || excluded.evidence,
          metadata = module_tax_profiles.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('tax_profile'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.status ?? 'draft',
          input.jurisdiction ?? null,
          input.validationStatus ?? 'unverified',
          json(input.profile ?? {}),
          json(input.evidence ?? {}),
          json(input.metadata ?? {}),
        ]
      );
      return mapTaxProfile(result.rows[0]!);
    },
    async getTaxProfile(productId, userId, workspaceId) {
      const result = await database.query<Row>(
        `select * from module_tax_profiles
         where product_id = $1
           and user_id = $2
           and coalesce(workspace_id, ''::text) = $3
         limit 1`,
        [productId, userId, orderWorkspaceKey(workspaceId)]
      );
      return result.rows[0] ? mapTaxProfile(result.rows[0]) : null;
    },
    async upsertRevenueBucket(input) {
      const result = await database.query<Row>(
        `insert into module_revenue_buckets (
          id, product_id, workspace_id, bucket_date, currency, gross, discount,
          tax, refund, fee, net, orders, provider, metadata
        )
        values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), bucket_date, currency)
        do update set
          gross = excluded.gross,
          discount = excluded.discount,
          tax = excluded.tax,
          refund = excluded.refund,
          fee = excluded.fee,
          net = excluded.net,
          orders = excluded.orders,
          provider = excluded.provider,
          metadata = module_revenue_buckets.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('revenue_bucket'),
          input.productId,
          input.workspaceId ?? null,
          input.bucketDate,
          input.currency,
          input.gross ?? 0,
          input.discount ?? 0,
          input.tax ?? 0,
          input.refund ?? 0,
          input.fee ?? 0,
          input.net ?? 0,
          input.orders ?? 0,
          input.provider ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapRevenueBucket(result.rows[0]!);
    },
    async listRevenueBuckets(query = {}) {
      const result = await database.query<Row>(
        `select * from module_revenue_buckets
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::date is null or bucket_date >= $3::date)
           and ($4::date is null or bucket_date <= $4::date)
           and ($5::text is null or currency = $5)
         order by bucket_date asc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.from ?? null,
          query.to ?? null,
          query.currency ?? null,
        ]
      );
      return result.rows.map(mapRevenueBucket);
    },
    async upsertSettlementBatch(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.provider}:${input.currency}:${input.periodStart}:${input.periodEnd}`;
      const gross = input.gross ?? 0;
      const refund = input.refund ?? 0;
      const fee = input.fee ?? 0;
      const result = await database.query<Row>(
        `insert into module_settlement_batches (
          id, product_id, workspace_id, provider, currency, period_start, period_end,
          status, gross, refund, fee, net, order_count, invoice_count, credit_note_count, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
          $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
        )
        on conflict (id)
        do update set
          status = excluded.status,
          gross = excluded.gross,
          refund = excluded.refund,
          fee = excluded.fee,
          net = excluded.net,
          order_count = excluded.order_count,
          invoice_count = excluded.invoice_count,
          credit_note_count = excluded.credit_note_count,
          metadata = module_settlement_batches.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.provider,
          input.currency,
          input.periodStart,
          input.periodEnd,
          input.status ?? 'draft',
          gross,
          refund,
          fee,
          input.net ?? gross - refund - fee,
          input.orderCount ?? 0,
          input.invoiceCount ?? 0,
          input.creditNoteCount ?? 0,
          json(input.metadata ?? {}),
        ]
      );
      return mapSettlementBatch(result.rows[0]!);
    },
    async listSettlementBatches(query = {}) {
      const result = await database.query<Row>(
        `select * from module_settlement_batches
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or provider = $3)
           and ($4::text is null or currency = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.provider ?? null,
          query.currency ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapSettlementBatch);
    },
    async recordProviderInvocation(input) {
      const result = await database.query<Row>(
        `insert into module_provider_invocations (
          id, product_id, workspace_id, module_id, provider_id, kind, operation,
          status, target, model, service_connection_id, resource_binding_id,
          usage, cost, latency_ms, correlation_id, error, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13::jsonb, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb
        )
        returning *`,
        [
          createId('provider_invocation'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.providerId,
          input.kind,
          input.operation,
          input.status,
          input.target ?? null,
          input.model ?? null,
          input.serviceConnectionId ?? null,
          input.resourceBindingId ?? null,
          json(input.usage ?? {}),
          json(input.cost ?? {}),
          input.latencyMs ?? 0,
          input.correlationId ?? null,
          json(deliveryErrorFrom(input.error)),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapProviderInvocation(result.rows[0]!);
    },
    async listProviderInvocations(query = {}) {
      const result = await database.query<Row>(
        `select * from module_provider_invocations
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or provider_id = $4)
           and ($5::text is null or kind = $5)
           and ($6::text is null or operation = $6)
           and ($7::text is null or status = $7)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.providerId ?? null,
          query.kind ?? null,
          query.operation ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapProviderInvocation);
    },
    async upsertRagSource(input) {
      const id = `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}`;
      const result = await database.query<Row>(
        `insert into module_rag_sources (
          id, product_id, workspace_id, module_id, source_id, status,
          content_digest, content_length, chunk_count, indexed_at, deleted_at, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          coalesce($10::timestamptz, case when $6 = 'indexed' then now() else null end),
          coalesce($11::timestamptz, case when $6 = 'deleted' then now() else null end),
          $12::jsonb
        )
        on conflict (id)
        do update set
          status = excluded.status,
          content_digest = coalesce(excluded.content_digest, module_rag_sources.content_digest),
          content_length = excluded.content_length,
          chunk_count = excluded.chunk_count,
          indexed_at = coalesce(excluded.indexed_at, module_rag_sources.indexed_at),
          deleted_at = coalesce(excluded.deleted_at, module_rag_sources.deleted_at),
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.sourceId,
          input.status ?? 'indexed',
          input.contentDigest ?? null,
          input.contentLength ?? 0,
          input.chunkCount ?? 0,
          input.indexedAt ?? null,
          input.deletedAt ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRagSource(result.rows[0]!);
    },
    async listRagSources(query = {}) {
      const result = await database.query<Row>(
        `select * from module_rag_sources
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or source_id = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.sourceId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapRagSource);
    },
    async upsertRagChunk(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}:${input.chunkIndex}`;
      const result = await database.query<Row>(
        `insert into module_rag_chunks (
          id, product_id, workspace_id, module_id, source_id, chunk_index,
          content, embedding, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
        on conflict (id)
        do update set
          content = excluded.content,
          embedding = excluded.embedding,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.sourceId,
          input.chunkIndex,
          input.content,
          json(input.embedding),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRagChunk(result.rows[0]!);
    },
    async listRagChunks(query = {}) {
      const result = await database.query<Row>(
        `select * from module_rag_chunks
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or source_id = $4)
         order by source_id asc, chunk_index asc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.sourceId ?? null,
        ]
      );
      return result.rows.map(mapRagChunk);
    },
    async deleteRagChunkById(input) {
      const result = await database.query<{ id: string }>(
        `delete from module_rag_chunks
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and ($3::text is null or module_id = $3)
           and id = $4
         returning id`,
        [input.productId, runtimeWorkspaceKey(input.workspaceId), input.moduleId ?? null, input.id]
      );
      return result.rows.length > 0;
    },
    async deleteRagChunksBySource(input) {
      const result = await database.query<{ id: string }>(
        `delete from module_rag_chunks
         where product_id = $1
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and source_id = $4
         returning id`,
        [input.productId, runtimeWorkspaceKey(input.workspaceId), input.moduleId ?? null, input.sourceId]
      );
      return result.rows.length;
    },
    async upsertRedeemCode(input) {
      const result = await database.query<Row>(
        `insert into module_redeem_codes (
          product_id, code, entitlement, credits_amount, credits_unit, max_redemptions,
          expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
        on conflict (product_id, code)
        do update set
          entitlement = excluded.entitlement,
          credits_amount = excluded.credits_amount,
          credits_unit = excluded.credits_unit,
          max_redemptions = excluded.max_redemptions,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          input.productId,
          input.code,
          input.entitlement ?? null,
          input.creditsAmount ?? null,
          input.creditsUnit,
          input.maxRedemptions,
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapRedeemCode(result.rows[0]!);
    },
    async getRedeemCode(productId, code) {
      const result = await database.query<Row>(
        'select * from module_redeem_codes where product_id = $1 and code = $2',
        [productId, code]
      );
      return result.rows[0] ? mapRedeemCode(result.rows[0]) : null;
    },
    async updateRedeemCodeStatus(input) {
      const result = await database.query<Row>(
        `update module_redeem_codes
         set metadata = metadata || $3::jsonb || jsonb_build_object('status', $4::text),
             updated_at = now()
         where product_id = $1 and code = $2
         returning *`,
        [input.productId, input.code, json(input.metadata ?? {}), input.status]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_REDEEM_CODE_NOT_FOUND: ${input.code}`);
      }
      return mapRedeemCode(result.rows[0]);
    },
    async listRedeemCodes(query = {}) {
      const result = await database.query<Row>(
        `select * from module_redeem_codes
         where ($1::text is null or product_id = $1)
           and ($2::text is null or metadata->>'batchId' = $2)
           and ($3::text is null or coalesce(metadata->>'status', 'active') = $3)
         order by created_at desc`,
        [query.productId ?? null, query.batchId ?? null, query.status ?? null]
      );
      return result.rows.map(mapRedeemCode);
    },
    async recordRedeemRedemption(input) {
      const result = await database.query<Row>(
        `insert into module_redeem_redemptions (
          id, product_id, code, user_id, entitlement, credits_amount, credits_unit,
          idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        on conflict (product_id, code, user_id)
        do update set metadata = module_redeem_redemptions.metadata
        returning *`,
        [
          createId('redemption'),
          input.productId,
          input.code,
          input.userId,
          input.entitlement ?? null,
          input.creditsAmount ?? null,
          input.creditsUnit ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapRedeemRedemption(result.rows[0]!);
    },
    async listRedeemRedemptions(query = {}) {
      const result = await database.query<Row>(
        `select * from module_redeem_redemptions
         where ($1::text is null or product_id = $1)
           and ($2::text is null or code = $2)
           and ($3::text is null or user_id = $3)
         order by created_at desc`,
        [query.productId ?? null, query.code ?? null, query.userId ?? null]
      );
      return result.rows.map(mapRedeemRedemption);
    },
    async createApiKey(input) {
      const id = input.id ?? createId('api_key');
      const result = await database.query<Row>(
        `insert into module_api_keys (
          id, product_id, workspace_id, module_id, name, prefix, key_hash,
          owner_subject_type, owner_subject_id, permissions, status, expires_at,
          revoked_at, last_used_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::timestamptz,
          $13::timestamptz, $14::timestamptz, $15::jsonb)
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.name,
          input.prefix,
          input.keyHash,
          input.ownerSubjectType ?? null,
          input.ownerSubjectId ?? null,
          json(input.permissions ?? []),
          input.status ?? 'active',
          input.expiresAt ?? null,
          input.revokedAt ?? null,
          input.lastUsedAt ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapApiKey(result.rows[0]!);
    },
    async getApiKey(input) {
      const result = await database.query<Row>(
        `select * from module_api_keys
         where id = $1
           and ($2::text is null or product_id = $2)
           and ($3::text is null or coalesce(workspace_id, ''::text) = $3)`,
        [input.id, input.productId ?? null, runtimeWorkspaceFilter(input.workspaceId)]
      );
      return result.rows[0] ? mapApiKey(result.rows[0]) : null;
    },
    async findApiKeyByHash(input) {
      const result = await database.query<Row>(
        `select * from module_api_keys
         where key_hash = $1
           and ($2::text is null or prefix = $2)
           and ($3::text is null or product_id = $3)
         order by created_at desc
         limit 1`,
        [input.keyHash, input.prefix ?? null, input.productId ?? null]
      );
      return result.rows[0] ? mapApiKey(result.rows[0]) : null;
    },
    async updateApiKey(id, patch) {
      const result = await database.query<Row>(
        `update module_api_keys
         set prefix = coalesce($2, prefix),
             key_hash = coalesce($3, key_hash),
             status = coalesce($4, status),
             expires_at = case when $5::boolean then null else coalesce($6::timestamptz, expires_at) end,
             revoked_at = case when $7::boolean then null else coalesce($8::timestamptz, revoked_at) end,
             last_used_at = case when $9::boolean then null else coalesce($10::timestamptz, last_used_at) end,
             metadata = metadata || $11::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          patch.prefix ?? null,
          patch.keyHash ?? null,
          patch.status ?? null,
          patch.expiresAt === null,
          patch.expiresAt ?? null,
          patch.revokedAt === null,
          patch.revokedAt ?? null,
          patch.lastUsedAt === null,
          patch.lastUsedAt ?? null,
          json(redactSensitive(patch.metadata ?? {})),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_API_KEY_NOT_FOUND: ${id}`);
      }
      return mapApiKey(result.rows[0]);
    },
    async listApiKeys(query = {}) {
      const result = await database.query<Row>(
        `select * from module_api_keys
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or coalesce(module_id, ''::text) = $3)
           and ($4::text is null or owner_subject_type = $4)
           and ($5::text is null or owner_subject_id = $5)
           and ($6::text is null or status = $6)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.ownerSubjectType ?? null,
          query.ownerSubjectId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapApiKey);
    },
    async recordRiskEvent(input) {
      const result = await database.query<Row>(
        `insert into module_risk_events (
          id, product_id, workspace_id, module_id, subject_type, subject_id,
          type, severity, source, source_id, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        returning *`,
        [
          input.id ?? createId('risk_event'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.subjectType ?? null,
          input.subjectId ?? null,
          input.type,
          input.severity ?? 'medium',
          input.source ?? null,
          input.sourceId ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRiskEvent(result.rows[0]!);
    },
    async upsertRiskBlock(input) {
      const id = input.id ?? createId('risk_block');
      const result = await database.query<Row>(
        `insert into module_risk_blocks (
          id, product_id, workspace_id, subject_type, subject_id, scope, reason,
          expires_at, idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb)
        on conflict (
          product_id,
          (coalesce(workspace_id, ''::text)),
          subject_type,
          subject_id,
          (coalesce(scope, ''::text))
        )
        do update set
          reason = excluded.reason,
          expires_at = excluded.expires_at,
          idempotency_key = excluded.idempotency_key,
          metadata = module_risk_blocks.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.subjectType,
          input.subjectId,
          input.scope ?? null,
          input.reason,
          input.expiresAt ?? null,
          input.idempotencyKey ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRiskBlock(result.rows[0]!);
    },
    async listRiskEvents(query = {}) {
      const result = await database.query<Row>(
        `select * from module_risk_events
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or coalesce(module_id, ''::text) = $3)
           and ($4::text is null or subject_type = $4)
           and ($5::text is null or subject_id = $5)
           and ($6::text is null or type = $6)
           and ($7::text is null or severity = $7)
           and ($8::text is null or source = $8)
           and ($9::text is null or source_id = $9)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.subjectType ?? null,
          query.subjectId ?? null,
          query.type ?? null,
          query.severity ?? null,
          query.source ?? null,
          query.sourceId ?? null,
        ]
      );
      return result.rows.map(mapRiskEvent);
    },
    async listRiskBlocks(query = {}) {
      const result = await database.query<Row>(
        `select * from module_risk_blocks
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or subject_type = $3)
           and ($4::text is null or subject_id = $4)
           and ($5::text is null or coalesce(scope, ''::text) = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.subjectType ?? null,
          query.subjectId ?? null,
          query.scope === undefined ? null : (query.scope ?? ''),
        ]
      );
      return result.rows.map(mapRiskBlock);
    },
    async createFile(input) {
      const result = await database.query<Row>(
        `insert into module_files (
          id, product_id, workspace_id, module_id, owner_id, name, purpose, status,
          visibility, content_type, size_bytes, checksum, storage_key, run_id, metadata, expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::timestamptz)
        returning *`,
        [
          createId('file'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.ownerId ?? input.actorId ?? null,
          input.name,
          input.purpose,
          input.status ?? 'uploading',
          input.visibility ?? 'private',
          input.contentType ?? null,
          input.sizeBytes ?? 0,
          input.checksum ?? null,
          input.storageKey,
          input.runId ?? null,
          json(input.metadata ?? {}),
          input.expiresAt ?? null,
        ]
      );
      return mapFile(result.rows[0]!);
    },
    async getFile(id) {
      const result = await database.query<Row>('select * from module_files where id = $1', [id]);
      return result.rows[0] ? mapFile(result.rows[0]) : null;
    },
    async updateFile(id, patch) {
      const result = await database.query<Row>(
        `update module_files
         set status = coalesce($2, status),
             visibility = coalesce($3, visibility),
             content_type = coalesce($4, content_type),
             size_bytes = coalesce($5, size_bytes),
             checksum = coalesce($6, checksum),
             metadata = metadata || $7::jsonb,
             expires_at = coalesce($8::timestamptz, expires_at),
             published_at = coalesce($9::timestamptz, published_at),
             deleted_at = coalesce($10::timestamptz, deleted_at),
             quarantined_at = coalesce($11::timestamptz, quarantined_at),
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          patch.status ?? null,
          patch.visibility ?? null,
          patch.contentType ?? null,
          patch.sizeBytes ?? null,
          patch.checksum ?? null,
          json(patch.metadata ?? {}),
          patch.expiresAt ?? null,
          patch.publishedAt ?? null,
          patch.deletedAt ?? null,
          patch.quarantinedAt ?? null,
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_FILE_NOT_FOUND: ${id}`);
      }
      return mapFile(result.rows[0]);
    },
    async listFiles(query = {}) {
      const result = await database.query<Row>(
        `select * from module_files
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or owner_id = $4)
           and ($5::text is null or purpose = $5)
           and ($6::text is null or status = $6)
           and ($7::text is null or visibility = $7)
           and ($8::text is null or run_id = $8)
           and ($9::boolean = true or status <> 'deleted')
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.ownerId ?? null,
          query.purpose ?? null,
          query.status ?? null,
          query.visibility ?? null,
          query.runId ?? null,
          query.includeDeleted ?? false,
        ]
      );
      return result.rows.map(mapFile);
    },
    async upsertCatalogState(state: ModuleCatalogModuleState) {
      const result = await database.query<Row>(
        `insert into module_catalog_states (
          product_id, module_id, status, bundle_id, required, scope_profile, diagnostics
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (product_id, module_id)
        do update set
          status = excluded.status,
          bundle_id = excluded.bundle_id,
          required = excluded.required,
          scope_profile = excluded.scope_profile,
          diagnostics = excluded.diagnostics,
          updated_at = now()
        returning *`,
        [
          state.productId,
          state.moduleId,
          state.status,
          state.bundleId ?? null,
          state.required ?? false,
          state.scopeProfile ?? null,
          json(state.diagnostics ?? []),
        ]
      );
      return mapCatalogState(result.rows[0]!);
    },
    async listCatalogStates(query = {}) {
      const result = await database.query<Row>(
        `select * from module_catalog_states
         where ($1::text is null or product_id = $1)
           and ($2::text is null or status = $2)
         order by module_id asc`,
        [query.productId ?? null, query.status ?? null]
      );
      return result.rows.map(mapCatalogState);
    },
    async upsertMembership(input) {
      const id = input.id ?? `${input.productId}:${input.workspaceId}:${input.userId}`;
      const result = await database.query<Row>(
        `insert into module_product_scope_memberships (
          id, product_id, workspace_id, user_id, role, status
        )
        values ($1, $2, $3, $4, $5, $6)
        on conflict (product_id, workspace_id, user_id)
        do update set role = excluded.role, status = excluded.status, updated_at = now()
        returning *`,
        [id, input.productId, input.workspaceId, input.userId, input.role, input.status]
      );
      return mapMembership(result.rows[0]!);
    },
    async listMemberships(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_memberships
         where ($1::text is null or product_id = $1)
           and ($2::text is null or workspace_id = $2)
           and ($3::text is null or user_id = $3)
         order by updated_at desc`,
        [query.productId ?? null, query.workspaceId ?? null, query.userId ?? null]
      );
      return result.rows.map(mapMembership);
    },
    async upsertProductScopeProduct(product) {
      const result = await database.query<Row>(
        `insert into module_product_scope_products (
          id, name, profile, default_workspace_id
        )
        values ($1, $2, $3, $4)
        on conflict (id)
        do update set
          name = excluded.name,
          profile = excluded.profile,
          default_workspace_id = excluded.default_workspace_id,
          updated_at = now()
        returning *`,
        [product.id, product.name, product.profile, product.defaultWorkspaceId ?? null]
      );
      return mapProductScopeProduct(result.rows[0]!);
    },
    async listProductScopeProducts(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_products
         where ($1::text is null or id = $1)
         order by id asc`,
        [query.productId ?? null]
      );
      return result.rows.map(mapProductScopeProduct);
    },
    async upsertProductScopeWorkspace(workspace) {
      const result = await database.query<Row>(
        `insert into module_product_scope_workspaces (
          id, product_id, name, slug, domain_aliases
        )
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (id)
        do update set
          product_id = excluded.product_id,
          name = excluded.name,
          slug = excluded.slug,
          domain_aliases = excluded.domain_aliases,
          updated_at = now()
        returning *`,
        [
          workspace.id,
          workspace.productId,
          workspace.name,
          workspace.slug,
          json(workspace.domainAliases ?? null),
        ]
      );
      return mapProductScopeWorkspace(result.rows[0]!);
    },
    async listProductScopeWorkspaces(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_workspaces
         where ($1::text is null or product_id = $1)
           and ($2::text is null or id = $2)
         order by product_id asc, id asc`,
        [query.productId ?? null, query.workspaceId ?? null]
      );
      return result.rows.map(mapProductScopeWorkspace);
    },
    async upsertProductScopeDomainAlias(alias) {
      const result = await database.query<Row>(
        `insert into module_product_scope_domain_aliases (
          hostname, product_id, workspace_id
        )
        values (lower($1), $2, $3)
        on conflict (hostname)
        do update set
          product_id = excluded.product_id,
          workspace_id = excluded.workspace_id,
          updated_at = now()
        returning *`,
        [alias.hostname, alias.productId, alias.workspaceId ?? null]
      );
      return mapProductScopeDomainAlias(result.rows[0]!);
    },
    async listProductScopeDomainAliases(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_domain_aliases
         where ($1::text is null or product_id = $1)
           and ($2::text is null or hostname = lower($2))
         order by hostname asc`,
        [query.productId ?? null, query.hostname ?? null]
      );
      return result.rows.map(mapProductScopeDomainAlias);
    },
    async upsertProductScopeInvite(invite) {
      const result = await database.query<Row>(
        `insert into module_product_scope_invites (
          id, product_id, workspace_id, email, role, status, token, expires_at, invited_by, accepted_by
        )
        values ($1, $2, $3, lower($4), $5, $6, $7, $8::timestamptz, $9, $10)
        on conflict (token)
        do update set
          email = excluded.email,
          role = excluded.role,
          status = excluded.status,
          expires_at = excluded.expires_at,
          invited_by = excluded.invited_by,
          accepted_by = excluded.accepted_by,
          updated_at = now()
        returning *`,
        [
          invite.id,
          invite.productId,
          invite.workspaceId,
          invite.email,
          invite.role,
          invite.status,
          invite.token,
          invite.expiresAt,
          invite.invitedBy ?? null,
          invite.acceptedBy ?? null,
        ]
      );
      return mapProductScopeInvite(result.rows[0]!);
    },
    async listProductScopeInvites(query = {}) {
      const result = await database.query<Row>(
        `select * from module_product_scope_invites
         where ($1::text is null or product_id = $1)
           and ($2::text is null or workspace_id = $2)
           and ($3::text is null or status = $3)
           and ($4::text is null or token = $4)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId ?? null,
          query.status ?? null,
          query.token ?? null,
        ]
      );
      return result.rows.map(mapProductScopeInvite);
    },
    async upsertHostUser(input) {
      const result = await database.query<Row>(
        `insert into module_host_users (
          id, email, password_hash, role, status, product_id, workspace_id,
          workspace_role, permissions, metadata
        )
        values ($1, lower($2), $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
        on conflict (id)
        do update set
          email = excluded.email,
          password_hash = excluded.password_hash,
          role = excluded.role,
          status = excluded.status,
          product_id = excluded.product_id,
          workspace_id = excluded.workspace_id,
          workspace_role = excluded.workspace_role,
          permissions = excluded.permissions,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          input.id,
          input.email,
          input.passwordHash,
          input.role,
          input.status,
          input.productId,
          input.workspaceId,
          input.workspaceRole,
          json(input.permissions ?? null),
          json(input.metadata ?? {}),
        ]
      );
      return mapHostUser(result.rows[0]!);
    },
    async getHostUser(id) {
      const result = await database.query<Row>('select * from module_host_users where id = $1', [
        id,
      ]);
      return result.rows[0] ? mapHostUser(result.rows[0]) : null;
    },
    async findHostUserByEmail(email) {
      const result = await database.query<Row>(
        'select * from module_host_users where lower(email) = lower($1) limit 1',
        [email]
      );
      return result.rows[0] ? mapHostUser(result.rows[0]) : null;
    },
    async listHostUsers(query = {}) {
      const result = await database.query<Row>(
        `select * from module_host_users
         where ($1::text is null or product_id = $1)
           and ($2::text is null or role = $2)
           and ($3::text is null or status = $3)
         order by created_at asc`,
        [query.productId ?? null, query.role ?? null, query.status ?? null]
      );
      return result.rows.map(mapHostUser);
    },
    async updateHostUserStatus(id: string, status: RuntimeStoreHostUserStatus, metadata) {
      const result = await database.query<Row>(
        `update module_host_users
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_HOST_USER_NOT_FOUND: ${id}`);
      }
      return mapHostUser(result.rows[0]);
    },
    async upsertSetting(input) {
      const status = input.status ?? 'active';
      const settingId = `${input.productId}:${input.workspaceId ?? ''}:${input.namespace}:${input.key}:${status}`;
      const result = await database.query<Row>(
        `insert into module_host_settings (
          id, product_id, workspace_id, namespace, key, value_json, status,
          version, updated_by, metadata
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, coalesce($8::integer, 1), $9, $10::jsonb)
        on conflict (id)
        do update set
          value_json = excluded.value_json,
          version = coalesce($8::integer, module_host_settings.version + 1),
          updated_by = excluded.updated_by,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          settingId,
          input.productId,
          input.workspaceId ?? null,
          input.namespace,
          input.key,
          json(input.value),
          status,
          input.version ?? null,
          input.actorId ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapSetting(result.rows[0]!) as never;
    },
    async getSetting(query) {
      const result = await database.query<Row>(
        `select * from module_host_settings
         where product_id = $1
           and namespace = $2
           and key = $3
           and ($4::text is null or coalesce(workspace_id, '') = coalesce($4, ''))
           and status = $5
         order by version desc
         limit 1`,
        [
          query.productId,
          query.namespace,
          query.key,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.status ?? 'active',
        ]
      );
      return result.rows[0] ? (mapSetting(result.rows[0]) as never) : null;
    },
    async listSettings(query = {}) {
      const result = await database.query<Row>(
        `select * from module_host_settings
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or namespace = $3)
           and ($4::text is null or status = $4)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.namespace ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map((row) => mapSetting(row)) as never;
    },
    async upsertServiceConnection(input) {
      const result = await database.query<Row>(
        `insert into module_service_connections (
          connection_id, product_id, workspace_id, module_id, service, provider,
          status, environment, owner_type, scope_type, auth_type, config,
          secret_refs, health, last_used_at, updated_by, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, $13::jsonb, $14::jsonb, $15::timestamptz, $16, $17::jsonb
        )
        on conflict (product_id, connection_id)
        do update set
          workspace_id = excluded.workspace_id,
          module_id = excluded.module_id,
          service = excluded.service,
          provider = excluded.provider,
          status = excluded.status,
          environment = excluded.environment,
          owner_type = excluded.owner_type,
          scope_type = excluded.scope_type,
          auth_type = excluded.auth_type,
          config = excluded.config,
          secret_refs = excluded.secret_refs,
          health = excluded.health,
          last_used_at = excluded.last_used_at,
          updated_by = excluded.updated_by,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          input.connectionId,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.service,
          input.provider,
          input.status ?? 'active',
          input.environment ?? null,
          input.ownerType ?? null,
          input.scopeType ?? null,
          input.authType ?? null,
          json(input.config ?? {}),
          json(input.secretRefs ?? {}),
          json(input.health ?? {}),
          input.lastUsedAt ?? null,
          input.actorId ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapServiceConnection(result.rows[0]!);
    },
    async getServiceConnection(productId, connectionId) {
      const result = await database.query<Row>(
        `select * from module_service_connections
         where product_id = $1 and connection_id = $2
         limit 1`,
        [productId, connectionId]
      );
      return result.rows[0] ? mapServiceConnection(result.rows[0]) : null;
    },
    async listServiceConnections(query = {}) {
      const result = await database.query<Row>(
        `select * from module_service_connections
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or service = $3)
           and ($4::text is null or provider = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.service ?? null,
          query.provider ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapServiceConnection);
    },
    async touchServiceConnection(productId, connectionId, patch = {}) {
      const result = await database.query<Row>(
        `update module_service_connections
         set health = coalesce($3::jsonb, health),
             metadata = metadata || $4::jsonb,
             last_used_at = now(),
             updated_at = now()
         where product_id = $1 and connection_id = $2
         returning *`,
        [productId, connectionId, patch.health ? json(patch.health) : null, json(patch.metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_SERVICE_CONNECTION_NOT_FOUND: ${connectionId}`);
      }
      return mapServiceConnection(result.rows[0]);
    },
    async upsertResourceBinding(input) {
      const bindingId =
        input.bindingId ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId ?? ''}:${input.name}`;
      const result = await database.query<Row>(
        `insert into module_resource_bindings (
          binding_id, product_id, workspace_id, module_id, name, kind,
          value_json, status, updated_by, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb)
        on conflict (binding_id)
        do update set
          product_id = excluded.product_id,
          workspace_id = excluded.workspace_id,
          module_id = excluded.module_id,
          name = excluded.name,
          kind = excluded.kind,
          value_json = excluded.value_json,
          status = excluded.status,
          updated_by = excluded.updated_by,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          bindingId,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.name,
          input.kind ?? null,
          json(input.value),
          input.status ?? 'active',
          input.actorId ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapResourceBinding(result.rows[0]!) as never;
    },
    async listResourceBindings(query = {}) {
      const result = await database.query<Row>(
        `select * from module_resource_bindings
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or coalesce(module_id, '') = coalesce($3, ''))
           and ($4::text is null or name = $4)
           and ($5::text is null or kind = $5)
           and ($6::text is null or status = $6)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.name ?? null,
          query.kind ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map((row) => mapResourceBinding(row)) as never;
    },
  };
}
