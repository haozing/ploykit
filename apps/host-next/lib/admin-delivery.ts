import { createAdminOperationsCenter } from '@host/lib/admin/operations-center';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type {
  RuntimeStoreAuditRecord,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreWebhookReceipt,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { assertAdminSession } from './admin-session';
import { ensureAdminStoreSeeded } from './admin-store-seed';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';

const DEMO_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

export interface AdminOutboxDetailView {
  outbox: RuntimeStoreOutboxRecord | null;
  receipts: RuntimeStoreWebhookReceipt[];
  deliveries: RuntimeStoreDeliveryRecord[];
  audit: RuntimeStoreAuditRecord[];
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function valueHasReceiptId(value: unknown, receiptId: string): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.receiptId === receiptId ||
    record.correlationId === receiptId ||
    record.causationId === receiptId
  );
}

function outboxReceiptId(record: RuntimeStoreOutboxRecord): string | undefined {
  return stringMetadata(metadataRecord(record.payload).receiptId);
}

function uniqueById<TRecord extends { id: string }>(records: readonly TRecord[]): TRecord[] {
  const seen = new Set<string>();
  const unique: TRecord[] = [];
  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    unique.push(record);
  }
  return unique;
}

async function getAdminOperationsCenter() {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );

  return createAdminOperationsCenter({
    host: hostRuntime.moduleHost.runtime,
    store: hostRuntime.runtimeStore.store,
  });
}

export async function retryAdminOutbox(
  session: ModuleHostSession,
  outboxId: string,
  reason?: string
) {
  const admin = await getAdminOperationsCenter();
  return admin.retryOutbox(session, outboxId, reason);
}

export async function discardAdminOutbox(
  session: ModuleHostSession,
  outboxId: string,
  reason?: string
) {
  const admin = await getAdminOperationsCenter();
  return admin.discardOutbox(session, outboxId, reason);
}

export async function archiveAdminOutbox(
  session: ModuleHostSession,
  outboxId: string,
  reason?: string
) {
  const admin = await getAdminOperationsCenter();
  return admin.archiveOutbox(session, outboxId, reason);
}

export async function bulkReplayAdminDeadLetters(
  session: ModuleHostSession,
  input: {
    outboxIds?: readonly string[];
    namePrefix?: string;
    limit?: number;
    reason?: string;
  } = {}
) {
  const admin = await getAdminOperationsCenter();
  return admin.bulkRetryOutbox(session, {
    productId: DEMO_PRODUCT_ID,
    status: 'dead_letter',
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
    reason: input.reason,
  });
}

export async function previewAdminOutboxBulkAction(
  session: ModuleHostSession,
  input: {
    action: 'replay' | 'discard' | 'archive';
    outboxIds?: readonly string[];
    status?: 'queued' | 'failed' | 'dead_letter' | 'processed';
    namePrefix?: string;
    limit?: number;
  }
) {
  const admin = await getAdminOperationsCenter();
  return admin.previewBulkOutbox(session, {
    action: input.action,
    productId: DEMO_PRODUCT_ID,
    status: input.status,
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
  });
}

export async function bulkDiscardAdminOutbox(
  session: ModuleHostSession,
  input: {
    outboxIds?: readonly string[];
    status?: 'failed' | 'queued' | 'dead_letter';
    namePrefix?: string;
    limit?: number;
    reason?: string;
  } = {}
) {
  const admin = await getAdminOperationsCenter();
  return admin.bulkDiscardOutbox(session, {
    productId: DEMO_PRODUCT_ID,
    status: input.status ?? 'failed',
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
    reason: input.reason,
  });
}

export async function bulkArchiveAdminOutbox(
  session: ModuleHostSession,
  input: {
    outboxIds?: readonly string[];
    status?: 'processed' | 'dead_letter' | 'failed';
    namePrefix?: string;
    limit?: number;
    reason?: string;
  } = {}
) {
  const admin = await getAdminOperationsCenter();
  return admin.bulkArchiveOutbox(session, {
    productId: DEMO_PRODUCT_ID,
    status: input.status ?? 'processed',
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
    reason: input.reason,
  });
}

export async function retryAdminWebhookReceipt(
  session: ModuleHostSession,
  receiptId: string,
  reason = 'Webhook receipt replayed by admin'
) {
  assertAdminSession(session);
  const hostRuntime = await getHostRuntime();
  const receipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: DEMO_PRODUCT_ID,
  });
  const receipt = receipts.find((candidate) => candidate.id === receiptId);
  if (!receipt) {
    throw new Error(`ADMIN_WEBHOOK_RECEIPT_NOT_FOUND: ${receiptId}`);
  }
  const replayed = await hostRuntime.runtimeStore.store.markWebhookReceipt(receipt.id, 'received');
  const outbox = await hostRuntime.runtimeStore.store.enqueueOutbox({
    productId: receipt.productId,
    workspaceId: receipt.workspaceId,
    moduleId: receipt.moduleId,
    name: `webhook:${receipt.moduleId}:${receipt.webhookName}`,
    idempotencyKey: `admin-webhook-replay:${receipt.id}:${Date.now()}`,
    payload: {
      receiptId: receipt.id,
      moduleId: receipt.moduleId,
      webhookName: receipt.webhookName,
      path: receipt.path,
      method: receipt.method,
      bodyText: receipt.bodyText,
      bodyDigest: receipt.bodyDigest,
      headers: receipt.headers,
      replay: true,
    },
    metadata: {
      maxAttempts: 3,
      source: 'admin-webhook-replay',
      previousReceiptStatus: receipt.status,
    },
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: receipt.productId,
    workspaceId: receipt.workspaceId,
    moduleId: receipt.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.webhook.receipt_replayed',
    metadata: {
      receiptId: receipt.id,
      outboxId: outbox.id,
      webhookName: receipt.webhookName,
      method: receipt.method,
      path: receipt.path,
      bodyDigest: receipt.bodyDigest,
      previousStatus: receipt.status,
      nextStatus: replayed.status,
      reason,
    },
  });
  return { receipt: replayed, outbox };
}

export async function bulkRetryAdminWebhookReceipts(
  session: ModuleHostSession,
  input: {
    receiptIds?: readonly string[];
    status?: 'failed' | 'rejected' | 'duplicate';
    limit?: number;
    reason?: string;
  } = {}
) {
  assertAdminSession(session);
  const hostRuntime = await getHostRuntime();
  const idSet = input.receiptIds ? new Set(input.receiptIds) : null;
  const receipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: DEMO_PRODUCT_ID,
    status: input.status ?? 'failed',
  });
  const matched = idSet ? receipts.filter((receipt) => idSet.has(receipt.id)) : receipts;
  const records: Awaited<ReturnType<typeof retryAdminWebhookReceipt>>[] = [];
  for (const receipt of matched.slice(0, Math.min(Math.max(input.limit ?? 50, 1), 200))) {
    records.push(await retryAdminWebhookReceipt(session, receipt.id, input.reason));
  }
  return {
    matched: matched.length,
    processed: records.length,
    records,
  };
}

export async function getAdminOutboxDetail(outboxId: string): Promise<AdminOutboxDetailView> {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );
  const outbox =
    (await hostRuntime.runtimeStore.store.listOutbox({ productId: DEMO_PRODUCT_ID })).find(
      (record) => record.id === outboxId
    ) ?? null;
  if (!outbox) {
    return { outbox: null, receipts: [], deliveries: [], audit: [] };
  }

  const receiptId = outboxReceiptId(outbox);
  const moduleReceipts = outbox.moduleId
    ? await hostRuntime.runtimeStore.store.listWebhookReceipts({
        productId: outbox.productId,
        moduleId: outbox.moduleId,
      })
    : [];
  const receipts = moduleReceipts.filter(
    (receipt) =>
      receipt.id === receiptId ||
      valueHasReceiptId(outbox.payload, receipt.id) ||
      valueHasReceiptId(outbox.metadata, receipt.id)
  );
  const receiptIds = new Set(receipts.map((receipt) => receipt.id));
  const deliveryGroups = await Promise.all([
    hostRuntime.runtimeStore.store.listDeliveries({
      productId: outbox.productId,
      outboxId: outbox.id,
    }),
    ...receipts.map((receipt) =>
      hostRuntime.runtimeStore.store.listDeliveries({
        productId: outbox.productId,
        receiptId: receipt.id,
      })
    ),
  ]);
  const deliveries = uniqueById(deliveryGroups.flat());
  const audit = (
    await hostRuntime.runtimeStore.store.listAudit({
      productId: outbox.productId,
      moduleId: outbox.moduleId ?? undefined,
    })
  )
    .filter(
      (record) =>
        record.metadata.outboxId === outbox.id ||
        (typeof record.metadata.receiptId === 'string' && receiptIds.has(record.metadata.receiptId))
    )
    .slice(0, 50);

  return { outbox, receipts, deliveries, audit };
}
