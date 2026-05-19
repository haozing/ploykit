import { NextResponse } from 'next/server';
import { createPlan } from '@/lib/services/entitlement/plan-service';
import { withAdminGuard, withErrorHandling, withBodyValidation } from '@/lib/middleware';
import { createPlanSchema, type CreatePlanInput } from '@/lib/validations/plan';
import { db } from '@/lib/db';
import { DatabaseError } from '@/lib/_core/errors';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';

/**
 * GET /api/plans
 *
 * Public pricing read endpoint. It returns display data only; Stripe/provider IDs
 * are intentionally resolved server-side by checkout flows.
 */
export const GET = withErrorHandling(async () => {
  let plans;
  const productId = getRuntimeProductId();

  try {
    plans = await db.query.entitlementPlans.findMany({
      where: (plans, { and, eq }) => and(eq(plans.productId, productId), eq(plans.isActive, true)),
      orderBy: (plans, { asc }) => [asc(plans.sortOrder)],
    });
  } catch (error) {
    throw new DatabaseError('Failed to fetch plans', {
      operation: 'listPublicPlans',
      cause: error instanceof Error ? error.name : typeof error,
    });
  }

  const formattedPlans = plans.map((plan) => {
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      features: plan.features,
      limits: plan.limits,
      pricing: plan.pricing,
      langJsonb: plan.langJsonb,
      isPopular: plan.isPopular || false,
      isDefault: plan.isDefault,
    };
  });

  return NextResponse.json(formattedPlans);
});

/**
 * POST /api/plans
 *
 * Admin-only plan creation. The global API middleware applies CSRF/Origin checks
 * before the route handler runs.
 */
export const POST = withErrorHandling(
  withAdminGuard(
    withBodyValidation(createPlanSchema, async (_request, context) => {
      const { validated } = context;
      const newPlan = await createPlan(validated.body as CreatePlanInput);

      return NextResponse.json(newPlan, { status: 201 });
    })
  )
);
