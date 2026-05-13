/**
 *
 *
 */

import { logger } from '@/lib/_core/logger';
import type { EventTransport, EventHandler, EventMetadata } from './types';

/**
 */
interface HandlerWithMetadata {
  /** PluginID */
  pluginId: string;
  /** 实际of处理Function */
  handler: EventHandler;
  /** RegisterTime */
  registeredAt: Date;
}

export interface LocalEventTransportOptions {
  awaitHandlers?: boolean;
  failOnHandlerError?: boolean;
}

interface HandlerExecutionResult {
  succeeded: number;
  failed: number;
  total: number;
  errors: unknown[];
}

export class LocalEventTransport implements EventTransport {
  /**
   * Map<event, Set<HandlerWithMetadata>>
   *
   */
  private subscribers = new Map<string, Set<HandlerWithMetadata>>();

  constructor(private readonly options: LocalEventTransportOptions = {}) {}

  /**
   *
   */
  async send(event: string, payload: unknown, metadata: EventMetadata): Promise<void> {
    const handlers = this.subscribers.get(event);

    if (!handlers || handlers.size === 0) {
      logger.debug({ event }, 'No handlers for event');
      return;
    }

    logger.info({ event, handlerCount: handlers.size }, 'Event published (async, no wait)');

    if (this.options.awaitHandlers) {
      const result = await this.executeHandlersAsync(event, payload, metadata, handlers);
      if (this.options.failOnHandlerError && result.failed > 0) {
        const firstError = result.errors[0];
        const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
        throw new Error(`Event "${event}" failed in ${result.failed} handler(s): ${firstMessage}`);
      }
      return;
    }

    queueMicrotask(() => {
      void (async () => {
        try {
          await this.executeHandlersAsync(event, payload, metadata, handlers);
        } catch (error) {
          logger.error({ event, error }, 'Unhandled error in async event execution');
        }
      })();
    });
  }

  /**
   *
   */
  private async executeHandlersAsync(
    event: string,
    payload: unknown,
    metadata: EventMetadata,
    handlers: Set<HandlerWithMetadata>
  ): Promise<HandlerExecutionResult> {
    const results = await Promise.allSettled(
      Array.from(handlers).map(async (wrapper) => {
        const startTime = Date.now();
        try {
          await wrapper.handler(payload, metadata);
          const duration = Date.now() - startTime;
          logger.debug({ event, pluginId: wrapper.pluginId, duration }, 'Event handler succeeded');
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error(
            {
              event,
              pluginId: wrapper.pluginId,
              duration,
              error: error instanceof Error ? error.message : String(error),
            },
            'Event handler failed'
          );
          throw error; // Re-throw for Promise.allSettled
        }
      })
    );

    // Result
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);

    logger.info(
      { event, succeeded, failed, total: handlers.size },
      'Event handlers execution completed'
    );

    return {
      succeeded,
      failed,
      total: handlers.size,
      errors,
    };
  }

  /**
   * SubscriptionEvent
   *
   * @param event - Event name
   * @param pluginId - PluginID
   */
  subscribe(event: string, pluginId: string, handler: EventHandler): void {
    const wrapper: HandlerWithMetadata = {
      pluginId,
      handler,
      registeredAt: new Date(),
    };

    let handlers = this.subscribers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(event, handlers);
    }

    // Add handler
    handlers.add(wrapper);
    logger.debug({ event, pluginId }, 'Event handler subscribed');
  }

  /**
   * CancelSubscriptionEvent
   *
   * @param event - Event name
   * @param pluginId - PluginID
   */
  unsubscribe(event: string, pluginId: string, handler: EventHandler): void {
    const handlers = this.subscribers.get(event);
    if (!handlers) return;

    for (const wrapper of handlers) {
      if (wrapper.pluginId === pluginId && wrapper.handler === handler) {
        handlers.delete(wrapper);
        break;
      }
    }

    if (handlers.size === 0) {
      this.subscribers.delete(event);
    }

    logger.debug({ event, pluginId }, 'Event handler unsubscribed');
  }

  /**
   *
   *
   * @param pluginId - PluginID
   */
  removeAllSubscriptions(pluginId: string): void {
    let removedCount = 0;

    for (const [event, handlers] of this.subscribers.entries()) {
      const toRemove: HandlerWithMetadata[] = [];

      // PluginofAll handler
      for (const wrapper of handlers) {
        if (wrapper.pluginId === pluginId) {
          toRemove.push(wrapper);
        }
      }

      for (const wrapper of toRemove) {
        handlers.delete(wrapper);
        removedCount++;
      }

      if (handlers.size === 0) {
        this.subscribers.delete(event);
      }
    }

    logger.info({ pluginId, removedCount }, 'Removed all subscriptions for plugin');
  }

  /**
   * Get plugin IDs subscribed to an event
   *
   * @param event - Event name
   */
  getSubscribers(event: string): string[] {
    const pluginIds = new Set<string>();

    const handlers = this.subscribers.get(event);
    if (handlers) {
      handlers.forEach((w) => pluginIds.add(w.pluginId));
    }

    return Array.from(pluginIds).sort();
  }

  /**
   *
   *
   * @param pluginId - PluginID
   * @param event - Event name
   */
  removePluginEventSubscriptions(pluginId: string, event: string): void {
    let removedCount = 0;

    const handlers = this.subscribers.get(event);
    if (!handlers) return;

    // PluginofAll handler
    const toRemove: HandlerWithMetadata[] = [];
    for (const wrapper of handlers) {
      if (wrapper.pluginId === pluginId) {
        toRemove.push(wrapper);
      }
    }

    for (const wrapper of toRemove) {
      handlers.delete(wrapper);
      removedCount++;
    }

    if (handlers.size === 0) {
      this.subscribers.delete(event);
    }

    logger.debug(
      { pluginId, event, removedCount },
      'Removed plugin subscriptions for specific event'
    );
  }

  /**
   * GetPluginSubscriptionofAllEventList
   *
   *
   * @param pluginId - PluginID
   */
  getPluginEventSubscriptions(pluginId: string): string[] {
    const events: string[] = [];

    for (const [event, handlers] of this.subscribers.entries()) {
      const hasPlugin = Array.from(handlers).some((wrapper) => wrapper.pluginId === pluginId);
      if (hasPlugin) {
        events.push(event);
      }
    }

    return events.sort();
  }

  /**
   */
  clear(): void {
    this.subscribers.clear();
    logger.warn('Local event transport cleared');
  }
}
