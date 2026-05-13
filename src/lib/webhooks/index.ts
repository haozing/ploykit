/**
 * Webhook System
 *
 * Provides webhook processing for external payment providers
 */

// Core exports
export { WebhookHandler, webhookHandler } from './webhook-handler';
export { StripeWebhookAdapter } from './providers/stripe-adapter';
export { initializeWebhooks, checkWebhookConfiguration } from './init';

// Handler exports
export { initSubscriptionHandlers } from './handlers/subscription-handler';

// Constants
export {
  WEBHOOK_PLUGIN_IDS,
  BILLING_EVENTS,
  WEBHOOK_LOG_CONFIG,
  PAYMENT_FAILURE_CONFIG,
} from './constants';

// Logger exports (for maintenance tasks)
export {
  createWebhookLog,
  getWebhookLogByEventId,
  getWebhookRetryHistory,
  updateWebhookLog,
  getWebhookLog,
  isWebhookProcessed,
  cleanupWebhookLogs,
} from './webhook-logger';

export {
  DEFAULT_WEBHOOK_MAX_ATTEMPTS,
  DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS,
  isWebhookReceiptProcessingStale,
  listRetryableWebhookReceipts,
  processWebhookReceipt,
  retryPendingWebhookReceipts,
} from './webhook-receipt-worker';
export type {
  ProcessWebhookReceiptOptions,
  ProcessWebhookReceiptResult,
  WebhookReceiptRecord,
  WebhookReceiptWorkerDependencies,
} from './webhook-receipt-worker';

// Types
export type {
  WebhookProvider,
  WebhookStatus,
  ExternalWebhookEvent,
  InternalEvent,
  WebhookAdapter,
  WebhookLog,
  WebhookProcessOptions,
  WebhookProcessResult,
} from './types';

export type { WebhookPluginId, BillingEventName } from './constants';
