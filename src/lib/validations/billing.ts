/**
 * Billing and Checkout Validation Schemas
 *
 * Schemas for payment, checkout, and billing-related endpoints
 */

import { z } from 'zod';
import { commonSchemas } from './common';

/**
 * Checkout Session Creation Schema
 *
 * For POST /api/checkout/create
 * Creates a Stripe Checkout Session for platform subscription
 */
export const createCheckoutSchema = z.object({
  planId: commonSchemas.uuid.describe('Plan ID to subscribe to'),
  billingPeriod: z
    .enum(['monthly', 'yearly'], {
      errorMap: () => ({ message: 'Billing period must be either monthly or yearly' }),
    })
    .describe('Billing period for the subscription'),
  lang: z.enum(['en', 'zh']).optional().describe('UI language for success/cancel redirects'),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

/**
 * Billing Portal Session Schema
 *
 * For POST /api/billing/portal
 * Creates a Stripe Customer Portal session
 */
export const createPortalSessionSchema = z.object({
  returnUrl: commonSchemas.url.optional().describe('URL to return to after portal session'),
});

export type CreatePortalSessionInput = z.infer<typeof createPortalSessionSchema>;
