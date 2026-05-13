/**
 * Plan Detail API
 *
 * GET: Public read - returns display data only, no internal provider IDs
 * PUT/DELETE: Admin only
 */

import { NextResponse } from 'next/server';
import { updatePlan, deletePlan } from '@/lib/services/entitlement/plan-service';
import {
  withAdminGuard,
  withErrorHandling,
  withParamsValidation,
  withValidation,
} from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';
import { updatePlanSchema } from '@/lib/validations/plan';
import { db } from '@/lib/db';
import { entitlementPlans } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseError, NotFoundError } from '@/lib/_core/errors';

const paramsSchema = z.object({
  id: commonSchemas.uuid,
});

/**
 * GET /api/plans/[id]
 *
 * Public read - returns display data only
 */
export const GET = withErrorHandling(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    let plan;

    try {
      plan = await db.query.entitlementPlans.findFirst({
        where: eq(entitlementPlans.id, id),
      });
    } catch (error) {
      throw new DatabaseError('Failed to fetch plan', {
        operation: 'getPublicPlan',
        planId: id,
        cause: error instanceof Error ? error.name : typeof error,
      });
    }

    if (!plan) {
      throw new NotFoundError('Plan', id);
    }

    // Return display data only, no internal Stripe IDs
    const pricing = (plan.pricing as Record<string, unknown>) || {};
    const pricingMonthly = typeof pricing.monthly === 'number' ? pricing.monthly : undefined;
    const pricingYearly = typeof pricing.yearly === 'number' ? pricing.yearly : undefined;

    return NextResponse.json({
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      priceMonthly: pricingMonthly ?? 0,
      priceYearly: pricingYearly ?? null,
      currency: (pricing.currency as string) || 'USD',
      features: plan.features,
      limits: plan.limits,
      langJsonb: plan.langJsonb,
      isPopular: plan.isPopular || false,
      isDefault: plan.isDefault,
    });
  }
);

const updatePlanValidation = {
  params: paramsSchema,
  body: updatePlanSchema,
};

/**
 * PUT /api/plans/[id]
 *
 * Admin only - Update plan
 */
export const PUT = withErrorHandling(
  withAdminGuard(
    withValidation(updatePlanValidation, async (_request, context) => {
      const { validated } = context;
      const updatedPlan = await updatePlan(validated.params!.id, validated.body!);
      return NextResponse.json(updatedPlan);
    })
  )
);

/**
 * DELETE /api/plans/[id]
 *
 * Admin only - Delete plan
 */
export const DELETE = withErrorHandling(
  withAdminGuard(
    withParamsValidation(paramsSchema, async (_request, context) => {
      const { validated } = context;
      await deletePlan(validated.params!.id);
      return NextResponse.json({ success: true, message: 'Plan deleted successfully' });
    })
  )
);
