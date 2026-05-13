/**
 * EventBus Test API
 *
 * Used for manually testing EventBus event publishing and processing flow
 * Can bypass Stripe and directly trigger subscription events
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/_core/logger';
import { bus } from '@/lib/bus';
import { env } from '@/lib/_core/env';
import { InternalServerError, UnauthorizedError } from '@/lib/_core/errors';
import { withErrorHandling } from '@/lib/middleware';

/**
 * POST /api/debug/test-eventbus
 *
 * Manually publish billing.subscription.created event to EventBus
 *
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/debug/test-eventbus \
 *   -H "Content-Type: application/json" \
 *   -d '{"planId": "2cf88fb6-49ac-4102-93e6-15324f03d8d4"}'
 * ```
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  // 🔒 Disable debug endpoints in production
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      createDebugErrorBody('DEBUG_ROUTE_DISABLED', 'Debug endpoints are disabled in production'),
      { status: 404 }
    );
  }

  try {
    // 1. Verify user identity
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      throw new UnauthorizedError();
    }

    // 2. Get test parameters
    const body = await request.json();
    const {
      planId = '2cf88fb6-49ac-4102-93e6-15324f03d8d4', // Use Pro plan
      eventName = 'billing.subscription.created',
    } = body;

    const userId = session.user.id;
    const testSubscriptionId = `test_sub_${Date.now()}`;
    const testCustomerId = `test_cus_${Date.now()}`;

    logger.info(
      {
        userId,
        planId,
        eventName,
        testSubscriptionId,
        testCustomerId,
      },
      '🧪 Manual EventBus test triggered via API'
    );

    // 3. Construct test payload (consistent with webhook-handler format)
    const payload = {
      userId,
      data: {
        subscriptionId: testSubscriptionId,
        customerId: testCustomerId,
        status: 'active',
        planId: planId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        cancelAtPeriodEnd: false,
        metadata: {
          userId,
          planId,
          source: 'test-api',
        },
      },
    };

    logger.info(
      {
        eventName,
        emitterId: 'test-api',
        payload,
      },
      '📡 Publishing test event to EventBus...'
    );

    // 4. Publish event to EventBus
    await bus.event.emit(
      eventName,
      'test-api', // emitterId
      payload
    );

    logger.info(
      {
        eventName,
        userId,
        testSubscriptionId,
      },
      '✅ Test event published successfully'
    );

    // 5. Return test information
    return NextResponse.json(
      {
        success: true,
        message: 'Event published to EventBus',
        test: {
          userId,
          planId,
          eventName,
          subscriptionId: testSubscriptionId,
          customerId: testCustomerId,
        },
        payload,
        hint: 'Check server logs for processing details. The subscription handler should process this event asynchronously.',
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      },
      '❌ EventBus test failed'
    );

    throw new InternalServerError('Test failed', {
      operation: 'debugEventBusPost',
      cause: error instanceof Error ? error.name : typeof error,
    });
  }
});

/**
 * GET /api/debug/test-eventbus
 *
 * Get EventBus status and listener information
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  // Disable debug endpoints in production
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      createDebugErrorBody('DEBUG_ROUTE_DISABLED', 'Debug endpoints are disabled in production'),
      { status: 404 }
    );
  }

  try {
    // Verify user identity
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      throw new UnauthorizedError();
    }

    // Get EventBus status
    const listeners = bus.event.getListeners('billing.subscription.created');
    const pluginSubscriptions = bus.event.getPluginSubscriptions('stripe-webhook');

    return NextResponse.json({
      eventBusStatus: 'active',
      event: 'billing.subscription.created',
      listeners: {
        pluginIds: listeners,
        count: listeners.length,
      },
      stripeWebhookPlugin: {
        pluginId: 'stripe-webhook',
        subscriptions: pluginSubscriptions,
        subscriptionCount: pluginSubscriptions.length,
      },
      usage: {
        testCommand: 'POST /api/debug/test-eventbus',
        example: {
          planId: '2cf88fb6-49ac-4102-93e6-15324f03d8d4',
          eventName: 'billing.subscription.created',
        },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      '❌ Failed to get EventBus status'
    );

    throw new InternalServerError('Failed to get EventBus status', {
      operation: 'debugEventBusGet',
      cause: error instanceof Error ? error.name : typeof error,
    });
  }
});

function createDebugErrorBody(code: string, message: string) {
  return {
    success: false,
    code,
    error: {
      code,
      message,
      statusCode: 404,
    },
  };
}
