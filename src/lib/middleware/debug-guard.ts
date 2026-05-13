/**
 * Debug Guard Middleware
 *
 * Unified protection for debug/dev routes.
 * - Production: always 404
 * - Non-production: requires login, optionally admin
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/_core/env';
import { auth } from '@/lib/auth/server';
import type { ApiHandler } from './api-error-handler';
import { ForbiddenError, UnauthorizedError } from '@/lib/_core/errors';

export interface DebugGuardOptions {
  /** Require admin role (default: false) */
  admin?: boolean;
}

/**
 * Debug guard middleware
 *
 * Usage:
 * ```typescript
 * export const GET = withDebugGuard({ admin: true })(async (request) => {
 *   // debug handler
 * });
 * ```
 */
export function withDebugGuard(
  options: DebugGuardOptions = {}
): (handler: ApiHandler) => ApiHandler {
  return (handler: ApiHandler) => {
    return async (request: NextRequest, context: { params: Promise<Record<string, string>> }) => {
      // Production: always 404
      if (env.NODE_ENV === 'production') {
        return new NextResponse(null, { status: 404 });
      }

      // Non-production: require login
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.session || !session?.user) {
        throw new UnauthorizedError('Authentication required');
      }

      // Optionally require admin
      if (options.admin) {
        const { isAdmin } = await import('@/lib/auth/permissions');
        const userIsAdmin = await isAdmin(session.user.id);
        if (!userIsAdmin) {
          throw new ForbiddenError('Admin access required');
        }
      }

      return handler(request, context);
    };
  };
}
