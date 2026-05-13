import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withAdminGuard,
  withErrorHandling,
  withValidation,
  type AuthContext,
  type RouteContext,
} from '@/lib/middleware';
import { commonSchemas } from '@/lib/validations/common';
import {
  cancelSubscription,
  reactivateSubscription,
  upgradeUserPlan,
} from '@/lib/services/user/user-entitlement-service';
import { ValidationError } from '@/lib/_core/errors';

const paramsSchema = z.object({
  userId: commonSchemas.id,
});

const bodySchema = z.object({
  entitlementId: commonSchemas.uuid.optional(),
  planId: commonSchemas.uuid.optional(),
  status: z.enum(['active', 'cancelled', 'reactivate']),
  notes: z.string().trim().max(500).optional(),
});

const updateUserEntitlementValidation = {
  params: paramsSchema,
  body: bodySchema,
};

/**
 * POST /api/admin/entitlements/[userId]
 *
 * Updates a user's active entitlement from the admin dashboard.
 */
export const POST = withAdminGuard<RouteContext<{ userId: string }>>(
  withErrorHandling(
    withValidation(updateUserEntitlementValidation, async (_request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const userId = validated.params!.userId;
      const body = validated.body;

      if (!body) {
        throw new ValidationError('Request body is required');
      }

      if (body.status === 'active') {
        if (!body.planId) {
          throw new ValidationError('planId is required when status is active');
        }

        const entitlement = await upgradeUserPlan(userId, body.planId, undefined, undefined, {
          operatorId: auth.userId,
          reason: body.notes,
        });

        return NextResponse.json({
          success: true,
          data: entitlement,
        });
      }

      if (body.status === 'reactivate') {
        if (!body.entitlementId) {
          throw new ValidationError('entitlementId is required when status is reactivate');
        }

        const entitlement = await reactivateSubscription(userId, body.entitlementId, {
          operatorId: auth.userId,
          reason: body.notes || 'Subscription reactivated by admin',
        });

        return NextResponse.json({
          success: true,
          data: entitlement,
        });
      }

      const entitlement = await cancelSubscription(userId, true, {
        entitlementId: body.entitlementId,
        operatorId: auth.userId,
        reason: body.notes || 'Subscription cancelled by admin',
      });

      return NextResponse.json({
        success: true,
        data: entitlement,
      });
    })
  )
);
