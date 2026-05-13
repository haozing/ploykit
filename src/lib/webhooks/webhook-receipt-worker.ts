import { and, asc, eq, inArray, lt, or } from 'drizzle-orm';
import { auditLog } from '@/lib/audit/audit-port.server';
import { db } from '@/lib/db';
import { bus } from '@/lib/bus';
import { webhookLogs } from '@/lib/db/schema';
import { logger } from '@/lib/_core/logger';
import { webhookHandler } from './webhook-handler';
import { getWebhookLog, logWebhookRetry, updateWebhookLog } from './webhook-logger';
import type {
  ExternalWebhookEvent,
  WebhookProcessOptions,
  WebhookProcessResult,
  WebhookProvider,
} from './types';

export const DEFAULT_WEBHOOK_MAX_ATTEMPTS = 5;
export const DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

export interface WebhookReceiptRecord {
  id: string;
  provider: string;
  eventId: string | null;
  eventType: string;
  payload: unknown;
  signature: string | null;
  headers: unknown;
  status: string;
  retryCount: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface ProcessWebhookReceiptResult {
  success: boolean;
  webhookLogId: string;
  attempt: number;
  events: string[];
  processingTime: number;
  skipped?: boolean;
  error?: string;
}

export interface WebhookReceiptWorkerDependencies {
  getLog: (webhookLogId: string) => Promise<WebhookReceiptRecord | undefined | null>;
  updateLog: typeof updateWebhookLog;
  logRetry: typeof logWebhookRetry;
  process: (
    externalEvent: ExternalWebhookEvent,
    options?: WebhookProcessOptions
  ) => Promise<WebhookProcessResult>;
  processPlugin: (receipt: WebhookReceiptRecord) => Promise<WebhookProcessResult>;
}

export interface ProcessWebhookReceiptOptions {
  maxAttempts?: number;
  processingTimeoutMs?: number;
  force?: boolean;
  deps?: Partial<WebhookReceiptWorkerDependencies>;
}

function getWorkerDeps(
  deps?: Partial<WebhookReceiptWorkerDependencies>
): WebhookReceiptWorkerDependencies {
  return {
    getLog: getWebhookLog as WebhookReceiptWorkerDependencies['getLog'],
    updateLog: updateWebhookLog,
    logRetry: logWebhookRetry,
    process: webhookHandler.process.bind(webhookHandler),
    processPlugin: async (receipt) => {
      const { processPluginWebhookReceipt } = await import('@/lib/plugin-runtime/webhooks');
      return processPluginWebhookReceipt(receipt);
    },
    ...deps,
  };
}

function normalizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
}

async function isPluginRuntimeReceipt(receipt: WebhookReceiptRecord): Promise<boolean> {
  const { isPluginWebhookReceipt } = await import('@/lib/plugin-runtime/webhooks');
  return isPluginWebhookReceipt(receipt);
}

function toTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

export function isWebhookReceiptProcessingStale(
  receipt: Pick<WebhookReceiptRecord, 'status' | 'createdAt' | 'updatedAt'>,
  timeoutMs = DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS,
  nowMs = Date.now()
): boolean {
  if (receipt.status !== 'processing') {
    return false;
  }

  const activityAt = toTimestamp(receipt.updatedAt) ?? toTimestamp(receipt.createdAt);

  if (!activityAt) {
    return false;
  }

  return nowMs - activityAt >= timeoutMs;
}

export async function processWebhookReceipt(
  webhookLogId: string,
  options: ProcessWebhookReceiptOptions = {}
): Promise<ProcessWebhookReceiptResult> {
  const startTime = Date.now();
  const maxAttempts = options.maxAttempts ?? DEFAULT_WEBHOOK_MAX_ATTEMPTS;
  const processingTimeoutMs = options.processingTimeoutMs ?? DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS;
  const deps = getWorkerDeps(options.deps);
  const log = await deps.getLog(webhookLogId);

  if (!log) {
    throw new Error(`Webhook receipt not found: ${webhookLogId}`);
  }

  const currentRetryCount = log.retryCount ?? 0;

  if (log.status === 'processed') {
    return {
      success: true,
      webhookLogId,
      attempt: currentRetryCount,
      events: [],
      processingTime: Date.now() - startTime,
      skipped: true,
    };
  }

  if (log.status === 'dead_letter') {
    return {
      success: false,
      webhookLogId,
      attempt: currentRetryCount,
      events: [],
      processingTime: Date.now() - startTime,
      skipped: true,
      error: 'Webhook receipt is already in dead letter state',
    };
  }

  if (
    log.status === 'processing' &&
    !options.force &&
    !isWebhookReceiptProcessingStale(log, processingTimeoutMs, Date.now())
  ) {
    return {
      success: false,
      webhookLogId,
      attempt: currentRetryCount,
      events: [],
      processingTime: Date.now() - startTime,
      skipped: true,
      error: 'Webhook receipt is already processing',
    };
  }

  if (log.status === 'processing' && !options.force) {
    logger.warn(
      {
        webhookLogId,
        provider: log.provider,
        eventId: log.eventId,
        eventType: log.eventType,
        retryCount: currentRetryCount,
        processingTimeoutMs,
      },
      'Webhook receipt processing lock is stale, retrying'
    );
  }

  if (currentRetryCount >= maxAttempts && !options.force) {
    await deps.updateLog(webhookLogId, 'dead_letter', {
      error: `Webhook receipt exceeded max attempts (${maxAttempts})`,
      retryCount: currentRetryCount,
    });

    return {
      success: false,
      webhookLogId,
      attempt: currentRetryCount,
      events: [],
      processingTime: Date.now() - startTime,
      skipped: true,
      error: `Webhook receipt exceeded max attempts (${maxAttempts})`,
    };
  }

  const attempt = currentRetryCount + 1;
  await deps.updateLog(webhookLogId, 'processing', { retryCount: attempt });

  try {
    const result = (await isPluginRuntimeReceipt(log))
      ? await deps.processPlugin(log)
      : await deps.process(
          {
            provider: log.provider as WebhookProvider,
            event: log.payload,
            headers: normalizeHeaders(log.headers),
          },
          { log: false }
        );

    const processingTime = Date.now() - startTime;

    if (result.success) {
      await deps.updateLog(webhookLogId, 'processed', {
        internalEvents: result.events,
        processingTime,
        retryCount: attempt,
      });
      await deps.logRetry(webhookLogId, attempt, 'success');
      await bus.event.emit(
        'webhook.processed',
        'webhook-receipt-worker',
        {
          webhookLogId,
          provider: log.provider,
          eventId: log.eventId,
          eventType: log.eventType,
          events: result.events,
          attempt,
          processingTime,
        },
        {
          eventId: `${webhookLogId}:processed:${attempt}`,
          correlationId: log.eventId ? `${log.provider}:${log.eventId}` : webhookLogId,
          causationId: webhookLogId,
          idempotencyKey: `${webhookLogId}:processed:${attempt}`,
        }
      );
      await auditLog('webhook.processed', 'webhook.process', {
        actorType: 'system',
        targetId: webhookLogId,
        targetType: 'webhook',
        details: {
          provider: log.provider,
          eventId: log.eventId,
          eventType: log.eventType,
          events: result.events,
          attempt,
          processingTime,
        },
      });

      return {
        success: true,
        webhookLogId,
        attempt,
        events: result.events,
        processingTime,
      };
    }

    const error = result.error ?? 'Webhook processing failed';
    const nextStatus = attempt >= maxAttempts ? 'dead_letter' : 'failed';
    const retryStatus = nextStatus === 'dead_letter' ? 'dead_letter' : 'failed';
    await deps.updateLog(webhookLogId, nextStatus, {
      error,
      processingTime,
      retryCount: attempt,
    });
    await deps.logRetry(webhookLogId, attempt, retryStatus, error);
    await bus.event.emit(
      'webhook.failed',
      'webhook-receipt-worker',
      {
        webhookLogId,
        provider: log.provider,
        eventId: log.eventId,
        eventType: log.eventType,
        attempt,
        error,
        processingTime,
      },
      {
        eventId: `${webhookLogId}:failed:${attempt}`,
        correlationId: log.eventId ? `${log.provider}:${log.eventId}` : webhookLogId,
        causationId: webhookLogId,
        idempotencyKey: `${webhookLogId}:failed:${attempt}`,
      }
    );
    await auditLog('webhook.failed', 'webhook.fail', {
      actorType: 'system',
      targetId: webhookLogId,
      targetType: 'webhook',
      details: {
        provider: log.provider,
        eventId: log.eventId,
        eventType: log.eventType,
        attempt,
        error,
        processingTime,
      },
    });

    return {
      success: false,
      webhookLogId,
      attempt,
      events: [],
      processingTime,
      error,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const nextStatus = attempt >= maxAttempts ? 'dead_letter' : 'failed';
    const retryStatus = nextStatus === 'dead_letter' ? 'dead_letter' : 'failed';
    await deps.updateLog(webhookLogId, nextStatus, {
      error: errorMessage,
      processingTime,
      retryCount: attempt,
    });
    await deps.logRetry(webhookLogId, attempt, retryStatus, errorMessage);
    await bus.event.emit(
      'webhook.failed',
      'webhook-receipt-worker',
      {
        webhookLogId,
        provider: log.provider,
        eventId: log.eventId,
        eventType: log.eventType,
        attempt,
        error: errorMessage,
        processingTime,
      },
      {
        eventId: `${webhookLogId}:failed:${attempt}`,
        correlationId: log.eventId ? `${log.provider}:${log.eventId}` : webhookLogId,
        causationId: webhookLogId,
        idempotencyKey: `${webhookLogId}:failed:${attempt}`,
      }
    );
    await auditLog('webhook.failed', 'webhook.fail', {
      actorType: 'system',
      targetId: webhookLogId,
      targetType: 'webhook',
      details: {
        provider: log.provider,
        eventId: log.eventId,
        eventType: log.eventType,
        attempt,
        error: errorMessage,
        processingTime,
      },
    });

    logger.error(
      { webhookLogId, attempt, error: errorMessage, processingTime },
      'Webhook receipt processing failed'
    );

    return {
      success: false,
      webhookLogId,
      attempt,
      events: [],
      processingTime,
      error: errorMessage,
    };
  }
}

export async function listRetryableWebhookReceipts(
  limit = 25,
  maxAttempts = DEFAULT_WEBHOOK_MAX_ATTEMPTS,
  processingTimeoutMs = DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS
): Promise<WebhookReceiptRecord[]> {
  const staleProcessingBefore = new Date(Date.now() - processingTimeoutMs);

  return db.query.webhookLogs.findMany({
    where: and(
      or(
        inArray(webhookLogs.status, ['received', 'failed']),
        and(eq(webhookLogs.status, 'processing'), lt(webhookLogs.updatedAt, staleProcessingBefore))
      ),
      lt(webhookLogs.retryCount, maxAttempts)
    ),
    orderBy: asc(webhookLogs.createdAt),
    limit,
  }) as Promise<WebhookReceiptRecord[]>;
}

export async function retryPendingWebhookReceipts(
  options: {
    limit?: number;
    maxAttempts?: number;
    processingTimeoutMs?: number;
  } = {}
): Promise<ProcessWebhookReceiptResult[]> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_WEBHOOK_MAX_ATTEMPTS;
  const processingTimeoutMs = options.processingTimeoutMs ?? DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS;
  const receipts = await listRetryableWebhookReceipts(
    options.limit ?? 25,
    maxAttempts,
    processingTimeoutMs
  );
  const results: ProcessWebhookReceiptResult[] = [];

  for (const receipt of receipts) {
    const result = await processWebhookReceipt(receipt.id, {
      maxAttempts,
      processingTimeoutMs,
    });
    results.push(result);
  }

  return results;
}
