/**
 * Stripe Webhook Endpoint
 *
 * Receive webhook events from Stripe
 *
 * POST /api/webhooks/stripe
 *
 * ✓ CRITICAL FINANCIAL ENDPOINT
 * ✓ Validated via cryptographic signature verification (stronger than schema validation)
 * ✓ Cannot use standard body validation middleware (requires raw body for signature)
 *
 * SECURITY NOTE:
 * - This endpoint uses Stripe signature verification instead of schema validation
 * - Signature verification provides cryptographic proof of authenticity
 * - This is the recommended approach for webhooks per Stripe documentation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWebhookLogByEventId, processWebhookReceipt, webhookHandler } from '@/lib/webhooks';
import { logger } from '@/lib/_core/logger';
import { env } from '@/lib/_core/env';
import { isAppError, ValidationError } from '@/lib/_core/errors';
import { createWebhookLog, isWebhookProcessed } from '@/lib/webhooks/webhook-logger';

interface StripeEvent {
  id: string;
  type: string;
  [key: string]: unknown;
}

/**
 * POST Handler - Receive Stripe Webhook
 *
 * Important:
 * - Stripe sends raw body, do not use request.json()
 * - Need to verify stripe-signature header
 * - Quick response (200), process event asynchronously
 */
export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  const requestId = `req_${requestStartTime}_${Math.random().toString(36).substr(2, 9)}`;

  // Add request entry logs (including timestamp)
  logger.info(
    {
      requestId,
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
    },
    '🔍 Webhook request received'
  );

  try {
    //
    // 0. Defensive check: Ensure webhook system has been initialized
    //
    logger.info(
      {
        requestId,
        hasProvider: webhookHandler.hasProvider('stripe'),
      },
      '🔍 Checking webhook handler status'
    );

    if (!webhookHandler.hasProvider('stripe')) {
      logger.warn(
        {
          requestId,
          timestamp: new Date().toISOString(),
        },
        'Stripe adapter not found, attempting re-initialization (likely due to HMR in dev mode)'
      );

      try {
        // Re-initialize webhook system
        const { initializeWebhooks } = await import('@/lib/webhooks/init');
        initializeWebhooks();

        // Check again
        if (!webhookHandler.hasProvider('stripe')) {
          logger.error({ requestId }, 'Failed to initialize Stripe adapter after retry');
          return createWebhookErrorResponse({
            code: 'WEBHOOK_NOT_INITIALIZED',
            message: 'Webhook system not initialized',
            statusCode: 503,
            requestId,
            fix: 'Check STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env file.',
          });
        }

        logger.info({ requestId }, '✅ Stripe adapter re-initialized successfully');
      } catch (initError) {
        logger.error(
          {
            requestId,
            error: initError instanceof Error ? initError.message : String(initError),
          },
          'Failed to re-initialize webhook system'
        );

        return createWebhookErrorResponse({
          code: 'WEBHOOK_INITIALIZATION_FAILED',
          message: 'Webhook initialization failed',
          statusCode: 503,
          requestId,
          details:
            env.NODE_ENV === 'development'
              ? { cause: initError instanceof Error ? initError.message : String(initError) }
              : undefined,
          fix: 'Check webhook provider configuration and initialization logs.',
        });
      }
    }

    // 1. Verify signature header exists (Manual validation required for webhooks)
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      logger.warn({ requestId }, 'Stripe webhook request missing signature header');
      throw new ValidationError('Missing stripe-signature header');
    }

    // 2. Get raw payload (important: must be original string for signature verification)
    const payload = await request.text();

    if (!payload) {
      logger.warn({ requestId }, 'Stripe webhook request missing payload');
      throw new ValidationError('Missing request payload');
    }

    logger.info(
      {
        requestId,
        payloadSize: payload.length,
      },
      'Received Stripe webhook request'
    );

    // 3. Verify signature
    const event = (await webhookHandler.verify('stripe', payload, signature)) as StripeEvent;

    logger.info(
      {
        requestId,
        eventType: event.type,
        eventId: event.id,
      },
      'Stripe webhook signature verified'
    );

    // 4. Idempotency check
    const alreadyProcessed = await isWebhookProcessed('stripe', event.id);
    if (alreadyProcessed) {
      logger.info(
        { requestId, eventId: event.id },
        'Webhook event already processed, returning 200'
      );
      return NextResponse.json({ received: true, requestId, duplicate: true }, { status: 200 });
    }

    // 5. Persist or reuse receipt before processing.
    const existingReceipt = await getWebhookLogByEventId('stripe', event.id);
    const logResult =
      existingReceipt && existingReceipt.status !== 'processed'
        ? {
            id: existingReceipt.id,
            status: existingReceipt.status as 'received' | 'processing' | 'processed' | 'failed',
            createdAt: existingReceipt.createdAt,
          }
        : await createWebhookLog({
            provider: 'stripe',
            eventId: event.id,
            eventType: event.type,
            payload: event,
            signature,
            headers: { signature },
            status: 'received',
          });

    // 6. Process the durable receipt. Failed receipts stay in DB for retry worker.
    const processingResult = await processWebhookReceipt(logResult.id);

    if (processingResult.success) {
      logger.info(
        {
          requestId,
          eventId: event.id,
          logId: logResult.id,
          internalEvents: processingResult.events,
          processingTime: processingResult.processingTime,
        },
        'Stripe webhook receipt processed successfully'
      );
    } else {
      logger.error(
        {
          requestId,
          eventId: event.id,
          logId: logResult.id,
          error: processingResult.error,
          attempt: processingResult.attempt,
        },
        'Stripe webhook receipt persisted but processing failed'
      );
    }

    // 7. Return success after durable receipt handling.
    logger.info(
      {
        requestId,
        eventId: event.id,
        logId: logResult.id,
        processed: processingResult.success,
        queuedForRetry: !processingResult.success,
        processingTime: Date.now() - requestStartTime,
      },
      'Webhook receipt handled, returning 200'
    );

    return NextResponse.json(
      {
        received: true,
        requestId,
        processed: processingResult.success,
        queuedForRetry: !processingResult.success,
        error: env.NODE_ENV === 'development' ? processingResult.error : undefined,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Verification failed or other error
    logger.error(
      {
        requestId,
        error: errorMessage,
        errorStack,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        hasStripeAdapter: webhookHandler.hasProvider('stripe'),
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - requestStartTime,
      },
      'Stripe webhook request failed'
    );

    const statusCode = isAppError(error) ? error.statusCode : 400;
    const debugDetails =
      env.NODE_ENV === 'development'
        ? {
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            originalMessage: errorMessage,
            hasStripeAdapter: webhookHandler.hasProvider('stripe'),
            timestamp: new Date().toISOString(),
          }
        : undefined;

    return createWebhookErrorResponse({
      code: isAppError(error) ? error.code : 'WEBHOOK_PROCESSING_FAILED',
      message: isAppError(error) ? error.message : 'Webhook processing failed',
      statusCode,
      requestId,
      details: debugDetails,
      fix: errorMessage.includes('Timestamp outside the tolerance zone')
        ? 'Webhook event is too old. Restart Stripe CLI forwarding and resend a fresh event.'
        : undefined,
    });
  }
}

/**
 * GET Handler - Health check
 *
 * Used to verify endpoint is working normally
 */
export async function GET() {
  return NextResponse.json({
    endpoint: 'stripe-webhook',
    status: 'active',
    provider: 'stripe',
    hasAdapter: webhookHandler.hasProvider('stripe'),
  });
}

function createWebhookErrorResponse(input: {
  code: string;
  message: string;
  statusCode: number;
  requestId: string;
  details?: Record<string, unknown>;
  fix?: string;
}) {
  return NextResponse.json(
    {
      success: false,
      code: input.code,
      error: {
        code: input.code,
        message: input.message,
        statusCode: input.statusCode,
        details: input.details,
        fix: input.fix,
      },
      requestId: input.requestId,
    },
    { status: input.statusCode }
  );
}
