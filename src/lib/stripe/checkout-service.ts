/**
 *
 */

import { getStripe } from './client';
import { db } from '@/lib/db';
import { userEntitlements } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import pRetry from 'p-retry';
import { logger } from '@/lib/_core/logger';
import { getPlanById } from '@/lib/services/entitlement/plan-service';
import { validateStripePriceEnvironment } from './env-guard';

/**
 *
 */
const STRIPE_RETRY_CONFIG = {
  retries: 3,
  minTimeout: 1000, // 1绉?
  maxTimeout: 5000, // 5绉?
  onFailedAttempt: (context: { attemptNumber: number; retriesLeft: number; error: Error }) => {
    logger.warn(
      {
        attempt: context.attemptNumber,
        retriesLeft: context.retriesLeft,
        error: context.error.message,
        name: context.error.name,
      },
      'Stripe API call failed, retrying...'
    );
  },
};

export class CheckoutService {
  /**
   */
  async createCheckoutSession(params: {
    userId: string;
    userEmail: string;
    planId: string;
    planName: string;
    stripePriceId: string;
    billingPeriod: 'monthly' | 'yearly';
    successUrl: string;
    cancelUrl: string;
  }) {
    const {
      userId,
      userEmail,
      planId,
      planName,
      stripePriceId,
      billingPeriod,
      successUrl,
      cancelUrl,
    } = params;

    const plan = await getPlanById(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    await validateStripePriceEnvironment(stripePriceId);
    const stripe = getStripe();

    const existingSub = await db.query.userEntitlements.findFirst({
      where: and(
        eq(userEntitlements.userId, userId),
        sql`status IN ('trialing', 'active', 'past_due')`
      ),
      with: {
        plan: true,
      },
    });

    if (existingSub && existingSub.plan.slug !== 'free') {
      throw new Error('user already has an active subscription');
    }

    const customer = await this.getOrCreateCustomer(userId, userEmail);

    const session = await pRetry(
      () =>
        stripe.checkout.sessions.create({
          customer: customer.id,
          mode: 'subscription',

          line_items: [
            {
              price: stripePriceId, // Use validated price ID
              quantity: 1,
            },
          ],

          success_url: successUrl,
          cancel_url: cancelUrl,

          metadata: {
            userId,
            planId,
            planSlug: plan.slug,
            planName,
            billingPeriod,
          },

          subscription_data: {
            metadata: {
              userId,
              planId,
              planSlug: plan.slug,
              planName,
              billingPeriod,
            },
          },

          allow_promotion_codes: true,
          billing_address_collection: 'auto',
        }),
      STRIPE_RETRY_CONFIG
    );

    return session;
  }

  /**
   */
  async createPortalSession(params: { userId: string; returnUrl: string }) {
    const { userId, returnUrl } = params;

    const entitlement = await db.query.userEntitlements.findFirst({
      where: and(
        eq(userEntitlements.userId, userId),
        sql`${userEntitlements.status} IN ('trial', 'trialing', 'active', 'past_due')`
      ),
    });

    if (!entitlement) {
      throw new Error('No active subscription found');
    }

    if (!entitlement.stripeCustomerId) {
      throw new Error('No Stripe customer ID found');
    }

    const stripe = getStripe();
    const session = await pRetry(
      () =>
        stripe.billingPortal.sessions.create({
          customer: entitlement.stripeCustomerId as string, // Check
          return_url: returnUrl,
        }),
      STRIPE_RETRY_CONFIG
    );

    return session;
  }

  /**
   */
  private async getOrCreateCustomer(userId: string, email: string) {
    const existingEntitlement = await db.query.userEntitlements.findFirst({
      where: eq(userEntitlements.userId, userId),
    });

    if (existingEntitlement?.stripeCustomerId) {
      const stripe = getStripe();
      return await pRetry(async () => {
        const customer = await stripe.customers.retrieve(
          existingEntitlement.stripeCustomerId as string
        );
        if (customer.deleted) {
          throw new Error('Customer has been deleted');
        }
        return customer;
      }, STRIPE_RETRY_CONFIG);
    }

    const stripe = getStripe();
    const customers = await pRetry(
      () => stripe.customers.list({ email, limit: 1 }),
      STRIPE_RETRY_CONFIG
    );
    if (customers.data.length > 0) {
      return customers.data[0];
    }

    return await pRetry(
      () =>
        stripe.customers.create({
          email,
          metadata: { userId },
        }),
      STRIPE_RETRY_CONFIG
    );
  }
}

export const checkoutService = new CheckoutService();
