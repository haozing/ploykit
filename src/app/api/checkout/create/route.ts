/**
 * POST /api/checkout/create
 *
 * Create Stripe Checkout Session
 */

import { NextResponse } from 'next/server';
import { checkoutService } from '@/lib/stripe/checkout-service';
import { db } from '@/lib/db';
import { entitlementPlans } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { env } from '@/lib/_core/env';
import { withAuth, withErrorHandling, withBodyValidation, withRateLimit } from '@/lib/middleware';
import { createCheckoutSchema } from '@/lib/validations/billing';
import { NotFoundError, ValidationError, UnauthorizedError } from '@/lib/_core/errors';
import { auth } from '@/lib/auth';
import { validateStripePriceEnvironment } from '@/lib/stripe/env-guard';

export const POST = withErrorHandling(
  withRateLimit(
    withAuth(
      withBodyValidation(createCheckoutSchema, async (request, { validated }) => {
        if (!validated?.body) {
          throw new ValidationError('Request body is required');
        }
        const { planId, billingPeriod, lang } = validated.body;

        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const plan = await db.query.entitlementPlans.findFirst({
          where: and(eq(entitlementPlans.id, planId), eq(entitlementPlans.isActive, true)),
        });

        if (!plan) {
          throw new NotFoundError('Plan', planId);
        }

        const stripe = (plan.stripe as Record<string, unknown>) || {};
        const stripePriceId =
          billingPeriod === 'monthly'
            ? (stripe.priceIdMonthly as string | undefined)
            : (stripe.priceIdYearly as string | undefined);

        if (!stripePriceId) {
          throw new ValidationError('Stripe Price ID not configured for this plan');
        }

        await validateStripePriceEnvironment(stripePriceId);

        const checkoutSession = await checkoutService.createCheckoutSession({
          userId: session.user.id,
          userEmail: session.user.email,
          planId: plan.id,
          planName: plan.name,
          stripePriceId,
          billingPeriod,
          successUrl: `${env.NEXT_PUBLIC_APP_URL}/${lang || 'zh'}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/${lang || 'zh'}/pricing`,
        });

        return NextResponse.json({
          success: true,
          url: checkoutSession.url,
        });
      })
    )
  )
);
