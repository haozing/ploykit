/**
 * Admin Guard Middleware
 *
 * Protects admin routes by checking if user has admin role
 */

import { isAdmin } from '@/lib/auth/permissions';
import { ForbiddenError } from '@/lib/_core/errors';
import { withAuth, type AuthContext, type AuthenticatedApiHandler } from './auth';
import { withErrorHandling, type ApiHandler, type DefaultRouteContext } from './api-error-handler';

/**
 * Middleware to protect admin routes
 *
 * Ensures only users with admin role can access the route
 *
 * Usage:
 * ```typescript
 * export const GET = withAdminGuard(async (request, context) => {
 *   // Your admin route handler
 *   // context.auth contains authenticated user info
 * });
 * ```
 *
 * @param handler - Request handler function
 * @returns Wrapped handler with admin check
 */
export function withAdminGuard<TContext = DefaultRouteContext>(
  handler: AuthenticatedApiHandler<TContext> | ApiHandler<TContext>
): ApiHandler<TContext> {
  return withErrorHandling(
    withAuth<TContext>(async (request, context) => {
      // Check if user is admin
      const authContext = context as TContext & { auth: AuthContext };
      const userIsAdmin = await isAdmin(authContext.auth.userId);

      if (!userIsAdmin) {
        throw new ForbiddenError('Access denied. Admin role required.', {
          userId: authContext.auth.userId,
          requiredRole: 'admin',
        });
      }

      // User is admin, proceed with handler
      return handler(request, authContext);
    })
  );
}

/**
 * Feature-based guard middleware
 *
 * Protects routes based on subscription plan features
 *
 * This checks if the user's current plan includes the specified feature.
 * Features are controlled by subscription plans, not roles.
 *
 * Usage:
 * ```typescript
 * export const POST = withFeature('platform.apiAccess', async (request, context) => {
 *   // Your handler that requires API access feature
 * });
 * ```
 *
 * Common features:
 * - 'platform.apiAccess': API access permission
 * - 'platform.webhooksAccess': Webhook creation
 * - 'platform.premiumTools': Premium tools access
 * - 'platform.advancedFeatures': Advanced features
 * - 'platform.prioritySupport': Priority support
 *
 * @param feature - Required feature key from PlanFeatures
 * @param handler - Request handler function
 * @returns Wrapped handler with feature check
 */
export function withFeature<TContext = DefaultRouteContext>(
  feature: string,
  handler: AuthenticatedApiHandler<TContext> | ApiHandler<TContext>
): ApiHandler<TContext> {
  return withErrorHandling(
    withAuth<TContext>(async (request, context) => {
      const { hasFeature } = await import('@/lib/services/user/user-entitlement-service');
      const authContext = context as TContext & { auth: AuthContext };

      const userHasFeature = await hasFeature(authContext.auth.userId, feature);

      if (!userHasFeature) {
        throw new ForbiddenError(
          `Access denied. This feature requires a subscription plan with ${feature} enabled.`,
          {
            userId: authContext.auth.userId,
            requiredFeature: feature,
            upgradeMessage: 'Please upgrade your plan to access this feature.',
          }
        );
      }

      return handler(request, authContext);
    })
  );
}
