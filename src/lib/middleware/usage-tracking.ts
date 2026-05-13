/**
 * Usage Tracking Middleware
 *
 * Automatically tracks API calls for entitlement monitoring (user-based)
 *
 * Usage example:
 * ```typescript
 * export const GET = withUsageTracking(
 *   withErrorHandling(async (request) => {
 *     // your logic here
 *     return NextResponse.json({ success: true });
 *   })
 * );
 * ```
 */

import { NextRequest } from 'next/server';
import type { ApiHandler, DefaultRouteContext } from './api-error-handler';
import { trackApiCall } from '@/lib/helpers/usage-tracker';
import { logger } from '@/lib/_core/logger';
import { auth } from '@/lib/auth/server';

/**
 * Options for usage tracking middleware
 */
export interface UsageTrackingOptions {
  /**
   * How to extract userId from the request
   * - 'auth': From authenticated session (recommended)
   * - 'custom': Use custom extractor function
   * @default 'auth'
   */
  userIdSource?: 'auth' | 'custom';

  /**
   * Custom userId extractor function
   * Required when userIdSource is 'custom'
   */
  extractUserId?: (
    request: NextRequest,
    context: unknown
  ) => Promise<string | null> | string | null;

  /**
   * Skip tracking if userId is not found
   * If false, will log a warning when userId is missing
   * @default true
   */
  skipIfNoUser?: boolean;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * Extract user ID from request based on configuration
 */
async function getUserId(
  request: NextRequest,
  context: unknown,
  options: UsageTrackingOptions
): Promise<string | null> {
  const source = options.userIdSource || 'auth';

  try {
    if (source === 'custom' && options.extractUserId) {
      return await options.extractUserId(request, context);
    }

    if (source === 'auth') {
      const session = await auth.api.getSession({ headers: request.headers });
      return session?.user?.id || null;
    }

    return null;
  } catch (error) {
    logger.error({ error, source }, 'Failed to extract userId');
    return null;
  }
}

/**
 * API usage tracking middleware
 *
 * Wraps an API handler to automatically track API calls for entitlement monitoring.
 * Tracks one API call per request based on authenticated user.
 *
 * @param handler - The API handler to wrap
 * @param options - Usage tracking configuration
 * @returns Wrapped handler with usage tracking
 *
 * @example
 * ```typescript
 * // Track API calls using authenticated session
 * export const GET = withUsageTracking(
 *   async (request) => {
 *     return NextResponse.json({ data: 'response' });
 *   }
 * );
 *
 * // Track with custom user extraction
 * export const POST = withUsageTracking(
 *   async (request) => {
 *     return NextResponse.json({ success: true });
 *   },
 *   {
 *     userIdSource: 'custom',
 *     extractUserId: async (request) => {
 *       // Extract from custom logic
 *       return 'user-123';
 *     }
 *   }
 * );
 *
 * // Combine with error handling
 * export const PUT = withUsageTracking(
 *   withErrorHandling(async (request) => {
 *     return NextResponse.json({ updated: true });
 *   })
 * );
 * ```
 */
export function withUsageTracking<TContext = DefaultRouteContext>(
  handler: ApiHandler<TContext>,
  options: UsageTrackingOptions = {}
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    // Extract user ID
    const userId = await getUserId(request, context, options);

    // Track API call if userId is found
    if (userId) {
      if (options.debug) {
        logger.debug({ userId, method: request.method, url: request.url }, 'Tracking API call');
      }

      // Track asynchronously (non-blocking)
      trackApiCall(userId, 1).catch((error) => {
        logger.error(
          { error, userId, method: request.method, url: request.url },
          'Failed to track API call'
        );
      });
    } else if (!options.skipIfNoUser) {
      logger.warn(
        { method: request.method, url: request.url, source: options.userIdSource },
        'API call not tracked: userId not found'
      );
    }

    // Execute the original handler
    return handler(request, context);
  };
}

/**
 * Create a usage tracking middleware with custom user extraction
 *
 * Convenience function for creating middleware with custom user ID extraction logic.
 *
 * @param extractUserId - Function to extract user ID from request
 * @param options - Additional usage tracking options
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * const trackWithCustomLogic = withCustomUserExtractor(async (request) => {
 *   const session = await getSession(request);
 *   return session?.user?.id || null;
 * });
 *
 * export const GET = trackWithCustomLogic(
 *   async (request) => {
 *     return NextResponse.json({ data: 'response' });
 *   }
 * );
 * ```
 */
export function withCustomUserExtractor<TContext = DefaultRouteContext>(
  extractUserId: (
    request: NextRequest,
    context: TContext
  ) => Promise<string | null> | string | null,
  options: Omit<UsageTrackingOptions, 'userIdSource' | 'extractUserId'> = {}
) {
  return (handler: ApiHandler<TContext>) =>
    withUsageTracking<TContext>(handler, {
      ...options,
      userIdSource: 'custom',
      extractUserId: extractUserId as (
        request: NextRequest,
        context: unknown
      ) => Promise<string | null> | string | null,
    });
}
