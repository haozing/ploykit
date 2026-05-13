/**
 * Webhook Initialization
 *
 * - Register Webhook adapter
 * - ConfigurationEnvironmentVariable
 */

import { webhookHandler } from './webhook-handler';
import { StripeWebhookAdapter } from './providers/stripe-adapter';
import { logger } from '@/lib/_core/logger';
import { env } from '@/lib/_core/env';

/**
 *
 */
export function initializeWebhooks() {
  logger.info('Initializing webhook system...');

  // Stripe Webhook

  const stripeApiKey = env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET;

  if (stripeApiKey && stripeWebhookSecret) {
    const stripeAdapter = new StripeWebhookAdapter({
      apiKey: stripeApiKey,
      webhookSecret: stripeWebhookSecret,
    });

    webhookHandler.register('stripe', stripeAdapter);

    logger.info('Stripe webhook adapter registered');
  } else {
    logger.warn(
      '  Stripe webhook not configured (missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET)'
    );
  }

  const registeredProviders = webhookHandler.listProviders();

  logger.info(
    { providers: registeredProviders },
    `Webhook system initialized with ${registeredProviders.length} provider(s)`
  );
}

/**
 *
 */
export function checkWebhookConfiguration() {
  return {
    stripe: {
      configured: !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
      registered: webhookHandler.hasProvider('stripe'),
      missing: !env.STRIPE_SECRET_KEY
        ? ['STRIPE_SECRET_KEY']
        : !env.STRIPE_WEBHOOK_SECRET
          ? ['STRIPE_WEBHOOK_SECRET']
          : [],
    },
  };
}
