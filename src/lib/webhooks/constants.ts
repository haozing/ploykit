/**
 * Webhook System Constants
 *
 * Centralized constants for the webhook processing system
 */

/**
 * Plugin IDs for event bus registration
 */
export const WEBHOOK_PLUGIN_IDS = {
  STRIPE: 'stripe-webhook',
  PAYPAL: 'paypal-webhook',
  CUSTOM: 'custom-webhook',
} as const;

/**
 * Internal event names for billing events
 */
export const BILLING_EVENTS = {
  // Payment events
  PAYMENT_SUCCEEDED: 'billing.payment.succeeded',
  PAYMENT_FAILED: 'billing.payment.failed',

  // Subscription events
  SUBSCRIPTION_CREATED: 'billing.subscription.created',
  SUBSCRIPTION_UPDATED: 'billing.subscription.updated',
  SUBSCRIPTION_CANCELLED: 'billing.subscription.cancelled',
  SUBSCRIPTION_PLAN_CHANGED: 'billing.subscription.plan_changed',
  SUBSCRIPTION_PAYMENT_FAILED: 'billing.subscription.payment_failed',
  SUBSCRIPTION_RENEWED: 'billing.subscription.renewed',

  // Invoice events
  INVOICE_PAID: 'billing.invoice.paid',

  // Order events
  ORDER_REFUNDED: 'billing.order.refunded',
} as const;

/**
 * Webhook log retention settings
 */
export const WEBHOOK_LOG_CONFIG = {
  /** Default retention period in days */
  DEFAULT_RETENTION_DAYS: 90,
  /** Maximum retention period in days */
  MAX_RETENTION_DAYS: 365,
} as const;

/**
 * Payment failure thresholds
 */
export const PAYMENT_FAILURE_CONFIG = {
  /** Number of failed attempts before marking subscription as at-risk */
  AT_RISK_THRESHOLD: 2,
  /** Number of failed attempts before suspending features */
  SUSPENSION_THRESHOLD: 4,
} as const;

export type WebhookPluginId = (typeof WEBHOOK_PLUGIN_IDS)[keyof typeof WEBHOOK_PLUGIN_IDS];
export type BillingEventName = (typeof BILLING_EVENTS)[keyof typeof BILLING_EVENTS];
