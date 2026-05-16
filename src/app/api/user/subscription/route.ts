/**
 * User Subscription API Endpoint
 *
 * GET /api/user/subscription
 *
 * Get current logged in user's subscription information
 *
 * Returns:
 * - Subscription plan details (id, name, slug, features, limits)
 * - Subscription status (status: active/trial/cancelled/expired)
 * - Usage statistics (scoped usage metrics)
 * - Subscription cycle (currentPeriodStart, currentPeriodEnd)
 * - Stripe related IDs (stripeCustomerId, stripeSubscriptionId)
 */

import { NextResponse } from 'next/server';
import { withAuth, withErrorHandling, type AuthContext } from '@/lib/middleware';
import { requireUserContext } from '@/lib/db';
import { userEntitlements } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NotFoundError } from '@/lib/_core/errors';

const CURRENT_SUBSCRIPTION_STATUSES = ['active', 'trial', 'trialing', 'past_due'];

export const GET = withAuth(
  withErrorHandling(async (request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    //
    // Query user subscription information (join with plan table)
    //
    const entitlement = await requireUserContext(auth.userId, async (database) => {
      return await database.query.userEntitlements.findFirst({
        where: and(
          eq(userEntitlements.userId, auth.userId),
          inArray(userEntitlements.status, CURRENT_SUBSCRIPTION_STATUSES)
        ),
        with: {
          plan: true, // Query entitlement_plans table
        },
        orderBy: (entitlements, { desc }) => [desc(entitlements.updatedAt)],
      });
    });

    if (!entitlement) {
      throw new NotFoundError('Subscription', auth.userId);
    }

    //
    // Read usage directly from usageMetrics (no need to query usage_history)
    //
    const usageMetrics = (entitlement.usageMetrics as Record<string, unknown>) || {};
    const limits = (entitlement.plan.limits as Record<string, unknown>) || {};
    const pricing = (entitlement.plan.pricing as Record<string, unknown>) || {};

    //
    // Return formatted data
    //
    return NextResponse.json({
      // Details
      plan: {
        id: entitlement.plan.id,
        name: entitlement.plan.name,
        slug: entitlement.plan.slug,
        features: entitlement.plan.features,
        limits: limits, // Return limits object
        pricing,
        langJsonb: entitlement.plan.langJsonb,
      },

      // Status
      status: entitlement.status,
      isActive: CURRENT_SUBSCRIPTION_STATUSES.includes(entitlement.status),

      // Usage statistics (dynamically return all quotas)
      usage: usageMetrics, // Return usageMetrics object

      // Cycle
      currentPeriodStart: entitlement.currentPeriodStart,
      currentPeriodEnd: entitlement.currentPeriodEnd,

      // Stripe related IDs
      stripeCustomerId: entitlement.stripeCustomerId,
      stripeSubscriptionId: entitlement.stripeSubscriptionId,

      // Other metadata
      metadata: entitlement.metadata,
    });
  })
);
