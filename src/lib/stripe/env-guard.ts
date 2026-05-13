/**
 * Stripe Environment Guard
 *
 * Prevents environment mismatch between Stripe keys and pricing plan configurations.
 *
 * Critical for preventing disasters like:
 * - Production app using test price IDs
 * - Test environment charging real money
 * - Mixed test/live data in database
 */

import { env } from '@/lib/_core/env';
import { logger } from '@/lib/_core/logger';

// ============================================================================
// TYPES
// ============================================================================

export type StripeEnvironment = 'test' | 'live';

// ============================================================================
// ENVIRONMENT DETECTION
// ============================================================================

/**
 * Detect current Stripe environment from API keys
 *
 * @returns 'test' if using test keys, 'live' if using production keys
 * @throws Error if STRIPE_SECRET_KEY is not configured
 */
export function getCurrentStripeEnv(): StripeEnvironment {
  // eslint-disable-next-line no-restricted-syntax
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    // In development, allow the app to boot without Stripe configured.
    // Stripe-specific actions (checkout/portal/webhooks) will still fail, but plan listing UI should work.
    if (env.NODE_ENV !== 'production') {
      logger.warn('STRIPE_SECRET_KEY not configured; defaulting Stripe environment to test');
      return 'test';
    }

    throw new Error('STRIPE_SECRET_KEY not configured. Please check your environment variables.');
  }

  return secretKey.startsWith('sk_test_') ? 'test' : 'live';
}

/**
 * Check if currently running in Stripe test mode
 */
export function isTestMode(): boolean {
  return getCurrentStripeEnv() === 'test';
}

/**
 * Check if currently running in Stripe live mode
 */
export function isLiveMode(): boolean {
  return getCurrentStripeEnv() === 'live';
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate Stripe price ID environment using Stripe API
 *
 * @param priceId - Stripe price ID to validate
 * @throws Error if price environment doesn't match current environment
 */
export async function validateStripePriceEnvironment(priceId: string): Promise<void> {
  const { getStripe } = await import('./client');
  const stripe = getStripe();
  const currentEnv = getCurrentStripeEnv();

  try {
    const price = await stripe.prices.retrieve(priceId);
    const expectedLive = currentEnv === 'live';

    if (price.livemode !== expectedLive) {
      throw new Error(
        `Stripe price environment mismatch! ` +
          `Price ID: ${priceId}, ` +
          `Expected: ${expectedLive ? 'live' : 'test'}, ` +
          `Got: ${price.livemode ? 'live' : 'test'}`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('environment mismatch')) {
      throw error;
    }
    throw new Error(
      `Failed to validate price ${priceId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get environment info for logging/debugging
 */
export function getEnvironmentInfo() {
  const currentEnv = getCurrentStripeEnv();
  // eslint-disable-next-line no-restricted-syntax
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  // eslint-disable-next-line no-restricted-syntax
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

  return {
    environment: currentEnv,
    isTest: currentEnv === 'test',
    secretKeyPrefix: secretKey.substring(0, 15) + '...',
    publishableKeyPrefix: publishableKey.substring(0, 15) + '...',
    // eslint-disable-next-line no-restricted-syntax
    nodeEnv: process.env.NODE_ENV,
  };
}
