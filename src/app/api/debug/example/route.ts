/**
 * Debug Example API Route
 *
 * Moved from /api/example to /api/debug/example
 * Production: returns 404
 * Development: requires login
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  triggerBeforeHandleHook,
  triggerAfterHandleHook,
  getUserIdFromHeaders,
} from '@/lib/bus/hook-helpers.server';
import { logger } from '@/lib/_core/logger';
import { withDebugGuard } from '@/lib/middleware/debug-guard';
import { withErrorHandling } from '@/lib/middleware';
import { ForbiddenError } from '@/lib/_core/errors';

export const GET = withErrorHandling(
  withDebugGuard()(async (request: NextRequest) => {
    const startTime = Date.now();
    const url = request.nextUrl.toString();
    const userId = await getUserIdFromHeaders();

    logger.info({ userId, url }, 'Debug API request started');

    const beforeResult = await triggerBeforeHandleHook({
      request,
      route: { path: url, method: 'GET' },
      userId,
    });

    if (beforeResult.cancel) {
      throw new ForbiddenError(beforeResult.cancelReason || 'Request cancelled');
    }

    const responseData = {
      message: 'Hello from debug API',
      userId: userId || 'anonymous',
      timestamp: new Date().toISOString(),
      pluginData: beforeResult.headers || {},
    };

    const response = NextResponse.json(responseData, { status: 200 });

    if (beforeResult.headers) {
      Object.entries(beforeResult.headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
    }

    const duration = Date.now() - startTime;
    triggerAfterHandleHook({ request, response, duration, userId }).catch((error) => {
      logger.error({ error }, 'After handle hook failed');
    });

    return response;
  })
);

export const POST = withErrorHandling(
  withDebugGuard()(async (request: NextRequest) => {
    const startTime = Date.now();
    const url = request.nextUrl.toString();
    const userId = await getUserIdFromHeaders();
    const body = await request.json();

    logger.info({ userId, url, body }, 'Debug API POST request');

    const beforeResult = await triggerBeforeHandleHook({
      request,
      route: { path: url, method: 'POST' },
      userId,
    });

    if (beforeResult.cancel) {
      throw new ForbiddenError(beforeResult.cancelReason || 'Request cancelled');
    }

    const response = NextResponse.json(
      {
        message: 'POST request processed',
        userId: userId || 'anonymous',
        receivedData: body,
        timestamp: new Date().toISOString(),
      },
      { status: 201 }
    );

    const duration = Date.now() - startTime;
    triggerAfterHandleHook({ request, response, duration, userId }).catch((error) => {
      logger.error({ error }, 'After handle hook failed');
    });

    return response;
  })
);
