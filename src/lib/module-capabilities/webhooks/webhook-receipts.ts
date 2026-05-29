import { randomUUID } from 'node:crypto';

export type ModuleWebhookReceiptStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'duplicate'
  | 'rejected';

export interface ModuleWebhookReceipt {
  id: string;
  moduleId: string;
  webhookName: string;
  path: string;
  method: string;
  status: ModuleWebhookReceiptStatus;
  attempts: number;
  idempotencyKey?: string;
  signature?: string;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface CreateModuleWebhookReceiptInput {
  moduleId: string;
  webhookName: string;
  path: string;
  method: string;
  idempotencyKey?: string;
  signature?: string;
}

export interface ModuleWebhookReceiptStore {
  create(input: CreateModuleWebhookReceiptInput): ModuleWebhookReceipt;
  get(id: string): ModuleWebhookReceipt | null;
  findByIdempotencyKey(
    moduleId: string,
    webhookName: string,
    idempotencyKey: string
  ): ModuleWebhookReceipt | null;
  list(query?: {
    moduleId?: string;
    webhookName?: string;
    status?: ModuleWebhookReceiptStatus;
  }): ModuleWebhookReceipt[];
  markProcessing(id: string): ModuleWebhookReceipt;
  markProcessed(id: string): ModuleWebhookReceipt;
  markFailed(id: string, error: Error | string): ModuleWebhookReceipt;
  markRejected(id: string, error: Error | string): ModuleWebhookReceipt;
  markDuplicate(id: string): ModuleWebhookReceipt;
}

export interface CreateInMemoryModuleWebhookReceiptStoreOptions {
  now?: () => Date;
  createId?: () => string;
}

function cloneReceipt(receipt: ModuleWebhookReceipt): ModuleWebhookReceipt {
  return {
    ...receipt,
    error: receipt.error ? { ...receipt.error } : undefined,
  };
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function normalizeError(error: Error | string): { code: string; message: string } {
  if (typeof error === 'string') {
    return { code: 'MODULE_WEBHOOK_ERROR', message: error };
  }
  return { code: error.name || 'MODULE_WEBHOOK_ERROR', message: error.message };
}

export function createInMemoryModuleWebhookReceiptStore(
  options: CreateInMemoryModuleWebhookReceiptStoreOptions = {}
): ModuleWebhookReceiptStore {
  const receipts = new Map<string, ModuleWebhookReceipt>();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => `wh_${randomUUID()}`);

  function read(id: string): ModuleWebhookReceipt {
    const receipt = receipts.get(id);
    if (!receipt) {
      throw new Error(`MODULE_WEBHOOK_RECEIPT_NOT_FOUND: ${id}`);
    }
    return receipt;
  }

  function save(receipt: ModuleWebhookReceipt): ModuleWebhookReceipt {
    receipts.set(receipt.id, receipt);
    return cloneReceipt(receipt);
  }

  return {
    create(input) {
      const timestamp = toIso(now);
      const receipt: ModuleWebhookReceipt = {
        id: createId(),
        moduleId: input.moduleId,
        webhookName: input.webhookName,
        path: input.path,
        method: input.method,
        status: 'received',
        attempts: 0,
        idempotencyKey: input.idempotencyKey,
        signature: input.signature,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      receipts.set(receipt.id, receipt);
      return cloneReceipt(receipt);
    },
    get(id) {
      const receipt = receipts.get(id);
      return receipt ? cloneReceipt(receipt) : null;
    },
    findByIdempotencyKey(moduleId, webhookName, idempotencyKey) {
      const receipt = [...receipts.values()].find(
        (candidate) =>
          candidate.moduleId === moduleId &&
          candidate.webhookName === webhookName &&
          candidate.idempotencyKey === idempotencyKey
      );
      return receipt ? cloneReceipt(receipt) : null;
    },
    list(query = {}) {
      return [...receipts.values()]
        .filter((receipt) => !query.moduleId || receipt.moduleId === query.moduleId)
        .filter((receipt) => !query.webhookName || receipt.webhookName === query.webhookName)
        .filter((receipt) => !query.status || receipt.status === query.status)
        .map((receipt) => cloneReceipt(receipt));
    },
    markProcessing(id) {
      const receipt = read(id);
      return save({
        ...receipt,
        status: 'processing',
        attempts: receipt.attempts + 1,
        updatedAt: toIso(now),
      });
    },
    markProcessed(id) {
      const receipt = read(id);
      const timestamp = toIso(now);
      return save({
        ...receipt,
        status: 'processed',
        processedAt: timestamp,
        updatedAt: timestamp,
        error: undefined,
      });
    },
    markFailed(id, error) {
      const receipt = read(id);
      return save({
        ...receipt,
        status: 'failed',
        error: normalizeError(error),
        updatedAt: toIso(now),
      });
    },
    markRejected(id, error) {
      const receipt = read(id);
      return save({
        ...receipt,
        status: 'rejected',
        error: normalizeError(error),
        updatedAt: toIso(now),
      });
    },
    markDuplicate(id) {
      const receipt = read(id);
      return save({
        ...receipt,
        status: 'duplicate',
        updatedAt: toIso(now),
      });
    },
  };
}
