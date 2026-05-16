/**
 * Subscription Event Handler
 *
 * Handles Stripe webhook events related to subscriptions with transaction protection
 *
 * Features:
 * - Transaction-safe: All operations use transaction-protected service functions
 * - Idempotent: All handlers check for duplicate processing
 * - Error handling: Comprehensive error logging and recovery
 * - Audited: All webhook events are logged via service functions
 */

import { bus } from '@/lib/bus';
import {
  upgradeUserPlan,
  cancelSubscription,
  getUserEntitlement,
  readPlanLimitValue,
} from '@/lib/services/user/user-entitlement-service';
import { logger } from '@/lib/_core/logger';
import {
  createOrder,
  getOrderByProviderId,
  createRefundOrder,
  updateOrderStatus,
} from '@/lib/services/billing/order-service';
import {
  markInvoicesForOrderStatus,
  upsertProviderInvoice,
} from '@/lib/services/billing/local-billing-service';
import {
  logSubscriptionCreated,
  logMonthlyReset,
  logRefundRevoke,
} from '@/lib/services/billing/credit-log-service';
import { db } from '@/lib/db';
import { entitlementPlans, userEntitlements } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getPlanForStripePriceId } from '@/lib/services/billing/plan-price-service';
import { WEBHOOK_PLUGIN_IDS, BILLING_EVENTS, PAYMENT_FAILURE_CONFIG } from '../constants';
import { getProductPrimaryCreditMetric } from '@/lib/billing/product-billing.server';

const PLUGIN_ID = WEBHOOK_PLUGIN_IDS.STRIPE;
const PRIMARY_CREDIT_METRIC = getProductPrimaryCreditMetric();

type BillingInterval = 'monthly' | 'yearly';

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function getInitialQuotaWindow(params: { currentPeriodStart?: Date | null }): {
  quotaPeriodStart: Date;
  quotaPeriodEnd: Date;
} | null {
  const start = params.currentPeriodStart ?? null;
  if (!start) return null;

  return {
    quotaPeriodStart: start,
    quotaPeriodEnd: addMonths(start, 1),
  };
}

/**
 * Initialize subscription event handlers
 *
 * Call this function during application startup to register all handlers
 */
export function initSubscriptionHandlers() {
  logger.info({ pluginId: PLUGIN_ID }, 'Registering subscription event handlers...');

  // ============================================================================
  // SUBSCRIPTION CREATED
  // ============================================================================

  bus.event.on(BILLING_EVENTS.SUBSCRIPTION_CREATED, PLUGIN_ID, async (payload) => {
    const typedPayload = payload as {
      userId: string;
      data: {
        subscriptionId: string;
        customerId: string;
        planId?: string;
        stripePriceId?: string;
        billingInterval?: BillingInterval;
        status?: string;
        currentPeriodStart?: Date;
        currentPeriodEnd?: Date;
        cancelAtPeriodEnd?: boolean;
        amount?: number;
        currency?: string;
      };
    };

    logger.info(
      {
        eventName: BILLING_EVENTS.SUBSCRIPTION_CREATED,
        pluginId: PLUGIN_ID,
        userId: typedPayload.userId,
        subscriptionId: typedPayload.data?.subscriptionId,
      },
      'Processing subscription.created event'
    );

    try {
      const { userId, data } = typedPayload;

      // STEP 1: Idempotency check - prevent duplicate processing
      if (data.subscriptionId) {
        const existingOrder = await getOrderByProviderId('stripe', data.subscriptionId);
        if (existingOrder) {
          logger.info(
            { userId, subscriptionId: data.subscriptionId, existingOrderId: existingOrder.id },
            'Subscription already processed (idempotency check)'
          );
          return;
        }
      }

      // Resolve planId (prefer explicit planId; fallback to priceId -> plan mapping for portal upgrades)
      let resolvedPlanId = data.planId;
      let resolvedBillingInterval: BillingInterval | undefined = data.billingInterval;

      if (!resolvedPlanId && data.stripePriceId) {
        const mapped = await getPlanForStripePriceId({ stripePriceId: data.stripePriceId });
        if (mapped) {
          resolvedPlanId = mapped.planId;
          resolvedBillingInterval = resolvedBillingInterval || mapped.interval;
        }
      }

      if (!resolvedPlanId) {
        logger.error(
          { userId, subscriptionId: data.subscriptionId, stripePriceId: data.stripePriceId },
          'Cannot process subscription: planId cannot be resolved'
        );
        throw new Error('Missing planId in subscription data');
      }

      // STEP 2: Upgrade user plan (Transaction-protected)
      logger.info(
        { userId, planId: resolvedPlanId, stripePriceId: data.stripePriceId },
        'Upgrading user plan...'
      );

      const entitlement = await upgradeUserPlan(
        userId,
        resolvedPlanId,
        data.subscriptionId,
        data.customerId,
        { operatorId: 'stripe_webhook' }
      );

      // Sync subscription snapshot fields (billing interval + quota window + status)
      const quotaWindow = getInitialQuotaWindow({ currentPeriodStart: data.currentPeriodStart });
      await db
        .update(userEntitlements)
        .set({
          billingInterval: (resolvedBillingInterval || 'monthly') as string,
          cancelAtPeriodEnd: !!data.cancelAtPeriodEnd,
          stripeSubscriptionStatus: data.status ?? null,
          currentPeriodStart: data.currentPeriodStart ?? null,
          currentPeriodEnd: data.currentPeriodEnd ?? null,
          quotaPeriodStart: quotaWindow?.quotaPeriodStart ?? null,
          quotaPeriodEnd: quotaWindow?.quotaPeriodEnd ?? null,
          updatedAt: new Date(),
        })
        .where(eq(userEntitlements.id, entitlement.id));

      logger.info(
        { userId, subscriptionId: data.subscriptionId, planId: resolvedPlanId },
        'User plan upgraded'
      );

      // STEP 3: Create order record for idempotency tracking
      let orderId: string | undefined;
      try {
        const order = await createOrder({
          userId,
          orderType: 'subscription_created',
          provider: 'stripe',
          providerOrderId: data.subscriptionId,
          amount: data.amount?.toString(),
          currency: data.currency || 'USD',
          status: 'succeeded',
          planId: resolvedPlanId,
          metadata: {
            customerId: data.customerId,
            entitlementId: entitlement.id,
            processedAt: new Date().toISOString(),
          },
        });
        orderId = order.id;
        logger.info(
          { userId, orderId, subscriptionId: data.subscriptionId },
          'Order record created'
        );
      } catch (orderError) {
        logger.error(
          { userId, subscriptionId: data.subscriptionId, error: orderError },
          'Failed to create order record (non-critical)'
        );
      }

      // STEP 4: Create credit log for subscription creation
      try {
        const [plan] = await db
          .select()
          .from(entitlementPlans)
          .where(eq(entitlementPlans.id, resolvedPlanId))
          .limit(1);

        if (plan) {
          const interval = resolvedBillingInterval || 'monthly';
          const creditsGranted = readPlanLimitValue(plan.limits, PRIMARY_CREDIT_METRIC, interval) ?? 0;

          if (creditsGranted > 0) {
            await logSubscriptionCreated({
              userId,
              creditsGranted,
              currentBalance: {
                apiCallsRemaining: creditsGranted,
                planName: plan.name,
              },
              planName: plan.name,
              entitlementId: entitlement.id,
              orderId,
            });

            logger.info({ userId, creditsGranted, planName: plan.name }, 'Credit log created');
          }
        }
      } catch (logError) {
        logger.error({ userId, error: logError }, 'Failed to create credit log (non-critical)');
      }

      logger.info(
        { userId, subscriptionId: data.subscriptionId, entitlementId: entitlement.id, orderId },
        'Successfully processed subscription.created event'
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          payload,
        },
        'Failed to handle subscription.created event'
      );
      throw error;
    }
  });

  // ============================================================================
  // SUBSCRIPTION UPDATED
  // ============================================================================

  bus.event.on(BILLING_EVENTS.SUBSCRIPTION_UPDATED, PLUGIN_ID, async (payload: unknown) => {
    try {
      const { userId, data } = payload as {
        userId: string;
        data: {
          subscriptionId: string;
          customerId?: string;
          planId?: string;
          stripePriceId?: string;
          billingInterval?: BillingInterval;
          status?: string;
          currentPeriodStart?: Date;
          currentPeriodEnd?: Date;
          cancelAtPeriodEnd: boolean;
          changes?: Record<string, unknown>;
        };
      };

      logger.info(
        { userId, subscriptionId: data.subscriptionId, cancelAtPeriodEnd: data.cancelAtPeriodEnd },
        'Processing subscription.updated event'
      );

      const existingEntitlement =
        (await db.query.userEntitlements.findFirst({
          where: and(
            eq(userEntitlements.userId, userId),
            eq(userEntitlements.stripeSubscriptionId, data.subscriptionId)
          ),
          with: { plan: true },
        })) || (await getUserEntitlement(userId));

      if (!existingEntitlement) {
        logger.warn(
          { userId, subscriptionId: data.subscriptionId },
          'No entitlement found for subscription.updated'
        );
        return;
      }

      // Resolve plan + interval (supports portal upgrades where subscription metadata stays stale)
      let resolvedPlanId = data.planId;
      let resolvedBillingInterval: BillingInterval | undefined = data.billingInterval;

      if (!resolvedPlanId && data.stripePriceId) {
        const mapped = await getPlanForStripePriceId({ stripePriceId: data.stripePriceId });
        if (mapped) {
          resolvedPlanId = mapped.planId;
          resolvedBillingInterval = resolvedBillingInterval || mapped.interval;
        }
      }

      // Apply plan change if needed
      let entitlementIdToSync = existingEntitlement.id;
      if (resolvedPlanId && existingEntitlement.planId !== resolvedPlanId) {
        const updated = await upgradeUserPlan(
          userId,
          resolvedPlanId,
          data.subscriptionId,
          data.customerId || (existingEntitlement.stripeCustomerId as string | undefined),
          { operatorId: 'stripe_webhook' }
        );
        entitlementIdToSync = updated.id;

        logger.info(
          {
            userId,
            subscriptionId: data.subscriptionId,
            fromPlanId: existingEntitlement.planId,
            toPlanId: resolvedPlanId,
          },
          'Applied plan change from subscription.updated'
        );
      }

      // Mirror cancel_at_period_end (schedule/unschedule cancellation)
      if (data.cancelAtPeriodEnd) {
        try {
          await cancelSubscription(userId, false, {
            operatorId: 'stripe_webhook',
            reason: 'Subscription set to cancel at period end',
          });
          logger.info({ userId, subscriptionId: data.subscriptionId }, 'Scheduled cancellation');
        } catch (cancelError) {
          if (
            cancelError instanceof Error &&
            cancelError.message.includes('No active subscription')
          ) {
            logger.info(
              { userId, subscriptionId: data.subscriptionId },
              'Subscription already cancelled or not found (idempotent)'
            );
          } else {
            throw cancelError;
          }
        }
      } else {
        // Unschedule cancellation (Stripe portal resume)
        await db
          .update(userEntitlements)
          .set({
            cancelledAt: null,
            updatedAt: new Date(),
          })
          .where(eq(userEntitlements.id, entitlementIdToSync));
      }

      // Persist subscription snapshot fields
      const quotaWindow = getInitialQuotaWindow({ currentPeriodStart: data.currentPeriodStart });
      await db
        .update(userEntitlements)
        .set({
          billingInterval: (resolvedBillingInterval ||
            ((existingEntitlement.billingInterval as BillingInterval | undefined) ??
              'monthly')) as string,
          cancelAtPeriodEnd: !!data.cancelAtPeriodEnd,
          stripeSubscriptionStatus: data.status ?? null,
          currentPeriodStart: data.currentPeriodStart ?? null,
          currentPeriodEnd: data.currentPeriodEnd ?? null,
          quotaPeriodStart: quotaWindow?.quotaPeriodStart ?? null,
          quotaPeriodEnd: quotaWindow?.quotaPeriodEnd ?? null,
          updatedAt: new Date(),
        })
        .where(eq(userEntitlements.id, entitlementIdToSync));

      logger.info(
        { userId, subscriptionId: data.subscriptionId },
        'Processed subscription.updated'
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), payload },
        'Failed to handle subscription.updated event'
      );
      throw error;
    }
  });

  // ============================================================================
  // SUBSCRIPTION CANCELLED
  // ============================================================================

  bus.event.on(BILLING_EVENTS.SUBSCRIPTION_CANCELLED, PLUGIN_ID, async (payload: unknown) => {
    try {
      const { userId, data } = payload as {
        userId: string;
        data: {
          subscriptionId: string;
          cancelledAt: Date;
        };
      };

      logger.info(
        { userId, subscriptionId: data.subscriptionId, cancelledAt: data.cancelledAt },
        'Processing subscription.cancelled event'
      );

      // Idempotency: Check if already cancelled
      const entitlement = await getUserEntitlement(userId);
      if (!entitlement || entitlement.status === 'cancelled') {
        logger.info(
          { userId, subscriptionId: data.subscriptionId },
          'Subscription already cancelled (idempotency check)'
        );
        return;
      }

      await cancelSubscription(userId, true, {
        operatorId: 'stripe_webhook',
        reason: 'Subscription cancelled in Stripe',
      });

      // Create cancellation order record for tracking
      try {
        await createOrder({
          userId,
          orderType: 'subscription_cancelled',
          provider: 'stripe',
          providerOrderId: `cancel_${data.subscriptionId}_${Date.now()}`,
          status: 'succeeded',
          metadata: {
            subscriptionId: data.subscriptionId,
            cancelledAt: data.cancelledAt?.toISOString?.() || String(data.cancelledAt),
            processedAt: new Date().toISOString(),
          },
        });
      } catch (orderError) {
        logger.error(
          { userId, error: orderError },
          'Failed to create cancellation order (non-critical)'
        );
      }

      logger.info({ userId, subscriptionId: data.subscriptionId }, 'Subscription cancelled');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), payload },
        'Failed to handle subscription.cancelled event'
      );
      throw error;
    }
  });

  // ============================================================================
  // PLAN CHANGED
  // ============================================================================

  bus.event.on(BILLING_EVENTS.SUBSCRIPTION_PLAN_CHANGED, PLUGIN_ID, async (payload: unknown) => {
    try {
      const { userId, data } = payload as {
        userId: string;
        data: {
          subscriptionId: string;
          fromPlanId: string;
          toPlanId: string;
        };
      };

      logger.info(
        {
          userId,
          subscriptionId: data.subscriptionId,
          fromPlanId: data.fromPlanId,
          toPlanId: data.toPlanId,
        },
        'Processing subscription.plan_changed event'
      );

      // Idempotency: Check if plan is already the target plan
      const entitlement = await getUserEntitlement(userId);
      if (entitlement && entitlement.planId === data.toPlanId) {
        logger.info(
          { userId, currentPlanId: entitlement.planId, toPlanId: data.toPlanId },
          'Plan already changed (idempotency check)'
        );
        return;
      }

      await upgradeUserPlan(userId, data.toPlanId, data.subscriptionId, undefined, {
        operatorId: 'stripe_webhook',
      });

      logger.info(
        {
          userId,
          subscriptionId: data.subscriptionId,
          fromPlan: data.fromPlanId,
          toPlan: data.toPlanId,
        },
        'Plan changed successfully'
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), payload },
        'Failed to handle subscription.plan_changed event'
      );
      throw error;
    }
  });

  // ============================================================================
  // PAYMENT FAILED
  // ============================================================================

  bus.event.on(BILLING_EVENTS.SUBSCRIPTION_PAYMENT_FAILED, PLUGIN_ID, async (payload: unknown) => {
    try {
      const { userId, data } = payload as {
        userId: string;
        data: {
          subscriptionId: string;
          attemptCount: number;
          nextPaymentAttempt?: Date | null;
          invoiceId?: string;
        };
      };

      const isAtRisk = data.attemptCount >= PAYMENT_FAILURE_CONFIG.AT_RISK_THRESHOLD;
      const shouldSuspend = data.attemptCount >= PAYMENT_FAILURE_CONFIG.SUSPENSION_THRESHOLD;

      logger.warn(
        {
          userId,
          subscriptionId: data.subscriptionId,
          attemptCount: data.attemptCount,
          nextPaymentAttempt: data.nextPaymentAttempt,
          isAtRisk,
          shouldSuspend,
        },
        'Subscription payment failed'
      );

      // Update entitlement metadata to track payment failure status
      try {
        const entitlement = await getUserEntitlement(userId);
        if (entitlement) {
          await db
            .update(userEntitlements)
            .set({
              metadata: {
                ...(entitlement.metadata as Record<string, unknown>),
                paymentFailureCount: data.attemptCount,
                lastPaymentFailedAt: new Date().toISOString(),
                isAtRisk,
                nextPaymentAttempt: data.nextPaymentAttempt
                  ? data.nextPaymentAttempt.toISOString()
                  : null,
              },
              updatedAt: new Date(),
            })
            .where(eq(userEntitlements.id, entitlement.id));

          logger.info(
            { userId, entitlementId: entitlement.id, attemptCount: data.attemptCount },
            'Updated entitlement with payment failure info'
          );
        }
      } catch (updateError) {
        logger.error(
          { userId, error: updateError },
          'Failed to update entitlement metadata (non-critical)'
        );
      }

      // Log action taken based on attempt count
      if (shouldSuspend) {
        logger.error(
          { userId, subscriptionId: data.subscriptionId, attemptCount: data.attemptCount },
          'Payment failed multiple times - consider suspending features'
        );
        // Future: Implement feature suspension logic here
      } else if (isAtRisk) {
        logger.warn(
          { userId, subscriptionId: data.subscriptionId, attemptCount: data.attemptCount },
          'Subscription marked as at-risk due to payment failures'
        );
        // Future: Send notification to user
      }

      logger.info({ userId, subscriptionId: data.subscriptionId }, 'Payment failure processed');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), payload },
        'Failed to handle subscription.payment_failed event'
      );
      // Don't throw - payment failures should not crash the webhook handler
    }
  });

  // ============================================================================
  // SUBSCRIPTION RENEWED
  // ============================================================================

  bus.event.on(BILLING_EVENTS.SUBSCRIPTION_RENEWED, PLUGIN_ID, async (payload: unknown) => {
    try {
      const { userId, data } = payload as {
        userId: string;
        data: {
          subscriptionId: string;
          invoiceId: string;
          stripePriceId?: string;
          billingInterval?: BillingInterval;
          amount: number;
          currency?: string;
          invoiceNumber?: string;
          hostedInvoiceUrl?: string;
          invoicePdf?: string;
          periodStart?: Date;
          periodEnd?: Date;
          paidAt?: Date;
        };
      };

      logger.info(
        {
          userId,
          subscriptionId: data.subscriptionId,
          invoiceId: data.invoiceId,
          amount: data.amount,
        },
        'Processing subscription.renewed event'
      );

      // STEP 1: Idempotency check
      if (data.invoiceId) {
        const existingOrder = await getOrderByProviderId('stripe', data.invoiceId);
        if (existingOrder) {
          logger.info(
            { userId, invoiceId: data.invoiceId, existingOrderId: existingOrder.id },
            'Renewal already processed (idempotency check)'
          );
          return;
        }
      }

      // STEP 2: Create order record
      let orderId: string | undefined;
      try {
        const order = await createOrder({
          userId,
          orderType: 'subscription_renewed',
          provider: 'stripe',
          providerOrderId: data.invoiceId,
          amount: data.amount.toString(),
          currency: data.currency || 'USD',
          status: 'succeeded',
          metadata: {
            subscriptionId: data.subscriptionId,
            periodStart: data.periodStart,
            periodEnd: data.periodEnd,
            paidAt: data.paidAt,
            processedAt: new Date().toISOString(),
          },
        });
        orderId = order.id;
        logger.info({ userId, orderId, invoiceId: data.invoiceId }, 'Renewal order created');
      } catch (orderError) {
        logger.error(
          { userId, error: orderError },
          'Failed to create renewal order (non-critical)'
        );
      }

      // STEP 2.5: Mirror Stripe invoice into the generic billing invoice table.
      if (orderId) {
        try {
          await upsertProviderInvoice({
            userId,
            orderId,
            provider: 'stripe',
            providerInvoiceId: data.invoiceId,
            invoiceNumber: data.invoiceNumber || data.invoiceId,
            status: 'paid',
            currency: (data.currency || 'USD').toUpperCase(),
            subtotalAmount: data.amount.toString(),
            taxAmount: '0',
            totalAmount: data.amount.toString(),
            hostedUrl: data.hostedInvoiceUrl,
            pdfUrl: data.invoicePdf,
            paidAt: data.paidAt,
            metadata: {
              subscriptionId: data.subscriptionId,
              stripePriceId: data.stripePriceId,
              billingInterval: data.billingInterval,
              periodStart: data.periodStart,
              periodEnd: data.periodEnd,
            },
          });
        } catch (invoiceError) {
          logger.error(
            { userId, invoiceId: data.invoiceId, error: invoiceError },
            'Failed to upsert renewal invoice (non-critical)'
          );
        }
      }

      // STEP 3: Clear any payment failure flags and (monthly-billed only) reset credits
      try {
        const userEntitlement = await db.query.userEntitlements.findFirst({
          where: eq(userEntitlements.userId, userId),
          with: { plan: true },
        });

        if (userEntitlement && userEntitlement.plan) {
          // Clear payment failure metadata
          const currentMetadata = (userEntitlement.metadata as Record<string, unknown>) || {};
          await db
            .update(userEntitlements)
            .set({
              metadata: {
                ...currentMetadata,
                paymentFailureCount: 0,
                isAtRisk: false,
                lastPaymentFailedAt: null,
                nextPaymentAttempt: null,
              },
              currentPeriodStart: data.periodStart ?? null,
              currentPeriodEnd: data.periodEnd ?? null,
              updatedAt: new Date(),
            })
            .where(eq(userEntitlements.id, userEntitlement.id));

          // Log credit reset
          const interval =
            data.billingInterval ||
            ((userEntitlement.billingInterval as BillingInterval | undefined) ?? 'monthly');

          if (interval !== 'monthly') {
            logger.info(
              { userId, invoiceId: data.invoiceId, interval },
              'Skipping credit reset for non-monthly billing interval'
            );
          } else {
            const resetAmount =
              readPlanLimitValue(userEntitlement.plan.limits, PRIMARY_CREDIT_METRIC, 'monthly') ?? 0;

            if (resetAmount > 0) {
              await logMonthlyReset({
                userId,
                resetAmount,
                currentBalance: {
                  apiCallsRemaining: resetAmount,
                  planName: userEntitlement.plan.name,
                },
                entitlementId: userEntitlement.id,
                orderId,
              });

              logger.info(
                { userId, resetAmount, planName: userEntitlement.plan.name },
                'Credits reset'
              );
            }
          }
        }
      } catch (logError) {
        logger.error({ userId, error: logError }, 'Failed to reset credits (non-critical)');
      }

      logger.info({ userId, subscriptionId: data.subscriptionId, orderId }, 'Renewal processed');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), payload },
        'Failed to handle subscription.renewed event'
      );
      // Don't throw - renewal failures should not crash the webhook handler
    }
  });

  // ============================================================================
  // ONE-OFF INVOICE PAID
  // ============================================================================

  bus.event.on(BILLING_EVENTS.INVOICE_PAID, PLUGIN_ID, async (payload: unknown) => {
    try {
      const { userId, data } = payload as {
        userId: string;
        data: {
          invoiceId: string;
          invoiceNumber?: string;
          amount: number;
          currency?: string;
          hostedInvoiceUrl?: string;
          invoicePdf?: string;
          paidAt?: Date;
          metadata?: Record<string, unknown>;
        };
      };

      logger.info(
        { userId, invoiceId: data.invoiceId, amount: data.amount },
        'Processing invoice.paid event'
      );

      const existingOrder = await getOrderByProviderId('stripe', data.invoiceId);
      if (existingOrder) {
        logger.info(
          { userId, invoiceId: data.invoiceId, existingOrderId: existingOrder.id },
          'Invoice already processed (idempotency check)'
        );
        return;
      }

      const order = await createOrder({
        userId,
        orderType: 'one_time_purchase',
        provider: 'stripe',
        providerOrderId: data.invoiceId,
        amount: data.amount.toString(),
        currency: data.currency || 'USD',
        status: 'succeeded',
        metadata: {
          invoiceNumber: data.invoiceNumber,
          paidAt: data.paidAt,
          ...(data.metadata || {}),
        },
      });

      await upsertProviderInvoice({
        userId,
        orderId: order.id,
        provider: 'stripe',
        providerInvoiceId: data.invoiceId,
        invoiceNumber: data.invoiceNumber || data.invoiceId,
        status: 'paid',
        currency: (data.currency || 'USD').toUpperCase(),
        subtotalAmount: data.amount.toString(),
        taxAmount: '0',
        totalAmount: data.amount.toString(),
        hostedUrl: data.hostedInvoiceUrl,
        pdfUrl: data.invoicePdf,
        paidAt: data.paidAt,
        metadata: data.metadata || {},
      });

      logger.info({ userId, orderId: order.id, invoiceId: data.invoiceId }, 'Invoice processed');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), payload },
        'Failed to handle invoice.paid event'
      );
      throw error;
    }
  });

  // ============================================================================
  // ORDER REFUNDED
  // ============================================================================

  bus.event.on(BILLING_EVENTS.ORDER_REFUNDED, PLUGIN_ID, async (payload: unknown) => {
    try {
      const { userId, data } = payload as {
        userId: string;
        data: {
          orderId: string;
          chargeId: string;
          refundedAmount: number;
          totalAmount: number;
          currency: string;
          refunds?: Array<{
            id: string;
            amount: number;
            reason?: string;
            status: string;
          }>;
        };
      };

      logger.info(
        { userId, orderId: data.orderId, refundedAmount: data.refundedAmount },
        'Processing order.refunded event'
      );

      // STEP 1: Find original order
      const originalOrder = await getOrderByProviderId('stripe', data.orderId);
      if (!originalOrder) {
        logger.warn(
          { userId, orderId: data.orderId },
          'Original order not found for refund - skipping'
        );
        return;
      }

      // STEP 2: Idempotency check for refund
      const refundId = data.refunds?.[0]?.id || `refund_${data.chargeId}_${Date.now()}`;
      const existingRefund = await getOrderByProviderId('stripe', refundId);
      if (existingRefund) {
        logger.info({ userId, refundId }, 'Refund already processed (idempotency check)');
        return;
      }

      // STEP 3: Create refund order record
      const refundOrder = await createRefundOrder({
        userId,
        providerOrderId: refundId,
        amount: data.refundedAmount,
        currency: data.currency,
        originalOrderId: originalOrder.id,
        planId: originalOrder.planId || undefined,
        metadata: {
          chargeId: data.chargeId,
          reason: data.refunds?.[0]?.reason,
          processedAt: new Date().toISOString(),
        },
      });

      try {
        await updateOrderStatus(
          originalOrder.id,
          data.refundedAmount < data.totalAmount ? 'partially_refunded' : 'refunded'
        );
        await markInvoicesForOrderStatus(
          originalOrder.id,
          data.refundedAmount < data.totalAmount ? 'paid' : 'refunded',
          {
            refundOrderId: refundOrder.id,
            refundedAmount: data.refundedAmount,
            refundProcessedAt: new Date().toISOString(),
          }
        );
      } catch (statusError) {
        logger.error(
          { userId, orderId: originalOrder.id, error: statusError },
          'Failed to mirror refund status to order/invoice (non-critical)'
        );
      }

      logger.info({ userId, refundOrderId: refundOrder.id }, 'Refund order created');

      // STEP 4: Revoke credits if applicable
      if (originalOrder.planId) {
        try {
          const [plan] = await db
            .select()
            .from(entitlementPlans)
            .where(eq(entitlementPlans.id, originalOrder.planId))
            .limit(1);

          if (plan) {
            const creditsToRevoke =
              readPlanLimitValue(plan.limits, PRIMARY_CREDIT_METRIC, 'monthly') ?? 0;

            if (creditsToRevoke > 0) {
              await logRefundRevoke({
                userId,
                creditsRevoked: creditsToRevoke,
                currentBalance: {
                  apiCallsRemaining: 0,
                  refundedAt: new Date().toISOString(),
                },
                refundOrderId: refundOrder.id,
              });

              logger.info(
                { userId, creditsRevoked: creditsToRevoke },
                'Credits revoked due to refund'
              );
            }
          }
        } catch (creditError) {
          logger.error({ userId, error: creditError }, 'Failed to revoke credits (non-critical)');
        }
      }

      logger.info({ userId, refundOrderId: refundOrder.id }, 'Refund processed successfully');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), payload },
        'Failed to handle order.refunded event'
      );
      throw error;
    }
  });

  // ============================================================================
  // REGISTRATION COMPLETE
  // ============================================================================

  logger.info(
    {
      pluginId: PLUGIN_ID,
      handlers: [
        BILLING_EVENTS.SUBSCRIPTION_CREATED,
        BILLING_EVENTS.SUBSCRIPTION_UPDATED,
        BILLING_EVENTS.SUBSCRIPTION_CANCELLED,
        BILLING_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
        BILLING_EVENTS.SUBSCRIPTION_PAYMENT_FAILED,
        BILLING_EVENTS.SUBSCRIPTION_RENEWED,
        BILLING_EVENTS.INVOICE_PAID,
        BILLING_EVENTS.ORDER_REFUNDED,
      ],
    },
    'All subscription event handlers registered'
  );
}
