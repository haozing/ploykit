/**
 * Origin Guard Middleware
 *
 * Validates Origin/Referer headers for state-changing requests.
 * Prevents CSRF attacks by ensuring state-changing requests originate
 * from the application's own domain.
 *
 * Rules:
 * - GET/HEAD/OPTIONS: skip (safe methods)
 * - POST/PUT/PATCH/DELETE: validate Origin or Referer
 * - Requests with Authorization header: skip (machine/API key auth)
 * - Webhook routes: skip (have signature validation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/_core/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * Get allowed origins from environment
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    origins.push(new URL(appUrl).origin);
  }

  const authUrl = env.BETTER_AUTH_URL;
  if (authUrl) {
    origins.push(new URL(authUrl).origin);
  }

  // In development, allow localhost variants
  if (env.NODE_ENV === 'development') {
    origins.push('http://localhost:3000');
    origins.push('http://127.0.0.1:3000');
  }

  return [...new Set(origins)];
}

/**
 * Check if request has machine authentication (API key, bearer token)
 * Machine-authenticated requests skip origin validation
 */
function hasMachineAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader !== null && authHeader.length > 0;
}

/**
 * Validate origin/referer header
 */
function validateOrigin(request: NextRequest): boolean {
  const allowedOrigins = getAllowedOrigins();

  // Check Origin header first
  const origin = request.headers.get('origin');
  if (origin) {
    return allowedOrigins.some((allowed) => origin === allowed);
  }

  // Fall back to Referer header
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      return allowedOrigins.some((allowed) => refererOrigin === allowed);
    } catch {
      return false;
    }
  }

  // No origin or referer - allow in development, block in production
  // for state-changing requests. In practice, same-origin fetch/XHR
  // always sends Origin in modern browsers.
  return env.NODE_ENV === 'development';
}

/**
 * Origin guard middleware
 *
 * Wraps an API handler to validate origin for state-changing requests.
 *
 * @example
 * ```typescript
 * export const POST = withOriginGuard(async (request) => {
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withOriginGuard(
  handler: (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ) => Promise<Response>
) {
  return async (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ): Promise<Response> => {
    // Skip safe methods
    if (SAFE_METHODS.has(request.method)) {
      return handler(request, context);
    }

    // Skip machine-authenticated requests
    if (hasMachineAuth(request)) {
      return handler(request, context);
    }

    // Validate origin
    if (!validateOrigin(request)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid origin',
          code: 'ORIGIN_GUARD_DENIED',
          fix: 'Ensure requests include a valid Origin or Referer header from the application domain',
        },
        { status: 403 }
      );
    }

    return handler(request, context);
  };
}
