/**
 * Stripe Webhook Adapter
 *
 * Process Stripe Webhook Event)
 */

import Stripe from 'stripe';
import { logger } from '@/lib/_core/logger';
import type { WebhookAdapter, WebhookProvider, InternalEvent } from '../types';

type BillingInterval = 'monthly' | 'yearly';

function toBillingInterval(interval: string | null | undefined): BillingInterval | null {
  if (interval === 'month') return 'monthly';
  if (interval === 'year') return 'yearly';
  return null;
}

function getSubscriptionStripePriceId(subscription: Stripe.Subscription): string | null {
  const price = subscription.items?.data?.[0]?.price as Stripe.Price | undefined;
  return price?.id || null;
}

function getSubscriptionBillingInterval(subscription: Stripe.Subscription): BillingInterval | null {
  const price = subscription.items?.data?.[0]?.price as Stripe.Price | undefined;
  return toBillingInterval(price?.recurring?.interval);
}

function getInvoiceStripePriceId(invoice: Stripe.Invoice): string | null {
  const price = invoice.lines?.data?.[0]?.price as Stripe.Price | undefined;
  return price?.id || null;
}

function getInvoiceBillingInterval(invoice: Stripe.Invoice): BillingInterval | null {
  const price = invoice.lines?.data?.[0]?.price as Stripe.Price | undefined;
  return toBillingInterval(price?.recurring?.interval);
}

/**
 * Stripe Webhook Adapter
 */
export class StripeWebhookAdapter implements WebhookAdapter {
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(options: { apiKey: string; webhookSecret: string; apiVersion?: string }) {
    this.stripe = new Stripe(options.apiKey, {
      apiVersion: (options.apiVersion as Stripe.LatestApiVersion) || '2024-11-20.acacia',
      typescript: true,
    });

    this.webhookSecret = options.webhookSecret;

    logger.info('StripeWebhookAdapter initialized');
  }

  /**
   * GetProvider name
   */
  getProvider(): WebhookProvider {
    return 'stripe';
  }

  /**
   *
   * @param signature - stripe-signature Outside
   */
  async verify(payload: string, signature: string, secret?: string): Promise<Stripe.Event> {
    const webhookSecret = secret || this.webhookSecret;

    if (!webhookSecret) {
      throw new Error('Stripe webhook secret not configured');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);

      logger.debug(
        { eventType: event.type, eventId: event.id },
        'Stripe webhook signature verified'
      );

      return event;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Stripe webhook signature verification failed'
      );

      throw new Error(
        `Stripe webhook signature verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   *
   * @param event - Stripe Event Object
   */
  async transform(event: unknown): Promise<InternalEvent[]> {
    const stripeEvent = event as Stripe.Event;
    const events: InternalEvent[] = [];

    logger.debug(
      { eventType: stripeEvent.type, eventId: stripeEvent.id },
      'Transforming Stripe event'
    );

    switch (stripeEvent.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = stripeEvent.data.object;
        const userId = paymentIntent.metadata?.userId;
        const orderId = paymentIntent.metadata?.orderId;

        if (!userId || !orderId) {
          logger.warn(
            { paymentIntentId: paymentIntent.id },
            'PaymentIntent missing userId or orderId in metadata'
          );
          break;
        }

        events.push({
          eventName: 'billing.payment.succeeded',
          userId,
          data: {
            orderId,
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount / 100, // Convert from cents
            currency: paymentIntent.currency,
            paymentMethod: paymentIntent.payment_method,
            status: paymentIntent.status,
            metadata: paymentIntent.metadata,
          },
        });

        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = stripeEvent.data.object;

        const userId = paymentIntent.metadata?.userId;
        const orderId = paymentIntent.metadata?.orderId;

        if (!userId || !orderId) {
          logger.warn(
            { paymentIntentId: paymentIntent.id },
            'PaymentIntent missing userId or orderId in metadata'
          );
          break;
        }

        events.push({
          eventName: 'billing.payment.failed',
          userId,
          data: {
            orderId,
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            errorMessage: paymentIntent.last_payment_error?.message,
            errorCode: paymentIntent.last_payment_error?.code,
            metadata: paymentIntent.metadata,
          },
        });

        break;
      }

      case 'customer.subscription.created': {
        const subscription = stripeEvent.data.object;

        const userId = subscription.metadata?.userId;
        const planId = subscription.metadata?.planId;
        const stripePriceId = getSubscriptionStripePriceId(subscription);
        const billingInterval = getSubscriptionBillingInterval(subscription);

        logger.info(
          {
            subscriptionId: subscription.id,
            userId,
            planId,
            hasuserId: !!userId,
            hasPlanId: !!planId,
            allMetadata: subscription.metadata,
          },
          'Stripe subscription.created event received'
        );

        if (!userId) {
          logger.warn(
            { subscriptionId: subscription.id, metadata: subscription.metadata },
            '  Subscription missing userId in metadata'
          );
          break;
        }

        if (!planId && !stripePriceId) {
          logger.error(
            {
              subscriptionId: subscription.id,
              userId,
              metadata: subscription.metadata,
            },
            'Subscription missing planId in metadata - cannot upgrade user plan'
          );
          break;
        }

        logger.info(
          { userId, planId, subscriptionId: subscription.id },
          'Publishing billing.subscription.created event'
        );

        events.push({
          eventName: 'billing.subscription.created',
          userId,
          data: {
            subscriptionId: subscription.id,
            customerId: subscription.customer as string,
            status: subscription.status,
            planId: planId || undefined,
            stripePriceId: stripePriceId || undefined,
            billingInterval: billingInterval || undefined,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            metadata: subscription.metadata,
          },
        });

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const previousAttributes = stripeEvent.data
          .previous_attributes as Partial<Stripe.Subscription>;

        const userId = subscription.metadata?.userId;
        const stripePriceId = getSubscriptionStripePriceId(subscription);
        const billingInterval = getSubscriptionBillingInterval(subscription);

        if (!userId) {
          logger.warn(
            { subscriptionId: subscription.id },
            'Subscription missing userId in metadata'
          );
          break;
        }

        const previousPlanId = previousAttributes?.metadata?.planId;
        const currentPlanId = subscription.metadata?.planId;

        if (previousPlanId && currentPlanId && previousPlanId !== currentPlanId) {
          events.push({
            eventName: 'billing.subscription.plan_changed',
            userId,
            data: {
              subscriptionId: subscription.id,
              fromPlanId: previousPlanId,
              toPlanId: currentPlanId,
              stripePriceId: stripePriceId || undefined,
              billingInterval: billingInterval || undefined,
              effectiveDate: new Date(subscription.current_period_start * 1000),
              metadata: subscription.metadata,
            },
          });
        } else {
          events.push({
            eventName: 'billing.subscription.updated',
            userId,
            data: {
              subscriptionId: subscription.id,
              customerId: subscription.customer as string,
              status: subscription.status,
              stripePriceId: stripePriceId || undefined,
              billingInterval: billingInterval || undefined,
              currentPeriodStart: new Date(subscription.current_period_start * 1000),
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              changes: previousAttributes,
              metadata: subscription.metadata,
            },
          });
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;

        const userId = subscription.metadata?.userId;

        if (!userId) {
          logger.warn(
            { subscriptionId: subscription.id },
            'Subscription missing userId in metadata'
          );
          break;
        }

        events.push({
          eventName: 'billing.subscription.cancelled',
          userId,
          data: {
            subscriptionId: subscription.id,
            cancelledAt: new Date(subscription.canceled_at! * 1000),
            endedAt: new Date(subscription.ended_at! * 1000),
            status: subscription.status,
            metadata: subscription.metadata,
          },
        });

        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object;

        const userId = invoice.metadata?.userId || invoice.subscription_details?.metadata?.userId;
        const stripePriceId = getInvoiceStripePriceId(invoice);
        const billingInterval = getInvoiceBillingInterval(invoice);
        const invoiceNumber = invoice.number || invoice.id;
        const hostedInvoiceUrl = invoice.hosted_invoice_url || undefined;
        const invoicePdf = invoice.invoice_pdf || undefined;

        if (!userId) {
          logger.warn({ invoiceId: invoice.id }, 'Invoice missing userId in metadata');
          break;
        }

        if (invoice.subscription) {
          events.push({
            eventName: 'billing.subscription.renewed',
            userId,
            data: {
              subscriptionId: invoice.subscription as string,
              invoiceId: invoice.id,
              stripePriceId: stripePriceId || undefined,
              billingInterval: billingInterval || undefined,
              amount: invoice.amount_paid / 100,
              currency: invoice.currency,
              invoiceNumber,
              hostedInvoiceUrl,
              invoicePdf,
              periodStart: new Date(invoice.period_start * 1000),
              periodEnd: new Date(invoice.period_end * 1000),
              paidAt: new Date(invoice.status_transitions.paid_at! * 1000),
              metadata: invoice.metadata,
            },
          });
        } else {
          events.push({
            eventName: 'billing.invoice.paid',
            userId,
            data: {
              invoiceId: invoice.id,
              invoiceNumber,
              amount: invoice.amount_paid / 100,
              currency: invoice.currency,
              hostedInvoiceUrl,
              invoicePdf,
              paidAt: new Date(invoice.status_transitions.paid_at! * 1000),
              metadata: invoice.metadata,
            },
          });
        }

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;

        const userId = invoice.metadata?.userId || invoice.subscription_details?.metadata?.userId;
        const stripePriceId = getInvoiceStripePriceId(invoice);
        const billingInterval = getInvoiceBillingInterval(invoice);

        if (!userId) {
          logger.warn({ invoiceId: invoice.id }, 'Invoice missing userId in metadata');
          break;
        }

        events.push({
          eventName: 'billing.subscription.payment_failed',
          userId,
          data: {
            subscriptionId: invoice.subscription as string,
            invoiceId: invoice.id,
            stripePriceId: stripePriceId || undefined,
            billingInterval: billingInterval || undefined,
            amount: invoice.amount_due / 100,
            currency: invoice.currency,
            attemptCount: invoice.attempt_count,
            nextPaymentAttempt: invoice.next_payment_attempt
              ? new Date(invoice.next_payment_attempt * 1000)
              : null,
            metadata: invoice.metadata,
          },
        });

        break;
      }

      case 'charge.refunded': {
        const charge = stripeEvent.data.object;

        const userId = charge.metadata?.userId;
        const orderId = charge.metadata?.orderId;

        if (!userId || !orderId) {
          logger.warn({ chargeId: charge.id }, 'Charge missing userId or orderId in metadata');
          break;
        }

        events.push({
          eventName: 'billing.order.refunded',
          userId,
          data: {
            orderId,
            chargeId: charge.id,
            refundedAmount: charge.amount_refunded / 100,
            totalAmount: charge.amount / 100,
            currency: charge.currency,
            refunds: charge.refunds?.data.map((refund) => ({
              id: refund.id,
              amount: refund.amount / 100,
              reason: refund.reason,
              status: refund.status,
            })),
            metadata: charge.metadata,
          },
        });

        break;
      }

      // Type

      default:
        logger.debug({ eventType: stripeEvent.type }, 'Stripe event type not handled, skipping');
    }

    logger.info(
      { eventType: stripeEvent.type, internalEventCount: events.length },
      'Stripe event transformed'
    );

    return events;
  }
}
