/**
 * Stripe Client - Lazy initialization
 *
 * Client is created on first access, not at import time.
 * This allows the module to be imported during build without requiring STRIPE_SECRET_KEY.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

/**
 * Get the Stripe client instance.
 * Lazily initializes on first call to avoid build-time errors.
 *
 * @throws Error if STRIPE_SECRET_KEY is not configured
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = new Stripe(secretKey, {
      apiVersion: '2026-04-22.dahlia',
      typescript: true,
      appInfo: {
        name: 'PloyKit',
        version: '1.0.0',
      },
    });
  }
  return _stripe;
}
