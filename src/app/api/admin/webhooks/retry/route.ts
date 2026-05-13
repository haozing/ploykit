import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  DEFAULT_WEBHOOK_MAX_ATTEMPTS,
  DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS,
  listRetryableWebhookReceipts,
  retryPendingWebhookReceipts,
  type WebhookReceiptRecord,
} from '@/lib/webhooks';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

const retryRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    processingTimeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
  })
  .optional();

const retryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  maxAttempts: z.coerce.number().int().min(1).max(20).default(DEFAULT_WEBHOOK_MAX_ATTEMPTS),
  processingTimeoutMs: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(86_400_000)
    .default(DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS),
});

type RetryableReceiptWithError = WebhookReceiptRecord & {
  error?: string | null;
  processingTime?: number | null;
  processedAt?: Date | string | null;
};

async function readRetryOptions(request: NextRequest): Promise<z.infer<typeof retryRequestSchema>> {
  if (!request.body) {
    return undefined;
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }

  const body = await request.json();
  return retryRequestSchema.parse(body);
}

function readRetryListOptions(request: NextRequest): z.infer<typeof retryListQuerySchema> {
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  return retryListQuerySchema.parse(query);
}

function toReceiptSummary(receipt: WebhookReceiptRecord) {
  const receiptWithError = receipt as RetryableReceiptWithError;

  return {
    id: receipt.id,
    provider: receipt.provider,
    eventId: receipt.eventId,
    eventType: receipt.eventType,
    status: receipt.status,
    retryCount: receipt.retryCount ?? 0,
    error: receiptWithError.error ?? null,
    processingTime: receiptWithError.processingTime ?? null,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
    processedAt: receiptWithError.processedAt ?? null,
  };
}

export const GET = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    const options = readRetryListOptions(request);
    const receipts = await listRetryableWebhookReceipts(
      options.limit,
      options.maxAttempts,
      options.processingTimeoutMs
    );

    return NextResponse.json({
      success: true,
      options,
      receipts: receipts.map(toReceiptSummary),
    });
  })
);

export const POST = withErrorHandling(
  withAdminGuard(async (request: NextRequest) => {
    const options = (await readRetryOptions(request)) ?? {};
    const results = await retryPendingWebhookReceipts(options);

    return NextResponse.json({
      success: true,
      processed: results.length,
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      results,
    });
  })
);
