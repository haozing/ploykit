import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminGuard, withErrorHandling, withParamsValidation } from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';
import { syncPlanToStripe } from '@/lib/services/billing/stripe-plan-sync-service';
import { AppError } from '@/lib/_core/errors';
import { env } from '@/lib/_core/env';

const paramsSchema = z.object({
  id: commonSchemas.uuid,
});

/**
 * POST /api/admin/entitlements/plans/[id]/sync-stripe
 *
 * Create/update Stripe Product + Prices for a plan, and update local price mapping.
 */
export const POST = withAdminGuard(
  withErrorHandling(
    withParamsValidation(paramsSchema, async (_request, { validated }) => {
      const planId = validated.params!.id;
      if (!env.STRIPE_SECRET_KEY) {
        throw new AppError('Stripe is not configured', 'STRIPE_NOT_CONFIGURED', 503, {
          missing: ['STRIPE_SECRET_KEY'],
        });
      }

      const result = await syncPlanToStripe({ planId });
      return NextResponse.json({ success: true, data: result }, { status: 200 });
    })
  )
);
