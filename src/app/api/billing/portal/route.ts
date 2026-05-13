/**
 * POST /api/billing/portal
 *
 * Create Stripe Customer Portal Session (platform-level subscription)
 *
 * Design reference: Payment subscription system design document Section 3.3
 *
 * ✓ CRITICAL FINANCIAL ENDPOINT
 * ✓ Full validation with type safety
 * ✓ Protected with authentication guard
 */

import { NextResponse } from 'next/server';
import { checkoutService } from '@/lib/stripe/checkout-service';
import { env } from '@/lib/_core/env';
import {
  withAuth,
  withErrorHandling,
  withBodyValidation,
  type AuthContext,
} from '@/lib/middleware';
import { createPortalSessionSchema } from '@/lib/validations/billing';
import { NotFoundError } from '@/lib/_core/errors';

export const POST = withAuth(
  withErrorHandling(
    withBodyValidation(createPortalSessionSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const { returnUrl } = validated.body!;

      try {
        // Create Portal Session (platform-level: no siteId required)
        const portalSession = await checkoutService.createPortalSession({
          userId: auth.userId,
          returnUrl: returnUrl || `${env.NEXT_PUBLIC_APP_URL}/billing`,
        });

        return NextResponse.json(
          {
            success: true,
            url: portalSession.url,
          },
          { status: 200 }
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'No subscription found' ||
            error.message === 'No active subscription found')
        ) {
          throw new NotFoundError('Active subscription');
        }
        if (error instanceof Error && error.message === 'No Stripe customer ID found') {
          throw new NotFoundError('Stripe customer');
        }
        throw error;
      }
    })
  )
);
