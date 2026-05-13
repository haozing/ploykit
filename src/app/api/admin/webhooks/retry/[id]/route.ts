import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { NotFoundError } from '@/lib/_core/errors';
import { getWebhookLog, getWebhookRetryHistory, processWebhookReceipt } from '@/lib/webhooks';
import { withAdminGuard, withErrorHandling, type RouteContext } from '@/lib/middleware';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

function toReceiptSummary(receipt: NonNullable<Awaited<ReturnType<typeof getWebhookLog>>>) {
  return {
    id: receipt.id,
    provider: receipt.provider,
    eventId: receipt.eventId,
    eventType: receipt.eventType,
    status: receipt.status,
    retryCount: receipt.retryCount ?? 0,
    error: receipt.error ?? null,
    processingTime: receipt.processingTime ?? null,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
    processedAt: receipt.processedAt ?? null,
  };
}

async function readReceiptId(context: RouteContext<{ id: string }>): Promise<string> {
  const params = paramsSchema.parse(await context.params);
  return params.id;
}

export const GET = withAdminGuard<RouteContext<{ id: string }>>(
  withErrorHandling<RouteContext<{ id: string }>>(async (_request, context) => {
    const id = await readReceiptId(context);
    const receipt = await getWebhookLog(id);

    if (!receipt) {
      throw new NotFoundError('Webhook receipt', id);
    }

    const retries = await getWebhookRetryHistory(id);

    return NextResponse.json({
      success: true,
      receipt: toReceiptSummary(receipt),
      retries,
    });
  })
);

export const POST = withAdminGuard<RouteContext<{ id: string }>>(
  withErrorHandling<RouteContext<{ id: string }>>(async (_request: NextRequest, context) => {
    const id = await readReceiptId(context);
    const receipt = await getWebhookLog(id);

    if (!receipt) {
      throw new NotFoundError('Webhook receipt', id);
    }

    const result = await processWebhookReceipt(id, { force: true });
    const [updatedReceipt, retries] = await Promise.all([
      getWebhookLog(id),
      getWebhookRetryHistory(id),
    ]);

    return NextResponse.json({
      success: true,
      result,
      receipt: updatedReceipt ? toReceiptSummary(updatedReceipt) : null,
      retries,
    });
  })
);
