/**
 * Webhook Types
 *
 * Type definitions for the webhook processing system
 */

import type { EventMetadata } from '@/lib/bus/transports/types';

/**
 * Supported webhook providers
 */
export type WebhookProvider = 'stripe' | 'paypal' | 'github' | 'custom';

/**
 * Webhook processing status
 */
export type WebhookStatus = 'received' | 'processing' | 'processed' | 'failed' | 'dead_letter';

/**
 * External webhook event from provider
 */
export interface ExternalWebhookEvent {
  /** Provider name */
  provider: WebhookProvider;

  /** Original event object from provider */
  event: unknown;

  /** Raw request payload string */
  rawPayload?: string;

  /** Request headers */
  headers?: Record<string, string>;
}

/**
 * Internal event after transformation
 */
export interface InternalEvent {
  /** Internal event name (e.g., 'billing.payment.succeeded') */
  eventName: string;

  /** User ID (user-level architecture) */
  userId: string;

  /** Event data payload */
  data: Record<string, unknown>;

  /** Optional event metadata */
  metadata?: Partial<EventMetadata>;
}

/**
 * Webhook Adapter Interface
 *
 * Implement this interface to add support for new webhook providers
 */
export interface WebhookAdapter {
  /**
   * Verify webhook signature
   */
  verify(payload: string, signature: string, secret?: string): Promise<unknown>;

  /**
   * Transform external event to internal events
   */
  transform(event: unknown): Promise<InternalEvent[]>;

  /**
   * Get provider name
   */
  getProvider(): WebhookProvider;
}

/**
 * Webhook log record
 */
export interface WebhookLog {
  id: string;
  provider: WebhookProvider;
  eventType: string;
  payload: Record<string, unknown>;
  signature: string | null;
  status: WebhookStatus;
  internalEvents: string[];
  error: string | null;
  processingTime: number | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

/**
 * Webhook processing options
 */
export interface WebhookProcessOptions {
  /** Whether to record logs (default: true) */
  log?: boolean;
}

/**
 * Webhook processing result
 */
export interface WebhookProcessResult {
  /** Whether processing succeeded */
  success: boolean;

  /** List of internal events processed */
  events: string[];

  /** Log ID (if logging is enabled) */
  logId?: string;

  /** Error message (if failed) */
  error?: string;

  /** Processing time in milliseconds */
  processingTime: number;
}
