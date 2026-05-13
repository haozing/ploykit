import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { entitlementPlans, userEntitlements } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { createPlan } from '@/lib/services/entitlement/plan-service';
import { withAdminGuard, withErrorHandling, withBodyValidation } from '@/lib/middleware';
import { ValidationError } from '@/lib/_core/errors';
import { createPlanSchema } from '@/lib/validations';

/**
 * GET /api/admin/entitlements/plans
 *
 * Get all plans with subscriber counts for dashboard display
 * This is a simplified endpoint specifically for the entitlements dashboard
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async () => {
    // Get all plans
    const plans = await db.select().from(entitlementPlans).orderBy(entitlementPlans.sortOrder);

    // Get subscriber counts for each plan
    const plansWithCounts = await Promise.all(
      plans.map(async (plan) => {
        const subscriberResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(userEntitlements)
          .where(and(eq(userEntitlements.planId, plan.id), eq(userEntitlements.status, 'active')));

        const subscriberCount = Number(subscriberResult[0]?.count || 0);

        return {
          ...plan,
          subscriberCount,
        };
      })
    );

    return NextResponse.json(
      {
        success: true,
        data: plansWithCounts,
      },
      { status: 200 }
    );
  })
);

/**
 * POST /api/admin/entitlements/plans
 *
 * Create a new subscription plan
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const POST = withAdminGuard(
  withErrorHandling(
    withBodyValidation(createPlanSchema, async (request, { validated }) => {
      if (!validated?.body) {
        throw new ValidationError('Request body is required');
      }
      // Create plan using the service with validated data
      // Ensure features and limits have default values
      const plan = await createPlan({
        ...validated.body,
        features: validated.body.features ?? {},
        limits: validated.body.limits ?? { monthly: {}, yearly: {} },
      });

      return NextResponse.json(
        {
          success: true,
          data: plan,
        },
        { status: 201 }
      );
    })
  )
);
