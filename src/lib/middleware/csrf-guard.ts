/**
 * CSRF Guard Middleware
 *
 * Provides Cross-Site Request Forgery protection for state-changing API routes.
 *
 * Strategy (Phase 1):
 * - Safe methods (GET/HEAD/OPTIONS) are skipped
 * - Machine-authenticated requests (Authorization header) are skipped
 * - Webhook routes are skipped (have signature validation)
 * - For cookie-authenticated state-changing requests, validate that the request
 *   includes a custom header or matches a valid origin
 *
 * Note: This uses the "custom header" approach for API routes, which is effective
 * because cross-origin simple requests cannot set arbitrary headers.
 */

import { NextRequest, NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * Check if request has machine authentication (API key, bearer token)
 */
function hasMachineAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader !== null && authHeader.length > 0;
}

/**
 * Check if request includes a CSRF protection signal
 *
 * We accept any of:
 * 1. X-Requested-With header (set by same-origin fetch/XHR)
 * 2. X-CSRF-Token header (explicit token)
 * 3. Content-Type: application/json (not sent by simple HTML forms)
 */
function hasCsrfSignal(request: NextRequest): boolean {
  // Custom headers prove same-origin access (CORS preflight required for cross-origin)
  if (request.headers.get('x-requested-with')) {
    return true;
  }

  if (request.headers.get('x-csrf-token')) {
    return true;
  }

  // JSON content type cannot be set by simple HTML forms
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return true;
  }

  return false;
}

/**
 * CSRF guard middleware
 *
 * Wraps an API handler to protect against CSRF attacks.
 *
 * @example
 * ```typescript
 * export const POST = withCsrfGuard(async (request) => {
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withCsrfGuard(
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

    // Validate CSRF signal
    if (!hasCsrfSignal(request)) {
      return NextResponse.json(
        {
          success: false,
          error: 'CSRF validation failed',
          code: 'CSRF_GUARD_DENIED',
          fix: 'Include X-Requested-With or X-CSRF-Token header, or set Content-Type: application/json',
        },
        { status: 403 }
      );
    }

    return handler(request, context);
  };
}
