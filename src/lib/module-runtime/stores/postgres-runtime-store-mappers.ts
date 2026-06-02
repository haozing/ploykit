import type { ModuleCatalogModuleState } from '../catalog';
import type { ModuleRunLogEntry, ModuleRunRecord } from '../runs';
import { splitAuditEnvelope } from '../observability/audit-metadata';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeProduct,
  ProductScopeWorkspace,
} from '../scope/product-scope-types';
import type {
  RuntimeStoreApiKeyRecord,
  RuntimeStoreAuditRecord,
  RuntimeStoreBillingAccount,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreFileRecord,
  RuntimeStoreHostUser,
  RuntimeStoreInvoiceRecord,
  RuntimeStoreMembership,
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreNotificationDeliveryRecord,
  RuntimeStoreNotificationRecord,
  RuntimeStoreOutboxRecord,
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
  RuntimeStoreWorkerRecord,
} from './runtime-store-types';

export type Row = Record<string, any>;

function toIso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function mapRun(row: Row, logs: ModuleRunLogEntry[] = []): ModuleRunRecord {
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

export function mapOutbox(row: Row): RuntimeStoreOutboxRecord {
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

export function mapDelivery(row: Row): RuntimeStoreDeliveryRecord {
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

export function mapWorker(row: Row): RuntimeStoreWorkerRecord {
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

export function mapReceipt(row: Row): RuntimeStoreWebhookReceipt {
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

export function mapNotification(row: Row): RuntimeStoreNotificationRecord {
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

export function mapNotificationDelivery(row: Row): RuntimeStoreNotificationDeliveryRecord {
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

export function mapAudit(row: Row): RuntimeStoreAuditRecord {
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

export function mapUsage(row: Row): RuntimeStoreUsageRecord {
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

export function mapMetering(row: Row): RuntimeStoreMeteringLedgerEntry {
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

export function mapCreditLedger(row: Row): RuntimeStoreCreditLedgerEntry {
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

export function mapCreditReservation(row: Row): RuntimeStoreCreditReservation {
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

export function mapEntitlement(row: Row): RuntimeStoreEntitlementGrant {
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

export function mapCommercialCatalogItem(row: Row): RuntimeStoreCommercialCatalogItem {
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

export function mapCommercialOrder(row: Row): RuntimeStoreCommercialOrder {
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

export function mapBillingAccount(row: Row): RuntimeStoreBillingAccount {
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

export function mapInvoice(row: Row): RuntimeStoreInvoiceRecord {
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

export function mapCreditNote(row: Row): RuntimeStoreCreditNoteRecord {
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

export function mapSubscription(row: Row): RuntimeStoreSubscriptionRecord {
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

export function mapSubscriptionEvent(row: Row): RuntimeStoreSubscriptionEventRecord {
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

export function mapTaxProfile(row: Row): RuntimeStoreTaxProfileRecord {
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

export function mapRevenueBucket(row: Row): RuntimeStoreRevenueBucket {
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

export function mapProviderInvocation(row: Row): RuntimeStoreProviderInvocationRecord {
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

export function mapRagSource(row: Row): RuntimeStoreRagSourceRecord {
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

export function mapRagChunk(row: Row): RuntimeStoreRagChunkRecord {
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

export function mapSettlementBatch(row: Row): RuntimeStoreSettlementBatch {
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

export function mapRedeemCode(row: Row): RuntimeStoreRedeemCode {
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

export function mapRedeemRedemption(row: Row): RuntimeStoreRedeemRedemption {
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

export function mapApiKey(row: Row): RuntimeStoreApiKeyRecord {
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

export function mapRiskEvent(row: Row): RuntimeStoreRiskEvent {
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

export function mapRiskBlock(row: Row): RuntimeStoreRiskBlock {
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

export function mapFile(row: Row): RuntimeStoreFileRecord {
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

export function mapCatalogState(row: Row): ModuleCatalogModuleState {
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

export function mapMembership(row: Row): RuntimeStoreMembership {
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

export function mapProductScopeProduct(row: Row): ProductScopeProduct {
  return {
    id: row.id,
    name: row.name,
    profile: row.profile,
    defaultWorkspaceId: row.default_workspace_id ?? undefined,
  };
}

export function mapProductScopeWorkspace(row: Row): ProductScopeWorkspace {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    slug: row.slug,
    domainAliases: row.domain_aliases ?? undefined,
  };
}

export function mapProductScopeDomainAlias(row: Row): ProductScopeDomainAlias {
  return {
    hostname: row.hostname,
    productId: row.product_id,
    workspaceId: row.workspace_id ?? undefined,
  };
}

export function mapProductScopeInvite(row: Row): ProductScopeInvite {
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

export function mapHostUser(row: Row): RuntimeStoreHostUser {
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

export function mapSetting(row: Row): RuntimeStoreSettingRecord {
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

export function mapServiceConnection(row: Row): RuntimeStoreServiceConnectionRecord {
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

export function mapResourceBinding(row: Row): RuntimeStoreResourceBindingRecord {
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
