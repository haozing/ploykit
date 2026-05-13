/**
 * Webhook Logger Service
 *
 */

import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  webhookLogs,
  webhookRetries,
  type NewWebhookLog,
  type NewWebhookRetry,
} from '@/lib/db/schema';
import { desc, eq, lte } from 'drizzle-orm';
import { logger } from '@/lib/_core/logger';
import type { WebhookProvider, WebhookStatus } from './types';

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_HEADER_PATTERNS = [
  'authorization',
  'cookie',
  'secret',
  'signature',
  'token',
  'webhook-key',
];

export interface LogWebhookParams {
  provider: WebhookProvider;
  eventId?: string;
  eventType: string;
  payload: unknown;
  signature?: string;
  headers?: Record<string, string>;
  status: WebhookStatus;
  internalEvents?: string[];
  error?: string;
  processingTime?: number;
  retryCount?: number;
}

export interface WebhookLogResult {
  id: string;
  status: WebhookStatus;
  createdAt: Date;
}

function hashSensitiveValue(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  return SENSITIVE_HEADER_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function sanitizeHeaderValue(name: string, value: string): string {
  if (!isSensitiveHeaderName(name)) {
    return value;
  }

  return `${REDACTED_VALUE}:${hashSensitiveValue(value)}`;
}

export function sanitizeWebhookSignatureForStorage(signature?: string): string | undefined {
  return signature ? hashSensitiveValue(signature) : undefined;
}

export function sanitizeWebhookHeadersForStorage(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      continue;
    }

    sanitized[key.toLowerCase()] = sanitizeHeaderValue(key, value);
  }

  return sanitized;
}

function hasProviderEventId(params: LogWebhookParams): params is LogWebhookParams & {
  eventId: string;
} {
  return typeof params.eventId === 'string' && params.eventId.length > 0;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: unknown; cause?: unknown; message?: unknown };
  if (maybeError.code === '23505') {
    return true;
  }

  if (
    typeof maybeError.message === 'string' &&
    maybeError.message.includes('webhook_logs_provider_event_id_unique_idx')
  ) {
    return true;
  }

  return isUniqueConstraintViolation(maybeError.cause);
}

function toWebhookLogResult(log: {
  id: string;
  status: string;
  createdAt: Date;
}): WebhookLogResult {
  return {
    id: log.id,
    status: log.status as WebhookStatus,
    createdAt: log.createdAt,
  };
}

function sanitizeWebhookLogData(logData: NewWebhookLog): NewWebhookLog {
  return {
    ...logData,
    signature: logData.signature ?? undefined,
    headers: logData.headers ?? undefined,
  };
}

async function getExistingWebhookLogResult(params: LogWebhookParams): Promise<WebhookLogResult> {
  if (!hasProviderEventId(params)) {
    throw new Error('Webhook eventId is required to fetch an existing receipt');
  }

  const existing = await getWebhookLogByEventId(params.provider, params.eventId);
  if (!existing) {
    throw new Error(
      `Webhook receipt conflict occurred but no existing receipt was found for ${params.provider}:${params.eventId}`
    );
  }

  return toWebhookLogResult(existing);
}

/**
 * Create webhook log
 *
 * @param params - Log parameters
 * @returns Log record
 */
export async function createWebhookLog(params: LogWebhookParams): Promise<WebhookLogResult> {
  try {
    const logData: NewWebhookLog = {
      provider: params.provider,
      eventId: params.eventId,
      eventType: params.eventType,
      payload: params.payload as Record<string, unknown>,
      signature: sanitizeWebhookSignatureForStorage(params.signature),
      headers: sanitizeWebhookHeadersForStorage(params.headers) as
        | Record<string, unknown>
        | undefined,
      status: params.status,
      internalEvents: params.internalEvents,
      error: params.error,
      processingTime: params.processingTime,
      retryCount: params.retryCount || 0,
      processedAt:
        params.status === 'processed' ||
        params.status === 'failed' ||
        params.status === 'dead_letter'
          ? new Date()
          : null,
    };

    const insertQuery = db.insert(webhookLogs).values(sanitizeWebhookLogData(logData));
    const [log] = hasProviderEventId(params)
      ? await insertQuery
          .onConflictDoNothing({
            target: [webhookLogs.provider, webhookLogs.eventId],
            where: sql`${webhookLogs.eventId} IS NOT NULL`,
          })
          .returning()
      : await insertQuery.returning();

    if (!log) {
      const existing = await getExistingWebhookLogResult(params);

      logger.info(
        {
          webhookLogId: existing.id,
          provider: params.provider,
          eventId: params.eventId,
          eventType: params.eventType,
          status: existing.status,
        },
        'Webhook receipt already exists, reusing existing database log'
      );

      return existing;
    }

    logger.info(
      {
        webhookLogId: log.id,
        provider: params.provider,
        eventType: params.eventType,
        status: params.status,
      },
      'Webhook log persisted to database'
    );

    return toWebhookLogResult(log);
  } catch (error) {
    if (hasProviderEventId(params) && isUniqueConstraintViolation(error)) {
      const existing = await getExistingWebhookLogResult(params);

      logger.info(
        {
          webhookLogId: existing.id,
          provider: params.provider,
          eventId: params.eventId,
          eventType: params.eventType,
          status: existing.status,
        },
        'Webhook receipt already exists after unique conflict, reusing existing database log'
      );

      return existing;
    }

    logger.error(
      {
        provider: params.provider,
        eventType: params.eventType,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to persist webhook log to database'
    );

    // Re-throw to let caller handle
    throw error;
  }
}

/**
 * Update Webhook LogsStatus
 *
 * @param webhookLogId - Logs ID
 * @param updates - OtherUpdateField
 */
export async function updateWebhookLog(
  webhookLogId: string,
  status: Exclude<WebhookStatus, 'received'>,
  updates: {
    internalEvents?: string[];
    error?: string;
    processingTime?: number;
    retryCount?: number;
  } = {}
): Promise<void> {
  try {
    await db
      .update(webhookLogs)
      .set({
        status,
        updatedAt: new Date(),
        processedAt:
          status === 'processed' || status === 'failed' || status === 'dead_letter'
            ? new Date()
            : undefined,
        ...updates,
      })
      .where(eq(webhookLogs.id, webhookLogId));

    logger.info({ webhookLogId, status }, 'Webhook log updated');
  } catch (error) {
    logger.error(
      {
        webhookLogId,
        status,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to update webhook log'
    );

    throw error;
  }
}

/**
 *
 */
export async function logWebhookRetry(
  webhookLogId: string,
  attempt: number,
  status: 'success' | 'failed' | 'dead_letter',
  error?: string
): Promise<void> {
  try {
    const retryData: NewWebhookRetry = {
      webhookLogId,
      attempt,
      status,
      error,
    };

    await db.insert(webhookRetries).values(retryData);

    // Update retry count in webhook log
    await db
      .update(webhookLogs)
      .set({
        retryCount: attempt,
        status: status === 'success' ? 'processed' : status,
        updatedAt: new Date(),
        processedAt: new Date(),
      })
      .where(eq(webhookLogs.id, webhookLogId));

    logger.info({ webhookLogId, attempt, status }, 'Webhook retry logged');
  } catch (error) {
    logger.error(
      {
        webhookLogId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to log webhook retry'
    );

    throw error;
  }
}

/**
 * Get webhook log
 *
 * @param webhookLogId - Log ID
 * @returns Log record
 */
export async function getWebhookLog(webhookLogId: string) {
  try {
    const log = await db.query.webhookLogs.findFirst({
      where: eq(webhookLogs.id, webhookLogId),
    });

    return log;
  } catch (error) {
    logger.error(
      {
        webhookLogId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to get webhook log'
    );

    throw error;
  }
}

export async function getWebhookRetryHistory(webhookLogId: string, limit = 10) {
  try {
    return await db.query.webhookRetries.findMany({
      where: eq(webhookRetries.webhookLogId, webhookLogId),
      orderBy: [desc(webhookRetries.retriedAt)],
      limit: Math.max(1, Math.min(limit, 50)),
    });
  } catch (error) {
    logger.error(
      {
        webhookLogId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to get webhook retry history'
    );

    throw error;
  }
}

/**
 * Get latest webhook log for provider event id.
 */
export async function getWebhookLogByEventId(provider: WebhookProvider, eventId: string) {
  try {
    const log = await db.query.webhookLogs.findFirst({
      where: (table, { and, eq }) => and(eq(table.provider, provider), eq(table.eventId, eventId)),
      orderBy: [desc(webhookLogs.createdAt)],
    });

    return log;
  } catch (error) {
    logger.error(
      {
        provider,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to get webhook log by event id'
    );

    throw error;
  }
}

/**
 *
 */
export async function isWebhookProcessed(
  provider: WebhookProvider,
  eventId: string
): Promise<boolean> {
  try {
    const existing = await db.query.webhookLogs.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.provider, provider),
          eq(table.eventId, eventId),
          eq(table.status, 'processed')
        ),
    });

    return !!existing;
  } catch (error) {
    logger.error(
      {
        provider,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to check webhook idempotency'
    );

    // On error, assume not processed (safer to retry than skip)
    return false;
  }
}

/**
 *
 */
export async function cleanupWebhookLogs(daysToKeep: number = 90): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await db
      .delete(webhookLogs)
      .where(lte(webhookLogs.createdAt, cutoffDate))
      .returning();

    const deletedCount = result.length;

    logger.info({ deletedCount, daysToKeep, cutoffDate }, 'Cleaned up old webhook logs');

    return deletedCount;
  } catch (error) {
    logger.error(
      {
        daysToKeep,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to cleanup webhook logs'
    );

    throw error;
  }
}
