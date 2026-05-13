/**
 * Webhook Handler
 *
 * - Verify Webhook signature
 * - Publish to internal event bus
 */

import { logger } from '@/lib/_core/logger';
import { bus } from '@/lib/bus';
import { createWebhookLog, isWebhookProcessed } from './webhook-logger';
import type {
  WebhookAdapter,
  WebhookProvider,
  ExternalWebhookEvent,
  InternalEvent,
  WebhookProcessOptions,
  WebhookProcessResult,
} from './types';

/**
 * Webhook Handler class
 */
export class WebhookHandler {
  /** Registered adapters*/
  private adapters = new Map<WebhookProvider, WebhookAdapter>();

  /**
   * Register Webhook adapter
   *
   * @param provider - Provider name
   * @param adapter - Adapter instance
   *
   * @example
   * ```typescript
   * webhookHandler.register('stripe', new StripeWebhookAdapter(secret));
   * ```
   */
  register(provider: WebhookProvider, adapter: WebhookAdapter): void {
    if (this.adapters.has(provider)) {
      logger.warn({ provider }, 'Webhook adapter already registered, overwriting');
    }

    this.adapters.set(provider, adapter);

    logger.info({ provider }, 'Webhook adapter registered');
  }

  /**
   * Unregister adapter
   *
   * @param provider - Provider name
   */
  unregister(provider: WebhookProvider): void {
    this.adapters.delete(provider);
    logger.info({ provider }, 'Webhook adapter unregistered');
  }

  /**
   *
   * @param provider - Provider name
   */
  hasProvider(provider: WebhookProvider): boolean {
    return this.adapters.has(provider);
  }

  /**
   * Get list of registered providers
   *
   * @returns Array of provider names
   */
  listProviders(): WebhookProvider[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Verify Webhook signature
   *
   * @param provider - Provider name
   *
   * @example
   * ```typescript
   * const event = await webhookHandler.verify('stripe', payload, signature);
   * ```
   */
  async verify(
    provider: WebhookProvider,
    payload: string,
    signature: string,
    secret?: string
  ): Promise<unknown> {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`Webhook provider not registered: ${provider}`);
    }

    logger.debug({ provider }, 'Verifying webhook signature');

    try {
      const event = await adapter.verify(payload, signature, secret);

      logger.info({ provider }, 'Webhook signature verified');

      return event;
    } catch (error) {
      logger.error(
        { provider, error: error instanceof Error ? error.message : String(error) },
        'Webhook signature verification failed'
      );

      throw error;
    }
  }

  /**
   * Process Webhook event
   *
   * Core flow:
   * 2. Log (optional)
   * 3. Publish to event bus
   *
   * @param externalEvent - External Webhook event
   * @param options - Processing options
   * @returns Processing result
   *
   * @example
   * ```typescript
   * const result = await webhookHandler.process({
   *   provider: 'stripe',
   *   event: stripeEvent,
   * });
   * ```
   */
  async process(
    externalEvent: ExternalWebhookEvent,
    options: WebhookProcessOptions = {}
  ): Promise<WebhookProcessResult> {
    const { provider, event } = externalEvent;
    const { log = true } = options;

    const startTime = Date.now();

    logger.info({ provider }, 'Processing webhook event');

    try {
      // 1. Get adapter
      const adapter = this.adapters.get(provider);

      if (!adapter) {
        throw new Error(`Webhook provider not registered: ${provider}`);
      }

      // 1.5 Idempotency (provider event ID) - avoid re-publishing already processed events
      const eventObj = event as Record<string, unknown>;
      const eventId = typeof eventObj?.id === 'string' ? eventObj.id : undefined;
      if (eventId) {
        const alreadyProcessed = await isWebhookProcessed(provider, eventId);
        if (alreadyProcessed) {
          const processingTime = Date.now() - startTime;
          logger.info(
            { provider, eventId, processingTime },
            'Webhook event already processed, skipping'
          );
          return { success: true, events: [], processingTime };
        }
      }

      const internalEvents = await adapter.transform(event);

      logger.debug(
        { provider, eventCount: internalEvents.length },
        'Webhook transformed to internal events'
      );

      // 3. Publish to event bus
      const publishedEvents: string[] = [];

      for (const internalEvent of internalEvents) {
        const { eventName, userId, data } = internalEvent;

        // ?Construct complete payload (including userId and data)
        const payload = {
          userId,
          data,
        };

        logger.info(
          {
            eventName,
            userId,
            provider,
            hasData: !!data,
            dataKeys: data ? Object.keys(data) : [],
          },
          'Publishing event to EventBus...'
        );

        // Publish event (user-level architecture)
        await bus.event.emit(
          eventName, // Event name
          `${provider}-webhook`, // Publisher ID (emitterId)
          payload, // Complete payload: { userId, data }
          {
            correlationId: eventId ? `${provider}:${eventId}` : undefined,
            causationId: eventId ? `${provider}:${eventId}` : undefined,
            idempotencyKey: eventId ? `${provider}:${eventId}:${eventName}` : undefined,
          }
        );

        publishedEvents.push(eventName);

        logger.info({ eventName, userId, provider }, 'Event published to EventBus successfully');
      }

      // 4. Log (optional)
      let logId: string | undefined;
      if (log) {
        logId = await this.logWebhook({
          provider,
          event,
          internalEvents: publishedEvents,
          status: 'processed',
          processingTime: Date.now() - startTime,
        });
      }

      const processingTime = Date.now() - startTime;

      logger.info(
        { provider, eventCount: publishedEvents.length, processingTime },
        'Webhook processed successfully'
      );

      return {
        success: true,
        events: publishedEvents,
        logId,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error({ provider, error: errorMessage, processingTime }, 'Webhook processing failed');

      // RecordFailedLogs
      let logId: string | undefined;
      if (log) {
        logId = await this.logWebhook({
          provider,
          event,
          internalEvents: [],
          status: 'failed',
          error: errorMessage,
          processingTime,
        });
      }

      return {
        success: false,
        events: [],
        logId,
        error: errorMessage,
        processingTime,
      };
    }
  }

  /**
   * Record Webhook Logs
   *
   *
   * @param data - LogsData
   * @returns Logs ID
   */
  private async logWebhook(data: {
    provider: WebhookProvider;
    event: unknown;
    internalEvents: string[];
    status: 'processed' | 'failed';
    error?: string;
    processingTime: number;
  }): Promise<string> {
    try {
      // Extract event metadata
      const eventObj = data.event as Record<string, unknown>;
      const eventId = eventObj?.id as string | undefined;
      const eventType = (eventObj?.type as string) || 'unknown';

      // Create database log
      const log = await createWebhookLog({
        provider: data.provider,
        eventId,
        eventType,
        payload: data.event,
        status: data.status,
        internalEvents: data.internalEvents,
        error: data.error,
        processingTime: data.processingTime,
      });

      logger.info(
        {
          webhookLogId: log.id,
          provider: data.provider,
          eventType,
          status: data.status,
          events: data.internalEvents,
          processingTime: data.processingTime,
        },
        'Webhook logged to database'
      );

      return log.id;
    } catch (error) {
      // Fallback to console logging if database fails
      const logId = `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      logger.error(
        {
          logId,
          provider: data.provider,
          status: data.status,
          error: error instanceof Error ? error.message : String(error),
        },
        ' Failed to persist webhook log to database, using fallback ID'
      );

      return logId;
    }
  }

  /**
   *
   * @param provider - Provider name
   */
  async transform(provider: WebhookProvider, event: unknown): Promise<InternalEvent[]> {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`Webhook provider not registered: ${provider}`);
    }

    return adapter.transform(event);
  }
}

/**
 * Global Webhook Handler Instance
 *
 */

//  globalThis Type
declare global {
  var __webhookHandler: WebhookHandler | undefined;
}

if (!globalThis.__webhookHandler) {
  globalThis.__webhookHandler = new WebhookHandler();
}

export const webhookHandler = globalThis.__webhookHandler;
