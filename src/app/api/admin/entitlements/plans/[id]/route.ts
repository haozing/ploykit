/**
 * /api/admin/entitlements/plans/[id]
 *
 * Plan detail management endpoints
 *
 * CRITICAL FINANCIAL ENDPOINT
 * Full validation with type safety
 * Protected with admin guard
 */

import { NextResponse } from 'next/server';
import { getPlanById, updatePlan, deletePlan } from '@/lib/services/entitlement/plan-service';
import { db } from '@/lib/db';
import { userEntitlements } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import {
  withAdminGuard,
  withErrorHandling,
  withParamsValidation,
  withValidation,
} from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';
import { updatePlanSchema } from '@/lib/validations/plan';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@/lib/_core/errors';

const paramsSchema = z.object({
  id: commonSchemas.uuid,
});

/**
 * GET /api/admin/entitlements/plans/[id]
 *
 * Get a specific plan with subscriber count
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (request, { validated }) => {
      const planId = validated.params!.id;

      // Get plan
      const plan = await getPlanById(planId);

      if (!plan) {
        throw new NotFoundError('Plan', planId);
      }

      // Get subscriber count
      const subscriberResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(userEntitlements)
        .where(eq(userEntitlements.planId, planId));

      const subscriberCount = Number(subscriberResult[0]?.count || 0);

      return NextResponse.json(
        {
          success: true,
          data: {
            ...plan,
            subscriberCount,
          },
        },
        { status: 200 }
      );
    })
  )
);

/**
 * PUT /api/admin/entitlements/plans/[id]
 *
 * Update a subscription plan
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
const updatePlanValidation = {
  params: paramsSchema,
  body: updatePlanSchema,
};

export const PUT = withAdminGuard(
  withErrorHandling(
    withValidation(updatePlanValidation, async (request, { validated }) => {
      const planId = validated.params!.id;

      if (!validated?.body) {
        throw new ValidationError('Request body is required');
      }

      // Update plan using the service
      const updatedPlan = await updatePlan(planId, validated.body);

      return NextResponse.json(
        {
          success: true,
          data: updatedPlan,
        },
        { status: 200 }
      );
    })
  )
);

/**
 * DELETE /api/admin/entitlements/plans/[id]
 *
 * Delete a subscription plan
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const DELETE = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (request, { validated }) => {
      const planId = validated.params!.id;

      // Delete plan using the service
      await deletePlan(planId);

      return NextResponse.json(
        {
          success: true,
          message: 'Plan deleted successfully',
        },
        { status: 200 }
      );
    })
  )
);
