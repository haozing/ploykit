import { randomUUID } from 'node:crypto';
import type { ModuleRunLogEntry, ModuleRunRecord, ModuleRunStatus } from '../runs';
import type { ModuleCatalogModuleState } from '../catalog';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeProduct,
  ProductScopeWorkspace,
} from '../scope/product-scope-types';
import { redactSensitive } from '../observability/redaction';
import { createAuditEnvelope } from '../observability/audit-metadata';
import type {
  CreateRuntimeStoreRunInput,
  CreateRuntimeStoreNotificationInput,
  CreateRuntimeStoreWebhookReceiptInput,
  EnqueueRuntimeStoreOutboxInput,
  RuntimeStore,
  RuntimeStoreAuditRecord,
  RuntimeStoreApiKeyRecord,
  RuntimeStoreBillingAccount,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditNoteRecord,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreCreditStatus,
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
  RuntimeStoreSettingStatus,
  RuntimeStoreSettlementBatch,
  RuntimeStoreSubscriptionEventRecord,
  RuntimeStoreSubscriptionRecord,
  RuntimeStoreTaxProfileRecord,
  RuntimeStoreResourceBindingStatus,
  RuntimeStoreUsageRecord,
  RuntimeStoreWebhookReceipt,
  RuntimeStoreWebhookReceiptStatus,
  RuntimeStoreWorkerRecord,
  UpsertRuntimeStoreCommercialCatalogItemInput,
  UpsertRuntimeStoreResourceBindingInput,
  UpsertRuntimeStoreSettingInput,
} from './runtime-store-types';

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeError(error: Error | string): { code: string; message: string } {
  return typeof error === 'string'
    ? { code: 'RUNTIME_STORE_ERROR', message: error }
    : { code: error.name || 'RUNTIME_STORE_ERROR', message: error.message };
}

function normalizeDeliveryError(
  error?: Error | string | { code: string; message: string }
): { code: string; message: string } | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'object' && 'code' in error && 'message' in error) {
    return error;
  }
  return normalizeError(error);
}

interface MemoryCreditLedgerWriteInput {
  productId: string;
  workspaceId?: string | null;
  userId: string;
  amount: number;
  unit: string;
  reason: string;
  status?: RuntimeStoreCreditStatus;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export function createInMemoryRuntimeStore(
  options: {
    now?: () => Date;
    createId?: (prefix: string) => string;
  } = {}
): RuntimeStore {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  const runs = new Map<string, ModuleRunRecord>();
  const runIdempotency = new Map<string, string>();
  const outbox = new Map<string, RuntimeStoreOutboxRecord>();
  const outboxIdempotency = new Map<string, string>();
  const deliveries = new Map<string, RuntimeStoreDeliveryRecord>();
  const workers = new Map<string, RuntimeStoreWorkerRecord>();
  const receipts = new Map<string, RuntimeStoreWebhookReceipt>();
  const receiptIdempotency = new Map<string, string>();
  const notifications = new Map<string, RuntimeStoreNotificationRecord>();
  const notificationIdempotency = new Map<string, string>();
  const notificationDeliveries = new Map<string, RuntimeStoreNotificationDeliveryRecord>();
  const audit: RuntimeStoreAuditRecord[] = [];
  const usage = new Map<string, RuntimeStoreUsageRecord>();
  const usageIdempotency = new Map<string, string>();
  const metering = new Map<string, RuntimeStoreMeteringLedgerEntry>();
  const meteringIdempotency = new Map<string, string>();
  const creditLedger = new Map<string, RuntimeStoreCreditLedgerEntry>();
  const creditIdempotency = new Map<string, string>();
  const creditReservations = new Map<string, RuntimeStoreCreditReservation>();
  const creditReservationIdempotency = new Map<string, string>();
  const entitlements = new Map<string, RuntimeStoreEntitlementGrant>();
  const entitlementIdempotency = new Map<string, string>();
  const commercialCatalog = new Map<string, RuntimeStoreCommercialCatalogItem>();
  const orders = new Map<string, RuntimeStoreCommercialOrder>();
  const orderIdempotency = new Map<string, string>();
  const providerOrders = new Map<string, string>();
  const billingAccounts = new Map<string, RuntimeStoreBillingAccount>();
  const invoices = new Map<string, RuntimeStoreInvoiceRecord>();
  const creditNotes = new Map<string, RuntimeStoreCreditNoteRecord>();
  const subscriptions = new Map<string, RuntimeStoreSubscriptionRecord>();
  const taxProfiles = new Map<string, RuntimeStoreTaxProfileRecord>();
  const revenueBuckets = new Map<string, RuntimeStoreRevenueBucket>();
  const settlementBatches = new Map<string, RuntimeStoreSettlementBatch>();
  const subscriptionEvents = new Map<string, RuntimeStoreSubscriptionEventRecord>();
  const subscriptionEventIdempotency = new Map<string, string>();
  const providerInvocations = new Map<string, RuntimeStoreProviderInvocationRecord>();
  const ragSources = new Map<string, RuntimeStoreRagSourceRecord>();
  const ragChunks = new Map<string, RuntimeStoreRagChunkRecord>();
  const redeemCodes = new Map<string, RuntimeStoreRedeemCode>();
  const redemptions = new Map<string, RuntimeStoreRedeemRedemption>();
  const redemptionIdempotency = new Map<string, string>();
  const apiKeys = new Map<string, RuntimeStoreApiKeyRecord>();
  const riskEvents = new Map<string, RuntimeStoreRiskEvent>();
  const riskBlocks = new Map<string, RuntimeStoreRiskBlock>();
  const riskBlockIdempotency = new Map<string, string>();
  const files = new Map<string, RuntimeStoreFileRecord>();
  const catalog = new Map<string, ModuleCatalogModuleState>();
  const memberships = new Map<string, RuntimeStoreMembership>();
  const productScopeProducts = new Map<string, ProductScopeProduct>();
  const productScopeWorkspaces = new Map<string, ProductScopeWorkspace>();
  const productScopeAliases = new Map<string, ProductScopeDomainAlias>();
  const productScopeInvites = new Map<string, ProductScopeInvite>();
  const hostUsers = new Map<string, RuntimeStoreHostUser>();
  const settings = new Map<string, RuntimeStoreSettingRecord>();
  const serviceConnections = new Map<string, RuntimeStoreServiceConnectionRecord>();
  const resourceBindings = new Map<string, RuntimeStoreResourceBindingRecord>();

  function effectiveCreditStatus(record: RuntimeStoreCreditLedgerEntry): RuntimeStoreCreditStatus {
    if (
      record.status === 'available' &&
      record.expiresAt &&
      new Date(record.expiresAt).getTime() <= now().getTime()
    ) {
      return 'expired';
    }
    return record.status;
  }

  function cloneCreditLedger(record: RuntimeStoreCreditLedgerEntry): RuntimeStoreCreditLedgerEntry {
    return clone({ ...record, status: effectiveCreditStatus(record) });
  }

  function creditLedgerIdempotencyKey(input: {
    productId: string;
    workspaceId?: string | null;
    userId: string;
    unit: string;
    idempotencyKey?: string;
  }): string | null {
    return input.idempotencyKey
      ? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.unit}:${input.idempotencyKey}`
      : null;
  }

  function creditReservationIdempotencyKey(input: {
    productId: string;
    workspaceId?: string | null;
    userId: string;
    unit: string;
    idempotencyKey?: string;
  }): string | null {
    return input.idempotencyKey
      ? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.unit}:${input.idempotencyKey}`
      : null;
  }

  function availableCreditBalance(input: {
    productId: string;
    workspaceId?: string | null;
    userId: string;
    unit: string;
  }): number {
    return [...creditLedger.values()]
      .filter((record) => record.productId === input.productId)
      .filter((record) => input.workspaceId === undefined || record.workspaceId === input.workspaceId)
      .filter((record) => record.userId === input.userId)
      .filter((record) => record.unit === input.unit)
      .filter((record) => effectiveCreditStatus(record) === 'available')
      .reduce((sum, entry) => sum + entry.amount, 0);
  }

  function insertCreditLedger(input: MemoryCreditLedgerWriteInput): RuntimeStoreCreditLedgerEntry {
    const key = creditLedgerIdempotencyKey(input);
    if (key) {
      const existingId = creditIdempotency.get(key);
      if (existingId) {
        return cloneCreditLedger(creditLedger.get(existingId)!);
      }
    }

    const record: RuntimeStoreCreditLedgerEntry = {
      id: createId('credit'),
      productId: input.productId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      amount: input.amount,
      unit: input.unit,
      reason: input.reason,
      status:
        input.status ??
        (input.expiresAt && new Date(input.expiresAt).getTime() <= now().getTime()
          ? 'expired'
          : 'available'),
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
      metadata: input.metadata ?? {},
      createdAt: iso(now),
    };
    creditLedger.set(record.id, record);
    if (key) {
      creditIdempotency.set(key, record.id);
    }
    return cloneCreditLedger(record);
  }

  function readRun(id: string): ModuleRunRecord {
    const run = runs.get(id);
    if (!run) {
      throw new Error(`RUNTIME_STORE_RUN_NOT_FOUND: ${id}`);
    }
    return run;
  }

  function readMetering(id: string): RuntimeStoreMeteringLedgerEntry {
    const record = metering.get(id);
    if (!record) {
      throw new Error(`RUNTIME_STORE_METERING_NOT_FOUND: ${id}`);
    }
    return record;
  }

  function readOrder(id: string): RuntimeStoreCommercialOrder {
    const order = orders.get(id);
    if (!order) {
      throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_NOT_FOUND: ${id}`);
    }
    return order;
  }

  function readFile(id: string): RuntimeStoreFileRecord {
    const file = files.get(id);
    if (!file) {
      throw new Error(`RUNTIME_STORE_FILE_NOT_FOUND: ${id}`);
    }
    return file;
  }

  function readHostUser(id: string): RuntimeStoreHostUser {
    const user = hostUsers.get(id);
    if (!user) {
      throw new Error(`RUNTIME_STORE_HOST_USER_NOT_FOUND: ${id}`);
    }
    return user;
  }

  function notificationKey(input: CreateRuntimeStoreNotificationInput): string | null {
    return input.idempotencyKey
      ? `${input.productId}:${input.userId}:${input.source ?? 'host'}:${input.idempotencyKey}`
      : null;
  }

  return {
    async createRun<TInput = unknown>(input: CreateRuntimeStoreRunInput<TInput>) {
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = runIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(readRun(existingId) as ModuleRunRecord<TInput>);
        }
      }
      if (input.id && runs.has(input.id)) {
        const existing = readRun(input.id);
        if (input.idempotencyKey && existing.idempotencyKey === input.idempotencyKey) {
          return clone(existing as ModuleRunRecord<TInput>);
        }
        throw new Error(`RUNTIME_STORE_RUN_ID_CONFLICT: ${input.id}`);
      }

      const timestamp = iso(now);
      const run: ModuleRunRecord<TInput> = {
        id: input.id ?? createId('run'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        kind: input.kind,
        name: input.name,
        status: 'queued',
        progress: 0,
        attempt: 0,
        maxAttempts: input.maxAttempts ?? 1,
        input: input.input,
        costRef: input.costRef,
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
        logs: [],
      };
      runs.set(run.id, run);
      if (idempotencyKey) {
        runIdempotency.set(idempotencyKey, run.id);
      }
      return clone(run);
    },
    async getRun(id) {
      const run = runs.get(id);
      return run ? clone(run) : null;
    },
    async listRuns(query = {}) {
      return [...runs.values()]
        .filter((run) => !query.productId || run.productId === query.productId)
        .filter((run) => query.workspaceId === undefined || (run.workspaceId ?? null) === query.workspaceId)
        .filter((run) => !query.moduleId || run.moduleId === query.moduleId)
        .filter((run) => !query.status || run.status === query.status)
        .filter((run) => !query.kind || run.kind === query.kind)
        .filter((run) => !query.idempotencyKey || run.idempotencyKey === query.idempotencyKey)
        .map((run) => clone(run));
    },
    async updateRunStatus(id: string, status: ModuleRunStatus, patch = {}) {
      const previous = readRun(id);
      const timestamp = iso(now);
      const next: ModuleRunRecord = {
        ...previous,
        status,
        progress: patch.progress ?? previous.progress,
        result: patch.result,
        error: patch.error,
        updatedAt: timestamp,
        startedAt: status === 'running' ? (previous.startedAt ?? timestamp) : previous.startedAt,
        completedAt: ['succeeded', 'failed', 'canceled'].includes(status)
          ? timestamp
          : previous.completedAt,
        cancelRequestedAt:
          status === 'cancel_requested' ? (previous.cancelRequestedAt ?? timestamp) : previous.cancelRequestedAt,
        canceledAt: status === 'canceled' ? (previous.canceledAt ?? timestamp) : previous.canceledAt,
      };
      runs.set(id, next);
      return clone(next);
    },
    async appendRunLog(id, level: ModuleRunLogEntry['level'], message, metadata) {
      const run = readRun(id);
      const next = {
        ...run,
        logs: [...run.logs, { at: iso(now), level, message, metadata: redactSensitive(metadata) }],
        updatedAt: iso(now),
      };
      runs.set(id, next);
      return clone(next);
    },
    async enqueueOutbox<TPayload = unknown>(input: EnqueueRuntimeStoreOutboxInput<TPayload>) {
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.name}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = outboxIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(outbox.get(existingId) as RuntimeStoreOutboxRecord<TPayload>);
        }
      }

      const timestamp = iso(now);
      const record: RuntimeStoreOutboxRecord<TPayload> = {
        id: createId('outbox'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        name: input.name,
        payload: input.payload,
        metadata: input.metadata ?? {},
        status: 'queued',
        attempts: 0,
        idempotencyKey: input.idempotencyKey,
        scheduledAt: input.scheduledAt,
        priority: input.priority ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      outbox.set(record.id, record);
      if (idempotencyKey) {
        outboxIdempotency.set(idempotencyKey, record.id);
      }
      return clone(record);
    },
    async listOutbox(query = {}) {
      return [...outbox.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.name || record.name === query.name)
        .filter((record) => !query.namePrefix || record.name.startsWith(query.namePrefix))
        .map((record) => clone(record));
    },
    async claimOutbox(query = {}) {
      const statuses = query.statuses ?? ['queued', 'failed'];
      const timestamp = now().getTime();
      const leaseExpiresAt = iso(() => new Date(timestamp + (query.leaseMs ?? 60_000)));
      return [...outbox.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.name || record.name === query.name)
        .filter((record) => !query.namePrefix || record.name.startsWith(query.namePrefix))
        .filter((record) => {
          const scheduledDue =
            !record.scheduledAt || new Date(record.scheduledAt).getTime() <= timestamp;
          const expiredLease =
            record.status === 'processing' &&
            record.leaseExpiresAt !== undefined &&
            record.leaseExpiresAt !== null &&
            new Date(record.leaseExpiresAt).getTime() <= timestamp;
          return (statuses.includes(record.status) && scheduledDue) || expiredLease;
        })
        .sort((left, right) => {
          const priorityDiff = (right.priority ?? 0) - (left.priority ?? 0);
          if (priorityDiff !== 0) {
            return priorityDiff;
          }
          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        })
        .slice(0, query.limit ?? 50)
        .map((record) => {
          const next: RuntimeStoreOutboxRecord = {
            ...record,
            status: 'processing',
            attempts: record.attempts + 1,
            leaseOwner: query.leaseOwner ?? 'runtime-store-worker',
            leaseExpiresAt,
            heartbeatAt: iso(now),
            updatedAt: iso(now),
          };
          outbox.set(record.id, next);
          return clone(next);
        });
    },
    async markOutbox(
      id: string,
      status: RuntimeStoreOutboxStatus,
      error?: Error | string,
      options = {}
    ) {
      const previous = outbox.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_OUTBOX_NOT_FOUND: ${id}`);
      }
      const timestamp = iso(now);
      const next = {
        ...previous,
        status,
        attempts: status === 'processing' ? previous.attempts + 1 : previous.attempts,
        processedAt: status === 'processed' ? timestamp : previous.processedAt,
        scheduledAt: options.scheduledAt ?? undefined,
        leaseOwner: status === 'processing' ? previous.leaseOwner : null,
        leaseExpiresAt: status === 'processing' ? previous.leaseExpiresAt : null,
        heartbeatAt: status === 'processing' ? (options.heartbeatAt ?? timestamp) : null,
        updatedAt: timestamp,
        error: error ? normalizeError(error) : undefined,
      };
      outbox.set(id, next);
      return clone(next);
    },
    async recordDelivery(input) {
      const timestamp = iso(now);
      const record: RuntimeStoreDeliveryRecord = {
        id: createId('delivery'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        actorId: input.actorId ?? null,
        kind: input.kind,
        source: input.source,
        target: input.target,
        status: input.status,
        attempts: input.attempts ?? 0,
        outboxId: input.outboxId ?? null,
        runId: input.runId ?? null,
        receiptId: input.receiptId ?? null,
        eventId: input.eventId ?? null,
        emailId: input.emailId ?? null,
        workerId: input.workerId ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        nextRetryAt: input.nextRetryAt ?? null,
        errorCategory: input.errorCategory ?? null,
        error: normalizeDeliveryError(input.error),
        metadata: redactSensitive(input.metadata ?? {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      deliveries.set(record.id, record);
      return clone(record);
    },
    async listDeliveries(query = {}) {
      return [...deliveries.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter(
          (record) =>
            query.moduleId === undefined || (record.moduleId ?? null) === query.moduleId
        )
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.outboxId || record.outboxId === query.outboxId)
        .filter((record) => !query.runId || record.runId === query.runId)
        .filter((record) => !query.receiptId || record.receiptId === query.receiptId)
        .filter((record) => !query.eventId || record.eventId === query.eventId)
        .filter((record) => !query.emailId || record.emailId === query.emailId)
        .filter((record) => !query.workerId || record.workerId === query.workerId)
        .filter((record) => !query.correlationId || record.correlationId === query.correlationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
    async upsertWorkerHeartbeat(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.workerId}`;
      const existing = workers.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreWorkerRecord = {
        id: existing?.id ?? createId('worker'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        workerId: input.workerId,
        profile: input.profile ?? existing?.profile ?? 'default',
        status: input.status ?? existing?.status ?? 'running',
        queueProfile: input.queueProfile ?? existing?.queueProfile ?? 'default',
        heartbeatAt: input.heartbeatAt ?? timestamp,
        lastDrainAt: input.lastDrainAt ?? existing?.lastDrainAt ?? null,
        lastDurationMs: input.lastDurationMs ?? existing?.lastDurationMs ?? 0,
        processed: input.processed ?? existing?.processed ?? 0,
        failed: input.failed ?? existing?.failed ?? 0,
        deadLettered: input.deadLettered ?? existing?.deadLettered ?? 0,
        metadata: redactSensitive({ ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) }),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      workers.set(key, record);
      return clone(record);
    },
    async listWorkers(query = {}) {
      return [...workers.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.workerId || record.workerId === query.workerId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async createWebhookReceipt(input: CreateRuntimeStoreWebhookReceiptInput) {
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.moduleId}:${input.webhookName}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = receiptIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(receipts.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const receipt: RuntimeStoreWebhookReceipt = {
        id: createId('wh'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        webhookName: input.webhookName,
        path: input.path,
        method: input.method,
        status: 'received',
        attempts: 0,
        idempotencyKey: input.idempotencyKey,
        signature: input.signature,
        headers: redactSensitive(input.headers ?? {}),
        bodyText: input.bodyText,
        bodyDigest: input.bodyDigest,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      receipts.set(receipt.id, receipt);
      if (idempotencyKey) {
        receiptIdempotency.set(idempotencyKey, receipt.id);
      }
      return clone(receipt);
    },
    async findWebhookReceiptByIdempotencyKey(productId, moduleId, webhookName, idempotencyKey) {
      const id = receiptIdempotency.get(
        `${productId}:${moduleId}:${webhookName}:${idempotencyKey}`
      );
      return id ? clone(receipts.get(id)!) : null;
    },
    async markWebhookReceipt(
      id: string,
      status: RuntimeStoreWebhookReceiptStatus,
      error?: Error | string
    ) {
      const previous = receipts.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_WEBHOOK_RECEIPT_NOT_FOUND: ${id}`);
      }
      const timestamp = iso(now);
      const next = {
        ...previous,
        status,
        attempts: status === 'processing' ? previous.attempts + 1 : previous.attempts,
        processedAt: status === 'processed' ? timestamp : previous.processedAt,
        updatedAt: timestamp,
        error: error ? normalizeError(error) : undefined,
      };
      receipts.set(id, next);
      return clone(next);
    },
    async listWebhookReceipts(query = {}) {
      return [...receipts.values()]
        .filter((receipt) => !query.productId || receipt.productId === query.productId)
        .filter((receipt) => !query.moduleId || receipt.moduleId === query.moduleId)
        .filter((receipt) => !query.status || receipt.status === query.status)
        .map((receipt) => clone(receipt));
    },
    async createNotification(input) {
      const key = notificationKey(input);
      if (key) {
        const existingId = notificationIdempotency.get(key);
        if (existingId) {
          return clone(notifications.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const deliveryStatus = input.deliveryStatus ?? 'delivered';
      const record: RuntimeStoreNotificationRecord = {
        id: createId('notification'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId ?? '__host__',
        userId: input.userId,
        channel: input.channel ?? 'inApp',
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        runId: input.runId,
        source: input.source ?? 'host',
        category: input.category ?? 'system',
        status: input.status ?? (deliveryStatus === 'delivered' ? 'unread' : 'read'),
        deliveryStatus,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        readAt: input.status === 'read' || deliveryStatus !== 'delivered' ? timestamp : undefined,
        deliveredAt: deliveryStatus === 'delivered' ? timestamp : undefined,
        skippedAt: deliveryStatus === 'skipped' ? timestamp : undefined,
        error: input.error ? normalizeError(input.error) : undefined,
      };
      notifications.set(record.id, record);
      if (key) {
        notificationIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async listNotifications(query = {}) {
      return [...notifications.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.channel || record.channel === query.channel)
        .filter((record) => !query.category || record.category === query.category)
        .filter(
          (record) => !query.deliveryStatus || record.deliveryStatus === query.deliveryStatus
        )
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .map((record) => clone(record));
    },
    async markNotificationRead(id) {
      const previous = notifications.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_NOTIFICATION_NOT_FOUND: ${id}`);
      }
      const timestamp = iso(now);
      const next: RuntimeStoreNotificationRecord = {
        ...previous,
        status: 'read',
        readAt: previous.readAt ?? timestamp,
      };
      notifications.set(id, next);
      return clone(next);
    },
    async markNotificationsRead(query) {
      const matched = [...notifications.values()]
        .filter((record) => record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => record.userId === query.userId)
        .filter((record) => !query.channel || record.channel === query.channel)
        .filter((record) => !query.category || record.category === query.category)
        .filter((record) => record.deliveryStatus === 'delivered');
      const updated: RuntimeStoreNotificationRecord[] = [];
      for (const record of matched) {
        const timestamp = iso(now);
        const next: RuntimeStoreNotificationRecord = {
          ...record,
          status: 'read',
          readAt: record.readAt ?? timestamp,
        };
        notifications.set(record.id, next);
        updated.push(clone(next));
      }
      return updated;
    },
    async recordNotificationDelivery(input) {
      const record: RuntimeStoreNotificationDeliveryRecord = {
        id: createId('notification_delivery'),
        notificationId: input.notificationId ?? null,
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        channel: input.channel,
        provider: input.provider,
        status: input.status,
        reason: input.reason,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
      };
      notificationDeliveries.set(record.id, record);
      return clone(record);
    },
    async listNotificationDeliveries(query = {}) {
      return [...notificationDeliveries.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.provider || record.provider === query.provider)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .map((record) => clone(record));
    },
    async recordAudit(input) {
      const id = createId('audit');
      const createdAt = iso(now);
      const previousHash =
        [...audit].reverse().find((record) => record.productId === input.productId)?.integrity
          ?.recordHash ?? null;
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
      const record: RuntimeStoreAuditRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        metadata: envelope.metadata,
        integrity: envelope.integrity,
        createdAt,
      };
      audit.push(record);
      return clone(record);
    },
    async listAudit(query = {}) {
      return audit
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.actorId || record.actorId === query.actorId)
        .filter((record) => !query.type || record.type === query.type)
        .filter((record) => !query.from || record.createdAt >= query.from)
        .filter((record) => !query.to || record.createdAt <= query.to)
        .map((record) => clone(record));
    },
    async recordUsage(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.moduleId}:${input.meter}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = usageIdempotency.get(key);
        if (existingId) {
          return clone(usage.get(existingId)!);
        }
      }

      const record: RuntimeStoreUsageRecord = {
        id: createId('usage'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
      };
      usage.set(record.id, record);
      if (key) {
        usageIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async listUsage(query = {}) {
      return [...usage.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.meter || record.meter === query.meter)
        .map((record) => clone(record));
    },
    async recordMetering(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.moduleId}:${input.meter}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = meteringIdempotency.get(key);
        if (existingId) {
          return clone(metering.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const record: RuntimeStoreMeteringLedgerEntry = {
        id: createId('meter'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        status: 'authorized',
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      metering.set(record.id, record);
      if (key) {
        meteringIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async getMetering(id) {
      const record = metering.get(id);
      return record ? clone(record) : null;
    },
    async updateMeteringStatus(
      id: string,
      status: RuntimeStoreMeteringStatus,
      metadata?: Record<string, unknown>
    ) {
      const previous = readMetering(id);
      const next: RuntimeStoreMeteringLedgerEntry = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      metering.set(id, next);
      return clone(next);
    },
    async listMetering(query = {}) {
      return [...metering.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.meter || record.meter === query.meter)
        .filter((record) => !query.status || record.status === query.status)
        .map((record) => clone(record));
    },
    async recordCreditLedger(input) {
      const unit = input.unit ?? 'credit';
      return insertCreditLedger({
        ...input,
        unit,
      });
    },
    async consumeCreditLedger(input) {
      const unit = input.unit ?? 'credit';
      const key = creditLedgerIdempotencyKey({ ...input, unit });
      if (key) {
        const existingId = creditIdempotency.get(key);
        if (existingId) {
          return cloneCreditLedger(creditLedger.get(existingId)!);
        }
      }
      const balance = availableCreditBalance({
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        unit,
      });
      if (balance < input.amount) {
        throw new Error('MODULE_CREDITS_INSUFFICIENT');
      }
      return insertCreditLedger({
        ...input,
        amount: -input.amount,
        unit,
        status: 'available',
      });
    },
    async listCreditLedger(query = {}) {
      return [...creditLedger.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.unit || record.unit === query.unit)
        .filter((record) => !query.status || effectiveCreditStatus(record) === query.status)
        .map((record) => cloneCreditLedger(record));
    },
    async getCreditBalance(query) {
      const unit = query.unit ?? 'credit';
      return {
        userId: query.userId,
        unit,
        balance: availableCreditBalance({ ...query, unit }),
      };
    },
    async createCreditReservation(input) {
      const unit = input.unit ?? 'credit';
      const key = creditReservationIdempotencyKey({ ...input, unit });
      if (key) {
        const existingId = creditReservationIdempotency.get(key);
        if (existingId) {
          return clone(creditReservations.get(existingId)!);
        }
      }
      const timestamp = iso(now);
      const record: RuntimeStoreCreditReservation = {
        id: input.id ?? createId('credit_reservation'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        amountReserved: input.amountReserved,
        amountCommitted: input.amountCommitted ?? 0,
        unit,
        status: input.status ?? 'reserved',
        reason: input.reason,
        source: input.source,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      creditReservations.set(record.id, record);
      if (key) {
        creditReservationIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async getCreditReservation(id) {
      const record = creditReservations.get(id);
      return record ? clone(record) : null;
    },
    async updateCreditReservation(id, patch) {
      const previous = creditReservations.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_CREDIT_RESERVATION_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreCreditReservation = {
        ...previous,
        amountCommitted: patch.amountCommitted ?? previous.amountCommitted,
        status: patch.status ?? previous.status,
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: iso(now),
      };
      creditReservations.set(id, next);
      return clone(next);
    },
    async listCreditReservations(query = {}) {
      return [...creditReservations.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.unit || record.unit === query.unit)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.source || record.source === query.source)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .map((record) => clone(record));
    },
    async grantEntitlement(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.userId}:${input.entitlement}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = entitlementIdempotency.get(key);
        if (existingId) {
          return clone(entitlements.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const record: RuntimeStoreEntitlementGrant = {
        id: createId('entitlement'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        entitlement: input.entitlement,
        planId: input.planId,
        source: input.source,
        status: input.status ?? 'active',
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      entitlements.set(record.id, record);
      if (key) {
        entitlementIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async listEntitlements(query = {}) {
      return [...entitlements.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.entitlement || record.entitlement === query.entitlement)
        .filter((record) => !query.status || record.status === query.status)
        .map((record) => clone(record));
    },
    async revokeEntitlement(id: string, metadata?: Record<string, unknown>) {
      const previous = entitlements.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreEntitlementGrant = {
        ...previous,
        status: 'revoked',
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      entitlements.set(id, next);
      return clone(next);
    },
    async overrideEntitlement(id, input) {
      const previous = entitlements.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreEntitlementGrant = {
        ...previous,
        status: input.status,
        expiresAt: input.expiresAt === null ? undefined : (input.expiresAt ?? previous.expiresAt),
        metadata: { ...previous.metadata, ...(input.metadata ?? {}) },
        updatedAt: iso(now),
      };
      entitlements.set(id, next);
      return clone(next);
    },
    async upsertCommercialCatalogItem<TValue = unknown>(
      input: UpsertRuntimeStoreCommercialCatalogItemInput<TValue>
    ) {
      const version = input.version ?? 1;
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.kind}:${input.itemId}:${version}`;
      const existing = commercialCatalog.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreCommercialCatalogItem<TValue> = {
        id: existing?.id ?? createId('commercial_catalog'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        kind: input.kind,
        itemId: input.itemId,
        version,
        status: input.status ?? existing?.status ?? 'draft',
        value: input.value,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      commercialCatalog.set(key, record);
      return clone(record);
    },
    async listCommercialCatalogItems<TValue = unknown>(
      query: {
        productId?: string;
        workspaceId?: string | null;
        kind?: RuntimeStoreCommercialCatalogItem['kind'];
        status?: RuntimeStoreCommercialCatalogItem['status'];
        itemId?: string;
      } = {}
    ) {
      return [...commercialCatalog.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.itemId || record.itemId === query.itemId)
        .sort((left, right) => {
          const itemOrder = left.itemId.localeCompare(right.itemId);
          return itemOrder !== 0 ? itemOrder : right.version - left.version;
        })
        .map((record) => clone(record) as RuntimeStoreCommercialCatalogItem<TValue>);
    },
    async createCommercialOrder(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = orderIdempotency.get(key);
        if (existingId) {
          return clone(orders.get(existingId)!);
        }
      }
      const providerKey =
        input.provider && input.providerRef
          ? `${input.productId}:${input.workspaceId ?? ''}:${input.provider}:${input.providerRef}`
          : null;
      if (providerKey) {
        const existingId = providerOrders.get(providerKey);
        if (existingId) {
          return clone(orders.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const order: RuntimeStoreCommercialOrder = {
        id: createId('order'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        sku: input.sku,
        amount: input.amount,
        currency: input.currency,
        status: 'created',
        provider: input.provider,
        providerRef: input.providerRef,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      orders.set(order.id, order);
      if (key) {
        orderIdempotency.set(key, order.id);
      }
      if (providerKey) {
        providerOrders.set(providerKey, order.id);
      }
      return clone(order);
    },
    async getCommercialOrder(id) {
      const order = orders.get(id);
      return order ? clone(order) : null;
    },
    async findCommercialOrderByProviderRef(productId, workspaceId, provider, providerRef) {
      const id = providerOrders.get(`${productId}:${workspaceId ?? ''}:${provider}:${providerRef}`);
      return id ? clone(orders.get(id)!) : null;
    },
    async attachCommercialOrderProvider(
      id: string,
      provider: string,
      providerRef: string,
      metadata?: Record<string, unknown>
    ) {
      const previous = readOrder(id);
      const key = `${previous.productId}:${previous.workspaceId ?? ''}:${provider}:${providerRef}`;
      const existingId = providerOrders.get(key);
      if (existingId && existingId !== id) {
        throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_PROVIDER_REF_CONFLICT: ${providerRef}`);
      }
      const next: RuntimeStoreCommercialOrder = {
        ...previous,
        provider,
        providerRef,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      orders.set(id, next);
      providerOrders.set(key, id);
      return clone(next);
    },
    async updateCommercialOrderStatus(
      id: string,
      status: RuntimeStoreCommercialOrderStatus,
      metadata?: Record<string, unknown>
    ) {
      const previous = readOrder(id);
      const next: RuntimeStoreCommercialOrder = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      orders.set(id, next);
      return clone(next);
    },
    async listCommercialOrders(query = {}) {
      return [...orders.values()]
        .filter((order) => !query.productId || order.productId === query.productId)
        .filter(
          (order) => query.workspaceId === undefined || order.workspaceId === query.workspaceId
        )
        .filter((order) => !query.userId || order.userId === query.userId)
        .filter((order) => !query.status || order.status === query.status)
        .map((order) => clone(order));
    },
    async upsertBillingAccount(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.userId}`;
      const existing = billingAccounts.get(key);
      const timestamp = iso(now);
      const account: RuntimeStoreBillingAccount = {
        id: existing?.id ?? createId('billing_account'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        status: input.status ?? existing?.status ?? 'active',
        customerProfile: { ...(existing?.customerProfile ?? {}), ...(input.customerProfile ?? {}) },
        providerCustomers: {
          ...(existing?.providerCustomers ?? {}),
          ...(input.providerCustomers ?? {}),
        },
        paymentMethods: input.paymentMethods ?? existing?.paymentMethods ?? [],
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      billingAccounts.set(key, account);
      return clone(account);
    },
    async getBillingAccount(productId, userId, workspaceId) {
      const account = billingAccounts.get(`${productId}:${workspaceId ?? ''}:${userId}`);
      return account ? clone(account) : null;
    },
    async upsertInvoice(input) {
      const workspaceId = input.workspaceId ?? null;
      const directExisting = input.id ? invoices.get(input.id) : undefined;
      const orderExisting = input.orderId
        ? [...invoices.values()].find(
            (record) =>
              record.productId === input.productId &&
              (record.workspaceId ?? null) === workspaceId &&
              record.orderId === input.orderId
          )
        : undefined;
      if (directExisting && orderExisting && directExisting.id !== orderExisting.id) {
        throw new Error(`RUNTIME_STORE_INVOICE_ORDER_CONFLICT: ${input.orderId}`);
      }
      const existing = orderExisting ?? directExisting;
      const id = existing?.id ?? input.id ?? createId('invoice');
      const timestamp = iso(now);
      const number =
        input.number ??
        existing?.number ??
        `PK-${timestamp.slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberExisting = [...invoices.values()].find(
        (record) =>
          record.productId === input.productId &&
          (record.workspaceId ?? null) === workspaceId &&
          record.number === number
      );
      if (numberExisting && numberExisting.id !== id) {
        throw new Error(`RUNTIME_STORE_INVOICE_NUMBER_CONFLICT: ${number}`);
      }
      const subtotal = input.subtotal;
      const discount = input.discount ?? existing?.discount ?? 0;
      const tax = input.tax ?? existing?.tax ?? 0;
      const total = input.total ?? Math.max(0, subtotal - discount + tax);
      const refunded = input.refunded ?? existing?.refunded ?? 0;
      const fee = input.fee ?? existing?.fee ?? 0;
      const invoice: RuntimeStoreInvoiceRecord = {
        id,
        productId: input.productId,
        workspaceId,
        userId: input.userId,
        orderId: input.orderId ?? existing?.orderId ?? null,
        subscriptionId: input.subscriptionId ?? existing?.subscriptionId ?? null,
        number,
        status: input.status ?? existing?.status ?? 'open',
        subtotal,
        discount,
        tax,
        total,
        refunded,
        fee,
        net: input.net ?? total - refunded - fee,
        currency: input.currency,
        provider: input.provider ?? existing?.provider ?? null,
        providerRef: input.providerRef ?? existing?.providerRef ?? null,
        documentFileId: input.documentFileId ?? existing?.documentFileId ?? null,
        taxSnapshot: input.taxSnapshot ?? existing?.taxSnapshot ?? {},
        lines: input.lines ?? existing?.lines ?? [],
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        issuedAt: input.issuedAt ?? existing?.issuedAt ?? timestamp,
        dueAt: input.dueAt ?? existing?.dueAt ?? null,
        paidAt: input.paidAt ?? existing?.paidAt ?? null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      invoices.set(id, invoice);
      return clone(invoice);
    },
    async listInvoices(query = {}) {
      return [...invoices.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.orderId || record.orderId === query.orderId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
    async createCreditNote(input) {
      const workspaceId = input.workspaceId ?? null;
      if (input.provider && input.providerRef) {
        const existing = [...creditNotes.values()].find(
          (record) =>
            record.productId === input.productId &&
            (record.workspaceId ?? null) === workspaceId &&
            record.provider === input.provider &&
            record.providerRef === input.providerRef
        );
        if (existing) {
          return clone(existing);
        }
      }
      const timestamp = iso(now);
      const id = input.id ?? createId('credit_note');
      const number =
        input.number ?? `CN-${timestamp.slice(0, 10).replaceAll('-', '')}-${id.slice(-6)}`;
      const numberExisting = [...creditNotes.values()].find(
        (record) =>
          record.productId === input.productId &&
          (record.workspaceId ?? null) === workspaceId &&
          record.number === number
      );
      if (numberExisting && numberExisting.id !== id) {
        throw new Error(`RUNTIME_STORE_CREDIT_NOTE_NUMBER_CONFLICT: ${number}`);
      }
      const record: RuntimeStoreCreditNoteRecord = {
        id,
        productId: input.productId,
        workspaceId,
        userId: input.userId,
        orderId: input.orderId ?? null,
        invoiceId: input.invoiceId ?? null,
        number,
        status: input.status ?? 'issued',
        amount: input.amount,
        currency: input.currency,
        reason: input.reason ?? 'refund',
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        lines: input.lines ?? [],
        metadata: redactSensitive(input.metadata ?? {}),
        issuedAt: input.issuedAt ?? timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      creditNotes.set(id, record);
      return clone(record);
    },
    async listCreditNotes(query = {}) {
      return [...creditNotes.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.orderId || record.orderId === query.orderId)
        .filter((record) => !query.invoiceId || record.invoiceId === query.invoiceId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
    async upsertSubscription(input) {
      const id = input.id ?? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.planId}`;
      const existing = subscriptions.get(id);
      const timestamp = iso(now);
      const subscription: RuntimeStoreSubscriptionRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        planId: input.planId,
        status: input.status ?? existing?.status ?? 'active',
        provider: input.provider ?? existing?.provider ?? null,
        providerRef: input.providerRef ?? existing?.providerRef ?? null,
        currentPeriodStart: input.currentPeriodStart ?? existing?.currentPeriodStart ?? timestamp,
        currentPeriodEnd: input.currentPeriodEnd ?? existing?.currentPeriodEnd ?? null,
        trialEnd: input.trialEnd ?? existing?.trialEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
        renewalStrategy: input.renewalStrategy ?? existing?.renewalStrategy ?? 'manual',
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      subscriptions.set(id, subscription);
      return clone(subscription);
    },
    async listSubscriptions(query = {}) {
      return [...subscriptions.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.planId || record.planId === query.planId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async createSubscriptionEvent(input) {
      const timestamp = iso(now);
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = subscriptionEventIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(subscriptionEvents.get(existingId)!);
        }
      }
      const event: RuntimeStoreSubscriptionEventRecord = {
        id: createId('subscription_event'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        planId: input.planId,
        type: input.type,
        status: input.status,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        effectiveAt: input.effectiveAt ?? timestamp,
        metadata: redactSensitive(input.metadata ?? {}),
        createdAt: timestamp,
      };
      subscriptionEvents.set(event.id, event);
      if (idempotencyKey) {
        subscriptionEventIdempotency.set(idempotencyKey, event.id);
      }
      return clone(event);
    },
    async listSubscriptionEvents(query = {}) {
      return [...subscriptionEvents.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.subscriptionId || record.subscriptionId === query.subscriptionId)
        .filter((record) => !query.planId || record.planId === query.planId)
        .filter((record) => !query.type || record.type === query.type)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
    async upsertTaxProfile(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.userId}`;
      const existing = taxProfiles.get(key);
      const timestamp = iso(now);
      const profile: RuntimeStoreTaxProfileRecord = {
        id: existing?.id ?? createId('tax_profile'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        status: input.status ?? existing?.status ?? 'draft',
        jurisdiction: input.jurisdiction ?? existing?.jurisdiction ?? null,
        validationStatus: input.validationStatus ?? existing?.validationStatus ?? 'unverified',
        profile: { ...(existing?.profile ?? {}), ...(input.profile ?? {}) },
        evidence: { ...(existing?.evidence ?? {}), ...(input.evidence ?? {}) },
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      taxProfiles.set(key, profile);
      return clone(profile);
    },
    async getTaxProfile(productId, userId, workspaceId) {
      const profile = taxProfiles.get(`${productId}:${workspaceId ?? ''}:${userId}`);
      return profile ? clone(profile) : null;
    },
    async upsertRevenueBucket(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.bucketDate}:${input.currency}`;
      const existing = revenueBuckets.get(key);
      const timestamp = iso(now);
      const bucket: RuntimeStoreRevenueBucket = {
        id: existing?.id ?? createId('revenue_bucket'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        bucketDate: input.bucketDate,
        currency: input.currency,
        gross: input.gross ?? existing?.gross ?? 0,
        discount: input.discount ?? existing?.discount ?? 0,
        tax: input.tax ?? existing?.tax ?? 0,
        refund: input.refund ?? existing?.refund ?? 0,
        fee: input.fee ?? existing?.fee ?? 0,
        net: input.net ?? existing?.net ?? 0,
        orders: input.orders ?? existing?.orders ?? 0,
        provider: input.provider ?? existing?.provider ?? null,
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      revenueBuckets.set(key, bucket);
      return clone(bucket);
    },
    async listRevenueBuckets(query = {}) {
      return [...revenueBuckets.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.currency || record.currency === query.currency)
        .filter((record) => !query.from || record.bucketDate >= query.from)
        .filter((record) => !query.to || record.bucketDate <= query.to)
        .sort((left, right) => left.bucketDate.localeCompare(right.bucketDate))
        .map((record) => clone(record));
    },
    async upsertSettlementBatch(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.provider}:${input.currency}:${input.periodStart}:${input.periodEnd}`;
      const existing = settlementBatches.get(id);
      const timestamp = iso(now);
      const gross = input.gross ?? existing?.gross ?? 0;
      const refund = input.refund ?? existing?.refund ?? 0;
      const fee = input.fee ?? existing?.fee ?? 0;
      const batch: RuntimeStoreSettlementBatch = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        provider: input.provider,
        currency: input.currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? existing?.status ?? 'draft',
        gross,
        refund,
        fee,
        net: input.net ?? gross - refund - fee,
        orderCount: input.orderCount ?? existing?.orderCount ?? 0,
        invoiceCount: input.invoiceCount ?? existing?.invoiceCount ?? 0,
        creditNoteCount: input.creditNoteCount ?? existing?.creditNoteCount ?? 0,
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      settlementBatches.set(id, batch);
      return clone(batch);
    },
    async listSettlementBatches(query = {}) {
      return [...settlementBatches.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.provider || record.provider === query.provider)
        .filter((record) => !query.currency || record.currency === query.currency)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async recordProviderInvocation(input) {
      const record: RuntimeStoreProviderInvocationRecord = {
        id: createId('provider_invocation'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        providerId: input.providerId,
        kind: input.kind,
        operation: input.operation,
        status: input.status,
        target: input.target ?? null,
        model: input.model ?? null,
        serviceConnectionId: input.serviceConnectionId ?? null,
        resourceBindingId: input.resourceBindingId ?? null,
        usage: input.usage ?? {},
        cost: input.cost ?? {},
        latencyMs: input.latencyMs ?? 0,
        correlationId: input.correlationId ?? null,
        error: normalizeDeliveryError(input.error),
        metadata: redactSensitive(input.metadata ?? {}),
        createdAt: iso(now),
      };
      providerInvocations.set(record.id, record);
      return clone(record);
    },
    async listProviderInvocations(query = {}) {
      return [...providerInvocations.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter((record) => !query.providerId || record.providerId === query.providerId)
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.operation || record.operation === query.operation)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
    async upsertRagSource(input) {
      const id = `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}`;
      const existing = ragSources.get(id);
      const timestamp = iso(now);
      const status = input.status ?? existing?.status ?? 'indexed';
      const record: RuntimeStoreRagSourceRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        sourceId: input.sourceId,
        status,
        contentDigest: input.contentDigest ?? existing?.contentDigest ?? null,
        contentLength: input.contentLength ?? existing?.contentLength ?? 0,
        chunkCount: input.chunkCount ?? existing?.chunkCount ?? 0,
        indexedAt:
          input.indexedAt ??
          (status === 'indexed' ? timestamp : existing?.indexedAt ?? null),
        deletedAt:
          input.deletedAt ??
          (status === 'deleted' ? timestamp : existing?.deletedAt ?? null),
        metadata: input.metadata ?? existing?.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      ragSources.set(id, record);
      return clone(record);
    },
    async listRagSources(query = {}) {
      return [...ragSources.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async upsertRagChunk(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}:${input.chunkIndex}`;
      const existing = ragChunks.get(id);
      const timestamp = iso(now);
      const record: RuntimeStoreRagChunkRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        sourceId: input.sourceId,
        chunkIndex: input.chunkIndex,
        content: input.content,
        embedding: [...input.embedding],
        metadata: input.metadata ?? existing?.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      ragChunks.set(id, record);
      return clone(record);
    },
    async listRagChunks(query = {}) {
      return [...ragChunks.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .sort((left, right) => {
          const sourceOrder = left.sourceId.localeCompare(right.sourceId);
          return sourceOrder === 0 ? left.chunkIndex - right.chunkIndex : sourceOrder;
        })
        .map((record) => clone(record));
    },
    async deleteRagChunkById(input) {
      const record = ragChunks.get(input.id);
      if (
        !record ||
        record.productId !== input.productId ||
        record.workspaceId !== (input.workspaceId ?? null) ||
        (input.moduleId && record.moduleId !== input.moduleId)
      ) {
        return false;
      }
      ragChunks.delete(input.id);
      return true;
    },
    async deleteRagChunksBySource(input) {
      let deleted = 0;
      for (const [id, record] of ragChunks.entries()) {
        if (
          record.productId === input.productId &&
          record.workspaceId === (input.workspaceId ?? null) &&
          (!input.moduleId || record.moduleId === input.moduleId) &&
          record.sourceId === input.sourceId
        ) {
          ragChunks.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
    async upsertRedeemCode(input) {
      const timestamp = iso(now);
      const existing = redeemCodes.get(`${input.productId}:${input.code}`);
      const code: RuntimeStoreRedeemCode = {
        productId: input.productId,
        code: input.code,
        entitlement: input.entitlement,
        creditsAmount: input.creditsAmount,
        creditsUnit: input.creditsUnit,
        maxRedemptions: input.maxRedemptions,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? existing?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      redeemCodes.set(`${code.productId}:${code.code}`, code);
      return clone(code);
    },
    async getRedeemCode(productId, code) {
      const record = redeemCodes.get(`${productId}:${code}`);
      return record ? clone(record) : null;
    },
    async updateRedeemCodeStatus(input) {
      const key = `${input.productId}:${input.code}`;
      const record = redeemCodes.get(key);
      if (!record) {
        throw new Error(`RUNTIME_STORE_REDEEM_CODE_NOT_FOUND: ${input.code}`);
      }
      const next: RuntimeStoreRedeemCode = {
        ...record,
        metadata: {
          ...record.metadata,
          ...(input.metadata ?? {}),
          status: input.status,
        },
        updatedAt: iso(now),
      };
      redeemCodes.set(key, next);
      return clone(next);
    },
    async listRedeemCodes(query = {}) {
      return [...redeemCodes.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            !query.batchId ||
            (typeof record.metadata.batchId === 'string' && record.metadata.batchId === query.batchId)
        )
        .filter((record) => {
          if (!query.status) {
            return true;
          }
          const status =
            typeof record.metadata.status === 'string' ? record.metadata.status : 'active';
          return status === query.status;
        })
        .map((record) => clone(record));
    },
    async recordRedeemRedemption(input) {
      const userCodeKey = `${input.productId}:${input.code}:${input.userId}`;
      const existing = [...redemptions.values()].find(
        (record) => `${record.productId}:${record.code}:${record.userId}` === userCodeKey
      );
      if (existing) {
        return clone(existing);
      }
      const key = input.idempotencyKey
        ? `${input.productId}:${input.userId}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = redemptionIdempotency.get(key);
        if (existingId) {
          return clone(redemptions.get(existingId)!);
        }
      }
      const redemption: RuntimeStoreRedeemRedemption = {
        id: createId('redemption'),
        productId: input.productId,
        code: input.code,
        userId: input.userId,
        entitlement: input.entitlement,
        creditsAmount: input.creditsAmount,
        creditsUnit: input.creditsUnit,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
      };
      redemptions.set(redemption.id, redemption);
      if (key) {
        redemptionIdempotency.set(key, redemption.id);
      }
      return clone(redemption);
    },
    async listRedeemRedemptions(query = {}) {
      return [...redemptions.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.code || record.code === query.code)
        .filter((record) => !query.userId || record.userId === query.userId)
        .map((record) => clone(record));
    },
    async createApiKey(input) {
      const timestamp = iso(now);
      const id = input.id ?? createId('api_key');
      const record: RuntimeStoreApiKeyRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        name: input.name,
        prefix: input.prefix,
        keyHash: input.keyHash,
        ownerSubjectType: input.ownerSubjectType,
        ownerSubjectId: input.ownerSubjectId,
        permissions: input.permissions ?? [],
        status: input.status ?? 'active',
        expiresAt: input.expiresAt,
        revokedAt: input.revokedAt,
        lastUsedAt: input.lastUsedAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      apiKeys.set(record.id, record);
      return clone(record);
    },
    async getApiKey(input) {
      const record = apiKeys.get(input.id);
      if (
        !record ||
        (input.productId && record.productId !== input.productId) ||
        (input.workspaceId !== undefined && record.workspaceId !== input.workspaceId)
      ) {
        return null;
      }
      return clone(record);
    },
    async findApiKeyByHash(input) {
      const record =
        [...apiKeys.values()].find(
          (candidate) =>
            candidate.keyHash === input.keyHash &&
            (!input.prefix || candidate.prefix === input.prefix) &&
            (!input.productId || candidate.productId === input.productId)
        ) ?? null;
      return record ? clone(record) : null;
    },
    async updateApiKey(id, patch) {
      const previous = apiKeys.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_API_KEY_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreApiKeyRecord = {
        ...previous,
        prefix: patch.prefix ?? previous.prefix,
        keyHash: patch.keyHash ?? previous.keyHash,
        status: patch.status ?? previous.status,
        expiresAt: patch.expiresAt === null ? undefined : (patch.expiresAt ?? previous.expiresAt),
        revokedAt: patch.revokedAt === null ? undefined : (patch.revokedAt ?? previous.revokedAt),
        lastUsedAt:
          patch.lastUsedAt === null ? undefined : (patch.lastUsedAt ?? previous.lastUsedAt),
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: iso(now),
      };
      apiKeys.set(id, next);
      return clone(next);
    },
    async listApiKeys(query = {}) {
      return [...apiKeys.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter(
          (record) =>
            !query.ownerSubjectType || record.ownerSubjectType === query.ownerSubjectType
        )
        .filter((record) => !query.ownerSubjectId || record.ownerSubjectId === query.ownerSubjectId)
        .filter((record) => !query.status || record.status === query.status)
        .map((record) => clone(record));
    },
    async recordRiskEvent(input) {
      const record: RuntimeStoreRiskEvent = {
        id: input.id ?? createId('risk_event'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        type: input.type,
        severity: input.severity ?? 'medium',
        source: input.source,
        sourceId: input.sourceId,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
      };
      riskEvents.set(record.id, record);
      return clone(record);
    },
    async upsertRiskBlock(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.subjectType}:${input.subjectId}:${input.scope ?? ''}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = riskBlockIdempotency.get(key);
        if (existingId) {
          return clone(riskBlocks.get(existingId)!);
        }
      }
      const existing = [...riskBlocks.values()].find(
        (record) =>
          record.productId === input.productId &&
          record.workspaceId === (input.workspaceId ?? null) &&
          record.subjectType === input.subjectType &&
          record.subjectId === input.subjectId &&
          (record.scope ?? '') === (input.scope ?? '')
      );
      const timestamp = iso(now);
      const record: RuntimeStoreRiskBlock = {
        id: existing?.id ?? input.id ?? createId('risk_block'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        scope: input.scope,
        reason: input.reason,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      riskBlocks.set(record.id, record);
      if (key) {
        riskBlockIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async listRiskEvents(query = {}) {
      return [...riskEvents.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter((record) => !query.subjectType || record.subjectType === query.subjectType)
        .filter((record) => !query.subjectId || record.subjectId === query.subjectId)
        .filter((record) => !query.type || record.type === query.type)
        .filter((record) => !query.severity || record.severity === query.severity)
        .filter((record) => !query.source || record.source === query.source)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .map((record) => clone(record));
    },
    async listRiskBlocks(query = {}) {
      return [...riskBlocks.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.subjectType || record.subjectType === query.subjectType)
        .filter((record) => !query.subjectId || record.subjectId === query.subjectId)
        .filter((record) => query.scope === undefined || (record.scope ?? '') === (query.scope ?? ''))
        .map((record) => clone(record));
    },
    async createFile(input) {
      const timestamp = iso(now);
      const file: RuntimeStoreFileRecord = {
        id: createId('file'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        ownerId: input.ownerId ?? input.actorId,
        name: input.name,
        purpose: input.purpose,
        status: input.status ?? 'uploading',
        visibility: input.visibility ?? 'private',
        contentType: input.contentType,
        sizeBytes: input.sizeBytes ?? 0,
        checksum: input.checksum,
        storageKey: input.storageKey,
        runId: input.runId,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: input.expiresAt,
      };
      files.set(file.id, file);
      return clone(file);
    },
    async getFile(id) {
      const file = files.get(id);
      return file ? clone(file) : null;
    },
    async updateFile(id, patch) {
      const previous = readFile(id);
      const next: RuntimeStoreFileRecord = {
        ...previous,
        ...patch,
        metadata: patch.metadata
          ? { ...previous.metadata, ...patch.metadata }
          : { ...previous.metadata },
        updatedAt: iso(now),
      };
      files.set(id, next);
      return clone(next);
    },
    async listFiles(query = {}) {
      return [...files.values()]
        .filter((file) => !query.productId || file.productId === query.productId)
        .filter((file) => query.workspaceId === undefined || file.workspaceId === query.workspaceId)
        .filter((file) => !query.moduleId || file.moduleId === query.moduleId)
        .filter((file) => !query.ownerId || file.ownerId === query.ownerId)
        .filter((file) => !query.purpose || file.purpose === query.purpose)
        .filter((file) => !query.status || file.status === query.status)
        .filter((file) => !query.visibility || file.visibility === query.visibility)
        .filter((file) => !query.runId || file.runId === query.runId)
        .filter((file) => query.includeDeleted || file.status !== 'deleted')
        .map((file) => clone(file));
    },
    async upsertCatalogState(state: ModuleCatalogModuleState) {
      const key = `${state.productId}:${state.moduleId}`;
      catalog.set(key, state);
      return clone(state);
    },
    async listCatalogStates(query = {}) {
      return [...catalog.values()]
        .filter((state) => !query.productId || state.productId === query.productId)
        .filter((state) => !query.status || state.status === query.status)
        .map((state) => clone(state));
    },
    async upsertMembership(input) {
      const timestamp = input.updatedAt ?? iso(now);
      const membership: RuntimeStoreMembership = {
        id: input.id ?? `${input.productId}:${input.workspaceId}:${input.userId}`,
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
        status: input.status,
        updatedAt: timestamp,
      };
      memberships.set(membership.id, membership);
      return clone(membership);
    },
    async listMemberships(query = {}) {
      return [...memberships.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.workspaceId || record.workspaceId === query.workspaceId)
        .filter((record) => !query.userId || record.userId === query.userId)
        .map((record) => clone(record));
    },
    async upsertProductScopeProduct(product) {
      productScopeProducts.set(product.id, product);
      return clone(product);
    },
    async listProductScopeProducts(query = {}) {
      return [...productScopeProducts.values()]
        .filter((product) => !query.productId || product.id === query.productId)
        .map((product) => clone(product));
    },
    async upsertProductScopeWorkspace(workspace) {
      productScopeWorkspaces.set(workspace.id, workspace);
      return clone(workspace);
    },
    async listProductScopeWorkspaces(query = {}) {
      return [...productScopeWorkspaces.values()]
        .filter((workspace) => !query.productId || workspace.productId === query.productId)
        .filter((workspace) => !query.workspaceId || workspace.id === query.workspaceId)
        .map((workspace) => clone(workspace));
    },
    async upsertProductScopeDomainAlias(alias) {
      productScopeAliases.set(alias.hostname.toLowerCase(), {
        ...alias,
        hostname: alias.hostname.toLowerCase(),
      });
      return clone(productScopeAliases.get(alias.hostname.toLowerCase())!);
    },
    async listProductScopeDomainAliases(query = {}) {
      const hostname = query.hostname?.toLowerCase();
      return [...productScopeAliases.values()]
        .filter((alias) => !query.productId || alias.productId === query.productId)
        .filter((alias) => !hostname || alias.hostname === hostname)
        .map((alias) => clone(alias));
    },
    async upsertProductScopeInvite(invite) {
      productScopeInvites.set(invite.token, invite);
      return clone(invite);
    },
    async listProductScopeInvites(query = {}) {
      return [...productScopeInvites.values()]
        .filter((invite) => !query.productId || invite.productId === query.productId)
        .filter((invite) => !query.workspaceId || invite.workspaceId === query.workspaceId)
        .filter((invite) => !query.status || invite.status === query.status)
        .filter((invite) => !query.token || invite.token === query.token)
        .map((invite) => clone(invite));
    },
    async upsertHostUser(input) {
      const timestamp = iso(now);
      const existing = hostUsers.get(input.id);
      const user: RuntimeStoreHostUser = {
        id: input.id,
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
        status: input.status,
        productId: input.productId,
        workspaceId: input.workspaceId,
        workspaceRole: input.workspaceRole,
        permissions: input.permissions ? [...input.permissions] : undefined,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? existing?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      hostUsers.set(user.id, user);
      return clone(user);
    },
    async getHostUser(id) {
      const user = hostUsers.get(id);
      return user ? clone(user) : null;
    },
    async findHostUserByEmail(email) {
      const normalized = email.trim().toLowerCase();
      const user = [...hostUsers.values()].find((record) => record.email === normalized);
      return user ? clone(user) : null;
    },
    async listHostUsers(query = {}) {
      return [...hostUsers.values()]
        .filter((user) => !query.productId || user.productId === query.productId)
        .filter((user) => !query.role || user.role === query.role)
        .filter((user) => !query.status || user.status === query.status)
        .map((user) => clone(user));
    },
    async updateHostUserStatus(id: string, status: RuntimeStoreHostUserStatus, metadata) {
      const previous = readHostUser(id);
      const next: RuntimeStoreHostUser = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      hostUsers.set(id, next);
      return clone(next);
    },
    async upsertSetting<TValue = unknown>(input: UpsertRuntimeStoreSettingInput<TValue>) {
      const status = input.status ?? 'active';
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.namespace}:${input.key}:${status}`;
      const existing = settings.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreSettingRecord<TValue> = {
        id: existing?.id ?? createId('setting'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        status,
        version: input.version ?? (existing ? existing.version + 1 : 1),
        updatedBy: input.actorId ?? null,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      settings.set(key, record);
      return clone(record);
    },
    async getSetting<TValue = unknown>(query: {
      productId: string;
      namespace: string;
      key: string;
      workspaceId?: string | null;
      status?: RuntimeStoreSettingStatus;
    }) {
      const candidates = [...settings.values()]
        .filter((setting) => setting.productId === query.productId)
        .filter((setting) => setting.namespace === query.namespace)
        .filter((setting) => setting.key === query.key)
        .filter((setting) => setting.status === (query.status ?? 'active'))
        .filter(
          (setting) =>
            query.workspaceId === undefined || setting.workspaceId === query.workspaceId
        )
        .sort((left, right) => right.version - left.version);
      return candidates[0] ? (clone(candidates[0]) as RuntimeStoreSettingRecord<TValue>) : null;
    },
    async listSettings<TValue = unknown>(
      query: {
        productId?: string;
        workspaceId?: string | null;
        namespace?: string;
        status?: RuntimeStoreSettingStatus;
      } = {}
    ) {
      return [...settings.values()]
        .filter((setting) => !query.productId || setting.productId === query.productId)
        .filter(
          (setting) =>
            query.workspaceId === undefined || setting.workspaceId === query.workspaceId
        )
        .filter((setting) => !query.namespace || setting.namespace === query.namespace)
        .filter((setting) => !query.status || setting.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((setting) => clone(setting) as RuntimeStoreSettingRecord<TValue>);
    },
    async upsertServiceConnection(input) {
      const key = `${input.productId}:${input.connectionId}`;
      const existing = serviceConnections.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreServiceConnectionRecord = {
        connectionId: input.connectionId,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        service: input.service,
        provider: input.provider,
        status: input.status ?? existing?.status ?? 'active',
        environment: input.environment,
        ownerType: input.ownerType,
        scopeType: input.scopeType,
        authType: input.authType,
        config: input.config ?? {},
        secretRefs: input.secretRefs ?? {},
        health: input.health ?? existing?.health ?? {},
        lastUsedAt: input.lastUsedAt ?? existing?.lastUsedAt,
        updatedBy: input.actorId ?? null,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      serviceConnections.set(key, record);
      return clone(record);
    },
    async getServiceConnection(productId, connectionId) {
      const record = serviceConnections.get(`${productId}:${connectionId}`);
      return record ? clone(record) : null;
    },
    async listServiceConnections(query = {}) {
      return [...serviceConnections.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.service || record.service === query.service)
        .filter((record) => !query.provider || record.provider === query.provider)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async touchServiceConnection(productId, connectionId, patch = {}) {
      const key = `${productId}:${connectionId}`;
      const existing = serviceConnections.get(key);
      if (!existing) {
        throw new Error(`RUNTIME_STORE_SERVICE_CONNECTION_NOT_FOUND: ${connectionId}`);
      }
      const next: RuntimeStoreServiceConnectionRecord = {
        ...existing,
        health: patch.health ?? existing.health,
        metadata: { ...existing.metadata, ...(patch.metadata ?? {}) },
        lastUsedAt: iso(now),
        updatedAt: iso(now),
      };
      serviceConnections.set(key, next);
      return clone(next);
    },
    async upsertResourceBinding<TValue = unknown>(
      input: UpsertRuntimeStoreResourceBindingInput<TValue>
    ) {
      const bindingId =
        input.bindingId ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId ?? ''}:${input.name}`;
      const existing = resourceBindings.get(bindingId);
      const timestamp = iso(now);
      const record: RuntimeStoreResourceBindingRecord<TValue> = {
        bindingId,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        name: input.name,
        kind: input.kind,
        value: input.value,
        status: input.status ?? existing?.status ?? 'active',
        updatedBy: input.actorId ?? null,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      resourceBindings.set(bindingId, record);
      return clone(record);
    },
    async listResourceBindings<TValue = unknown>(
      query: {
        productId?: string;
        workspaceId?: string | null;
        moduleId?: string | null;
        name?: string;
        kind?: string;
        status?: RuntimeStoreResourceBindingStatus;
      } = {}
    ) {
      return [...resourceBindings.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter((record) => !query.name || record.name === query.name)
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record) as RuntimeStoreResourceBindingRecord<TValue>);
    },
  };
}
