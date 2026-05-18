/**
 *
 */

import { randomUUID } from 'crypto';
import { getStripe } from './client';
import { db } from '@/lib/db';
import { userEntitlements } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import pRetry from 'p-retry';
import { logger } from '@/lib/_core/logger';
import { getPlanById } from '@/lib/services/entitlement/plan-service';
import { validateStripePriceEnvironment } from './env-guard';
import {
  createOrder,
  getOrderByProviderId,
  updateOrderMetadata,
} from '@/lib/services/billing/order-service';

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

type CheckoutSessionSummary = {
  id: string;
  url: string | null;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeCheckoutIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function cachedCheckoutSession(metadata: Record<string, unknown>): CheckoutSessionSummary | null {
  const sessionId = readString(metadata.checkoutSessionId);
  if (!sessionId) {
    return null;
  }

  return {
    id: sessionId,
    url: typeof metadata.checkoutSessionUrl === 'string' ? metadata.checkoutSessionUrl : null,
  };
}

function assertCheckoutReplayMatches(
  order: NonNullable<Awaited<ReturnType<typeof getOrderByProviderId>>>,
  expected: {
    userId: string;
    providerOrderId: string;
    amount: number | null;
    currency: string;
    checkoutRequest: Record<string, unknown>;
  }
): void {
  const metadata = asRecord(order.metadata);
  const mismatches: string[] = [];

  if (order.userId !== expected.userId) mismatches.push('userId');
  if (order.provider !== 'stripe') mismatches.push('provider');
  if (order.providerOrderId !== expected.providerOrderId) mismatches.push('providerOrderId');
  if (order.orderType !== 'one_time_purchase') mismatches.push('orderType');
  if (expected.amount === null) {
    if (order.amount !== null) mismatches.push('amount');
  } else if (Number(order.amount) !== expected.amount) {
    mismatches.push('amount');
  }
  if ((order.currency ?? null) !== expected.currency) mismatches.push('currency');
  if (
    stableStringify(metadata.checkoutRequest ?? {}) !== stableStringify(expected.checkoutRequest)
  ) {
    mismatches.push('checkoutRequest');
  }

  if (mismatches.length > 0) {
    throw new Error(
      `One-time checkout idempotency key was reused with a different request: ${mismatches.join(
        ', '
      )}.`
    );
  }
}

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

  async createOneTimeCheckoutSession(params: {
    userId: string;
    userEmail: string;
    priceId?: string;
    amount?: number;
    currency?: string;
    quantity?: number;
    name?: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ session: CheckoutSessionSummary; orderId: string }> {
    const {
      userId,
      userEmail,
      priceId,
      amount,
      currency = 'USD',
      quantity = 1,
      name,
      successUrl,
      cancelUrl,
      idempotencyKey: rawIdempotencyKey,
      metadata,
    } = params;

    if (!priceId && (!amount || amount <= 0 || !name?.trim())) {
      throw new Error('One-time checkout requires either priceId or amount and name.');
    }

    if (priceId) {
      await validateStripePriceEnvironment(priceId);
    }

    const idempotencyKey = normalizeCheckoutIdempotencyKey(rawIdempotencyKey);
    const newOrderId = randomUUID();
    const providerOrderId = idempotencyKey
      ? `checkout:${idempotencyKey}`
      : `checkout:${newOrderId}`;
    const checkoutRequest = {
      priceId,
      amount,
      currency,
      quantity,
      name,
    };
    const orderMetadata = {
      ...(metadata ?? {}),
      checkoutKind: 'one_time_purchase',
      checkoutRequest,
    };
    const expectedOrderAmount = amount ? amount * quantity : null;
    const existingOrder = idempotencyKey
      ? await getOrderByProviderId('stripe', providerOrderId)
      : null;
    if (existingOrder) {
      assertCheckoutReplayMatches(existingOrder, {
        userId,
        providerOrderId,
        amount: expectedOrderAmount,
        currency,
        checkoutRequest,
      });
      const cachedSession = cachedCheckoutSession(asRecord(existingOrder.metadata));
      if (cachedSession) {
        return { session: cachedSession, orderId: existingOrder.id };
      }
    }

    const orderId = existingOrder?.id ?? newOrderId;
    const stripe = getStripe();
    const customer = await this.getOrCreateCustomer(userId, userEmail);
    const safeMetadata = Object.fromEntries(
      Object.entries({
        ...orderMetadata,
        userId,
        orderId,
      }).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
    );

    if (!existingOrder) {
      await createOrder({
        id: orderId,
        userId,
        orderType: 'one_time_purchase',
        provider: 'stripe',
        providerOrderId,
        amount: expectedOrderAmount ?? undefined,
        currency,
        status: 'pending',
        metadata: orderMetadata,
      });
    }

    const stripeRequestOptions = idempotencyKey
      ? { idempotencyKey: `checkout:${idempotencyKey}` }
      : undefined;

    const session = await pRetry(
      () =>
        stripe.checkout.sessions.create(
          {
            customer: customer.id,
            mode: 'payment',
            client_reference_id: orderId,
            line_items: [
              priceId
                ? {
                    price: priceId,
                    quantity,
                  }
                : {
                    price_data: {
                      currency,
                      product_data: {
                        name: name!,
                      },
                      unit_amount: Math.round(amount! * 100),
                    },
                    quantity,
                  },
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: safeMetadata,
            payment_intent_data: {
              metadata: safeMetadata,
            },
            allow_promotion_codes: true,
            billing_address_collection: 'auto',
          },
          stripeRequestOptions
        ),
      STRIPE_RETRY_CONFIG
    );

    await updateOrderMetadata(orderId, {
      ...orderMetadata,
      checkoutSessionId: session.id,
      checkoutSessionUrl: session.url,
    });

    return { session, orderId };
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
