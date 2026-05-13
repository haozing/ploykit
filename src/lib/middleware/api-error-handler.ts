/**
 * API Error Handler Middleware
 *
 * Provides unified error handling for API routes with logging and formatting.
 *
 * @example
 * ```typescript
 * export const GET = withErrorHandling(async (request) => {
 *   // your logic here
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAppError, serializeAppErrorForResponse, toErrorResponse } from '@/lib/_core/errors';
import { logger } from '@/lib/_core/logger';
import { sanitizeForLog, sanitizeHeaders } from '@/lib/_core/log-sanitizer';
import { applySecurityHeaders } from '@/lib/security/security-headers.server';
import { z } from 'zod';
import { env } from '@/lib/_core/env';

// Types

/**
 * Default context type for Next.js 15+ API routes
 * Routes with dynamic segments need params as Promise<{ [key]: string }>
 */
export type DefaultRouteContext = { params: Promise<Record<string, string>> };

/**
 * Context type for routes with dynamic parameters
 * Use this for routes like /api/[id]/route.ts
 */
export type RouteContext<T extends Record<string, string>> = { params: Promise<T> };

/**
 * API Route Handler Type
 */
export type ApiHandler<TContext = DefaultRouteContext> = (
  request: NextRequest,
  context: TContext
) => Promise<Response>;

/**
 * Error Handler Options
 */
export interface ErrorHandlerOptions {
  /** Include stack trace in error response (development only) */
  includeStack?: boolean;

  /** Custom error transformer function */
  transformError?: (error: unknown) => unknown;

  /** Callback to execute when an error occurs */
  onError?: (error: unknown, request: NextRequest) => void | Promise<void>;

  /** Whether to log request details */
  logRequest?: boolean;
}

// Main Middleware

/**
 * Unified error handling middleware
 *
 * @param handler - The API handler to wrap
 * @param options - Error handling options
 *
 * @example
 * ```typescript
 * export const GET = withErrorHandling(async (request) => {
 *   const data = await fetchData();
 *   return NextResponse.json(data);
 * });
 * ```
 */
export function withErrorHandling<TContext = DefaultRouteContext>(
  handler: ApiHandler<TContext>,
  options: ErrorHandlerOptions = {}
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    const startTime = Date.now();
    const requestId = request.headers.get('x-request-id') || generateRequestId();

    try {
      // 1. Log request (if enabled)

      if (options.logRequest) {
        logger.info(
          {
            requestId,
            method: request.method,
            url: request.url,
            headers: sanitizeHeaders(Object.fromEntries(request.headers.entries())),
          },
          'API request received'
        );
      }

      // 2. Execute handler

      const response = await handler(request, context);

      // 3. Log successful response

      const duration = Date.now() - startTime;
      logger.debug(
        {
          requestId,
          method: request.method,
          url: request.url,
          status: response.status,
          duration,
        },
        'API request completed'
      );

      // Add request ID and security headers to response
      response.headers.set('x-request-id', requestId);
      applySecurityHeaders(response);

      return response;
    } catch (error) {
      // 4. Handle errors

      const duration = Date.now() - startTime;

      // Call custom error callback
      if (options.onError) {
        try {
          await options.onError(error, request);
        } catch (callbackError) {
          logger.error({ callbackError }, 'Error in onError callback');
        }
      }

      // Log error
      logger.error(
        sanitizeForLog({
          requestId,
          method: request.method,
          url: request.url,
          duration,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: env.NODE_ENV === 'development' ? error.stack : undefined,
                }
              : String(error),
        }),
        'API request failed'
      );

      // 5. Format error response

      let errorResponse;
      let statusCode = 500;

      if (isAppError(error)) {
        // Custom app error
        errorResponse = serializeAppErrorForResponse(error);
        statusCode = error.statusCode;
      } else if (error && typeof error === 'object' && 'issues' in error) {
        // Zod validation error
        errorResponse = formatZodError(error as z.ZodError);
        statusCode = 400;
      } else {
        // Unknown error
        errorResponse = toErrorResponse(error);
      }

      // Apply custom transformer
      if (options.transformError) {
        errorResponse = options.transformError(errorResponse);
      }

      // Ensure errorResponse is an object for spreading
      const baseResponse =
        errorResponse && typeof errorResponse === 'object'
          ? (errorResponse as Record<string, unknown>)
          : { error: errorResponse };

      // Add stack trace in development
      if (options.includeStack && env.NODE_ENV === 'development') {
        errorResponse = {
          ...baseResponse,
          stack: error instanceof Error ? error.stack : undefined,
        };
      } else {
        errorResponse = baseResponse;
      }

      errorResponse = normalizeErrorResponseBody(errorResponse, requestId, statusCode);

      const response = NextResponse.json(errorResponse, { status: statusCode });
      response.headers.set('x-request-id', requestId);
      applySecurityHeaders(response);

      return response;
    }
  };
}

// Specialized Wrappers

/**
 * Plugin-specific error handling middleware
 *
 * Adds plugin context to error responses for better debugging.
 *
 * @param handler - The API handler to wrap
 * @param pluginId - The plugin identifier
 */
export function withPluginErrorHandling<TContext = DefaultRouteContext>(
  handler: ApiHandler<TContext>,
  pluginId: string
): ApiHandler<TContext> {
  return withErrorHandling(handler, {
    logRequest: true,
    onError: async (error) => {
      logger.error({ pluginId, error }, 'Plugin API error');
    },
    transformError: (errorResponse) => {
      const baseResponse =
        errorResponse && typeof errorResponse === 'object'
          ? (errorResponse as Record<string, unknown>)
          : { error: errorResponse };

      return {
        ...baseResponse,
        context: { pluginId },
      };
    },
  });
}

/**
 * Development environment error handling
 *
 * Includes stack traces and request logging for debugging.
 */
export function withDevErrorHandling<TContext = DefaultRouteContext>(
  handler: ApiHandler<TContext>
): ApiHandler<TContext> {
  return withErrorHandling(handler, {
    includeStack: true,
    logRequest: true,
  });
}

/**
 * Production environment error handling
 *
 * Hides sensitive information and stack traces.
 */
export function withProdErrorHandling<TContext = DefaultRouteContext>(
  handler: ApiHandler<TContext>
): ApiHandler<TContext> {
  return withErrorHandling(handler, {
    includeStack: false,
    logRequest: false,
    transformError: (errorResponse: unknown) => {
      if (!errorResponse || typeof errorResponse !== 'object') {
        return errorResponse;
      }

      const response = errorResponse as Record<string, unknown>;
      const { error, ...rest } = response;
      const errorObj = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};

      return {
        ...rest,
        error: {
          code: errorObj.code || 'INTERNAL_ERROR',
          message: errorObj.message || 'An error occurred',
        },
      };
    },
  });
}

// Utility Functions

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function normalizeErrorResponseBody(
  errorResponse: unknown,
  requestId: string,
  statusCode: number
): Record<string, unknown> {
  const baseResponse =
    errorResponse && typeof errorResponse === 'object'
      ? (errorResponse as Record<string, unknown>)
      : { error: errorResponse };

  const rawError = baseResponse.error;
  const errorPayload =
    rawError && typeof rawError === 'object'
      ? ({ ...(rawError as Record<string, unknown>) } as Record<string, unknown>)
      : {
          code: typeof baseResponse.code === 'string' ? baseResponse.code : 'INTERNAL_ERROR',
          message: typeof rawError === 'string' ? rawError : 'An error occurred',
        };

  const code =
    typeof errorPayload.code === 'string'
      ? errorPayload.code
      : typeof baseResponse.code === 'string'
        ? baseResponse.code
        : 'INTERNAL_ERROR';

  return {
    success: false,
    code,
    ...baseResponse,
    error: {
      statusCode,
      ...errorPayload,
      code,
    },
    requestId,
  };
}

/**
 * Format Zod validation errors into a structured response
 */
function formatZodError(error: z.ZodError) {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'root';
    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(issue.message);
  }

  return {
    success: false,
    code: 'VALIDATION_ERROR',
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      statusCode: 400,
      details: { fields: errors },
      fields: errors,
    },
  };
}

// Async Error Boundary (for React Server Components)

/**
 * Async error boundary with fallback value
 *
 * @param fn - Async function to execute
 * @param fallback - Fallback value if function throws
 *
 * @example
 * ```typescript
 * const data = await catchAsync(
 *   () => fetchData(),
 *   { error: 'Failed to load data' }
 * );
 * ```
 */
export async function catchAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.error({ error }, 'Async operation failed');
    return fallback;
  }
}

/**
 * Retry wrapper with exponential/linear backoff
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration
 *
 * @example
 * ```typescript
 * const data = await withRetry(
 *   () => fetchData(),
 *   { maxRetries: 3, backoff: 'exponential' }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    backoff?: 'linear' | 'exponential';
    initialDelay?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, backoff = 'exponential', initialDelay = 1000 } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay =
          backoff === 'exponential'
            ? initialDelay * Math.pow(2, attempt)
            : initialDelay * (attempt + 1);

        logger.warn({ attempt: attempt + 1, maxRetries, delay, error }, 'Retry attempt');

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  logger.error({ lastError, maxRetries }, 'All retry attempts failed');
  throw lastError;
}
