/**
 * Authentication Middleware
 *
 * Provides authentication protection for API routes
 * Extracts user session and enforces authentication requirements
 */

import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/server';
import { requireUserContext } from '@/lib/db';
import { assertUserAccountActive } from '@/lib/services/user/user-status';
import type { ApiHandler, DefaultRouteContext } from './api-error-handler';
import { UnauthorizedError, handleApiError } from '@/lib/_core/errors';
import type { Session } from 'better-auth/types';

/**
 * Extended context with session information
 */
export interface AuthContext {
  session: Session;
  userId: string;
  userEmail: string;
}

/**
 * API handler with authentication context
 */
export type AuthenticatedApiHandler<TContext = DefaultRouteContext> = (
  request: NextRequest,
  context: TContext & { auth: { session: Session; userId: string; userEmail: string } }
) => Promise<Response>;

/**
 * Authentication middleware
 *
 * Wraps an API handler to require authentication.
 * Extracts session from Better Auth and adds it to the handler context.
 *
 * @param handler - The API handler to protect
 * @returns Wrapped handler that requires authentication
 *
 * @throws UnauthorizedError if no valid session
 *
 * @example
 * ```typescript
 * export const POST = withAuth(async (request, { auth }) => {
 *   const { userId, session } = auth;
 *   console.log('Authenticated user:', userId);
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withAuth<TContext = DefaultRouteContext>(
  handler: AuthenticatedApiHandler<TContext>
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    // Get session from Better Auth
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.session || !session?.user) {
      return handleApiError(new UnauthorizedError('Authentication required. Please sign in.'));
    }

    try {
      await assertUserAccountActive(session.user.id);
    } catch (error) {
      return handleApiError(error);
    }

    // Create auth context
    const authContext: AuthContext = {
      session: session.session,
      userId: session.user.id,
      userEmail: session.user.email,
    };

    // Call handler with auth context
    return handler(request, {
      ...context,
      auth: authContext,
    });
  };
}

/**
 * Runs an authenticated handler inside the current user's DB RLS context.
 *
 * Compose this inside `withAuth()` for user-owned API routes that read or write
 * RLS-protected tables. The DB proxy will resolve to the active transaction
 * while the handler runs, so existing service calls can keep using `db`.
 */
export function withAuthenticatedUserContext<TContext extends { auth: AuthContext }>(
  handler: (request: NextRequest, context: TContext) => Promise<Response>
): (request: NextRequest, context: TContext) => Promise<Response> {
  return async (request, context) => {
    return requireUserContext(context.auth.userId, async () => handler(request, context));
  };
}

/**
 * Optional authentication middleware
 *
 * Similar to withAuth but doesn't throw error if no session.
 * Useful for endpoints that work differently for authenticated/unauthenticated users.
 *
 * @param handler - The API handler
 * @returns Wrapped handler with optional auth context
 *
 * @example
 * ```typescript
 * export const GET = withOptionalAuth(async (request, { auth }) => {
 *   if (auth) {
 *     // Authenticated user
 *     return NextResponse.json({ user: auth.userId });
 *   } else {
 *     // Anonymous user
 *     return NextResponse.json({ user: null });
 *   }
 * });
 * ```
 */
export function withOptionalAuth<TContext = DefaultRouteContext>(
  handler: (
    request: NextRequest,
    context: TContext & { auth: AuthContext | null }
  ) => Promise<Response>
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    try {
      const session = await auth.api.getSession({ headers: request.headers });

      if (session?.session && session?.user) {
        await assertUserAccountActive(session.user.id);
      }

      const authContext: AuthContext | null =
        session?.session && session?.user
          ? {
              session: session.session,
              userId: session.user.id,
              userEmail: session.user.email,
            }
          : null;

      return handler(request, {
        ...context,
        auth: authContext,
      });
    } catch {
      // If session retrieval fails, treat as unauthenticated
      return handler(request, {
        ...context,
        auth: null,
      });
    }
  };
}

/**
 * Extract user ID from authenticated context
 *
 * Helper function to get operator user ID for service calls
 *
 * @param context - Request context with auth
 * @returns User ID
 *
 * @example
 * ```typescript
 * export const POST = withAuth(async (request, context) => {
 *   const operatorUserId = getOperatorUserId(context);
 *   await updateProfile(data, operatorUserId);
 * });
 * ```
 */
export function getOperatorUserId(
  context: { auth: AuthContext } & Record<string, unknown>
): string {
  return context.auth.userId;
}

/**
 * Extract user email from authenticated context
 *
 * @param context - Request context with auth
 * @returns User email
 */
export function getOperatorEmail(context: { auth: AuthContext } & Record<string, unknown>): string {
  return context.auth.userEmail;
}
